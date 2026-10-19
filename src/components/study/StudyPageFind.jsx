import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { useIsActiveTab } from '@/lib/WorkspaceTabs';
import { PAGE_FIND_SHORTCUT_REQUEST } from '@/lib/localFindShortcut';

const SKIP = 'button, input, textarea, select, script, style, svg, [data-study-ui], [data-page-find], [aria-hidden="true"], [hidden]';
const BLOCK = 'p, h1, h2, h3, h4, h5, h6, li, td, th, pre, summary, [data-scripture-verse]';

/** Ranges paint matches without changing Scripture, editor DOM, or selection. */
export function findStudyPageRanges(root, query) {
  if (!root || !query) return [];
  const groups = new Map();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!node.textContent || parent.closest(SKIP)) continue;
    let visible = true;
    for (let element = parent; element && element !== root; element = element.parentElement) {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden'
        || (element.tagName === 'DETAILS' && !element.hasAttribute('open') && !element.querySelector('summary')?.contains(parent))) { visible = false; break; }
    }
    if (!visible) continue;
    const block = parent.closest(BLOCK) || parent;
    if (!groups.has(block)) groups.set(block, []);
    groups.get(block).push(node);
  }
  const matches = [], pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  for (const nodes of groups.values()) {
    const text = nodes.map(node => node.textContent).join('');
    for (const match of text.matchAll(pattern)) {
      const at = match.index, length = match[0].length;
      const range = document.createRange();
      let offset = 0, started = false;
      for (const node of nodes) {
        const end = offset + node.textContent.length;
        if (!started && at < end) { range.setStart(node, at - offset); started = true; }
        if (started && at + length <= end) { range.setEnd(node, at + length - offset); break; }
        offset = end;
      }
      matches.push(range);
    }
  }
  return matches;
}

export default function StudyPageFind({ rootRef }) {
  const active = useIsActiveTab();
  const [open, setOpen] = useState(false), [query, setQuery] = useState('');
  const [matches, setMatches] = useState([]), [index, setIndex] = useState(0);
  const input = useRef(null), previousFocus = useRef(null);
  const close = () => { setOpen(false); if (previousFocus.current?.isConnected) previousFocus.current.focus(); };
  useEffect(() => {
    if (!active) { setOpen(false); return; }
    const request = event => {
      event.preventDefault();
      if (event.detail?.close) { setOpen(false); return; }
      setOpen(value => {
        if (!value) previousFocus.current = document.activeElement;
        else if (previousFocus.current?.isConnected) previousFocus.current.focus();
        return !value;
      });
    };
    window.addEventListener(PAGE_FIND_SHORTCUT_REQUEST, request);
    return () => window.removeEventListener(PAGE_FIND_SHORTCUT_REQUEST, request);
  }, [active]);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open || !active) return;
    const root = rootRef.current;
    const refresh = () => { setMatches(findStudyPageRanges(root, query)); setIndex(0); };
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(root, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'open', 'aria-hidden'] });
    return () => observer.disconnect();
  }, [open, active, query, rootRef]);
  useEffect(() => {
    if (!open || !active) return;
    // Our DOM typings predate the registry's map methods; Electron supports them.
    const highlights = /** @type {Map<string, Highlight> | undefined} */ (/** @type {unknown} */ (globalThis.CSS?.highlights));
    if (highlights && globalThis.Highlight) {
      highlights.set('bex-study-find', new Highlight(...matches));
      highlights.set('bex-study-find-current', new Highlight(...(matches[index] ? [matches[index]] : [])));
    }
    const target = matches[index]?.startContainer.parentElement;
    if (target) {
      const viewport = target.closest('.bex-scripture-viewport');
      if (viewport) viewport.dispatchEvent(new CustomEvent('scripture-workspace-center', { detail: { target } }));
      else target.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    }
    return () => { highlights?.delete('bex-study-find'); highlights?.delete('bex-study-find-current'); };
  }, [matches, index, open, active]);
  if (!open || !active) return null;
  const step = delta => setIndex(value => matches.length ? (value + delta + matches.length) % matches.length : 0);
  return createPortal(<div role="search" aria-label="Find in Chapter Study" data-page-find
    className="fixed right-4 top-24 z-[100001] flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-ink shadow-xl">
    <style>{'::highlight(bex-study-find) { background: #eab30866; color: inherit; } ::highlight(bex-study-find-current) { background: #f97316cc; color: #fff; }'}</style>
    <Search size={16} aria-hidden="true" />
    <input ref={input} aria-label="Find in this chapter study" placeholder="Find in this chapter study" value={query}
      className="min-w-0 bg-transparent text-sm outline-none" onChange={event => setQuery(event.target.value)}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } else if (event.key === 'Enter') { event.preventDefault(); step(event.shiftKey ? -1 : 1); } }} />
    <span role="status" className="whitespace-nowrap text-xs tabular-nums">{query ? `${matches.length ? index + 1 : 0}/${matches.length}` : ''}</span>
    <button type="button" aria-label="Previous match" title="Previous (Shift+Enter)" disabled={!matches.length} onClick={() => step(-1)}><ChevronUp size={16} /></button>
    <button type="button" aria-label="Next match" title="Next (Enter)" disabled={!matches.length} onClick={() => step(1)}><ChevronDown size={16} /></button>
    <button type="button" aria-label="Close page search" title="Close (Esc)" onClick={close}><X size={16} /></button>
  </div>, document.body);
}
