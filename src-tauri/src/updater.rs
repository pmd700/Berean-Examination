//! Native Tauri v2 Auto-Updater for BEX.
//!
//! Fetches signed release manifests from GitHub Releases (`latest.json`),
//! verifies the minisign cryptographic signature against the embedded public key,
//! flushes pending editor saves, installs the new `BEX.app`, and restarts.

use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

async fn ask_yes_no(app: &AppHandle, title: &str, message: &str, ok_label: &str, cancel_label: &str) -> bool {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .message(message)
        .title(title)
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom(
            ok_label.to_string(),
            cancel_label.to_string(),
        ))
        .show(move |accepted| {
            let _ = tx.send(accepted);
        });
    rx.await.unwrap_or(false)
}

async fn show_info(app: &AppHandle, title: &str, message: &str, kind: MessageDialogKind) {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .message(message)
        .title(title)
        .kind(kind)
        .buttons(MessageDialogButtons::Ok)
        .show(move |_| {
            let _ = tx.send(());
        });
    let _ = rx.await;
}

/// Checks GitHub Releases for a newer signed BEX version.
/// When `interactive` is `false` (startup background check), stays completely silent
/// unless an update is available.
pub async fn check_and_prompt_update(app: AppHandle, interactive: bool) -> Result<bool, String> {
    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            let msg = format!("Updater initialization failed: {e}");
            if interactive {
                show_info(&app, "BEX Updates", &msg, MessageDialogKind::Error).await;
            }
            return Err(msg);
        }
    };

    let update_opt = match updater.check().await {
        Ok(u) => u,
        Err(e) => {
            let msg = format!("Could not check for updates right now.\n\n{e}");
            if interactive {
                show_info(&app, "BEX Updates", &msg, MessageDialogKind::Warning).await;
            }
            return Err(msg);
        }
    };

    let Some(update) = update_opt else {
        if interactive {
            let current = app.package_info().version.to_string();
            show_info(
                &app,
                "You're Up to Date",
                &format!("BEX v{current} is already the latest version."),
                MessageDialogKind::Info,
            )
            .await;
        }
        return Ok(false);
    };

    let current = app.package_info().version.to_string();
    let next_ver = update.version.clone();
    let notes = update
        .body
        .clone()
        .unwrap_or_default()
        .trim()
        .to_string();

    let body = if notes.is_empty() {
        format!("BEX v{next_ver} is available (you are on v{current}).\n\nDownload, install, and restart BEX now?")
    } else {
        format!("BEX v{next_ver} is available (you are on v{current}).\n\nWhat's new:\n{notes}\n\nDownload, install, and restart BEX now?")
    };

    let accepted = ask_yes_no(
        &app,
        "BEX Update Available",
        &body,
        "Update & Restart",
        "Later",
    )
    .await;

    if !accepted {
        return Ok(true);
    }

    // Flush any pending editor saves before swapping the bundle and restarting
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.eval(
            "try { window.__bexFlushPendingEditorSaves && window.__bexFlushPendingEditorSaves(); } catch (e) {}",
        );
    }
    tokio::time::sleep(Duration::from_millis(250)).await;

    match update.download_and_install(|_chunk, _total| {}, || {}).await {
        Ok(()) => {
            app.restart();
        }
        Err(e) => {
            let msg = format!("Update download or verification failed:\n\n{e}");
            show_info(&app, "BEX Update Failed", &msg, MessageDialogKind::Error).await;
            Err(msg)
        }
    }
}

/// Spawns a quiet background update check shortly after launch.
pub fn spawn_startup_update_check(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(4)).await;
        let _ = check_and_prompt_update(app, false).await;
    });
}
