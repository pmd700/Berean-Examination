import React from 'react';
import { tagKey } from '@/lib/timegraph/timegraphModel';

const parseTags = text => [...new Map(text.split(',').map(tag => tag.trim()).filter(Boolean).map(tag => [tagKey(tag), tag])).values()];

export default function TimegraphTagInput({ value, availableTags = [], onChange }) {
  const [draft, setDraft] = React.useState(() => value.join(', '));
  const [cursor, setCursor] = React.useState(draft.length);
  const [focused, setFocused] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const input = React.useRef(null);
  const listId = React.useId();
  const serialized = JSON.stringify(value);
  const committed = React.useRef(serialized);
  React.useEffect(() => {
    if (committed.current === serialized) return;
    committed.current = serialized;
    setDraft(value.join(', '));
    setDismissed(true);
  }, [serialized, value]);

  const start = draft.lastIndexOf(',', Math.max(0, cursor - 1)) + 1;
  const nextComma = draft.indexOf(',', cursor);
  const end = nextComma < 0 ? draft.length : nextComma;
  const term = tagKey(draft.slice(start, end));
  const otherTags = new Set(parseTags(draft.slice(0, start) + draft.slice(end)).map(tagKey));
  const suggestions = [...new Map(availableTags.map(tag => [tagKey(tag), tag])).values()]
    .filter(tag => term && tagKey(tag).startsWith(term) && !otherTags.has(tagKey(tag)))
    .sort((a, b) => a.localeCompare(b)).slice(0, 8);
  const showing = focused && !dismissed && suggestions.length > 0;
  const selected = Math.min(active, suggestions.length - 1);

  const commit = text => {
    const tags = parseTags(text);
    const next = JSON.stringify(tags);
    if (next !== committed.current) {
      committed.current = next;
      onChange(tags);
    }
    return tags.join(', ');
  };
  const choose = tag => {
    const text = draft.slice(0, start) + (start ? ' ' : '') + tag + draft.slice(end);
    const normalized = commit(text);
    setDraft(normalized);
    setCursor(normalized.length);
    input.current?.focus();
    setDismissed(true);
  };

  return <div className="relative">
    <label className="bex-tg-label" htmlFor="tg-tags">Tags</label>
    <input ref={input} id="tg-tags" className="bex-tg-input" value={draft}
      placeholder="comma, separated" data-testid="timegraph-tags" autoComplete="off"
      role="combobox" aria-autocomplete="list" aria-expanded={!!showing}
      aria-controls={showing ? listId : undefined}
      aria-activedescendant={showing ? `${listId}-${selected}` : undefined}
      onFocus={() => { setFocused(true); setDismissed(false); }}
      onBlur={() => { setFocused(false); setDraft(commit(draft)); }}
      onSelect={event => setCursor(event.currentTarget.selectionStart ?? draft.length)}
      onChange={event => { setDraft(event.target.value); setCursor(event.target.selectionStart ?? event.target.value.length); setActive(0); setDismissed(false); }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (showing && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
          event.preventDefault(); event.stopPropagation();
          setActive((selected + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length);
        } else if (event.key === 'Enter') {
          event.preventDefault(); event.stopPropagation();
          if (showing) choose(suggestions[selected]);
          else { setDraft(commit(draft)); setDismissed(true); }
        } else if (event.key === 'Escape' && showing) {
          event.preventDefault(); event.stopPropagation(); setDismissed(true);
        }
      }} />
    {showing && <ul id={listId} role="listbox" aria-label="Existing tags"
      className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded border border-gray-600 py-1 shadow-lg"
      style={{ background: 'rgb(var(--surface))' }}>
      {suggestions.map((tag, i) => <li key={tagKey(tag)} id={`${listId}-${i}`} role="option" aria-selected={i === selected}
        className={`cursor-pointer px-3 py-2 text-sm ${i === selected ? 'bg-violet-500/25 text-white' : 'text-gray-300'}`}
        onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => choose(tag)}>{tag}</li>)}
    </ul>}
  </div>;
}
