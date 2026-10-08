import React from 'react';
import { buildBookIndex, indexKey, indexRanges, parseIndexPages } from './bookIndexModel';

const empty = { term: '', parent: '', pages: '', primary: '', seeAlso: '' };
const fieldClass = 'w-full rounded-none border-b border-gray-600 bg-transparent px-0 py-1.5 text-sm text-gray-200 outline-none focus:border-gray-200';

export default function BookIndex({ open, pages, onGoToPage, entries = [], onEntriesChange }) {
  const [query, setQuery] = React.useState('');
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(empty);
  const [editId, setEditId] = React.useState(null);
  const [error, setError] = React.useState('');
  const roots = React.useMemo(() => buildBookIndex(pages, entries), [pages, entries]);
  if (!open) return null;
  const matches = entry => indexKey(entry.term).includes(indexKey(query)) || entry.seeAlso.some(term => indexKey(term).includes(indexKey(query)));
  const visible = roots.filter(entry => matches(entry) || entry.children.some(matches));
  const groups = new Map();
  visible.forEach(entry => {
    const letter = /^[a-z]/i.test(entry.term) ? entry.term[0].toUpperCase() : '#';
    if (!groups.has(letter)) groups.set(letter, []);
    groups.get(letter).push(entry);
  });
  const reset = () => { setDraft(empty); setEditId(null); setError(''); };
  const save = event => {
    event.preventDefault();
    try {
      const term = draft.term.trim();
      const parent = draft.parent.trim();
      if (!term) throw new Error('Enter a topic.');
      if (indexKey(term) === indexKey(parent)) throw new Error('A subentry must differ from its main entry.');
      const refs = parseIndexPages(draft.pages, pages.length);
      const primary = parseIndexPages(draft.primary, pages.length);
      if (primary.some(page => !refs.includes(page))) throw new Error('Primary pages must also appear in the page references.');
      const seeAlso = draft.seeAlso.split(';').map(term => term.trim()).filter(Boolean);
      if (!refs.length && !seeAlso.length) throw new Error('Add a page reference or a see also entry.');
      const targets = new Set(roots.map(entry => indexKey(entry.term)));
      if (seeAlso.some(target => !targets.has(indexKey(target)))) throw new Error('See also must name an existing main entry.');
      const entry = { id: editId || crypto.randomUUID(), term, parent, refs, primary, seeAlso };
      onEntriesChange?.(editId ? entries.map(old => old.id === editId ? entry : old) : [...entries, entry]);
      reset();
    } catch (err) { setError(err.message); }
  };
  const navigate = (entry, pageNumber, visited = new Set()) => {
    if (visited.has(entry.key)) return;
    visited.add(entry.key);
    const page = pageNumber || entry.primary[0] || entry.refs[0];
    if (page) {
      const destination = entry.destinations.find(item => item.page === page - 1)
        || { kind: 'term', term: entry.term };
      onGoToPage?.(page - 1, destination);
    } else if (entry.children?.length) navigate(entry.children[0], undefined, visited);
    else {
      const related = roots.find(root => entry.seeAlso.some(term => indexKey(term) === indexKey(root.term)));
      if (related) navigate(related, undefined, visited);
    }
  };
  const references = entry => (
    <span className="ml-auto shrink-0 pl-3 text-right tabular-nums">
      {indexRanges(entry.refs, entry.primary).map((range, i) => (
        <React.Fragment key={range.start}>
          {i > 0 && ', '}
          <button type="button" onClick={() => navigate(entry, range.start)}
            className={`focus-visible:outline focus-visible:outline-1 ${range.bold ? 'font-bold text-gray-100' : ''}`}
            aria-label={`Go to page ${range.start}, ${entry.term}`}>
            {range.start}{range.end > range.start ? `–${range.end}` : ''}
          </button>
        </React.Fragment>
      ))}
    </span>
  );
  const row = (entry, child = false) => (
    <div key={entry.key} className={child ? 'ml-5 mt-1' : ''}>
      <div className="flex items-baseline">
        <button type="button" className="min-w-0 break-words text-left focus-visible:outline focus-visible:outline-1" onClick={() => navigate(entry)} aria-label={`Go to ${entry.term}`}>{entry.term}</button>
        {references(entry)}
      </div>
      {entry.seeAlso.length > 0 && <div className="mt-0.5 pl-3 text-gray-400">
        <em>See also </em>{entry.seeAlso.map((target, i) => (
          <React.Fragment key={target}>{i > 0 && '; '}
            {roots.some(root => indexKey(root.term) === indexKey(target))
              ? <button type="button" className="underline decoration-gray-600 underline-offset-2 hover:text-white" onClick={() => setQuery(target)}>{target}</button>
              : <span>{target} (entry unavailable)</span>}
          </React.Fragment>
        ))}
      </div>}
    </div>
  );
  return (
    <section className="mt-10 border-y border-gray-600/60 py-6" data-testid="book-index" aria-label="Book index">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-serif text-2xl tracking-wide text-gray-100">Index</h2>
        {onEntriesChange && <button type="button" className="text-xs text-gray-400 underline underline-offset-4 hover:text-white" onClick={() => { setEditing(!editing); reset(); }} aria-expanded={editing}>{editing ? 'Done' : 'Edit index'}</button>}
      </div>
      <p className="mt-2 max-w-xl text-xs leading-relaxed text-gray-400">Entries are alphabetical. Select an entry or page number to go to its location; ranges open at the first page. Bold numbers mark the main discussion.</p>
      <div className="mt-4 flex items-center gap-3">
        <input aria-label="Search index" placeholder="Find a topic…" value={query} onChange={event => setQuery(event.target.value)} className={`${fieldClass} max-w-xs`} />
        {query && <button type="button" className="text-xs text-gray-400 hover:text-white" onClick={() => setQuery('')}>Clear</button>}
      </div>
      {editing && <div className="my-6 border-y border-gray-700 py-4">
        <p className="mb-3 text-xs text-gray-400">Page titles and headings update automatically. Add specific topics below; page references follow reordered pages.</p>
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
          {[['term', 'Topic'], ['parent', 'Main entry (optional)'], ['pages', `Pages (1–${pages.length})`], ['primary', 'Primary pages (optional)'], ['seeAlso', 'See also (separate entries with ;)']].map(([name, label]) => (
            <label key={name} className="text-xs text-gray-400">{label}<input className={fieldClass} value={draft[name]} onChange={event => setDraft({ ...draft, [name]: event.target.value })} placeholder={name === 'pages' ? '2, 4–6' : ''} /></label>
          ))}
          <div className="flex items-end gap-3"><button type="submit" className="border border-gray-500 px-3 py-1.5 text-sm text-gray-100 hover:bg-white/5">{editId ? 'Save entry' : 'Add entry'}</button>{editId && <button type="button" className="text-xs text-gray-400" onClick={reset}>Cancel</button>}</div>
          {error && <p role="alert" className="text-sm text-amber-300 sm:col-span-2">{error}</p>}
        </form>
        {entries.length > 0 && <ul className="mt-4 space-y-2 text-sm text-gray-300">{entries.map(entry => <li key={entry.id} className="flex flex-wrap items-baseline gap-3">
          <span className="mr-auto">{entry.parent ? `${entry.parent} — ` : ''}{entry.term}{!entry.refs.length && !entry.seeAlso.length ? ' (needs a page reference)' : ''}</span>
          <button type="button" className="text-xs underline" onClick={() => { setEditId(entry.id); setDraft({ term: entry.term, parent: entry.parent, pages: entry.refs.join(', '), primary: entry.primary.join(', '), seeAlso: entry.seeAlso.join('; ') }); setError(''); }}>Edit<span className="sr-only"> {entry.term}</span></button>
          <button type="button" className="text-xs text-gray-400 underline" onClick={() => { onEntriesChange(entries.filter(old => old.id !== entry.id)); if (editId === entry.id) reset(); }}>Remove<span className="sr-only"> {entry.term}</span></button>
        </li>)}</ul>}
      </div>}
      <div className="mt-6 gap-x-10 font-serif text-[15px] leading-6 text-gray-300" style={{ columnWidth: '15rem' }}>
        {[...groups].map(([letter, group]) => <div key={letter} className="mb-6 break-inside-avoid">
          <h3 className="mb-2 font-serif text-lg font-bold text-gray-100">{letter}</h3>
          {group.map(entry => <div key={entry.key} className="mb-3 break-inside-avoid">{row(entry)}{entry.children.map(child => row(child, true))}</div>)}
        </div>)}
      </div>
      {!visible.length && <p className="my-6 font-serif text-sm text-gray-400">No matching index entries.</p>}
    </section>
  );
}
