//! Loopback-Only (`127.0.0.1`) HTTP Vault & Frontend Bridge for Antigravity's Side Pane.
//!
//! Serves BEX's compiled `dist/` React app, decrypted `bex-media://` assets (with HTTP 206
//! byte ranges), and all `window.bexDesktop` RPC methods over `127.0.0.1:<ephemeral-port>`,
//! authenticated by a random per-session 256-bit token so no other local web page can call it.

use crate::ai_access::{ConceptualIndex, VaultGraph};
use crate::bible::BibleLibrary;
use crate::crypto::{random_bytes, CryptoError};
use crate::media::{
    delete_encrypted_image, parse_byte_range, read_media_for_protocol, save_encrypted_attachment,
    save_encrypted_image, MediaCache,
};
use crate::sheet_io::{export_xlsx_bytes, import_xlsx_bytes};
use crate::transplant::{export_brain_transplant, import_brain_transplant};
use crate::vault::{user_data_dir, VaultEngine};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;

const HTTP_BRIDGE_JS: &str = include_str!("http_bridge.js");

pub struct SharedBexCore {
    pub vault: VaultEngine,
    pub bible: BibleLibrary,
    pub media_cache: MediaCache,
    pub export_selections: HashMap<String, PathBuf>,
    pub scripture_key: Option<String>,
    pub index: ConceptualIndex,
    pub graph: VaultGraph,
}

impl SharedBexCore {
    pub fn init() -> Result<Self, String> {
        let mut vault = VaultEngine::new();
        if vault.library_path.is_none() {
            return Err(
                "No Berean Vault (berean.db) found. Open BEX.app once to select your Vault folder."
                    .to_string(),
            );
        }
        vault
            .unlock_automatic()
            .map_err(|e| format!("Failed to unlock BEX Vault ({}): {}", e.code, e.message))?;

        let app_res = PathBuf::from("/Applications/BEX.app/Contents/Resources");
        let res_dir = if app_res.is_dir() { Some(app_res) } else { None };
        let bible = BibleLibrary::new(res_dir);

        let index = ConceptualIndex::build(&vault.cache);
        let graph = VaultGraph::build(&vault.cache, &index);
        Ok(Self {
            vault,
            bible,
            media_cache: MediaCache::new(128),
            export_selections: HashMap::new(),
            scripture_key: load_saved_scripture_key(),
            index,
            graph,
        })
    }

    pub fn refresh_if_changed(&mut self) {
        if let Ok(true) = self.vault.sync_external_changes() {
            self.rebuild_indexes();
        }
    }

    pub fn rebuild_indexes(&mut self) {
        self.index = ConceptualIndex::build(&self.vault.cache);
        self.graph = VaultGraph::build(&self.vault.cache, &self.index);
    }
}

fn scripture_key_file() -> PathBuf {
    user_data_dir().join("bex-rust-scripture-key.txt")
}

fn load_saved_scripture_key() -> Option<String> {
    fs::read_to_string(scripture_key_file())
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

pub fn resolve_dist_dir() -> Option<PathBuf> {
    if let Ok(env_dir) = std::env::var("BEX_DIST_DIR") {
        let pb = PathBuf::from(env_dir);
        if pb.join("index.html").is_file() {
            return Some(pb);
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        let home_pb = PathBuf::from(&home);
        let local_share = home_pb.join(".local/share/bex-mcp/dist");
        if local_share.join("index.html").is_file() {
            return Some(local_share);
        }
        let cloud = home_pb.join("Library/CloudStorage");
        if let Ok(entries) = fs::read_dir(&cloud) {
            for e in entries.flatten() {
                let cand = e.path().join("My Drive/BEX/dist");
                if cand.join("index.html").is_file() {
                    return Some(cand);
                }
            }
        }
    }
    None
}

pub struct LoopbackServerHandle {
    pub port: u16,
    pub token: String,
}

impl LoopbackServerHandle {
    pub fn origin(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    pub fn route_url(&self, route: &str) -> String {
        let clean = if route.trim().is_empty() || !route.starts_with('/') {
            "/"
        } else {
            route.trim()
        };
        let sep = if clean.contains('?') { '&' } else { '?' };
        format!("http://127.0.0.1:{}{clean}{sep}bex_token={}", self.port, self.token)
    }
}

pub fn start_loopback_server(
    core: Arc<Mutex<SharedBexCore>>,
    dist_dir: PathBuf,
) -> Result<LoopbackServerHandle, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to bind 127.0.0.1 loopback server: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .port();
    let token: String = random_bytes::<24>()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    let token_clone = token.clone();
    let rt = Arc::new(
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .map_err(|e| format!("Tokio runtime init failed: {e}"))?,
    );

    thread::spawn(move || {
        for stream_res in listener.incoming() {
            let Ok(stream) = stream_res else { continue };
            let core_c = Arc::clone(&core);
            let dist_c = dist_dir.clone();
            let tok_c = token_clone.clone();
            let rt_c = Arc::clone(&rt);
            thread::spawn(move || {
                let _ = handle_connection(stream, core_c, &dist_c, &tok_c, &rt_c);
            });
        }
    });

    Ok(LoopbackServerHandle { port, token })
}

fn handle_connection(
    mut stream: TcpStream,
    core: Arc<Mutex<SharedBexCore>>,
    dist_dir: &Path,
    expected_token: &str,
    rt: &tokio::runtime::Runtime,
) -> std::io::Result<()> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut req_line = String::new();
    if reader.read_line(&mut req_line)? == 0 {
        return Ok(());
    }
    let mut parts = req_line.trim_end().split_whitespace();
    let method = parts.next().unwrap_or("GET").to_string();
    let target = parts.next().unwrap_or("/").to_string();

    let mut headers: HashMap<String, String> = HashMap::new();
    let mut content_len: usize = 0;
    loop {
        let mut hline = String::new();
        if reader.read_line(&mut hline)? == 0 {
            break;
        }
        let trimmed = hline.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }
        if let Some((k, v)) = trimmed.split_once(':') {
            let kl = k.trim().to_ascii_lowercase();
            let val = v.trim().to_string();
            if kl == "content-length" {
                content_len = val.parse().unwrap_or(0);
            }
            headers.insert(kl, val);
        }
    }

    // Cap request body at 64 MiB (supports image pastes / spreadsheet imports)
    let mut body = vec![0u8; content_len.min(64 * 1024 * 1024)];
    if !body.is_empty() {
        reader.read_exact(&mut body)?;
    }

    let (raw_path, raw_query) = match target.split_once('?') {
        Some((p, q)) => (p, q),
        None => (target.as_str(), ""),
    };
    let query_map: HashMap<String, String> = url::form_urlencoded::parse(raw_query.as_bytes())
        .into_owned()
        .collect();

    if method == "OPTIONS" {
        return write_http_response(
            &mut stream,
            204,
            "No Content",
            "text/plain",
            &[
                ("Access-Control-Allow-Origin", "*"),
                ("Access-Control-Allow-Methods", "GET, POST, HEAD, OPTIONS"),
                ("Access-Control-Allow-Headers", "Content-Type, X-Bex-Token, Range"),
            ],
            &[],
        );
    }

    if raw_path == "/__bex_health" {
        return write_http_response(
            &mut stream,
            200,
            "OK",
            "application/json",
            &[],
            b"{\"ok\":true}",
        );
    }

    // 1. Authenticated RPC Endpoint: POST /__bex_rpc/<cmd>
    if let Some(cmd) = raw_path.strip_prefix("/__bex_rpc/") {
        let hdr_tok = headers.get("x-bex-token").map(|s| s.as_str()).unwrap_or("");
        if hdr_tok != expected_token {
            return write_http_response(
                &mut stream,
                403,
                "Forbidden",
                "application/json",
                &[],
                b"{\"ok\":false,\"error\":\"Invalid session token.\"}",
            );
        }
        let args: Value = serde_json::from_slice(&body).unwrap_or_else(|_| json!({}));
        let result = dispatch_rpc(cmd, &args, &core, rt);
        let resp_bytes = serde_json::to_vec(&result).unwrap_or_else(|_| b"{}".to_vec());
        return write_http_response(
            &mut stream,
            200,
            "OK",
            "application/json; charset=utf-8",
            &[("Cache-Control", "no-store")],
            &resp_bytes,
        );
    }

    // 2. Authenticated Encrypted Vault Media: GET /__bex_media/<host>/<file>?t=<token>
    if let Some(media_rest) = raw_path.strip_prefix("/__bex_media/") {
        let tok = query_map.get("t").map(|s| s.as_str()).unwrap_or("");
        if tok != expected_token {
            return write_http_response(
                &mut stream,
                403,
                "Forbidden",
                "text/plain",
                &[],
                b"Forbidden",
            );
        }
        let reconstructed_uri = if let Some(thumb) = query_map.get("thumb") {
            format!("bex-media://{media_rest}?thumb={thumb}")
        } else {
            format!("bex-media://{media_rest}")
        };
        let media_res = {
            let mut guard = core.lock().unwrap();
            guard.refresh_if_changed();
            let lib_path = guard.vault.library_path.clone();
            let key_res = guard.vault.require_unlocked();
            match (lib_path, key_res) {
                (Some(lp), Ok(k)) => {
                    read_media_for_protocol(&lp, &k, &reconstructed_uri, &guard.media_cache)
                }
                _ => Err(CryptoError::new("BEX_PRIVACY_LOCKED", "Vault locked")),
            }
        };

        return match media_res {
            Ok(cached) => {
                let total = cached.bytes.len();
                let range_hdr = headers.get("range").map(|s| s.as_str());
                let etag = format!("\"{}\"", cached.etag);
                if let Some((start, end)) = parse_byte_range(range_hdr, total) {
                    let slice = if method == "HEAD" {
                        &[][..]
                    } else {
                        &cached.bytes[start..=end]
                    };
                    let cr = format!("bytes {start}-{end}/{total}");
                    write_http_response(
                        &mut stream,
                        206,
                        "Partial Content",
                        &cached.mime_type,
                        &[
                            ("Accept-Ranges", "bytes"),
                            ("Content-Range", &cr),
                            ("ETag", &etag),
                            ("Cache-Control", "private, max-age=3600"),
                        ],
                        slice,
                    )
                } else {
                    let payload = if method == "HEAD" {
                        &[][..]
                    } else {
                        cached.bytes.as_slice()
                    };
                    write_http_response(
                        &mut stream,
                        200,
                        "OK",
                        &cached.mime_type,
                        &[
                            ("Accept-Ranges", "bytes"),
                            ("ETag", &etag),
                            ("Cache-Control", "private, max-age=3600"),
                        ],
                        payload,
                    )
                }
            }
            Err(_) => write_http_response(
                &mut stream,
                404,
                "Not Found",
                "text/plain",
                &[],
                b"Media not found",
            ),
        };
    }

    // 3. Static Asset under `dist/` (JS, CSS, fonts, icons, licenses, pdfjs)
    let rel = raw_path.trim_start_matches('/');
    if !rel.is_empty() && !rel.contains("..") && rel != "index.html" {
        let candidate = dist_dir.join(rel);
        if candidate.is_file() {
            if let Ok(bytes) = fs::read(&candidate) {
                let mime = guess_mime(&candidate);
                let cache_ctl = if rel.starts_with("assets/") {
                    "public, max-age=31536000, immutable"
                } else {
                    "public, max-age=300"
                };
                return write_http_response(
                    &mut stream,
                    200,
                    "OK",
                    mime,
                    &[("Cache-Control", cache_ctl)],
                    &bytes,
                );
            }
        }
    }

    // 4. SPA Entrypoint (`index.html`) — requires `?bex_token=<token>` or `bex_session` cookie
    let cookie_tok = headers
        .get("cookie")
        .and_then(|c| {
            c.split(';')
                .find_map(|kv| kv.trim().strip_prefix("bex_session="))
        })
        .unwrap_or("");
    let query_tok = query_map.get("bex_token").map(|s| s.as_str()).unwrap_or("");
    if query_tok != expected_token && cookie_tok != expected_token {
        return write_http_response(
            &mut stream,
            403,
            "Forbidden",
            "text/html; charset=utf-8",
            &[],
            b"<!doctype html><html><body style='background:#0b0d11;color:#e2e8f0;font-family:system-ui;padding:32px'><h2>BEX Loopback Bridge</h2><p>Open BEX from Antigravity's side pane to authenticate this session.</p></body></html>",
        );
    }

    let index_html = fs::read_to_string(dist_dir.join("index.html"))
        .unwrap_or_else(|_| "<!doctype html><html><head></head><body>Missing dist/index.html</body></html>".to_string());
    let token_json = serde_json::to_string(expected_token).unwrap_or_else(|_| "\"\"".into());
    let injected = format!(
        "<script>window.__BEX_HTTP_TOKEN__={token_json};</script><script>{HTTP_BRIDGE_JS}</script>"
    );
    let final_html = if let Some(idx) = index_html.find("<head>") {
        let mut s = String::with_capacity(index_html.len() + injected.len() + 8);
        s.push_str(&index_html[..idx + 6]);
        s.push_str(&injected);
        s.push_str(&index_html[idx + 6..]);
        s
    } else {
        format!("{injected}{index_html}")
    };

    let set_cookie = format!("bex_session={expected_token}; Path=/; SameSite=Lax");
    write_http_response(
        &mut stream,
        200,
        "OK",
        "text/html; charset=utf-8",
        &[
            ("Cache-Control", "no-store"),
            ("Set-Cookie", &set_cookie),
        ],
        final_html.as_bytes(),
    )
}

fn write_http_response(
    stream: &mut TcpStream,
    status: u16,
    reason: &str,
    content_type: &str,
    extra_headers: &[(&str, &str)],
    body: &[u8],
) -> std::io::Result<()> {
    let mut head = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n",
        body.len()
    );
    for (k, v) in extra_headers {
        head.push_str(&format!("{k}: {v}\r\n"));
    }
    head.push_str("\r\n");
    stream.write_all(head.as_bytes())?;
    if !body.is_empty() {
        stream.write_all(body)?;
    }
    stream.flush()
}

fn guess_mime(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "js" | "mjs" | "cjs" => "application/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "html" | "htm" => "text/html; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "wasm" => "application/wasm",
        "txt" | "md" => "text/plain; charset=utf-8",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

fn err_json(e: CryptoError) -> Value {
    json!({
        "ok": false,
        "code": e.code,
        "error": e.message,
    })
}

fn parse_id(v: Option<&Value>) -> Option<i64> {
    v.and_then(|x| x.as_i64().or_else(|| x.as_str().and_then(|s| s.parse().ok())))
}

fn dispatch_rpc(
    cmd: &str,
    args: &Value,
    core: &Arc<Mutex<SharedBexCore>>,
    rt: &tokio::runtime::Runtime,
) -> Value {
    // Async API.Bible endpoints (release Mutex before network call)
    match cmd {
        "scripture_get_catalog" => {
            let key = core.lock().unwrap().scripture_key.clone();
            let Some(api_key) = key else {
                return json!({ "ok": false, "error": "API.Bible key not configured." });
            };
            return rt.block_on(async move {
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
                            return json!({ "ok": false, "error": format!("API.Bible returned HTTP {}.", status.as_u16()) });
                        }
                        match resp.json::<Value>().await {
                            Ok(data) => json!({ "ok": true, "result": { "data": data.get("data").cloned().unwrap_or(json!([])), "cached": false } }),
                            Err(e) => json!({ "ok": false, "error": e.to_string() }),
                        }
                    }
                    Err(e) => json!({ "ok": false, "error": e.to_string() }),
                }
            });
        }
        "scripture_get_books" => {
            let key = core.lock().unwrap().scripture_key.clone();
            let Some(api_key) = key else {
                return json!({ "ok": false, "error": "API.Bible key not configured." });
            };
            let bible_id = args
                .get("options")
                .and_then(|o| o.get("bibleId"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            return rt.block_on(async move {
                let client = reqwest::Client::new();
                match client
                    .get(format!("https://api.scripture.api.bible/v1/bibles/{bible_id}/books?include-chapters=true"))
                    .header("api-key", api_key)
                    .send()
                    .await
                {
                    Ok(resp) if resp.status().is_success() => match resp.json::<Value>().await {
                        Ok(data) => json!({ "ok": true, "result": { "data": data.get("data").cloned().unwrap_or(json!([])), "cached": false } }),
                        Err(e) => json!({ "ok": false, "error": e.to_string() }),
                    },
                    Ok(resp) => json!({ "ok": false, "error": format!("API.Bible returned HTTP {}.", resp.status().as_u16()) }),
                    Err(e) => json!({ "ok": false, "error": e.to_string() }),
                }
            });
        }
        "scripture_fetch_content" => {
            let key = core.lock().unwrap().scripture_key.clone();
            let Some(api_key) = key else {
                return json!({ "ok": false, "error": "API.Bible key not configured." });
            };
            let opts = args.get("options").cloned().unwrap_or(json!({}));
            let bible_id = opts.get("bibleId").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let kind = opts.get("type").and_then(|v| v.as_str()).unwrap_or("chapter").to_string();
            let item_id = opts
                .get("id")
                .or_else(|| opts.get("chapterId"))
                .or_else(|| opts.get("passageId"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let segment = match kind.as_str() {
                "passage" | "passages" => "passages",
                "verse" | "verses" => "verses",
                _ => "chapters",
            };
            return rt.block_on(async move {
                let client = reqwest::Client::new();
                match client
                    .get(format!(
                        "https://api.scripture.api.bible/v1/bibles/{bible_id}/{segment}/{item_id}?content-type=json&include-notes=true&include-titles=true&include-chapter-numbers=false&include-verse-numbers=true&include-verse-spans=false"
                    ))
                    .header("api-key", api_key)
                    .send()
                    .await
                {
                    Ok(resp) if resp.status().is_success() => match resp.json::<Value>().await {
                        Ok(data) => json!({
                            "ok": true,
                            "result": {
                                "data": data.get("data").cloned().unwrap_or(Value::Null),
                                "meta": data.get("meta").cloned().unwrap_or(Value::Null),
                                "cached": false,
                                "fetchedAt": chrono::Utc::now().timestamp_millis()
                            }
                        }),
                        Err(e) => json!({ "ok": false, "error": e.to_string() }),
                    },
                    Ok(resp) => json!({ "ok": false, "error": format!("API.Bible returned HTTP {}.", resp.status().as_u16()) }),
                    Err(e) => json!({ "ok": false, "error": e.to_string() }),
                }
            });
        }
        "scripture_search_words" => {
            let key = core.lock().unwrap().scripture_key.clone();
            let Some(api_key) = key else {
                return json!({ "ok": false, "error": "API.Bible key not configured." });
            };
            let opts = args.get("options").cloned().unwrap_or(json!({}));
            let bible_id = opts.get("bibleId").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let q = opts.get("query").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let limit = opts.get("limit").and_then(|v| v.as_u64()).unwrap_or(20).to_string();
            let offset = opts.get("offset").and_then(|v| v.as_u64()).unwrap_or(0).to_string();
            let sort = opts.get("sort").and_then(|v| v.as_str()).unwrap_or("").to_string();
            return rt.block_on(async move {
                let mut qp = vec![("query", q), ("limit", limit), ("offset", offset)];
                if !sort.is_empty() {
                    qp.push(("sort", sort));
                }
                let client = reqwest::Client::new();
                match client
                    .get(format!("https://api.scripture.api.bible/v1/bibles/{bible_id}/search"))
                    .query(&qp)
                    .header("api-key", api_key)
                    .send()
                    .await
                {
                    Ok(resp) if resp.status().is_success() => match resp.json::<Value>().await {
                        Ok(data) => json!({
                            "ok": true,
                            "result": {
                                "data": data.get("data").cloned().unwrap_or(Value::Null),
                                "meta": data.get("meta").cloned().unwrap_or(Value::Null)
                            }
                        }),
                        Err(e) => json!({ "ok": false, "error": e.to_string() }),
                    },
                    Ok(resp) => json!({ "ok": false, "error": format!("API.Bible search returned HTTP {}.", resp.status().as_u16()) }),
                    Err(e) => json!({ "ok": false, "error": e.to_string() }),
                }
            });
        }
        _ => {}
    }

    let mut guard = core.lock().unwrap();
    guard.refresh_if_changed();

    match cmd {
        "library_get_status" => json!({ "ok": true, "status": guard.vault.library_status() }),
        "library_choose" => {
            let Some(folder) = rfd::FileDialog::new()
                .set_title("Choose Berean Library (Vault) Folder")
                .pick_folder()
            else {
                return json!({ "ok": true, "canceled": true, "status": guard.vault.library_status() });
            };
            match guard.vault.open_library(&folder) {
                Ok(()) => {
                    guard.media_cache.clear();
                    let _ = guard.vault.unlock_automatic();
                    guard.rebuild_indexes();
                    json!({ "ok": true, "canceled": false, "status": guard.vault.library_status() })
                }
                Err(msg) => json!({ "ok": false, "canceled": false, "error": msg, "status": guard.vault.library_status() }),
            }
        }
        "privacy_get_status" => match guard.vault.privacy_status() {
            Ok(status) => json!({ "ok": true, "status": status }),
            Err(e) => err_json(e),
        },
        "privacy_unlock_automatic" => match guard.vault.unlock_automatic() {
            Ok(status) => json!({ "ok": true, "status": status }),
            Err(e) => err_json(e),
        },
        "privacy_unlock_pin" => {
            let pin = args.get("pin").and_then(|v| v.as_str()).unwrap_or("");
            match guard.vault.unlock_with_pin(pin) {
                Ok(status) => {
                    guard.rebuild_indexes();
                    json!({ "ok": true, "status": status })
                }
                Err(e) => err_json(e),
            }
        }
        "privacy_unlock_recovery" => {
            let code = args.get("recoveryCode").and_then(|v| v.as_str()).unwrap_or("");
            match guard.vault.unlock_with_recovery(code) {
                Ok(status) => {
                    guard.rebuild_indexes();
                    json!({ "ok": true, "status": status })
                }
                Err(e) => err_json(e),
            }
        }
        "privacy_enable_pin" => {
            let pin = args.get("pin").and_then(|v| v.as_str()).unwrap_or("");
            match guard.vault.enable_pin(pin) {
                Ok((rc, status)) => json!({ "ok": true, "recoveryCode": rc, "status": status }),
                Err(e) => err_json(e),
            }
        }
        "privacy_change_pin" => {
            let pin = args.get("pin").and_then(|v| v.as_str()).unwrap_or("");
            match guard.vault.change_pin(pin) {
                Ok(status) => json!({ "ok": true, "status": status }),
                Err(e) => err_json(e),
            }
        }
        "privacy_disable_pin" => match guard.vault.disable_pin() {
            Ok(status) => json!({ "ok": true, "status": status }),
            Err(e) => err_json(e),
        },
        "privacy_replace_recovery" => match guard.vault.replace_recovery() {
            Ok((rc, status)) => json!({ "ok": true, "recoveryCode": rc, "status": status }),
            Err(e) => err_json(e),
        },
        "local_owner_get" => match guard.vault.get_local_owner() {
            Ok(owner) => json!({ "ok": true, "owner": owner }),
            Err(e) => err_json(e),
        },
        "local_owner_update" => {
            let patch = args.get("patch").cloned().unwrap_or(json!({}));
            match guard.vault.update_local_owner(&patch) {
                Ok(owner) => json!({ "ok": true, "owner": owner }),
                Err(e) => err_json(e),
            }
        }
        "local_entity_list" => {
            let et = args.get("entityType").and_then(|v| v.as_str()).unwrap_or("");
            let q = args.get("query").cloned().unwrap_or(json!({}));
            match guard.vault.list_entities(et, &q) {
                Ok(records) => json!({ "ok": true, "records": records }),
                Err(e) => err_json(e),
            }
        }
        "local_entity_get" => {
            let et = args.get("entityType").and_then(|v| v.as_str()).unwrap_or("");
            let Some(id) = parse_id(args.get("entityId")) else {
                return json!({ "ok": false, "code": "BEX_ENTITY_INVALID", "error": "Invalid record ID." });
            };
            match guard.vault.get_entity(et, id) {
                Ok(record) => json!({ "ok": true, "record": record }),
                Err(e) => err_json(e),
            }
        }
        "local_entity_create" => {
            let et = args.get("entityType").and_then(|v| v.as_str()).unwrap_or("");
            let val = args.get("value").cloned().unwrap_or(json!({}));
            match guard.vault.create_entity(et, &val) {
                Ok(record) => {
                    guard.rebuild_indexes();
                    json!({ "ok": true, "record": record })
                }
                Err(e) => err_json(e),
            }
        }
        "local_entity_update" => {
            let et = args.get("entityType").and_then(|v| v.as_str()).unwrap_or("");
            let Some(id) = parse_id(args.get("entityId")) else {
                return json!({ "ok": false, "code": "BEX_ENTITY_INVALID", "error": "Invalid record ID." });
            };
            let patch = args.get("patch").cloned().unwrap_or(json!({}));
            match guard.vault.update_entity(et, id, &patch) {
                Ok(record) => {
                    guard.rebuild_indexes();
                    json!({ "ok": true, "record": record })
                }
                Err(e) => err_json(e),
            }
        }
        "local_entity_delete" => {
            let et = args.get("entityType").and_then(|v| v.as_str()).unwrap_or("");
            let Some(id) = parse_id(args.get("entityId")) else {
                return json!({ "ok": false, "code": "BEX_ENTITY_INVALID", "error": "Invalid record ID." });
            };
            match guard.vault.delete_entity(et, id) {
                Ok(result) => {
                    guard.rebuild_indexes();
                    json!({ "ok": true, "result": result })
                }
                Err(e) => err_json(e),
            }
        }
        "local_entity_reorder" => {
            let et = args.get("entityType").and_then(|v| v.as_str()).unwrap_or("");
            let ids: Vec<i64> = args
                .get("entityIds")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|x| parse_id(Some(x))).collect())
                .unwrap_or_default();
            let cid = parse_id(args.get("containerId"));
            match guard.vault.reorder_entities(et, &ids, cid) {
                Ok(records) => {
                    guard.rebuild_indexes();
                    json!({ "ok": true, "records": records })
                }
                Err(e) => err_json(e),
            }
        }
        "local_entity_snapshot" => {
            let types: Option<Vec<String>> = args
                .get("entityTypes")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|s| s.as_str().map(|x| x.to_string())).collect());
            match guard.vault.read_snapshot(types.as_deref()) {
                Ok(snapshot) => json!({ "ok": true, "snapshot": snapshot }),
                Err(e) => err_json(e),
            }
        }
        "local_entity_import_knowledge_web_graph" => {
            let Some(wid) = parse_id(args.get("webId")) else {
                return json!({ "ok": false, "code": "BEX_ENTITY_INVALID", "error": "Invalid web ID." });
            };
            let iv = args.get("importValue").cloned().unwrap_or(json!({}));
            let opts = args.get("options").cloned().unwrap_or(json!({}));
            match guard.vault.import_knowledge_web_graph(wid, &iv, &opts) {
                Ok(res) => {
                    guard.rebuild_indexes();
                    json!({ "ok": true, "result": res })
                }
                Err(e) => err_json(e),
            }
        }
        "local_entity_restore_knowledge_web_graph" => {
            let Some(wid) = parse_id(args.get("webId")) else {
                return json!({ "ok": false, "code": "BEX_ENTITY_INVALID", "error": "Invalid web ID." });
            };
            let snap = args.get("snapshot").cloned().unwrap_or(json!({}));
            match guard.vault.restore_knowledge_web_graph(wid, &snap) {
                Ok(res) => {
                    guard.rebuild_indexes();
                    json!({ "ok": true, "snapshot": res })
                }
                Err(e) => err_json(e),
            }
        }
        "search_global_library" => {
            let q = args.get("query").and_then(|v| v.as_str()).unwrap_or("");
            let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(60).clamp(1, 200) as usize;
            match guard.vault.search_global(q, limit) {
                Ok(results) => json!({ "ok": true, "results": results }),
                Err(e) => err_json(e),
            }
        }
        "brain_transplant_export" => {
            let Some(dest) = rfd::FileDialog::new()
                .set_title("Export BEX Brain Transplant (.bexbrain)")
                .set_file_name(&format!("bex-vault-{}.bexbrain", chrono::Local::now().format("%Y-%m-%d")))
                .add_filter("BEX Brain Transplant", &["bexbrain"])
                .save_file()
            else {
                return json!({ "ok": false, "canceled": true });
            };
            let (Some(ref lp), Some(ref conn)) = (&guard.vault.library_path, &guard.vault.conn) else {
                return json!({ "ok": false, "error": "No Berean Library is open." });
            };
            match export_brain_transplant(lp, conn, &dest) {
                Ok(res) => res,
                Err(e) => json!({ "ok": false, "error": e }),
            }
        }
        "brain_transplant_import" => {
            let Some(src) = rfd::FileDialog::new()
                .set_title("Choose BEX Brain Transplant (.bexbrain)")
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
                    let _ = guard.vault.open_library(&target_dir);
                    let _ = guard.vault.unlock_automatic();
                    guard.media_cache.clear();
                    guard.rebuild_indexes();
                    res
                }
                Err(e) => json!({ "ok": false, "error": e }),
            }
        }
        "sheet_import_xlsx_fast" => {
            let bytes: Vec<u8> = args
                .get("bytes")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|x| x.as_u64().map(|n| n as u8)).collect())
                .unwrap_or_default();
            let name = args.get("fileName").and_then(|v| v.as_str()).unwrap_or("workbook.xlsx");
            match import_xlsx_bytes(&bytes, name) {
                Ok(data) => json!({ "ok": true, "data": data }),
                Err(e) => json!({ "ok": false, "error": e }),
            }
        }
        "sheet_export_xlsx_fast" => {
            let wb = args.get("workbook").cloned().unwrap_or(json!({}));
            match export_xlsx_bytes(&wb) {
                Ok(bytes) => json!({ "ok": true, "bytes": bytes }),
                Err(e) => json!({ "ok": false, "error": e }),
            }
        }
        "local_media_save_image" => {
            let (Some(lp), Ok(key)) = (guard.vault.library_path.clone(), guard.vault.require_unlocked()) else {
                return json!({ "ok": false, "code": "BEX_PRIVACY_LOCKED", "error": "Vault locked." });
            };
            let bytes: Vec<u8> = args
                .get("payload")
                .and_then(|p| p.get("bytes"))
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|x| x.as_u64().map(|n| n as u8)).collect())
                .unwrap_or_default();
            match save_encrypted_image(&lp, &key, &bytes, &guard.media_cache) {
                Ok(media) => json!({ "ok": true, "media": media }),
                Err(e) => err_json(e),
            }
        }
        "local_media_delete_image" => {
            let (Some(lp), Ok(_)) = (guard.vault.library_path.clone(), guard.vault.require_unlocked()) else {
                return json!({ "ok": false, "code": "BEX_PRIVACY_LOCKED", "error": "Vault locked." });
            };
            let url = args.get("mediaUrl").and_then(|v| v.as_str()).unwrap_or("");
            match delete_encrypted_image(&lp, url, &guard.media_cache) {
                Ok(res) => json!({ "ok": true, "result": res }),
                Err(e) => err_json(e),
            }
        }
        "local_attachments_import" => {
            let (Some(lp), Ok(key)) = (guard.vault.library_path.clone(), guard.vault.require_unlocked()) else {
                return json!({ "ok": false, "code": "BEX_PRIVACY_LOCKED", "error": "Vault locked." });
            };
            let Some(paths) = rfd::FileDialog::new().set_title("Add Files to Note").pick_files() else {
                return json!({ "ok": true, "canceled": true, "attachments": [] });
            };
            let mut saved = Vec::new();
            for p in paths {
                match save_encrypted_attachment(&lp, &key, &p) {
                    Ok(att) => saved.push(att),
                    Err(e) => return err_json(e),
                }
            }
            json!({ "ok": true, "canceled": false, "attachments": saved })
        }
        "local_attachments_open" => {
            let (Some(lp), Ok(key)) = (guard.vault.library_path.clone(), guard.vault.require_unlocked()) else {
                return json!({ "ok": false, "code": "BEX_PRIVACY_LOCKED", "error": "Vault locked." });
            };
            let media_url = args.get("mediaUrl").and_then(|v| v.as_str()).unwrap_or("");
            match read_media_for_protocol(&lp, &key, media_url, &guard.media_cache) {
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
        "local_bible_get_chapter" => {
            let req = args.get("request").cloned().unwrap_or(json!({}));
            let ver = req.get("version").and_then(|v| v.as_str()).unwrap_or("");
            let book = req.get("book").and_then(|v| v.as_str()).unwrap_or("");
            let ch = parse_id(req.get("chapter")).unwrap_or(0);
            match guard.bible.read_bible_chapter(ver, book, ch) {
                Ok(chapter) => json!({ "ok": true, "chapter": chapter }),
                Err((code, msg)) => json!({ "ok": false, "code": code, "error": msg }),
            }
        }
        "local_mam_get_chapter" => {
            let req = args.get("request").cloned().unwrap_or(json!({}));
            let book = req.get("book").and_then(|v| v.as_str()).unwrap_or("");
            let ch = parse_id(req.get("chapter")).unwrap_or(0);
            match guard.bible.read_mam_chapter(book, ch) {
                Ok(chapter) => json!({ "ok": true, "chapter": chapter }),
                Err((code, msg)) => json!({ "ok": false, "code": code, "error": msg }),
            }
        }
        "scripture_get_status" => json!({
            "ok": true,
            "status": {
                "configured": guard.scripture_key.is_some(),
                "protectedStorageAvailable": true
            }
        }),
        "scripture_save_key" => {
            let trimmed = args.get("key").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
            if trimmed.is_empty() {
                return json!({ "ok": false, "error": "Paste a valid API.Bible key." });
            }
            let _ = fs::create_dir_all(user_data_dir());
            let _ = fs::write(scripture_key_file(), &trimmed);
            guard.scripture_key = Some(trimmed);
            json!({ "ok": true, "status": { "configured": true, "protectedStorageAvailable": true } })
        }
        "scripture_clear_key" => {
            let _ = fs::remove_file(scripture_key_file());
            guard.scripture_key = None;
            json!({ "ok": true, "status": { "configured": false, "protectedStorageAvailable": true } })
        }
        "scripture_cancel_request" => json!({ "ok": true }),
        "scripture_get_usage" => json!({ "ok": true, "result": { "totalRequests": 0, "requestsToday": 0 } }),
        "courses_list" => json!({ "ok": true, "library": { "courses": [], "catalog": null } }),
        "courses_install_package" | "courses_connect_local_catalog" => json!({ "ok": true, "canceled": true }),
        "courses_install_catalog_course" => json!({ "ok": false, "error": "Connect a local course catalog first." }),
        "courses_cancel_catalog_course" => json!({ "ok": true, "paused": false }),
        "courses_save_progress" => json!({ "ok": true, "progress": args.get("progress").cloned().unwrap_or(Value::Null) }),
        "sync_status" => json!({
            "ok": true,
            "value": { "enabled": false, "paused": false, "busy": false, "locked": false, "pending": 0, "devices": [], "conflicts": [] }
        }),
        "sync_enable" => json!({ "ok": false, "error": "Configure a sync relay to enable cloud mailbox sync." }),
        "sync_now" => json!({ "ok": true, "value": { "synced": false } }),
        "sync_invite" => json!({ "ok": false, "error": "Sync is not enabled yet." }),
        "sync_conflicts" | "sync_devices" => json!({ "ok": true, "value": [] }),
        "sync_resolve" | "sync_revoke" | "sync_pause" => json!({ "ok": true, "value": true }),
        "clipboard_write_text" => {
            let text = args.get("text").and_then(|v| v.as_str()).unwrap_or("").to_string();
            match arboard::Clipboard::new().and_then(|mut cb| cb.set_text(text)) {
                Ok(()) => json!({ "ok": true }),
                Err(e) => json!({ "ok": false, "error": e.to_string() }),
            }
        }
        "emoji_get_native_font" => json!({ "ok": true, "bytes": Value::Null }),
        "contact_open_email" => {
            let _ = std::process::Command::new("open").arg("mailto:support@bereanexamination.org").spawn();
            json!({ "ok": true })
        }
        "external_link_open" => {
            let target = args.get("targetUrl").and_then(|v| v.as_str()).unwrap_or("");
            if target.starts_with("https://") || target.starts_with("http://") || target.starts_with("mailto:") {
                let _ = std::process::Command::new("open").arg(target).spawn();
                json!({ "ok": true })
            } else {
                json!({ "ok": false, "error": "Blocked non-HTTP external URL." })
            }
        }
        "export_choose_file" => {
            let file_name = args
                .get("payload")
                .and_then(|p| p.get("fileName"))
                .and_then(|v| v.as_str())
                .unwrap_or("export.md");
            let Some(path) = rfd::FileDialog::new().set_title("Save export").set_file_name(file_name).save_file() else {
                return json!({ "status": "canceled" });
            };
            let sel_id = uuid::Uuid::new_v4().to_string();
            guard.export_selections.insert(sel_id.clone(), path);
            json!({ "status": "ready", "selectionId": sel_id })
        }
        "export_cancel_selection" => {
            if let Some(sel_id) = args.get("payload").and_then(|p| p.get("selectionId")).and_then(|v| v.as_str()) {
                guard.export_selections.remove(sel_id);
            }
            json!({ "ok": true })
        }
        "export_save_file" => {
            let payload = args.get("payload").cloned().unwrap_or(json!({}));
            let file_name = payload.get("fileName").and_then(|v| v.as_str()).unwrap_or("export.bin");
            let bytes: Vec<u8> = payload
                .get("bytes")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|x| x.as_u64().map(|n| n as u8)).collect())
                .unwrap_or_default();
            let target = if let Some(sel_id) = payload.get("selectionId").and_then(|v| v.as_str()) {
                guard.export_selections.remove(sel_id)
            } else {
                rfd::FileDialog::new().set_title("Save export").set_file_name(file_name).save_file()
            };
            let Some(path) = target else {
                return json!({ "status": "canceled" });
            };
            match fs::write(&path, &bytes) {
                Ok(()) => json!({ "status": "saved", "fileName": path.file_name().and_then(|s| s.to_str()).unwrap_or(file_name) }),
                Err(e) => json!({ "status": "failed", "error": e.to_string() }),
            }
        }
        "export_render_note_pdf" => json!({ "ok": false, "error": "Use Print to PDF or open in BEX.app for PDF export." }),
        "export_read_pdf_image" => {
            let source = args.get("payload").and_then(|p| p.get("source")).and_then(|v| v.as_str()).unwrap_or("");
            let (Some(lp), Ok(key)) = (guard.vault.library_path.clone(), guard.vault.require_unlocked()) else {
                return json!({ "ok": false, "error": "Vault locked." });
            };
            match read_media_for_protocol(&lp, &key, source, &guard.media_cache) {
                Ok(cached) => json!({
                    "ok": true,
                    "mimeType": cached.mime_type,
                    "dataUrl": format!("data:{};base64,{}", cached.mime_type, B64.encode(&cached.bytes)),
                }),
                Err(e) => err_json(e),
            }
        }
        _ => json!({ "ok": false, "error": format!("Unknown RPC command: {cmd}") }),
    }
}
