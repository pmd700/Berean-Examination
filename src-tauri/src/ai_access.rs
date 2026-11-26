//! Rich AI Access Engine for BEX (`bex-mcp`).
//!
//! Provides:
//! 1. Lossless TipTap HTML -> Markdown conversion preserving BEX footnotes, comments,
//!    tooltips, pointers, keyword mentions, logic formulas, internal links, and citations.
//! 2. Markdown -> TipTap HTML conversion for safe additive write tools.
//! 3. Canonical 66-book Bible reference parser & prose citation extractor.
//! 4. Hybrid FTS5 + IDF Conceptual/Theological Search Engine (with biblical thesaurus).
//! 5. Multi-layer Vault Relationship Graph (MindLink, WebConnection, StudyConnection,
//!    inline links, timeline/spreadsheet links, and shared Scripture citations).

use crate::vault::VaultEngine;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};

pub const PAGE_BREAK_SENTINEL: &str = "<!--bex-page-break-->";
const LEGACY_PAGE_BREAK_SENTINEL: &str = "<!-- bex-book-page -->";

// ── Percent & HTML Entity Decoding ─────────────────────────────────────────

pub fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h1), Some(h2)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                out.push((h1 << 4) | h2);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

pub fn decode_html_entities(input: &str) -> String {
    if !input.contains('&') {
        return input.to_string();
    }
    let mut out = String::with_capacity(input.len());
    let chars: Vec<char> = input.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '&' {
            if let Some(semi_rel) = chars[i + 1..].iter().take(12).position(|&c| c == ';') {
                let entity: String = chars[i + 1..i + 1 + semi_rel].iter().collect();
                let decoded = match entity.as_str() {
                    "amp" => Some("&".to_string()),
                    "lt" => Some("<".to_string()),
                    "gt" => Some(">".to_string()),
                    "quot" => Some("\"".to_string()),
                    "apos" | "#39" | "#x27" => Some("'".to_string()),
                    "nbsp" => Some(" ".to_string()),
                    "ndash" => Some("–".to_string()),
                    "mdash" => Some("—".to_string()),
                    "hellip" => Some("…".to_string()),
                    "lsquo" => Some("‘".to_string()),
                    "rsquo" => Some("’".to_string()),
                    "ldquo" => Some("“".to_string()),
                    "rdquo" => Some("”".to_string()),
                    s if s.starts_with("#x") || s.starts_with("#X") => {
                        u32::from_str_radix(&s[2..], 16)
                            .ok()
                            .and_then(char::from_u32)
                            .map(|c| c.to_string())
                    }
                    s if s.starts_with('#') => s[1..]
                        .parse::<u32>()
                        .ok()
                        .and_then(char::from_u32)
                        .map(|c| c.to_string()),
                    _ => None,
                };
                if let Some(d) = decoded {
                    out.push_str(&d);
                    i += semi_rel + 2;
                    continue;
                }
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

pub fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

// ── Book Page Splitting (`bookModel.js` Parity) ────────────────────────────

/// Splits a MindNote `content` into `(1-based page number, page_title, raw_html_body)`.
pub fn split_book_pages_detailed(content: &str, fallback_title: &str) -> Vec<(usize, String, String)> {
    let raw_pages: Vec<&str> = if content.contains(PAGE_BREAK_SENTINEL) {
        content.split(PAGE_BREAK_SENTINEL).collect()
    } else if content.contains(LEGACY_PAGE_BREAK_SENTINEL) {
        content.split(LEGACY_PAGE_BREAK_SENTINEL).collect()
    } else {
        vec![content]
    };

    raw_pages
        .into_iter()
        .enumerate()
        .map(|(idx, raw)| {
            let trimmed = raw.trim();
            if let Some(rest) = trimmed.strip_prefix("<!--bex-page-title:") {
                if let Some(end_idx) = rest.find("-->") {
                    let encoded = &rest[..end_idx];
                    let decoded = percent_decode(encoded);
                    let title = if !decoded.trim().is_empty() {
                        decoded
                    } else if idx == 0 {
                        fallback_title.to_string()
                    } else {
                        format!("Page {}", idx + 1)
                    };
                    let body = rest[end_idx + 3..].trim().to_string();
                    return (idx + 1, title, body);
                }
            }
            let title = if idx == 0 {
                fallback_title.to_string()
            } else {
                format!("Page {}", idx + 1)
            };
            (idx + 1, title, trimmed.to_string())
        })
        .collect()
}

// ── Lossless TipTap HTML -> Markdown Converter ─────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct ExtractedLink {
    pub target: String,
    pub kind: String,
    pub label: String,
    pub href: String,
}

#[derive(Debug, Clone)]
pub struct FormattedRichText {
    pub markdown: String,
    pub links: Vec<ExtractedLink>,
    pub verse_citations: Vec<BibleRef>,
}

/// Resolves an internal BEX link (`/notes/foo-12`, `/knowledge-webs/bar-5`, `/Study?q=...&annotation_id=9`, etc.)
/// into a canonical Source ID (`note:12`, `web:5`, `commentary:9`, `timeline:3`, `spreadsheet:1`).
pub fn resolve_bex_internal_href(href: &str) -> Option<String> {
    let clean = href.trim();
    let path = if let Some(rest) = clean.strip_prefix("https://bex.local") {
        rest
    } else if let Some(rest) = clean.strip_prefix("http://bex.local") {
        rest
    } else if clean.starts_with('/') {
        clean
    } else {
        return None;
    };

    if path.starts_with("/Study?") {
        let query_part = path.splitn(2, '?').nth(1).unwrap_or("");
        for (k, v) in url::form_urlencoded::parse(query_part.as_bytes()) {
            if k == "annotation_id" && !v.is_empty() {
                return Some(format!("commentary:{v}"));
            }
            if k == "chapter_id" && !v.is_empty() {
                return Some(format!("study:{v}"));
            }
        }
        return None;
    }

    if path.starts_with("/Keywords?") {
        let query_part = path.splitn(2, '?').nth(1).unwrap_or("");
        for (k, v) in url::form_urlencoded::parse(query_part.as_bytes()) {
            if (k == "keyword" || k == "keyword_id") && !v.is_empty() {
                return Some(format!("keyword:{v}"));
            }
        }
        return None;
    }

    let path_only = path.split(['?', '#']).next().unwrap_or("");
    let mut parts = path_only.trim_start_matches('/').split('/');
    let kind_seg = parts.next()?;
    let id_seg = parts.next()?;
    let numeric_id = id_seg.rsplit('-').next().unwrap_or(id_seg);
    if numeric_id.is_empty() || !numeric_id.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let prefix = match kind_seg {
        "notes" => "note",
        "knowledge-webs" => "web",
        "timegraphs" => "timeline",
        "spreadsheets" => "spreadsheet",
        _ => return None,
    };
    Some(format!("{prefix}:{numeric_id}"))
}

#[derive(Debug, Clone)]
enum HtmlNode {
    Text(String),
    Element {
        tag: String,
        attrs: HashMap<String, String>,
        children: Vec<HtmlNode>,
    },
}

fn is_void_tag(tag: &str) -> bool {
    matches!(
        tag,
        "br" | "hr" | "img" | "input" | "meta" | "link" | "area" | "base" | "col" | "embed" | "source" | "track" | "wbr"
    )
}

fn parse_html_fragment(html: &str) -> Vec<HtmlNode> {
    let bytes = html.as_bytes();
    let len = bytes.len();
    let mut i = 0usize;
    let mut stack: Vec<(String, HashMap<String, String>, Vec<HtmlNode>)> = Vec::new();
    let mut root: Vec<HtmlNode> = Vec::new();

    let push_node = |stack: &mut Vec<(String, HashMap<String, String>, Vec<HtmlNode>)>,
                     root: &mut Vec<HtmlNode>,
                     node: HtmlNode| {
        if let Some((_, _, children)) = stack.last_mut() {
            children.push(node);
        } else {
            root.push(node);
        }
    };

    while i < len {
        if bytes[i] == b'<' {
            // HTML comment <!-- ... -->
            if html[i..].starts_with("<!--") {
                if let Some(end) = html[i + 4..].find("-->") {
                    i += 4 + end + 3;
                } else {
                    break;
                }
                continue;
            }
            // Closing tag </tag>
            if i + 1 < len && bytes[i + 1] == b'/' {
                if let Some(gt_rel) = html[i + 2..].find('>') {
                    let close_tag = html[i + 2..i + 2 + gt_rel].trim().to_ascii_lowercase();
                    i += 2 + gt_rel + 1;
                    // Find matching open tag in stack
                    if let Some(pos) = stack.iter().rposition(|(t, _, _)| t == &close_tag) {
                        while stack.len() > pos {
                            let (t, attrs, children) = stack.pop().unwrap();
                            push_node(&mut stack, &mut root, HtmlNode::Element { tag: t, attrs, children });
                        }
                    }
                    continue;
                }
            }
            // Opening tag <tag attr="val" ...>
            if i + 1 < len && (bytes[i + 1].is_ascii_alphabetic()) {
                let mut j = i + 1;
                while j < len && (bytes[j].is_ascii_alphanumeric() || bytes[j] == b'-' || bytes[j] == b':') {
                    j += 1;
                }
                let tag = html[i + 1..j].to_ascii_lowercase();
                let mut attrs = HashMap::new();
                let mut self_closing = false;

                while j < len {
                    while j < len && bytes[j].is_ascii_whitespace() {
                        j += 1;
                    }
                    if j >= len {
                        break;
                    }
                    if bytes[j] == b'>' {
                        j += 1;
                        break;
                    }
                    if bytes[j] == b'/' && j + 1 < len && bytes[j + 1] == b'>' {
                        self_closing = true;
                        j += 2;
                        break;
                    }
                    // Attribute name
                    let name_start = j;
                    while j < len
                        && !bytes[j].is_ascii_whitespace()
                        && bytes[j] != b'='
                        && bytes[j] != b'>'
                        && bytes[j] != b'/'
                    {
                        j += 1;
                    }
                    let attr_name = html[name_start..j].to_ascii_lowercase();
                    while j < len && bytes[j].is_ascii_whitespace() {
                        j += 1;
                    }
                    let attr_val = if j < len && bytes[j] == b'=' {
                        j += 1;
                        while j < len && bytes[j].is_ascii_whitespace() {
                            j += 1;
                        }
                        if j < len && (bytes[j] == b'"' || bytes[j] == b'\'') {
                            let quote = bytes[j];
                            j += 1;
                            let val_start = j;
                            while j < len && bytes[j] != quote {
                                j += 1;
                            }
                            let val = &html[val_start..j];
                            if j < len {
                                j += 1;
                            }
                            decode_html_entities(val)
                        } else {
                            let val_start = j;
                            while j < len && !bytes[j].is_ascii_whitespace() && bytes[j] != b'>' {
                                j += 1;
                            }
                            decode_html_entities(&html[val_start..j])
                        }
                    } else {
                        String::new()
                    };
                    if !attr_name.is_empty() {
                        attrs.insert(attr_name, attr_val);
                    }
                }
                i = j;

                if self_closing || is_void_tag(&tag) {
                    push_node(
                        &mut stack,
                        &mut root,
                        HtmlNode::Element {
                            tag,
                            attrs,
                            children: Vec::new(),
                        },
                    );
                } else {
                    stack.push((tag, attrs, Vec::new()));
                }
                continue;
            }
        }

        // Plain text until next `<`
        let start = i;
        i += 1;
        while i < len && bytes[i] != b'<' {
            i += 1;
        }
        let text = decode_html_entities(&html[start..i]);
        if !text.is_empty() {
            push_node(&mut stack, &mut root, HtmlNode::Text(text));
        }
    }

    while let Some((t, attrs, children)) = stack.pop() {
        push_node(&mut stack, &mut root, HtmlNode::Element { tag: t, attrs, children });
    }
    root
}

struct WalkCtx {
    links: Vec<ExtractedLink>,
    attached: BTreeMap<String, (String, Vec<String>, String)>, // key -> (type, anchors, body_html)
    pointers: BTreeMap<String, Vec<(String, String)>>,
    in_pre: bool,
}

fn collapse_newlines(text: &str) -> String {
    let norm = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut out = String::with_capacity(norm.len());
    let mut blank_run = 0usize;
    for line in norm.split('\n') {
        let t = line.trim_end();
        if t.trim().is_empty() {
            blank_run += 1;
            if blank_run <= 1 && !out.is_empty() {
                out.push('\n');
            }
        } else {
            blank_run = 0;
            if !out.is_empty() {
                out.push('\n');
            }
            out.push_str(t);
        }
    }
    out.trim().to_string()
}

fn indent_lines(text: &str, pad: &str) -> String {
    text.split('\n')
        .map(|l| format!("{pad}{l}"))
        .collect::<Vec<_>>()
        .join("\n")
}

fn extract_plain_text(nodes: &[HtmlNode]) -> String {
    let mut s = String::new();
    for n in nodes {
        match n {
            HtmlNode::Text(t) => s.push_str(t),
            HtmlNode::Element { children, .. } => s.push_str(&extract_plain_text(children)),
        }
    }
    s
}

fn walk_nodes(nodes: &[HtmlNode], ctx: &mut WalkCtx) -> String {
    let mut out = String::new();
    for node in nodes {
        out.push_str(&walk_node(node, ctx));
    }
    out
}

fn walk_node(node: &HtmlNode, ctx: &mut WalkCtx) -> String {
    match node {
        HtmlNode::Text(t) => {
            if ctx.in_pre {
                t.clone()
            } else {
                // Collapse internal runs of whitespace to single space while preserving leading/trailing space
                let mut res = String::with_capacity(t.len());
                let mut prev_ws = false;
                for ch in t.chars() {
                    if ch.is_whitespace() {
                        if !prev_ws {
                            res.push(' ');
                            prev_ws = true;
                        }
                    } else {
                        res.push(ch);
                        prev_ws = false;
                    }
                }
                res
            }
        }
        HtmlNode::Element { tag, attrs, children } => {
            if matches!(tag.as_str(), "script" | "style" | "noscript") {
                return String::new();
            }
            if attrs.contains_key("data-bex-file") {
                let name = attrs
                    .get("data-file-name")
                    .map(|s| s.as_str())
                    .filter(|s| !s.is_empty())
                    .unwrap_or("Attached file");
                let url = attrs.get("data-file-url").map(|s| s.as_str()).unwrap_or("");
                return format!("\n\n[Attachment: {name} ({url})]\n\n");
            }
            if let Some(tg_id) = attrs.get("data-timegraph-id") {
                let target = format!("timeline:{tg_id}");
                ctx.links.push(ExtractedLink {
                    target: target.clone(),
                    kind: "embedded timeline".into(),
                    label: target.clone(),
                    href: format!("/timegraphs/{tg_id}"),
                });
                return format!("\n\n[Embedded Timeline: {target}]\n\n");
            }
            if let Some(dr_id) = attrs.get("data-drawing-id") {
                let target = format!("drawing:{dr_id}");
                ctx.links.push(ExtractedLink {
                    target: target.clone(),
                    kind: "embedded drawing".into(),
                    label: target.clone(),
                    href: String::new(),
                });
                return format!(" [Drawing: {target}] ");
            }
            if let Some(logic_src) = attrs.get("data-logic-source") {
                return format!(" `Logic: {logic_src}` ");
            }
            if matches!(tag.as_str(), "img" | "video" | "audio") {
                let src = attrs.get("src").map(|s| s.as_str()).unwrap_or("");
                let alt = attrs
                    .get("alt")
                    .map(|s| s.as_str())
                    .filter(|s| !s.is_empty())
                    .unwrap_or(tag.as_str());
                let safe_src = if src.starts_with("data:") {
                    "(embedded media)"
                } else {
                    src
                };
                return format!(" [{alt}: {safe_src}] ");
            }
            if tag == "pre" {
                let prev = ctx.in_pre;
                ctx.in_pre = true;
                let inner = extract_plain_text(children);
                ctx.in_pre = prev;
                return format!("\n\n```\n{}\n```\n\n", inner.trim_matches('\n'));
            }
            if tag == "code" {
                let inner = extract_plain_text(children);
                return format!("`{inner}`");
            }
            if tag == "ul" || tag == "ol" {
                let start: usize = attrs
                    .get("start")
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(1);
                let mut lines = Vec::new();
                let mut item_idx = 0usize;
                for child in children {
                    if let HtmlNode::Element {
                        tag: ctag,
                        attrs: cattrs,
                        children: cchildren,
                    } = child
                    {
                        if ctag == "li" {
                            let prefix = if tag == "ol" {
                                format!("{}. ", start + item_idx)
                            } else if let Some(checked) = cattrs.get("data-checked") {
                                if checked == "true" {
                                    "- [x] ".to_string()
                                } else {
                                    "- [ ] ".to_string()
                                }
                            } else {
                                "- ".to_string()
                            };
                            item_idx += 1;
                            let body = collapse_newlines(&walk_nodes(cchildren, ctx));
                            let mut blines = body.split('\n');
                            let first = blines.next().unwrap_or("");
                            let rest: Vec<&str> = blines.collect();
                            if rest.is_empty() {
                                lines.push(format!("{prefix}{first}"));
                            } else {
                                let pad = " ".repeat(prefix.len());
                                lines.push(format!(
                                    "{prefix}{first}\n{}",
                                    indent_lines(&rest.join("\n"), &pad)
                                ));
                            }
                        }
                    }
                }
                return format!("\n\n{}\n\n", lines.join("\n"));
            }
            if tag == "table" {
                let mut rows_md = Vec::new();
                collect_table_rows(children, ctx, &mut rows_md);
                if rows_md.is_empty() {
                    return String::new();
                }
                return format!("\n\n{}\n\n", rows_md.join("\n"));
            }

            let mut text = walk_nodes(children, ctx);

            // Capture BEX attached notes: footnotes, comments, tooltips
            for kind in ["footnote", "comment", "tooltip"] {
                let id_key = format!("data-{kind}-id");
                let text_key = format!("data-{kind}-text");
                if let Some(id) = attrs.get(&id_key) {
                    let key = format!("{kind}:{id}");
                    let body_attr = attrs.get(&text_key).cloned().unwrap_or_default();
                    let entry = ctx
                        .attached
                        .entry(key.clone())
                        .or_insert_with(|| (kind.to_string(), Vec::new(), body_attr.clone()));
                    let anchor = text.trim();
                    if !anchor.is_empty() && !entry.1.iter().any(|a| a == anchor) {
                        entry.1.push(anchor.to_string());
                    }
                    if entry.2.is_empty() && !body_attr.is_empty() {
                        entry.2 = body_attr;
                    }
                    if kind == "footnote" {
                        text = format!("[{key}]");
                    } else {
                        text = format!("{text}[{key}]");
                    }
                }
            }
            if let Some(pid) = attrs.get("data-pointer-id") {
                let role = attrs
                    .get("data-pointer-role")
                    .cloned()
                    .unwrap_or_else(|| "pointer".into());
                ctx.pointers
                    .entry(pid.clone())
                    .or_default()
                    .push((role, text.trim().to_string()));
            }
            if let Some(kw_id) = attrs.get("data-keyword-id") {
                let target = format!("keyword:{kw_id}");
                ctx.links.push(ExtractedLink {
                    target: target.clone(),
                    kind: "keyword mention".into(),
                    label: text.trim().to_string(),
                    href: format!("/Keywords?keyword={kw_id}"),
                });
                text = format!("{} ({target})", text.trim());
            }

            match tag.as_str() {
                "h1" => format!("\n\n# {}\n\n", text.trim()),
                "h2" => format!("\n\n## {}\n\n", text.trim()),
                "h3" => format!("\n\n### {}\n\n", text.trim()),
                "h4" => format!("\n\n#### {}\n\n", text.trim()),
                "h5" => format!("\n\n##### {}\n\n", text.trim()),
                "h6" => format!("\n\n###### {}\n\n", text.trim()),
                "br" => "\n".to_string(),
                "hr" => "\n\n---\n\n".to_string(),
                "strong" | "b" => {
                    let t = text.trim();
                    if t.is_empty() { String::new() } else { format!("**{t}**") }
                }
                "em" | "i" => {
                    let t = text.trim();
                    if t.is_empty() { String::new() } else { format!("*{t}*") }
                }
                "s" | "del" => {
                    let t = text.trim();
                    if t.is_empty() { String::new() } else { format!("~~{t}~~") }
                }
                "blockquote" => {
                    let cleaned = collapse_newlines(&text);
                    if cleaned.is_empty() {
                        String::new()
                    } else {
                        format!("\n\n{}\n\n", indent_lines(&cleaned, "> "))
                    }
                }
                "summary" => format!("\n\n**{}**\n\n", text.trim()),
                "details" => format!("\n\n{}\n\n", collapse_newlines(&text)),
                "a" => {
                    let href = attrs.get("href").map(|s| s.as_str()).unwrap_or("");
                    if href.starts_with("data:") {
                        return format!("{} [binary omitted]", text.trim());
                    }
                    if let Some(target) = resolve_bex_internal_href(href) {
                        ctx.links.push(ExtractedLink {
                            target,
                            kind: "hyperlink".into(),
                            label: text.trim().to_string(),
                            href: href.to_string(),
                        });
                    }
                    if href.is_empty() {
                        text
                    } else {
                        let lbl = if text.trim().is_empty() { href } else { text.trim() };
                        format!("[{lbl}]({href})")
                    }
                }
                "p" | "div" | "section" | "article" | "figure" | "figcaption" => {
                    let cleaned = collapse_newlines(&text);
                    if cleaned.is_empty() {
                        String::new()
                    } else {
                        format!("\n\n{cleaned}\n\n")
                    }
                }
                _ => text,
            }
        }
    }
}

fn collect_table_rows(nodes: &[HtmlNode], ctx: &mut WalkCtx, rows_md: &mut Vec<String>) {
    for node in nodes {
        if let HtmlNode::Element { tag, children, .. } = node {
            if tag == "tr" {
                let mut cells = Vec::new();
                let mut is_header = false;
                for c in children {
                    if let HtmlNode::Element { tag: ctag, children: cchildren, .. } = c {
                        if ctag == "th" || ctag == "td" {
                            if ctag == "th" {
                                is_header = true;
                            }
                            let cell_txt = collapse_newlines(&walk_nodes(cchildren, ctx))
                                .replace('\n', " ")
                                .replace('|', "\\|");
                            cells.push(cell_txt);
                        }
                    }
                }
                if !cells.is_empty() {
                    let line = format!("| {} |", cells.join(" | "));
                    rows_md.push(line);
                    if is_header && rows_md.len() == 1 {
                        let sep = cells.iter().map(|_| "---").collect::<Vec<_>>().join(" | ");
                        rows_md.push(format!("| {sep} |"));
                    }
                }
            } else if matches!(tag.as_str(), "thead" | "tbody" | "tfoot") {
                collect_table_rows(children, ctx, rows_md);
            }
        }
    }
}

fn looks_like_html(input: &str) -> bool {
    let trimmed = input.trim_start();
    if !trimmed.starts_with('<') {
        return false;
    }
    let after = &trimmed[1..];
    let lower = after
        .chars()
        .take(12)
        .collect::<String>()
        .to_ascii_lowercase();
    [
        "p>", "p ", "div", "span", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "table",
        "blockquote", "details", "pre", "strong", "em", "br", "sup", "u>", "mark", "code", "b>",
        "i>", "s>", "del", "hr", "a ", "img", "!--",
    ]
    .iter()
    .any(|prefix| lower.starts_with(prefix))
}

pub fn rich_html_to_markdown(raw: &str) -> FormattedRichText {
    if raw.trim().is_empty() {
        return FormattedRichText {
            markdown: String::new(),
            links: Vec::new(),
            verse_citations: Vec::new(),
        };
    }

    if !looks_like_html(raw) {
        let md = collapse_newlines(raw);
        let verse_citations = extract_bible_citations(&md);
        return FormattedRichText {
            markdown: md,
            links: Vec::new(),
            verse_citations,
        };
    }

    let nodes = parse_html_fragment(raw);
    let mut ctx = WalkCtx {
        links: Vec::new(),
        attached: BTreeMap::new(),
        pointers: BTreeMap::new(),
        in_pre: false,
    };
    let mut body = collapse_newlines(&walk_nodes(&nodes, &mut ctx));

    let mut extras = Vec::new();
    let attached_items: Vec<_> = ctx.attached.into_iter().collect();
    for (key, (_kind, anchors, body_html)) in attached_items {
        let inner = rich_html_to_markdown(&body_html);
        ctx.links.extend(inner.links);
        let anchor_note = if anchors.is_empty() {
            String::new()
        } else {
            format!(" (attached to: \"{}\")", anchors.join(" … "))
        };
        let content = if inner.markdown.is_empty() {
            "(empty)".to_string()
        } else {
            inner.markdown
        };
        extras.push(format!("- **{key}**{anchor_note}:\n{}", indent_lines(&content, "  ")));
    }
    for (pid, entries) in ctx.pointers {
        let chain = entries
            .into_iter()
            .map(|(r, t)| format!("{r}: {}", if t.is_empty() { "(marker)" } else { t.as_str() }))
            .collect::<Vec<_>>()
            .join(" -> ");
        extras.push(format!("- **Pointer {pid}**: {chain}"));
    }

    if !extras.is_empty() {
        if !body.is_empty() {
            body.push_str("\n\n");
        }
        body.push_str("#### Attached Notes & Footnotes\n");
        body.push_str(&extras.join("\n"));
    }

    let verse_citations = extract_bible_citations(&body);
    FormattedRichText {
        markdown: body,
        links: ctx.links,
        verse_citations,
    }
}

// ── Markdown -> TipTap HTML Converter (for Safe Write Tools) ───────────────

pub fn markdown_to_html(md: &str) -> String {
    let mut html = String::new();
    let mut in_ul = false;
    let mut in_ol = false;
    let mut in_quote = false;
    let mut para_lines: Vec<String> = Vec::new();

    let flush_para = |para: &mut Vec<String>, out: &mut String| {
        if !para.is_empty() {
            let joined = para.join("<br>");
            out.push_str(&format!("<p>{joined}</p>"));
            para.clear();
        }
    };
    let close_lists = |ul: &mut bool, ol: &mut bool, q: &mut bool, out: &mut String| {
        if *ul {
            out.push_str("</ul>");
            *ul = false;
        }
        if *ol {
            out.push_str("</ol>");
            *ol = false;
        }
        if *q {
            out.push_str("</blockquote>");
            *q = false;
        }
    };

    for raw_line in md.replace("\r\n", "\n").split('\n') {
        let trimmed = raw_line.trim();
        if trimmed.is_empty() {
            flush_para(&mut para_lines, &mut html);
            close_lists(&mut in_ul, &mut in_ol, &mut in_quote, &mut html);
            continue;
        }
        if trimmed == "---" || trimmed == "***" {
            flush_para(&mut para_lines, &mut html);
            close_lists(&mut in_ul, &mut in_ol, &mut in_quote, &mut html);
            html.push_str("<hr>");
            continue;
        }
        // Headings
        let hashes = trimmed.chars().take_while(|&c| c == '#').count();
        if (1..=6).contains(&hashes) && trimmed.as_bytes().get(hashes) == Some(&b' ') {
            flush_para(&mut para_lines, &mut html);
            close_lists(&mut in_ul, &mut in_ol, &mut in_quote, &mut html);
            let inner = inline_md_to_html(trimmed[hashes + 1..].trim());
            html.push_str(&format!("<h{hashes}>{inner}</h{hashes}>"));
            continue;
        }
        // Blockquote
        if let Some(rest) = trimmed.strip_prefix("> ") {
            flush_para(&mut para_lines, &mut html);
            if in_ul {
                html.push_str("</ul>");
                in_ul = false;
            }
            if in_ol {
                html.push_str("</ol>");
                in_ol = false;
            }
            if !in_quote {
                html.push_str("<blockquote>");
                in_quote = true;
            }
            html.push_str(&format!("<p>{}</p>", inline_md_to_html(rest)));
            continue;
        }
        // Unordered list
        if let Some(rest) = trimmed.strip_prefix("- ").or_else(|| trimmed.strip_prefix("* ")) {
            flush_para(&mut para_lines, &mut html);
            if in_ol {
                html.push_str("</ol>");
                in_ol = false;
            }
            if in_quote {
                html.push_str("</blockquote>");
                in_quote = false;
            }
            if !in_ul {
                html.push_str("<ul>");
                in_ul = true;
            }
            html.push_str(&format!("<li><p>{}</p></li>", inline_md_to_html(rest)));
            continue;
        }
        // Ordered list
        if let Some(dot_idx) = trimmed.find(". ") {
            if dot_idx > 0 && dot_idx <= 3 && trimmed[..dot_idx].chars().all(|c| c.is_ascii_digit()) {
                flush_para(&mut para_lines, &mut html);
                if in_ul {
                    html.push_str("</ul>");
                    in_ul = false;
                }
                if in_quote {
                    html.push_str("</blockquote>");
                    in_quote = false;
                }
                if !in_ol {
                    html.push_str("<ol>");
                    in_ol = true;
                }
                let rest = &trimmed[dot_idx + 2..];
                html.push_str(&format!("<li><p>{}</p></li>", inline_md_to_html(rest)));
                continue;
            }
        }

        close_lists(&mut in_ul, &mut in_ol, &mut in_quote, &mut html);
        para_lines.push(inline_md_to_html(trimmed));
    }

    flush_para(&mut para_lines, &mut html);
    close_lists(&mut in_ul, &mut in_ol, &mut in_quote, &mut html);
    if html.is_empty() {
        "<p></p>".to_string()
    } else {
        html
    }
}

fn inline_md_to_html(s: &str) -> String {
    let escaped = escape_html(s);
    let chars: Vec<char> = escaped.chars().collect();
    let len = chars.len();
    let mut out = String::with_capacity(escaped.len() + 16);
    let mut i = 0;

    while i < len {
        // Bold **...**
        if i + 1 < len && chars[i] == '*' && chars[i + 1] == '*' {
            if let Some(end_rel) = (i + 2..len.saturating_sub(1))
                .find(|&k| chars[k] == '*' && chars[k + 1] == '*')
            {
                let inner: String = chars[i + 2..end_rel].iter().collect();
                out.push_str(&format!("<strong>{inner}</strong>"));
                i = end_rel + 2;
                continue;
            }
        }
        // Inline code `...`
        if chars[i] == '`' {
            if let Some(end_rel) = (i + 1..len).find(|&k| chars[k] == '`') {
                let inner: String = chars[i + 1..end_rel].iter().collect();
                out.push_str(&format!("<code>{inner}</code>"));
                i = end_rel + 1;
                continue;
            }
        }
        // Italic *...*
        if chars[i] == '*' {
            if let Some(end_rel) = (i + 1..len).find(|&k| chars[k] == '*') {
                let inner: String = chars[i + 1..end_rel].iter().collect();
                if !inner.is_empty() {
                    out.push_str(&format!("<em>{inner}</em>"));
                    i = end_rel + 1;
                    continue;
                }
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

// ── Canonical 66-Book Bible Reference Parser & Citation Extractor ──────────

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
pub struct BibleRef {
    pub book: String,
    pub chapter: Option<i64>,
    pub start_verse: Option<i64>,
    pub end_verse: Option<i64>,
}

impl BibleRef {
    pub fn display_ref(&self) -> String {
        match (self.chapter, self.start_verse, self.end_verse) {
            (Some(c), Some(sv), Some(ev)) if ev != sv => format!("{} {c}:{sv}-{ev}", self.book),
            (Some(c), Some(sv), _) => format!("{} {c}:{sv}", self.book),
            (Some(c), None, _) => format!("{} {c}", self.book),
            (None, _, _) => self.book.clone(),
        }
    }
}

const CANONICAL_BOOKS: &[(&str, &[&str])] = &[
    ("Genesis", &["genesis", "gen", "ge", "gn"]),
    ("Exodus", &["exodus", "exod", "exo", "ex"]),
    ("Leviticus", &["leviticus", "lev", "le", "lv"]),
    ("Numbers", &["numbers", "num", "nu", "nm", "nb"]),
    ("Deuteronomy", &["deuteronomy", "deut", "deu", "dt"]),
    ("Joshua", &["joshua", "josh", "jos", "jsh"]),
    ("Judges", &["judges", "judg", "jdg", "jg", "jdgs"]),
    ("Ruth", &["ruth", "rth", "ru"]),
    ("1 Samuel", &["1 samuel", "1samuel", "1 sam", "1sam", "1 sa", "1sa", "i samuel", "i sam"]),
    ("2 Samuel", &["2 samuel", "2samuel", "2 sam", "2sam", "2 sa", "2sa", "ii samuel", "ii sam"]),
    ("1 Kings", &["1 kings", "1kings", "1 kgs", "1kgs", "1 ki", "1ki", "i kings", "i kgs"]),
    ("2 Kings", &["2 kings", "2kings", "2 kgs", "2kgs", "2 ki", "2ki", "ii kings", "ii kgs"]),
    ("1 Chronicles", &["1 chronicles", "1chronicles", "1 chron", "1chron", "1 chr", "1chr", "1 ch", "i chronicles", "i chr"]),
    ("2 Chronicles", &["2 chronicles", "2chronicles", "2 chron", "2chron", "2 chr", "2chr", "2 ch", "ii chronicles", "ii chr"]),
    ("Ezra", &["ezra", "ezr", "ez"]),
    ("Nehemiah", &["nehemiah", "neh", "ne"]),
    ("Esther", &["esther", "esth", "est", "es"]),
    ("Job", &["job", "jb"]),
    ("Psalms", &["psalms", "psalm", "psa", "psm", "pss", "ps"]),
    ("Proverbs", &["proverbs", "proverb", "prov", "pro", "prv", "pr"]),
    ("Ecclesiastes", &["ecclesiastes", "eccles", "eccle", "eccl", "ecc", "qoh"]),
    ("Song of Solomon", &["song of solomon", "song of songs", "song", "sos", "cant", "canticles", "sng"]),
    ("Isaiah", &["isaiah", "isa", "is"]),
    ("Jeremiah", &["jeremiah", "jer", "je", "jr"]),
    ("Lamentations", &["lamentations", "lam", "la"]),
    ("Ezekiel", &["ezekiel", "ezek", "eze", "ezk"]),
    ("Daniel", &["daniel", "dan", "da", "dn"]),
    ("Hosea", &["hosea", "hos", "ho"]),
    ("Joel", &["joel", "joe", "jl"]),
    ("Amos", &["amos", "amo", "am"]),
    ("Obadiah", &["obadiah", "obad", "oba", "ob"]),
    ("Jonah", &["jonah", "jnh", "jon"]),
    ("Micah", &["micah", "mic", "mc"]),
    ("Nahum", &["nahum", "nah", "na"]),
    ("Habakkuk", &["habakkuk", "hab", "hb"]),
    ("Zephaniah", &["zephaniah", "zeph", "zep", "zp"]),
    ("Haggai", &["haggai", "hag", "hg"]),
    ("Zechariah", &["zechariah", "zech", "zec", "zc"]),
    ("Malachi", &["malachi", "mal", "ml"]),
    ("Matthew", &["matthew", "matt", "mat", "mt"]),
    ("Mark", &["mark", "mrk", "mar", "mk", "mr"]),
    ("Luke", &["luke", "luk", "lk"]),
    ("John", &["john", "joh", "jhn", "jn"]),
    ("Acts", &["acts", "act", "ac"]),
    ("Romans", &["romans", "rom", "ro", "rm"]),
    ("1 Corinthians", &["1 corinthians", "1corinthians", "1 cor", "1cor", "1 co", "1co", "i corinthians", "i cor"]),
    ("2 Corinthians", &["2 corinthians", "2corinthians", "2 cor", "2cor", "2 co", "2co", "ii corinthians", "ii cor"]),
    ("Galatians", &["galatians", "gal", "ga"]),
    ("Ephesians", &["ephesians", "eph", "ephes"]),
    ("Philippians", &["philippians", "phil", "php", "pp"]),
    ("Colossians", &["colossians", "col", "co"]),
    ("1 Thessalonians", &["1 thessalonians", "1thessalonians", "1 thess", "1thess", "1 thes", "1thes", "1 th", "1th", "i thessalonians", "i thess"]),
    ("2 Thessalonians", &["2 thessalonians", "2thessalonians", "2 thess", "2thess", "2 thes", "2thes", "2 th", "2th", "ii thessalonians", "ii thess"]),
    ("1 Timothy", &["1 timothy", "1timothy", "1 tim", "1tim", "1 ti", "1ti", "i timothy", "i tim"]),
    ("2 Timothy", &["2 timothy", "2timothy", "2 tim", "2tim", "2 ti", "2ti", "ii timothy", "ii tim"]),
    ("Titus", &["titus", "tit", "ti"]),
    ("Philemon", &["philemon", "philem", "phlm", "phm", "pm"]),
    ("Hebrews", &["hebrews", "heb"]),
    ("James", &["james", "jas", "jm", "jam"]),
    ("1 Peter", &["1 peter", "1peter", "1 pet", "1pet", "1 pe", "1pe", "1 pt", "1pt", "i peter", "i pet"]),
    ("2 Peter", &["2 peter", "2peter", "2 pet", "2pet", "2 pe", "2pe", "2 pt", "2pt", "ii peter", "ii pet"]),
    ("1 John", &["1 john", "1john", "1 jhn", "1jhn", "1 jn", "1jn", "i john", "i jn"]),
    ("2 John", &["2 john", "2john", "2 jhn", "2jhn", "2 jn", "2jn", "ii john", "ii jn"]),
    ("3 John", &["3 john", "3john", "3 jhn", "3jhn", "3 jn", "3jn", "iii john", "iii jn"]),
    ("Jude", &["jude", "jud", "jd"]),
    ("Revelation", &["revelation", "revelations", "rev", "re", "apoc"]),
];

pub fn canonical_book_name(raw: &str) -> Option<&'static str> {
    let norm = raw
        .trim()
        .trim_end_matches('.')
        .to_ascii_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if norm.is_empty() {
        return None;
    }
    for &(canon, aliases) in CANONICAL_BOOKS {
        if aliases.iter().any(|&a| a == norm) {
            return Some(canon);
        }
    }
    None
}

/// Parses `"Matthew 4:9"`, `"Matt 4:8-11"`, `"1 Cor 15:3–8"`, `"Matthew 4"`, or `"Matthew"`.
pub fn parse_bible_reference(raw: &str) -> Option<BibleRef> {
    let cleaned = raw
        .trim()
        .replace(['–', '—'], "-");
    if cleaned.is_empty() {
        return None;
    }

    // Try direct book-only match first
    if let Some(book) = canonical_book_name(&cleaned) {
        return Some(BibleRef {
            book: book.to_string(),
            chapter: None,
            start_verse: None,
            end_verse: None,
        });
    }

    // Split off trailing chapter[:verse[-end_verse]] token
    let tokens: Vec<&str> = cleaned.split_whitespace().collect();
    if tokens.len() < 2 {
        return None;
    }

    let last = tokens[tokens.len() - 1].trim_end_matches([',', ';', '.', ')']);
    let book_part = tokens[..tokens.len() - 1].join(" ");
    let book = canonical_book_name(&book_part)?;

    let (chapter, start_verse, end_verse) = parse_chapter_verse_token(last)?;
    Some(BibleRef {
        book: book.to_string(),
        chapter: Some(chapter),
        start_verse,
        end_verse,
    })
}

fn parse_chapter_verse_token(token: &str) -> Option<(i64, Option<i64>, Option<i64>)> {
    if let Some((ch_s, v_part)) = token.split_once(':') {
        let ch: i64 = ch_s.parse().ok()?;
        if ch <= 0 {
            return None;
        }
        if let Some((sv_s, ev_s)) = v_part.split_once('-') {
            let sv: i64 = sv_s.parse().ok()?;
            let ev: i64 = ev_s.parse().ok()?;
            if sv > 0 && ev >= sv {
                return Some((ch, Some(sv), Some(ev)));
            }
            return Some((ch, Some(sv), Some(sv)));
        }
        let sv: i64 = v_part.parse().ok()?;
        if sv > 0 {
            return Some((ch, Some(sv), Some(sv)));
        }
        return None;
    }
    let ch: i64 = token.parse().ok()?;
    if ch > 0 {
        Some((ch, None, None))
    } else {
        None
    }
}

/// Scans prose/Markdown for explicit `Book Chapter:Verse[-End]` citations.
pub fn extract_bible_citations(text: &str) -> Vec<BibleRef> {
    let words: Vec<&str> = text
        .split(|c: char| c.is_whitespace() || matches!(c, '[' | ']' | '(' | ')' | '{' | '}' | '"' | '\''))
        .filter(|s| !s.is_empty())
        .collect();
    let mut found = Vec::new();
    let mut seen: HashSet<BibleRef> = HashSet::new();

    for i in 0..words.len() {
        let w = words[i]
            .trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != ':' && c != '-' && c != '–')
            .replace(['–', '—'], "-");
        if !w.contains(':') {
            continue;
        }
        let Some((ch, sv, ev)) = parse_chapter_verse_token(&w) else {
            continue;
        };
        if sv.is_none() {
            continue;
        }

        // Look back 1, 2, or 3 words for a canonical book name (e.g. "Matthew", "1 Cor", "Song of Solomon")
        let mut matched_book: Option<&'static str> = None;
        for back in [3usize, 2, 1] {
            if i >= back {
                let cand = words[i - back..i]
                    .iter()
                    .map(|s| s.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '.'))
                    .collect::<Vec<_>>()
                    .join(" ");
                if let Some(b) = canonical_book_name(&cand) {
                    matched_book = Some(b);
                    break;
                }
            }
        }
        if let Some(book) = matched_book {
            let bref = BibleRef {
                book: book.to_string(),
                chapter: Some(ch),
                start_verse: sv,
                end_verse: ev,
            };
            if seen.insert(bref.clone()) {
                found.push(bref);
            }
        }
    }
    found
}

// ── Biblical & Theological Concept Thesaurus + Hybrid Conceptual Search ────

const CONCEPT_CLUSTERS: &[&[&str]] = &[
    &["torah", "law", "mosaic", "commandments", "commandment", "mitzvot", "nomos", "sinai", "statutes", "deuteronomy", "leviticus"],
    &["gospel", "evangel", "euangelion", "good news", "kerygma", "salvation", "deliverance"],
    &["satan", "devil", "adversary", "tempter", "diabolos", "lucifer", "serpent", "deceiver", "accusation", "accuser", "beelzebul"],
    &["kingdom", "dominion", "authority", "jurisdiction", "sovereignty", "reign", "basileia", "throne", "rule", "ruler", "rulership", "power", "exousia"],
    &["worship", "bow", "proskuneo", "idolatry", "idol", "homage", "reverence", "adoration", "serve", "latreuo"],
    &["temptation", "test", "testing", "trial", "wilderness", "fasting", "peirasmos"],
    &["covenant", "testament", "berit", "diatheke", "promise", "oath", "abrahamic", "davidic", "new covenant", "old covenant", "supersessionism"],
    &["grace", "mercy", "charis", "chesed", "favor", "unmerited", "lovingkindness", "compassion"],
    &["faith", "belief", "believe", "trust", "pistis", "faithfulness", "emunah", "allegiance", "loyalty"],
    &["justification", "righteousness", "dikaiosyne", "imputed", "declared righteous", "reckoned", "credited", "sanctification"],
    &["atonement", "propitiation", "sacrifice", "ransom", "blood", "expiation", "substitution", "penal", "christus victor", "cross", "crucifixion", "passover", "lamb"],
    &["resurrection", "anastasis", "raised", "risen", "immortality", "afterlife", "bodily", "firstfruits", "empty tomb"],
    &["trinity", "triune", "godhead", "deity", "incarnation", "logos", "christology", "hypostatic", "divinity", "monotheism", "shema"],
    &["election", "predestination", "chosen", "foreknowledge", "calvinism", "arminianism", "free will", "sovereign", "determinism", "molinism"],
    &["eschatology", "millennium", "tribulation", "rapture", "parousia", "second coming", "apocalypse", "antichrist", "preterism", "amillennial", "premillennial", "postmillennial"],
    &["temple", "tabernacle", "sanctuary", "priesthood", "priest", "altar", "ezekiel", "levitical", "melchizedek", "holy of holies", "sacrifice"],
    &["sabbath", "shabbat", "rest", "seventh day", "lords day", "sunday", "feast", "feasts", "festival", "moedim"],
    &["baptism", "immersion", "mikveh", "circumcision", "sacrament", "ordinance", "eucharist", "communion", "lords supper"],
    &["sin", "transgression", "iniquity", "hamartia", "depravity", "fall", "original sin", "repentance", "metanoia", "forgiveness"],
    &["church", "ekklesia", "assembly", "congregation", "israel", "gentiles", "nations", "grafted", "remnant", "dispensationalism"],
    &["spirit", "holy spirit", "pneuma", "ruach", "pneumatology", "charisma", "gifts", "tongues", "prophecy", "cessationism", "continuationism"],
    &["scripture", "inerrancy", "inspiration", "canon", "hermeneutics", "exegesis", "eisegesis", "typology", "allegory", "sola scriptura", "tradition"],
    &["angel", "angels", "divine council", "elohim", "watchers", "nephilim", "demons", "principalities", "powers", "heavenly"],
    &["hell", "gehenna", "sheol", "hades", "annihilationism", "conditionalism", "eternal conscious torment", "universalism", "judgment", "lake of fire"],
    &["creation", "genesis", "eden", "image of god", "imago dei", "evolution", "cosmos", "flood"],
    &["ethics", "morality", "justice", "government", "state", "war", "pacifism", "marriage", "divorce", "oaths", "work", "vocation"],
    &["prayer", "intercession", "fasting", "almsgiving", "discipleship", "sermon on the mount", "beatitudes"],
    &["messiah", "christ", "mashiach", "son of man", "son of god", "suffering servant", "david", "anointed"],
];

pub fn detect_theological_concepts(text: &str) -> Vec<String> {
    let tokens = tokenize_index_terms(text);
    let joined = tokens.join(" ");
    let mut matched = Vec::new();
    for cluster in CONCEPT_CLUSTERS {
        let hit = cluster.iter().any(|term| {
            if term.contains(' ') {
                joined.contains(term)
            } else {
                tokens.iter().any(|t| t == term || (t.len() >= 5 && term.starts_with(t.as_str())))
            }
        });
        if hit {
            if let Some(&head) = cluster.first() {
                matched.push(head.to_string());
            }
        }
    }
    matched
}

/// Entity types indexed into `berean.db`'s encrypted `ai_semantic_index` table.
pub const AI_INDEXED_ENTITY_TYPES: &[&str] = &[
    "MindNote",
    "Annotation",
    "StudyChapter",
    "KnowledgeWeb",
    "WebCard",
    "CanvasObject",
    "StudyCanvasObject",
    "Keyword",
    "Timegraph",
    "Spreadsheet",
];

/// Builds a canonical, lossless, AI-ready JSON document for an entity (to be stored
/// AES-256-GCM encrypted inside `berean.db`'s `ai_semantic_index` table).
/// Returns `None` for password-locked private Knowledge Webs and their children.
pub fn build_ai_semantic_doc(
    entity_type: &str,
    rec: &Value,
    private_web_ids: &HashSet<i64>,
) -> Option<(String, Value)> {
    let id = rec.get("id").and_then(|v| v.as_i64())?;
    let updated = str_field(rec, "updated_date");
    let folder_id = rec.get("folder_id").and_then(|v| v.as_i64());

    match entity_type {
        "MindNote" => {
            let title = rec.get("title").and_then(|v| v.as_str()).unwrap_or("Untitled Note");
            let content = rec.get("content").and_then(|v| v.as_str()).unwrap_or("");
            let pages = split_book_pages_detailed(content, title);
            let mut rendered_pages = Vec::new();
            let mut full_md = String::new();
            let mut links = Vec::new();
            let mut cits: Vec<String> = Vec::new();
            for (p_num, p_title, p_raw) in pages {
                let fmt = rich_html_to_markdown(&p_raw);
                if !full_md.is_empty() {
                    full_md.push_str("\n\n---\n\n");
                }
                if rendered_pages.len() > 0 || p_title != title {
                    full_md.push_str(&format!("## Page {p_num}: {p_title}\n\n"));
                }
                full_md.push_str(&fmt.markdown);
                for c in fmt.verse_citations {
                    let s = c.display_ref();
                    if !cits.contains(&s) {
                        cits.push(s);
                    }
                }
                links.extend(fmt.links);
                rendered_pages.push(json!({ "page": p_num, "title": p_title, "markdown": fmt.markdown }));
            }
            let concepts = detect_theological_concepts(&format!("{title} {full_md}"));
            let word_count = full_md.split_whitespace().count();
            let source_id = format!("note:{id}");
            Some((
                source_id.clone(),
                json!({
                    "schema_version": 1,
                    "source_id": source_id,
                    "entity_type": "MindNote",
                    "id": id,
                    "title": title,
                    "folder_id": folder_id,
                    "page_count": rendered_pages.len(),
                    "pages": rendered_pages,
                    "markdown": full_md,
                    "citations": cits,
                    "outbound_links": links,
                    "concepts": concepts,
                    "word_count": word_count,
                    "updated_date": updated,
                }),
            ))
        }
        "Annotation" => {
            let raw_book = rec.get("book").and_then(|v| v.as_str()).unwrap_or("");
            let book = canonical_book_name(raw_book).unwrap_or(raw_book);
            let ch = rec.get("chapter_number").and_then(|v| v.as_i64()).unwrap_or(0);
            let sv = rec.get("start_verse").and_then(|v| v.as_i64());
            let ev = rec.get("end_verse").and_then(|v| v.as_i64()).or(sv);
            let passage = format_passage_label(book, ch, sv, ev);
            let content = rec
                .get("content")
                .or_else(|| rec.get("note"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let fmt = rich_html_to_markdown(content);
            let mut cits: Vec<String> = fmt.verse_citations.iter().map(|c| c.display_ref()).collect();
            if !passage.is_empty() && !cits.contains(&passage) {
                cits.insert(0, passage.clone());
            }
            let concepts = detect_theological_concepts(&format!("{passage} {}", fmt.markdown));
            let word_count = fmt.markdown.split_whitespace().count();
            let source_id = format!("commentary:{id}");
            Some((
                source_id.clone(),
                json!({
                    "schema_version": 1,
                    "source_id": source_id,
                    "entity_type": "Annotation",
                    "id": id,
                    "title": format!("Commentary on {passage}"),
                    "passage": passage,
                    "book": book,
                    "chapter": ch,
                    "start_verse": sv,
                    "end_verse": ev,
                    "version": str_field(rec, "version"),
                    "selected_text": str_field(rec, "selected_text"),
                    "markdown": fmt.markdown,
                    "citations": cits,
                    "outbound_links": fmt.links,
                    "concepts": concepts,
                    "word_count": word_count,
                    "updated_date": updated,
                }),
            ))
        }
        "StudyChapter" => {
            let raw_book = rec.get("book").and_then(|v| v.as_str()).unwrap_or("");
            let book = canonical_book_name(raw_book).unwrap_or(raw_book);
            let ch = rec.get("chapter_number").and_then(|v| v.as_i64()).unwrap_or(0);
            let notes = rich_html_to_markdown(&str_field(rec, "notes")).markdown;
            let context = rich_html_to_markdown(&str_field(rec, "context")).markdown;
            let application = rich_html_to_markdown(&str_field(rec, "application")).markdown;
            let combined = [notes.as_str(), context.as_str(), application.as_str()]
                .into_iter()
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join("\n\n");
            let cits: Vec<String> = extract_bible_citations(&combined)
                .into_iter()
                .map(|c| c.display_ref())
                .collect();
            let concepts = detect_theological_concepts(&combined);
            let source_id = format!("study:{id}");
            Some((
                source_id.clone(),
                json!({
                    "schema_version": 1,
                    "source_id": source_id,
                    "entity_type": "StudyChapter",
                    "id": id,
                    "title": format!("{book} {ch}"),
                    "book": book,
                    "chapter": ch,
                    "version": str_field(rec, "version"),
                    "notes": notes,
                    "context": context,
                    "application": application,
                    "markdown": combined,
                    "citations": cits,
                    "concepts": concepts,
                    "word_count": combined.split_whitespace().count(),
                    "updated_date": updated,
                }),
            ))
        }
        "KnowledgeWeb" => {
            if is_private_web(rec) {
                return None;
            }
            let title = rec.get("title").and_then(|v| v.as_str()).unwrap_or("Knowledge Web");
            let fmt = rich_html_to_markdown(&str_field(rec, "description"));
            let concepts = detect_theological_concepts(&format!("{title} {}", fmt.markdown));
            let source_id = format!("web:{id}");
            Some((
                source_id.clone(),
                json!({
                    "schema_version": 1,
                    "source_id": source_id,
                    "entity_type": "KnowledgeWeb",
                    "id": id,
                    "title": title,
                    "folder_id": folder_id,
                    "markdown": fmt.markdown,
                    "citations": fmt.verse_citations.iter().map(|c| c.display_ref()).collect::<Vec<_>>(),
                    "outbound_links": fmt.links,
                    "concepts": concepts,
                    "word_count": fmt.markdown.split_whitespace().count(),
                    "updated_date": updated,
                }),
            ))
        }
        "WebCard" => {
            let wid = rec.get("web_id").and_then(|v| v.as_i64())?;
            if private_web_ids.contains(&wid) {
                return None;
            }
            let title = rec.get("title").and_then(|v| v.as_str()).unwrap_or("Card");
            let fmt = rich_html_to_markdown(&str_field(rec, "description"));
            let concepts = detect_theological_concepts(&format!("{title} {}", fmt.markdown));
            let source_id = format!("web:{wid}/card:{id}");
            Some((
                source_id.clone(),
                json!({
                    "schema_version": 1,
                    "source_id": source_id,
                    "entity_type": "WebCard",
                    "id": id,
                    "web_id": wid,
                    "title": title,
                    "tags": rec.get("tags").cloned().unwrap_or(json!([])),
                    "markdown": fmt.markdown,
                    "citations": fmt.verse_citations.iter().map(|c| c.display_ref()).collect::<Vec<_>>(),
                    "outbound_links": fmt.links,
                    "concepts": concepts,
                    "word_count": fmt.markdown.split_whitespace().count(),
                    "updated_date": updated,
                }),
            ))
        }
        "CanvasObject" => {
            let wid = rec.get("web_id").and_then(|v| v.as_i64())?;
            if private_web_ids.contains(&wid) {
                return None;
            }
            let title = rec
                .get("title")
                .or_else(|| rec.get("object_type"))
                .and_then(|v| v.as_str())
                .unwrap_or("Canvas Object");
            let fmt = rich_html_to_markdown(&str_field(rec, "content"));
            let source_id = format!("web:{wid}/object:{id}");
            Some((
                source_id.clone(),
                json!({
                    "schema_version": 1,
                    "source_id": source_id,
                    "entity_type": "CanvasObject",
                    "id": id,
                    "web_id": wid,
                    "object_type": str_field(rec, "object_type"),
                    "title": title,
                    "markdown": fmt.markdown,
                    "citations": fmt.verse_citations.iter().map(|c| c.display_ref()).collect::<Vec<_>>(),
                    "outbound_links": fmt.links,
                    "updated_date": updated,
                }),
            ))
        }
        "StudyCanvasObject" => {
            let title = rec
                .get("title")
                .or_else(|| rec.get("object_type"))
                .and_then(|v| v.as_str())
                .unwrap_or("Study Canvas Object");
            let fmt = rich_html_to_markdown(&str_field(rec, "content"));
            let source_id = format!("study-object:{id}");
            Some((
                source_id.clone(),
                json!({
                    "schema_version": 1,
                    "source_id": source_id,
                    "entity_type": "StudyCanvasObject",
                    "id": id,
                    "title": title,
                    "markdown": fmt.markdown,
                    "citations": fmt.verse_citations.iter().map(|c| c.display_ref()).collect::<Vec<_>>(),
                    "outbound_links": fmt.links,
                    "updated_date": updated,
                }),
            ))
        }
        "Keyword" => {
            let title = rec.get("title").and_then(|v| v.as_str()).unwrap_or("Keyword");
            let raw = rec
                .get("explanation")
                .or_else(|| rec.get("definition"))
                .or_else(|| rec.get("content"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let fmt = rich_html_to_markdown(raw);
            let concepts = detect_theological_concepts(&format!("{title} {}", fmt.markdown));
            let source_id = format!("keyword:{id}");
            Some((
                source_id.clone(),
                json!({
                    "schema_version": 1,
                    "source_id": source_id,
                    "entity_type": "Keyword",
                    "id": id,
                    "title": title,
                    "category": str_field(rec, "category"),
                    "markdown": fmt.markdown,
                    "citations": fmt.verse_citations.iter().map(|c| c.display_ref()).collect::<Vec<_>>(),
                    "outbound_links": fmt.links,
                    "concepts": concepts,
                    "word_count": fmt.markdown.split_whitespace().count(),
                    "updated_date": updated,
                }),
            ))
        }
        "Timegraph" => {
            let title = rec.get("title").and_then(|v| v.as_str()).unwrap_or("Timeline");
            let desc = rich_html_to_markdown(&str_field(rec, "description")).markdown;
            let mut ev_lines = Vec::new();
            if let Some(events) = rec.get("events").and_then(|v| v.as_array()) {
                for ev in events {
                    let et = str_field(ev, "title");
                    let ed = rich_html_to_markdown(&str_field(ev, "description")).markdown;
                    ev_lines.push(format!("- {et}: {ed}"));
                }
            }
            let combined = format!("{desc}\n\n{}", ev_lines.join("\n")).trim().to_string();
            let cits: Vec<String> = extract_bible_citations(&combined)
                .into_iter()
                .map(|c| c.display_ref())
                .collect();
            let concepts = detect_theological_concepts(&format!("{title} {combined}"));
            let source_id = format!("timeline:{id}");
            Some((
                source_id.clone(),
                json!({
                    "schema_version": 1,
                    "source_id": source_id,
                    "entity_type": "Timegraph",
                    "id": id,
                    "title": title,
                    "event_count": ev_lines.len(),
                    "markdown": combined,
                    "citations": cits,
                    "concepts": concepts,
                    "word_count": combined.split_whitespace().count(),
                    "updated_date": updated,
                }),
            ))
        }
        "Spreadsheet" => {
            let title = rec.get("title").and_then(|v| v.as_str()).unwrap_or("Spreadsheet");
            let mut lines = Vec::new();
            if let Some(sheets) = rec.get("workbook").and_then(|w| w.get("sheets")).and_then(|s| s.as_array()) {
                for sh in sheets {
                    let sname = sh.get("name").and_then(|v| v.as_str()).unwrap_or("Sheet");
                    if let Some(cells) = sh.get("cells").and_then(|c| c.as_object()) {
                        for (addr, cell) in cells {
                            let v = cell.get("v").map(json_scalar_to_string).unwrap_or_default();
                            let n = cell.get("note").and_then(|x| x.as_str()).unwrap_or("");
                            if !v.trim().is_empty() || !n.trim().is_empty() {
                                lines.push(format!("{sname}!{addr}: {v} {n}").trim().to_string());
                            }
                        }
                    }
                }
            }
            let combined = lines.join("\n");
            let cits: Vec<String> = extract_bible_citations(&combined)
                .into_iter()
                .map(|c| c.display_ref())
                .collect();
            let concepts = detect_theological_concepts(&format!("{title} {combined}"));
            let source_id = format!("spreadsheet:{id}");
            Some((
                source_id.clone(),
                json!({
                    "schema_version": 1,
                    "source_id": source_id,
                    "entity_type": "Spreadsheet",
                    "id": id,
                    "title": title,
                    "non_empty_cells": lines.len(),
                    "markdown": combined,
                    "citations": cits,
                    "concepts": concepts,
                    "word_count": combined.split_whitespace().count(),
                    "updated_date": updated,
                }),
            ))
        }
        _ => None,
    }
}

fn expand_theological_concepts(tokens: &[String]) -> HashMap<String, f32> {
    let mut weights: HashMap<String, f32> = HashMap::new();
    for tok in tokens {
        *weights.entry(tok.clone()).or_insert(0.0) += 1.0;
    }
    let query_joined = tokens.join(" ");
    for cluster in CONCEPT_CLUSTERS {
        let hit = cluster.iter().any(|term| {
            if term.contains(' ') {
                query_joined.contains(term)
            } else {
                tokens.iter().any(|t| t == term || (t.len() >= 5 && term.starts_with(t.as_str())))
            }
        });
        if hit {
            for &related in *cluster {
                for sub in tokenize_index_terms(related) {
                    weights.entry(sub).or_insert(0.42);
                }
            }
        }
    }
    weights
}

fn is_stopword(w: &str) -> bool {
    matches!(
        w,
        "the" | "and" | "for" | "that" | "this" | "with" | "from" | "are" | "was" | "were"
            | "have" | "has" | "had" | "not" | "but" | "you" | "your" | "what" | "when"
            | "where" | "which" | "who" | "how" | "why" | "all" | "any" | "can" | "will"
            | "into" | "onto" | "upon" | "about" | "their" | "there" | "these" | "those"
            | "than" | "then" | "they" | "them" | "been" | "being" | "also" | "more"
            | "most" | "some" | "such" | "only" | "over" | "very" | "just" | "should"
            | "would" | "could" | "does" | "did" | "its" | "our" | "his" | "her" | "she"
            | "him" | "out" | "off" | "too"
    )
}

pub fn tokenize_index_terms(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric() && c != '\'')
        .map(|s| s.trim_matches('\''))
        .filter(|s| s.len() >= 2 && !is_stopword(s))
        .map(|s| s.to_string())
        .collect()
}

#[derive(Debug, Clone)]
pub struct IndexedDoc {
    pub source_id: String,
    pub entity_type: String,
    pub record_id: i64,
    pub parent_id: Option<i64>,
    pub page: Option<usize>,
    pub title: String,
    pub workspace_title: String,
    pub href: String,
    pub body_plain: String,
    pub tf: HashMap<String, f32>,
    pub norm: f32,
    pub citations: Vec<BibleRef>,
    pub updated_date: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct HybridSearchHit {
    pub source_id: String,
    pub entity_type: String,
    pub record_id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page: Option<usize>,
    pub title: String,
    pub workspace_title: String,
    pub href: String,
    pub snippet: String,
    pub score: f32,
    pub match_reasons: Vec<String>,
    pub citations: Vec<String>,
    pub updated_date: String,
}

pub struct ConceptualIndex {
    pub docs: Vec<IndexedDoc>,
    idf: HashMap<String, f32>,
    by_source_id: HashMap<String, usize>,
}

impl ConceptualIndex {
    pub fn build(cache: &HashMap<&'static str, Vec<Value>>) -> Self {
        let mut docs: Vec<IndexedDoc> = Vec::new();
        let webs = cache.get("KnowledgeWeb").map(|v| v.as_slice()).unwrap_or(&[]);
        let web_map: HashMap<i64, &Value> = webs
            .iter()
            .filter_map(|w| w.get("id").and_then(|v| v.as_i64()).map(|id| (id, w)))
            .collect();

        // 1. Notes & Book Pages
        for note in cache.get("MindNote").map(|v| v.as_slice()).unwrap_or(&[]) {
            let id = note.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
            let title = note.get("title").and_then(|v| v.as_str()).unwrap_or("Untitled Note");
            let content = note.get("content").and_then(|v| v.as_str()).unwrap_or("");
            let upd = str_field(note, "updated_date");
            let pages = split_book_pages_detailed(content, title);
            if pages.len() <= 1 {
                let fmt = rich_html_to_markdown(content);
                docs.push(make_doc(
                    format!("note:{id}"),
                    "Note",
                    id,
                    None,
                    Some(1),
                    title.to_string(),
                    title.to_string(),
                    format!("/notes/{id}"),
                    fmt.markdown,
                    fmt.verse_citations,
                    upd,
                ));
            } else {
                for (p_num, p_title, p_raw) in pages {
                    let fmt = rich_html_to_markdown(&p_raw);
                    let combined = if p_num == 1 {
                        title.to_string()
                    } else {
                        format!("{title} — {p_title}")
                    };
                    docs.push(make_doc(
                        format!("note:{id}/page:{p_num}"),
                        "Note",
                        id,
                        Some(id),
                        Some(p_num),
                        combined,
                        title.to_string(),
                        format!("/notes/{id}?page={p_num}"),
                        fmt.markdown,
                        fmt.verse_citations,
                        upd.clone(),
                    ));
                }
            }
        }

        // 2. Bible Commentaries (Annotations)
        for ann in cache.get("Annotation").map(|v| v.as_slice()).unwrap_or(&[]) {
            let id = ann.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
            let book = ann.get("book").and_then(|v| v.as_str()).unwrap_or("");
            let ch = ann.get("chapter_number").and_then(|v| v.as_i64()).unwrap_or(0);
            let sv = ann.get("start_verse").and_then(|v| v.as_i64());
            let ev = ann.get("end_verse").and_then(|v| v.as_i64());
            let passage = format_passage_label(book, ch, sv, ev);
            let selected = ann.get("selected_text").and_then(|v| v.as_str()).unwrap_or("");
            let content = ann
                .get("content")
                .or_else(|| ann.get("note"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let fmt = rich_html_to_markdown(content);
            let mut body = String::new();
            if !selected.trim().is_empty() {
                body.push_str("> ");
                body.push_str(selected.trim());
                body.push_str("\n\n");
            }
            body.push_str(&fmt.markdown);
            let mut cits = fmt.verse_citations;
            if let Some(canon) = canonical_book_name(book) {
                if ch > 0 {
                    cits.push(BibleRef {
                        book: canon.to_string(),
                        chapter: Some(ch),
                        start_verse: sv,
                        end_verse: ev.or(sv),
                    });
                }
            }
            docs.push(make_doc(
                format!("commentary:{id}"),
                "Commentary",
                id,
                None,
                None,
                format!("Commentary on {passage}"),
                format!("{book} {ch}"),
                format!("/Study?q={}&annotation_id={id}", passage.replace(' ', "%20")),
                body,
                cits,
                str_field(ann, "updated_date"),
            ));
        }

        // 3. Study Chapters (user notes/context/application)
        for ch_rec in cache.get("StudyChapter").map(|v| v.as_slice()).unwrap_or(&[]) {
            let id = ch_rec.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
            let book = ch_rec.get("book").and_then(|v| v.as_str()).unwrap_or("");
            let num = ch_rec.get("chapter_number").and_then(|v| v.as_i64()).unwrap_or(0);
            let mut parts = Vec::new();
            for field in ["notes", "context", "application"] {
                if let Some(s) = ch_rec.get(field).and_then(|v| v.as_str()) {
                    let md = rich_html_to_markdown(s).markdown;
                    if !md.is_empty() {
                        parts.push(format!("### {field}\n{md}"));
                    }
                }
            }
            if parts.is_empty() {
                continue;
            }
            let body = parts.join("\n\n");
            let mut cits = extract_bible_citations(&body);
            if let Some(canon) = canonical_book_name(book) {
                if num > 0 {
                    cits.push(BibleRef {
                        book: canon.to_string(),
                        chapter: Some(num),
                        start_verse: None,
                        end_verse: None,
                    });
                }
            }
            docs.push(make_doc(
                format!("study:{id}"),
                "Chapter Study",
                id,
                None,
                None,
                format!("{book} {num} Study"),
                format!("{book} {num}"),
                format!("/Study?chapter_id={id}"),
                body,
                cits,
                str_field(ch_rec, "updated_date"),
            ));
        }

        // 4. Knowledge Webs & 5. Web Cards & Canvas Objects
        for w in webs {
            if is_private_web(w) {
                continue;
            }
            let id = w.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
            let title = w.get("title").and_then(|v| v.as_str()).unwrap_or("Knowledge Web");
            let desc = w.get("description").and_then(|v| v.as_str()).unwrap_or("");
            let fmt = rich_html_to_markdown(desc);
            docs.push(make_doc(
                format!("web:{id}"),
                "Knowledge Web",
                id,
                None,
                None,
                title.to_string(),
                title.to_string(),
                format!("/knowledge-webs/{id}"),
                fmt.markdown,
                fmt.verse_citations,
                str_field(w, "updated_date"),
            ));
        }

        for card in cache.get("WebCard").map(|v| v.as_slice()).unwrap_or(&[]) {
            let id = card.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
            let web_id = card.get("web_id").and_then(|v| v.as_i64()).unwrap_or(0);
            let Some(pw) = web_map.get(&web_id) else {
                continue;
            };
            if is_private_web(pw) {
                continue;
            }
            let web_title = pw.get("title").and_then(|v| v.as_str()).unwrap_or("Knowledge Web");
            let title = card.get("title").and_then(|v| v.as_str()).unwrap_or("Untitled Card");
            let desc = card.get("description").and_then(|v| v.as_str()).unwrap_or("");
            let fmt = rich_html_to_markdown(desc);
            let mut body = fmt.markdown;
            if let Some(tags) = card.get("tags").and_then(|v| v.as_array()) {
                let tag_strs: Vec<&str> = tags.iter().filter_map(|t| t.as_str()).collect();
                if !tag_strs.is_empty() {
                    if !body.is_empty() {
                        body.push_str("\n\n");
                    }
                    body.push_str("Tags: ");
                    body.push_str(&tag_strs.join(", "));
                }
            }
            docs.push(make_doc(
                format!("web:{web_id}/card:{id}"),
                "Web Card",
                id,
                Some(web_id),
                None,
                title.to_string(),
                web_title.to_string(),
                format!("/knowledge-webs/{web_id}"),
                body,
                fmt.verse_citations,
                str_field(card, "updated_date"),
            ));
        }

        // 6. Keywords
        for kw in cache.get("Keyword").map(|v| v.as_slice()).unwrap_or(&[]) {
            let id = kw.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
            let title = kw.get("title").and_then(|v| v.as_str()).unwrap_or("Keyword");
            let cat = kw.get("category").and_then(|v| v.as_str()).unwrap_or("");
            let raw_body = kw
                .get("explanation")
                .or_else(|| kw.get("definition"))
                .or_else(|| kw.get("content"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let fmt = rich_html_to_markdown(raw_body);
            let body = if cat.is_empty() {
                fmt.markdown
            } else {
                format!("Category: {cat}\n\n{}", fmt.markdown)
            };
            docs.push(make_doc(
                format!("keyword:{id}"),
                "Keyword",
                id,
                None,
                None,
                title.to_string(),
                title.to_string(),
                format!("/Keywords?keyword={id}"),
                body,
                fmt.verse_citations,
                str_field(kw, "updated_date"),
            ));
        }

        // 7. Timelines & Events
        for tg in cache.get("Timegraph").map(|v| v.as_slice()).unwrap_or(&[]) {
            let id = tg.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
            let title = tg.get("title").and_then(|v| v.as_str()).unwrap_or("Timeline");
            let desc = tg.get("description").and_then(|v| v.as_str()).unwrap_or("");
            let fmt = rich_html_to_markdown(desc);
            let upd = str_field(tg, "updated_date");
            docs.push(make_doc(
                format!("timeline:{id}"),
                "Timeline",
                id,
                None,
                None,
                title.to_string(),
                title.to_string(),
                format!("/timegraphs/{id}"),
                fmt.markdown,
                fmt.verse_citations,
                upd.clone(),
            ));
            if let Some(events) = tg.get("events").and_then(|v| v.as_array()) {
                for (idx, ev) in events.iter().enumerate() {
                    let ev_id = ev
                        .get("id")
                        .and_then(|v| v.as_str().map(|s| s.to_string()).or_else(|| v.as_i64().map(|n| n.to_string())))
                        .unwrap_or_else(|| format!("idx-{}", idx + 1));
                    let ev_title = ev.get("title").and_then(|v| v.as_str()).unwrap_or("Event");
                    let ev_desc = ev.get("description").and_then(|v| v.as_str()).unwrap_or("");
                    let ev_fmt = rich_html_to_markdown(ev_desc);
                    docs.push(make_doc(
                        format!("timeline:{id}/event:{ev_id}"),
                        "Timeline Event",
                        id,
                        Some(id),
                        None,
                        ev_title.to_string(),
                        title.to_string(),
                        format!("/timegraphs/{id}"),
                        ev_fmt.markdown,
                        ev_fmt.verse_citations,
                        upd.clone(),
                    ));
                }
            }
        }

        // 8. Spreadsheets
        for ss in cache.get("Spreadsheet").map(|v| v.as_slice()).unwrap_or(&[]) {
            let id = ss.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
            let title = ss.get("title").and_then(|v| v.as_str()).unwrap_or("Spreadsheet");
            let mut text_parts = Vec::new();
            if let Some(sheets) = ss.get("workbook").and_then(|w| w.get("sheets")).and_then(|s| s.as_array()) {
                for sh in sheets {
                    let sh_name = sh.get("name").and_then(|v| v.as_str()).unwrap_or("Sheet");
                    if let Some(cells) = sh.get("cells").and_then(|c| c.as_object()) {
                        for (addr, cell) in cells {
                            let val = cell.get("v").map(json_scalar_to_string).unwrap_or_default();
                            let note = cell.get("note").and_then(|v| v.as_str()).unwrap_or("");
                            if !val.trim().is_empty() || !note.trim().is_empty() {
                                text_parts.push(format!("{sh_name}!{addr}: {val} {note}").trim().to_string());
                            }
                        }
                    }
                }
            }
            let body = text_parts.join("\n");
            let cits = extract_bible_citations(&body);
            docs.push(make_doc(
                format!("spreadsheet:{id}"),
                "Spreadsheet",
                id,
                None,
                None,
                title.to_string(),
                title.to_string(),
                format!("/spreadsheets/{id}"),
                body,
                cits,
                str_field(ss, "updated_date"),
            ));
        }

        // 9. Study Canvas Objects
        for obj in cache.get("StudyCanvasObject").map(|v| v.as_slice()).unwrap_or(&[]) {
            let id = obj.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
            let title = obj
                .get("title")
                .or_else(|| obj.get("object_type"))
                .and_then(|v| v.as_str())
                .unwrap_or("Study Canvas Item");
            let content = obj.get("content").and_then(|v| v.as_str()).unwrap_or("");
            let fmt = rich_html_to_markdown(content);
            if fmt.markdown.is_empty() && title == "Study Canvas Item" {
                continue;
            }
            docs.push(make_doc(
                format!("study-object:{id}"),
                "Study Canvas Item",
                id,
                None,
                None,
                title.to_string(),
                "Bible Study Canvas".to_string(),
                "/Study".to_string(),
                fmt.markdown,
                fmt.verse_citations,
                str_field(obj, "updated_date"),
            ));
        }

        // Compute IDF weights across corpus
        let doc_count = docs.len().max(1) as f32;
        let mut df: HashMap<String, usize> = HashMap::new();
        for d in &docs {
            for term in d.tf.keys() {
                *df.entry(term.clone()).or_insert(0) += 1;
            }
        }
        let idf: HashMap<String, f32> = df
            .into_iter()
            .map(|(t, c)| (t, ((doc_count + 1.0) / (c as f32 + 1.0)).ln() + 1.0))
            .collect();

        for d in &mut docs {
            let mut sum_sq = 0.0f32;
            for (t, tf_val) in &d.tf {
                let w = tf_val * idf.get(t).copied().unwrap_or(1.0);
                sum_sq += w * w;
            }
            d.norm = sum_sq.sqrt().max(1e-6);
        }

        let by_source_id: HashMap<String, usize> = docs
            .iter()
            .enumerate()
            .map(|(i, d)| (d.source_id.clone(), i))
            .collect();

        Self {
            docs,
            idf,
            by_source_id,
        }
    }

    pub fn get_doc(&self, source_id: &str) -> Option<&IndexedDoc> {
        self.by_source_id.get(source_id).map(|&idx| &self.docs[idx])
    }

    pub fn search(
        &self,
        vault: &VaultEngine,
        query: &str,
        types_filter: Option<&[String]>,
        mode: &str,
        limit: usize,
    ) -> Vec<HybridSearchHit> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return Vec::new();
        }
        let lower_q = trimmed.to_lowercase();
        let raw_tokens = tokenize_index_terms(trimmed);
        let parsed_ref = parse_bible_reference(trimmed);

        let expanded = if mode == "exact" {
            raw_tokens
                .iter()
                .map(|t| (t.clone(), 1.0f32))
                .collect::<HashMap<_, _>>()
        } else {
            expand_theological_concepts(&raw_tokens)
        };

        // Compute query vector norm
        let mut q_norm_sq = 0.0f32;
        for (t, qw) in &expanded {
            let w = qw * self.idf.get(t).copied().unwrap_or(1.5);
            q_norm_sq += w * w;
        }
        let q_norm = q_norm_sq.sqrt().max(1e-6);

        // Gather FTS5 exact/prefix matches to boost precision
        let mut fts_boost: HashMap<String, f32> = HashMap::new();
        if mode != "conceptual" {
            if let Ok(hits) = vault.search_global(trimmed, limit.max(40)) {
                for h in hits {
                    let rec_id = h.id.as_i64().unwrap_or(0);
                    let key = match h.hit_type.as_str() {
                        "Note" => match h.match_page {
                            Some(p) if p > 0 => format!("note:{rec_id}/page:{}", p + 1),
                            _ => format!("note:{rec_id}"),
                        },
                        "Annotation" => format!("commentary:{rec_id}"),
                        "Chapter" => format!("study:{rec_id}"),
                        "Knowledge Web" => format!("web:{rec_id}"),
                        "Web Card" => {
                            // Find matching web card source_id
                            self.docs
                                .iter()
                                .find(|d| d.entity_type == "Web Card" && d.record_id == rec_id)
                                .map(|d| d.source_id.clone())
                                .unwrap_or_else(|| format!("card:{rec_id}"))
                        }
                        "Keyword" => format!("keyword:{rec_id}"),
                        "Timeline" => format!("timeline:{rec_id}"),
                        "Spreadsheet" | "Spreadsheet Cell" => format!("spreadsheet:{rec_id}"),
                        _ => format!("{}:{rec_id}", h.hit_type.to_lowercase()),
                    };
                    let b = (h.score as f32) / 100.0;
                    let slot = fts_boost.entry(key).or_insert(0.0);
                    if b > *slot {
                        *slot = b;
                    }
                }
            }
        }

        let norm_type_filters: Option<Vec<String>> = types_filter.map(|tf| {
            tf.iter()
                .map(|s| s.trim().to_ascii_lowercase())
                .collect()
        });

        let mut scored: Vec<HybridSearchHit> = Vec::new();
        for doc in &self.docs {
            if let Some(ref tf_list) = norm_type_filters {
                let dt = doc.entity_type.to_ascii_lowercase();
                if !tf_list.iter().any(|f| dt.contains(f.as_str()) || f.contains(dt.as_str())) {
                    continue;
                }
            }

            let mut score = 0.0f32;
            let mut reasons = Vec::new();

            // 1. Exact phrase / title match
            let title_low = doc.title.to_lowercase();
            let body_low = doc.body_plain.to_lowercase();
            if title_low == lower_q {
                score += 10.0;
                reasons.push("exact_title".to_string());
            } else if title_low.contains(&lower_q) {
                score += 6.0;
                reasons.push("title_match".to_string());
            } else if body_low.contains(&lower_q) {
                score += 3.5;
                reasons.push("exact_phrase".to_string());
            }

            // 2. FTS5 boost
            if let Some(&fb) = fts_boost.get(&doc.source_id) {
                score += fb * 1.4;
                if !reasons.iter().any(|r| r.contains("exact") || r.contains("title")) {
                    reasons.push("fts5".to_string());
                }
            }

            // 3. Conceptual TF-IDF cosine similarity (with theological thesaurus expansion)
            let mut dot = 0.0f32;
            let mut matched_exact_terms = 0usize;
            let mut matched_concept_terms = 0usize;
            for (term, &qw) in &expanded {
                if let Some(&tf_val) = doc.tf.get(term) {
                    let idf_w = self.idf.get(term).copied().unwrap_or(1.5);
                    dot += (qw * idf_w) * (tf_val * idf_w);
                    if qw >= 0.99 {
                        matched_exact_terms += 1;
                    } else {
                        matched_concept_terms += 1;
                    }
                }
            }
            let cosine = dot / (q_norm * doc.norm);
            if cosine > 0.02 {
                score += cosine * 8.0;
                if matched_exact_terms > 0 && !reasons.contains(&"exact_terms".to_string()) {
                    reasons.push("exact_terms".to_string());
                }
                if matched_concept_terms > 0 {
                    reasons.push("conceptual".to_string());
                }
            }

            // 4. Direct Bible reference / citation match
            if let Some(ref qref) = parsed_ref {
                let cit_match = doc.citations.iter().any(|c| bible_ref_overlaps(qref, c));
                if cit_match {
                    score += 7.5;
                    reasons.push("bible_citation".to_string());
                }
            }

            if score < 0.25 {
                continue;
            }

            let snippet = build_snippet(&doc.body_plain, &lower_q, &raw_tokens, 260);
            scored.push(HybridSearchHit {
                source_id: doc.source_id.clone(),
                entity_type: doc.entity_type.clone(),
                record_id: doc.record_id,
                parent_id: doc.parent_id,
                page: doc.page,
                title: doc.title.clone(),
                workspace_title: doc.workspace_title.clone(),
                href: doc.href.clone(),
                snippet,
                score: (score * 100.0).round() / 100.0,
                match_reasons: reasons,
                citations: doc.citations.iter().map(|c| c.display_ref()).collect(),
                updated_date: doc.updated_date.clone(),
            });
        }

        scored.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| b.updated_date.cmp(&a.updated_date))
        });
        scored.truncate(limit);
        scored
    }
}

fn make_doc(
    source_id: String,
    entity_type: &str,
    record_id: i64,
    parent_id: Option<i64>,
    page: Option<usize>,
    title: String,
    workspace_title: String,
    href: String,
    body_plain: String,
    citations: Vec<BibleRef>,
    updated_date: String,
) -> IndexedDoc {
    let mut tf: HashMap<String, f32> = HashMap::new();
    for t in tokenize_index_terms(&title) {
        *tf.entry(t).or_insert(0.0) += 2.5;
    }
    for t in tokenize_index_terms(&body_plain) {
        *tf.entry(t).or_insert(0.0) += 1.0;
    }
    // Log-dampen raw TF
    for val in tf.values_mut() {
        *val = 1.0 + val.ln();
    }
    IndexedDoc {
        source_id,
        entity_type: entity_type.to_string(),
        record_id,
        parent_id,
        page,
        title,
        workspace_title,
        href,
        body_plain,
        tf,
        norm: 1.0,
        citations,
        updated_date,
    }
}

pub fn bible_ref_overlaps(query: &BibleRef, target: &BibleRef) -> bool {
    if !query.book.eq_ignore_ascii_case(&target.book) {
        return false;
    }
    match (query.chapter, target.chapter) {
        (None, _) => true,
        (Some(qc), Some(tc)) if qc == tc => match (query.start_verse, target.start_verse) {
            (None, _) => true,
            (Some(qsv), Some(tsv)) => {
                let qev = query.end_verse.unwrap_or(qsv);
                let tev = target.end_verse.unwrap_or(tsv);
                qsv <= tev && tsv <= qev
            }
            (Some(_), None) => true,
        },
        _ => false,
    }
}

pub fn format_passage_label(book: &str, chapter: i64, start_verse: Option<i64>, end_verse: Option<i64>) -> String {
    match (start_verse, end_verse) {
        (Some(sv), Some(ev)) if sv > 0 && ev > sv => format!("{book} {chapter}:{sv}-{ev}"),
        (Some(sv), _) if sv > 0 => format!("{book} {chapter}:{sv}"),
        _ if chapter > 0 => format!("{book} {chapter}"),
        _ => book.to_string(),
    }
}

fn build_snippet(text: &str, phrase_lower: &str, terms: &[String], max_chars: usize) -> String {
    let compact = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.is_empty() {
        return String::new();
    }
    let chars: Vec<char> = compact.chars().collect();
    let lower = compact.to_lowercase();
    let byte_idx = lower
        .find(phrase_lower)
        .or_else(|| terms.iter().find_map(|t| lower.find(t.as_str())));

    let char_idx = match byte_idx {
        Some(bi) => lower[..bi].chars().count(),
        None => {
            let mut s: String = chars.iter().take(max_chars).collect();
            if chars.len() > max_chars {
                s.push('…');
            }
            return s;
        }
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

// ── Multi-Layer Vault Relationship Graph ───────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
    pub kind: String,
    pub directed: bool,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub label: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct GraphNodeMeta {
    pub source_id: String,
    pub entity_type: String,
    pub title: String,
}

pub struct VaultGraph {
    pub nodes: HashMap<String, GraphNodeMeta>,
    pub edges: Vec<GraphEdge>,
    adj: HashMap<String, Vec<usize>>,
}

impl VaultGraph {
    pub fn build(cache: &HashMap<&'static str, Vec<Value>>, index: &ConceptualIndex) -> Self {
        let mut nodes: HashMap<String, GraphNodeMeta> = HashMap::new();
        let mut edges: Vec<GraphEdge> = Vec::new();
        let mut seen_edges: HashSet<(String, String, String, String)> = HashSet::new();

        for d in &index.docs {
            nodes.insert(
                d.source_id.clone(),
                GraphNodeMeta {
                    source_id: d.source_id.clone(),
                    entity_type: d.entity_type.clone(),
                    title: d.title.clone(),
                },
            );
        }

        let mut add_edge = |src: String, dst: String, kind: &str, directed: bool, label: String| {
            if src == dst || src.is_empty() || dst.is_empty() {
                return;
            }
            let key = (src.clone(), dst.clone(), kind.to_string(), label.clone());
            if seen_edges.insert(key) {
                edges.push(GraphEdge {
                    source: src,
                    target: dst,
                    kind: kind.to_string(),
                    directed,
                    label,
                });
            }
        };

        // 1. MindLink
        for link in cache.get("MindLink").map(|v| v.as_slice()).unwrap_or(&[]) {
            let ft = normalize_mindlink_type(link.get("from_type").and_then(|v| v.as_str()).unwrap_or(""));
            let tt = normalize_mindlink_type(link.get("to_type").and_then(|v| v.as_str()).unwrap_or(""));
            let fid = json_id_str(link.get("from_id"));
            let tid = json_id_str(link.get("to_id"));
            if !ft.is_empty() && !tt.is_empty() && !fid.is_empty() && !tid.is_empty() {
                let lbl = link.get("label").and_then(|v| v.as_str()).unwrap_or("").to_string();
                add_edge(format!("{ft}:{fid}"), format!("{tt}:{tid}"), "mind_link", false, lbl);
            }
        }

        // 2. WebConnection (non-private webs only)
        let private_web_ids: HashSet<i64> = cache
            .get("KnowledgeWeb")
            .map(|v| v.as_slice())
            .unwrap_or(&[])
            .iter()
            .filter(|w| is_private_web(w))
            .filter_map(|w| w.get("id").and_then(|x| x.as_i64()))
            .collect();

        for conn in cache.get("WebConnection").map(|v| v.as_slice()).unwrap_or(&[]) {
            let wid = conn.get("web_id").and_then(|v| v.as_i64()).unwrap_or(0);
            if private_web_ids.contains(&wid) {
                continue;
            }
            let from_kind = conn.get("from_kind").and_then(|v| v.as_str()).unwrap_or("card");
            let to_kind = conn.get("to_kind").and_then(|v| v.as_str()).unwrap_or("card");
            let fid = json_id_str(conn.get("from_card_id"));
            let tid = json_id_str(conn.get("to_card_id"));
            if fid.is_empty() || tid.is_empty() {
                continue;
            }
            let f_seg = if from_kind == "object" { "object" } else { "card" };
            let t_seg = if to_kind == "object" { "object" } else { "card" };
            let directed = conn.get("has_arrow").and_then(|v| v.as_bool()).unwrap_or(true);
            let lbl = conn.get("label").and_then(|v| v.as_str()).unwrap_or("").to_string();
            add_edge(
                format!("web:{wid}/{f_seg}:{fid}"),
                format!("web:{wid}/{t_seg}:{tid}"),
                "web_connection",
                directed,
                lbl,
            );
        }

        // 3. StudyConnection (verse <-> commentary <-> study-object)
        for sc in cache.get("StudyConnection").map(|v| v.as_slice()).unwrap_or(&[]) {
            let from_ep = study_endpoint_id(sc.get("from"), &mut nodes);
            let to_ep = study_endpoint_id(sc.get("to"), &mut nodes);
            if let (Some(f), Some(t)) = (from_ep, to_ep) {
                let lbl = sc.get("label").and_then(|v| v.as_str()).unwrap_or("").to_string();
                add_edge(f, t, "study_connection", false, lbl);
            }
        }

        // 4. CanvasObject embedded timelines / linked webs
        for obj in cache.get("CanvasObject").map(|v| v.as_slice()).unwrap_or(&[]) {
            let wid = obj.get("web_id").and_then(|v| v.as_i64()).unwrap_or(0);
            if private_web_ids.contains(&wid) {
                continue;
            }
            let oid = obj.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
            let src = format!("web:{wid}/object:{oid}");
            if let Some(tg_id) = obj.get("timegraph_id").and_then(|v| v.as_i64()) {
                add_edge(src.clone(), format!("timeline:{tg_id}"), "embedded_timeline", true, String::new());
            }
            if let Some(lw_id) = obj.get("link_web_id").and_then(|v| v.as_i64()) {
                add_edge(src, format!("web:{lw_id}"), "linked_web", true, String::new());
            }
        }

        // 5. Inline TipTap HTML links in Notes, Cards, Commentaries, Keywords
        for note in cache.get("MindNote").map(|v| v.as_slice()).unwrap_or(&[]) {
            let id = note.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
            let content = note.get("content").and_then(|v| v.as_str()).unwrap_or("");
            let fmt = rich_html_to_markdown(content);
            for l in fmt.links {
                add_edge(format!("note:{id}"), l.target, &l.kind, true, l.label);
            }
        }
        for card in cache.get("WebCard").map(|v| v.as_slice()).unwrap_or(&[]) {
            let wid = card.get("web_id").and_then(|v| v.as_i64()).unwrap_or(0);
            if private_web_ids.contains(&wid) {
                continue;
            }
            let cid = card.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
            let desc = card.get("description").and_then(|v| v.as_str()).unwrap_or("");
            let fmt = rich_html_to_markdown(desc);
            for l in fmt.links {
                add_edge(format!("web:{wid}/card:{cid}"), l.target, &l.kind, true, l.label);
            }
        }
        for ann in cache.get("Annotation").map(|v| v.as_slice()).unwrap_or(&[]) {
            let id = ann.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
            let content = ann.get("content").and_then(|v| v.as_str()).unwrap_or("");
            let fmt = rich_html_to_markdown(content);
            for l in fmt.links {
                add_edge(format!("commentary:{id}"), l.target, &l.kind, true, l.label);
            }
        }

        // 6. Timeline event links
        let card_web: HashMap<String, i64> = cache
            .get("WebCard")
            .map(|v| v.as_slice())
            .unwrap_or(&[])
            .iter()
            .filter_map(|c| {
                let cid = json_id_str(c.get("id"));
                let wid = c.get("web_id").and_then(|v| v.as_i64())?;
                Some((cid, wid))
            })
            .collect();
        for tg in cache.get("Timegraph").map(|v| v.as_slice()).unwrap_or(&[]) {
            let tid = tg.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
            if let Some(events) = tg.get("events").and_then(|v| v.as_array()) {
                for ev in events {
                    if let Some(links) = ev.get("links").and_then(|v| v.as_array()) {
                        for lk in links {
                            let kind = lk.get("kind").and_then(|v| v.as_str()).unwrap_or("");
                            let lid = json_id_str(lk.get("id"));
                            let lbl = lk.get("label").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            let target = match kind {
                                "note" => Some(format!("note:{lid}")),
                                "keyword" => Some(format!("keyword:{lid}")),
                                "study-chapter" => Some(format!("study:{lid}")),
                                "web-card" => card_web.get(&lid).map(|wid| format!("web:{wid}/card:{lid}")),
                                _ => None,
                            };
                            if let Some(t) = target {
                                add_edge(format!("timeline:{tid}"), t, "timeline_link", true, lbl);
                            }
                        }
                    }
                }
            }
        }

        // 7. Spreadsheet cell internal links
        for ss in cache.get("Spreadsheet").map(|v| v.as_slice()).unwrap_or(&[]) {
            let sid = ss.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
            if let Some(sheets) = ss.get("workbook").and_then(|w| w.get("sheets")).and_then(|s| s.as_array()) {
                for sh in sheets {
                    if let Some(cells) = sh.get("cells").and_then(|c| c.as_object()) {
                        for (addr, cell) in cells {
                            if let Some(link) = cell.get("link").and_then(|v| v.as_str()) {
                                if let Some(target) = resolve_bex_internal_href(link) {
                                    add_edge(format!("spreadsheet:{sid}"), target, "spreadsheet_link", true, addr.clone());
                                }
                            }
                        }
                    }
                }
            }
        }

        // 8. Shared Bible verse citation nodes
        for d in &index.docs {
            for cit in &d.citations {
                if cit.chapter.is_some() && cit.start_verse.is_some() {
                    let vlabel = cit.display_ref();
                    let vid = format!("verse:{vlabel}");
                    nodes.entry(vid.clone()).or_insert_with(|| GraphNodeMeta {
                        source_id: vid.clone(),
                        entity_type: "Verse".to_string(),
                        title: vlabel,
                    });
                    add_edge(d.source_id.clone(), vid, "cites_verse", true, String::new());
                }
            }
        }

        let mut adj: HashMap<String, Vec<usize>> = HashMap::new();
        for (idx, e) in edges.iter().enumerate() {
            adj.entry(e.source.clone()).or_default().push(idx);
            adj.entry(e.target.clone()).or_default().push(idx);
        }

        Self { nodes, edges, adj }
    }

    pub fn traverse(&self, root_id: &str, max_depth: usize) -> Value {
        let depth_cap = max_depth.clamp(1, 3);
        let mut visited: HashSet<String> = HashSet::new();
        let mut queue: VecDeque<(String, usize)> = VecDeque::new();
        let mut collected_edge_idxs: HashSet<usize> = HashSet::new();

        // Also seed page-level children when root is `note:<id>`
        visited.insert(root_id.to_string());
        queue.push_back((root_id.to_string(), 0));
        if root_id.starts_with("note:") && !root_id.contains("/page:") {
            let prefix = format!("{root_id}/page:");
            for k in self.nodes.keys() {
                if k.starts_with(&prefix) && visited.insert(k.clone()) {
                    queue.push_back((k.clone(), 0));
                }
            }
        }

        while let Some((curr, d)) = queue.pop_front() {
            if d >= depth_cap {
                continue;
            }
            if let Some(edge_idxs) = self.adj.get(&curr) {
                for &ei in edge_idxs {
                    collected_edge_idxs.insert(ei);
                    let e = &self.edges[ei];
                    let neighbor = if e.source == curr { &e.target } else { &e.source };
                    if visited.insert(neighbor.clone()) {
                        queue.push_back((neighbor.clone(), d + 1));
                    }
                }
            }
        }

        let mut out_nodes: Vec<Value> = visited
            .iter()
            .map(|id| match self.nodes.get(id) {
                Some(meta) => json!(meta),
                None => json!({ "source_id": id, "entity_type": "Reference", "title": id }),
            })
            .collect();
        out_nodes.sort_by(|a, b| a["source_id"].as_str().cmp(&b["source_id"].as_str()));

        let mut out_edges: Vec<&GraphEdge> = collected_edge_idxs
            .iter()
            .map(|&i| &self.edges[i])
            .collect();
        out_edges.sort_by(|a, b| a.source.cmp(&b.source).then_with(|| a.target.cmp(&b.target)));

        json!({
            "root": root_id,
            "depth": depth_cap,
            "node_count": out_nodes.len(),
            "edge_count": out_edges.len(),
            "nodes": out_nodes,
            "edges": out_edges,
        })
    }
}

fn study_endpoint_id(ep: Option<&Value>, nodes: &mut HashMap<String, GraphNodeMeta>) -> Option<String> {
    let ep = ep?;
    let kind = ep.get("kind").and_then(|v| v.as_str())?;
    if kind == "verse" {
        let raw_book = ep.get("book").and_then(|v| v.as_str())?;
        let book = canonical_book_name(raw_book).unwrap_or(raw_book);
        let ch = ep.get("chapter").and_then(|v| v.as_i64())?;
        let v = ep.get("verse").and_then(|v| v.as_i64())?;
        let label = format!("{book} {ch}:{v}");
        let id = format!("verse:{label}");
        nodes.entry(id.clone()).or_insert_with(|| GraphNodeMeta {
            source_id: id.clone(),
            entity_type: "Verse".to_string(),
            title: label,
        });
        return Some(id);
    }
    let id_str = json_id_str(ep.get("id"));
    if id_str.is_empty() {
        return None;
    }
    match kind {
        "annotation" | "commentary" => Some(format!("commentary:{id_str}")),
        _ => Some(format!("study-object:{id_str}")),
    }
}

fn normalize_mindlink_type(raw: &str) -> &'static str {
    match raw.to_ascii_lowercase().as_str() {
        "note" | "mindnote" => "note",
        "web" | "knowledgeweb" => "web",
        "timeline" | "timegraph" => "timeline",
        "spreadsheet" => "spreadsheet",
        "keyword" => "keyword",
        "commentary" | "annotation" => "commentary",
        "study" | "studychapter" => "study",
        _ => "",
    }
}

pub fn is_private_web(web: &Value) -> bool {
    match web.get("is_private") {
        Some(Value::Bool(true)) => true,
        Some(Value::Number(n)) => n.as_i64() == Some(1),
        Some(Value::String(s)) => s == "1" || s.eq_ignore_ascii_case("true"),
        _ => false,
    }
}

pub fn str_field(v: &Value, key: &str) -> String {
    v.get(key)
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string()
}

pub fn json_id_str(v: Option<&Value>) -> String {
    match v {
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::String(s)) => s.clone(),
        _ => String::new(),
    }
}

pub fn json_scalar_to_string(v: &Value) -> String {
    match v {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        other => other.to_string(),
    }
}

// ── Unit Tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_bible_references_and_abbreviations() {
        let r1 = parse_bible_reference("Matt 4:9").unwrap();
        assert_eq!(r1.book, "Matthew");
        assert_eq!(r1.chapter, Some(4));
        assert_eq!(r1.start_verse, Some(9));
        assert_eq!(r1.end_verse, Some(9));

        let r2 = parse_bible_reference("1 Cor 15:3–8").unwrap();
        assert_eq!(r2.book, "1 Corinthians");
        assert_eq!(r2.chapter, Some(15));
        assert_eq!(r2.start_verse, Some(3));
        assert_eq!(r2.end_verse, Some(8));

        let r3 = parse_bible_reference("Ps 23").unwrap();
        assert_eq!(r3.book, "Psalms");
        assert_eq!(r3.chapter, Some(23));
        assert_eq!(r3.start_verse, None);

        let cits = extract_bible_citations("Compare Matt 4:9 with Luke 4:5-7 and Deut 6:13.");
        assert_eq!(cits.len(), 3);
        assert_eq!(cits[0].display_ref(), "Matthew 4:9");
        assert_eq!(cits[1].display_ref(), "Luke 4:5-7");
        assert_eq!(cits[2].display_ref(), "Deuteronomy 6:13");
    }

    #[test]
    fn converts_tiptap_html_losslessly_with_metadata() {
        let html = r#"<h2>Temptation Analysis</h2><p>Satan claims <span data-footnote-id="f1" data-footnote-text="<p>See Luke 4:6 on delegated authority.</p>">authority</span> over the <span data-keyword-id="7">kingdoms</span> in <a href="/Study?q=Matthew%204%3A9&amp;annotation_id=42">Matthew 4:9</a>.</p>"#;
        let fmt = rich_html_to_markdown(html);
        assert!(fmt.markdown.contains("## Temptation Analysis"));
        assert!(fmt.markdown.contains("footnote:f1"));
        assert!(fmt.markdown.contains("See Luke 4:6 on delegated authority."));
        assert!(fmt.markdown.contains("keyword:7"));
        assert!(fmt.links.iter().any(|l| l.target == "keyword:7"));
        assert!(fmt.links.iter().any(|l| l.target == "commentary:42"));
        assert!(fmt.verse_citations.iter().any(|c| c.display_ref() == "Matthew 4:9"));
        assert!(fmt.verse_citations.iter().any(|c| c.display_ref() == "Luke 4:6"));
    }

    #[test]
    fn splits_bex_book_pages_and_decodes_titles() {
        let raw = "<!--bex-page-title:Intro%20%26%20Scope--><p>Page one</p><!--bex-page-break--><!--bex-page-title:Matthew%204%3A9--><p>Page two</p>";
        let pages = split_book_pages_detailed(raw, "Fallback");
        assert_eq!(pages.len(), 2);
        assert_eq!(pages[0].1, "Intro & Scope");
        assert_eq!(pages[0].2, "<p>Page one</p>");
        assert_eq!(pages[1].1, "Matthew 4:9");
        assert_eq!(pages[1].2, "<p>Page two</p>");
    }

    #[test]
    fn markdown_to_html_preserves_structure() {
        let html = markdown_to_html("# Heading\n\nThis is **bold** and *italic*.\n\n- Item 1\n- Item 2\n\n> Quote");
        assert!(html.contains("<h1>Heading</h1>"));
        assert!(html.contains("<strong>bold</strong>"));
        assert!(html.contains("<em>italic</em>"));
        assert!(html.contains("<ul><li><p>Item 1</p></li><li><p>Item 2</p></li></ul>"));
        assert!(html.contains("<blockquote><p>Quote</p></blockquote>"));
    }

    #[test]
    fn conceptual_search_bridges_theological_synonyms() {
        let mut cache: HashMap<&'static str, Vec<Value>> = HashMap::new();
        cache.insert(
            "MindNote",
            vec![json!({
                "id": 1,
                "title": "Jurisdiction of the Tempter",
                "content": "<p>In Matthew 4:9 the adversary offers earthly dominion and kingdoms in exchange for proskuneo.</p>",
                "updated_date": "2026-11-26T00:00:00Z"
            })],
        );
        let idx = ConceptualIndex::build(&cache);
        let vault = VaultEngine::new();
        // Query uses "sovereignty" and "worship" — neither word appears literally in the note!
        let hits = idx.search(&vault, "sovereignty worship", None, "conceptual", 10);
        assert!(!hits.is_empty(), "Conceptual search should bridge sovereignty->dominion/jurisdiction and worship->proskuneo");
        assert_eq!(hits[0].source_id, "note:1");
        assert!(hits[0].match_reasons.contains(&"conceptual".to_string()));
    }
}
