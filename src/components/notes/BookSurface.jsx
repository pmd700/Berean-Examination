import React from 'react';
import { motion } from 'framer-motion';
import RichTextEditor from '../editor/RichTextEditor';
import { bookIndexMatch } from './bookIndexModel';
import { startEditorRangeSpotlight } from '../editor/spotlightJourney';
import PageFoot from './PageFoot';
import PageSnapshot from './PageSnapshot';
import {
  MAX_PAGES,
  footnoteOffsets,
  getPageBody,
  insertPageAfter,
  replacePageBody,
} from './bookModel';

/** The turn itself: long enough to read as paper, short enough to write through. */
export const TURN_MS = 760;

/** A glossary jump should feel quick even when it crosses a long book. */
export const MULTI_TURN_SHEET_MS = 560;
export const MULTI_TURN_STAGGER_MS = 82;

const TURN_EASE = [0.32, 0, 0.16, 1];
const MAX_MULTI_TURN_SHEETS = 8;

function sampledForwardPages(from, to) {
  const distance = to - from;
  const count = Math.min(distance, MAX_MULTI_TURN_SHEETS);
  if (count <= 1) return [from];
  return Array.from({ length: count }, (_, index) => (
    from + Math.round((index * (distance - 1)) / (count - 1))
  ));
}

/**
 * The page you are writing on, and the turn between pages.
 *
 * Only one page is ever mounted in an editor, which is what keeps a fifty-page
 * book as cheap to edit as a one-page note: page two's editor does not exist
 * until you turn to it.
 *
 * The turn is done with a still sheet rather than a second editor. Forward, the
 * page you were on lifts off its spine and rotates away, revealing the live new
 * page already underneath. Backward, the page you are returning to drops back
 * onto the stack, and the live editor only switches once it has landed — so the
 * sheet always turns over the page it was actually covering.
 */
const BookSurface = React.forwardRef(function BookSurface({
  noteId,
  pages,
  pageIndex,
  onPagesChange,
  onPageIndexChange,
  onEditorReady,
  indexNavigation = null,
  onIndexNavigationComplete,
  spotlightQuery = '',
  spotlightToken = '',
  onSpotlightComplete,
  spotlightPage = null,
  onTurnStateChange,
}, forwardedRef) {
  // { direction, sheets, duration } — still sheets in motion, never editors.
  const [turn, setTurn] = React.useState(null);
  const [minHeight, setMinHeight] = React.useState(null);
  // Held with the page it belongs to. A turn destroys one editor and builds the
  // next, and for a commit in between the old instance is still in this state —
  // stamping it means the foot can never render against a destroyed editor.
  const [pageEditor, setPageEditor] = React.useState(null);

  const liveRef = React.useRef(null);
  const sheetRef = React.useRef(null);
  const surfaceRef = React.useRef(null);
  const turnTimer = React.useRef(null);

  const safeIndex = Math.max(0, Math.min(pageIndex, pages.length - 1));
  const offsets = React.useMemo(() => footnoteOffsets(pages), [pages]);
  const isLastPage = safeIndex === pages.length - 1;
  const canAddPage = pages.length < MAX_PAGES;

  React.useEffect(() => { onTurnStateChange?.(Boolean(turn)); }, [turn, onTurnStateChange]);

  React.useEffect(() => () => {
    if (turnTimer.current) window.clearTimeout(turnTimer.current);
  }, []);

  const endTurn = React.useCallback((after, duration = TURN_MS) => {
    turnTimer.current = window.setTimeout(() => {
      turnTimer.current = null;
      after?.();
      setTurn(null);
      setMinHeight(null);
    }, duration);
  }, []);

  /**
   * Take the reader to the top of the sheet they just turned to. They pressed
   * the cut line at the foot of the last one, so leaving them at the bottom of a
   * fresh page would start the next page at its end.
   */
  const scrollToPageTop = React.useCallback(() => {
    window.requestAnimationFrame(() => {
      surfaceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  const startTurn = React.useCallback(({ direction, sheets, duration = TURN_MS, applyNow, applyAfter, scroll = true }) => {
    if (turnTimer.current) return; // A turn already in flight owns the sheet.
    const measured = liveRef.current?.getBoundingClientRect().height || 0;
    if (measured > 0) setMinHeight(measured);
    setTurn({ direction, sheets, duration });
    applyNow?.();
    if (scroll) scrollToPageTop();
    endTurn(applyAfter, duration);
  }, [endTurn, scrollToPageTop]);

  const goToPage = React.useCallback((nextIndex) => {
    const target = Math.max(0, Math.min(nextIndex, pages.length - 1));
    if (target === safeIndex || turnTimer.current) return;

    if (target > safeIndex) {
      // Forward: the sheet leaving is the one we were reading.
      startTurn({
        direction: 1,
        sheets: [{ html: pages[safeIndex] ?? '', offset: offsets[safeIndex] || 0, pageNumber: safeIndex + 1 }],
        applyNow: () => onPageIndexChange(target),
      });
    } else {
      // Backward: the sheet arriving is the one we are going to, and the live
      // page stays put beneath it until it has landed.
      startTurn({
        direction: -1,
        sheets: [{ html: pages[target] ?? '', offset: offsets[target] || 0, pageNumber: target + 1 }],
        applyAfter: () => onPageIndexChange(target),
      });
    }
  }, [offsets, onPageIndexChange, pages, safeIndex, startTurn]);

  /**
   * Leap through a book without teleporting.
   *
   * The destination editor mounts immediately underneath a short stack of
   * snapshots sampled from the crossed pages. Each sheet leaves a fraction
   * after the last, so a forty-page jump still reads as many pages turning but
   * never makes the reader wait through forty full animations.
   */
  const jumpToPage = React.useCallback((nextIndex) => {
    const target = Math.max(0, Math.min(nextIndex, pages.length - 1));
    if (target === safeIndex || turnTimer.current) return;
    if (target < safeIndex || target - safeIndex === 1) { goToPage(target); return; }

    const indices = sampledForwardPages(safeIndex, target);
    const sheets = indices.map(index => ({
      html: pages[index] ?? '',
      offset: offsets[index] || 0,
      pageNumber: index + 1,
    }));
    const duration = MULTI_TURN_SHEET_MS + ((sheets.length - 1) * MULTI_TURN_STAGGER_MS);
    startTurn({
      direction: 1,
      sheets,
      duration,
      applyNow: () => onPageIndexChange(target),
      // The glossary sits above this surface and closes during the jump. Its
      // owner scrolls the whole document canvas; scrolling this moving target
      // too would compound both motions and overshoot below the page.
      scroll: false,
    });
  }, [goToPage, offsets, onPageIndexChange, pages, safeIndex, startTurn]);

  // If another result arrives mid-turn, finish this sheet and then take the
  // newest destination. Never lose the request or search an obsolete page.
  React.useEffect(() => {
    if (Number.isInteger(spotlightPage) && !turn && spotlightPage !== safeIndex) jumpToPage(spotlightPage);
  }, [jumpToPage, safeIndex, spotlightPage, turn]);

  const handleCutLine = React.useCallback(() => {
    if (!isLastPage) { goToPage(safeIndex + 1); return; }
    if (!canAddPage || turnTimer.current) return;
    const { pages: nextPages, index } = insertPageAfter(pages, safeIndex);
    startTurn({
      direction: 1,
      sheets: [{ html: pages[safeIndex] ?? '', offset: offsets[safeIndex] || 0, pageNumber: safeIndex + 1 }],
      applyNow: () => onPagesChange(nextPages, index),
    });
  }, [canAddPage, goToPage, isLastPage, offsets, onPagesChange, pages, safeIndex, startTurn]);

  React.useImperativeHandle(forwardedRef, () => ({
    goToPage(nextIndex, options = {}) {
      if (options.multi) jumpToPage(nextIndex);
      else goToPage(nextIndex);
    },
    // The toolbar's final forward arrow performs the same page-turn/add action
    // as the dotted cut line at the foot of the sheet.
    advancePage() {
      handleCutLine();
    },
  }), [goToPage, handleCutLine, jumpToPage]);

  const handlePageChange = React.useCallback((html) => {
    const next = replacePageBody(pages, safeIndex, html);
    if (next === pages) return;
    onPagesChange(next, safeIndex);
  }, [onPagesChange, pages, safeIndex]);

  const editorKey = `${noteId}:${safeIndex}`;
  const activeEditor = pageEditor?.key === editorKey ? pageEditor.editor : null;

  React.useEffect(() => {
    if (!indexNavigation || indexNavigation.page !== safeIndex || turn || !activeEditor || activeEditor.isDestroyed) return undefined;
    let disposed = false;
    const trip = startEditorRangeSpotlight(activeEditor, doc => bookIndexMatch(doc, indexNavigation), { highlight: false });
    trip.finished.finally(() => { if (!disposed) onIndexNavigationComplete?.(indexNavigation.token); });
    return () => { disposed = true; trip.cancel(); };
  }, [activeEditor, indexNavigation, onIndexNavigationComplete, safeIndex, turn]);

  const handleEditorReady = React.useCallback((editor) => {
    setPageEditor({ key: editorKey, editor });
    onEditorReady?.(editor);
  }, [editorKey, onEditorReady]);

  // Tell the page how many footnotes come before it. Without this the prose on
  // page three would count 1, 2, 3 while the notes printed at its foot read 12,
  // 13, 14 — the numbering has to be pushed in, because the editor can only see
  // its own page.
  const pageOffset = offsets[safeIndex] || 0;
  React.useEffect(() => {
    activeEditor?.commands.setFootnoteOffset(pageOffset);
  }, [activeEditor, pageOffset]);

  // A returning sheet can be taller than the page it covers; give the column
  // room for it so the turn does not clip.
  React.useLayoutEffect(() => {
    if (!turn) return;
    const sheetHeight = sheetRef.current?.getBoundingClientRect().height || 0;
    if (sheetHeight > 0) setMinHeight(current => Math.max(current || 0, sheetHeight));
  }, [turn]);

  const forward = turn?.direction === 1;

  return (
    <div
      ref={surfaceRef}
      className="relative scroll-mt-4"
      style={{ perspective: 2400, minHeight: minHeight ?? undefined }}
      data-testid="book-surface"
    >
      <div ref={liveRef}>
        <RichTextEditor
          key={editorKey}
          content={getPageBody(pages[safeIndex])}
          onChange={handlePageChange}
          onEditorReady={handleEditorReady}
          placeholder=""
          bare
          scrollPastEnd
          localFindShortcut
          noteAnnotations
          spotlightQuery={turn ? '' : spotlightQuery}
          spotlightToken={spotlightToken}
          onSpotlightComplete={onSpotlightComplete}
          pageFoot={(
            <PageFoot
              editor={activeEditor}
              offset={pageOffset}
              isLastPage={isLastPage}
              canAddPage={canAddPage}
              onCutLine={handleCutLine}
            />
          )}
        />
      </div>

      {turn && (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-30"
          data-testid="book-page-turn"
          data-multi-page={turn.sheets.length > 1 ? 'true' : 'false'}
        >
          {turn.sheets.map((sheet, index) => {
            const multi = turn.sheets.length > 1;
            const sheetDuration = multi ? MULTI_TURN_SHEET_MS : TURN_MS;
            const delay = multi ? (index * MULTI_TURN_STAGGER_MS) / 1000 : 0;
            return (
              <motion.div
                key={`${sheet.pageNumber}:${index}`}
                ref={index === 0 ? sheetRef : null}
                className="absolute inset-x-0 top-0 overflow-hidden rounded-sm bg-[#0f111a]"
                style={{
                  transformOrigin: 'left center',
                  transformStyle: 'preserve-3d',
                  backfaceVisibility: 'hidden',
                  zIndex: 30 + turn.sheets.length - index,
                }}
                initial={{ rotateY: forward ? 0 : -168, boxShadow: '0 0 0 rgba(0,0,0,0)' }}
                animate={{
                  rotateY: forward ? -168 : 0,
                  boxShadow: [
                    '0 0 0 rgba(0,0,0,0)',
                    '28px 0 60px rgba(0,0,0,0.55)',
                    '0 0 0 rgba(0,0,0,0)',
                  ],
                }}
                transition={{ duration: sheetDuration / 1000, delay, ease: TURN_EASE }}
                data-testid="book-turn-sheet"
                data-page-number={sheet.pageNumber}
              >
                <PageSnapshot html={sheet.html} offset={sheet.offset} />
                {/* Paper catches the light as it lifts; the shading is what
                    stops each sheet reading as a flat rectangle spinning. */}
                <motion.span
                  className="pointer-events-none absolute inset-0 rounded-sm"
                  style={{ background: 'linear-gradient(to right, rgba(0,0,0,0.58), rgba(255,255,255,0.025) 42%, rgba(0,0,0,0))' }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0, 0.9, 0.18] }}
                  transition={{ duration: sheetDuration / 1000, delay, ease: TURN_EASE }}
                />
                {multi && (
                  <span className="absolute bottom-5 right-5 rounded-full border border-white/10 bg-black/30 px-2 py-1 text-[10px] font-semibold tabular-nums text-white/45">
                    {String(sheet.pageNumber).padStart(2, '0')}
                  </span>
                )}
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
});

BookSurface.displayName = 'BookSurface';

export default BookSurface;
