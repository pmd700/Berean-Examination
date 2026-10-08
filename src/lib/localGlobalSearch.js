import { toPlainSearchText } from './localBrainSearch.js';
import { splitBookPages, getPageBody, getPageTitle } from '../components/notes/bookModel.js';

function slugify(title) {
  return String(title || '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function savedItemPath(kind, id, title) {
  const slug = slugify(title);
  return `/${kind}/${slug ? `${slug}-` : ''}${id}`;
}

const noteDeepLink = (id, title) => savedItemPath('notes', id, title);
const webDeepLink = (id, title) => savedItemPath('knowledge-webs', id, title);
const timegraphDeepLink = (id, title) => savedItemPath('timegraphs', id, title);

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

function isPrivateWeb(web) {
  return web?.is_private === true || web?.is_private === 1 || web?.is_private === '1';
}

function updatedTime(record) {
  const value = record?.updated_date || record?.updated_at || record?.created_date || record?.created_at;
  const timestamp = value ? new Date(value).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/** Put the matching words in the middle of the preview instead of truncating
 * every record from its first character. */
function makeSnippet(value, phrase, terms, maxLength = 190) {
  const text = toPlainSearchText(value);
  if (!text) return '';
  const lower = text.toLocaleLowerCase();
  let index = lower.indexOf(phrase);
  if (index < 0) {
    index = terms.reduce((found, term) => (found >= 0 ? found : lower.indexOf(term)), -1);
  }
  if (index < 0) return text.slice(0, maxLength);
  const start = Math.max(0, index - Math.floor(maxLength / 3));
  const end = Math.min(text.length, start + maxLength);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

/**
 * Search named fields and remember which field actually matched. That small
 * piece of metadata is what turns this from a list filter into Spotlight:
 * the destination page can open the right editor and select the exact words.
 */
function resultMatch(title, fields, phrase, terms) {
  const cleanTitle = toPlainSearchText(title);
  const searchable = [
    { name: 'title', text: cleanTitle },
    ...fields.map((field) => ({
      name: field.name,
      text: toPlainSearchText(field.value),
      pageIndex: field.pageIndex,
    })),
  ];
  const normalized = searchable.map((field) => ({ ...field, normalized: normalize(field.text) }));
  const combined = normalized.map((field) => field.normalized).join(' ');
  if (!terms.every((term) => combined.includes(term))) return null;

  const titleField = normalized[0];
  let matchingField = normalized.find((field) => field.normalized.includes(phrase));
  if (!matchingField) {
    matchingField = normalized.find((field) => terms.every((term) => field.normalized.includes(term)));
  }
  if (!matchingField) {
    matchingField = normalized.find((field) => terms.some((term) => field.normalized.includes(term))) || titleField;
  }

  let score = 100;
  if (titleField.normalized === phrase) score = 500;
  else if (titleField.normalized.includes(phrase)) score = 400;
  else if (terms.every((term) => titleField.normalized.includes(term))) score = 300;
  else if (matchingField.normalized.includes(phrase)) score = 200;

  return {
    description: makeSnippet(matchingField.text || cleanTitle, phrase, terms),
    matchField: matchingField.name,
    matchText: matchingField.normalized.includes(phrase)
      ? phrase : terms.find(term => matchingField.normalized.includes(term)) || phrase,
    ...(matchingField.pageIndex != null ? { matchPage: matchingField.pageIndex } : {}),
    score,
  };
}

function addResult(results, {
  record,
  id = record.id,
  type,
  title,
  fields = [],
  href,
  phrase,
  terms,
  targetId = null,
  workspaceTitle = null,
}) {
  const match = resultMatch(title, fields, phrase, terms);
  if (!match) return;
  results.push({
    ...match,
    _updated: updatedTime(record),
    href,
    id,
    targetId,
    title: toPlainSearchText(title),
    type,
    workspaceTitle: toPlainSearchText(workspaceTitle || title),
  });
}

export function searchLocalLibrary(collections, rawQuery, limit = 50) {
  const phrase = normalize(rawQuery).slice(0, 500);
  if (!phrase) return [];
  const terms = [...new Set(phrase.split(/\s+/).filter(Boolean))].slice(0, 30);
  const chapters = Array.isArray(collections?.chapters) ? collections.chapters : [];
  const annotations = Array.isArray(collections?.annotations) ? collections.annotations : [];
  const keywords = Array.isArray(collections?.keywords) ? collections.keywords : [];
  const cards = Array.isArray(collections?.cards) ? collections.cards : [];
  const webs = Array.isArray(collections?.webs) ? collections.webs : [];
  const notes = Array.isArray(collections?.notes) ? collections.notes : [];
  const timegraphs = Array.isArray(collections?.timegraphs) ? collections.timegraphs : [];
  const results = [];

  for (const chapter of chapters) {
    const title = `${chapter.book || 'Bible Study'} ${chapter.chapter_number || ''}`.trim();
    addResult(results, {
      record: chapter,
      type: 'Chapter',
      title,
      fields: [
        { name: 'body', value: chapter.raw_text },
        { name: 'body', value: chapter.notes },
        { name: 'body', value: chapter.context },
        { name: 'body', value: chapter.application },
        { name: 'version', value: chapter.version },
      ],
      href: `/Study?chapter_id=${encodeURIComponent(chapter.id)}`,
      phrase,
      terms,
    });
  }

  for (const annotation of annotations) {
    const verse = annotation.start_verse ? `:${annotation.start_verse}` : '';
    const title = `${annotation.book || 'Annotation'} ${annotation.chapter_number || ''}${verse}`.trim();
    const parent = chapters.find((chapter) => (
      chapter.book === annotation.book
      && String(chapter.chapter_number) === String(annotation.chapter_number)
      && chapter.version === annotation.version
    ));
    if (!parent) continue;
    addResult(results, {
      record: annotation,
      type: 'Annotation',
      title,
      fields: [
        { name: 'body', value: annotation.selected_text },
        { name: 'body', value: annotation.content },
      ],
      href: `/Study?chapter_id=${encodeURIComponent(parent.id)}`,
      phrase,
      terms,
    });
  }

  for (const keyword of keywords) {
    addResult(results, {
      record: keyword,
      type: 'Keyword',
      title: keyword.title || 'Untitled keyword',
      fields: [
        { name: 'category', value: keyword.category },
        { name: 'body', value: keyword.explanation },
      ],
      href: `/Keywords?keyword_id=${encodeURIComponent(keyword.id)}`,
      phrase,
      terms,
    });
  }

  for (const note of notes) {
    addResult(results, {
      record: note,
      type: 'Note',
      title: note.title || 'Untitled Note',
      fields: splitBookPages(note.content).flatMap((page, pageIndex) => [
        { name: 'title', value: getPageTitle(page), pageIndex },
        { name: 'body', value: getPageBody(page), pageIndex },
      ]),
      href: noteDeepLink(note.id, note.title),
      phrase,
      terms,
    });
  }

  for (const web of webs) {
    if (isPrivateWeb(web)) continue;
    addResult(results, {
      record: web,
      type: 'Knowledge Web',
      title: web.title || 'Untitled Web',
      href: webDeepLink(web.id, web.title),
      phrase,
      terms,
    });
  }

  for (const card of cards) {
    const web = webs.find((candidate) => sameId(candidate.id, card.web_id));
    if (!web || isPrivateWeb(web)) continue;
    const baseUrl = webDeepLink(web.id, web.title);
    addResult(results, {
      record: card,
      type: 'Web Card',
      title: card.title || 'Untitled card',
      fields: [
        { name: 'body', value: card.description },
        { name: 'tags', value: card.tags },
        { name: 'scripture', value: card.scripture_refs },
      ],
      href: `${baseUrl}?web=${encodeURIComponent(web.id)}&card=${encodeURIComponent(card.id)}`,
      phrase,
      terms,
      targetId: card.id,
      workspaceTitle: web.title || 'Untitled Web',
    });
  }

  for (const timegraph of timegraphs) {
    const graphTitle = timegraph.title || 'Unnamed timeline';
    const graphHref = timegraphDeepLink(timegraph.id, timegraph.title);
    addResult(results, {
      record: timegraph,
      type: 'Timeline',
      title: graphTitle,
      href: graphHref,
      phrase,
      terms,
    });

    for (const event of Array.isArray(timegraph.events) ? timegraph.events : []) {
      addResult(results, {
        record: { ...event, updated_date: timegraph.updated_date },
        id: `${timegraph.id}:${event.id}`,
        type: 'Timeline Event',
        title: event.title || 'Unnamed event',
        fields: [
          { name: 'body', value: event.description },
          { name: 'tags', value: event.tags },
        ],
        href: graphHref,
        phrase,
        terms,
        targetId: event.id,
        workspaceTitle: graphTitle,
      });
    }
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  return results
    .sort((left, right) => right.score - left.score || right._updated - left._updated)
    .slice(0, safeLimit)
    .map(({ score: _score, _updated, ...result }) => result);
}
