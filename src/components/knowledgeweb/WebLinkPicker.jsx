import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Network, Lock, Search, X } from 'lucide-react';

// Modal that appears after the user clicks the canvas in "web link" mode.
// Shows the user's other knowledge webs (the active web is excluded — you
// shouldn't be able to make a node that loops back to the page it's on)
// and lets them pick one to embed as a node-network link. Includes a
// search filter because power users can have dozens of webs.
export default function WebLinkPicker({ webs, activeWebId, onPick, onCancel }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Esc cancels — the canvas-level Esc handler also resets mode, but this
  // local listener fires first while the modal is open and stops the
  // event from bubbling so we don't double-handle it.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel?.();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (webs || [])
      .filter((w) => w.id !== activeWebId)
      .filter((w) => {
        if (!q) return true;
        const t = (w.title || '').toLowerCase();
        return t.includes(q);
      })
      .sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  }, [webs, activeWebId, query]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
      data-testid="modal-weblink-picker"
    >
      <div
        className="relative w-[420px] max-h-[80vh] bg-[#0F1318] border border-line rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-elevated">
          <div className="flex items-center gap-2">
            <Network className="w-4 h-4 text-sky-300" />
            <h3 className="text-sm font-semibold text-white">Link a knowledge web</h3>
          </div>
          <button
            onClick={onCancel}
            className="text-gray-500 hover:text-gray-300"
            data-testid="button-weblink-picker-close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-3 py-2 border-b border-elevated">
          <div className="flex items-center gap-2 bg-elevated rounded-lg px-2.5 py-1.5">
            <Search className="w-3.5 h-3.5 text-gray-500" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search webs…"
              className="bg-transparent flex-1 text-sm text-white placeholder-gray-500 outline-none"
              data-testid="input-weblink-picker-search"
            />
          </div>
        </div>

        <div className="overflow-y-auto flex-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-500">
              {webs && webs.length <= 1
                ? 'You only have this web — create another to link to it.'
                : 'No webs match your search.'}
            </div>
          ) : (
            <ul className="py-1">
              {filtered.map((w) => (
                <li key={w.id}>
                  <button
                    onClick={() => onPick(w)}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-left hover:bg-elevated transition-colors group"
                    data-testid={`button-weblink-pick-${w.id}`}
                  >
                    {w.is_private ? (
                      <Lock className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" />
                    ) : (
                      <Network className="w-3.5 h-3.5 text-sky-300 flex-shrink-0" />
                    )}
                    <span className="text-sm text-gray-200 group-hover:text-white truncate">
                      {w.title || 'Untitled'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="px-4 py-2 border-t border-elevated text-[11px] text-gray-500">
          Press <kbd className="px-1 py-0.5 bg-elevated rounded">Esc</kbd> to cancel
        </div>
      </div>
    </div>
  );
}
