//! BEX Native MCP Server (`bex-mcp`) — Direct, Live, Encrypted-Vault Access for Antigravity.
//!
//! Speaks newline-delimited JSON-RPC 2.0 (Model Context Protocol 2024-11-05 / 2025-03-26)
//! over stdin/stdout, reusing `bex_tauri_lib` (`vault`, `crypto`, `search`, `bible`, `ai_access`).
//!
//! - Unlocks `berean.db` silently via BEX's macOS Keychain key (`org.bereanexamination.bex.vault`).
//! - Automatically syncs live edits made in `BEX.app` via SQLite `PRAGMA data_version` (~20µs).
//! - Keeps Vault 100% AES-256-GCM encrypted at rest and respects password-locked private webs.
//! - Exposes 16 tools + 4 resources for deep theological analysis, verse commentary retrieval,
//!   hybrid FTS5 + conceptual search, cross-reference graph traversal, and safe additive drafting.

use bex_tauri_lib::ai_access::{
    bible_ref_overlaps, canonical_book_name, format_passage_label, is_private_web, json_id_str,
    json_scalar_to_string, markdown_to_html, parse_bible_reference, rich_html_to_markdown,
    split_book_pages_detailed, str_field, BibleRef, PAGE_BREAK_SENTINEL,
};
use bex_tauri_lib::http_bridge::{
    resolve_dist_dir, start_loopback_server, LoopbackServerHandle, SharedBexCore,
};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::{self, BufRead, Write};
use std::process::Command;
use std::sync::{Arc, Mutex};

const SERVER_NAME: &str = "bex";
const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");
const PANE_URI: &str = "ui://bex/pane.html";
const PANE_SHELL_HTML: &str = include_str!("../pane_shell.html");

const SERVER_INSTRUCTIONS: &str = "\
You are connected directly to the user's live, AES-256 encrypted BEX (Berean Examination) \
theological research Vault. Use these tools to retrieve exact Scripture commentaries, Notes, \
multi-page Books, Knowledge Webs (with directed argument graphs), Timelines, Spreadsheets, \
Keywords, and offline Bible translations (20 English/Greek versions + MAM Hebrew).\n\
\n\
Best practices:\n\
- To open the full interactive BEX app inside Antigravity's side pane right next to the chat, \
call `bex_open_pane` (optionally passing `route`, `book`, `chapter`, `verse`).\n\
- For theological stance & consistency checks (e.g. 'give me my stance on X and check if my \
Matthew 4:9 commentary is consistent with Y'), start with `bex_theological_dossier` and \
`bex_get_commentary`.\n\
- Always cite exact BEX Source IDs (`note:12`, `commentary:42`, `web:5/card:99`, `keyword:7`) \
and distinguish the user's original commentary from quoted Scripture.\n\
- Use `bex_get_connections` to verify linked arguments across Knowledge Webs, MindLinks, \
StudyConnections, and shared verse citations.\n\
- Write tools (`bex_create_note`, `bex_append_to_note`, `bex_create_commentary`, \
`bex_create_web_card`) are additive and write encrypted records directly into `berean.db`.";

struct McpHost {
    core: Arc<Mutex<SharedBexCore>>,
    loopback: Option<LoopbackServerHandle>,
}

impl McpHost {
    fn init(start_http: bool) -> Result<Self, String> {
        let core = Arc::new(Mutex::new(SharedBexCore::init()?));
        let loopback = if start_http {
            match resolve_dist_dir() {
                Some(dist_dir) => match start_loopback_server(Arc::clone(&core), dist_dir) {
                    Ok(handle) => Some(handle),
                    Err(e) => {
                        eprintln!("[bex-mcp] loopback HTTP bridge unavailable: {e}");
                        None
                    }
                },
                None => {
                    eprintln!("[bex-mcp] dist/ directory not found; side-pane UI unavailable.");
                    None
                }
            }
        } else {
            None
        };
        Ok(Self { core, loopback })
    }

    fn resolve_pane_route(args: &Value) -> String {
        if let Some(r) = args.get("route").or_else(|| args.get("path")).and_then(|v| v.as_str()) {
            let t = r.trim();
            if t.starts_with('/') {
                return t.to_string();
            }
        }
        if let Some(book_raw) = args.get("book").and_then(|v| v.as_str()) {
            let book = canonical_book_name(book_raw).unwrap_or(book_raw);
            let ch = args.get("chapter").and_then(|v| v.as_i64()).unwrap_or(1);
            let v = args.get("verse").and_then(|v| v.as_i64());
            let passage = format_passage_label(book, ch, v, v);
            return format!("/Study?q={}", passage.replace(' ', "%20"));
        }
        if let Some(q) = args.get("query").and_then(|v| v.as_str()) {
            if !q.trim().is_empty() {
                return format!("/Study?q={}", q.trim().replace(' ', "%20"));
            }
        }
        "/".to_string()
    }

    fn pane_meta(&self) -> Value {
        let frame_domains = match &self.loopback {
            Some(lb) => json!([lb.origin()]),
            None => json!([]),
        };
        json!({
            "ui": {
                "prefersBorder": false,
                "csp": {
                    "frameDomains": frame_domains
                }
            }
        })
    }

    fn pane_html(&self) -> Result<String, String> {
        let Some(ref lb) = self.loopback else {
            return Err("BEX loopback HTTP bridge is not running (missing dist/ folder).".into());
        };
        let initial_url_json = serde_json::to_string(&lb.route_url("/")).unwrap_or_else(|_| "\"\"".into());
        let origin_json = serde_json::to_string(&lb.origin()).unwrap_or_else(|_| "\"\"".into());
        Ok(PANE_SHELL_HTML
            .replace("__BEX_INITIAL_URL_JSON__", &initial_url_json)
            .replace("__BEX_ORIGIN_JSON__", &origin_json))
    }

    fn handle_tool_call(&self, name: &str, args: &Value) -> Value {
        if name == "bex_open_pane" {
            let Some(ref lb) = self.loopback else {
                return json!({
                    "content": [{ "type": "text", "text": "BEX side pane is unavailable because dist/ was not found. Build BEX first." }],
                    "isError": true
                });
            };
            let route = Self::resolve_pane_route(args);
            let url = lb.route_url(&route);
            let origin = lb.origin();
            return json!({
                "content": [{
                    "type": "text",
                    "text": format!("Opened BEX in the Antigravity side pane at route `{route}` (connected live to your encrypted Vault).")
                }],
                "structuredContent": {
                    "url": url,
                    "route": route,
                    "origin": origin
                },
                "isError": false
            });
        }

        let mut guard = self.core.lock().unwrap();
        match guard.call_tool(name, args) {
            Ok(result_val) => json!({
                "content": [{
                    "type": "text",
                    "text": serde_json::to_string_pretty(&result_val).unwrap_or_default()
                }],
                "isError": false
            }),
            Err(err_msg) => json!({
                "content": [{ "type": "text", "text": err_msg }],
                "isError": true
            }),
        }
    }

    fn handle_resource_read(&self, uri: &str) -> Result<Value, String> {
        if uri == PANE_URI {
            let html = self.pane_html()?;
            return Ok(json!({
                "contents": [{
                    "uri": PANE_URI,
                    "mimeType": "text/html;profile=mcp-app",
                    "text": html,
                    "_meta": self.pane_meta()
                }]
            }));
        }
        let mut guard = self.core.lock().unwrap();
        guard.read_resource(uri)
    }
}

trait BexMcpOps {
    fn tool_library_overview(&self) -> Value;
    fn tool_search(&self, args: &Value) -> Result<Value, String>;
    fn tool_get_commentary(&mut self, args: &Value) -> Result<Value, String>;
    fn read_bible_excerpt(
        &mut self,
        book: &str,
        chapter: i64,
        start_verse: Option<i64>,
        end_verse: Option<i64>,
        version: &str,
        include_hebrew: bool,
    ) -> Result<Value, String>;
    fn tool_get_bible_passage(&mut self, args: &Value) -> Result<Value, String>;
    fn tool_get_note(&self, args: &Value) -> Result<Value, String>;
    fn tool_get_knowledge_web(&self, args: &Value) -> Result<Value, String>;
    fn tool_get_keywords(&self, args: &Value) -> Value;
    fn tool_get_timeline(&self, args: &Value) -> Result<Value, String>;
    fn tool_get_spreadsheet(&self, args: &Value) -> Result<Value, String>;
    fn tool_get_connections(&self, args: &Value) -> Result<Value, String>;
    fn tool_theological_dossier(&mut self, args: &Value) -> Result<Value, String>;
    fn tool_create_note(&mut self, args: &Value) -> Result<Value, String>;
    fn tool_append_to_note(&mut self, args: &Value) -> Result<Value, String>;
    fn tool_update_note(&mut self, args: &Value) -> Result<Value, String>;
    fn tool_create_commentary(&mut self, args: &Value) -> Result<Value, String>;
    fn tool_update_commentary(&mut self, args: &Value) -> Result<Value, String>;
    fn tool_upsert_study_chapter(&mut self, args: &Value) -> Result<Value, String>;
    fn tool_create_knowledge_web(&mut self, args: &Value) -> Result<Value, String>;
    fn tool_create_web_card(&mut self, args: &Value) -> Result<Value, String>;
    fn tool_update_web_card(&mut self, args: &Value) -> Result<Value, String>;
    fn tool_manage_web_connection(&mut self, args: &Value) -> Result<Value, String>;
    fn tool_upsert_keyword(&mut self, args: &Value) -> Result<Value, String>;
    fn tool_upsert_timeline(&mut self, args: &Value) -> Result<Value, String>;
    fn tool_upsert_spreadsheet(&mut self, args: &Value) -> Result<Value, String>;
    fn tool_manage_folder(&mut self, args: &Value) -> Result<Value, String>;
    fn tool_create_mind_link(&mut self, args: &Value) -> Result<Value, String>;
    fn tool_delete_entity(&mut self, args: &Value) -> Result<Value, String>;
    fn tool_open_in_bex(&self, args: &Value) -> Result<Value, String>;
    fn call_tool(&mut self, name: &str, args: &Value) -> Result<Value, String>;
    fn read_resource(&mut self, uri: &str) -> Result<Value, String>;
}

impl BexMcpOps for SharedBexCore {
    // ── Tool Implementations ───────────────────────────────────────────────

    fn tool_library_overview(&self) -> Value {
        let cache = &self.vault.cache;
        let folders: HashMap<i64, String> = cache
            .get("WebFolder")
            .map(|v| v.as_slice())
            .unwrap_or(&[])
            .iter()
            .filter_map(|f| {
                let id = f.get("id").and_then(|v| v.as_i64())?;
                let name = f
                    .get("title")
                    .or_else(|| f.get("name"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("Folder")
                    .to_string();
                Some((id, name))
            })
            .collect();

        let folder_name = |rec: &Value| -> Option<String> {
            rec.get("folder_id")
                .and_then(|v| v.as_i64())
                .and_then(|fid| folders.get(&fid).cloned())
        };

        let notes: Vec<Value> = cache
            .get("MindNote")
            .map(|v| v.as_slice())
            .unwrap_or(&[])
            .iter()
            .map(|n| {
                let id = n.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
                let title = n.get("title").and_then(|v| v.as_str()).unwrap_or("Untitled Note");
                let content = n.get("content").and_then(|v| v.as_str()).unwrap_or("");
                let pages = split_book_pages_detailed(content, title);
                json!({
                    "source_id": format!("note:{id}"),
                    "id": id,
                    "title": title,
                    "pages": pages.len(),
                    "folder": folder_name(n),
                    "updated_date": str_field(n, "updated_date"),
                })
            })
            .collect();

        let cards_by_web: HashMap<i64, usize> = {
            let mut m = HashMap::new();
            for c in cache.get("WebCard").map(|v| v.as_slice()).unwrap_or(&[]) {
                if let Some(wid) = c.get("web_id").and_then(|v| v.as_i64()) {
                    *m.entry(wid).or_insert(0) += 1;
                }
            }
            m
        };
        let conns_by_web: HashMap<i64, usize> = {
            let mut m = HashMap::new();
            for c in cache.get("WebConnection").map(|v| v.as_slice()).unwrap_or(&[]) {
                if let Some(wid) = c.get("web_id").and_then(|v| v.as_i64()) {
                    *m.entry(wid).or_insert(0) += 1;
                }
            }
            m
        };

        let webs: Vec<Value> = cache
            .get("KnowledgeWeb")
            .map(|v| v.as_slice())
            .unwrap_or(&[])
            .iter()
            .map(|w| {
                let id = w.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
                let private = is_private_web(w);
                let title = if private {
                    "(Private Password-Locked Knowledge Web)"
                } else {
                    w.get("title").and_then(|v| v.as_str()).unwrap_or("Knowledge Web")
                };
                json!({
                    "source_id": format!("web:{id}"),
                    "id": id,
                    "title": title,
                    "is_private": private,
                    "card_count": cards_by_web.get(&id).copied().unwrap_or(0),
                    "connection_count": conns_by_web.get(&id).copied().unwrap_or(0),
                    "folder": folder_name(w),
                    "updated_date": str_field(w, "updated_date"),
                })
            })
            .collect();

        let timelines: Vec<Value> = cache
            .get("Timegraph")
            .map(|v| v.as_slice())
            .unwrap_or(&[])
            .iter()
            .map(|t| {
                let id = t.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
                let ev_count = t.get("events").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
                json!({
                    "source_id": format!("timeline:{id}"),
                    "id": id,
                    "title": t.get("title").and_then(|v| v.as_str()).unwrap_or("Timeline"),
                    "event_count": ev_count,
                    "folder": folder_name(t),
                    "updated_date": str_field(t, "updated_date"),
                })
            })
            .collect();

        let spreadsheets: Vec<Value> = cache
            .get("Spreadsheet")
            .map(|v| v.as_slice())
            .unwrap_or(&[])
            .iter()
            .map(|s| {
                let id = s.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
                let sheet_names: Vec<&str> = s
                    .get("workbook")
                    .and_then(|w| w.get("sheets"))
                    .and_then(|a| a.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|sh| sh.get("name").and_then(|v| v.as_str()))
                            .collect()
                    })
                    .unwrap_or_default();
                json!({
                    "source_id": format!("spreadsheet:{id}"),
                    "id": id,
                    "title": s.get("title").and_then(|v| v.as_str()).unwrap_or("Spreadsheet"),
                    "sheets": sheet_names,
                    "folder": folder_name(s),
                    "updated_date": str_field(s, "updated_date"),
                })
            })
            .collect();

        let keywords: Vec<Value> = cache
            .get("Keyword")
            .map(|v| v.as_slice())
            .unwrap_or(&[])
            .iter()
            .map(|k| {
                let id = k.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
                json!({
                    "source_id": format!("keyword:{id}"),
                    "id": id,
                    "title": k.get("title").and_then(|v| v.as_str()).unwrap_or("Keyword"),
                    "category": str_field(k, "category"),
                })
            })
            .collect();

        // Bible commentary index grouped by canonical book -> chapter -> count + verse list
        let mut bible_index: BTreeMap<String, BTreeMap<i64, Vec<String>>> = BTreeMap::new();
        let annotations = cache.get("Annotation").map(|v| v.as_slice()).unwrap_or(&[]);
        for ann in annotations {
            let raw_book = ann.get("book").and_then(|v| v.as_str()).unwrap_or("Unknown");
            let book = canonical_book_name(raw_book).unwrap_or(raw_book).to_string();
            let ch = ann.get("chapter_number").and_then(|v| v.as_i64()).unwrap_or(0);
            let sv = ann.get("start_verse").and_then(|v| v.as_i64());
            let ev = ann.get("end_verse").and_then(|v| v.as_i64());
            let vlabel = match (sv, ev) {
                (Some(s), Some(e)) if e > s => format!("v{s}-{e}"),
                (Some(s), _) => format!("v{s}"),
                _ => "chapter".to_string(),
            };
            bible_index
                .entry(book)
                .or_default()
                .entry(ch)
                .or_default()
                .push(vlabel);
        }

        let study_chapters = cache.get("StudyChapter").map(|v| v.as_slice()).unwrap_or(&[]);
        let study_written_count = study_chapters
            .iter()
            .filter(|c| {
                ["notes", "context", "application"].iter().any(|f| {
                    c.get(f)
                        .and_then(|v| v.as_str())
                        .map(|s| !s.trim().is_empty())
                        .unwrap_or(false)
                })
            })
            .count();

        let ai_index_stats = self
            .vault
            .ai_semantic_index_stats()
            .unwrap_or_else(|_| json!({ "indexed_records": 0, "parity_percent": 0.0 }));

        json!({
            "vault_path": self.vault.library_path.as_ref().map(|p| p.to_string_lossy().to_string()),
            "ai_semantic_index": ai_index_stats,
            "counts": {
                "notes": notes.len(),
                "knowledge_webs": webs.len(),
                "web_cards": cache.get("WebCard").map(|v| v.len()).unwrap_or(0),
                "web_connections": cache.get("WebConnection").map(|v| v.len()).unwrap_or(0),
                "commentaries": annotations.len(),
                "study_chapters_with_writing": study_written_count,
                "study_connections": cache.get("StudyConnection").map(|v| v.len()).unwrap_or(0),
                "keywords": keywords.len(),
                "timelines": timelines.len(),
                "spreadsheets": spreadsheets.len(),
                "mind_links": cache.get("MindLink").map(|v| v.len()).unwrap_or(0),
                "indexed_documents": self.index.docs.len(),
                "graph_nodes": self.graph.nodes.len(),
                "graph_edges": self.graph.edges.len(),
            },
            "notes": notes,
            "knowledge_webs": webs,
            "timelines": timelines,
            "spreadsheets": spreadsheets,
            "keywords": keywords,
            "bible_commentary_index": bible_index,
        })
    }

    fn tool_search(&self, args: &Value) -> Result<Value, String> {
        let query = args
            .get("query")
            .and_then(|v| v.as_str())
            .ok_or("Missing required argument `query`.")?;
        let mode = args.get("mode").and_then(|v| v.as_str()).unwrap_or("hybrid");
        let limit = args
            .get("limit")
            .and_then(|v| v.as_u64())
            .unwrap_or(20)
            .clamp(1, 100) as usize;
        let types: Option<Vec<String>> = args.get("types").and_then(|v| v.as_array()).map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect()
        });

        let hits = self
            .index
            .search(&self.vault, query, types.as_deref(), mode, limit);
        Ok(json!({
            "query": query,
            "mode": mode,
            "result_count": hits.len(),
            "results": hits,
        }))
    }

    fn tool_get_commentary(&mut self, args: &Value) -> Result<Value, String> {
        let parsed_from_query = args
            .get("query")
            .and_then(|v| v.as_str())
            .and_then(parse_bible_reference);

        let book_raw = args
            .get("book")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| parsed_from_query.as_ref().map(|r| r.book.clone()));

        let Some(book_str) = book_raw else {
            return Err("Provide either `query` (e.g. 'Matthew 4:9') or `book`.".into());
        };
        let canon_book = canonical_book_name(&book_str)
            .unwrap_or(book_str.as_str())
            .to_string();
        let chapter = args
            .get("chapter")
            .and_then(|v| v.as_i64())
            .or_else(|| parsed_from_query.as_ref().and_then(|r| r.chapter));
        let start_verse = args
            .get("verse")
            .or_else(|| args.get("start_verse"))
            .and_then(|v| v.as_i64())
            .or_else(|| parsed_from_query.as_ref().and_then(|r| r.start_verse));
        let end_verse = args
            .get("end_verse")
            .and_then(|v| v.as_i64())
            .or_else(|| parsed_from_query.as_ref().and_then(|r| r.end_verse))
            .or(start_verse);
        let include_bible_text = args
            .get("include_bible_text")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        let bible_version = args
            .get("bible_version")
            .and_then(|v| v.as_str())
            .unwrap_or("BSB");

        let query_ref = BibleRef {
            book: canon_book.clone(),
            chapter,
            start_verse,
            end_verse,
        };

        // 1. Matching Annotations (User Commentaries)
        let mut commentaries = Vec::new();
        let mut matched_ann_ids: HashSet<String> = HashSet::new();
        for ann in self.vault.cache.get("Annotation").map(|v| v.as_slice()).unwrap_or(&[]) {
            let abook_raw = ann.get("book").and_then(|v| v.as_str()).unwrap_or("");
            let abook = canonical_book_name(abook_raw).unwrap_or(abook_raw);
            let ach = ann.get("chapter_number").and_then(|v| v.as_i64()).unwrap_or(0);
            let asv = ann.get("start_verse").and_then(|v| v.as_i64());
            let aev = ann.get("end_verse").and_then(|v| v.as_i64()).or(asv);
            let ann_ref = BibleRef {
                book: abook.to_string(),
                chapter: if ach > 0 { Some(ach) } else { None },
                start_verse: asv,
                end_verse: aev,
            };
            if !bible_ref_overlaps(&query_ref, &ann_ref) {
                continue;
            }
            let id = ann.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
            let content_raw = ann
                .get("content")
                .or_else(|| ann.get("note"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let fmt = rich_html_to_markdown(content_raw);
            let passage = format_passage_label(abook, ach, asv, aev);
            let source_id = format!("commentary:{id}");
            matched_ann_ids.insert(source_id.clone());
            commentaries.push(json!({
                "source_id": source_id,
                "id": id,
                "passage": passage,
                "book": abook,
                "chapter": ach,
                "start_verse": asv,
                "end_verse": aev,
                "version": str_field(ann, "version"),
                "selected_scripture_anchor": str_field(ann, "selected_text"),
                "author_commentary_markdown": fmt.markdown,
                "internal_links": fmt.links,
                "verse_citations": fmt.verse_citations.iter().map(|c| c.display_ref()).collect::<Vec<_>>(),
                "created_date": str_field(ann, "created_date"),
                "updated_date": str_field(ann, "updated_date"),
            }));
        }

        // 2. Matching Chapter Study notes/context/application
        let mut chapter_studies = Vec::new();
        for sc in self.vault.cache.get("StudyChapter").map(|v| v.as_slice()).unwrap_or(&[]) {
            let sbook_raw = sc.get("book").and_then(|v| v.as_str()).unwrap_or("");
            let sbook = canonical_book_name(sbook_raw).unwrap_or(sbook_raw);
            let sch = sc.get("chapter_number").and_then(|v| v.as_i64()).unwrap_or(0);
            if !sbook.eq_ignore_ascii_case(&canon_book) {
                continue;
            }
            if let Some(qc) = chapter {
                if sch != qc {
                    continue;
                }
            }
            let notes = rich_html_to_markdown(&str_field(sc, "notes")).markdown;
            let context = rich_html_to_markdown(&str_field(sc, "context")).markdown;
            let application = rich_html_to_markdown(&str_field(sc, "application")).markdown;
            if notes.is_empty() && context.is_empty() && application.is_empty() {
                continue;
            }
            let id = sc.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
            chapter_studies.push(json!({
                "source_id": format!("study:{id}"),
                "id": id,
                "book": sbook,
                "chapter": sch,
                "version": str_field(sc, "version"),
                "notes": notes,
                "context": context,
                "application": application,
            }));
        }

        // 3. Matching StudyConnections & graph neighbors referencing this verse or its commentaries
        let mut related_connections = Vec::new();
        if let (Some(ch), Some(sv)) = (chapter, start_verse) {
            let ev = end_verse.unwrap_or(sv);
            for v in sv..=ev {
                let vnode = format!("verse:{canon_book} {ch}:{v}");
                if self.graph.nodes.contains_key(&vnode) {
                    related_connections.push(self.graph.traverse(&vnode, 1));
                }
            }
        }
        for aid in &matched_ann_ids {
            let sub = self.graph.traverse(aid, 1);
            if sub["edge_count"].as_u64().unwrap_or(0) > 0 {
                related_connections.push(sub);
            }
        }

        // 4. Other Notes/Web Cards/Keywords citing this passage
        let mut cross_references = Vec::new();
        for doc in &self.index.docs {
            if doc.entity_type == "Commentary" || doc.entity_type == "Chapter Study" {
                continue;
            }
            if doc.citations.iter().any(|c| bible_ref_overlaps(&query_ref, c)) {
                cross_references.push(json!({
                    "source_id": doc.source_id,
                    "entity_type": doc.entity_type,
                    "title": doc.title,
                    "workspace_title": doc.workspace_title,
                    "snippet": doc.body_plain.chars().take(300).collect::<String>(),
                }));
            }
        }

        // 5. Optional offline Scripture text for verification
        let bible_text = if include_bible_text {
            if let Some(ch) = chapter {
                self.read_bible_excerpt(&canon_book, ch, start_verse, end_verse, bible_version, false)
                    .ok()
            } else {
                None
            }
        } else {
            None
        };

        Ok(json!({
            "requested_passage": query_ref.display_ref(),
            "commentary_count": commentaries.len(),
            "commentaries": commentaries,
            "chapter_studies": chapter_studies,
            "cross_references_citing_passage": cross_references,
            "graph_connections": related_connections,
            "scripture_text": bible_text,
        }))
    }

    fn read_bible_excerpt(
        &mut self,
        book: &str,
        chapter: i64,
        start_verse: Option<i64>,
        end_verse: Option<i64>,
        version: &str,
        include_hebrew: bool,
    ) -> Result<Value, String> {
        let ch_val = self
            .bible
            .read_bible_chapter(version, book, chapter)
            .map_err(|(_, msg)| msg)?;
        let full_text = ch_val.get("text").and_then(|v| v.as_str()).unwrap_or("");
        let excerpt = if let Some(sv) = start_verse {
            let ev = end_verse.unwrap_or(sv);
            filter_verses_from_chapter_text(full_text, sv, ev)
        } else {
            full_text.to_string()
        };

        let mut result = json!({
            "book": book,
            "chapter": chapter,
            "start_verse": start_verse,
            "end_verse": end_verse,
            "version": version.to_uppercase(),
            "text": excerpt,
        });

        if include_hebrew {
            if let Ok(mam) = self.bible.read_mam_chapter(book, chapter) {
                if let Some(verses_map) = mam.get("verses").and_then(|v| v.as_object()) {
                    let mut heb = Map::new();
                    for (vnum, vtext) in verses_map {
                        if let Ok(vn) = vnum.parse::<i64>() {
                            let include = match (start_verse, end_verse) {
                                (Some(s), Some(e)) => vn >= s && vn <= e,
                                (Some(s), None) => vn == s,
                                _ => true,
                            };
                            if include {
                                heb.insert(vnum.clone(), vtext.clone());
                            }
                        }
                    }
                    result["hebrew_mam"] = Value::Object(heb);
                }
            }
        }
        Ok(result)
    }

    fn tool_get_bible_passage(&mut self, args: &Value) -> Result<Value, String> {
        let parsed = args
            .get("query")
            .and_then(|v| v.as_str())
            .and_then(parse_bible_reference);

        let book_raw = args
            .get("book")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| parsed.as_ref().map(|r| r.book.clone()))
            .ok_or("Provide `book` (or `query` like 'Matthew 4:9').")?;
        let canon_book = canonical_book_name(&book_raw)
            .unwrap_or(book_raw.as_str())
            .to_string();
        let chapter = args
            .get("chapter")
            .and_then(|v| v.as_i64())
            .or_else(|| parsed.as_ref().and_then(|r| r.chapter))
            .ok_or("Provide a `chapter` number.")?;
        let sv = args
            .get("verse")
            .or_else(|| args.get("start_verse"))
            .and_then(|v| v.as_i64())
            .or_else(|| parsed.as_ref().and_then(|r| r.start_verse));
        let ev = args
            .get("end_verse")
            .and_then(|v| v.as_i64())
            .or_else(|| parsed.as_ref().and_then(|r| r.end_verse))
            .or(sv);
        let version = args.get("version").and_then(|v| v.as_str()).unwrap_or("BSB");
        let include_hebrew = args
            .get("include_hebrew")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        self.read_bible_excerpt(&canon_book, chapter, sv, ev, version, include_hebrew)
    }

    fn tool_get_note(&self, args: &Value) -> Result<Value, String> {
        let notes = self.vault.cache.get("MindNote").map(|v| v.as_slice()).unwrap_or(&[]);
        let note = if let Some(id) = args.get("id").and_then(|v| v.as_i64()) {
            notes
                .iter()
                .find(|n| n.get("id").and_then(|v| v.as_i64()) == Some(id))
                .ok_or_else(|| format!("Note ID {id} not found."))?
        } else if let Some(title_q) = args.get("title").and_then(|v| v.as_str()) {
            let low = title_q.trim().to_lowercase();
            notes
                .iter()
                .find(|n| {
                    n.get("title")
                        .and_then(|v| v.as_str())
                        .map(|t| t.to_lowercase() == low)
                        .unwrap_or(false)
                })
                .or_else(|| {
                    notes.iter().find(|n| {
                        n.get("title")
                            .and_then(|v| v.as_str())
                            .map(|t| t.to_lowercase().contains(&low))
                            .unwrap_or(false)
                    })
                })
                .ok_or_else(|| format!("No note matching title '{title_q}' found."))?
        } else {
            return Err("Provide either `id` or `title`.".into());
        };

        let id = note.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
        let title = note.get("title").and_then(|v| v.as_str()).unwrap_or("Untitled Note");
        let content = note.get("content").and_then(|v| v.as_str()).unwrap_or("");
        let page_filter = args.get("page").and_then(|v| v.as_u64()).map(|p| p as usize);

        let all_pages = split_book_pages_detailed(content, title);
        let total_pages = all_pages.len();
        let mut rendered_pages = Vec::new();
        let mut all_citations = Vec::new();
        let mut all_links = Vec::new();

        for (p_num, p_title, p_raw) in all_pages {
            if let Some(pf) = page_filter {
                if p_num != pf {
                    continue;
                }
            }
            let fmt = rich_html_to_markdown(&p_raw);
            for c in &fmt.verse_citations {
                let s = c.display_ref();
                if !all_citations.contains(&s) {
                    all_citations.push(s);
                }
            }
            all_links.extend(fmt.links);
            rendered_pages.push(json!({
                "page": p_num,
                "source_id": if total_pages > 1 { format!("note:{id}/page:{p_num}") } else { format!("note:{id}") },
                "title": p_title,
                "markdown": fmt.markdown,
            }));
        }

        let source_id = format!("note:{id}");
        let connections = self.graph.traverse(&source_id, 1);

        Ok(json!({
            "source_id": source_id,
            "id": id,
            "title": title,
            "total_pages": total_pages,
            "created_date": str_field(note, "created_date"),
            "updated_date": str_field(note, "updated_date"),
            "pages": rendered_pages,
            "verse_citations": all_citations,
            "internal_links": all_links,
            "connections": connections,
        }))
    }

    fn tool_get_knowledge_web(&self, args: &Value) -> Result<Value, String> {
        let webs = self.vault.cache.get("KnowledgeWeb").map(|v| v.as_slice()).unwrap_or(&[]);
        let web = if let Some(id) = args.get("id").and_then(|v| v.as_i64()) {
            webs.iter()
                .find(|w| w.get("id").and_then(|v| v.as_i64()) == Some(id))
                .ok_or_else(|| format!("Knowledge Web ID {id} not found."))?
        } else if let Some(title_q) = args.get("title").and_then(|v| v.as_str()) {
            let low = title_q.trim().to_lowercase();
            webs.iter()
                .filter(|w| !is_private_web(w))
                .find(|w| {
                    w.get("title")
                        .and_then(|v| v.as_str())
                        .map(|t| t.to_lowercase() == low)
                        .unwrap_or(false)
                })
                .or_else(|| {
                    webs.iter().filter(|w| !is_private_web(w)).find(|w| {
                        w.get("title")
                            .and_then(|v| v.as_str())
                            .map(|t| t.to_lowercase().contains(&low))
                            .unwrap_or(false)
                    })
                })
                .ok_or_else(|| format!("No non-private Knowledge Web matching '{title_q}' found."))?
        } else {
            return Err("Provide either `id` or `title`.".into());
        };

        let id = web.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
        if is_private_web(web) {
            return Ok(json!({
                "source_id": format!("web:{id}"),
                "id": id,
                "is_private": true,
                "message": "This Knowledge Web is individually password-locked inside BEX and cannot be read without its password.",
            }));
        }

        let include_cards = args.get("include_cards").and_then(|v| v.as_bool()).unwrap_or(true);
        let title = web.get("title").and_then(|v| v.as_str()).unwrap_or("Knowledge Web");
        let desc_fmt = rich_html_to_markdown(&str_field(web, "description"));

        let raw_cards: Vec<&Value> = self
            .vault
            .cache
            .get("WebCard")
            .map(|v| v.as_slice())
            .unwrap_or(&[])
            .iter()
            .filter(|c| c.get("web_id").and_then(|v| v.as_i64()) == Some(id))
            .collect();

        let card_titles: HashMap<String, String> = raw_cards
            .iter()
            .map(|c| {
                (
                    json_id_str(c.get("id")),
                    c.get("title").and_then(|v| v.as_str()).unwrap_or("Untitled Card").to_string(),
                )
            })
            .collect();

        let raw_objects: Vec<&Value> = self
            .vault
            .cache
            .get("CanvasObject")
            .map(|v| v.as_slice())
            .unwrap_or(&[])
            .iter()
            .filter(|o| o.get("web_id").and_then(|v| v.as_i64()) == Some(id))
            .collect();

        let obj_titles: HashMap<String, String> = raw_objects
            .iter()
            .map(|o| {
                (
                    json_id_str(o.get("id")),
                    o.get("title")
                        .or_else(|| o.get("object_type"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("Canvas Object")
                        .to_string(),
                )
            })
            .collect();

        let cards: Vec<Value> = if include_cards {
            raw_cards
                .iter()
                .map(|c| {
                    let cid = c.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
                    let fmt = rich_html_to_markdown(&str_field(c, "description"));
                    json!({
                        "source_id": format!("web:{id}/card:{cid}"),
                        "id": cid,
                        "title": c.get("title").and_then(|v| v.as_str()).unwrap_or("Untitled Card"),
                        "markdown": fmt.markdown,
                        "tags": c.get("tags").cloned().unwrap_or(json!([])),
                        "link_url": str_field(c, "link_url"),
                        "verse_citations": fmt.verse_citations.iter().map(|r| r.display_ref()).collect::<Vec<_>>(),
                    })
                })
                .collect()
        } else {
            Vec::new()
        };

        let objects: Vec<Value> = raw_objects
            .iter()
            .map(|o| {
                let oid = o.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
                let fmt = rich_html_to_markdown(&str_field(o, "content"));
                let otype = str_field(o, "object_type");
                let mut inside_cards = Vec::new();
                if otype == "section" {
                    let ox = o.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let oy = o.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let ow = o.get("width").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let oh = o.get("height").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    for c in &raw_cards {
                        if let (Some(cx), Some(cy)) = (
                            c.get("x").and_then(|v| v.as_f64()),
                            c.get("y").and_then(|v| v.as_f64()),
                        ) {
                            if cx >= ox && cx <= ox + ow && cy >= oy && cy <= oy + oh {
                                inside_cards.push(format!("web:{id}/card:{}", json_id_str(c.get("id"))));
                            }
                        }
                    }
                }
                json!({
                    "source_id": format!("web:{id}/object:{oid}"),
                    "id": oid,
                    "object_type": otype,
                    "title": str_field(o, "title"),
                    "markdown": fmt.markdown,
                    "cards_inside_section": inside_cards,
                    "timegraph_id": o.get("timegraph_id"),
                    "link_web_id": o.get("link_web_id"),
                })
            })
            .collect();

        let connections: Vec<Value> = self
            .vault
            .cache
            .get("WebConnection")
            .map(|v| v.as_slice())
            .unwrap_or(&[])
            .iter()
            .filter(|cn| cn.get("web_id").and_then(|v| v.as_i64()) == Some(id))
            .map(|cn| {
                let fk = cn.get("from_kind").and_then(|v| v.as_str()).unwrap_or("card");
                let tk = cn.get("to_kind").and_then(|v| v.as_str()).unwrap_or("card");
                let fid = json_id_str(cn.get("from_card_id"));
                let tid = json_id_str(cn.get("to_card_id"));
                let from_title = if fk == "object" {
                    obj_titles.get(&fid)
                } else {
                    card_titles.get(&fid)
                }
                .cloned()
                .unwrap_or_else(|| fid.clone());
                let to_title = if tk == "object" {
                    obj_titles.get(&tid)
                } else {
                    card_titles.get(&tid)
                }
                .cloned()
                .unwrap_or_else(|| tid.clone());
                let directed = cn.get("has_arrow").and_then(|v| v.as_bool()).unwrap_or(true);
                let label = str_field(cn, "label");
                let arrow = if directed { "-->" } else { "<-->" };
                let readable = if label.is_empty() {
                    format!("[{from_title}] {arrow} [{to_title}]")
                } else {
                    format!("[{from_title}] --({label})--{arrow} [{to_title}]")
                };
                json!({
                    "from": format!("web:{id}/{}:{fid}", if fk == "object" { "object" } else { "card" }),
                    "from_title": from_title,
                    "to": format!("web:{id}/{}:{tid}", if tk == "object" { "object" } else { "card" }),
                    "to_title": to_title,
                    "directed": directed,
                    "label": label,
                    "readable": readable,
                })
            })
            .collect();

        Ok(json!({
            "source_id": format!("web:{id}"),
            "id": id,
            "title": title,
            "description_markdown": desc_fmt.markdown,
            "card_count": raw_cards.len(),
            "connection_count": connections.len(),
            "cards": cards,
            "canvas_objects": objects,
            "argument_graph": connections,
            "updated_date": str_field(web, "updated_date"),
        }))
    }

    fn tool_get_keywords(&self, args: &Value) -> Value {
        let q = args.get("query").and_then(|v| v.as_str()).map(|s| s.to_lowercase());
        let cat_filter = args.get("category").and_then(|v| v.as_str()).map(|s| s.to_lowercase());
        let id_filter = args.get("id").and_then(|v| v.as_i64());

        let mut results = Vec::new();
        for kw in self.vault.cache.get("Keyword").map(|v| v.as_slice()).unwrap_or(&[]) {
            let id = kw.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
            if let Some(want_id) = id_filter {
                if id != want_id {
                    continue;
                }
            }
            let title = kw.get("title").and_then(|v| v.as_str()).unwrap_or("Keyword");
            let cat = str_field(kw, "category");
            let raw_body = kw
                .get("explanation")
                .or_else(|| kw.get("definition"))
                .or_else(|| kw.get("content"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let fmt = rich_html_to_markdown(raw_body);

            if let Some(ref cf) = cat_filter {
                if !cat.to_lowercase().contains(cf) {
                    continue;
                }
            }
            if let Some(ref qs) = q {
                if !title.to_lowercase().contains(qs) && !fmt.markdown.to_lowercase().contains(qs) {
                    continue;
                }
            }

            let source_id = format!("keyword:{id}");
            let refs = self.graph.traverse(&source_id, 1);
            results.push(json!({
                "source_id": source_id,
                "id": id,
                "title": title,
                "category": cat,
                "explanation_markdown": fmt.markdown,
                "verse_citations": fmt.verse_citations.iter().map(|r| r.display_ref()).collect::<Vec<_>>(),
                "referenced_by": refs,
            }));
        }

        json!({
            "count": results.len(),
            "keywords": results,
        })
    }

    fn tool_get_timeline(&self, args: &Value) -> Result<Value, String> {
        let timelines = self.vault.cache.get("Timegraph").map(|v| v.as_slice()).unwrap_or(&[]);
        let tg = if let Some(id) = args.get("id").and_then(|v| v.as_i64()) {
            timelines
                .iter()
                .find(|t| t.get("id").and_then(|v| v.as_i64()) == Some(id))
                .ok_or_else(|| format!("Timeline ID {id} not found."))?
        } else if let Some(tq) = args.get("title").and_then(|v| v.as_str()) {
            let low = tq.trim().to_lowercase();
            timelines
                .iter()
                .find(|t| {
                    t.get("title")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_lowercase().contains(&low))
                        .unwrap_or(false)
                })
                .ok_or_else(|| format!("No timeline matching '{tq}' found."))?
        } else {
            return Err("Provide either `id` or `title`.".into());
        };

        let id = tg.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
        let title = tg.get("title").and_then(|v| v.as_str()).unwrap_or("Timeline");
        let desc = rich_html_to_markdown(&str_field(tg, "description")).markdown;

        let mut events: Vec<(f64, usize, Value)> = tg
            .get("events")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .enumerate()
                    .map(|(idx, ev)| {
                        let sort_year = extract_timeline_sort_year(ev.get("start"));
                        let ev_desc = rich_html_to_markdown(&str_field(ev, "description"));
                        let val = json!({
                            "id": ev.get("id"),
                            "title": str_field(ev, "title"),
                            "start": ev.get("start"),
                            "end": ev.get("end"),
                            "tags": ev.get("tags").cloned().unwrap_or(json!([])),
                            "links": ev.get("links").cloned().unwrap_or(json!([])),
                            "description_markdown": ev_desc.markdown,
                            "verse_citations": ev_desc.verse_citations.iter().map(|r| r.display_ref()).collect::<Vec<_>>(),
                        });
                        (sort_year, idx, val)
                    })
                    .collect()
            })
            .unwrap_or_default();

        events.sort_by(|a, b| {
            a.0.partial_cmp(&b.0)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.1.cmp(&b.1))
        });

        Ok(json!({
            "source_id": format!("timeline:{id}"),
            "id": id,
            "title": title,
            "description_markdown": desc,
            "event_count": events.len(),
            "events": events.into_iter().map(|(_, _, v)| v).collect::<Vec<_>>(),
        }))
    }

    fn tool_get_spreadsheet(&self, args: &Value) -> Result<Value, String> {
        let sheets_list = self.vault.cache.get("Spreadsheet").map(|v| v.as_slice()).unwrap_or(&[]);
        let ss = if let Some(id) = args.get("id").and_then(|v| v.as_i64()) {
            sheets_list
                .iter()
                .find(|s| s.get("id").and_then(|v| v.as_i64()) == Some(id))
                .ok_or_else(|| format!("Spreadsheet ID {id} not found."))?
        } else if let Some(tq) = args.get("title").and_then(|v| v.as_str()) {
            let low = tq.trim().to_lowercase();
            sheets_list
                .iter()
                .find(|s| {
                    s.get("title")
                        .and_then(|v| v.as_str())
                        .map(|n| n.to_lowercase().contains(&low))
                        .unwrap_or(false)
                })
                .ok_or_else(|| format!("No spreadsheet matching '{tq}' found."))?
        } else {
            return Err("Provide either `id` or `title`.".into());
        };

        let id = ss.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
        let title = ss.get("title").and_then(|v| v.as_str()).unwrap_or("Spreadsheet");
        let sheet_filter = args.get("sheet").and_then(|v| v.as_str()).map(|s| s.to_lowercase());

        let mut out_sheets = Vec::new();
        if let Some(sheets) = ss.get("workbook").and_then(|w| w.get("sheets")).and_then(|s| s.as_array()) {
            for sh in sheets {
                let sname = sh.get("name").and_then(|v| v.as_str()).unwrap_or("Sheet");
                if let Some(ref sf) = sheet_filter {
                    if !sname.to_lowercase().contains(sf) {
                        continue;
                    }
                }
                let mut cells_out = Vec::new();
                if let Some(cells) = sh.get("cells").and_then(|c| c.as_object()) {
                    let mut keys: Vec<&String> = cells.keys().collect();
                    keys.sort();
                    for addr in keys {
                        let cell = &cells[addr];
                        let val = cell.get("v").map(json_scalar_to_string).unwrap_or_default();
                        let formula = cell.get("f").and_then(|v| v.as_str()).unwrap_or("");
                        let note = cell.get("note").and_then(|v| v.as_str()).unwrap_or("");
                        let link = cell.get("link").and_then(|v| v.as_str()).unwrap_or("");
                        if val.is_empty() && formula.is_empty() && note.is_empty() && link.is_empty() {
                            continue;
                        }
                        let mut cobj = Map::new();
                        cobj.insert("cell".into(), json!(addr));
                        if !val.is_empty() {
                            cobj.insert("value".into(), json!(val));
                        }
                        if !formula.is_empty() {
                            cobj.insert("formula".into(), json!(format!("={formula}")));
                        }
                        if !note.is_empty() {
                            cobj.insert("note".into(), json!(note));
                        }
                        if !link.is_empty() {
                            cobj.insert("link".into(), json!(link));
                        }
                        cells_out.push(Value::Object(cobj));
                    }
                }
                out_sheets.push(json!({
                    "id": sh.get("id"),
                    "name": sname,
                    "non_empty_cell_count": cells_out.len(),
                    "cells": cells_out,
                }));
            }
        }

        Ok(json!({
            "source_id": format!("spreadsheet:{id}"),
            "id": id,
            "title": title,
            "sheets": out_sheets,
        }))
    }

    fn tool_get_connections(&self, args: &Value) -> Result<Value, String> {
        let source_id = args
            .get("source_id")
            .and_then(|v| v.as_str())
            .ok_or("Provide `source_id` (e.g. 'note:12', 'commentary:42', 'web:5/card:99', 'keyword:7', or 'verse:Matthew 4:9').")?;
        let depth = args
            .get("depth")
            .and_then(|v| v.as_u64())
            .unwrap_or(2)
            .clamp(1, 3) as usize;

        Ok(self.graph.traverse(source_id, depth))
    }

    fn tool_theological_dossier(&mut self, args: &Value) -> Result<Value, String> {
        let topic = args
            .get("topic")
            .and_then(|v| v.as_str())
            .ok_or("Missing required argument `topic`.")?;
        let max_items = args
            .get("max_items")
            .and_then(|v| v.as_u64())
            .unwrap_or(12)
            .clamp(3, 30) as usize;

        // 1. Passage commentaries if passages specified
        let mut passage_reports = Vec::new();
        if let Some(passages) = args.get("passages").and_then(|v| v.as_array()) {
            for p in passages {
                if let Some(ps) = p.as_str() {
                    if let Ok(rep) = self.tool_get_commentary(&json!({
                        "query": ps,
                        "include_bible_text": true
                    })) {
                        passage_reports.push(rep);
                    }
                }
            }
        }

        // 2. Hybrid search across the entire Vault for the topic
        let hits = self
            .index
            .search(&self.vault, topic, None, "hybrid", max_items);

        // 3. Expand full Markdown content + 1-hop graph neighbors for top hits
        let mut full_evidence = Vec::new();
        let mut neighbor_ids: HashSet<String> = HashSet::new();
        let mut hit_ids: HashSet<String> = HashSet::new();

        for hit in &hits {
            hit_ids.insert(hit.source_id.clone());
            let full_body = self
                .index
                .get_doc(&hit.source_id)
                .map(|d| {
                    // Cap huge individual pages cleanly while keeping substantial context
                    let chars: Vec<char> = d.body_plain.chars().collect();
                    if chars.len() > 6000 {
                        let mut s: String = chars[..6000].iter().collect();
                        s.push_str("\n\n...(truncated; call `bex_get_note` or `bex_get_knowledge_web` for complete text)");
                        s
                    } else {
                        d.body_plain.clone()
                    }
                })
                .unwrap_or_else(|| hit.snippet.clone());

            let local_graph = self.graph.traverse(&hit.source_id, 1);
            if let Some(nodes) = local_graph.get("nodes").and_then(|v| v.as_array()) {
                for n in nodes {
                    if let Some(sid) = n.get("source_id").and_then(|v| v.as_str()) {
                        if sid != hit.source_id {
                            neighbor_ids.insert(sid.to_string());
                        }
                    }
                }
            }

            full_evidence.push(json!({
                "source_id": hit.source_id,
                "entity_type": hit.entity_type,
                "title": hit.title,
                "workspace_title": hit.workspace_title,
                "score": hit.score,
                "match_reasons": hit.match_reasons,
                "citations": hit.citations,
                "updated_date": hit.updated_date,
                "full_markdown": full_body,
                "direct_edges": local_graph.get("edges").cloned().unwrap_or(json!([])),
            }));
        }

        // 4. Summarize 1-hop linked items not already in top hits (for consistency cross-checking)
        let linked_context: Vec<Value> = neighbor_ids
            .into_iter()
            .filter(|id| !hit_ids.contains(id) && !id.starts_with("verse:"))
            .take(15)
            .filter_map(|id| {
                let d = self.index.get_doc(&id)?;
                Some(json!({
                    "source_id": d.source_id,
                    "entity_type": d.entity_type,
                    "title": d.title,
                    "workspace_title": d.workspace_title,
                    "snippet": d.body_plain.chars().take(350).collect::<String>(),
                }))
            })
            .collect();

        Ok(json!({
            "topic": topic,
            "passage_analyses": passage_reports,
            "evidence_count": full_evidence.len(),
            "evidence": full_evidence,
            "linked_1hop_context": linked_context,
        }))
    }

    // ── Guarded Additive Write & Navigation Tools ──────────────────────────

    fn tool_create_note(&mut self, args: &Value) -> Result<Value, String> {
        let title = args
            .get("title")
            .and_then(|v| v.as_str())
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .ok_or("Missing required `title`.")?;
        let md = args
            .get("markdown_content")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let html = markdown_to_html(md);

        let mut payload = json!({
            "title": title,
            "content": html,
        });
        if let Some(fid) = args.get("folder_id").and_then(|v| v.as_i64()) {
            payload["folder_id"] = json!(fid);
        }

        let created = self
            .vault
            .create_entity("MindNote", &payload)
            .map_err(|e| format!("{}: {}", e.code, e.message))?;
        self.rebuild_indexes();
        let id = created.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
        Ok(json!({
            "created": true,
            "source_id": format!("note:{id}"),
            "id": id,
            "title": title,
            "href": format!("/notes/{id}"),
        }))
    }

    fn tool_append_to_note(&mut self, args: &Value) -> Result<Value, String> {
        let note_id = args
            .get("note_id")
            .and_then(|v| v.as_i64())
            .ok_or("Missing required `note_id`.")?;
        let md = args
            .get("markdown_content")
            .and_then(|v| v.as_str())
            .ok_or("Missing required `markdown_content`.")?;
        let heading = args.get("heading").and_then(|v| v.as_str()).unwrap_or("");
        let as_new_page = args
            .get("as_new_page")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let existing = self
            .vault
            .get_entity("MindNote", note_id)
            .map_err(|e| format!("{}: {}", e.code, e.message))?;
        let cur_html = str_field(&existing, "content");
        let add_html = markdown_to_html(md);

        let next_html = if as_new_page {
            let page_hdr = if heading.trim().is_empty() {
                String::new()
            } else {
                let encoded: String = url::form_urlencoded::byte_serialize(heading.trim().as_bytes())
                    .collect::<String>()
                    .replace('+', "%20");
                format!("<!--bex-page-title:{encoded}-->")
            };
            format!("{cur_html}{PAGE_BREAK_SENTINEL}{page_hdr}{add_html}")
        } else if !heading.trim().is_empty() {
            format!(
                "{cur_html}<h2>{}</h2>{add_html}",
                bex_tauri_lib::ai_access::escape_html(heading.trim())
            )
        } else {
            format!("{cur_html}{add_html}")
        };

        let updated = self
            .vault
            .update_entity("MindNote", note_id, &json!({ "content": next_html }))
            .map_err(|e| format!("{}: {}", e.code, e.message))?;
        self.rebuild_indexes();
        Ok(json!({
            "updated": true,
            "source_id": format!("note:{note_id}"),
            "id": note_id,
            "title": str_field(&updated, "title"),
            "as_new_page": as_new_page,
        }))
    }

    fn tool_create_commentary(&mut self, args: &Value) -> Result<Value, String> {
        let book_raw = args
            .get("book")
            .and_then(|v| v.as_str())
            .ok_or("Missing required `book`.")?;
        let book = canonical_book_name(book_raw)
            .unwrap_or(book_raw)
            .to_string();
        let chapter = args
            .get("chapter")
            .and_then(|v| v.as_i64())
            .filter(|&c| c > 0)
            .ok_or("Missing required positive `chapter`.")?;
        let start_verse = args
            .get("start_verse")
            .or_else(|| args.get("verse"))
            .and_then(|v| v.as_i64())
            .filter(|&v| v > 0)
            .ok_or("Missing required positive `start_verse`.")?;
        let end_verse = args
            .get("end_verse")
            .and_then(|v| v.as_i64())
            .filter(|&v| v >= start_verse)
            .unwrap_or(start_verse);
        let md = args
            .get("markdown_content")
            .and_then(|v| v.as_str())
            .ok_or("Missing required `markdown_content`.")?;
        let version = args
            .get("version")
            .and_then(|v| v.as_str())
            .unwrap_or("BSB");
        let selected_text = args
            .get("selected_text")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        // Ensure parent StudyChapter exists so the commentary appears in BEX search & Study view
        let has_study = self
            .vault
            .cache
            .get("StudyChapter")
            .map(|v| v.as_slice())
            .unwrap_or(&[])
            .iter()
            .any(|c| {
                c.get("book").and_then(|v| v.as_str()) == Some(book.as_str())
                    && c.get("chapter_number").and_then(|v| v.as_i64()) == Some(chapter)
                    && c.get("version").and_then(|v| v.as_str()) == Some(version)
            });
        if !has_study {
            let _ = self.vault.create_entity(
                "StudyChapter",
                &json!({
                    "book": book,
                    "chapter_number": chapter,
                    "version": version,
                    "title": format!("{book} {chapter}"),
                }),
            );
        }

        let html = markdown_to_html(md);
        let payload = json!({
            "book": book,
            "chapter_number": chapter,
            "start_verse": start_verse,
            "end_verse": end_verse,
            "version": version,
            "selected_text": selected_text,
            "content": html,
        });
        let created = self
            .vault
            .create_entity("Annotation", &payload)
            .map_err(|e| format!("{}: {}", e.code, e.message))?;
        self.rebuild_indexes();
        let id = created.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
        let passage = format_passage_label(&book, chapter, Some(start_verse), Some(end_verse));
        Ok(json!({
            "created": true,
            "source_id": format!("commentary:{id}"),
            "id": id,
            "passage": passage,
            "version": version,
        }))
    }

    fn tool_create_web_card(&mut self, args: &Value) -> Result<Value, String> {
        let web_id = args
            .get("web_id")
            .and_then(|v| v.as_i64())
            .ok_or("Missing required `web_id`.")?;
        let web = self
            .vault
            .get_entity("KnowledgeWeb", web_id)
            .map_err(|e| format!("{}: {}", e.code, e.message))?;
        if is_private_web(&web) {
            return Err("Cannot write into a password-locked private Knowledge Web.".into());
        }
        let title = args
            .get("title")
            .and_then(|v| v.as_str())
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .ok_or("Missing required `title`.")?;
        let md = args
            .get("markdown_content")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let tags = args.get("tags").cloned().unwrap_or(json!([]));

        // Compute non-overlapping (x, y) near existing cards
        let (mut max_x, mut avg_y, mut count) = (100.0f64, 160.0f64, 0usize);
        for c in self.vault.cache.get("WebCard").map(|v| v.as_slice()).unwrap_or(&[]) {
            if c.get("web_id").and_then(|v| v.as_i64()) == Some(web_id) {
                let cx = c.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let cy = c.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0);
                if cx > max_x {
                    max_x = cx;
                }
                avg_y += cy;
                count += 1;
            }
        }
        let new_x = if count == 0 { 120.0 } else { max_x + 320.0 };
        let new_y = if count == 0 { 160.0 } else { avg_y / (count as f64) };

        let card = self
            .vault
            .create_entity(
                "WebCard",
                &json!({
                    "web_id": web_id,
                    "title": title,
                    "description": markdown_to_html(md),
                    "tags": tags,
                    "x": new_x,
                    "y": new_y,
                }),
            )
            .map_err(|e| format!("{}: {}", e.code, e.message))?;
        let card_id = card.get("id").and_then(|v| v.as_i64()).unwrap_or(0);

        let mut connection_created = Value::Null;
        if let Some(target_card_id) = args.get("connect_to_card_id").and_then(|v| v.as_i64()) {
            let label = args
                .get("connection_label")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if let Ok(conn) = self.vault.create_entity(
                "WebConnection",
                &json!({
                    "web_id": web_id,
                    "from_card_id": card_id,
                    "to_card_id": target_card_id,
                    "from_kind": "card",
                    "to_kind": "card",
                    "has_arrow": true,
                    "label": label,
                }),
            ) {
                connection_created = conn;
            }
        }

        self.rebuild_indexes();
        Ok(json!({
            "created": true,
            "source_id": format!("web:{web_id}/card:{card_id}"),
            "id": card_id,
            "web_id": web_id,
            "title": title,
            "connection": connection_created,
        }))
    }

    fn tool_open_in_bex(&self, args: &Value) -> Result<Value, String> {
        let route = if let Some(p) = args.get("path").and_then(|v| v.as_str()) {
            p.to_string()
        } else if let Some(book_raw) = args.get("book").and_then(|v| v.as_str()) {
            let book = canonical_book_name(book_raw).unwrap_or(book_raw);
            let ch = args.get("chapter").and_then(|v| v.as_i64()).unwrap_or(1);
            let v = args.get("verse").and_then(|v| v.as_i64());
            let passage = format_passage_label(book, ch, v, v);
            format!("/Study?q={}", passage.replace(' ', "%20"))
        } else {
            "/".to_string()
        };

        let mut cmd = Command::new("open");
        cmd.arg("-a").arg("/Applications/BEX.app");
        if route != "/" {
            cmd.env("BEX_OPEN_PATH", &route);
        }
        cmd.spawn()
            .map_err(|e| format!("Failed to launch /Applications/BEX.app: {e}"))?;

        Ok(json!({
            "opened": true,
            "route": route,
        }))
    }

    fn tool_update_note(&mut self, args: &Value) -> Result<Value, String> {
        let note_id = args
            .get("note_id")
            .or_else(|| args.get("id"))
            .and_then(|v| v.as_i64())
            .ok_or("Missing required `note_id`.")?;
        let existing = self
            .vault
            .get_entity("MindNote", note_id)
            .map_err(|e| format!("{}: {}", e.code, e.message))?;
        let mut patch = Map::new();
        if let Some(title) = args.get("title").and_then(|v| v.as_str()) {
            patch.insert("title".into(), json!(title.trim()));
        }
        if let Some(fid) = args.get("folder_id") {
            patch.insert("folder_id".into(), fid.clone());
        }
        if let Some(md) = args.get("markdown_content").and_then(|v| v.as_str()) {
            let new_html = markdown_to_html(md);
            if let Some(page_num) = args.get("page").and_then(|v| v.as_u64()).map(|p| p as usize) {
                let cur_content = str_field(&existing, "content");
                let fallback_title = str_field(&existing, "title");
                let pages = split_book_pages_detailed(&cur_content, &fallback_title);
                if page_num == 0 || page_num > pages.len() {
                    return Err(format!("Page {page_num} out of range (note has {} page(s)).", pages.len()));
                }
                let mut rebuilt = Vec::with_capacity(pages.len());
                for (idx, p_title, p_raw) in pages {
                    let use_title = if idx == page_num {
                        args.get("page_title")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string())
                            .unwrap_or(p_title)
                    } else {
                        p_title
                    };
                    let body = if idx == page_num { new_html.clone() } else { p_raw };
                    let encoded: String = url::form_urlencoded::byte_serialize(use_title.as_bytes())
                        .collect::<String>()
                        .replace('+', "%20");
                    rebuilt.push(format!("<!--bex-page-title:{encoded}-->{body}"));
                }
                patch.insert("content".into(), json!(rebuilt.join(PAGE_BREAK_SENTINEL)));
            } else {
                patch.insert("content".into(), json!(new_html));
            }
        }
        if patch.is_empty() {
            return Err("Provide at least one field to update (`title`, `markdown_content`, or `folder_id`).".into());
        }
        let updated = self
            .vault
            .update_entity("MindNote", note_id, &Value::Object(patch))
            .map_err(|e| format!("{}: {}", e.code, e.message))?;
        self.rebuild_indexes();
        Ok(json!({
            "updated": true,
            "source_id": format!("note:{note_id}"),
            "id": note_id,
            "title": str_field(&updated, "title"),
        }))
    }

    fn tool_update_commentary(&mut self, args: &Value) -> Result<Value, String> {
        let id = args
            .get("commentary_id")
            .or_else(|| args.get("id"))
            .and_then(|v| v.as_i64())
            .ok_or("Missing required `commentary_id`.")?;
        let mut patch = Map::new();
        if let Some(md) = args.get("markdown_content").and_then(|v| v.as_str()) {
            patch.insert("content".into(), json!(markdown_to_html(md)));
        }
        if let Some(sv) = args.get("start_verse").and_then(|v| v.as_i64()) {
            patch.insert("start_verse".into(), json!(sv));
        }
        if let Some(ev) = args.get("end_verse").and_then(|v| v.as_i64()) {
            patch.insert("end_verse".into(), json!(ev));
        }
        if let Some(st) = args.get("selected_text").and_then(|v| v.as_str()) {
            patch.insert("selected_text".into(), json!(st));
        }
        if patch.is_empty() {
            return Err("Provide at least one field to update (`markdown_content`, `start_verse`, `end_verse`, `selected_text`).".into());
        }
        let updated = self
            .vault
            .update_entity("Annotation", id, &Value::Object(patch))
            .map_err(|e| format!("{}: {}", e.code, e.message))?;
        self.rebuild_indexes();
        Ok(json!({
            "updated": true,
            "source_id": format!("commentary:{id}"),
            "id": id,
            "book": str_field(&updated, "book"),
            "chapter": updated.get("chapter_number"),
            "start_verse": updated.get("start_verse"),
            "end_verse": updated.get("end_verse"),
        }))
    }

    fn tool_upsert_study_chapter(&mut self, args: &Value) -> Result<Value, String> {
        let book_raw = args.get("book").and_then(|v| v.as_str()).ok_or("Missing required `book`.")?;
        let book = canonical_book_name(book_raw).unwrap_or(book_raw).to_string();
        let chapter = args
            .get("chapter")
            .and_then(|v| v.as_i64())
            .filter(|&c| c > 0)
            .ok_or("Missing required positive `chapter`.")?;
        let version = args.get("version").and_then(|v| v.as_str()).unwrap_or("BSB");

        let existing_id = self
            .vault
            .cache
            .get("StudyChapter")
            .map(|v| v.as_slice())
            .unwrap_or(&[])
            .iter()
            .find(|c| {
                let cb = c.get("book").and_then(|v| v.as_str()).unwrap_or("");
                canonical_book_name(cb).unwrap_or(cb).eq_ignore_ascii_case(&book)
                    && c.get("chapter_number").and_then(|v| v.as_i64()) == Some(chapter)
                    && c.get("version").and_then(|v| v.as_str()) == Some(version)
            })
            .and_then(|c| c.get("id").and_then(|v| v.as_i64()));

        let mut patch = Map::new();
        for field in ["notes", "context", "application"] {
            if let Some(md) = args.get(field).and_then(|v| v.as_str()) {
                patch.insert(field.into(), json!(markdown_to_html(md)));
            }
        }
        let rec = if let Some(id) = existing_id {
            self.vault
                .update_entity("StudyChapter", id, &Value::Object(patch))
                .map_err(|e| format!("{}: {}", e.code, e.message))?
        } else {
            patch.insert("book".into(), json!(book));
            patch.insert("chapter_number".into(), json!(chapter));
            patch.insert("version".into(), json!(version));
            patch.insert("title".into(), json!(format!("{book} {chapter}")));
            self.vault
                .create_entity("StudyChapter", &Value::Object(patch))
                .map_err(|e| format!("{}: {}", e.code, e.message))?
        };
        self.rebuild_indexes();
        let id = rec.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
        Ok(json!({
            "saved": true,
            "source_id": format!("study:{id}"),
            "id": id,
            "book": book,
            "chapter": chapter,
            "version": version,
        }))
    }

    fn tool_create_knowledge_web(&mut self, args: &Value) -> Result<Value, String> {
        let title = args
            .get("title")
            .and_then(|v| v.as_str())
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .ok_or("Missing required `title`.")?;
        let desc = args
            .get("description_markdown")
            .and_then(|v| v.as_str())
            .map(markdown_to_html)
            .unwrap_or_default();
        let mut payload = json!({
            "title": title,
            "description": desc,
            "is_private": false,
        });
        if let Some(fid) = args.get("folder_id").and_then(|v| v.as_i64()) {
            payload["folder_id"] = json!(fid);
        }
        let created = self
            .vault
            .create_entity("KnowledgeWeb", &payload)
            .map_err(|e| format!("{}: {}", e.code, e.message))?;
        self.rebuild_indexes();
        let id = created.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
        Ok(json!({
            "created": true,
            "source_id": format!("web:{id}"),
            "id": id,
            "title": title,
            "href": format!("/knowledge-webs/{id}"),
        }))
    }

    fn tool_update_web_card(&mut self, args: &Value) -> Result<Value, String> {
        let card_id = args
            .get("card_id")
            .or_else(|| args.get("id"))
            .and_then(|v| v.as_i64())
            .ok_or("Missing required `card_id`.")?;
        let existing = self
            .vault
            .get_entity("WebCard", card_id)
            .map_err(|e| format!("{}: {}", e.code, e.message))?;
        let web_id = existing.get("web_id").and_then(|v| v.as_i64()).unwrap_or(0);
        if let Ok(web) = self.vault.get_entity("KnowledgeWeb", web_id) {
            if is_private_web(&web) {
                return Err("Cannot modify cards inside a password-locked private Knowledge Web.".into());
            }
        }
        let mut patch = Map::new();
        if let Some(t) = args.get("title").and_then(|v| v.as_str()) {
            patch.insert("title".into(), json!(t.trim()));
        }
        if let Some(md) = args.get("markdown_content").and_then(|v| v.as_str()) {
            patch.insert("description".into(), json!(markdown_to_html(md)));
        }
        if let Some(tags) = args.get("tags") {
            patch.insert("tags".into(), tags.clone());
        }
        if let Some(link) = args.get("link_url").and_then(|v| v.as_str()) {
            patch.insert("link_url".into(), json!(link));
        }
        if patch.is_empty() {
            return Err("Provide at least one field to update (`title`, `markdown_content`, `tags`, `link_url`).".into());
        }
        let updated = self
            .vault
            .update_entity("WebCard", card_id, &Value::Object(patch))
            .map_err(|e| format!("{}: {}", e.code, e.message))?;
        self.rebuild_indexes();
        Ok(json!({
            "updated": true,
            "source_id": format!("web:{web_id}/card:{card_id}"),
            "id": card_id,
            "web_id": web_id,
            "title": str_field(&updated, "title"),
        }))
    }

    fn tool_manage_web_connection(&mut self, args: &Value) -> Result<Value, String> {
        let action = args.get("action").and_then(|v| v.as_str()).unwrap_or("create");
        match action {
            "create" => {
                let web_id = args.get("web_id").and_then(|v| v.as_i64()).ok_or("Missing `web_id`.")?;
                if let Ok(web) = self.vault.get_entity("KnowledgeWeb", web_id) {
                    if is_private_web(&web) {
                        return Err("Cannot modify a password-locked private Knowledge Web.".into());
                    }
                }
                let from_id = args.get("from_card_id").and_then(|v| v.as_i64()).ok_or("Missing `from_card_id`.")?;
                let to_id = args.get("to_card_id").and_then(|v| v.as_i64()).ok_or("Missing `to_card_id`.")?;
                let has_arrow = args.get("has_arrow").and_then(|v| v.as_bool()).unwrap_or(true);
                let label = args.get("label").and_then(|v| v.as_str()).unwrap_or("");
                let created = self
                    .vault
                    .create_entity(
                        "WebConnection",
                        &json!({
                            "web_id": web_id,
                            "from_card_id": from_id,
                            "to_card_id": to_id,
                            "from_kind": "card",
                            "to_kind": "card",
                            "has_arrow": has_arrow,
                            "label": label,
                        }),
                    )
                    .map_err(|e| format!("{}: {}", e.code, e.message))?;
                self.rebuild_indexes();
                Ok(json!({ "created": true, "connection": created }))
            }
            "update" => {
                let cid = args.get("connection_id").and_then(|v| v.as_i64()).ok_or("Missing `connection_id`.")?;
                let mut patch = Map::new();
                if let Some(l) = args.get("label").and_then(|v| v.as_str()) {
                    patch.insert("label".into(), json!(l));
                }
                if let Some(ha) = args.get("has_arrow").and_then(|v| v.as_bool()) {
                    patch.insert("has_arrow".into(), json!(ha));
                }
                let updated = self
                    .vault
                    .update_entity("WebConnection", cid, &Value::Object(patch))
                    .map_err(|e| format!("{}: {}", e.code, e.message))?;
                self.rebuild_indexes();
                Ok(json!({ "updated": true, "connection": updated }))
            }
            "delete" => {
                let cid = args.get("connection_id").and_then(|v| v.as_i64()).ok_or("Missing `connection_id`.")?;
                let res = self
                    .vault
                    .delete_entity("WebConnection", cid)
                    .map_err(|e| format!("{}: {}", e.code, e.message))?;
                self.rebuild_indexes();
                Ok(res)
            }
            other => Err(format!("Unsupported action '{other}'. Use 'create', 'update', or 'delete'.")),
        }
    }

    fn tool_upsert_keyword(&mut self, args: &Value) -> Result<Value, String> {
        let title = args
            .get("title")
            .and_then(|v| v.as_str())
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .ok_or("Missing required `title`.")?;
        let category = args.get("category").and_then(|v| v.as_str());
        let explanation = args.get("explanation_markdown").and_then(|v| v.as_str()).map(markdown_to_html);

        let existing_id = args.get("id").and_then(|v| v.as_i64()).or_else(|| {
            let low = title.to_lowercase();
            self.vault
                .cache
                .get("Keyword")
                .map(|v| v.as_slice())
                .unwrap_or(&[])
                .iter()
                .find(|k| k.get("title").and_then(|v| v.as_str()).map(|t| t.to_lowercase() == low).unwrap_or(false))
                .and_then(|k| k.get("id").and_then(|v| v.as_i64()))
        });

        let mut patch = Map::new();
        patch.insert("title".into(), json!(title));
        if let Some(c) = category {
            patch.insert("category".into(), json!(c));
        }
        if let Some(e) = explanation {
            patch.insert("explanation".into(), json!(e));
        }

        let rec = if let Some(id) = existing_id {
            self.vault
                .update_entity("Keyword", id, &Value::Object(patch))
                .map_err(|e| format!("{}: {}", e.code, e.message))?
        } else {
            self.vault
                .create_entity("Keyword", &Value::Object(patch))
                .map_err(|e| format!("{}: {}", e.code, e.message))?
        };
        self.rebuild_indexes();
        let id = rec.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
        Ok(json!({
            "saved": true,
            "source_id": format!("keyword:{id}"),
            "id": id,
            "title": str_field(&rec, "title"),
            "category": str_field(&rec, "category"),
        }))
    }

    fn tool_upsert_timeline(&mut self, args: &Value) -> Result<Value, String> {
        let existing_id = args.get("id").and_then(|v| v.as_i64());
        let mut events: Vec<Value> = if let Some(id) = existing_id {
            let cur = self
                .vault
                .get_entity("Timegraph", id)
                .map_err(|e| format!("{}: {}", e.code, e.message))?;
            cur.get("events")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default()
        } else {
            Vec::new()
        };

        if let Some(rem_id) = args.get("remove_event_id").and_then(|v| v.as_str()) {
            events.retain(|ev| json_id_str(ev.get("id")) != rem_id);
        }
        if let Some(upd_ev) = args.get("update_event").and_then(|v| v.as_object()) {
            let target_id = json_id_str(upd_ev.get("id"));
            if let Some(slot) = events.iter_mut().find(|ev| json_id_str(ev.get("id")) == target_id) {
                if let Some(obj) = slot.as_object_mut() {
                    for (k, v) in upd_ev {
                        if k == "description_markdown" {
                            if let Some(s) = v.as_str() {
                                obj.insert("description".into(), json!(markdown_to_html(s)));
                            }
                        } else {
                            obj.insert(k.clone(), v.clone());
                        }
                    }
                }
            }
        }
        if let Some(add_arr) = args.get("add_events").and_then(|v| v.as_array()) {
            for ev in add_arr {
                let mut ev_obj = ev.as_object().cloned().unwrap_or_default();
                if !ev_obj.contains_key("id") {
                    ev_obj.insert("id".into(), json!(uuid::Uuid::new_v4().to_string()));
                }
                if let Some(md) = ev_obj.remove("description_markdown").and_then(|v| v.as_str().map(|s| s.to_string())) {
                    ev_obj.insert("description".into(), json!(markdown_to_html(&md)));
                }
                events.push(Value::Object(ev_obj));
            }
        }

        let mut patch = Map::new();
        if let Some(t) = args.get("title").and_then(|v| v.as_str()) {
            patch.insert("title".into(), json!(t.trim()));
        }
        if let Some(d) = args.get("description_markdown").and_then(|v| v.as_str()) {
            patch.insert("description".into(), json!(markdown_to_html(d)));
        }
        if let Some(fid) = args.get("folder_id") {
            patch.insert("folder_id".into(), fid.clone());
        }
        patch.insert("events".into(), Value::Array(events));

        let rec = if let Some(id) = existing_id {
            self.vault
                .update_entity("Timegraph", id, &Value::Object(patch))
                .map_err(|e| format!("{}: {}", e.code, e.message))?
        } else {
            if !patch.contains_key("title") {
                return Err("Missing required `title` when creating a new timeline.".into());
            }
            self.vault
                .create_entity("Timegraph", &Value::Object(patch))
                .map_err(|e| format!("{}: {}", e.code, e.message))?
        };
        self.rebuild_indexes();
        let id = rec.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
        let ev_count = rec.get("events").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
        Ok(json!({
            "saved": true,
            "source_id": format!("timeline:{id}"),
            "id": id,
            "title": str_field(&rec, "title"),
            "event_count": ev_count,
        }))
    }

    fn tool_upsert_spreadsheet(&mut self, args: &Value) -> Result<Value, String> {
        let existing_id = args.get("id").and_then(|v| v.as_i64());
        let mut workbook = if let Some(id) = existing_id {
            let cur = self
                .vault
                .get_entity("Spreadsheet", id)
                .map_err(|e| format!("{}: {}", e.code, e.message))?;
            cur.get("workbook")
                .cloned()
                .unwrap_or_else(|| json!({ "version": 1, "activeSheetId": "sheet-1", "sheets": [] }))
        } else {
            json!({
                "version": 1,
                "activeSheetId": "sheet-1",
                "sheets": [{ "id": "sheet-1", "name": "Sheet 1", "cells": {} }]
            })
        };

        let target_sheet_name = args.get("sheet_name").and_then(|v| v.as_str()).unwrap_or("Sheet 1");
        if let Some(cells_patch) = args.get("cells").and_then(|v| v.as_object()) {
            let sheets = workbook
                .as_object_mut()
                .unwrap()
                .entry("sheets")
                .or_insert_with(|| json!([]))
                .as_array_mut()
                .unwrap();

            let sheet_idx = sheets
                .iter()
                .position(|sh| {
                    sh.get("name")
                        .and_then(|v| v.as_str())
                        .map(|n| n.eq_ignore_ascii_case(target_sheet_name))
                        .unwrap_or(false)
                })
                .unwrap_or_else(|| {
                    let sid = format!("sheet-{}", sheets.len() + 1);
                    sheets.push(json!({ "id": sid, "name": target_sheet_name, "cells": {} }));
                    sheets.len() - 1
                });

            let cells_map = sheets[sheet_idx]
                .as_object_mut()
                .unwrap()
                .entry("cells")
                .or_insert_with(|| json!({}))
                .as_object_mut()
                .unwrap();

            for (addr, cval) in cells_patch {
                let norm_addr = addr.trim().to_uppercase();
                if cval.is_null() {
                    cells_map.remove(&norm_addr);
                } else if let Some(cobj) = cval.as_object() {
                    let mut cell = Map::new();
                    if let Some(v) = cobj.get("value").or_else(|| cobj.get("v")) {
                        cell.insert("v".into(), v.clone());
                    }
                    if let Some(f) = cobj.get("formula").or_else(|| cobj.get("f")).and_then(|x| x.as_str()) {
                        cell.insert("f".into(), json!(f.trim_start_matches('=')));
                    }
                    if let Some(n) = cobj.get("note").and_then(|x| x.as_str()) {
                        cell.insert("note".into(), json!(n));
                    }
                    if let Some(l) = cobj.get("link").and_then(|x| x.as_str()) {
                        cell.insert("link".into(), json!(l));
                    }
                    cells_map.insert(norm_addr, Value::Object(cell));
                } else {
                    cells_map.insert(norm_addr, json!({ "v": cval }));
                }
            }
        }

        let mut patch = Map::new();
        if let Some(t) = args.get("title").and_then(|v| v.as_str()) {
            patch.insert("title".into(), json!(t.trim()));
        }
        if let Some(fid) = args.get("folder_id") {
            patch.insert("folder_id".into(), fid.clone());
        }
        patch.insert("workbook".into(), workbook);

        let rec = if let Some(id) = existing_id {
            self.vault
                .update_entity("Spreadsheet", id, &Value::Object(patch))
                .map_err(|e| format!("{}: {}", e.code, e.message))?
        } else {
            if !patch.contains_key("title") {
                return Err("Missing required `title` when creating a new spreadsheet.".into());
            }
            self.vault
                .create_entity("Spreadsheet", &Value::Object(patch))
                .map_err(|e| format!("{}: {}", e.code, e.message))?
        };
        self.rebuild_indexes();
        let id = rec.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
        Ok(json!({
            "saved": true,
            "source_id": format!("spreadsheet:{id}"),
            "id": id,
            "title": str_field(&rec, "title"),
        }))
    }

    fn tool_manage_folder(&mut self, args: &Value) -> Result<Value, String> {
        let action = args.get("action").and_then(|v| v.as_str()).unwrap_or("create");
        match action {
            "create" => {
                let title = args
                    .get("title")
                    .and_then(|v| v.as_str())
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .ok_or("Missing required `title`.")?;
                let created = self
                    .vault
                    .create_entity("WebFolder", &json!({ "title": title, "name": title }))
                    .map_err(|e| format!("{}: {}", e.code, e.message))?;
                Ok(json!({ "created": true, "folder": created }))
            }
            "rename" => {
                let fid = args.get("folder_id").and_then(|v| v.as_i64()).ok_or("Missing `folder_id`.")?;
                let title = args.get("title").and_then(|v| v.as_str()).ok_or("Missing `title`.")?;
                let updated = self
                    .vault
                    .update_entity("WebFolder", fid, &json!({ "title": title.trim(), "name": title.trim() }))
                    .map_err(|e| format!("{}: {}", e.code, e.message))?;
                Ok(json!({ "updated": true, "folder": updated }))
            }
            "assign" => {
                let et = args.get("entity_type").and_then(|v| v.as_str()).ok_or("Missing `entity_type`.")?;
                let eid = args.get("entity_id").and_then(|v| v.as_i64()).ok_or("Missing `entity_id`.")?;
                let fid = args.get("folder_id").cloned().unwrap_or(Value::Null);
                let updated = self
                    .vault
                    .update_entity(et, eid, &json!({ "folder_id": fid }))
                    .map_err(|e| format!("{}: {}", e.code, e.message))?;
                self.rebuild_indexes();
                Ok(json!({ "assigned": true, "entity_type": et, "entity_id": eid, "folder_id": updated.get("folder_id") }))
            }
            other => Err(format!("Unsupported folder action '{other}'. Use 'create', 'rename', or 'assign'.")),
        }
    }

    fn tool_create_mind_link(&mut self, args: &Value) -> Result<Value, String> {
        let ft = args.get("from_type").and_then(|v| v.as_str()).ok_or("Missing `from_type`.")?;
        let fid = args.get("from_id").and_then(|v| v.as_i64()).ok_or("Missing `from_id`.")?;
        let tt = args.get("to_type").and_then(|v| v.as_str()).ok_or("Missing `to_type`.")?;
        let tid = args.get("to_id").and_then(|v| v.as_i64()).ok_or("Missing `to_id`.")?;
        let label = args.get("label").and_then(|v| v.as_str()).unwrap_or("");
        let created = self
            .vault
            .create_entity(
                "MindLink",
                &json!({
                    "from_type": ft,
                    "from_id": fid,
                    "to_type": tt,
                    "to_id": tid,
                    "label": label,
                }),
            )
            .map_err(|e| format!("{}: {}", e.code, e.message))?;
        self.rebuild_indexes();
        Ok(json!({ "created": true, "mind_link": created }))
    }

    fn tool_delete_entity(&mut self, args: &Value) -> Result<Value, String> {
        let et = args
            .get("entity_type")
            .and_then(|v| v.as_str())
            .ok_or("Missing required `entity_type`.")?;
        let id = args.get("id").and_then(|v| v.as_i64()).ok_or("Missing required `id`.")?;
        let allowed = [
            "MindNote",
            "Annotation",
            "StudyChapter",
            "KnowledgeWeb",
            "WebCard",
            "WebConnection",
            "CanvasObject",
            "Keyword",
            "Timegraph",
            "Spreadsheet",
            "WebFolder",
            "MindLink",
            "StudyConnection",
        ];
        if !allowed.contains(&et) {
            return Err(format!("Deleting `{et}` is not allowed via MCP."));
        }
        if et == "KnowledgeWeb" {
            if let Ok(web) = self.vault.get_entity("KnowledgeWeb", id) {
                if is_private_web(&web) {
                    return Err("Cannot delete a password-locked private Knowledge Web via MCP.".into());
                }
            }
        }
        if et == "WebCard" {
            if let Ok(card) = self.vault.get_entity("WebCard", id) {
                let wid = card.get("web_id").and_then(|v| v.as_i64()).unwrap_or(0);
                if let Ok(web) = self.vault.get_entity("KnowledgeWeb", wid) {
                    if is_private_web(&web) {
                        return Err("Cannot delete cards inside a password-locked private Knowledge Web.".into());
                    }
                }
            }
        }
        let res = self
            .vault
            .delete_entity(et, id)
            .map_err(|e| format!("{}: {}", e.code, e.message))?;
        self.rebuild_indexes();
        Ok(json!({ "deleted": true, "entity_type": et, "id": id, "result": res }))
    }

    // ── MCP Dispatch ───────────────────────────────────────────────────────

    fn call_tool(&mut self, name: &str, args: &Value) -> Result<Value, String> {
        self.refresh_if_changed();
        match name {
            "bex_library_overview" => Ok(self.tool_library_overview()),
            "bex_search" => self.tool_search(args),
            "bex_get_commentary" => self.tool_get_commentary(args),
            "bex_get_bible_passage" => self.tool_get_bible_passage(args),
            "bex_get_note" => self.tool_get_note(args),
            "bex_get_knowledge_web" => self.tool_get_knowledge_web(args),
            "bex_get_keywords" => Ok(self.tool_get_keywords(args)),
            "bex_get_timeline" => self.tool_get_timeline(args),
            "bex_get_spreadsheet" => self.tool_get_spreadsheet(args),
            "bex_get_connections" => self.tool_get_connections(args),
            "bex_theological_dossier" => self.tool_theological_dossier(args),
            "bex_create_note" => self.tool_create_note(args),
            "bex_append_to_note" => self.tool_append_to_note(args),
            "bex_update_note" => self.tool_update_note(args),
            "bex_create_commentary" => self.tool_create_commentary(args),
            "bex_update_commentary" => self.tool_update_commentary(args),
            "bex_upsert_study_chapter" => self.tool_upsert_study_chapter(args),
            "bex_create_knowledge_web" => self.tool_create_knowledge_web(args),
            "bex_create_web_card" => self.tool_create_web_card(args),
            "bex_update_web_card" => self.tool_update_web_card(args),
            "bex_manage_web_connection" => self.tool_manage_web_connection(args),
            "bex_upsert_keyword" => self.tool_upsert_keyword(args),
            "bex_upsert_timeline" => self.tool_upsert_timeline(args),
            "bex_upsert_spreadsheet" => self.tool_upsert_spreadsheet(args),
            "bex_manage_folder" => self.tool_manage_folder(args),
            "bex_create_mind_link" => self.tool_create_mind_link(args),
            "bex_delete_entity" => self.tool_delete_entity(args),
            "bex_open_in_bex" => self.tool_open_in_bex(args),
            _ => Err(format!("Unknown tool: {name}")),
        }
    }

    fn read_resource(&mut self, uri: &str) -> Result<Value, String> {
        self.refresh_if_changed();
        let data = match uri {
            "bex://overview" => self.tool_library_overview(),
            "bex://commentary-index" => {
                let ov = self.tool_library_overview();
                json!({
                    "total_commentaries": ov["counts"]["commentaries"],
                    "bible_commentary_index": ov["bible_commentary_index"],
                })
            }
            "bex://keywords" => self.tool_get_keywords(&json!({})),
            "bex://graph" => json!({
                "node_count": self.graph.nodes.len(),
                "edge_count": self.graph.edges.len(),
                "edges": self.graph.edges.iter().take(500).collect::<Vec<_>>(),
            }),
            _ => return Err(format!("Unknown resource URI: {uri}")),
        };
        Ok(json!({
            "contents": [{
                "uri": uri,
                "mimeType": "application/json",
                "text": serde_json::to_string_pretty(&data).unwrap_or_default(),
            }]
        }))
    }
}

fn filter_verses_from_chapter_text(chapter_text: &str, start_verse: i64, end_verse: i64) -> String {
    let mut selected = Vec::new();
    let mut current_verse: Option<i64> = None;

    for line in chapter_text.lines() {
        let trimmed = line.trim();
        // Local Bible JSON/LSV lines often begin with `~12 ...` or `12 ...` or `[12] ...`
        if let Some(vn) = parse_leading_verse_number(trimmed) {
            current_verse = Some(vn);
        }
        if let Some(vn) = current_verse {
            if vn >= start_verse && vn <= end_verse {
                selected.push(trimmed.to_string());
            }
        }
    }

    if selected.is_empty() {
        chapter_text.to_string()
    } else {
        selected.join("\n")
    }
}

fn parse_leading_verse_number(line: &str) -> Option<i64> {
    let s = line.trim_start_matches(['~', '[', '(']);
    let digits_len = s.chars().take_while(|c| c.is_ascii_digit()).count();
    if digits_len == 0 || digits_len > 3 {
        return None;
    }
    let after = &s[digits_len..];
    if after.starts_with(' ') || after.starts_with(']') || after.starts_with(')') || after.starts_with('.') {
        s[..digits_len].parse::<i64>().ok()
    } else {
        None
    }
}

fn extract_timeline_sort_year(start: Option<&Value>) -> f64 {
    let Some(v) = start else {
        return f64::INFINITY;
    };
    if let Some(n) = v.as_f64() {
        return n;
    }
    if let Some(obj) = v.as_object() {
        if let Some(y) = obj.get("year").and_then(|x| x.as_f64()) {
            let m = obj.get("month").and_then(|x| x.as_f64()).unwrap_or(1.0);
            let d = obj.get("day").and_then(|x| x.as_f64()).unwrap_or(1.0);
            return y + (m - 1.0) / 12.0 + (d - 1.0) / 366.0;
        }
    }
    f64::INFINITY
}

fn tools_schema() -> Value {
    json!([
        {
            "name": "bex_library_overview",
            "description": "Returns a complete live inventory of the user's BEX Vault: counts, all Notes (with page counts), Knowledge Webs (with card/connection counts), Timelines, Spreadsheets, Keywords, and an index of every Bible Book & Chapter containing user Commentary.",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        },
        {
            "name": "bex_search",
            "description": "Fast hybrid search across the entire BEX Vault (Notes, Book Pages, Bible Commentaries, Chapter Studies, Knowledge Webs, Web Cards, Keywords, Timelines/Events, Spreadsheets, Study Canvas). Supports exact FTS5, conceptual/theological thesaurus search (e.g. 'sovereignty' finds 'dominion'/'jurisdiction'), and Bible citation matching.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Search query, theological concept, or Bible reference." },
                    "types": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Optional filter by entity type (e.g. ['Note', 'Commentary', 'Web Card', 'Keyword', 'Timeline', 'Spreadsheet'])."
                    },
                    "mode": {
                        "type": "string",
                        "enum": ["hybrid", "exact", "conceptual"],
                        "description": "Search mode (default 'hybrid')."
                    },
                    "limit": { "type": "integer", "description": "Max results (1-100, default 20)." }
                },
                "required": ["query"]
            }
        },
        {
            "name": "bex_get_commentary",
            "description": "Retrieves all of the user's Bible Commentary (Annotations), Chapter Study writing (notes/context/application), cross-references citing the passage, permanent StudyConnections, and optional offline Scripture text for any verse, verse range, chapter, or book (e.g. 'Matthew 4:9').",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Natural Bible reference such as 'Matthew 4:9', 'Matt 4:8-11', or 'Romans 8'." },
                    "book": { "type": "string", "description": "Bible book name or abbreviation (if not using `query`)." },
                    "chapter": { "type": "integer", "description": "Chapter number." },
                    "verse": { "type": "integer", "description": "Start verse number." },
                    "end_verse": { "type": "integer", "description": "Optional end verse number for ranges." },
                    "include_bible_text": { "type": "boolean", "description": "Include offline Bible text for context (default true)." },
                    "bible_version": { "type": "string", "description": "Offline translation code (default 'BSB'; supports KJV, LSV, YLT, ASV, WEB, BGB, BIB, etc.)." }
                }
            }
        },
        {
            "name": "bex_get_bible_passage",
            "description": "Reads exact Scripture text directly from BEX's 20 bundled offline Bible translations (BSB, KJV, LSV, YLT, ASV, WEB, BGB Greek NT, BIB Interlinear NT, etc.) and optional MAM Hebrew Old Testament.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Natural reference like 'Matthew 4:9' or 'Genesis 1:1-5'." },
                    "book": { "type": "string", "description": "Bible book name." },
                    "chapter": { "type": "integer", "description": "Chapter number." },
                    "verse": { "type": "integer", "description": "Start verse." },
                    "end_verse": { "type": "integer", "description": "End verse." },
                    "version": { "type": "string", "description": "Translation code (default 'BSB')." },
                    "include_hebrew": { "type": "boolean", "description": "Include MAM Masoretic Hebrew for Old Testament passages (default false)." }
                }
            }
        },
        {
            "name": "bex_get_note",
            "description": "Reads the complete lossless Markdown content of a BEX Note or multi-page Book (preserving headings, footnotes, comments, tooltips, keyword links, and verse citations), plus its graph connections.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "integer", "description": "Numeric Note ID." },
                    "title": { "type": "string", "description": "Note title (exact or partial match)." },
                    "page": { "type": "integer", "description": "Optional 1-based page number for multi-page books." }
                }
            }
        },
        {
            "name": "bex_get_knowledge_web",
            "description": "Reads a BEX Knowledge Web including all Cards (full Markdown + tags), Canvas Sections/Objects, and the complete directed/undirected argument graph connecting cards.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "integer", "description": "Numeric Knowledge Web ID." },
                    "title": { "type": "string", "description": "Knowledge Web title (exact or partial match)." },
                    "include_cards": { "type": "boolean", "description": "Include full card bodies (default true)." }
                }
            }
        },
        {
            "name": "bex_get_keywords",
            "description": "Lists or searches the user's theological Keywords/Glossary definitions along with everywhere each keyword is referenced in the Vault.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Optional search filter on keyword title or explanation." },
                    "category": { "type": "string", "description": "Optional category filter." },
                    "id": { "type": "integer", "description": "Optional specific keyword ID." }
                }
            }
        },
        {
            "name": "bex_get_timeline",
            "description": "Reads a BEX Chronological Timeline (Timegraph) sorted by date with all events, precision, descriptions, tags, and linked BEX items.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "integer", "description": "Timeline ID." },
                    "title": { "type": "string", "description": "Timeline title (exact or partial match)." }
                }
            }
        },
        {
            "name": "bex_get_spreadsheet",
            "description": "Reads a BEX Spreadsheet workbook (decompressed) including all sheets, non-empty cell values, formulas, cell notes, and BEX links.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "integer", "description": "Spreadsheet ID." },
                    "title": { "type": "string", "description": "Spreadsheet title (exact or partial match)." },
                    "sheet": { "type": "string", "description": "Optional sheet name filter." }
                }
            }
        },
        {
            "name": "bex_get_connections",
            "description": "Traverses the multi-layer BEX relationship graph (MindLinks, WebConnections, StudyConnections, inline HTML links, timeline/spreadsheet links, and shared Scripture citations) up to 3 hops from any Source ID.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "source_id": { "type": "string", "description": "Canonical Source ID like 'note:12', 'commentary:42', 'web:5/card:99', 'keyword:7', or 'verse:Matthew 4:9'." },
                    "depth": { "type": "integer", "description": "Hop depth (1-3, default 2)." }
                },
                "required": ["source_id"]
            }
        },
        {
            "name": "bex_theological_dossier",
            "description": "One-call comprehensive research bundle for theological stance synthesis and consistency auditing. Given a topic and optional Bible passages (e.g. topic='Satan jurisdiction and authority', passages=['Matthew 4:9']), retrieves exact passage commentaries, full Markdown of top hybrid/conceptual matches across all Notes/Web Cards/Keywords/Timelines, and 1-hop graph neighbors.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "topic": { "type": "string", "description": "Theological doctrine, question, or concept to investigate." },
                    "passages": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Optional list of Bible passages to inspect alongside the topic (e.g. ['Matthew 4:9', 'Luke 4:5-7'])."
                    },
                    "max_items": { "type": "integer", "description": "Max full-text evidence items to return (3-30, default 12)." }
                },
                "required": ["topic"]
            }
        },
        {
            "name": "bex_create_note",
            "description": "Creates a new encrypted Note in the user's BEX Vault from Markdown (safe, additive only).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": { "type": "string", "description": "Title of the new note." },
                    "markdown_content": { "type": "string", "description": "Body content in Markdown." },
                    "folder_id": { "type": "integer", "description": "Optional WebFolder ID." }
                },
                "required": ["title", "markdown_content"]
            }
        },
        {
            "name": "bex_append_to_note",
            "description": "Safely appends a new section or new book page to an existing BEX Note without overwriting existing content.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "note_id": { "type": "integer", "description": "Numeric ID of the existing MindNote." },
                    "markdown_content": { "type": "string", "description": "Markdown content to append." },
                    "heading": { "type": "string", "description": "Optional section heading or new page title." },
                    "as_new_page": { "type": "boolean", "description": "Append as a new book page break (default false)." }
                },
                "required": ["note_id", "markdown_content"]
            }
        },
        {
            "name": "bex_create_commentary",
            "description": "Adds a new encrypted Bible Commentary (Annotation) card on a specific verse or verse range in the user's BEX Vault.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "book": { "type": "string", "description": "Bible book name (e.g. 'Matthew')." },
                    "chapter": { "type": "integer", "description": "Chapter number." },
                    "start_verse": { "type": "integer", "description": "Starting verse number." },
                    "end_verse": { "type": "integer", "description": "Optional ending verse number." },
                    "markdown_content": { "type": "string", "description": "Commentary text in Markdown." },
                    "version": { "type": "string", "description": "Bible version code (default 'BSB')." },
                    "selected_text": { "type": "string", "description": "Optional quoted Scripture anchor text." }
                },
                "required": ["book", "chapter", "start_verse", "markdown_content"]
            }
        },
        {
            "name": "bex_create_web_card",
            "description": "Adds a new Card (and optional directed connection) to an existing non-private Knowledge Web in the user's BEX Vault.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "web_id": { "type": "integer", "description": "Target Knowledge Web ID." },
                    "title": { "type": "string", "description": "Card title." },
                    "markdown_content": { "type": "string", "description": "Card description in Markdown." },
                    "tags": { "type": "array", "items": { "type": "string" }, "description": "Optional tags." },
                    "connect_to_card_id": { "type": "integer", "description": "Optional existing Card ID to connect this card to." },
                    "connection_label": { "type": "string", "description": "Optional edge label." }
                },
                "required": ["web_id", "title"]
            }
        },
        {
            "name": "bex_update_note",
            "description": "Updates an existing BEX Note or a specific page inside a multi-page Book (title, folder, or Markdown content).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "note_id": { "type": "integer", "description": "Numeric Note ID." },
                    "title": { "type": "string", "description": "Optional new note title." },
                    "markdown_content": { "type": "string", "description": "Optional replacement Markdown content (for the whole note or for `page`)." },
                    "page": { "type": "integer", "description": "Optional 1-based page number to update inside a multi-page book." },
                    "page_title": { "type": "string", "description": "Optional new page title when updating a specific book page." },
                    "folder_id": { "type": ["integer", "null"], "description": "Optional folder ID or null to unfile." }
                },
                "required": ["note_id"]
            }
        },
        {
            "name": "bex_update_commentary",
            "description": "Updates an existing Bible Commentary (Annotation) card's Markdown body, verse range, or selected Scripture anchor.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "commentary_id": { "type": "integer", "description": "Numeric Annotation ID." },
                    "markdown_content": { "type": "string", "description": "Updated commentary Markdown." },
                    "start_verse": { "type": "integer", "description": "Optional updated start verse." },
                    "end_verse": { "type": "integer", "description": "Optional updated end verse." },
                    "selected_text": { "type": "string", "description": "Optional updated Scripture anchor." }
                },
                "required": ["commentary_id"]
            }
        },
        {
            "name": "bex_upsert_study_chapter",
            "description": "Creates or updates chapter-level Bible Study writing (`notes`, `context`, `application`) for a book and chapter.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "book": { "type": "string", "description": "Bible book name." },
                    "chapter": { "type": "integer", "description": "Chapter number." },
                    "version": { "type": "string", "description": "Bible edition code (default 'BSB')." },
                    "notes": { "type": "string", "description": "Optional chapter notes in Markdown." },
                    "context": { "type": "string", "description": "Optional historical/literary context in Markdown." },
                    "application": { "type": "string", "description": "Optional application notes in Markdown." }
                },
                "required": ["book", "chapter"]
            }
        },
        {
            "name": "bex_create_knowledge_web",
            "description": "Creates a new Knowledge Web in the user's BEX Vault.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": { "type": "string", "description": "Knowledge Web title." },
                    "description_markdown": { "type": "string", "description": "Optional description in Markdown." },
                    "folder_id": { "type": "integer", "description": "Optional WebFolder ID." }
                },
                "required": ["title"]
            }
        },
        {
            "name": "bex_update_web_card",
            "description": "Updates an existing Card inside a non-private Knowledge Web (title, Markdown body, tags, or link_url).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "card_id": { "type": "integer", "description": "Numeric WebCard ID." },
                    "title": { "type": "string", "description": "Optional new title." },
                    "markdown_content": { "type": "string", "description": "Optional new Markdown description." },
                    "tags": { "type": "array", "items": { "type": "string" }, "description": "Optional updated tags array." },
                    "link_url": { "type": "string", "description": "Optional card link URL." }
                },
                "required": ["card_id"]
            }
        },
        {
            "name": "bex_manage_web_connection",
            "description": "Creates, updates, or deletes a directed/undirected connection edge between Cards inside a Knowledge Web.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": { "type": "string", "enum": ["create", "update", "delete"], "description": "Operation to perform." },
                    "web_id": { "type": "integer", "description": "Knowledge Web ID (required for create)." },
                    "connection_id": { "type": "integer", "description": "WebConnection ID (required for update/delete)." },
                    "from_card_id": { "type": "integer", "description": "Source Card ID (required for create)." },
                    "to_card_id": { "type": "integer", "description": "Target Card ID (required for create)." },
                    "label": { "type": "string", "description": "Optional edge label." },
                    "has_arrow": { "type": "boolean", "description": "Directed arrow (default true)." }
                },
                "required": ["action"]
            }
        },
        {
            "name": "bex_upsert_keyword",
            "description": "Creates or updates a theological Keyword/Glossary entry.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "integer", "description": "Optional existing Keyword ID to update." },
                    "title": { "type": "string", "description": "Keyword term/title." },
                    "category": { "type": "string", "description": "Optional theological category." },
                    "explanation_markdown": { "type": "string", "description": "Definition/explanation in Markdown." }
                },
                "required": ["title"]
            }
        },
        {
            "name": "bex_upsert_timeline",
            "description": "Creates a Chronological Timeline (Timegraph) or updates its metadata and events (add/update/remove events).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "integer", "description": "Optional existing Timeline ID to update." },
                    "title": { "type": "string", "description": "Timeline title (required on create)." },
                    "description_markdown": { "type": "string", "description": "Optional description in Markdown." },
                    "folder_id": { "type": ["integer", "null"], "description": "Optional folder ID." },
                    "add_events": { "type": "array", "items": { "type": "object" }, "description": "Events to append ({ title, start, end?, description_markdown?, tags?, links? })." },
                    "update_event": { "type": "object", "description": "Partial update for an existing event ({ id, ... })." },
                    "remove_event_id": { "type": "string", "description": "Event ID to remove." }
                }
            }
        },
        {
            "name": "bex_upsert_spreadsheet",
            "description": "Creates a BEX Spreadsheet or updates/clears specific cells (values, formulas, notes, BEX links) with full compressed workbook parity.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "integer", "description": "Optional existing Spreadsheet ID to update." },
                    "title": { "type": "string", "description": "Spreadsheet title (required on create)." },
                    "folder_id": { "type": ["integer", "null"], "description": "Optional folder ID." },
                    "sheet_name": { "type": "string", "description": "Target sheet name (default 'Sheet 1'; created if missing)." },
                    "cells": { "type": "object", "description": "Map of cell address (e.g. 'A1') to scalar value, { value, formula?, note?, link? }, or null to clear." }
                }
            }
        },
        {
            "name": "bex_manage_folder",
            "description": "Creates or renames a library folder (WebFolder), or assigns any Note, Knowledge Web, Timeline, StudyChapter, or Spreadsheet to a folder.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": { "type": "string", "enum": ["create", "rename", "assign"], "description": "Folder action." },
                    "folder_id": { "type": ["integer", "null"], "description": "Folder ID (for rename/assign; null unfiles on assign)." },
                    "title": { "type": "string", "description": "Folder name (for create/rename)." },
                    "entity_type": { "type": "string", "description": "Entity type for assign (MindNote, KnowledgeWeb, Timegraph, StudyChapter, Spreadsheet)." },
                    "entity_id": { "type": "integer", "description": "Entity ID for assign." }
                },
                "required": ["action"]
            }
        },
        {
            "name": "bex_create_mind_link",
            "description": "Creates an explicit library-wide link (MindLink) connecting any two BEX items (note, web, timeline, spreadsheet, keyword, commentary, study).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "from_type": { "type": "string", "description": "Source item type (e.g. 'note', 'web', 'commentary')." },
                    "from_id": { "type": "integer", "description": "Source item ID." },
                    "to_type": { "type": "string", "description": "Target item type." },
                    "to_id": { "type": "integer", "description": "Target item ID." },
                    "label": { "type": "string", "description": "Optional relationship label." }
                },
                "required": ["from_type", "from_id", "to_type", "to_id"]
            }
        },
        {
            "name": "bex_delete_entity",
            "description": "Deletes a non-private BEX entity (MindNote, Annotation, StudyChapter, KnowledgeWeb, WebCard, WebConnection, CanvasObject, Keyword, Timegraph, Spreadsheet, WebFolder, MindLink, StudyConnection) and cleans up its encrypted ai_semantic_index row.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "entity_type": { "type": "string", "description": "Exact entity type to delete." },
                    "id": { "type": "integer", "description": "Numeric entity ID." }
                },
                "required": ["entity_type", "id"]
            }
        },
        {
            "name": "bex_open_in_bex",
            "description": "Opens or focuses the native macOS /Applications/BEX.app window, optionally navigating to a specific route or Bible passage.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Optional BEX route (e.g. '/notes/12', '/knowledge-webs/5')." },
                    "book": { "type": "string", "description": "Optional Bible book to open in Study." },
                    "chapter": { "type": "integer", "description": "Optional chapter." },
                    "verse": { "type": "integer", "description": "Optional verse." }
                }
            }
        },
        {
            "name": "bex_open_pane",
            "title": "BEX",
            "description": "Opens the full interactive BEX application (Notes, Knowledge Webs, Bible Study, Timelines, Spreadsheets — full read + write synced with your encrypted Vault) directly inside Antigravity's side pane right next to the chat. Calling it again navigates the open pane without reloading.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "route": { "type": "string", "description": "Optional BEX route (e.g. '/', '/notes/19', '/knowledge-webs/2', '/Study?q=Matthew%204:9')." },
                    "book": { "type": "string", "description": "Optional Bible book to open directly in Study." },
                    "chapter": { "type": "integer", "description": "Optional chapter number." },
                    "verse": { "type": "integer", "description": "Optional verse number." },
                    "query": { "type": "string", "description": "Optional Scripture reference like 'Matthew 4:9'." }
                }
            },
            "_meta": {
                "ui": {
                    "resourceUri": "ui://bex/pane.html"
                },
                "com.google.antigravity/ui": {
                    "entrypoints": [
                        { "type": "aux_pane", "title": "BEX" },
                        { "type": "global", "title": "BEX" }
                    ]
                }
            }
        }
    ])
}

fn resources_schema(pane_meta: Value) -> Value {
    json!([
        {
            "uri": PANE_URI,
            "name": "BEX Side Pane App",
            "description": "Interactive full BEX application embedded inside Antigravity's side pane over a local 127.0.0.1 encrypted Vault bridge.",
            "mimeType": "text/html;profile=mcp-app",
            "_meta": pane_meta
        },
        {
            "uri": "bex://overview",
            "name": "BEX Vault Overview",
            "description": "Live directory of all Notes, Knowledge Webs, Timelines, Spreadsheets, Keywords, and commented Bible Books/Chapters.",
            "mimeType": "application/json"
        },
        {
            "uri": "bex://commentary-index",
            "name": "BEX Bible Commentary Index",
            "description": "Map of every Bible book, chapter, and verse where the user has written commentary.",
            "mimeType": "application/json"
        },
        {
            "uri": "bex://keywords",
            "name": "BEX Theological Keywords",
            "description": "Complete glossary of user-defined theological keywords and cross-references.",
            "mimeType": "application/json"
        },
        {
            "uri": "bex://graph",
            "name": "BEX Relationship Graph",
            "description": "Nodes and edges connecting Notes, Knowledge Web Cards, Commentaries, Keywords, Timelines, and Scripture citations.",
            "mimeType": "application/json"
        }
    ])
}

fn write_json_line(out: &mut impl Write, val: &Value) {
    if let Ok(s) = serde_json::to_string(val) {
        let _ = writeln!(out, "{s}");
        let _ = out.flush();
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--self-test") {
        match McpHost::init(true) {
            Ok(host) => {
                let (ov, matt) = {
                    let mut guard = host.core.lock().unwrap();
                    let ov = guard.tool_library_overview();
                    let matt = guard
                        .tool_get_commentary(&json!({ "query": "Matthew 4:9", "include_bible_text": true }))
                        .unwrap_or_else(|e| json!({ "error": e }));
                    (ov, matt)
                };
                let http_ok = host.loopback.as_ref().map(|lb| {
                    let health_url = format!("{}/__bex_health", lb.origin());
                    let html_url = lb.route_url("/");
                    json!({
                        "origin": lb.origin(),
                        "health_url": health_url,
                        "pane_ready": true,
                        "html_url_ready": !html_url.is_empty(),
                    })
                });
                println!(
                    "{}",
                    serde_json::to_string_pretty(&json!({
                        "status": "ok",
                        "server": SERVER_NAME,
                        "version": SERVER_VERSION,
                        "loopback_http": http_ok,
                        "ai_semantic_index": ov["ai_semantic_index"],
                        "counts": ov["counts"],
                        "bible_commentary_books": ov["bible_commentary_index"].as_object().map(|m| m.keys().cloned().collect::<Vec<_>>()).unwrap_or_default(),
                        "sample_matthew_4_9": {
                            "commentary_count": matt["commentary_count"],
                            "has_scripture_text": matt["scripture_text"]["text"].as_str().map(|s| !s.is_empty()).unwrap_or(false),
                        }
                    }))
                    .unwrap()
                );
                std::process::exit(0);
            }
            Err(e) => {
                eprintln!("bex-mcp self-test FAILED: {e}");
                std::process::exit(1);
            }
        }
    }

    let mut host_opt: Option<McpHost> = match McpHost::init(true) {
        Ok(h) => Some(h),
        Err(e) => {
            eprintln!("[bex-mcp] startup unlock warning: {e}");
            None
        }
    };

    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut out = stdout.lock();

    for line_res in stdin.lock().lines() {
        let Ok(line) = line_res else { break };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let req: Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(e) => {
                write_json_line(
                    &mut out,
                    &json!({
                        "jsonrpc": "2.0",
                        "id": Value::Null,
                        "error": { "code": -32700, "message": format!("Parse error: {e}") }
                    }),
                );
                continue;
            }
        };

        let id = req.get("id").cloned();
        let method = req.get("method").and_then(|v| v.as_str()).unwrap_or("");
        let params = req.get("params").cloned().unwrap_or_else(|| json!({}));

        // JSON-RPC notifications have no `id` and must not receive a response
        let Some(req_id) = id else {
            continue;
        };

        let response = match method {
            "initialize" => {
                let client_ver = params
                    .get("protocolVersion")
                    .and_then(|v| v.as_str())
                    .unwrap_or("2025-03-26");
                json!({
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "protocolVersion": client_ver,
                        "capabilities": {
                            "tools": { "listChanged": false },
                            "resources": { "subscribe": false, "listChanged": false }
                        },
                        "serverInfo": {
                            "name": SERVER_NAME,
                            "version": SERVER_VERSION
                        },
                        "instructions": SERVER_INSTRUCTIONS
                    }
                })
            }
            "ping" => json!({ "jsonrpc": "2.0", "id": req_id, "result": {} }),
            "tools/list" => json!({
                "jsonrpc": "2.0",
                "id": req_id,
                "result": { "tools": tools_schema() }
            }),
            "resources/list" => {
                let pmeta = host_opt
                    .as_ref()
                    .map(|h| h.pane_meta())
                    .unwrap_or_else(|| json!({ "ui": { "prefersBorder": false } }));
                json!({
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": { "resources": resources_schema(pmeta) }
                })
            }
            "tools/call" => {
                if host_opt.is_none() {
                    if let Ok(h) = McpHost::init(true) {
                        host_opt = Some(h);
                    }
                }
                let tool_name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let tool_args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
                match host_opt.as_ref() {
                    Some(host) => json!({
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "result": host.handle_tool_call(tool_name, &tool_args)
                    }),
                    None => json!({
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "result": {
                            "content": [{ "type": "text", "text": "BEX Vault is locked or unavailable. Open BEX.app once to unlock your Vault." }],
                            "isError": true
                        }
                    }),
                }
            }
            "resources/read" => {
                if host_opt.is_none() {
                    if let Ok(h) = McpHost::init(true) {
                        host_opt = Some(h);
                    }
                }
                let uri = params.get("uri").and_then(|v| v.as_str()).unwrap_or("");
                match host_opt.as_ref() {
                    Some(host) => match host.handle_resource_read(uri) {
                        Ok(res) => json!({ "jsonrpc": "2.0", "id": req_id, "result": res }),
                        Err(msg) => json!({
                            "jsonrpc": "2.0",
                            "id": req_id,
                            "error": { "code": -32602, "message": msg }
                        }),
                    },
                    None => json!({
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "error": { "code": -32000, "message": "BEX Vault unavailable." }
                    }),
                }
            }
            _ => json!({
                "jsonrpc": "2.0",
                "id": req_id,
                "error": { "code": -32601, "message": format!("Method not found: {method}") }
            }),
        };

        write_json_line(&mut out, &response);
    }
}
