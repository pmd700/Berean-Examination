import React from 'react';
import { ExternalLink } from 'lucide-react';
import SegmentRenderer from './SegmentRenderer';

/**
 * Chapter-level paragraph-flow renderer for segment-based (rich) translations.
 *
 * Verses flow together into paragraphs (1:1 with the source), starting a new
 * paragraph whenever a verse is flagged `startsParagraph` or follows a section
 * heading. Verse numbers render as true superscript (clickable → Bible Hub).
 * The actual verse body — including italics, footnote markers and per-token
 * highlight/annotation handling — is delegated to <SegmentRenderer>.
 */
export default function RichChapterView({
  verses,
  book,
  chapter,
  showNotes = true,
  debug = false,
  paragraphClass = '',
  headerClass = '',
  buildVerseHref,
  helpers,
  renderInterlinear,
}) {
  const elements = [];
  let para = [];
  let paraKey = 0;

  const flushPara = () => {
    if (para.length === 0) return;
    elements.push(
      <p key={`para-${paraKey++}`} className={`bible-rich-para ${paragraphClass}`}>
        {para}
      </p>
    );
    para = [];
  };

  verses.forEach((v, idx) => {
    if (v.heading) {
      flushPara();
      elements.push(
        <h3 key={`head-${idx}`} className={`${headerClass} font-semibold text-ink-muted dark:text-ink-muted mb-4 mt-2`}>
          {v.heading}
        </h3>
      );
    } else if (v.startsParagraph && para.length > 0) {
      flushPara();
    }

    const href = buildVerseHref ? buildVerseHref(v.verse) : null;

    para.push(
      <span key={`verse-${v.verse}`} className="bible-rich-verse" data-verse-id={v.verse}>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="bible-verse-num group"
            aria-label={`Verse ${v.verse}, open Bible Hub commentary`}
            data-testid={`link-verse-${v.verse}`}
          >
            {v.verse}
            <ExternalLink strokeWidth={1.5} className="bible-verse-num-icon" />
          </a>
        ) : (
          <sup className="bible-verse-num" data-testid={`text-verse-${v.verse}`}>{v.verse}</sup>
        )}
        <SegmentRenderer
          verse={v.verse}
          segments={v.segments}
          book={book}
          chapter={chapter}
          showNotes={showNotes}
          debug={debug}
          helpers={helpers}
        />
        {' '}
      </span>
    );

    const interlinear = renderInterlinear ? renderInterlinear(v.verse) : null;
    if (interlinear) {
      flushPara();
      elements.push(
        <div key={`il-${v.verse}`} className="mb-4">
          {interlinear}
        </div>
      );
    }
  });

  flushPara();

  return <>{elements}</>;
}
