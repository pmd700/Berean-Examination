const VALID_SCOPES = new Set(['all', 'sources', 'cards', 'connections', 'notes']);

function textValue(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join(' ');
  if (typeof value === 'object') return Object.values(value).map(textValue).filter(Boolean).join(' ');
  return String(value);
}

export function toPlainSearchText(value) {
  return textValue(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function normalize(value) {
  return toPlainSearchText(value).toLocaleLowerCase();
}

function sameId(left, right) {
  return left !== null
    && left !== undefined
    && right !== null
    && right !== undefined
    && String(left) === String(right);
}

function updatedTime(record) {
  const value = record?.updated_date || record?.updated_at || record?.created_date || record?.created_at;
  const timestamp = value ? new Date(value).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function makeSnippet(value, phrase, terms, maxLength = 240) {
  const text = toPlainSearchText(value);
  if (!text) return '';
  const lower = text.toLocaleLowerCase();
  let index = lower.indexOf(phrase);
  if (index < 0) index = terms.reduce((found, term) => {
    if (found >= 0) return found;
    return lower.indexOf(term);
  }, -1);
  if (index < 0) return text.slice(0, maxLength);
  const start = Math.max(0, index - Math.floor(maxLength / 3));
  const end = Math.min(text.length, start + maxLength);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

function matchCandidate({ title, tags, text }, phrase, terms) {
  const titleText = toPlainSearchText(title);
  const tagsText = toPlainSearchText(tags);
  const bodyText = toPlainSearchText(text);
  const normalizedGroups = {
    title: normalize(titleText),
    tags: normalize(tagsText),
    text: normalize(bodyText),
  };
  const combined = `${normalizedGroups.title} ${normalizedGroups.tags} ${normalizedGroups.text}`;
  if (!terms.every((term) => combined.includes(term))) return null;

  let reason = 'text';
  let score = 100;
  let snippetText = bodyText || tagsText || titleText;
  if (normalizedGroups.title.includes(phrase) || terms.every((term) => normalizedGroups.title.includes(term))) {
    reason = 'title';
    score = normalizedGroups.title === phrase ? 500 : 400;
    snippetText = bodyText || tagsText || titleText;
  } else if (terms.every((term) => normalizedGroups.tags.includes(term))) {
    reason = 'tags';
    score = 300;
    snippetText = tagsText;
  } else if (normalizedGroups.text.includes(phrase)) {
    score = 220;
  }
  return {
    reason,
    score,
    snippet: makeSnippet(snippetText, phrase, terms),
  };
}

function noteBelongsToWeb(noteId, webId, links) {
  return links.some((link) => (
    (link.from_type === 'note' && sameId(link.from_id, noteId)
      && link.to_type === 'web' && sameId(link.to_id, webId))
    || (link.to_type === 'note' && sameId(link.to_id, noteId)
      && link.from_type === 'web' && sameId(link.from_id, webId))
  ));
}

function sourceSearchText(source) {
  const details = source?.metadata_json || {};
  const savedAnalysis = details.ai_processing_v1 || {};
  return [
    source.raw_text,
    source.source_url,
    source.source_type,
    details.author,
    details.tags,
    savedAnalysis.summary,
    savedAnalysis.key_points,
    savedAnalysis.source_claims,
    savedAnalysis.concepts,
    savedAnalysis.questions_raised,
    savedAnalysis.entities,
    savedAnalysis.theology,
  ];
}

function addResult(results, record, resultType, match, metadata = {}) {
  results.push({
    _score: match.score,
    _updated: updatedTime(record),
    id: record.id,
    match_reason: `${match.reason} match`,
    metadata,
    result_type: resultType,
    snippet: match.snippet,
    title: record.title || record.label || record.relationship_type || `${resultType} #${record.id}`,
    web_id: record.web_id ?? null,
  });
}

export function searchLocalBrainRecords(collections, options = {}) {
  const query = toPlainSearchText(options.query || '').slice(0, 500);
  const phrase = normalize(query);
  if (!phrase) return [];
  const terms = [...new Set(phrase.split(/\s+/).filter(Boolean))].slice(0, 30);
  const scope = VALID_SCOPES.has(options.scope) ? options.scope : 'all';
  const webId = options.webId === '__any__' || options.webId === null
    || options.webId === undefined ? null : options.webId;
  const limit = Math.min(Math.max(Number(options.limit) || 100, 1), 100);
  const sources = Array.isArray(collections.sources) ? collections.sources : [];
  const cards = Array.isArray(collections.cards) ? collections.cards : [];
  const connections = Array.isArray(collections.connections) ? collections.connections : [];
  const notes = Array.isArray(collections.notes) ? collections.notes : [];
  const links = Array.isArray(collections.links) ? collections.links : [];
  const results = [];

  if (scope === 'all' || scope === 'sources') {
    for (const source of sources) {
      if (webId !== null && !sameId(source.web_id, webId)) continue;
      const match = matchCandidate({
        title: source.title,
        tags: source.metadata_json?.tags,
        text: sourceSearchText(source),
      }, phrase, terms);
      if (match) addResult(results, source, 'source', match, { source_type: source.source_type });
    }
  }

  if (scope === 'all' || scope === 'cards') {
    for (const card of cards) {
      if (webId !== null && !sameId(card.web_id, webId)) continue;
      const match = matchCandidate({
        title: card.title,
        tags: card.tags,
        text: [card.description, card.scripture_refs],
      }, phrase, terms);
      if (match) addResult(results, card, 'card', match, {
        source_ids: card.source_ids,
        status: card.status,
      });
    }
  }

  if (scope === 'all' || scope === 'connections') {
    for (const connection of connections) {
      if (webId !== null && !sameId(connection.web_id, webId)) continue;
      const title = connection.label || connection.relationship_type || `Connection #${connection.id}`;
      const match = matchCandidate({
        title,
        tags: connection.relationship_type,
        text: connection.evidence,
      }, phrase, terms);
      if (match) addResult(results, { ...connection, title }, 'connection', match, {
        from_card_id: connection.from_card_id,
        status: connection.status,
        to_card_id: connection.to_card_id,
      });
    }
  }

  if (scope === 'all' || scope === 'notes') {
    for (const note of notes) {
      if (webId !== null && !noteBelongsToWeb(note.id, webId, links)) continue;
      const match = matchCandidate({
        title: note.title,
        tags: note.tags,
        text: note.content,
      }, phrase, terms);
      if (match) addResult(results, note, 'note', match, { tags: note.tags });
    }
  }

  return results
    .sort((left, right) => right._score - left._score || right._updated - left._updated)
    .slice(0, limit)
    .map(({ _score, _updated, ...result }) => result);
}
