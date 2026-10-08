import React from 'react';
import { applyTypographyToMarkdown, applyTypographyToHtml } from '@/lib/typography';
import AdvancedMarkdown from '@/components/markdown/AdvancedMarkdown';
import LogicRichHtml from '@/components/logic/LogicRichHtml';

export default function MarkdownRenderer({ content, sourcesById, forceMarkdown = false }) {
  // If content is HTML (contains tags like <p>, <img>), render as HTML.
  // `forceMarkdown` guarantees the rich research-report pipeline (used for
  // AI-generated answers that may contain stray HTML-like characters).
  if (!forceMarkdown && content && /<(?:p|img|h[1-4]|details|div)\b/i.test(content)) {
    const transformedHtml = applyTypographyToHtml(content);
    return (
      <React.Fragment>
        <style>{`
          /* Same Preflight problem as the editor: without these a saved list
             renders indented but with no bullet or number. Keep the padding
             here too — Preflight zeroes it, and an outside marker with no
             padding sits outside the container and gets clipped. */
          .markdown-render ul, .markdown-render ol {
            padding-left: 1.5rem;
            margin: 0.5rem 0;
          }
          .markdown-render ol { list-style: decimal outside; }
          .markdown-render ol ol { list-style-type: lower-alpha; }
          .markdown-render ol ol ol { list-style-type: lower-roman; }
          /* One bullet at every depth, matching the editor. */
          .markdown-render ul,
          .markdown-render ul ul,
          .markdown-render ul ul ul,
          .markdown-render ul ul ul ul { list-style: disc outside; }
          .markdown-render li { margin: 0.25rem 0; }
          .markdown-render li > p { margin: 0; }
          .markdown-render .toggle-block {
            border-left: 2px solid #C46A2B;
            border-radius: 0 6px 6px 0;
            margin: 6px 0;
            background: rgba(196,106,43,0.04);
          }
          .dark .markdown-render .toggle-block {
            border-left-color: #D89160;
            background: rgba(196,106,43,0.06);
          }
          .markdown-render .toggle-block > summary {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 6px 10px;
            cursor: pointer;
            font-weight: 600;
            color: #2B1D12;
            list-style: none;
          }
          .dark .markdown-render .toggle-block > summary { color: #f3ede3; }
          .markdown-render .toggle-block > summary::-webkit-details-marker { display: none; }
          .markdown-render .toggle-block > summary::before {
            content: '▶';
            font-size: 9px;
            color: #C46A2B;
            flex-shrink: 0;
            transition: transform 0.18s ease;
            display: inline-block;
          }
          .dark .markdown-render .toggle-block > summary::before { color: #D89160; }
          .markdown-render .toggle-block[open] > summary::before { transform: rotate(90deg); }
          .markdown-render .toggle-block > div { padding: 4px 12px 6px 22px; }
          .markdown-render .toggle-block .toggle-block { margin-left: 4px; border-left-color: #A95622; }
        `}</style>
        <div className="prose prose-sm dark:prose-invert max-w-none [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-lg [&_img]:my-2 markdown-render">
          <LogicRichHtml content={transformedHtml} />
        </div>
      </React.Fragment>
    );
  }

  // Otherwise render as Markdown via the research-report pipeline (GFM,
  // Mermaid, citation bubbles, advanced tables, code blocks).
  return (
    <AdvancedMarkdown content={applyTypographyToMarkdown(content)} sourcesById={sourcesById} />
  );
}
