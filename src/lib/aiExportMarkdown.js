import { libraryLinkPath } from './libraryLinks';
import { parseCommentaryLinkTarget } from './commentaryLink';
import { fromMarkdown } from 'mdast-util-from-markdown';

export function referenceAnchor(id) {
  return `bex-${Array.from(new TextEncoder().encode(String(id)), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function referenceLink(id) { return `[${id}](#${referenceAnchor(id)})`; }

export function localLinkReference(href) {
  const path = libraryLinkPath(href);
  if (!path) return null;
  if (path.startsWith('/Study?')) {
    const target = parseCommentaryLinkTarget(path);
    return target ? `commentary:${target.annotationId}` : null;
  }
  const match = /^\/(notes|knowledge-webs|timegraphs)\/(?:[a-z0-9-]*-)?(\d+)(?:[?#]|$)/.exec(path);
  if (!match) return null;
  const prefix = { notes: 'note', 'knowledge-webs': 'web', timegraphs: 'timeline' }[match[1]];
  const page = new URL(path, 'https://bex.local').searchParams.get('page');
  return `${prefix}:${match[2]}${prefix === 'note' && /^[1-9]\d*$/.test(page || '') ? `/page:${page}` : ''}`;
}

/** References are text, never a base64 media dump or an invented transcription. */
export function mediaReference(url, label, context) {
  const value = String(url || '');
  const reference = !value ? '(missing reference)' : /^data:/i.test(value) ? '(embedded binary omitted)' : value;
  context?.assets?.push({ source: context.sourceId, label: String(label || 'Media'), reference });
  return `${label || 'Media'} — ${reference}; visual/binary contents are not extracted.`;
}

const blockTags = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'FIGURE', 'FIGCAPTION']);
// A tag inside a Markdown code example is literal writing, not an HTML document.
const htmlPattern = /^\s*<(?:p|div|span|h[1-6]|a|img|ol|ul|li|table|blockquote|details|pre|strong|em|br|sup|u|mark|code|b|i|s|del|hr)\b/i;
const clean = text => String(text || '').replace(/\r\n?/g, '\n').replace(/\n[ \t]+\n/g, '\n\n').replace(/\n{3,}/g, '\n\n').trim();
const indent = (text, pad) => text.split('\n').map(line => `${pad}${line}`).join('\n');

function readableMarkdown(value, context) {
  const tree = fromMarkdown(value);
  const definitions = new Map();
  const replacements = [];
  const visit = (node, callback) => {
    callback(node);
    for (const child of node.children || []) visit(child, callback);
  };
  visit(tree, node => {
    if (node.type === 'definition' && !definitions.has(node.identifier)) definitions.set(node.identifier, node);
  });
  visit(tree, node => {
    const definition = node.type === 'linkReference' || node.type === 'imageReference' ? definitions.get(node.identifier) : null;
    const href = definition?.url || node.url;
    if (!href) return;
    const image = node.type === 'image' || node.type === 'imageReference';
    const link = node.type === 'link' || node.type === 'linkReference';
    const binary = /^data:/i.test(href);
    if (node.type === 'definition') {
      if (binary) replacements.push({ start: node.position.start.offset, end: node.position.end.offset, text: `[${node.label || node.identifier}]: (embedded binary omitted)` });
      return;
    }
    if (!link && !image) return;
    const label = node.alt || (node.children || []).map(child => child.value || '').join('') || 'Linked media';
    if (image || binary) {
      replacements.push({ start: node.position.start.offset, end: node.position.end.offset, text: `[${mediaReference(href, label, context)}]` });
    } else {
      const target = localLinkReference(href);
      if (target) context.relationships?.push({ source: context.sourceId, target, kind: 'hyperlink', label, href });
    }
  });
  // Replace only media syntax. All other original Markdown, whitespace, code
  // fences and reference definitions stay byte-for-byte intact.
  const topLevel = [];
  let coveredUntil = -1;
  for (const replacement of replacements.sort((a, b) => a.start - b.start || b.end - a.end)) {
    if (replacement.start < coveredUntil) continue;
    topLevel.push(replacement);
    coveredUntil = replacement.end;
  }
  let text = value;
  for (const replacement of topLevel.reverse()) text = text.slice(0, replacement.start) + replacement.text + text.slice(replacement.end);
  return text.trim();
}

/** Walk the saved document, including closed toggles and bodies stored in attributes.
 * No editor is mounted and no remote page, image, or attachment is fetched. */
export function richTextToAiMarkdown(value, context = {}, depth = 0) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string') return JSON.stringify(value, null, 2);
  if (depth > 16) throw new Error('A nested annotation is too deep to export safely. Nothing was written.');
  if (!htmlPattern.test(value)) {
    return readableMarkdown(value, context);
  }
  if (typeof DOMParser === 'undefined') throw new Error('The document parser is unavailable.');
  const document = new DOMParser().parseFromString(value, 'text/html');
  const attached = new Map();
  const pointers = new Map();
  const literals = [];
  let literalPrefix = 'BEX_EXPORT_LITERAL_';
  while (value.includes(literalPrefix)) literalPrefix += '_';
  const literal = text => { const token = `${literalPrefix}${literals.length}_END`; literals.push({ token, text }); return token; };
  const walkChildren = node => Array.from(node.childNodes).map(walk).join('');
  function walk(node) {
    if (node.nodeType === 3) return node.textContent.replace(/\s+/g, ' ');
    if (node.nodeType !== 1) return '';
    const tag = node.tagName;
    if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(tag)) return '';
    if (node.hasAttribute('data-bex-file')) {
      return `\n\n[Attachment: ${mediaReference(node.getAttribute('data-file-url'), node.getAttribute('data-file-name') || 'Attached file', context)}]\n\n`;
    }
    if (node.hasAttribute('data-timegraph-id')) {
      const target = `timeline:${node.getAttribute('data-timegraph-id')}`;
      context.relationships?.push({ source: context.sourceId, target, kind: 'embedded timeline' });
      return `\n\nEmbedded timeline: ${referenceLink(target)}\n\n`;
    }
    if (node.hasAttribute('data-drawing-id')) {
      const target = `drawing:${node.getAttribute('data-drawing-id')}`;
      context.relationships?.push({ source: context.sourceId, target, kind: 'embedded drawing' });
      return ` Drawing: ${referenceLink(target)} `;
    }
    if (tag === 'IMG' || tag === 'VIDEO' || tag === 'AUDIO') {
      return ` [${mediaReference(node.getAttribute('src'), node.getAttribute('alt') || tag.toLowerCase(), context)}] `;
    }
    if (tag === 'PRE') {
      const text = node.textContent;
      const fence = '`'.repeat(Math.max(3, ...Array.from(text.matchAll(/`+/g), match => match[0].length + 1)));
      return `\n\n${literal(`${fence}\n${text}\n${fence}`)}\n\n`;
    }
    if (tag === 'CODE') {
      const text = node.textContent;
      const fence = '`'.repeat(Math.max(1, ...Array.from(text.matchAll(/`+/g), match => match[0].length + 1)));
      const pad = /^[` ]|[` ]$/.test(text) ? ' ' : '';
      return literal(`${fence}${pad}${text}${pad}${fence}`);
    }
    if (tag === 'OL' || tag === 'UL') {
      const start = Number(node.getAttribute('start')) || 1;
      return `\n\n${Array.from(node.children).map((item, i) => {
        const checked = item.getAttribute('data-checked');
        const prefix = tag === 'OL' ? `${start + i}. ` : checked != null ? `- [${checked === 'true' ? 'x' : ' '}] ` : '- ';
        const lines = clean(walkChildren(item)).split('\n');
        return `${prefix}${lines[0]}${lines.length > 1 ? `\n${indent(lines.slice(1).join('\n'), ' '.repeat(prefix.length))}` : ''}`;
      }).join('\n')}\n\n`;
    }
    if (tag === 'TABLE') {
      // Row/cell labels retain multiline content and merged cells without a lossy GFM table.
      const rows = Array.from(node.querySelectorAll('tr')).filter(row => row.closest('table') === node);
      return `\n\nTable:\n${rows.map((row, i) => `\nRow ${i + 1}:\n${Array.from(row.children).map((cell, j) => {
        const span = Number(cell.getAttribute('colspan')) > 1 || Number(cell.getAttribute('rowspan')) > 1
          ? ` (column span ${cell.getAttribute('colspan') || 1}, row span ${cell.getAttribute('rowspan') || 1})` : '';
        return `- ${cell.tagName === 'TH' ? 'Header' : 'Cell'} ${j + 1}${span}:\n${indent(clean(walkChildren(cell)), '  ')}`;
      }).join('\n')}`).join('\n')}\n\n`;
    }
    let text = walkChildren(node);
    for (const type of ['footnote', 'comment', 'tooltip']) {
      if (!node.hasAttribute(`data-${type}-id`)) continue;
      const id = node.getAttribute(`data-${type}-id`);
      const key = `${type}:${id}`;
      const entry = attached.get(key) || { type, id, anchors: [], body: node.getAttribute(`data-${type}-text`) || '' };
      if (text.trim()) entry.anchors.push(text.trim());
      if (!entry.body) entry.body = node.getAttribute(`data-${type}-text`) || '';
      attached.set(key, entry);
      text = `${type === 'footnote' ? '' : text}[${key}]`;
    }
    if (node.hasAttribute('data-pointer-id')) {
      const id = node.getAttribute('data-pointer-id');
      const role = node.getAttribute('data-pointer-role') || 'unspecified';
      const entry = pointers.get(id) || [];
      entry.push({ role, text: text.trim() });
      pointers.set(id, entry);
    }
    if (node.hasAttribute('data-keyword-id')) {
      const target = `keyword:${node.getAttribute('data-keyword-id')}`;
      context.relationships?.push({ source: context.sourceId, target, kind: 'keyword mention', label: text.trim() });
      text = `${text} (${referenceLink(target)})`;
    }
    if (node.hasAttribute('data-logic-source')) return ` Logic formula: ${node.getAttribute('data-logic-source')} `;
    if (/^H[1-6]$/.test(tag)) return `\n\n${'#'.repeat(Number(tag[1]))} ${text.trim()}\n\n`;
    if (tag === 'BR') return '\n';
    if (tag === 'HR') return '\n\n---\n\n';
    if (tag === 'STRONG' || tag === 'B') return `**${text}**`;
    if (tag === 'EM' || tag === 'I') return `_${text}_`;
    if (tag === 'S' || tag === 'DEL') return `~~${text}~~`;
    if (tag === 'BLOCKQUOTE') return `\n\n${indent(clean(text), '> ')}\n\n`;
    if (tag === 'SUMMARY') return `\n\n**${text.trim()}**\n\n`;
    if (tag === 'DETAILS') return `\n\n${clean(text)}\n\n`;
    if (tag === 'A') {
      const href = node.getAttribute('href') || '';
      if (href.startsWith('data:')) return `${text} [${mediaReference(href, 'Linked binary', context)}]`;
      const target = localLinkReference(href);
      if (target) context.relationships?.push({ source: context.sourceId, target, kind: 'hyperlink', label: text.trim(), href });
      return href ? `[${text.trim() || href}](${href})` : text;
    }
    if (blockTags.has(tag)) return `\n\n${text.trim()}\n\n`;
    return text;
  }
  let body = clean(walkChildren(document.body));
  for (const entry of literals) body = body.replace(entry.token, entry.text);
  const extras = [];
  for (const entry of attached.values()) {
    const content = richTextToAiMarkdown(entry.body, context, depth + 1);
    extras.push(`- ${entry.type}:${entry.id}${entry.anchors.length ? ` — attached to: ${entry.anchors.join(' … ')}` : ''}\n${indent(content || '(empty)', '  ')}`);
  }
  for (const [id, entries] of pointers) {
    extras.push(`- Pointer ${id}: ${entries.map(entry => `${entry.role}: ${entry.text || '(marker)'}`).join(' → ')}`);
  }
  return `${body}${extras.length ? `\n\nAttached notes and pointers:\n${extras.join('\n\n')}` : ''}`;
}
