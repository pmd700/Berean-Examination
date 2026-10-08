import React from 'react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { useCitations } from './CitationContext';
import { describeRef } from './citationTokens';

function domainFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// Inline citation bubble. `refs` is an array of raw reference ids.
export default function CitationBubble({ refs }) {
  const registry = useCitations();
  const list = Array.isArray(refs) ? refs.filter(Boolean) : [];
  if (list.length === 0) return null;

  const getNumber = registry ? registry.getNumber.bind(registry) : (() => null);
  const sourcesById = registry?.sourcesById || {};

  const entries = list.map((ref) => {
    const num = getNumber(ref);
    const meta = sourcesById[ref] || null;
    const fallback = describeRef(ref);
    const url = meta?.url || null;
    return {
      ref,
      num,
      title: meta?.title || fallback.label,
      domain: meta?.domain || (url ? domainFromUrl(url) : null),
      url,
      snippet: meta?.snippet || null,
    };
  });

  const single = entries.length === 1;
  const label = single ? `${entries[0].num}` : `${entries.length} sources`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="berean-cite-pill"
          data-testid={`citation-bubble-${entries.map((e) => e.ref).join('-')}`}
          aria-label={single ? `Citation ${label}` : `${entries.length} sources`}
        >
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="berean-cite-popover w-72 p-2">
        <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1.5 px-1">
          {entries.length === 1 ? 'Source' : `${entries.length} sources`}
        </div>
        <ul className="space-y-1">
          {entries.map((e) => {
            const Inner = (
              <>
                <span className="berean-cite-num">{e.num}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-[var(--text-primary)]">
                    {e.title}
                  </span>
                  <span className="block truncate text-[11px] text-[var(--text-muted)]">
                    {e.domain || e.ref}
                  </span>
                  {e.snippet ? (
                    <span className="mt-0.5 block text-[11px] leading-snug text-[var(--text-muted)] line-clamp-2">
                      {e.snippet}
                    </span>
                  ) : null}
                </span>
              </>
            );
            return (
              <li key={e.ref}>
                {e.url ? (
                  <a
                    href={e.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="berean-cite-row hover:bg-[var(--bg-elevated)]"
                    data-testid={`citation-source-${e.ref}`}
                  >
                    {Inner}
                  </a>
                ) : (
                  <div
                    className="berean-cite-row"
                    data-testid={`citation-source-${e.ref}`}
                  >
                    {Inner}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
