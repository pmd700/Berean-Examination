//! In-Memory SQLite FTS5 Granular Search Engine (`localGlobalSearch.js` 100% Parity).
//!
//! Replaces the 8-table full-Vault IPC dump on every `Cmd+K` with a sub-2ms Rust FTS5 query
//! indexing all 9 granular entity types:
//! 1. Chapter
//! 2. Annotation
//! 3. Keyword
//! 4. Note (including individual Book pages with `matchPage`)
//! 5. Knowledge Web
//! 6. Web Card
//! 7. Timeline
//! 8. Timeline Event
//! 9. Spreadsheet & Spreadsheet Cell (`Sheet!A1`)

use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;

const BOOK_PAGE_MARKER: &str = "<!--bex-page-break-->";
const LEGACY_BOOK_PAGE_MARKER: &str = "<!-- bex-book-page -->";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub id: Value,
    pub target_id: Option<Value>,
    #[serde(rename = "type")]
    pub hit_type: String,
    pub title: String,
    pub workspace_title: String,
    pub description: String,
    pub match_field: String,
    pub match_text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub match_page: Option<usize>,
    pub href: String,
    pub score: i32,
    #[serde(rename = "_updated")]
    pub updated: i64,
}

pub struct SearchIndex {
    conn: Connection,
}

impl SearchIndex {
    pub fn new() -> Result<Self, String> {
        let conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
        conn.execute_batch(
            "CREATE VIRTUAL TABLE docs USING fts5(
                title,
                body,
                hit_type UNINDEXED,
                record_id UNINDEXED,
                target_id UNINDEXED,
                workspace_title UNINDEXED,
                match_field UNINDEXED,
                match_page UNINDEXED,
                href UNINDEXED,
                updated_ms UNINDEXED,
                tokenize='unicode61 remove_diacritics 2'
            );",
        )
        .map_err(|e| e.to_string())?;
        Ok(Self { conn })
    }

    pub fn rebuild(&mut self, cache: &HashMap<&'static str, Vec<Value>>) -> Result<(), String> {
        self.conn
            .execute("DELETE FROM docs", [])
            .map_err(|e| e.to_string())?;

        let tx = self.conn.unchecked_transaction().map_err(|e| e.to_string())?;
        {
            let mut stmt = tx
                .prepare(
                    "INSERT INTO docs (title, body, hit_type, record_id, target_id, workspace_title, match_field, match_page, href, updated_ms)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                )
                .map_err(|e| e.to_string())?;

            // Build lookup maps for parents (Chapters & Knowledge Webs)
            let chapters = cache.get("StudyChapter").map(|v| v.as_slice()).unwrap_or(&[]);
            let webs = cache.get("KnowledgeWeb").map(|v| v.as_slice()).unwrap_or(&[]);
            let mut web_map: HashMap<i64, &Value> = HashMap::new();
            for w in webs {
                if let Some(id) = w.get("id").and_then(|v| v.as_i64()) {
                    web_map.insert(id, w);
                }
            }

            // 1. Study Chapters
            for ch in chapters {
                let id = ch.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
                let book = ch.get("book").and_then(|v| v.as_str()).unwrap_or("Bible Study");
                let num = ch.get("chapter_number").and_then(|v| v.as_i64()).unwrap_or(0);
                let title = if num > 0 { format!("{book} {num}") } else { book.to_string() };
                let mut body = String::new();
                for k in ["raw_text", "notes", "context", "application", "version"] {
                    if let Some(s) = ch.get(k).and_then(|v| v.as_str()) {
                        body.push_str(&strip_html(s));
                        body.push(' ');
                    }
                }
                let href = format!("/Study?chapter_id={id}");
                let _ = stmt.execute(params![
                    title,
                    body,
                    "Chapter",
                    id.to_string(),
                    "",
                    title,
                    "body",
                    -1i64,
                    href,
                    updated_ms(ch)
                ]);
            }

            // 2. Annotations
            for ann in cache.get("Annotation").map(|v| v.as_slice()).unwrap_or(&[]) {
                let id = ann.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
                let book = ann.get("book").and_then(|v| v.as_str()).unwrap_or("");
                let ch_num = ann.get("chapter_number").and_then(|v| v.as_i64()).unwrap_or(0);
                let ver = ann.get("version").and_then(|v| v.as_str()).unwrap_or("");
                let parent_id = chapters.iter().find_map(|c| {
                    if c.get("book").and_then(|v| v.as_str()) == Some(book)
                        && c.get("chapter_number").and_then(|v| v.as_i64()) == Some(ch_num)
                        && c.get("version").and_then(|v| v.as_str()) == Some(ver)
                    {
                        c.get("id").and_then(|v| v.as_i64())
                    } else {
                        None
                    }
                });
                let Some(pid) = parent_id else { continue };
                let sv = ann.get("start_verse").and_then(|v| v.as_i64());
                let title = match sv {
                    Some(v) if v > 0 => format!("{book} {ch_num}:{v}"),
                    _ => format!("{book} {ch_num}"),
                };
                let mut body = String::new();
                for k in ["selected_text", "content", "note"] {
                    if let Some(s) = ann.get(k).and_then(|v| v.as_str()) {
                        body.push_str(&strip_html(s));
                        body.push(' ');
                    }
                }
                let href = format!("/Study?chapter_id={pid}");
                let _ = stmt.execute(params![
                    title,
                    body,
                    "Annotation",
                    id.to_string(),
                    id.to_string(),
                    format!("{book} {ch_num}"),
                    "body",
                    -1i64,
                    href,
                    updated_ms(ann)
                ]);
            }

            // 3. Keywords
            for kw in cache.get("Keyword").map(|v| v.as_slice()).unwrap_or(&[]) {
                let id = kw.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
                let title = kw.get("title").and_then(|v| v.as_str()).unwrap_or("Keyword");
                let mut body = String::new();
                for k in ["category", "explanation", "definition", "content"] {
                    if let Some(s) = kw.get(k).and_then(|v| v.as_str()) {
                        body.push_str(&strip_html(s));
                        body.push(' ');
                    }
                }
                let href = format!("/Keywords?keyword_id={id}");
                let _ = stmt.execute(params![
                    title,
                    body,
                    "Keyword",
                    id.to_string(),
                    id.to_string(),
                    title,
                    "body",
                    -1i64,
                    href,
                    updated_ms(kw)
                ]);
            }

            // 4. Knowledge Webs
            for w in webs {
                if is_private_web(w) {
                    continue;
                }
                let id = w.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
                let title = w.get("title").and_then(|v| v.as_str()).unwrap_or("Knowledge Web");
                let body = strip_html(w.get("description").and_then(|v| v.as_str()).unwrap_or(""));
                let href = saved_item_path("knowledge-webs", id, title);
                let _ = stmt.execute(params![
                    title,
                    body,
                    "Knowledge Web",
                    id.to_string(),
                    "",
                    title,
                    "body",
                    -1i64,
                    href,
                    updated_ms(w)
                ]);
            }

            // 5. Web Cards
            for card in cache.get("WebCard").map(|v| v.as_slice()).unwrap_or(&[]) {
                let id = card.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
                let web_id = card.get("web_id").and_then(|v| v.as_i64()).unwrap_or(0);
                let Some(parent_web) = web_map.get(&web_id) else {
                    continue;
                };
                if is_private_web(parent_web) {
                    continue;
                }
                let web_title = parent_web
                    .get("title")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Knowledge Web");
                let title = card.get("title").and_then(|v| v.as_str()).unwrap_or("Card");
                let mut body = strip_html(card.get("description").and_then(|v| v.as_str()).unwrap_or(""));
                if let Some(tags) = card.get("tags").and_then(|v| v.as_array()) {
                    for t in tags {
                        if let Some(ts) = t.as_str() {
                            body.push(' ');
                            body.push_str(ts);
                        }
                    }
                }
                let href = saved_item_path("knowledge-webs", web_id, web_title);
                let _ = stmt.execute(params![
                    title,
                    body,
                    "Web Card",
                    id.to_string(),
                    id.to_string(),
                    web_title,
                    "body",
                    -1i64,
                    href,
                    updated_ms(card)
                ]);
            }

            // 6. Notes & Multi-Page Books (index each page individually for `matchPage`)
            for note in cache.get("MindNote").map(|v| v.as_slice()).unwrap_or(&[]) {
                let id = note.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
                let title = note.get("title").and_then(|v| v.as_str()).unwrap_or("Untitled Note");
                let content = note.get("content").and_then(|v| v.as_str()).unwrap_or("");
                let href = saved_item_path("notes", id, title);
                let upd = updated_ms(note);

                let pages = split_note_pages(content, title);
                if pages.len() <= 1 {
                    let body = strip_html(content);
                    let _ = stmt.execute(params![
                        title,
                        body,
                        "Note",
                        id.to_string(),
                        "",
                        title,
                        "body",
                        0i64,
                        href,
                        upd
                    ]);
                } else {
                    for (p_idx, (p_title, p_body)) in pages.iter().enumerate() {
                        let combined_title = if p_idx == 0 {
                            title.to_string()
                        } else if !p_title.is_empty() {
                            format!("{title} — {p_title}")
                        } else {
                            format!("{title} (Page {})", p_idx + 1)
                        };
                        let plain_body = strip_html(p_body);
                        let _ = stmt.execute(params![
                            combined_title,
                            plain_body,
                            "Note",
                            id.to_string(),
                            "",
                            title,
                            "body",
                            p_idx as i64,
                            href,
                            upd
                        ]);
                    }
                }
            }

            // 7. Timelines & 8. Timeline Events
            for tg in cache.get("Timegraph").map(|v| v.as_slice()).unwrap_or(&[]) {
                let id = tg.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
                let title = tg.get("title").and_then(|v| v.as_str()).unwrap_or("Timeline");
                let desc = strip_html(tg.get("description").and_then(|v| v.as_str()).unwrap_or(""));
                let href = saved_item_path("timegraphs", id, title);
                let upd = updated_ms(tg);
                let _ = stmt.execute(params![
                    title,
                    desc,
                    "Timeline",
                    id.to_string(),
                    "",
                    title,
                    "body",
                    -1i64,
                    href,
                    upd
                ]);

                if let Some(events) = tg.get("events").and_then(|v| v.as_array()) {
                    for ev in events {
                        let ev_id = ev
                            .get("id")
                            .and_then(|v| v.as_str().map(|s| s.to_string()).or_else(|| v.as_i64().map(|n| n.to_string())))
                            .unwrap_or_default();
                        let ev_title = ev.get("title").and_then(|v| v.as_str()).unwrap_or("Event");
                        let mut ev_body = strip_html(ev.get("description").and_then(|v| v.as_str()).unwrap_or(""));
                        if let Some(tags) = ev.get("tags").and_then(|v| v.as_array()) {
                            for t in tags {
                                if let Some(ts) = t.as_str() {
                                    ev_body.push(' ');
                                    ev_body.push_str(ts);
                                }
                            }
                        }
                        let _ = stmt.execute(params![
                            ev_title,
                            ev_body,
                            "Timeline Event",
                            id.to_string(),
                            ev_id,
                            title,
                            "body",
                            -1i64,
                            href,
                            upd
                        ]);
                    }
                }
            }

            // 9. Spreadsheets & Spreadsheet Cells
            for ss in cache.get("Spreadsheet").map(|v| v.as_slice()).unwrap_or(&[]) {
                let id = ss.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
                let title = ss.get("title").and_then(|v| v.as_str()).unwrap_or("Spreadsheet");
                let href = saved_item_path("spreadsheets", id, title);
                let upd = updated_ms(ss);
                let _ = stmt.execute(params![
                    title,
                    "",
                    "Spreadsheet",
                    id.to_string(),
                    "",
                    title,
                    "title",
                    -1i64,
                    href,
                    upd
                ]);

                if let Some(sheets) = ss.get("workbook").and_then(|w| w.get("sheets")).and_then(|s| s.as_array()) {
                    for sh in sheets {
                        let sh_id = sh.get("id").and_then(|v| v.as_str()).unwrap_or("");
                        let sh_name = sh.get("name").and_then(|v| v.as_str()).unwrap_or("Sheet");
                        if let Some(cells) = sh.get("cells").and_then(|c| c.as_object()) {
                            for (addr, cell) in cells {
                                let mut text = String::new();
                                if let Some(v) = cell.get("v") {
                                    if let Some(s) = v.as_str() {
                                        text.push_str(s);
                                    } else if !v.is_null() {
                                        text.push_str(&v.to_string());
                                    }
                                }
                                if let Some(n) = cell.get("note").and_then(|x| x.as_str()) {
                                    if !n.is_empty() {
                                        text.push(' ');
                                        text.push_str(n);
                                    }
                                }
                                let trimmed = text.trim();
                                if trimmed.len() < 2 {
                                    continue;
                                }
                                let cell_title = format!("{title} · {sh_name}!{addr}");
                                let target = format!("{sh_id}:{addr}");
                                let _ = stmt.execute(params![
                                    cell_title,
                                    trimmed,
                                    "Spreadsheet Cell",
                                    id.to_string(),
                                    target,
                                    title,
                                    "cell",
                                    -1i64,
                                    href,
                                    upd
                                ]);
                            }
                        }
                    }
                }
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn search(&self, raw_query: &str, limit: usize) -> Result<Vec<SearchHit>, String> {
        let trimmed = raw_query.trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }
        let phrase_lower = trimmed.to_lowercase();
        let terms: Vec<String> = phrase_lower
            .split_whitespace()
            .filter(|t| !t.is_empty())
            .take(12)
            .map(|t| t.to_string())
            .collect();
        if terms.is_empty() {
            return Ok(Vec::new());
        }

        // Build safe FTS5 prefix query: `"term1"* AND "term2"*`
        let fts_query = terms
            .iter()
            .map(|t| format!("\"{}\"*", t.replace('"', "")))
            .collect::<Vec<_>>()
            .join(" AND ");

        let fetch_limit = (limit * 4).clamp(60, 400) as i64;
        let mut stmt = self
            .conn
            .prepare(
                "SELECT title, body, hit_type, record_id, target_id, workspace_title, match_field, match_page, href, updated_ms
                 FROM docs
                 WHERE docs MATCH ?1
                 LIMIT ?2",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![fts_query, fetch_limit], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, i64>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, i64>(9)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        let mut hits = Vec::new();
        for r in rows.flatten() {
            let (title, body, hit_type, record_id, target_id, workspace_title, match_field, match_page, href, updated) = r;
            let title_low = title.to_lowercase();
            let body_low = body.to_lowercase();

            let score = if title_low == phrase_lower {
                500
            } else if title_low.contains(&phrase_lower) {
                400
            } else if terms.iter().all(|t| title_low.contains(t.as_str())) {
                300
            } else if body_low.contains(&phrase_lower) {
                200
            } else {
                100
            };

            let (resolved_field, description) = if score >= 300 {
                let src = if body.is_empty() { title.as_str() } else { body.as_str() };
                ("title".to_string(), make_snippet(src, &phrase_lower, &terms, 190))
            } else {
                (match_field, make_snippet(body.as_str(), &phrase_lower, &terms, 190))
            };

            let match_text = if body_low.contains(&phrase_lower) || title_low.contains(&phrase_lower) {
                phrase_lower.clone()
            } else {
                terms
                    .iter()
                    .find(|t| body_low.contains(t.as_str()) || title_low.contains(t.as_str()))
                    .cloned()
                    .unwrap_or_else(|| phrase_lower.clone())
            };

            let id_val = record_id
                .parse::<i64>()
                .map(Value::from)
                .unwrap_or_else(|_| Value::from(record_id));
            let target_val = if target_id.is_empty() {
                None
            } else {
                Some(
                    target_id
                        .parse::<i64>()
                        .map(Value::from)
                        .unwrap_or_else(|_| Value::from(target_id)),
                )
            };

            hits.push(SearchHit {
                id: id_val,
                target_id: target_val,
                hit_type,
                title,
                workspace_title,
                description,
                match_field: resolved_field,
                match_text,
                match_page: if match_page >= 0 { Some(match_page as usize) } else { None },
                href,
                score,
                updated,
            });
        }

        hits.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| b.updated.cmp(&a.updated)));
        hits.truncate(limit);
        Ok(hits)
    }
}

fn is_private_web(web: &Value) -> bool {
    match web.get("is_private") {
        Some(Value::Bool(true)) => true,
        Some(Value::Number(n)) => n.as_i64() == Some(1),
        Some(Value::String(s)) => s == "1",
        _ => false,
    }
}

fn updated_ms(record: &Value) -> i64 {
    for k in ["updated_date", "updated_at", "created_date", "created_at"] {
        if let Some(s) = record.get(k).and_then(|v| v.as_str()) {
            if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
                return dt.timestamp_millis();
            }
        }
    }
    0
}

fn slugify(title: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in title.to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            prev_dash = false;
        } else if !prev_dash && !out.is_empty() {
            out.push('-');
            prev_dash = true;
        }
        if out.len() >= 60 {
            break;
        }
    }
    out.trim_matches('-').to_string()
}

fn saved_item_path(kind: &str, id: i64, title: &str) -> String {
    let slug = slugify(title);
    if slug.is_empty() {
        format!("/{kind}/{id}")
    } else {
        format!("/{kind}/{slug}-{id}")
    }
}

pub fn strip_html(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => {
                in_tag = true;
                out.push(' ');
            }
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn split_note_pages(content: &str, fallback_title: &str) -> Vec<(String, String)> {
    let marker = if content.contains(BOOK_PAGE_MARKER) {
        Some(BOOK_PAGE_MARKER)
    } else if content.contains(LEGACY_BOOK_PAGE_MARKER) {
        Some(LEGACY_BOOK_PAGE_MARKER)
    } else {
        None
    };

    let raw_pages: Vec<&str> = match marker {
        Some(m) => content.split(m).collect(),
        None => vec![content],
    };

    raw_pages
        .into_iter()
        .enumerate()
        .map(|(idx, raw)| {
            let trimmed = raw.trim();
            if let Some(rest) = trimmed.strip_prefix("<!--bex-page-title:") {
                if let Some(end_idx) = rest.find("-->") {
                    let encoded_title = &rest[..end_idx];
                    let decoded = url::form_urlencoded::parse(
                        format!("t={encoded_title}").as_bytes(),
                    )
                    .next()
                    .map(|(_, v)| v.into_owned())
                    .unwrap_or_else(|| encoded_title.to_string());
                    let title = if !decoded.trim().is_empty() {
                        decoded
                    } else if idx == 0 {
                        fallback_title.to_string()
                    } else {
                        format!("Page {}", idx + 1)
                    };
                    let body = rest[end_idx + 3..].trim().to_string();
                    return (title, body);
                }
            }
            let title = if idx == 0 {
                fallback_title.to_string()
            } else {
                format!("Page {}", idx + 1)
            };
            (title, trimmed.to_string())
        })
        .collect()
}

fn make_snippet(text: &str, phrase_lower: &str, terms: &[String], max_chars: usize) -> String {
    if text.is_empty() {
        return String::new();
    }
    let chars: Vec<char> = text.chars().collect();
    let lower = text.to_lowercase();
    let byte_idx = lower
        .find(phrase_lower)
        .or_else(|| terms.iter().find_map(|t| lower.find(t.as_str())));

    let char_idx = match byte_idx {
        Some(bi) => lower[..bi].chars().count(),
        None => return chars.iter().take(max_chars).collect(),
    };

    let start = char_idx.saturating_sub(max_chars / 3);
    let end = (start + max_chars).min(chars.len());
    let mut res = String::new();
    if start > 0 {
        res.push('…');
    }
    for &c in &chars[start..end] {
        res.push(c);
    }
    if end < chars.len() {
        res.push('…');
    }
    res
}
