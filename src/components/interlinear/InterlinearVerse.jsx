import React, { useMemo } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const HEBREW_REGEX = /[\u0590-\u05FF]/;
// Hebrew combining vowel points (niqqud) + cantillation marks (te'amim).
// Stripping these yields a normalized consonantal surface. The displayed
// surface form always keeps them; only the "Normalized" field removes them.
const NIQQUD_TAAMIM = /[\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4-\u05C7]/g;

function normalizeHebrew(surface) {
  return surface.replace(NIQQUD_TAAMIM, '');
}

function FieldRow({ label, value, muted, rtl }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-ink-soft">{label}</span>
      <span
        dir={rtl ? 'rtl' : 'ltr'}
        className={muted ? 'italic text-ink-faint' : 'font-medium text-gray-100'}
      >
        {value}
      </span>
    </div>
  );
}

// A single clickable Hebrew word token. Clicking opens a popover that shows the
// surface + normalized form and explicitly marks lemma / gloss / morphology /
// Strong's as not available yet (no data is invented).
function HebrewWordToken({ surface }) {
  const normalized = useMemo(() => normalizeHebrew(surface), [surface]);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-block rounded px-1 py-0.5 transition-colors hover:bg-brand/25 focus:outline-none focus:ring-1 focus:ring-brand"
          data-testid="token-hebrew-word"
        >
          {surface}
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-64 border-line bg-surface text-gray-100">
        <div
          dir="rtl"
          className="mb-2 text-right text-2xl"
          style={{ fontFamily: 'var(--interlinear-hebrew-font, Georgia, serif)' }}
          data-testid="text-token-surface"
        >
          {surface}
        </div>
        <div className="space-y-1.5">
          <FieldRow label="Surface" value={surface} rtl />
          <FieldRow label="Normalized" value={normalized || '—'} rtl />
          <div className="my-1 border-t border-line" />
          <FieldRow label="Lemma" value="Not available yet" muted />
          <FieldRow label="Gloss" value="Not available yet" muted />
          <FieldRow label="Morphology" value="Not available yet" muted />
          <FieldRow label="Strong's" value="Not available yet" muted />
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function InterlinearVerse({ verseText, greekText, isRtl = false, individualWords = false }) {
  const content = verseText || greekText;

  const tokens = useMemo(() => {
    if (!content || !individualWords) return null;
    return content.split(/\s+/).filter(Boolean);
  }, [content, individualWords]);

  if (!content) return null;

  const hasHebrew = HEBREW_REGEX.test(content);
  const rtl = isRtl || hasHebrew;
  const hebrewFont = 'var(--interlinear-hebrew-font, Georgia, serif)';
  const greekFont = 'var(--interlinear-greek-font, Georgia, serif)';

  return (
    <div className="ml-[3.25rem] mt-3 mb-2 rounded-2xl border border-gray-200/80 dark:border-gray-800 bg-white/70 dark:bg-gray-900/40 px-4 py-3.5 sm:px-5 sm:py-4">
      {individualWords && rtl ? (
        <div
          dir="rtl"
          lang="he"
          className="flex flex-wrap gap-x-1 gap-y-1.5 text-right text-lg leading-[2.2] tracking-[0.01em] text-gray-700 dark:text-gray-200 sm:text-xl"
          style={{ fontFamily: hebrewFont }}
          data-testid="interlinear-words"
        >
          {tokens.map((tok, i) =>
            tok === '׀' ? (
              <span key={i} className="select-none px-1 text-ink-faint">׀</span>
            ) : (
              <HebrewWordToken key={i} surface={tok} />
            )
          )}
        </div>
      ) : (
        <p
          dir={rtl ? 'rtl' : 'ltr'}
          lang={rtl ? 'he' : 'el'}
          style={{ fontFamily: rtl ? hebrewFont : greekFont }}
          className={`text-gray-700 dark:text-gray-200 ${rtl ? 'text-right text-lg sm:text-xl leading-[2.15] tracking-[0.01em]' : 'text-left text-base sm:text-[1.05rem] leading-8'}`}
        >
          {content}
        </p>
      )}
    </div>
  );
}
