//! BEX — Hybrid Tauri v2 + Rust Core Entrypoint.
//!
//! Wraps the exact 74,660-line React 18 + TipTap 2 frontend inside a native macOS `WKWebView`
//! with:
//! - Custom macOS menu freeing `Cmd+H` for TipTap's 9-color Highlight Menu (`app-menu.cjs` parity)
//! - Shutdown save flush barrier (`window.__bexFlushPendingEditorSaves`)
//! - Async streaming `bex-media://` protocol with HTTP 206 byte ranges, ETag, LRU cache & thumbnails
//! - Pre-React `window.bexDesktop` bridge injected via `initialization_script`

pub mod ai_access;
pub mod bible;
pub mod commands;
pub mod crypto;
pub mod http_bridge;
pub mod media;
pub mod search;
pub mod sheet_io;
pub mod transplant;
pub mod updater;
pub mod vault;

use commands::AppState;
use media::{parse_byte_range, read_media_for_protocol};
use tauri::http::{header, Response, StatusCode};
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

const BRIDGE_JS: &str = include_str!("bridge.js");

fn build_app_menu(app: &tauri::App) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    // Replicates `desktop/app-menu.cjs`: `Hide BEX` has NO accelerator so `Cmd+H` reaches TipTap!
    let check_updates = MenuItemBuilder::with_id("check_for_updates", "Check for Updates…").build(app)?;
    let hide_no_accel = MenuItemBuilder::with_id("hide_bex_unaccel", "Hide BEX").build(app)?;

    let app_sub = SubmenuBuilder::new(app, "BEX")
        .about(None)
        .item(&check_updates)
        .separator()
        .item(&hide_no_accel)
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let edit_sub = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let window_sub = SubmenuBuilder::new(app, "Window")
        .minimize()
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .separator()
        .close_window()
        .build()?;

    MenuBuilder::new(app)
        .item(&app_sub)
        .item(&edit_sub)
        .item(&window_sub)
        .build()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .register_uri_scheme_protocol("bex-media", |ctx, request| {
            let app = ctx.app_handle();
            let state = app.state::<AppState>();
            let method = request.method().as_str();

            if method == "OPTIONS" {
                return Response::builder()
                    .status(StatusCode::NO_CONTENT)
                    .header("Access-Control-Allow-Origin", "*")
                    .header("Access-Control-Allow-Methods", "GET, HEAD")
                    .header("Access-Control-Allow-Headers", "Range")
                    .body(Vec::new())
                    .unwrap();
            }

            let uri = request.uri().to_string();
            let (lib_path_opt, key_res) = {
                let vault = state.vault.lock().unwrap();
                (vault.library_path.clone(), vault.require_unlocked())
            };

            let (Some(lib_path), Ok(key)) = (lib_path_opt, key_res) else {
                return Response::builder()
                    .status(StatusCode::LOCKED)
                    .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
                    .body(b"Local media unavailable (vault locked)".to_vec())
                    .unwrap();
            };

            match read_media_for_protocol(&lib_path, &key, &uri, &state.media_cache) {
                Ok(cached) => {
                    let total = cached.bytes.len();
                    let range_hdr = request
                        .headers()
                        .get(header::RANGE)
                        .and_then(|v| v.to_str().ok());

                    if let Some((start, end)) = parse_byte_range(range_hdr, total) {
                        let slice = if method == "HEAD" {
                            Vec::new()
                        } else {
                            cached.bytes[start..=end].to_vec()
                        };
                        let len = end - start + 1;
                        Response::builder()
                            .status(StatusCode::PARTIAL_CONTENT)
                            .header(header::CONTENT_TYPE, &cached.mime_type)
                            .header(header::ACCEPT_RANGES, "bytes")
                            .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{total}"))
                            .header(header::CONTENT_LENGTH, len.to_string())
                            .header(header::ETAG, format!("\"{}\"", cached.etag))
                            .header(header::CACHE_CONTROL, "private, max-age=3600")
                            .header("Access-Control-Allow-Origin", "*")
                            .body(slice)
                            .unwrap()
                    } else {
                        let body = if method == "HEAD" {
                            Vec::new()
                        } else {
                            cached.bytes
                        };
                        Response::builder()
                            .status(StatusCode::OK)
                            .header(header::CONTENT_TYPE, &cached.mime_type)
                            .header(header::ACCEPT_RANGES, "bytes")
                            .header(header::CONTENT_LENGTH, total.to_string())
                            .header(header::ETAG, format!("\"{}\"", cached.etag))
                            .header(header::CACHE_CONTROL, "private, max-age=3600")
                            .header("Access-Control-Allow-Origin", "*")
                            .body(body)
                            .unwrap()
                    }
                }
                Err(_) => Response::builder()
                    .status(StatusCode::NOT_FOUND)
                    .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
                    .body(b"Local media not found".to_vec())
                    .unwrap(),
            }
        })
        .setup(|app| {
            let res_dir = app.path().resource_dir().ok();
            app.manage(AppState::new(res_dir));

            if let Ok(menu) = build_app_menu(app) {
                let _ = app.set_menu(menu);
            }

            app.on_menu_event(|app_handle, event| {
                if event.id().as_ref() == "check_for_updates" {
                    let handle = app_handle.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = updater::check_and_prompt_update(handle, true).await;
                    });
                }
            });

            // Quietly check GitHub Releases for signed updates shortly after launch
            updater::spawn_startup_update_check(app.handle().clone());

            // Replace default window with one carrying our pre-React `initialization_script`
            if let Some(existing) = app.get_webview_window("main") {
                let _ = existing.close();
            }

            let initial_route = std::env::var("BEX_OPEN_PATH").unwrap_or_default();
            let url = if initial_route.is_empty() {
                WebviewUrl::App("index.html".into())
            } else {
                WebviewUrl::App(initial_route.into())
            };

            let win = WebviewWindowBuilder::new(app, "main", url)
                .title("BEX — Berean Examination")
                .inner_size(1440.0, 900.0)
                .min_inner_size(960.0, 640.0)
                .background_color(tauri::window::Color(11, 13, 17, 255))
                .initialization_script(BRIDGE_JS)
                .build()?;

            // Flush any pending TipTap/canvas editor saves on window close
            let win_clone = win.clone();
            win.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { .. } = event {
                    let _ = win_clone.eval(
                        "try { window.__bexFlushPendingEditorSaves && window.__bexFlushPendingEditorSaves(); } catch (e) {}",
                    );
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::library_get_status,
            commands::library_choose,
            commands::privacy_get_status,
            commands::privacy_unlock_automatic,
            commands::privacy_unlock_pin,
            commands::privacy_unlock_recovery,
            commands::privacy_enable_pin,
            commands::privacy_change_pin,
            commands::privacy_disable_pin,
            commands::privacy_replace_recovery,
            commands::local_owner_get,
            commands::local_owner_update,
            commands::local_entity_list,
            commands::local_entity_get,
            commands::local_entity_create,
            commands::local_entity_update,
            commands::local_entity_delete,
            commands::local_entity_reorder,
            commands::local_entity_snapshot,
            commands::local_entity_import_knowledge_web_graph,
            commands::local_entity_restore_knowledge_web_graph,
            commands::search_global_library,
            commands::brain_transplant_export,
            commands::brain_transplant_import,
            commands::sheet_import_xlsx_fast,
            commands::sheet_export_xlsx_fast,
            commands::local_media_save_image,
            commands::local_media_delete_image,
            commands::local_attachments_import,
            commands::local_attachments_open,
            commands::local_bible_get_chapter,
            commands::local_mam_get_chapter,
            commands::scripture_get_status,
            commands::scripture_save_key,
            commands::scripture_clear_key,
            commands::scripture_get_catalog,
            commands::scripture_get_books,
            commands::scripture_fetch_content,
            commands::scripture_search_words,
            commands::scripture_cancel_request,
            commands::scripture_get_usage,
            commands::courses_list,
            commands::courses_install_package,
            commands::courses_connect_local_catalog,
            commands::courses_install_catalog_course,
            commands::courses_cancel_catalog_course,
            commands::courses_save_progress,
            commands::sync_status,
            commands::sync_enable,
            commands::sync_now,
            commands::sync_invite,
            commands::sync_conflicts,
            commands::sync_resolve,
            commands::sync_devices,
            commands::sync_revoke,
            commands::sync_pause,
            commands::clipboard_write_text,
            commands::app_restart,
            commands::emoji_get_native_font,
            commands::contact_open_email,
            commands::external_link_open,
            commands::export_choose_file,
            commands::export_cancel_selection,
            commands::export_save_file,
            commands::export_render_note_pdf,
            commands::export_read_pdf_image,
            commands::updater_check,
        ])
        .run(tauri::generate_context!())
        .expect("error while running BEX native Rust application");
}
