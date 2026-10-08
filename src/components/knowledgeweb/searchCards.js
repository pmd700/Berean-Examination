// Card search for the knowledge web.
//
// Matches a card's title, tags, scripture references and — the point of this
// module — the body of the card itself. Descriptions are stored as editor
// HTML, so they have to be reduced to readable text before matching: searching
// the raw markup would hit tag names, class lists, image data-URIs and the
// attributes our own extensions write (comment bodies, logic sources), none of
// which the user can see on the card.

export const MATCH_KIND = Object.freeze({
  TITLE: 'title',
  TAG: 'tag',
  SCRIPTURE: 'scripture',
  CONTENT: 'content',
});

// Ranked best-first: a title hit is a stronger answer than a body hit.
const KIND_RANK = {
  [MATCH_KIND.TITLE]: 0,
  [MATCH_KIND.TAG]: 1,
  [MATCH_KIND.SCRIPTURE]: 2,
  [MATCH_KIND.CONTENT]: 3,
};

const plainTextCache = new Map();

/** Visible text of a card body, with block boundaries kept as spaces. */
export function htmlToPlainText(html) {
  const source = String(html || '');
  if (!source) return '';
  if (plainTextCache.has(source)) return plainTextCache.get(source);

  let text;
  if (typeof DOMParser === 'undefined') {
    text = source.replace(/<[^>]*>/g, ' ');
  } else {
    const parsed = new DOMParser().parseFromString(source, 'text/html');
    // Block elements run together without this ("endsHere" from "ends</p><p>here").
    parsed.body.querySelectorAll('p, div, li, br, h1, h2, h3, h4, tr').forEach((el) => {
      el.insertAdjacentText('beforebegin', ' ');
    });
    text = parsed.body.textContent || '';
  }

  text = text.replace(/\s+/g, ' ').trim();
  // Bounded so a library of long cards can't grow this without limit.
  if (plainTextCache.size > 500) plainTextCache.clear();
  plainTextCache.set(source, text);
  return text;
}

/**
 * A short window of text around the match, so the row shows *why* it matched.
 * Returns `{ before, match, after }` for rendering with the hit emphasised.
 */
export function buildSnippet(text, index, length, radius = 48) {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + length + radius);
  return {
    before: (start > 0 ? '…' : '') + text.slice(start, index),
    match: text.slice(index, index + length),
    after: text.slice(index + length, end) + (end < text.length ? '…' : ''),
  };
}

function firstMatch(card, needle) {
  const title = String(card.title || '');
  const titleAt = title.toLowerCase().indexOf(needle);
  if (titleAt !== -1) return { kind: MATCH_KIND.TITLE, at: titleAt };

  const tag = (card.tags || []).find((t) => String(t).toLowerCase().includes(needle));
  if (tag) return { kind: MATCH_KIND.TAG, at: 0, tag };

  const ref = (card.scripture_refs || []).find((r) => String(r).toLowerCase().includes(needle));
  if (ref) return { kind: MATCH_KIND.SCRIPTURE, at: 0, reference: ref };

  const body = htmlToPlainText(card.description);
  const bodyAt = body.toLowerCase().indexOf(needle);
  if (bodyAt !== -1) {
    return { kind: MATCH_KIND.CONTENT, at: bodyAt, snippet: buildSnippet(body, bodyAt, needle.length) };
  }
  return null;
}

/**
 * Cards matching `query`, best match first.
 *
 * Ties inside a rank keep an earlier match ahead of a later one, so a card
 * whose first line mentions the term beats one that mentions it in passing.
 */
export function searchCards(cards, query, limit = 8) {
  const needle = String(query || '').toLowerCase().trim();
  if (!needle) return [];

  const hits = [];
  for (const card of cards || []) {
    const match = firstMatch(card, needle);
    if (match) hits.push({ card, ...match });
  }

  hits.sort((a, b) => (KIND_RANK[a.kind] - KIND_RANK[b.kind]) || (a.at - b.at));
  return hits.slice(0, limit);
}
