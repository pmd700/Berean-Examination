import { findMatches } from '../editor/findInEditor';
import { getPageBody, getPageTitle } from './bookModel';

export const indexKey = (value) => String(value || '').trim().toLocaleLowerCase();
const compare = (a, b) => a.term.localeCompare(b.term, undefined, { sensitivity: 'base', numeric: true });

export function parseIndexPages(value, count) {
  if (!String(value).trim()) return [];
  const pages = new Set();
  for (const part of String(value).split(',')) {
    const match = /^\s*(\d+)\s*(?:[-–]\s*(\d+))?\s*$/.exec(part);
    if (!match) throw new Error('Use page numbers or ranges, such as 2, 4–6.');
    const start = Number(match[1]);
    const end = Number(match[2] || match[1]);
    if (start < 1 || end > count || end < start) throw new Error(`Page references must be between 1 and ${count}.`);
    for (let page = start; page <= end; page += 1) pages.add(page);
  }
  return [...pages].sort((a, b) => a - b);
}

export function indexRanges(pages, primary = []) {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const ranges = [];
  sorted.forEach(page => {
    const bold = primary.includes(page);
    const last = ranges.at(-1);
    if (last && last.end + 1 === page && last.bold === bold) last.end = page;
    else ranges.push({ start: page, end: page, bold });
  });
  return ranges;
}

// Only real page titles/headings seed the index; topics are curated by the user.
export function buildBookIndex(pages, custom = []) {
  const entries = new Map();
  const add = ({ term, parent = '', refs = [], primary = [], seeAlso = [], destinations = [] }) => {
    term = String(term || '').trim();
    parent = String(parent || '').trim();
    if (!term) return;
    const key = `${indexKey(parent)}\u0000${indexKey(term)}`;
    if (!entries.has(key)) entries.set(key, { key, term, parent, refs: [], primary: [], seeAlso: [], destinations: [] });
    const entry = entries.get(key);
    entry.refs = [...new Set([...entry.refs, ...refs])].filter(p => Number.isInteger(p) && p > 0 && p <= pages.length).sort((a, b) => a - b);
    entry.primary = [...new Set([...entry.primary, ...primary])].filter(p => entry.refs.includes(p));
    entry.seeAlso = [...new Set([...entry.seeAlso, ...seeAlso])];
    entry.destinations.push(...destinations);
  };
  pages.forEach((page, i) => {
    const title = getPageTitle(page).trim() || `Untitled page ${i + 1}`;
    add({ term: title, refs: [i + 1], primary: [i + 1], destinations: [{ page: i, kind: 'title' }] });
    const doc = new DOMParser().parseFromString(getPageBody(page), 'text/html');
    doc.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((heading, headingIndex) => {
      add({ term: heading.textContent, parent: title, refs: [i + 1], destinations: [{ page: i, kind: 'heading', headingIndex, term: heading.textContent.trim() }] });
    });
  });
  custom.forEach(add);
  for (const entry of [...entries.values()]) {
    if (entry.parent) add({ term: entry.parent });
  }
  const roots = [...entries.values()].filter(entry => !entry.parent).sort(compare);
  return roots.map(entry => ({ ...entry, children: [...entries.values()].filter(child => indexKey(child.parent) === indexKey(entry.term)).sort(compare) }));
}

// References follow pages when the user reorders or removes leaves.
export function remapIndexEntries(entries, oldPageOrder) {
  const number = old => {
    const position = oldPageOrder.indexOf(old - 1);
    return position < 0 ? null : position + 1;
  };
  return entries.map(entry => ({ ...entry,
    refs: entry.refs.map(number).filter(Boolean).sort((a, b) => a - b),
    primary: entry.primary.map(number).filter(Boolean).sort((a, b) => a - b),
  }));
}

/** Locate the indexed heading, not an earlier mention of the same words. */
export function bookIndexMatch(doc, destination) {
  if (!destination || destination.kind === 'title') return null;
  const headings = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') headings.push({ node, from: pos + 1, to: pos + node.nodeSize - 1 });
  });
  const matches = heading => heading && indexKey(heading.node.textContent) === indexKey(destination.term);
  const indexed = headings[destination.headingIndex];
  const heading = matches(indexed) ? indexed : headings.find(matches);
  if (heading) return { from: heading.from, to: heading.to };
  // Curated entries can name ordinary text rather than a heading. If the term
  // isn't present, the page reference still opens at the top.
  return findMatches(doc, destination.term || '')[0] || null;
}
