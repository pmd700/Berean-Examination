import React, { useMemo } from 'react';
import LibraryLinkBoundary from '@/components/navigation/LibraryLinkBoundary';
import { renderLogicToHtml } from '@/lib/logic/logic-render';
import './logic-renderer.css';

/**
 * Typeset every logic expression inside a chunk of saved editor HTML.
 *
 * Logic is inline, so a formula can sit anywhere — mid-sentence, in a
 * list item, inside a toggle — which is why this walks the whole tree instead
 * of only the top level. Each `[data-bex-logic]` element (the current inline
 * span, or a `div` from notes written before logic went inline) is swapped for
 * its KaTeX rendering in place, leaving the surrounding markup untouched.
 */
function typesetLogic(content: string): string {
  if (typeof DOMParser === 'undefined') return content;

  const parsed = new DOMParser().parseFromString(content, 'text/html');
  parsed.querySelectorAll('[data-bex-logic]').forEach((element) => {
    // New formulas already contain editable, math-styled Unicode text. Keep
    // those nodes (including individual highlight/bold marks) in previews.
    if (element.getAttribute('data-logic-editable') === 'true') return;
    const source = element.getAttribute('data-logic-source') || element.textContent || '';
    const sourceFormat = element.getAttribute('data-logic-format') === 'latex' ? 'latex' : 'unicode';
    const rendered = renderLogicToHtml(source, { display: 'inline', sourceFormat });

    const host = parsed.createElement('span');
    host.className = `logic-renderer logic-renderer--inline${rendered.ok ? '' : ' logic-renderer--error'}`;
    host.setAttribute('aria-label', `Logic expression: ${source}`);
    host.setAttribute('data-logic-source', source);

    if (rendered.ok) {
      const surface = parsed.createElement('span');
      surface.className = 'logic-renderer__surface';
      surface.innerHTML = rendered.html;
      host.append(surface);
    } else {
      const fallback = parsed.createElement('code');
      fallback.className = 'logic-renderer__fallback';
      fallback.textContent = source;
      host.title = rendered.error || 'BEX could not typeset this expression.';
      host.append(fallback);
    }

    element.replaceWith(host);
  });

  return parsed.body.innerHTML;
}

export default function LogicRichHtml({ content }: { content: string }) {
  const html = useMemo(() => typesetLogic(content || ''), [content]);

  return (
    <LibraryLinkBoundary>
      <div
        style={{ display: 'contents' }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </LibraryLinkBoundary>
  );
}
