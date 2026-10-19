import React from 'react';
import { ExternalLink } from 'lucide-react';

export default function VerseBibleHubButton({ href, verseNumber, className = '' }) {
  const badgeClassName = `verse-number-badge relative inline-flex items-center justify-center whitespace-nowrap leading-none ${className}`;

  if (!href) {
    return <span className={badgeClassName} data-verse-number>{verseNumber}</span>;
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`${badgeClassName} group/verse w-8 hover:w-12 shrink-0 overflow-hidden px-0 transition-[width,color] duration-200 hover:text-ink-faint dark:hover:text-brand-strong`}
      data-verse-number
      title={`Open Bible Hub commentary for verse ${verseNumber}`}
      aria-label={`Open Bible Hub commentary for verse ${verseNumber}`}
    >
      <span className="absolute left-1/2 w-max whitespace-nowrap leading-none -translate-x-1/2 transition-transform duration-200 group-hover/verse:-translate-x-[0.55rem]" data-verse-number-label>{verseNumber}</span>
      <ExternalLink strokeWidth={1.5} className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-2.5 w-2.5 opacity-0 transition-opacity duration-200 group-hover/verse:opacity-100" />
    </a>
  );
}
