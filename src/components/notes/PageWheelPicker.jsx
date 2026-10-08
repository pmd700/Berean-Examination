import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronsUpDown } from 'lucide-react';
import { getPageTitle } from './bookModel';

const ROW_HEIGHT = 40;
const VISIBLE_ROWS = 5;
const SETTLE_MS = 150;

function clampPage(index, pageCount) {
  return Math.max(0, Math.min(Number(index) || 0, Math.max(0, pageCount - 1)));
}

/**
 * A compact, iOS-style page wheel anchored to the page counter.
 *
 * The wheel deliberately uses the browser's native scrolling surface so a
 * trackpad keeps its momentum. Mouse-wheel notches are translated into rows,
 * while CSS scroll snapping settles touch/scrollbar movement onto one page.
 */
export default function PageWheelPicker({ pages, pageIndex, onSelect }) {
  const [open, setOpen] = React.useState(false);
  const [selectedIndex, setSelectedIndex] = React.useState(pageIndex);
  const rootRef = React.useRef(null);
  const listRef = React.useRef(null);
  const settleTimerRef = React.useRef(null);
  const wheelResetRef = React.useRef(null);
  const wheelDistanceRef = React.useRef(0);
  const targetIndexRef = React.useRef(pageIndex);
  const committedIndexRef = React.useRef(pageIndex);

  const clearSettleTimer = React.useCallback(() => {
    if (!settleTimerRef.current) return;
    window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = null;
  }, []);

  const scheduleSelection = React.useCallback((index) => {
    clearSettleTimer();
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null;
      if (index === committedIndexRef.current) return;
      committedIndexRef.current = index;
      onSelect?.(index);
    }, SETTLE_MS);
  }, [clearSettleTimer, onSelect]);

  const scrollToIndex = React.useCallback((index, behavior = 'smooth', commit = true) => {
    const next = clampPage(index, pages.length);
    targetIndexRef.current = next;
    setSelectedIndex(next);
    const list = listRef.current;
    if (list) {
      const top = next * ROW_HEIGHT;
      if (typeof list.scrollTo === 'function') list.scrollTo({ top, behavior });
      else list.scrollTop = top;
    }
    if (commit) scheduleSelection(next);
  }, [pages.length, scheduleSelection]);

  React.useEffect(() => {
    committedIndexRef.current = pageIndex;
    if (!open) {
      targetIndexRef.current = pageIndex;
      setSelectedIndex(pageIndex);
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => {
      scrollToIndex(pageIndex, 'auto', false);
      listRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, pageIndex, scrollToIndex]);

  React.useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside, true);
    return () => document.removeEventListener('pointerdown', closeOutside, true);
  }, [open]);

  React.useEffect(() => {
    const list = listRef.current;
    if (!open || !list) return undefined;

    // A passive wheel listener cannot prevent the surrounding document from
    // scrolling. Register natively so every notch belongs to this little drum.
    const spin = (event) => {
      event.preventDefault();
      const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX)
        ? event.deltaY
        : event.deltaX;
      if (!delta) return;

      wheelDistanceRef.current += delta;
      if (wheelResetRef.current) window.clearTimeout(wheelResetRef.current);
      wheelResetRef.current = window.setTimeout(() => {
        wheelDistanceRef.current = 0;
        wheelResetRef.current = null;
      }, 120);

      // Small trackpad deltas accumulate; a conventional wheel notch advances
      // one row. A truly fast fling may cross up to three pages at once.
      if (Math.abs(wheelDistanceRef.current) < 28) return;
      const direction = Math.sign(wheelDistanceRef.current);
      const magnitude = Math.abs(wheelDistanceRef.current);
      const steps = magnitude >= 220 ? 3 : magnitude >= 140 ? 2 : 1;
      wheelDistanceRef.current = 0;
      scrollToIndex(targetIndexRef.current + (direction * steps));
    };

    list.addEventListener('wheel', spin, { passive: false });
    return () => list.removeEventListener('wheel', spin);
  }, [open, scrollToIndex]);

  React.useEffect(() => () => {
    clearSettleTimer();
    if (wheelResetRef.current) window.clearTimeout(wheelResetRef.current);
  }, [clearSettleTimer]);

  const handleScroll = (event) => {
    const next = clampPage(Math.round(event.currentTarget.scrollTop / ROW_HEIGHT), pages.length);
    if (next === targetIndexRef.current) return;
    targetIndexRef.current = next;
    setSelectedIndex(next);
    scheduleSelection(next);
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Escape' || event.key === 'Enter') {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      scrollToIndex(targetIndexRef.current - 1);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      scrollToIndex(targetIndexRef.current + 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      scrollToIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      scrollToIndex(pages.length - 1);
    }
  };

  return (
    <div ref={rootRef} className="relative" data-testid="page-wheel-control">
      <button
        type="button"
        onClick={() => setOpen(current => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`group inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs tabular-nums transition-colors ${
          open
            ? 'bg-violet-500/12 text-violet-200'
            : 'text-gray-500 hover:bg-white/[0.05] hover:text-gray-200'
        }`}
        title="Choose a page"
        data-testid="button-page-wheel"
      >
        <span data-testid="text-page-indicator">{pageIndex + 1} / {pages.length}</span>
        <ChevronsUpDown className="h-3 w-3 opacity-45 transition-opacity group-hover:opacity-80" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
            className="absolute right-0 top-full z-[260] mt-2 w-64 overflow-hidden rounded-2xl border border-violet-400/20 bg-[#0a0c14]/97 p-2 shadow-[0_24px_65px_-20px_rgba(0,0,0,0.95),0_0_35px_rgba(139,92,246,0.10)] backdrop-blur-xl"
            data-testid="page-wheel-picker"
          >
            <div className="flex items-center justify-between px-2 pb-1.5 pt-0.5">
              <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">Turn to</span>
              <span className="text-[10px] tabular-nums text-violet-300/80">
                Page {selectedIndex + 1} of {pages.length}
              </span>
            </div>

            <div className="relative overflow-hidden rounded-xl border border-white/[0.055] bg-black/20">
              <div
                className="pointer-events-none absolute inset-x-1 z-10 rounded-lg border border-violet-400/25 bg-violet-500/[0.08] shadow-[inset_0_0_18px_rgba(139,92,246,0.05)]"
                style={{ top: ROW_HEIGHT * 2, height: ROW_HEIGHT }}
              />
              <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-12 bg-gradient-to-b from-[#090b13] to-transparent" />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-12 bg-gradient-to-t from-[#090b13] to-transparent" />

              <div
                ref={listRef}
                role="listbox"
                aria-label="Choose a page"
                aria-activedescendant={`page-wheel-option-${selectedIndex + 1}`}
                tabIndex={0}
                onScroll={handleScroll}
                onKeyDown={handleKeyDown}
                className="relative z-[5] overflow-y-auto overscroll-contain outline-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                style={{
                  height: ROW_HEIGHT * VISIBLE_ROWS,
                  scrollSnapType: 'y mandatory',
                }}
                data-testid="page-wheel-list"
              >
                <div aria-hidden="true" style={{ height: ROW_HEIGHT * 2 }} />
                {pages.map((page, index) => {
                  const distance = Math.abs(index - selectedIndex);
                  const pageTitle = getPageTitle(page).trim() || 'Untitled Page';
                  return (
                    <button
                      key={index}
                      id={`page-wheel-option-${index + 1}`}
                      type="button"
                      role="option"
                      aria-selected={index === selectedIndex}
                      onClick={() => scrollToIndex(index)}
                      className={`flex w-full items-center gap-3 px-3 text-left transition-[color,opacity,transform] duration-150 ${
                        index === selectedIndex ? 'text-violet-100' : 'text-slate-400'
                      }`}
                      style={{
                        height: ROW_HEIGHT,
                        scrollSnapAlign: 'center',
                        scrollSnapStop: 'always',
                        opacity: distance === 0 ? 1 : distance === 1 ? 0.56 : 0.26,
                        transform: `scale(${distance === 0 ? 1 : distance === 1 ? 0.96 : 0.91})`,
                      }}
                      data-testid={`page-wheel-option-${index + 1}`}
                    >
                      <span className="w-6 shrink-0 text-right text-xs font-semibold tabular-nums">{index + 1}</span>
                      <span className="min-w-0 truncate text-[11px]">{pageTitle}</span>
                    </button>
                  );
                })}
                <div aria-hidden="true" style={{ height: ROW_HEIGHT * 2 }} />
              </div>
            </div>

            <div className="px-2 pb-0.5 pt-1.5 text-center text-[9px] text-slate-600">
              Scroll to spin · snaps to a page
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
