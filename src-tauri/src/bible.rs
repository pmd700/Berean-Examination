//! Rust Offline Bible & MAM Hebrew Engine (`local-bible.cjs` + `local-mam.cjs` 100% Parity).
//!
//! Lazily caches parsed translation maps in memory for sub-millisecond chapter reads across all
//! 20 local Bible versions (19 JSON + LSV) plus the 39-book MAM Hebrew corpus.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

const LSV_FILE: &str = "lsv_1775867344760.txt";
const LSV_SPECIAL_SECTIONS: &[&str] = &["Copyright", "Preface", "Introduction"];
const IMPORTED_VERSIONS: &[&str] = &[
    "AKJV", "ASV", "BAB", "BGB", "BIB", "BLB", "BRB", "BSB", "CPDV", "DBT",
    "DRB", "ERV", "JPS", "KJV", "MSB", "SLT", "WBT", "WEB", "YLT",
];

pub struct BibleLibrary {
    pub search_roots: Vec<PathBuf>,
    bible_cache: HashMap<String, HashMap<String, String>>,
    mam_cache: HashMap<String, HashMap<String, HashMap<String, String>>>,
}

impl BibleLibrary {
    pub fn new(resource_dir: Option<PathBuf>) -> Self {
        let mut roots = Vec::new();
        if let Some(rd) = resource_dir {
            roots.push(rd.clone());
            roots.push(rd.join("attached_assets"));
            roots.push(rd.join("_up_").join("attached_assets"));
        }
        // Development / local repo roots
        if let Ok(cwd) = std::env::current_dir() {
            roots.push(cwd.join("attached_assets"));
            if let Some(p) = cwd.parent() {
                roots.push(p.join("attached_assets"));
                roots.push(p.to_path_buf());
            }
            roots.push(cwd);
        }
        // Explicit Google Drive BEX fallback
        if let Ok(home) = std::env::var("HOME") {
            let cloud = PathBuf::from(&home).join("Library/CloudStorage");
            if let Ok(entries) = fs::read_dir(&cloud) {
                for e in entries.flatten() {
                    let bex = e.path().join("My Drive").join("BEX");
                    if bex.is_dir() {
                        roots.push(bex.join("attached_assets"));
                        roots.push(bex);
                    }
                }
            }
        }
        Self {
            search_roots: roots,
            bible_cache: HashMap::new(),
            mam_cache: HashMap::new(),
        }
    }

    fn find_file(&self, rel_candidates: &[&str]) -> Option<PathBuf> {
        for root in &self.search_roots {
            for rel in rel_candidates {
                let p = root.join(rel);
                if p.is_file() {
                    return Some(p);
                }
            }
        }
        None
    }

    pub fn read_bible_chapter(&mut self, version: &str, book: &str, chapter: i64) -> Result<Value, (&'static str, String)> {
        let ver = version.trim().to_uppercase();
        let book = book.trim();
        let is_lsv = ver == "LSV";
        if (!is_lsv && !IMPORTED_VERSIONS.contains(&ver.as_str())) || book.is_empty() {
            return Err(("BEX_BIBLE_INVALID", "Choose a valid local Bible translation and book.".into()));
        }

        if !self.bible_cache.contains_key(&ver) {
            let map = if is_lsv {
                let path = self
                    .find_file(&[LSV_FILE, &format!("attached_assets/{LSV_FILE}")])
                    .ok_or(("BEX_BIBLE_NOT_FOUND", "Local LSV file was not found.".into()))?;
                let raw = fs::read_to_string(&path)
                    .map_err(|e| ("BEX_BIBLE_NOT_FOUND", e.to_string()))?;
                build_lsv_index(&raw)
            } else {
                let f1 = format!("bibles/{ver}.json");
                let f2 = format!("attached_assets/bibles/{ver}.json");
                let f3 = format!("{ver}.json");
                let path = self
                    .find_file(&[&f1, &f2, &f3])
                    .ok_or(("BEX_BIBLE_NOT_FOUND", format!("Local {ver}.json was not found.")))?;
                let raw = fs::read_to_string(&path)
                    .map_err(|e| ("BEX_BIBLE_NOT_FOUND", e.to_string()))?;
                let parsed: Value = serde_json::from_str(&raw)
                    .map_err(|_| ("BEX_BIBLE_INVALID", format!("{ver} has an invalid local Bible index.")))?;
                let mut m = HashMap::new();
                if let Some(ch_map) = parsed.get("chapters").and_then(|v| v.as_object()) {
                    for (k, v) in ch_map {
                        if let Some(s) = v.as_str() {
                            m.insert(k.clone(), s.to_string());
                        }
                    }
                }
                m
            };
            self.bible_cache.insert(ver.clone(), map);
        }

        let key = format!("{book}\0{chapter}");
        let text = self
            .bible_cache
            .get(&ver)
            .and_then(|m| m.get(&key))
            .cloned()
            .ok_or(("BEX_BIBLE_NOT_FOUND", format!("{ver} {book} {chapter} was not found locally.")))?;

        Ok(json!({
            "book": book,
            "chapter": chapter,
            "text": text,
            "version": ver,
        }))
    }

    pub fn read_mam_chapter(&mut self, book: &str, chapter: i64) -> Result<Value, (&'static str, String)> {
        let book = book.trim();
        let Some((file_name, book_index)) = mam_book_file(book) else {
            return Err(("BEX_MAM_INVALID", "Choose a valid local MAM chapter.".into()));
        };
        if !(1..=150).contains(&chapter) {
            return Err(("BEX_MAM_INVALID", "Choose a valid local MAM chapter.".into()));
        }

        if !self.mam_cache.contains_key(book) {
            let p1 = format!("data/sources/mam-parsed/plus/{file_name}");
            let p2 = format!("Implementation plans/sources/mam-parsed/plus/{file_name}");
            let p3 = format!("mam-parsed/plus/{file_name}");
            let path = self
                .find_file(&[&p1, &p2, &p3])
                .ok_or(("BEX_MAM_NOT_FOUND", format!("MAM {book} {chapter} was not found locally.")))?;
            let raw = fs::read_to_string(&path)
                .map_err(|e| ("BEX_MAM_NOT_FOUND", e.to_string()))?;
            let data: Value = serde_json::from_str(&raw)
                .map_err(|_| ("BEX_MAM_INVALID", "MAM JSON invalid.".into()))?;
            let mut chapters_out: HashMap<String, HashMap<String, String>> = HashMap::new();
            if let Some(ch_obj) = data
                .get("book39s")
                .and_then(|v| v.get(book_index))
                .and_then(|v| v.get("chapters"))
                .and_then(|v| v.as_object())
            {
                for (ch_key, verses_val) in ch_obj {
                    let mut vmap = HashMap::new();
                    if let Some(v_obj) = verses_val.as_object() {
                        for (v_key, v_node) in v_obj {
                            let txt = extract_mam_node(v_node)
                                .split_whitespace()
                                .collect::<Vec<_>>()
                                .join(" ");
                            if !txt.is_empty() {
                                vmap.insert(v_key.clone(), txt);
                            }
                        }
                    }
                    chapters_out.insert(ch_key.clone(), vmap);
                }
            }
            self.mam_cache.insert(book.to_string(), chapters_out);
        }

        let verses = self
            .mam_cache
            .get(book)
            .and_then(|c| c.get(&chapter.to_string()))
            .filter(|v| !v.is_empty())
            .ok_or(("BEX_MAM_NOT_FOUND", format!("MAM {book} {chapter} was not found locally.")))?;

        Ok(json!({
            "attribution": {
                "source": "Hebrew Wikisource",
                "license": "CC BY-SA 4.0",
                "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
            },
            "book": book,
            "chapter": chapter,
            "verses": verses,
        }))
    }
}

fn lsv_book_name(abbr: &str) -> Option<&'static str> {
    match abbr {
        "Gen" => Some("Genesis"), "Exo" => Some("Exodus"), "Lev" => Some("Leviticus"),
        "Num" => Some("Numbers"), "Deu" => Some("Deuteronomy"), "Jos" => Some("Joshua"),
        "Jdg" => Some("Judges"), "Rth" => Some("Ruth"), "1Sa" => Some("1 Samuel"),
        "2Sa" => Some("2 Samuel"), "1Ki" => Some("1 Kings"), "2Ki" => Some("2 Kings"),
        "1Ch" => Some("1 Chronicles"), "2Ch" => Some("2 Chronicles"), "Ezr" => Some("Ezra"),
        "Neh" => Some("Nehemiah"), "Est" => Some("Esther"), "Job" => Some("Job"),
        "Psa" => Some("Psalms"), "Pro" => Some("Proverbs"), "Ecc" => Some("Ecclesiastes"),
        "Sol" | "Son" => Some("Song of Solomon"), "Isa" => Some("Isaiah"), "Jer" => Some("Jeremiah"),
        "Lam" => Some("Lamentations"), "Eze" => Some("Ezekiel"), "Dan" => Some("Daniel"),
        "Hos" => Some("Hosea"), "Joe" => Some("Joel"), "Amo" => Some("Amos"),
        "Oba" => Some("Obadiah"), "Jon" => Some("Jonah"), "Mic" => Some("Micah"),
        "Nah" => Some("Nahum"), "Hab" => Some("Habakkuk"), "Zep" => Some("Zephaniah"),
        "Hag" => Some("Haggai"), "Zec" => Some("Zechariah"), "Mal" => Some("Malachi"),
        "Mat" => Some("Matthew"), "Mar" => Some("Mark"), "Luk" => Some("Luke"),
        "Joh" => Some("John"), "Act" => Some("Acts"), "Rom" => Some("Romans"),
        "1Co" => Some("1 Corinthians"), "2Co" => Some("2 Corinthians"), "Gal" => Some("Galatians"),
        "Eph" => Some("Ephesians"), "Php" => Some("Philippians"), "Col" => Some("Colossians"),
        "1Th" => Some("1 Thessalonians"), "2Th" => Some("2 Thessalonians"), "1Ti" => Some("1 Timothy"),
        "2Ti" => Some("2 Timothy"), "Tit" => Some("Titus"), "Phm" => Some("Philemon"),
        "Heb" => Some("Hebrews"), "Jas" => Some("James"), "1Pe" => Some("1 Peter"),
        "2Pe" => Some("2 Peter"), "1Jn" => Some("1 John"), "2Jn" => Some("2 John"),
        "3Jn" => Some("3 John"), "Jud" => Some("Jude"), "Rev" => Some("Revelation"),
        _ => None,
    }
}

fn build_lsv_index(raw: &str) -> HashMap<String, String> {
    let mut grouped: HashMap<String, Vec<String>> = HashMap::new();
    let lines: Vec<&str> = raw.lines().collect();
    for line in &lines {
        let mut parts = line.splitn(3, |c: char| c.is_whitespace());
        let Some(abbr) = parts.next() else { continue };
        let Some(cv) = parts.next() else { continue };
        let Some(text) = parts.next() else { continue };
        let Some(book) = lsv_book_name(abbr) else { continue };
        let Some((ch_s, v_s)) = cv.split_once(':') else { continue };
        let (Ok(ch), Ok(v)) = (ch_s.parse::<i64>(), v_s.parse::<i64>()) else { continue };
        let key = format!("{book}\0{ch}");
        grouped.entry(key).or_default().push(format!("~{v} {}", text.trim()));
    }
    let mut out: HashMap<String, String> = grouped
        .into_iter()
        .map(|(k, verses)| (k, verses.join("\n")))
        .collect();

    for &sec in LSV_SPECIAL_SECTIONS {
        let heading = match sec {
            "Copyright" => "COPYRIGHT INFORMATION",
            "Preface" => "PREFACE TO THE LSV",
            _ => "INTRODUCTION TO THE LSV",
        };
        if let Some(pos) = lines.iter().position(|l| l.trim() == heading) {
            let mut start = pos + 1;
            while start < lines.len() && (lines[start].trim().is_empty() || lines[start].trim().chars().all(|c| c == '-')) {
                start += 1;
            }
            let mut end = start;
            while end < lines.len() && !(lines[end].trim().len() >= 5 && lines[end].trim().chars().all(|c| c == '-')) {
                end += 1;
            }
            let block_text = lines[start..end].join("\n");
            let mut prepared = Vec::new();
            let mut pnum = 1;
            for blk in block_text.split("\n\n") {
                let cleaned = blk.split_whitespace().collect::<Vec<_>>().join(" ");
                if cleaned.is_empty() {
                    continue;
                }
                prepared.push(format!("~{pnum} {cleaned}"));
                pnum += 1;
            }
            out.insert(format!("{sec}\00"), prepared.join("\n"));
        }
    }
    out
}

fn mam_book_file(book: &str) -> Option<(&'static str, usize)> {
    match book {
        "Genesis" => Some(("A1-Genesis.json", 0)),
        "Exodus" => Some(("A2-Exodus.json", 0)),
        "Leviticus" => Some(("A3-Levit.json", 0)),
        "Numbers" => Some(("A4-Numbers.json", 0)),
        "Deuteronomy" => Some(("A5-Deuter.json", 0)),
        "Joshua" => Some(("B1-Joshua.json", 0)),
        "Judges" => Some(("B2-Judges.json", 0)),
        "1 Samuel" => Some(("BA-Samuel.json", 0)),
        "2 Samuel" => Some(("BA-Samuel.json", 1)),
        "1 Kings" => Some(("BC-Kings.json", 0)),
        "2 Kings" => Some(("BC-Kings.json", 1)),
        "Isaiah" => Some(("C1-Isaiah.json", 0)),
        "Jeremiah" => Some(("C2-Jeremiah.json", 0)),
        "Ezekiel" => Some(("C3-Ezekiel.json", 0)),
        "Hosea" => Some(("CA-The-12-Minor-Prophets.json", 0)),
        "Joel" => Some(("CA-The-12-Minor-Prophets.json", 1)),
        "Amos" => Some(("CA-The-12-Minor-Prophets.json", 2)),
        "Obadiah" => Some(("CA-The-12-Minor-Prophets.json", 3)),
        "Jonah" => Some(("CA-The-12-Minor-Prophets.json", 4)),
        "Micah" => Some(("CA-The-12-Minor-Prophets.json", 5)),
        "Nahum" => Some(("CA-The-12-Minor-Prophets.json", 6)),
        "Habakkuk" => Some(("CA-The-12-Minor-Prophets.json", 7)),
        "Zephaniah" => Some(("CA-The-12-Minor-Prophets.json", 8)),
        "Haggai" => Some(("CA-The-12-Minor-Prophets.json", 9)),
        "Zechariah" => Some(("CA-The-12-Minor-Prophets.json", 10)),
        "Malachi" => Some(("CA-The-12-Minor-Prophets.json", 11)),
        "Psalms" => Some(("D1-Psalms.json", 0)),
        "Proverbs" => Some(("D2-Proverbs.json", 0)),
        "Job" => Some(("D3-Job.json", 0)),
        "Song of Solomon" => Some(("E1-Song of Songs.json", 0)),
        "Ruth" => Some(("E2-Ruth.json", 0)),
        "Lamentations" => Some(("E3-Lamentations.json", 0)),
        "Ecclesiastes" => Some(("E4-Ecclesiastes.json", 0)),
        "Esther" => Some(("E5-Esther.json", 0)),
        "Daniel" => Some(("F1-Daniel.json", 0)),
        "Ezra" => Some(("FA-Ezra-Nexemiah.json", 0)),
        "Nehemiah" => Some(("FA-Ezra-Nexemiah.json", 1)),
        "1 Chronicles" => Some(("FC-Chronicles.json", 0)),
        "2 Chronicles" => Some(("FC-Chronicles.json", 1)),
        _ => None,
    }
}

fn extract_mam_node(node: &Value) -> String {
    match node {
        Value::String(s) => s.clone(),
        Value::Array(arr) => arr.iter().map(extract_mam_node).collect::<String>(),
        Value::Object(obj) => {
            let name = obj.get("tmpl_name").and_then(|v| v.as_str()).unwrap_or("");
            if matches!(name, "מ:ספר חדש" | "מ:פסוק" | "מ:פרק" | "מ:תת ספר חדש") {
                return String::new();
            }
            if name.starts_with("מ:לגרמיה") {
                return " ׀ ".to_string();
            }
            if name.starts_with("מ:רווח") {
                return " ".to_string();
            }
            let Some(params) = obj.get("tmpl_params").and_then(|v| v.as_object()) else {
                return String::new();
            };
            if name == "מ:דחי" || name == "נוסח" || name.starts_with("מ:אות") {
                if name == "מ:אות-מיוחדת-במילה" {
                    return params.get("2").map(extract_mam_node).unwrap_or_default();
                }
                return params.get("1").map(extract_mam_node).unwrap_or_default();
            }
            if let Some(Value::String(s2)) = params.get("2") {
                return s2.clone();
            }
            params.get("1").map(extract_mam_node).unwrap_or_default()
        }
        _ => String::new(),
    }
}
