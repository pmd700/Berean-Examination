import React from 'react';
import { motion } from 'framer-motion';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import LogicRichHtml from '../logic/LogicRichHtml';
import { collectFootnotes, FOOTNOTE_JUMP_EVENT } from '../editor/FootnoteExtension';
import {
  lineBoxesForElement,
  SWEEP_FADE_MS,
  SWEEP_HOLD_MS,
  sweepTimings,
} from '../editor/footnoteSweep';

/** How long to let a smooth scroll settle before the highlight starts. */
const SCROLL_SETTLE_MS = 420;
const SCROLL_SETTLE_CEILING_MS = 1100;

/**
 * The foot of a page: its footnotes, then the cut line that ends it.
 *
 * Everything here is derived from the page's own document. The footnotes are
 * read out of the editor rather than stored beside it, so deleting a reference
 * in the prose removes its note, and reordering the prose reorders the notes.
 */
export default function PageFoot({
  editor,
  offset = 0,
  isLastPage,
  canAddPage = true,
  onCutLine,
}) {
  const [version, setVersion] = React.useState(0);
  const [sweepId, setSweepId] = React.useState(null);
  const listRef = React.useRef(null);

  React.useEffect(() => {
    if (!editor) return undefined;
    const bump = () => setVersion(value => value + 1);
    editor.on('transaction', bump);
    return () => { editor.off('transaction', bump); };
  }, [editor]);

  const footnotes = React.useMemo(
    // `version` stands in for the mutable document: every transaction bumps it,
    // which is what makes the printed notes follow the prose.
    () => (editor ? collectFootnotes(editor.state.doc, offset) : []),
    [editor, offset, version],
  );

  // Pressing a reference in the prose brings the reader down here. The scroll is
  // deliberately smooth rather than a jump, and the highlight waits for it to
  // settle so the sweep is watched rather than missed on the way past.
  React.useEffect(() => {
    if (!editor) return undefined;
    const dom = editor.view.dom;
    let settleTimer = null;
    let ceilingTimer = null;
    let onScrollEnd = null;

    const onJump = (event) => {
      const id = event.detail?.id;
      const entry = id
        ? listRef.current?.querySelector(`[data-footnote-id="${CSS.escape(id)}"]`)
        : null;
      if (!entry) return;

      setSweepId(null);
      entry.scrollIntoView({ behavior: 'smooth', block: 'center' });

      const start = () => {
        if (settleTimer) { window.clearTimeout(settleTimer); settleTimer = null; }
        if (ceilingTimer) { window.clearTimeout(ceilingTimer); ceilingTimer = null; }
        if (onScrollEnd) {
          document.removeEventListener('scrollend', onScrollEnd, true);
          onScrollEnd = null;
        }
        setSweepId(id);
      };

      if ('onscrollend' in window) {
        onScrollEnd = start;
        document.addEventListener('scrollend', onScrollEnd, true);
        // A scroll that never moves (the note is already in view) fires no
        // scrollend at all, so the sweep still needs a floor and a ceiling.
        settleTimer = window.setTimeout(start, SCROLL_SETTLE_MS);
        ceilingTimer = window.setTimeout(start, SCROLL_SETTLE_CEILING_MS);
      } else {
        settleTimer = window.setTimeout(start, SCROLL_SETTLE_MS);
      }
    };

    dom.addEventListener(FOOTNOTE_JUMP_EVENT, onJump);
    return () => {
      dom.removeEventListener(FOOTNOTE_JUMP_EVENT, onJump);
      if (settleTimer) window.clearTimeout(settleTimer);
      if (ceilingTimer) window.clearTimeout(ceilingTimer);
      if (onScrollEnd) document.removeEventListener('scrollend', onScrollEnd, true);
    };
  }, [editor]);

  const endSweep = React.useCallback(() => setSweepId(null), []);

  const cutLineDisabled = isLastPage && !canAddPage;
  const cutLineLabel = cutLineDisabled
    ? 'End of page'
    : (isLastPage
      ? 'End of page — click to add the next one'
      : 'End of page — click to turn to the next one');

  return (
    <div className="mt-10 select-none" data-testid="page-foot">
      {footnotes.length > 0 && (
        <ol ref={listRef} className="mb-5 space-y-2 border-t border-line/50 pt-4" data-testid="footnote-list">
          {footnotes.map(footnote => (
            <FootnoteEntry
              key={footnote.id}
              footnote={footnote}
              sweeping={sweepId === footnote.id}
              onSweepDone={endSweep}
              onEdit={() => editor?.commands.editFootnote(footnote.id)}
              onDelete={() => { editor?.commands.removeFootnote(footnote.id); editor?.commands.focus(); }}
            />
          ))}
        </ol>
      )}

      {/* The cut line: where this page stops. Pressing it turns the page. */}
      <button
        type="button"
        onClick={onCutLine}
        disabled={cutLineDisabled}
        aria-label={cutLineLabel}
        title={cutLineLabel}
        className={`group/cut relative block w-full py-5 ${cutLineDisabled ? 'cursor-default' : 'cursor-pointer'}`}
        data-testid="page-cut-line"
      >
        <span
          className={`block h-0 border-t-2 border-dotted border-[#3A4256] opacity-60 transition-[opacity,border-color] duration-200 ${
            cutLineDisabled ? '' : 'group-hover/cut:border-violet-400/70 group-hover/cut:opacity-100'
          }`}
        />
        {!cutLineDisabled && (
          <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#0f111a] px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-soft opacity-0 transition-opacity duration-200 group-hover/cut:opacity-100">
            {isLastPage ? (
              <span className="inline-flex items-center gap-1"><Plus className="h-3 w-3" /> New page</span>
            ) : 'Next page'}
          </span>
        )}
      </button>
    </div>
  );
}

/**
 * One footnote, and the landing highlight that sweeps across it.
 *
 * The bars are measured from the rendered text rather than the element box, so
 * a note wrapping over four lines lights up line by line and a short last line
 * is not padded out to the full width. The sweep quickens as it goes, holds,
 * then fades — and covers only this note, so it always stops before the next.
 */
function FootnoteEntry({ footnote, sweeping, onSweepDone, onEdit, onDelete }) {
  const bodyRef = React.useRef(null);
  const [bars, setBars] = React.useState([]);
  const [fading, setFading] = React.useState(false);

  // The list above re-renders on every editor transaction — every keystroke,
  // every selection move — so anything this effect depends on has to be stable
  // or the sweep restarts from zero over and over and is never seen. Only
  // `sweeping` may start it; the callback is read through a ref.
  const onSweepDoneRef = React.useRef(onSweepDone);
  React.useEffect(() => { onSweepDoneRef.current = onSweepDone; });

  React.useEffect(() => {
    if (!sweeping) { setBars([]); setFading(false); return undefined; }

    const boxes = lineBoxesForElement(bodyRef.current);
    if (boxes.length === 0) { onSweepDoneRef.current?.(); return undefined; }

    const timings = sweepTimings(boxes.length);
    setBars(boxes.map((box, index) => ({ ...box, ...timings[index] })));
    setFading(false);

    const last = timings[timings.length - 1];
    const revealEnd = last.delayMs + last.durationMs;
    const fadeAt = window.setTimeout(() => setFading(true), revealEnd + SWEEP_HOLD_MS);
    const doneAt = window.setTimeout(() => {
      setBars([]);
      setFading(false);
      onSweepDoneRef.current?.();
    }, revealEnd + SWEEP_HOLD_MS + SWEEP_FADE_MS);

    // Re-measuring mid-sweep would leave bars over the wrong words, so a resize
    // simply retires the highlight rather than showing it in the wrong place.
    const onResize = () => { setBars([]); setFading(false); onSweepDoneRef.current?.(); };
    window.addEventListener('resize', onResize);

    return () => {
      window.clearTimeout(fadeAt);
      window.clearTimeout(doneAt);
      window.removeEventListener('resize', onResize);
    };
  }, [sweeping]);

  return (
    <li
      className="group/footnote flex gap-2 scroll-mt-24"
      data-testid={`footnote-entry-${footnote.number}`}
      data-footnote-id={footnote.id}
    >
      <span className="mt-[1px] shrink-0 text-[11px] font-bold leading-[1.5] text-violet-300/90 tabular-nums">
        {footnote.number}.
      </span>

      <div className="relative min-w-0 flex-1">
        {bars.length > 0 && (
          <motion.div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            animate={{ opacity: fading ? 0 : 1 }}
            transition={{ duration: SWEEP_FADE_MS / 1000, ease: 'easeOut' }}
          >
            {bars.map((bar, index) => (
              <motion.span
                key={`${footnote.id}-bar-${index}`}
                className="absolute rounded-[2px] bg-violet-400/25"
                style={{ top: bar.top, left: bar.left, height: bar.height }}
                initial={{ width: 0 }}
                animate={{ width: bar.width }}
                transition={{
                  delay: bar.delayMs / 1000,
                  duration: bar.durationMs / 1000,
                  ease: 'easeOut',
                }}
              />
            ))}
          </motion.div>
        )}

        <div
          ref={bodyRef}
          className="bex-annotation-body relative text-[12.5px] leading-[1.5] text-ink-soft"
        >
          <LogicRichHtml content={footnote.text || '<p></p>'} />
        </div>
      </div>

      <span className="flex shrink-0 items-start gap-0.5 opacity-0 transition-opacity group-hover/footnote:opacity-100">
        <button
          type="button"
          onClick={onEdit}
          className="grid h-6 w-6 place-items-center rounded text-ink-soft transition-colors hover:bg-white/[0.07] hover:text-white"
          title="Edit footnote"
          data-testid={`button-footnote-edit-${footnote.number}`}
        >
          <Pencil className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="grid h-6 w-6 place-items-center rounded text-ink-soft transition-colors hover:bg-red-900/25 hover:text-red-400"
          title="Delete footnote"
          data-testid={`button-footnote-delete-${footnote.number}`}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </span>
    </li>
  );
}
