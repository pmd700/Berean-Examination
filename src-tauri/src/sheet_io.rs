//! Native Rust Spreadsheet XLSX Fast-Path (`calamine` + `rust_xlsxwriter`).
//! Offloads heavy `.xlsx` zip/XML parsing & generation off the browser UI thread.

use calamine::{Data, Reader, Xlsx};
use rust_xlsxwriter::{Formula, Workbook};
use serde_json::{json, Map, Value};
use std::io::Cursor;

fn col_to_letters(mut col: usize) -> String {
    let mut s = String::new();
    let mut n = col + 1;
    while n > 0 {
        let rem = (n - 1) % 26;
        s.insert(0, (b'A' + rem as u8) as char);
        n = (n - 1) / 26;
    }
    let _ = &mut col;
    s
}

fn parse_a1(addr: &str) -> Option<(u32, u16)> {
    let mut col_str = String::new();
    let mut row_str = String::new();
    for ch in addr.chars() {
        if ch.is_ascii_alphabetic() {
            col_str.push(ch.to_ascii_uppercase());
        } else if ch.is_ascii_digit() {
            row_str.push(ch);
        }
    }
    if col_str.is_empty() || row_str.is_empty() {
        return None;
    }
    let mut col: u32 = 0;
    for b in col_str.bytes() {
        col = col * 26 + ((b - b'A') as u32 + 1);
    }
    let row: u32 = row_str.parse().ok()?;
    if row == 0 || col == 0 {
        return None;
    }
    Some((row - 1, (col - 1) as u16))
}

pub fn import_xlsx_bytes(bytes: &[u8], file_name: &str) -> Result<Value, String> {
    let cursor = Cursor::new(bytes);
    let mut workbook: Xlsx<_> = Xlsx::new(cursor).map_err(|e| format!("Invalid XLSX: {e}"))?;
    let sheet_names = workbook.sheet_names().to_vec();
    let mut sheets_out = Vec::new();

    for (idx, name) in sheet_names.iter().enumerate() {
        let mut cells = Map::new();
        let mut max_r = 40usize;
        let mut max_c = 16usize;

        let formulas = workbook.worksheet_formula(name).ok();
        if let Ok(range) = workbook.worksheet_range(name) {
            let (rows, cols) = range.get_size();
            max_r = max_r.max(rows + 20);
            max_c = max_c.max(cols + 4);
            let (start_r, start_c) = range.start().unwrap_or((0, 0));
            for (r_off, row) in range.rows().enumerate() {
                for (c_off, cell) in row.iter().enumerate() {
                    let abs_r = start_r as usize + r_off;
                    let abs_c = start_c as usize + c_off;
                    let formula_str = formulas
                        .as_ref()
                        .and_then(|fr| fr.get_value((abs_r as u32, abs_c as u32)))
                        .filter(|s| !s.is_empty());

                    let val_opt = match cell {
                        Data::Empty => None,
                        Data::String(s) => Some(Value::String(s.clone())),
                        Data::Float(f) => serde_json::Number::from_f64(*f).map(Value::Number),
                        Data::Int(i) => Some(json!(i)),
                        Data::Bool(b) => Some(Value::Bool(*b)),
                        Data::DateTime(dt) => serde_json::Number::from_f64(dt.as_f64()).map(Value::Number),
                        Data::Error(e) => Some(Value::String(format!("{e:?}"))),
                        _ => Some(Value::String(cell.to_string())),
                    };

                    if val_opt.is_some() || formula_str.is_some() {
                        let addr = format!("{}{}", col_to_letters(abs_c), abs_r + 1);
                        let mut cobj = Map::new();
                        if let Some(v) = val_opt {
                            cobj.insert("v".into(), v);
                        }
                        if let Some(f) = formula_str {
                            let with_eq = if f.starts_with('=') { f.clone() } else { format!("={f}") };
                            cobj.insert("f".into(), Value::String(with_eq));
                        }
                        cells.insert(addr, Value::Object(cobj));
                    }
                }
            }
        }

        sheets_out.push(json!({
            "id": format!("sheet-{}", idx + 1),
            "name": name,
            "rowCount": max_r.min(1048576),
            "columnCount": max_c.min(16384),
            "cells": cells,
        }));
    }

    let active_id = sheets_out
        .first()
        .and_then(|s| s.get("id").and_then(|v| v.as_str()))
        .unwrap_or("sheet-1");

    let title = file_name
        .trim_end_matches(".xlsx")
        .trim_end_matches(".XLSX")
        .to_string();

    Ok(json!({
        "title": if title.is_empty() { "Imported Workbook".to_string() } else { title },
        "workbook": {
            "activeSheetId": active_id,
            "sheets": sheets_out,
        }
    }))
}

pub fn export_xlsx_bytes(workbook_val: &Value) -> Result<Vec<u8>, String> {
    let mut wb = Workbook::new();
    let sheets = workbook_val
        .get("sheets")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "Workbook is missing sheets.".to_string())?;

    for (idx, sh) in sheets.iter().enumerate() {
        let ws = wb.add_worksheet();
        let name = sh
            .get("name")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.chars().take(31).collect::<String>())
            .unwrap_or_else(|| format!("Sheet{}", idx + 1));
        let _ = ws.set_name(&name);

        if let Some(cells) = sh.get("cells").and_then(|v| v.as_object()) {
            for (addr, cell) in cells {
                let Some((r, c)) = parse_a1(addr) else { continue };
                if let Some(f) = cell.get("f").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
                    let clean_f = f.strip_prefix('=').unwrap_or(f);
                    let _ = ws.write_formula(r, c, Formula::new(clean_f));
                } else if let Some(v) = cell.get("v") {
                    match v {
                        Value::Number(n) => {
                            if let Some(f) = n.as_f64() {
                                let _ = ws.write_number(r, c, f);
                            }
                        }
                        Value::Bool(b) => {
                            let _ = ws.write_boolean(r, c, *b);
                        }
                        Value::String(s) => {
                            let _ = ws.write_string(r, c, s);
                        }
                        _ => {}
                    }
                }
            }
        }
    }

    wb.save_to_buffer().map_err(|e| format!("XLSX export failed: {e}"))
}
