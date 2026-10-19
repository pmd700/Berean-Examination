import {
  buildBereanKnowledgeWebPayload,
  downloadFile,
  sanitizeFileName,
} from './bereanFileFormat';
import { knowledgeWebReferenceResolver } from '../../lib/knowledgeWebReferences.js';

const BEGIN_MARKER = 'BEREAN_KNOWLEDGE_WEB:BEGIN';
const END_MARKER = 'BEREAN_KNOWLEDGE_WEB:END';

// Encode the embedded payload as base64 so it cannot collide with the END
// marker no matter what users type into card titles/descriptions. base64 only
// uses [A-Za-z0-9+/=], which makes the framing collision-proof.
function toBase64Utf8(str) {
  if (typeof Buffer !== 'undefined') return Buffer.from(str, 'utf-8').toString('base64');
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function fromBase64Utf8(b64) {
  const cleaned = String(b64).replace(/\s+/g, '');
  if (typeof Buffer !== 'undefined') return Buffer.from(cleaned, 'base64').toString('utf-8');
  const bin = atob(cleaned);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function htmlToMarkdown(html) {
  if (html == null) return '';
  let s = String(html);
  s = s.replace(/\r\n?/g, '\n');

  s = s.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n');
  s = s.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n');
  s = s.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n');
  s = s.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n');
  s = s.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '\n##### $1\n');
  s = s.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '\n###### $1\n');

  s = s.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
  s = s.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '_$2_');
  s = s.replace(/<u[^>]*>([\s\S]*?)<\/u>/gi, '$1');
  s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
  s = s.replace(/<(s|strike|del)[^>]*>([\s\S]*?)<\/\1>/gi, '~~$2~~');

  s = s.replace(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

  s = s.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, inner) =>
    inner
      .split('\n')
      .map((l) => (l.trim() ? `> ${l}` : '>'))
      .join('\n'),
  );

  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');
  s = s.replace(/<\/?(ul|ol)[^>]*>/gi, '\n');

  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/p>\s*<p[^>]*>/gi, '\n\n');
  s = s.replace(/<p[^>]*>/gi, '');
  s = s.replace(/<\/p>/gi, '\n');

  s = s.replace(/<[^>]+>/g, '');

  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  s = s.replace(/\n{3,}/g, '\n\n').trim();
  return s;
}

function renderCard(card, options = {}) {
  const out = [];
  out.push(`${options.readableOnly ? '######' : '###'} ${card.title || `Card ${card.id}`}`);
  if (options.readableOnly) out.push(`**Source ID:** web:${options.webId}/card:${card.id}`);
  const meta = [];
  if (card.card_type) meta.push(`**Type:** ${card.card_type}`);
  if (card.tags) meta.push(`**Tags:** ${card.tags}`);
  if (card.scripture_refs) meta.push(`**Scripture:** ${card.scripture_refs}`);
  if (meta.length) {
    out.push(meta.join(' · '));
    out.push('');
  }
  const body = (options.renderContent || htmlToMarkdown)(card.description, card);
  if (body) {
    out.push(body);
    out.push('');
  }
  if (card.image_url) {
    out.push(`![image](${card.image_url})`);
    out.push('');
  }
  if (card.link_url) {
    out.push(`[Link](${card.link_url})`);
    out.push('');
  }
  out.push('---');
  out.push('');
  return out;
}

function buildHumanMarkdown({ web, cards, connections, canvasObjects, readableOnly, renderContent, exportedAt }) {
  const options = { readableOnly, renderContent, webId: web?.id };
  const cardsArr = Array.isArray(cards) ? cards : [];
  const connectionsArr = Array.isArray(connections) ? connections : [];
  const objectsArr = Array.isArray(canvasObjects) ? canvasObjects : [];

  const endpoint = knowledgeWebReferenceResolver(cardsArr, objectsArr, web?.id);

  const lines = [];
  lines.push(`${readableOnly ? '####' : '#'} ${web?.title || 'Knowledge Web'}`);
  lines.push('');
  if (web?.description) {
    lines.push(renderContent ? renderContent(web.description, web) : web.description);
    lines.push('');
  }
  lines.push(`> Exported from Berean Examination on ${exportedAt || new Date().toISOString()}`);
  lines.push(`> ${cardsArr.length} cards · ${connectionsArr.length} connections`);
  lines.push('');
  lines.push('---');
  lines.push('');

  const sections = objectsArr.filter((o) => o.object_type === 'section');
  const cardsInSection = (sec) => {
    const x0 = sec.x ?? 0;
    const y0 = sec.y ?? 0;
    const x1 = x0 + (sec.width || 0);
    const y1 = y0 + (sec.height || 0);
    return cardsArr.filter(
      (c) => typeof c.x === 'number' && typeof c.y === 'number' && c.x >= x0 && c.x <= x1 && c.y >= y0 && c.y <= y1,
    );
  };

  const sectionedIds = new Set();
  if (sections.length > 0) {
    for (const sec of sections) {
      const inside = cardsInSection(sec).filter(card => !readableOnly || !sectionedIds.has(card.id));
      if (inside.length === 0) continue;
      lines.push(`${readableOnly ? '#####' : '##'} ${sec.title || 'Section'}`);
      lines.push('');
      for (const card of inside) {
        sectionedIds.add(card.id);
        lines.push(...renderCard(card, options));
      }
    }
  }

  const orphanCards = cardsArr.filter((c) => !sectionedIds.has(c.id));
  if (orphanCards.length > 0) {
    lines.push(`${readableOnly ? '#####' : '##'} ${sections.length > 0 ? 'Other Cards' : 'Cards'}`);
    lines.push('');
    for (const card of orphanCards) {
      lines.push(...renderCard(card, options));
    }
  }

  if (connectionsArr.length > 0) {
    // Mermaid flowchart block. Node text is double-quoted so most punctuation
    // is allowed; we collapse newlines and swap internal " for typographic
    // “ ” so labels stay readable instead of showing literal &quot; entities.
    const mermaidNodeText = (s) =>
      String(s ?? '')
        .replace(/\r?\n+/g, ' ')
        .replace(/"/g, '\u201D')
        .replace(/\s+/g, ' ')
        .trim() || 'untitled';
    // Edge labels live between |…|, so | itself has to go.
    const mermaidEdgeLabel = (s) =>
      String(s ?? '')
        .replace(/\r?\n+/g, ' ')
        .replace(/\|/g, '/')
        .replace(/"/g, '\u201D')
        .replace(/\s+/g, ' ')
        .trim();

    // Connection endpoints that don't resolve to a real card are visual
    // organization / routing points the user drops on the canvas to keep
    // the graph from becoming spaghetti. They are NOT "unknown cards";
    // render them as a circle node with a distinct O<id> prefix so the
    // graph structure is preserved.
    // Each node is declared in full on first appearance, then referenced
    // by bare id on subsequent edges — matches the user's target output
    // and keeps the diagram compact when many edges share endpoints.
    const declared = new Set();
    const renderEndpoint = (id, kind) => {
      const target = endpoint(id, kind);
      if (declared.has(target.nodeId)) return target.nodeId;
      declared.add(target.nodeId);
      return target.kind === 'card'
        ? `${target.nodeId}["${mermaidNodeText(target.label)}"]`
        : `${target.nodeId}(("${mermaidNodeText(target.label)}"))`;
    };

    lines.push(`${readableOnly ? '#####' : '##'} Connections`);
    lines.push('');
    for (const conn of connectionsArr) {
      lines.push(`- **${endpoint(conn.from_card_id, conn.from_kind).label}** ${conn.has_arrow ? '→' : '↔'} **${endpoint(conn.to_card_id, conn.to_kind).label}**${conn.label ? `: ${conn.label}` : ''}`);
    }
    lines.push('');
    lines.push('```mermaid');
    lines.push('flowchart TD');
    for (const conn of connectionsArr) {
      const edge = conn.has_arrow ? '-->' : '<-->';
      const lbl = mermaidEdgeLabel(conn.label);
      const edgeWithLabel = lbl ? `${edge}|${lbl}|` : edge;
      lines.push(
        `  ${renderEndpoint(conn.from_card_id, conn.from_kind)} ${edgeWithLabel} ${renderEndpoint(conn.to_card_id, conn.to_kind)}`,
      );
    }
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
}

function buildEmbeddedPayload({ web, cards, connections, canvasObjects }) {
  return buildBereanKnowledgeWebPayload({ web, cards, connections, canvasObjects });
}

export function buildKnowledgeWebMarkdown({ web, cards, connections, canvasObjects, readableOnly = false, renderContent = undefined, exportedAt = undefined }) {
  const human = buildHumanMarkdown({ web, cards, connections, canvasObjects, readableOnly, renderContent, exportedAt });
  // The AI export reuses the readable board, without the opaque restore envelope.
  // Ordinary individual exports keep their existing round-trip payload.
  if (readableOnly) return human;
  const payload = buildEmbeddedPayload({ web, cards, connections, canvasObjects });
  const encoded = toBase64Utf8(JSON.stringify(payload));
  const footerLines = [
    '---',
    '',
    '<!-- Do not edit below this line. The hidden block lets Berean Examination',
    'restore your board exactly when you re-import this file. -->',
    '',
    `<!-- ${BEGIN_MARKER}`,
    encoded,
    `${END_MARKER} -->`,
    '',
  ];
  return `${human}\n${footerLines.join('\n')}`;
}

export function exportKnowledgeWebToMarkdown({ web, cards, connections, canvasObjects }) {
  const text = buildKnowledgeWebMarkdown({ web, cards, connections, canvasObjects });
  const blob = new Blob([text], { type: 'text/markdown' });
  downloadFile(blob, `${sanitizeFileName(web?.title)}.md`);
}

function tryDecodeBlock(captured) {
  // Payloads are normally base64-encoded JSON. We also accept raw JSON for
  // forward-compat with anyone manually editing the file (e.g. an LLM that
  // decoded the base64 to round-trip the markdown). If the block looks like
  // raw JSON, try that first; otherwise base64-decode.
  const trimmed = captured.trim();
  let jsonStr = null;
  if (trimmed.startsWith('{')) {
    jsonStr = trimmed;
  } else {
    try {
      jsonStr = fromBase64Utf8(captured);
    } catch {
      return null;
    }
  }
  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return null;
  }
  if (parsed?.format !== 'berean-knowledge-web' || ![1, 2].includes(parsed?.version)) {
    return null;
  }
  return parsed;
}

export function parseKnowledgeWebMarkdown(text) {
  // Walk all marker pairs in the file and try them from last to first. The
  // genuine appended block is always at the end, so we prefer it — but if it
  // happens to be malformed (or a raw-JSON file got truncated by a literal
  // marker inside a card body), we fall back to earlier valid blocks instead
  // of failing outright. This keeps the canonical base64 path collision-proof
  // while making the raw-JSON forward-compat path resilient too.
  const re = new RegExp(`<!--\\s*${BEGIN_MARKER}\\s*([\\s\\S]*?)\\s*${END_MARKER}\\s*-->`, 'g');
  const matches = [...String(text || '').matchAll(re)];
  if (matches.length === 0) {
    throw new Error('No Berean knowledge web data found in this Markdown file. Make sure it was exported from Berean Examination.');
  }

  let parsed = null;
  for (let i = matches.length - 1; i >= 0; i--) {
    const candidate = tryDecodeBlock(matches[i][1]);
    if (candidate) {
      parsed = candidate;
      break;
    }
  }
  if (!parsed) {
    throw new Error('The embedded board data in this Markdown file is corrupted or uses an unrecognized format/version.');
  }

  return {
    formatVersion: parsed.version,
    web: parsed.web || {},
    cards: Array.isArray(parsed.cards) ? parsed.cards : [],
    connections: Array.isArray(parsed.connections) ? parsed.connections : [],
    canvasObjects: Array.isArray(parsed.canvasObjects) ? parsed.canvasObjects : [],
  };
}

export async function importKnowledgeWebFromMarkdown(file) {
  const text = await file.text();
  return parseKnowledgeWebMarkdown(text);
}
