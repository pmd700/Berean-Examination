import React from 'react';
import LogicRichHtml from '../logic/LogicRichHtml';
import {
  extractFootnotes,
  getPageBody,
  markTooltipsInHtml,
  numberFootnotesInHtml,
} from './bookModel';

/**
 * A page rendered as a still sheet, with no editor behind it.
 *
 * Used wherever a page has to be *seen* rather than written: the sheet turning
 * over during a page turn, and the cards in the overview. Standing up a second
 * ProseMirror for either would be expensive and pointless, but the still has to
 * match the real page — and the two things the editor draws itself, footnote
 * numbers and tooltip badges, are exactly the two things missing from saved
 * markup. Both are put back here, or a page would shed its markers the moment
 * it began to turn.
 */
export default function PageSnapshot({ html, offset = 0, className = '', showFoot = true }) {
  const body = React.useMemo(() => getPageBody(html), [html]);
  const rendered = React.useMemo(
    () => markTooltipsInHtml(numberFootnotesInHtml(body, offset)),
    [body, offset],
  );
  const footnotes = React.useMemo(() => extractFootnotes(body, offset), [body, offset]);

  return (
    <div className={className} aria-hidden="true">
      <div className="prose prose-invert max-w-none bex-page-snapshot">
        <LogicRichHtml content={rendered || '<p></p>'} />
      </div>

      {showFoot && (
        <div className="mt-10">
          {footnotes.length > 0 && (
            <ol className="mb-5 space-y-2 border-t border-line/50 pt-4">
              {footnotes.map(footnote => (
                <li key={footnote.id} className="flex gap-2">
                  <span className="mt-[1px] shrink-0 text-[11px] font-bold leading-[1.5] text-violet-300/90 tabular-nums">
                    {footnote.number}.
                  </span>
                  <div className="bex-annotation-body min-w-0 flex-1 text-[12.5px] leading-[1.5] text-ink-soft">
                    <LogicRichHtml content={footnote.text || '<p></p>'} />
                  </div>
                </li>
              ))}
            </ol>
          )}
          <div className="py-5">
            <span className="block h-0 border-t-2 border-dotted border-[#3A4256] opacity-60" />
          </div>
        </div>
      )}
    </div>
  );
}
