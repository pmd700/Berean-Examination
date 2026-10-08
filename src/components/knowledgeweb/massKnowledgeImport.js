import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { Markdown } from 'tiptap-markdown';
import {
  extractNoteBackupPayload,
  stripNoteBackupPayload,
} from '../../lib/noteBackupMarkdown.js';

export const MAX_MASS_IMPORT_FILES = 200;
export const MAX_MARKDOWN_NOTE_BYTES = 16 * 1024 * 1024;

const RESTORE_BLOCK = /<!--\s*BEREAN_KNOWLEDGE_WEB:BEGIN[\s\S]*?BEREAN_KNOWLEDGE_WEB:END\s*-->/gi;
function cleanTitle(value, fallback) {
  const cleaned = String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || fallback).slice(0, 240);
}

export function titleFromFileName(fileName, fallback = 'Imported item') {
  const leaf = String(fileName || '').split(/[\\/]/).pop() || '';
  const withoutExtension = leaf.replace(/\.(?:berean|markdown|md)$/i, '');
  return cleanTitle(withoutExtension.replace(/[_-]+/g, ' '), fallback);
}

export function prepareMarkdownNote(markdown, fileName) {
  const source = String(markdown || '');
  const richBackup = extractNoteBackupPayload(source);
  const withoutRestoreData = stripNoteBackupPayload(source).replace(RESTORE_BLOCK, '').trim();
  const lines = withoutRestoreData.replace(/\r\n?/g, '\n').split('\n');
  const firstContentIndex = lines.findIndex((line) => line.trim());
  const firstLine = firstContentIndex >= 0 ? lines[firstContentIndex] : '';
  const heading = /^\s*#\s+(.+?)\s*#*\s*$/.exec(firstLine);
  const projectedTitle = heading
    ? cleanTitle(heading[1].replace(/[*_`~]/g, ''), titleFromFileName(fileName, 'Imported Note'))
    : titleFromFileName(fileName, 'Imported Note');
  const title = typeof richBackup?.title === 'string' && richBackup.title
    ? richBackup.title
    : projectedTitle;
  if (heading) lines.splice(firstContentIndex, 1);
  return { title, markdown: lines.join('\n').trim(), richHtml: richBackup?.html ?? null };
}

export function markdownToNoteHtml(markdown) {
  const editor = new Editor({
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: true,
        HTMLAttributes: { class: 'external-link', target: '_blank', rel: 'noopener noreferrer' },
      }),
      Table.configure({ resizable: true, HTMLAttributes: { class: 'rt-table' } }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({ html: false, linkify: false, breaks: false }),
    ],
    content: String(markdown || ''),
  });
  try { return editor.getHTML(); }
  finally { editor.destroy(); }
}

function importKind(fileName) {
  const lower = String(fileName || '').toLowerCase();
  if (lower.endsWith('.berean')) return 'web';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'note';
  return '';
}

export async function importKnowledgeFiles(files, adapters) {
  const selected = Array.from(files || []);
  if (!selected.length) return { imported: [], failed: [] };
  if (selected.length > MAX_MASS_IMPORT_FILES) {
    throw new Error(`Choose no more than ${MAX_MASS_IMPORT_FILES} files at once.`);
  }
  const imported = [];
  const failed = [];
  for (let index = 0; index < selected.length; index += 1) {
    const file = selected[index];
    const kind = importKind(file?.name);
    let createdWeb = null;
    try {
      if (kind === 'web') {
        const payload = await adapters.parseBerean(file);
        const fallback = titleFromFileName(file.name, 'Imported Knowledge Web');
        const title = cleanTitle(payload?.web?.title, fallback);
        createdWeb = await adapters.createKnowledgeWeb(title);
        const committed = await adapters.commitKnowledgeWeb(createdWeb.id, payload);
        const item = { kind, fileName: file.name, record: { ...createdWeb, ...(committed?.web || {}), id: createdWeb.id }, report: committed?.report };
        imported.push(item);
        try { await adapters.onImported?.(item, { index, total: selected.length }); } catch {}
        continue;
      }
      if (kind === 'note') {
        if (!Number.isFinite(file?.size) || file.size > MAX_MARKDOWN_NOTE_BYTES) throw new Error('This Markdown file is too large to import safely.');
        const prepared = prepareMarkdownNote(await file.text(), file.name);
        const content = prepared.richHtml ?? adapters.renderMarkdown(prepared.markdown);
        const record = await adapters.createNote({ title: prepared.title, content, tags: [] });
        const item = { kind, fileName: file.name, record };
        imported.push(item);
        try { await adapters.onImported?.(item, { index, total: selected.length }); } catch {}
        continue;
      }
      throw new Error('Only .berean and .md files can be mass imported.');
    } catch (error) {
      if (createdWeb?.id != null) {
        try { await adapters.deleteKnowledgeWeb(createdWeb.id); } catch {}
      }
      failed.push({ fileName: file?.name || 'Unnamed file', message: error?.message || 'Import failed.' });
    }
  }
  return { imported, failed };
}
