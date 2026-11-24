//! 1-Click Brain Transplant (`.bexbrain`) Packager & Restorer.
//!
//! Uses SQLite `VACUUM INTO` for a zero-corruption hot-backup of `berean.db`, bundles all
//! `Vault/Media` files, and stamps a `blake3` cryptographic manifest so a Vault can be sent
//! halfway across the world and restored in one click.

use rusqlite::Connection;
use serde_json::{json, Value};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

pub fn export_brain_transplant(
    library_path: &Path,
    conn: &Connection,
    output_path: &Path,
) -> Result<Value, String> {
    let tmp_db = std::env::temp_dir().join(format!("bex-transplant-{}.db", uuid::Uuid::new_v4()));
    let _ = fs::remove_file(&tmp_db);
    let escaped = tmp_db.to_string_lossy().replace('\'', "''");
    conn.execute_batch(&format!("VACUUM INTO '{escaped}';"))
        .map_err(|e| format!("SQLite hot-backup failed: {e}"))?;

    let db_bytes = fs::read(&tmp_db).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(&tmp_db);
    let db_hash = blake3::hash(&db_bytes).to_hex().to_string();

    let out_file = File::create(output_path).map_err(|e| e.to_string())?;
    let mut zip = ZipWriter::new(out_file);
    let opts_deflate = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let opts_stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);

    zip.start_file("Database/berean.db", opts_deflate).map_err(|e| e.to_string())?;
    zip.write_all(&db_bytes).map_err(|e| e.to_string())?;

    let mut media_manifest = Vec::new();
    let media_root = library_path.join("Media");
    if media_root.is_dir() {
        collect_media_into_zip(&media_root, &media_root, &mut zip, opts_stored, &mut media_manifest)?;
    }

    let manifest = json!({
        "format": "bex-brain-transplant-v1",
        "createdAt": chrono::Utc::now().to_rfc3339(),
        "databaseBlake3": db_hash,
        "databaseBytes": db_bytes.len(),
        "mediaCount": media_manifest.len(),
        "media": media_manifest,
    });
    zip.start_file("manifest.json", opts_deflate).map_err(|e| e.to_string())?;
    zip.write_all(serde_json::to_string_pretty(&manifest).unwrap_or_default().as_bytes())
        .map_err(|e| e.to_string())?;
    zip.finish().map_err(|e| e.to_string())?;

    Ok(json!({
        "ok": true,
        "path": output_path.to_string_lossy(),
        "databaseBytes": db_bytes.len(),
        "mediaCount": media_manifest.len(),
        "databaseBlake3": db_hash,
    }))
}

fn collect_media_into_zip(
    root: &Path,
    dir: &Path,
    zip: &mut ZipWriter<File>,
    opts: SimpleFileOptions,
    manifest: &mut Vec<Value>,
) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_dir() {
            collect_media_into_zip(root, &p, zip, opts, manifest)?;
        } else if p.is_file() {
            let rel = p.strip_prefix(root).unwrap_or(&p);
            let zip_path = format!("Media/{}", rel.to_string_lossy().replace('\\', "/"));
            let bytes = fs::read(&p).map_err(|e| e.to_string())?;
            let hash = blake3::hash(&bytes).to_hex().to_string();
            zip.start_file(&zip_path, opts).map_err(|e| e.to_string())?;
            zip.write_all(&bytes).map_err(|e| e.to_string())?;
            manifest.push(json!({ "path": zip_path, "bytes": bytes.len(), "blake3": hash }));
        }
    }
    Ok(())
}

pub fn import_brain_transplant(archive_path: &Path, target_vault_dir: &Path) -> Result<Value, String> {
    let file = File::open(archive_path).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("Invalid .bexbrain archive: {e}"))?;

    for folder in ["Database", "Courses", "Media", "Imports", "Exports"] {
        fs::create_dir_all(target_vault_dir.join(folder)).map_err(|e| e.to_string())?;
    }

    let mut extracted_files = 0usize;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        if name == "manifest.json" || name.contains("..") || name.starts_with('/') {
            continue;
        }
        let dest = target_vault_dir.join(&name);
        if entry.is_dir() {
            fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut buf = Vec::new();
            entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
            fs::write(&dest, &buf).map_err(|e| e.to_string())?;
            extracted_files += 1;
        }
    }

    Ok(json!({
        "ok": true,
        "targetVault": target_vault_dir.to_string_lossy(),
        "extractedFiles": extracted_files,
    }))
}
