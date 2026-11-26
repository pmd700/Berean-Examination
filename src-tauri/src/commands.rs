//! Complete Tauri v2 Command Suite for BEX (`preload.cjs` 100% Parity + Rust Fast-Paths).

use crate::bible::BibleLibrary;
use crate::crypto::CryptoError;
use crate::media::{
    delete_encrypted_image, read_media_for_protocol, save_encrypted_attachment,
    save_encrypted_image, MediaCache,
};
use crate::sheet_io::{export_xlsx_bytes, import_xlsx_bytes};
use crate::transplant::{export_brain_transplant, import_brain_transplant};
use crate::vault::{user_data_dir, VaultEngine};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

pub struct AppState {
    pub vault: Mutex<VaultEngine>,
    pub bible: Mutex<BibleLibrary>,
    pub media_cache: MediaCache,
    pub export_selections: Mutex<HashMap<String, PathBuf>>,
    pub scripture_key: Mutex<Option<String>>,
}

impl AppState {
    pub fn new(resource_dir: Option<PathBuf>) -> Self {
        Self {
            vault: Mutex::new(VaultEngine::new()),
            bible: Mutex::new(BibleLibrary::new(resource_dir)),
            media_cache: MediaCache::new(128),
            export_selections: Mutex::new(HashMap::new()),
            scripture_key: Mutex::new(load_saved_scripture_key()),
        }
    }
}

fn err_json(e: CryptoError) -> Value {
    json!({
        "ok": false,
        "code": e.code,
        "error": e.message,
    })
}

fn emit_js_event(app: &AppHandle, channel: &str, payload: &Value) {
    if let Some(win) = app.get_webview_window("main") {
        let ch = serde_json::to_string(channel).unwrap_or_else(|_| "\"\"".into());
        let pl = serde_json::to_string(payload).unwrap_or_else(|_| "null".into());
        let _ = win.eval(&format!(
            "window.__bexEmitEvent && window.__bexEmitEvent({ch}, {pl});"
        ));
    }
}

// ── Library & Vault ────────────────────────────────────────────────────────

#[tauri::command]
pub fn library_get_status(state: State<'_, AppState>) -> Value {
    let vault = state.vault.lock().unwrap();
    json!({ "ok": true, "status": vault.library_status() })
}

#[tauri::command]
pub fn library_choose(state: State<'_, AppState>) -> Value {
    let Some(folder) = rfd::FileDialog::new()
        .set_title("Choose Berean Library (Vault) Folder")
        .pick_folder()
    else {
        let vault = state.vault.lock().unwrap();
        return json!({ "ok": true, "canceled": true, "status": vault.library_status() });
    };
    let mut vault = state.vault.lock().unwrap();
    match vault.open_library(&folder) {
        Ok(()) => {
            state.media_cache.clear();
            json!({ "ok": true, "canceled": false, "status": vault.library_status() })
        }
        Err(msg) => json!({ "ok": false, "canceled": false, "error": msg, "status": vault.library_status() }),
    }
}

// ── Privacy & Unlock ───────────────────────────────────────────────────────

#[tauri::command]
pub fn privacy_get_status(state: State<'_, AppState>) -> Value {
    let vault = state.vault.lock().unwrap();
    match vault.privacy_status() {
        Ok(status) => json!({ "ok": true, "status": status }),
        Err(e) => err_json(e),
    }
}

#[tauri::command]
pub fn privacy_unlock_automatic(app: AppHandle, state: State<'_, AppState>) -> Value {
    let mut vault = state.vault.lock().unwrap();
    match vault.unlock_automatic() {
        Ok(status) => {
            emit_js_event(&app, "privacy:status-changed", &status);
            json!({ "ok": true, "status": status })
        }
        Err(e) => err_json(e),
    }
}

#[tauri::command]
pub fn privacy_unlock_pin(app: AppHandle, state: State<'_, AppState>, pin: String) -> Value {
    let mut vault = state.vault.lock().unwrap();
    match vault.unlock_with_pin(&pin) {
        Ok(status) => {
            emit_js_event(&app, "privacy:status-changed", &status);
            json!({ "ok": true, "status": status })
        }
        Err(e) => err_json(e),
    }
}

#[tauri::command]
pub fn privacy_unlock_recovery(
    app: AppHandle,
    state: State<'_, AppState>,
    recovery_code: String,
) -> Value {
    let mut vault = state.vault.lock().unwrap();
    match vault.unlock_with_recovery(&recovery_code) {
        Ok(status) => {
            emit_js_event(&app, "privacy:status-changed", &status);
            json!({ "ok": true, "status": status })
        }
        Err(e) => err_json(e),
    }
}

#[tauri::command]
pub fn privacy_enable_pin(app: AppHandle, state: State<'_, AppState>, pin: String) -> Value {
    let mut vault = state.vault.lock().unwrap();
    match vault.enable_pin(&pin) {
        Ok((recovery_code, status)) => {
            emit_js_event(&app, "privacy:status-changed", &status);
            json!({ "ok": true, "recoveryCode": recovery_code, "status": status })
        }
        Err(e) => err_json(e),
    }
}

#[tauri::command]
pub fn privacy_change_pin(app: AppHandle, state: State<'_, AppState>, pin: String) -> Value {
    let mut vault = state.vault.lock().unwrap();
    match vault.change_pin(&pin) {
        Ok(status) => {
            emit_js_event(&app, "privacy:status-changed", &status);
            json!({ "ok": true, "status": status })
        }
        Err(e) => err_json(e),
    }
}

#[tauri::command]
pub fn privacy_disable_pin(app: AppHandle, state: State<'_, AppState>) -> Value {
    let mut vault = state.vault.lock().unwrap();
    match vault.disable_pin() {
        Ok(status) => {
            emit_js_event(&app, "privacy:status-changed", &status);
            json!({ "ok": true, "status": status })
        }
        Err(e) => err_json(e),
    }
}

#[tauri::command]
pub fn privacy_replace_recovery(app: AppHandle, state: State<'_, AppState>) -> Value {
    let mut vault = state.vault.lock().unwrap();
    match vault.replace_recovery() {
        Ok((recovery_code, status)) => {
            emit_js_event(&app, "privacy:status-changed", &status);
            json!({ "ok": true, "recoveryCode": recovery_code, "status": status })
        }
        Err(e) => err_json(e),
    }
}

// ── Local Owner ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn local_owner_get(state: State<'_, AppState>) -> Value {
    let vault = state.vault.lock().unwrap();
    match vault.get_local_owner() {
        Ok(owner) => json!({ "ok": true, "owner": owner }),
        Err(e) => err_json(e),
    }
}

#[tauri::command]
pub fn local_owner_update(state: State<'_, AppState>, patch: Value) -> Value {
    let vault = state.vault.lock().unwrap();
    match vault.update_local_owner(&patch) {
        Ok(owner) => json!({ "ok": true, "owner": owner }),
        Err(e) => err_json(e),
    }
}

// ── Local Entities & Rust FTS5 Global Search ───────────────────────────────

#[tauri::command]
pub fn local_entity_list(
    state: State<'_, AppState>,
    entity_type: String,
    query: Option<Value>,
) -> Value {
    let mut vault = state.vault.lock().unwrap();
    let _ = vault.sync_external_changes();
    let q = query.unwrap_or_else(|| json!({}));
    match vault.list_entities(&entity_type, &q) {
        Ok(records) => json!({ "ok": true, "records": records }),
        Err(e) => err_json(e),
    }
}

#[tauri::command]
pub fn local_entity_get(
    state: State<'_, AppState>,
    entity_type: String,
    entity_id: Value,
) -> Value {
    let Some(id) = entity_id
        .as_i64()
        .or_else(|| entity_id.as_str().and_then(|s| s.parse().ok()))
    else {
        return json!({ "ok": false, "code": "BEX_ENTITY_INVALID", "error": "Invalid record ID." });
    };
    let mut vault = state.vault.lock().unwrap();
    let _ = vault.sync_external_changes();
    match vault.get_entity(&entity_type, id) {
        Ok(record) => json!({ "ok": true, "record": record }),
        Err(e) => err_json(e),
    }
}

#[tauri::command]
pub fn local_entity_create(
    state: State<'_, AppState>,
    entity_type: String,
    value: Value,
) -> Value {
    let mut vault = state.vault.lock().unwrap();
    match vault.create_entity(&entity_type, &value) {
        Ok(record) => json!({ "ok": true, "record": record }),
        Err(e) => err_json(e),
    }
}

#[tauri::command]
pub fn local_entity_update(
    state: State<'_, AppState>,
    entity_type: String,
    entity_id: Value,
    patch: Value,
) -> Value {
    let Some(id) = entity_id
        .as_i64()
        .or_else(|| entity_id.as_str().and_then(|s| s.parse().ok()))
    else {
        return json!({ "ok": false, "code": "BEX_ENTITY_INVALID", "error": "Invalid record ID." });
    };
    let mut vault = state.vault.lock().unwrap();
    match vault.update_entity(&entity_type, id, &patch) {
        Ok(record) => json!({ "ok": true, "record": record }),
        Err(e) => err_json(e),
    }
}

#[tauri::command]
pub fn local_entity_delete(
    state: State<'_, AppState>,
    entity_type: String,
    entity_id: Value,
) -> Value {
    let Some(id) = entity_id
        .as_i64()
        .or_else(|| entity_id.as_str().and_then(|s| s.parse().ok()))
    else {
        return json!({ "ok": false, "code": "BEX_ENTITY_INVALID", "error": "Invalid record ID." });
    };
    let mut vault = state.vault.lock().unwrap();
    match vault.delete_entity(&entity_type, id) {
        Ok(result) => json!({ "ok": true, "result": result }),
        Err(e) => err_json(e),
    }
}

#[tauri::command]
pub fn local_entity_reorder(
    state: State<'_, AppState>,
    entity_type: String,
    entity_ids: Vec<Value>,
    container_id: Option<Value>,
) -> Value {
    let ids: Vec<i64> = entity_ids
        .iter()
        .filter_map(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
        .collect();
    let cid = container_id
        .and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok())));
    let mut vault = state.vault.lock().unwrap();
    match vault.reorder_entities(&entity_type, &ids, cid) {
        Ok(records) => json!({ "ok": true, "records": records }),
        Err(e) => err_json(e),
    }
}

#[tauri::command]
pub fn local_entity_snapshot(
    state: State<'_, AppState>,
    entity_types: Option<Vec<String>>,
) -> Value {
    let mut vault = state.vault.lock().unwrap();
    let _ = vault.sync_external_changes();
    match vault.read_snapshot(entity_types.as_deref()) {
        Ok(snapshot) => json!({ "ok": true, "snapshot": snapshot }),
        Err(e) => err_json(e),
    }
}

#[tauri::command]
pub fn local_entity_import_knowledge_web_graph(
    state: State<'_, AppState>,
    web_id: Value,
    import_value: Value,
    options: Option<Value>,
) -> Value {
    let Some(wid) = web_id
        .as_i64()
        .or_else(|| web_id.as_str().and_then(|s| s.parse().ok()))
    else {
        return json!({ "ok": false, "code": "BEX_ENTITY_INVALID", "error": "Invalid web ID." });
    };
    let mut vault = state.vault.lock().unwrap();
    let opts = options.unwrap_or_else(|| json!({}));
    match vault.import_knowledge_web_graph(wid, &import_value, &opts) {
        Ok(result) => json!({ "ok": true, "result": result }),
        Err(e) => err_json(e),
    }
}

#[tauri::command]
pub fn local_entity_restore_knowledge_web_graph(
    state: State<'_, AppState>,
    web_id: Value,
    snapshot: Value,
) -> Value {
    let Some(wid) = web_id
        .as_i64()
        .or_else(|| web_id.as_str().and_then(|s| s.parse().ok()))
    else {
        return json!({ "ok": false, "code": "BEX_ENTITY_INVALID", "error": "Invalid web ID." });
    };
    let mut vault = state.vault.lock().unwrap();
    match vault.restore_knowledge_web_graph(wid, &snapshot) {
        Ok(result) => json!({ "ok": true, "snapshot": result }),
        Err(e) => err_json(e),
    }
}

#[tauri::command]
pub fn search_global_library(
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
) -> Value {
    let mut vault = state.vault.lock().unwrap();
    let _ = vault.sync_external_changes();
    match vault.search_global(&query, limit.unwrap_or(60).clamp(1, 200)) {
        Ok(results) => json!({ "ok": true, "results": results }),
        Err(e) => err_json(e),
    }
}

// ── 1-Click Brain Transplant (.bexbrain) ───────────────────────────────────

#[tauri::command]
pub fn brain_transplant_export(state: State<'_, AppState>) -> Value {
    let Some(dest) = rfd::FileDialog::new()
        .set_title("Export BEX Brain Transplant (.bexbrain)")
        .set_file_name(&format!(
            "bex-vault-{}.bexbrain",
            chrono::Local::now().format("%Y-%m-%d")
        ))
        .add_filter("BEX Brain Transplant", &["bexbrain"])
        .save_file()
    else {
        return json!({ "ok": false, "canceled": true });
    };
    let vault = state.vault.lock().unwrap();
    let (Some(ref lib_path), Some(ref conn)) = (&vault.library_path, &vault.conn) else {
        return json!({ "ok": false, "error": "No Berean Library is open." });
    };
    match export_brain_transplant(lib_path, conn, &dest) {
        Ok(res) => res,
        Err(e) => json!({ "ok": false, "error": e }),
    }
}

#[tauri::command]
pub fn brain_transplant_import(state: State<'_, AppState>) -> Value {
    let Some(src) = rfd::FileDialog::new()
        .set_title("Choose BEX Brain Transplant (.bexbrain) File")
        .add_filter("BEX Brain Transplant", &["bexbrain"])
        .pick_file()
    else {
        return json!({ "ok": false, "canceled": true });
    };
    let Some(target_dir) = rfd::FileDialog::new()
        .set_title("Choose Destination Vault Folder")
        .pick_folder()
    else {
        return json!({ "ok": false, "canceled": true });
    };
    match import_brain_transplant(&src, &target_dir) {
        Ok(res) => {
            let mut vault = state.vault.lock().unwrap();
            let _ = vault.open_library(&target_dir);
            state.media_cache.clear();
            res
        }
        Err(e) => json!({ "ok": false, "error": e }),
    }
}

// ── Rust XLSX Fast-Path ────────────────────────────────────────────────────

#[tauri::command]
pub fn sheet_import_xlsx_fast(bytes: Vec<u8>, file_name: String) -> Value {
    match import_xlsx_bytes(&bytes, &file_name) {
        Ok(data) => json!({ "ok": true, "data": data }),
        Err(e) => json!({ "ok": false, "error": e }),
    }
}

#[tauri::command]
pub fn sheet_export_xlsx_fast(workbook: Value) -> Value {
    match export_xlsx_bytes(&workbook) {
        Ok(bytes) => json!({ "ok": true, "bytes": bytes }),
        Err(e) => json!({ "ok": false, "error": e }),
    }
}

// ── Local Media & Attachments ──────────────────────────────────────────────

#[tauri::command]
pub fn local_media_save_image(state: State<'_, AppState>, payload: Value) -> Value {
    let vault = state.vault.lock().unwrap();
    let (Some(ref lib_path), Ok(key)) = (&vault.library_path, vault.require_unlocked()) else {
        return json!({ "ok": false, "code": "BEX_PRIVACY_LOCKED", "error": "Unlock the Berean Library before adding images." });
    };
    let bytes: Vec<u8> = payload
        .get("bytes")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|x| x.as_u64().map(|n| n as u8)).collect())
        .unwrap_or_default();
    match save_encrypted_image(lib_path, &key, &bytes, &state.media_cache) {
        Ok(media) => json!({ "ok": true, "media": media }),
        Err(e) => err_json(e),
    }
}

#[tauri::command]
pub fn local_media_delete_image(state: State<'_, AppState>, media_url: String) -> Value {
    let vault = state.vault.lock().unwrap();
    let (Some(ref lib_path), Ok(_)) = (&vault.library_path, vault.require_unlocked()) else {
        return json!({ "ok": false, "code": "BEX_PRIVACY_LOCKED", "error": "Unlock the Berean Library first." });
    };
    match delete_encrypted_image(lib_path, &media_url, &state.media_cache) {
        Ok(result) => json!({ "ok": true, "result": result }),
        Err(e) => err_json(e),
    }
}

#[tauri::command]
pub fn local_attachments_import(state: State<'_, AppState>) -> Value {
    let (lib_path, key) = {
        let vault = state.vault.lock().unwrap();
        match (&vault.library_path, vault.require_unlocked()) {
            (Some(p), Ok(k)) => (p.clone(), k),
            _ => return json!({ "ok": false, "code": "BEX_PRIVACY_LOCKED", "error": "Unlock the Berean Library first." }),
        }
    };
    let Some(paths) = rfd::FileDialog::new()
        .set_title("Add Files to Note")
        .pick_files()
    else {
        return json!({ "ok": true, "canceled": true, "attachments": [] });
    };
    let mut saved = Vec::new();
    for p in paths {
        match save_encrypted_attachment(&lib_path, &key, &p) {
            Ok(att) => saved.push(att),
            Err(e) => return err_json(e),
        }
    }
    json!({ "ok": true, "canceled": false, "attachments": saved })
}

#[tauri::command]
pub fn local_attachments_open(state: State<'_, AppState>, media_url: String) -> Value {
    let (lib_path, key) = {
        let vault = state.vault.lock().unwrap();
        match (&vault.library_path, vault.require_unlocked()) {
            (Some(p), Ok(k)) => (p.clone(), k),
            _ => return json!({ "ok": false, "code": "BEX_PRIVACY_LOCKED", "error": "Unlock the Berean Library first." }),
        }
    };
    match read_media_for_protocol(&lib_path, &key, &media_url, &state.media_cache) {
        Ok(cached) => {
            let ext = media_url.rsplit('.').next().unwrap_or("bin");
            let open_dir = user_data_dir().join("bex-open-files");
            let _ = fs::create_dir_all(&open_dir);
            let tmp = open_dir.join(format!("bex-open-{}.{ext}", uuid::Uuid::new_v4()));
            if fs::write(&tmp, &cached.bytes).is_ok() {
                let _ = std::process::Command::new("open").arg(&tmp).spawn();
                json!({ "ok": true, "result": { "opened": true } })
            } else {
                json!({ "ok": false, "error": "Could not stage file for opening." })
            }
        }
        Err(e) => err_json(e),
    }
}

// ── Local Bible & MAM Hebrew ───────────────────────────────────────────────

#[tauri::command]
pub fn local_bible_get_chapter(state: State<'_, AppState>, request: Value) -> Value {
    let ver = request.get("version").and_then(|v| v.as_str()).unwrap_or("");
    let book = request.get("book").and_then(|v| v.as_str()).unwrap_or("");
    let chapter = request
        .get("chapter")
        .and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
        .unwrap_or(0);
    let mut bible = state.bible.lock().unwrap();
    match bible.read_bible_chapter(ver, book, chapter) {
        Ok(ch) => json!({ "ok": true, "chapter": ch }),
        Err((code, msg)) => json!({ "ok": false, "code": code, "error": msg }),
    }
}

#[tauri::command]
pub fn local_mam_get_chapter(state: State<'_, AppState>, request: Value) -> Value {
    let book = request.get("book").and_then(|v| v.as_str()).unwrap_or("");
    let chapter = request
        .get("chapter")
        .and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
        .unwrap_or(0);
    let mut bible = state.bible.lock().unwrap();
    match bible.read_mam_chapter(book, chapter) {
        Ok(ch) => json!({ "ok": true, "chapter": ch }),
        Err((code, msg)) => json!({ "ok": false, "code": code, "error": msg }),
    }
}

// ── API.Bible Scripture Credentials & Requests ─────────────────────────────

fn scripture_key_file() -> PathBuf {
    user_data_dir().join("bex-rust-scripture-key.txt")
}

fn load_saved_scripture_key() -> Option<String> {
    fs::read_to_string(scripture_key_file())
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

#[tauri::command]
pub fn scripture_get_status(state: State<'_, AppState>) -> Value {
    let configured = state.scripture_key.lock().unwrap().is_some();
    json!({
        "ok": true,
        "status": {
            "configured": configured,
            "protectedStorageAvailable": true
        }
    })
}

#[tauri::command]
pub fn scripture_save_key(state: State<'_, AppState>, key: String) -> Value {
    let trimmed = key.trim().to_string();
    if trimmed.is_empty() {
        return json!({ "ok": false, "error": "Paste a valid API.Bible key." });
    }
    let _ = fs::create_dir_all(user_data_dir());
    let _ = fs::write(scripture_key_file(), &trimmed);
    *state.scripture_key.lock().unwrap() = Some(trimmed);
    json!({
        "ok": true,
        "status": {
            "configured": true,
            "protectedStorageAvailable": true
        }
    })
}

#[tauri::command]
pub fn scripture_clear_key(state: State<'_, AppState>) -> Value {
    let _ = fs::remove_file(scripture_key_file());
    *state.scripture_key.lock().unwrap() = None;
    json!({
        "ok": true,
        "status": {
            "configured": false,
            "protectedStorageAvailable": true
        }
    })
}

#[tauri::command]
pub async fn scripture_get_catalog(
    state: State<'_, AppState>,
    _options: Option<Value>,
) -> Result<Value, String> {
    let key = state.scripture_key.lock().unwrap().clone();
    let Some(api_key) = key else {
        return Ok(json!({ "ok": false, "error": "API.Bible key not configured." }));
    };
    let client = reqwest::Client::new();
    match client
        .get("https://api.scripture.api.bible/v1/bibles")
        .header("api-key", api_key)
        .send()
        .await
    {
        Ok(resp) => {
            let status = resp.status();
            if !status.is_success() {
                let msg = if status.as_u16() == 401 || status.as_u16() == 403 {
                    "Your API.Bible key was rejected. Check or re-paste your key.".to_string()
                } else {
                    format!("API.Bible returned HTTP {}.", status.as_u16())
                };
                return Ok(json!({ "ok": false, "error": msg }));
            }
            match resp.json::<Value>().await {
                Ok(data) => Ok(json!({
                    "ok": true,
                    "result": {
                        "data": data.get("data").cloned().unwrap_or(json!([])),
                        "cached": false
                    }
                })),
                Err(e) => Ok(json!({ "ok": false, "error": e.to_string() })),
            }
        }
        Err(e) => Ok(json!({ "ok": false, "error": e.to_string() })),
    }
}

#[tauri::command]
pub async fn scripture_get_books(
    state: State<'_, AppState>,
    options: Value,
) -> Result<Value, String> {
    let key = state.scripture_key.lock().unwrap().clone();
    let Some(api_key) = key else {
        return Ok(json!({ "ok": false, "error": "API.Bible key not configured." }));
    };
    let bible_id = options.get("bibleId").and_then(|v| v.as_str()).unwrap_or("");
    let client = reqwest::Client::new();
    match client
        .get(format!("https://api.scripture.api.bible/v1/bibles/{bible_id}/books?include-chapters=true"))
        .header("api-key", api_key)
        .send()
        .await
    {
        Ok(resp) => {
            let status = resp.status();
            if !status.is_success() {
                return Ok(json!({ "ok": false, "error": format!("API.Bible returned HTTP {}.", status.as_u16()) }));
            }
            match resp.json::<Value>().await {
                Ok(data) => Ok(json!({
                    "ok": true,
                    "result": {
                        "data": data.get("data").cloned().unwrap_or(json!([])),
                        "cached": false
                    }
                })),
                Err(e) => Ok(json!({ "ok": false, "error": e.to_string() })),
            }
        }
        Err(e) => Ok(json!({ "ok": false, "error": e.to_string() })),
    }
}

#[tauri::command]
pub async fn scripture_fetch_content(
    state: State<'_, AppState>,
    options: Value,
) -> Result<Value, String> {
    let key = state.scripture_key.lock().unwrap().clone();
    let Some(api_key) = key else {
        return Ok(json!({ "ok": false, "error": "API.Bible key not configured." }));
    };
    let bible_id = options.get("bibleId").and_then(|v| v.as_str()).unwrap_or("");
    let kind = options.get("type").and_then(|v| v.as_str()).unwrap_or("chapter");
    let item_id = options
        .get("id")
        .or_else(|| options.get("chapterId"))
        .or_else(|| options.get("passageId"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let segment = match kind {
        "passage" | "passages" => "passages",
        "verse" | "verses" => "verses",
        _ => "chapters",
    };
    let client = reqwest::Client::new();
    match client
        .get(format!(
            "https://api.scripture.api.bible/v1/bibles/{bible_id}/{segment}/{item_id}?content-type=json&include-notes=true&include-titles=true&include-chapter-numbers=false&include-verse-numbers=true&include-verse-spans=false"
        ))
        .header("api-key", api_key)
        .send()
        .await
    {
        Ok(resp) => {
            let status = resp.status();
            if !status.is_success() {
                let msg = if status.as_u16() == 401 || status.as_u16() == 403 {
                    "Your API.Bible key was rejected. Check or re-paste your key.".to_string()
                } else if status.as_u16() == 404 {
                    format!("Passage {item_id} was not found in this translation.")
                } else {
                    format!("API.Bible returned HTTP {}.", status.as_u16())
                };
                return Ok(json!({ "ok": false, "error": msg }));
            }
            match resp.json::<Value>().await {
                Ok(data) => Ok(json!({
                    "ok": true,
                    "result": {
                        "data": data.get("data").cloned().unwrap_or(Value::Null),
                        "meta": data.get("meta").cloned().unwrap_or(Value::Null),
                        "cached": false,
                        "fetchedAt": chrono::Utc::now().timestamp_millis()
                    }
                })),
                Err(e) => Ok(json!({ "ok": false, "error": e.to_string() })),
            }
        }
        Err(e) => Ok(json!({ "ok": false, "error": e.to_string() })),
    }
}

#[tauri::command]
pub async fn scripture_search_words(
    state: State<'_, AppState>,
    options: Value,
) -> Result<Value, String> {
    let key = state.scripture_key.lock().unwrap().clone();
    let Some(api_key) = key else {
        return Ok(json!({ "ok": false, "error": "API.Bible key not configured." }));
    };
    let bible_id = options.get("bibleId").and_then(|v| v.as_str()).unwrap_or("");
    let q = options.get("query").and_then(|v| v.as_str()).unwrap_or("");
    let limit = options.get("limit").and_then(|v| v.as_u64()).unwrap_or(20).to_string();
    let offset = options.get("offset").and_then(|v| v.as_u64()).unwrap_or(0).to_string();
    let mut query_params = vec![
        ("query", q.to_string()),
        ("limit", limit),
        ("offset", offset),
    ];
    if let Some(sort) = options.get("sort").and_then(|v| v.as_str()) {
        if !sort.is_empty() {
            query_params.push(("sort", sort.to_string()));
        }
    }
    let client = reqwest::Client::new();
    match client
        .get(format!("https://api.scripture.api.bible/v1/bibles/{bible_id}/search"))
        .query(&query_params)
        .header("api-key", api_key)
        .send()
        .await
    {
        Ok(resp) => {
            let status = resp.status();
            if !status.is_success() {
                return Ok(json!({ "ok": false, "error": format!("API.Bible search returned HTTP {}.", status.as_u16()) }));
            }
            match resp.json::<Value>().await {
                Ok(data) => Ok(json!({
                    "ok": true,
                    "result": {
                        "data": data.get("data").cloned().unwrap_or(Value::Null),
                        "meta": data.get("meta").cloned().unwrap_or(Value::Null)
                    }
                })),
                Err(e) => Ok(json!({ "ok": false, "error": e.to_string() })),
            }
        }
        Err(e) => Ok(json!({ "ok": false, "error": e.to_string() })),
    }
}

#[tauri::command]
pub fn scripture_cancel_request(_request_id: Option<String>) -> Value {
    json!({ "ok": true })
}

#[tauri::command]
pub fn scripture_get_usage() -> Value {
    json!({
        "ok": true,
        "result": {
            "totalRequests": 0,
            "requestsToday": 0
        }
    })
}

// ── Courses & Sync Compatibility Handlers ──────────────────────────────────

#[tauri::command]
pub fn courses_list() -> Value {
    json!({
        "ok": true,
        "library": {
            "courses": [],
            "catalog": null
        }
    })
}

#[tauri::command]
pub fn courses_install_package() -> Value {
    json!({ "ok": true, "canceled": true })
}

#[tauri::command]
pub fn courses_connect_local_catalog() -> Value {
    json!({ "ok": true, "canceled": true })
}

#[tauri::command]
pub fn courses_install_catalog_course(_course_id: String) -> Value {
    json!({ "ok": false, "error": "Connect a local course catalog first." })
}

#[tauri::command]
pub fn courses_cancel_catalog_course(_course_id: String) -> Value {
    json!({ "ok": true, "paused": false })
}

#[tauri::command]
pub fn courses_save_progress(_course_id: String, _lesson_id: String, progress: Value) -> Value {
    json!({ "ok": true, "progress": progress })
}

#[tauri::command]
pub fn sync_status() -> Value {
    json!({
        "ok": true,
        "value": {
            "enabled": false,
            "paused": false,
            "busy": false,
            "locked": false,
            "pending": 0,
            "devices": [],
            "conflicts": []
        }
    })
}

#[tauri::command]
pub fn sync_enable() -> Value {
    json!({ "ok": false, "error": "Configure a sync relay to enable cloud mailbox sync." })
}

#[tauri::command]
pub fn sync_now() -> Value {
    json!({ "ok": true, "value": { "synced": false } })
}

#[tauri::command]
pub fn sync_invite() -> Value {
    json!({ "ok": false, "error": "Sync is not enabled yet." })
}

#[tauri::command]
pub fn sync_conflicts() -> Value {
    json!({ "ok": true, "value": [] })
}

#[tauri::command]
pub fn sync_resolve(_payload: Value) -> Value {
    json!({ "ok": true, "value": true })
}

#[tauri::command]
pub fn sync_devices() -> Value {
    json!({ "ok": true, "value": [] })
}

#[tauri::command]
pub fn sync_revoke(_device_id: String) -> Value {
    json!({ "ok": true, "value": true })
}

#[tauri::command]
pub fn sync_pause(_paused: bool) -> Value {
    json!({ "ok": true, "value": true })
}

// ── Exports, Clipboard, Links, Emoji & App Restart ─────────────────────────

#[tauri::command]
pub fn clipboard_write_text(text: String) -> Value {
    match arboard::Clipboard::new().and_then(|mut cb| cb.set_text(text)) {
        Ok(()) => json!({ "ok": true }),
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    }
}

#[tauri::command]
pub fn app_restart(app: AppHandle) {
    app.restart();
}

#[tauri::command]
pub fn emoji_get_native_font() -> Value {
    // macOS WKWebView natively paints Apple Color Emoji — returning null keeps native font rendering!
    json!({ "ok": true, "bytes": Value::Null })
}

#[tauri::command]
pub fn contact_open_email() -> Value {
    let _ = std::process::Command::new("open")
        .arg("mailto:support@bereanexamination.org")
        .spawn();
    json!({ "ok": true })
}

#[tauri::command]
pub fn external_link_open(target_url: String) -> Value {
    if target_url.starts_with("https://") || target_url.starts_with("http://") || target_url.starts_with("mailto:") {
        let _ = std::process::Command::new("open").arg(&target_url).spawn();
        json!({ "ok": true })
    } else {
        json!({ "ok": false, "error": "Blocked non-HTTP external URL." })
    }
}

#[tauri::command]
pub fn export_choose_file(state: State<'_, AppState>, payload: Value) -> Value {
    let file_name = payload
        .get("fileName")
        .and_then(|v| v.as_str())
        .unwrap_or("export.md");
    let Some(path) = rfd::FileDialog::new()
        .set_title("Save export")
        .set_file_name(file_name)
        .save_file()
    else {
        return json!({ "status": "canceled" });
    };
    let sel_id = uuid::Uuid::new_v4().to_string();
    state
        .export_selections
        .lock()
        .unwrap()
        .insert(sel_id.clone(), path);
    json!({ "status": "ready", "selectionId": sel_id })
}

#[tauri::command]
pub fn export_cancel_selection(state: State<'_, AppState>, payload: Value) -> Value {
    if let Some(sel_id) = payload.get("selectionId").and_then(|v| v.as_str()) {
        state.export_selections.lock().unwrap().remove(sel_id);
    }
    json!({ "ok": true })
}

#[tauri::command]
pub fn export_save_file(state: State<'_, AppState>, payload: Value) -> Value {
    let file_name = payload
        .get("fileName")
        .and_then(|v| v.as_str())
        .unwrap_or("export.bin");
    let bytes: Vec<u8> = payload
        .get("bytes")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|x| x.as_u64().map(|n| n as u8)).collect())
        .unwrap_or_default();

    let target = if let Some(sel_id) = payload.get("selectionId").and_then(|v| v.as_str()) {
        state.export_selections.lock().unwrap().remove(sel_id)
    } else {
        rfd::FileDialog::new()
            .set_title("Save export")
            .set_file_name(file_name)
            .save_file()
    };

    let Some(path) = target else {
        return json!({ "status": "canceled" });
    };
    match fs::write(&path, &bytes) {
        Ok(()) => json!({
            "status": "saved",
            "fileName": path.file_name().and_then(|s| s.to_str()).unwrap_or(file_name),
        }),
        Err(e) => json!({ "status": "failed", "error": e.to_string() }),
    }
}

#[tauri::command]
pub fn export_render_note_pdf(_payload: Value) -> Value {
    // Renderer falls back cleanly to window.print() / jsPDF when native headless PDF is not used
    json!({ "ok": false, "error": "Use client PDF export or Print to PDF." })
}

#[tauri::command]
pub fn export_read_pdf_image(state: State<'_, AppState>, payload: Value) -> Value {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let source = payload.get("source").and_then(|v| v.as_str()).unwrap_or("");
    let (lib_path, key) = {
        let vault = state.vault.lock().unwrap();
        match (&vault.library_path, vault.require_unlocked()) {
            (Some(p), Ok(k)) => (p.clone(), k),
            _ => return json!({ "ok": false, "error": "Vault locked." }),
        }
    };
    match read_media_for_protocol(&lib_path, &key, source, &state.media_cache) {
        Ok(cached) => {
            let b64 = STANDARD.encode(&cached.bytes);
            json!({
                "ok": true,
                "mimeType": cached.mime_type,
                "dataUrl": format!("data:{};base64,{}", cached.mime_type, b64),
            })
        }
        Err(e) => err_json(e),
    }
}

#[tauri::command]
pub async fn updater_check(app: AppHandle) -> Result<Value, String> {
    match crate::updater::check_and_prompt_update(app, true).await {
        Ok(update_available) => Ok(json!({ "ok": true, "updateAvailable": update_available })),
        Err(e) => Ok(json!({ "ok": false, "error": e })),
    }
}
