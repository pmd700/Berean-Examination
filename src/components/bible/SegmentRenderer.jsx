import React, { useMemo } from 'react';
import { Edit2, PenLine } from 'lucide-react';
import { buildSegmentLayout } from '@shared/bibleSegments';
import FootnotePopover from './FootnotePopover';

/**
 * Renders ONE verse's body from its ordered rich-text segments.
 *
 * The token stream produced by `buildSegmentLayout` is byte-for-byte identical
 * to the highlight/annotation system's `plainText.split(/(\s+)/)`, so every
 * rendered token carries the same `tokenIdx` the stored highlights/annotations
 * key off. Footnote markers are rendered BETWEEN tokens and contribute zero
 * token indices, so toggling textual notes never shifts a single highlight.
 */
export default function SegmentRenderer({
  verse,
  segments,
  book,
  chapter,
  showNotes = true,
  debug = false,
  helpers,
}) {
  const {
    getHighlightForToken,
    getAnnotationsForToken,
    getAnnotationForToken,
    annotationDrawings,
    buildTokenStyle,
    showAnnotationPreview,
    hideAnnotationPreview,
    onAnnotationIconClick,
  } = helpers;

  const layout = useMemo(() => buildSegmentLayout(segments || []), [segments]);
  const { tokens, tokenStartOffsets, tokenRuns, markersByOffset, breakOffsets } = layout;

  // Bucket the zero-width footnote markers: a leading list (offset 0) and a
  // per-token list for everything else (rendered immediately AFTER that token).
  const { leadingMarkers, markersAfter } = useMemo(() => {
    const after = tokens.map(() => []);
    const leading = markersByOffset.get(0) ? [...markersByOffset.get(0)] : [];
    for (const [offset, segs] of markersByOffset) {
      if (offset === 0) continue;
      let placed = false;
      for (let i = 0; i < tokens.length; i++) {
        const start = tokenStartOffsets[i];
        const end = start + tokens[i].length;
        if (offset > start && offset <= end) {
          after[i].push(...segs);
          placed = true;
          break;
        }
      }
      if (!placed && tokens.length > 0) after[tokens.length - 1].push(...segs);
    }
    return { leadingMarkers: leading, markersAfter: after };
  }, [tokens, tokenStartOffsets, markersByOffset]);

  const renderMarker = (seg, key) => (
    <FootnotePopover
      key={key}
      segment={seg}
      book={book}
      chapter={chapter}
      verse={verse}
      debug={debug}
    />
  );

  const renderRuns = (runs, tokenIdx) =>
    runs.map((run, ri) => {
      const classes = [];
      if (run.italic) classes.push('italic');
      if (run.smallCaps) classes.push('bible-smallcaps');
      if (classes.length === 0) {
        return <React.Fragment key={`r-${tokenIdx}-${ri}`}>{run.text}</React.Fragment>;
      }
      return (
        <span key={`r-${tokenIdx}-${ri}`} className={classes.join(' ')}>
          {run.text}
        </span>
      );
    });

  return (
    <>
      {showNotes && leadingMarkers.map((seg, k) => renderMarker(seg, `lead-${k}`))}

      {tokens.map((token, tokenIdx) => {
        if (!token) return null;

        const isWhitespace = /^\s+$/.test(token);
        const startsWithBreak = breakOffsets.has(tokenStartOffsets[tokenIdx]);
        const tokenAnns = getAnnotationsForToken(verse, tokenIdx);
        const highlight = getHighlightForToken(verse, tokenIdx);
        const after = showNotes ? markersAfter[tokenIdx] : [];

        if (isWhitespace) {
          return (
            <React.Fragment key={tokenIdx}>
              {startsWithBreak && <br />}
              <span
                style={buildTokenStyle(highlight, tokenAnns.length)}
                onMouseEnter={tokenAnns.length ? (e) => showAnnotationPreview(e, tokenAnns) : undefined}
                onMouseLeave={tokenAnns.length ? hideAnnotationPreview : undefined}
              >
                {token}
              </span>
              {after.map((seg, k) => renderMarker(seg, `mk-${tokenIdx}-${k}`))}
            </React.Fragment>
          );
        }

        const annotation = getAnnotationForToken(verse, tokenIdx);
        const hasDrawing = annotation && annotationDrawings[annotation.id];
        const isAnnotated = tokenAnns.length > 0;

        return (
          <React.Fragment key={tokenIdx}>
            <span className="relative inline">
              {annotation && (
                <span
                  className="absolute -left-2 top-0.5 cursor-pointer text-brand hover:text-[#5A3E87] dark:text-brand dark:hover:text-brand-strong z-10"
                  onClick={() => onAnnotationIconClick(annotation)}
                >
                  {hasDrawing ? <PenLine className="w-3 h-3" /> : <Edit2 className="w-3 h-3" />}
                </span>
              )}
              <span
                data-token-key={`token-${verse}-${tokenIdx}`}
                style={buildTokenStyle(highlight, tokenAnns.length)}
                onMouseEnter={isAnnotated ? (e) => showAnnotationPreview(e, tokenAnns) : undefined}
                onMouseLeave={isAnnotated ? hideAnnotationPreview : undefined}
              >
                {renderRuns(tokenRuns[tokenIdx], tokenIdx)}
              </span>
            </span>
            {after.map((seg, k) => renderMarker(seg, `mk-${tokenIdx}-${k}`))}
          </React.Fragment>
        );
      })}
    </>
  );
}
