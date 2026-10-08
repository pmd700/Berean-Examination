import JSZip from 'jszip';
import { buildKnowledgeWebMarkdown } from './markdownFileFormat';

// Build a human-readable, filesystem-safe filename for one Knowledge Web's
// `.md` inside the backup zip. Unlike `sanitizeFileName` (which lowercases
// and collapses everything to a slug), this PRESERVES the readable title —
// it only strips characters that are illegal in filenames, replaces slashes
// with hyphens, and collapses runs of whitespace. The web id is always
// appended so two webs that share a title can never collide.
//   "Daily Schedule" + 12  ->  "Daily Schedule - web-12.md"
//   "Faith / Works"  + 8   ->  "Faith - Works - web-8.md"
export function safeWebFileName(title, webId) {
  const cleaned = String(title ?? '')
    .replace(/[/\\]+/g, '-') // path separators -> hyphen
    .replace(/[<>:"|?*\u0000-\u001f]/g, '') // illegal filename chars
    .replace(/\s+/g, ' ') // collapse whitespace
    .trim()
    .replace(/[.\s]+$/, ''); // no trailing dots/spaces (Windows)
  const base = cleaned || 'Untitled Web';
  return `${base} - web-${webId}.md`;
}

// Filesystem-safe ISO-ish timestamp: no colons, no slashes, no fractional
// seconds. 2026-05-28T18:45:22.123Z  ->  2026-05-28T18-45-22Z
export function backupTimestamp(date = new Date()) {
  return date.toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the download has a chance to start.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildManifest({ generatedAt, succeeded, failed, totalCards, totalConnections }) {
  const lines = [];
  lines.push('# Full Second Brain Backup');
  lines.push('');
  lines.push(`Generated: ${generatedAt}`);
  lines.push('');
  lines.push('## Summary');
  lines.push(`- Knowledge Webs exported: ${succeeded.length}`);
  lines.push(`- Cards: ${totalCards}`);
  lines.push(`- Connections: ${totalConnections}`);
  if (failed.length > 0) {
    lines.push(`- Failed / skipped: ${failed.length}`);
  }
  lines.push('');

  lines.push('## Files');
  if (succeeded.length === 0) {
    lines.push('_No Knowledge Webs were exported._');
  } else {
    for (const item of succeeded) {
      lines.push(`- ${item.fileName} — ${item.cards} cards, ${item.connections} connections`);
    }
  }
  lines.push('');

  if (failed.length > 0) {
    lines.push('## Failed / Skipped exports');
    lines.push('');
    lines.push('These Knowledge Webs are NOT included in this backup:');
    lines.push('');
    for (const item of failed) {
      lines.push(`- ${item.title} (web-${item.webId}) — ${item.reason}`);
    }
    lines.push('');
  }

  lines.push('## Restore Note');
  lines.push('');
  lines.push(
    'Each `.md` file includes a hidden BEREAN_KNOWLEDGE_WEB restore block used by ' +
      'Berean Examination to restore the board exactly. To restore a web, create a ' +
      'new Knowledge Web and use Import file, selecting the corresponding `.md`.',
  );
  lines.push('');

  return lines.join('\n');
}

// Export every Knowledge Web the user owns into a single zip of restore-
// compatible Markdown files plus a manifest.
//
//   webs        — array of KnowledgeWeb rows (already user-scoped by the API)
//   loadWebData — async (web) => one of:
//                   { cards, connections, canvasObjects, web? }
//                   { skipped: true, reason: string }
//                 May also throw; thrown errors are recorded as failures and
//                 the rest of the backup continues. An optional `web` in the
//                 success result lets the caller substitute a decrypted-title
//                 copy of the web (used for unlocked private webs).
//   onProgress  — optional ({ phase, current, total, title }) => void
//
// Returns { succeeded, failed, totalCards, totalConnections, fileName }.
export async function exportAllKnowledgeWebsToZip({ webs, loadWebData, onProgress }) {
  const list = Array.isArray(webs) ? webs : [];
  const zip = new JSZip();
  const succeeded = [];
  const failed = [];
  let totalCards = 0;
  let totalConnections = 0;
  const usedNames = new Set();

  const uniqueName = (name) => {
    if (!usedNames.has(name)) {
      usedNames.add(name);
      return name;
    }
    // Extremely unlikely (id is already in the name), but stay safe.
    const dot = name.lastIndexOf('.');
    const stem = dot === -1 ? name : name.slice(0, dot);
    const ext = dot === -1 ? '' : name.slice(dot);
    let n = 2;
    let candidate = `${stem} (${n})${ext}`;
    while (usedNames.has(candidate)) {
      n += 1;
      candidate = `${stem} (${n})${ext}`;
    }
    usedNames.add(candidate);
    return candidate;
  };

  for (let i = 0; i < list.length; i++) {
    const web = list[i];
    const title = web?.title || `web-${web?.id}`;
    onProgress?.({ phase: 'exporting', current: i + 1, total: list.length, title });

    try {
      const result = await loadWebData(web);
      if (result?.skipped) {
        failed.push({ title, webId: web?.id, reason: result.reason || 'Skipped' });
        continue;
      }
      const exportWeb = result?.web || web;
      const cards = Array.isArray(result?.cards) ? result.cards : [];
      const connections = Array.isArray(result?.connections) ? result.connections : [];
      const canvasObjects = Array.isArray(result?.canvasObjects) ? result.canvasObjects : [];

      const md = buildKnowledgeWebMarkdown({ web: exportWeb, cards, connections, canvasObjects });
      const fileName = uniqueName(safeWebFileName(exportWeb?.title || title, web?.id));
      zip.file(fileName, md);

      succeeded.push({ fileName, cards: cards.length, connections: connections.length });
      totalCards += cards.length;
      totalConnections += connections.length;
    } catch (err) {
      failed.push({
        title,
        webId: web?.id,
        reason: err?.message ? `Export failed: ${err.message}` : 'Export failed (unknown error)',
      });
    }
  }

  onProgress?.({ phase: 'zipping' });

  const generatedAt = new Date().toISOString();
  const manifest = buildManifest({ generatedAt, succeeded, failed, totalCards, totalConnections });
  zip.file('backup-manifest.md', manifest);

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const fileName = `Full second brain backup ${backupTimestamp()}.zip`;
  downloadBlob(blob, fileName);

  return { succeeded, failed, totalCards, totalConnections, fileName };
}
