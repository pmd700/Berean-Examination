import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Search, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { searchCards, MATCH_KIND } from './searchCards';

export default function SearchBar({ cards, onJumpToCard }) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === 'Escape') { setQuery(''); inputRef.current?.blur(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const q = query.toLowerCase().trim();
  // Searches titles, tags, scripture refs and the card bodies themselves.
  const results = useMemo(() => searchCards(cards, q), [cards, q]);

  const showDropdown = focused && q.length > 0;

  const handleSelect = (card) => {
    onJumpToCard(card);
    setQuery('');
    inputRef.current?.blur();
  };

  return (
    <div className="relative">
      <div className={`flex items-center gap-1.5 h-7 px-2.5 rounded-lg border transition-colors ${
        focused
          ? 'bg-app border-brand w-56'
          : 'bg-elevated/60 border-line hover:border-line-strong w-44'
      }`}
        style={{ transition: 'width 0.2s ease, border-color 0.15s' }}
      >
        <Search className="w-3 h-3 text-ink-faint flex-shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder="Search cards…"
          className="flex-1 bg-transparent text-xs text-ink placeholder:text-ink-faint outline-none min-w-0"
          data-testid="input-search-cards"
        />
        {query && (
          <button
            onMouseDown={e => { e.preventDefault(); setQuery(''); }}
            className="text-ink-faint hover:text-ink-muted flex-shrink-0"
          >
            <X className="w-3 h-3" />
          </button>
        )}
        {!query && (
          <kbd className="text-[9px] text-line-strong px-1 py-0.5 rounded bg-app border border-line flex-shrink-0 hidden sm:inline">⌘F</kbd>
        )}
      </div>

      <AnimatePresence>
        {showDropdown && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute right-0 top-full mt-1 z-50 w-96 max-h-[22rem] overflow-y-auto bg-surface border border-line rounded-lg shadow-2xl"
          >
            {results.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-ink-faint">No cards found</div>
            ) : (
              results.map(({ card, kind, snippet, tag, reference }) => (
                <button
                  key={card.id}
                  onMouseDown={() => handleSelect(card)}
                  className="w-full text-left px-3 py-2 hover:bg-elevated flex items-start gap-2 transition-colors border-b border-elevated last:border-b-0"
                  data-testid={`result-card-${card.id}`}
                  data-match-kind={kind}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-ink truncate">{card.title || 'Untitled card'}</div>

                    {/* Show the line the term was found on, so a body match
                        isn't just an unexplained card title. */}
                    {kind === MATCH_KIND.CONTENT && snippet && (
                      <div className="mt-0.5 text-[10.5px] leading-snug text-ink-soft line-clamp-2">
                        {snippet.before}
                        <mark className="bg-violet-500/30 text-ink rounded-[2px] px-0.5">{snippet.match}</mark>
                        {snippet.after}
                      </div>
                    )}

                    {kind === MATCH_KIND.SCRIPTURE && reference && (
                      <div className="mt-0.5 text-[10.5px] text-ink-soft">
                        Scripture · <span className="text-gold">{reference}</span>
                      </div>
                    )}

                    {(kind === MATCH_KIND.TITLE || kind === MATCH_KIND.TAG) && (card.tags || []).length > 0 && (
                      <div className="text-[10px] text-ink-faint flex gap-1.5 mt-0.5">
                        {(card.tags || []).slice(0, 3).map(t => (
                          <span key={t} className={t === tag ? 'text-violet-300' : 'text-brand'}>#{t}</span>
                        ))}
                      </div>
                    )}
                  </div>

                  {kind === MATCH_KIND.CONTENT && (
                    <span className="shrink-0 mt-0.5 text-[9px] uppercase tracking-wider text-ink-faint">body</span>
                  )}
                </button>
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
