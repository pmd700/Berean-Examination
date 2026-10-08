import React, { useMemo } from 'react';
import LibraryLinkBoundary from '@/components/navigation/LibraryLinkBoundary';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import './markdown-report.css';
import { CitationProvider } from './CitationContext';
import CitationBubble from './CitationBubble';
import MermaidBlock from './MermaidBlock';
import CodeBlock from './CodeBlock';
import { preprocessCitations, parseRefList } from './citationTokens';
import { preprocessLogicMarkdown } from '@/lib/logic/logic-markdown';
import LogicRenderer from '@/components/logic/LogicRenderer';

// Sanitizer schema: GitHub-safe defaults plus the small set of things our
// renderer needs (citation sentinel spans, link target/rel, code language
// classes, table cell alignment).
const schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames || []), 'span', 'bex-logic'],
  attributes: {
    ...defaultSchema.attributes,
    span: [...((defaultSchema.attributes && defaultSchema.attributes.span) || []), 'className'],
    code: [...((defaultSchema.attributes && defaultSchema.attributes.code) || []), 'className'],
    a: [...((defaultSchema.attributes && defaultSchema.attributes.a) || []), 'target', 'rel'],
    th: [...((defaultSchema.attributes && defaultSchema.attributes.th) || []), 'style', 'align'],
    td: [...((defaultSchema.attributes && defaultSchema.attributes.td) || []), 'style', 'align'],
    'bex-logic': ['format', 'display'],
  },
};

const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeRaw, [rehypeSanitize, schema]];

// Flatten a hast node's text content (used for fenced code extraction).
function hastText(node) {
  if (!node) return '';
  if (node.type === 'text') return node.value || '';
  if (Array.isArray(node.children)) return node.children.map(hastText).join('');
  return '';
}

// Flatten React children to a plain string (used for table-cell heuristics).
function reactText(children) {
  if (children == null) return '';
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(reactText).join('');
  if (React.isValidElement(children)) return reactText(children.props?.children);
  return '';
}

const TIER_RE = /^[SABCDF][+-]?$/;
const NUM_RE = /^-?\$?\d[\d,.]*%?$/;

function classNameToString(cn) {
  if (!cn) return '';
  return Array.isArray(cn) ? cn.join(' ') : String(cn);
}

const components = {
  'bex-logic': ({ children, display, format }) => {
    let source = reactText(children);
    try { source = decodeURIComponent(source); } catch { /* preserve visible encoded source */ }
    return (
      <LogicRenderer
        display={display === 'inline' ? 'inline' : 'block'}
        sourceFormat={format === 'latex' ? 'latex' : 'unicode'}
      >
        {source}
      </LogicRenderer>
    );
  },
  a: ({ node, href, children, ...props }) => (
    <a
      className="berean-md-link"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    >
      {children}
    </a>
  ),

  // Citation sentinel: <span class="berean-cite">ref1,ref2</span>
  span: ({ node, className, children, ...props }) => {
    const cls = classNameToString(className);
    if (cls.split(/\s+/).includes('berean-cite')) {
      const refs = parseRefList(reactText(children));
      return <CitationBubble refs={refs} />;
    }
    return (
      <span className={className} {...props}>
        {children}
      </span>
    );
  },

  // Block-level fenced code: render Mermaid or a code block. We read from the
  // hast node so we get the raw source + language reliably.
  pre: ({ node }) => {
    const codeNode =
      (node?.children || []).find((c) => c.tagName === 'code') || (node?.children || [])[0];
    const className = classNameToString(codeNode?.properties?.className);
    const lang = (/language-([\w-]+)/.exec(className) || [])[1] || '';
    const raw = hastText(codeNode);
    if (lang === 'mermaid') return <MermaidBlock code={raw} />;
    return <CodeBlock code={raw} language={lang} />;
  },

  // Inline code only (block code is handled by `pre`).
  code: ({ node, className, children, ...props }) => (
    <code className="berean-inline-code" {...props}>
      {children}
    </code>
  ),

  table: ({ node, children, ...props }) => (
    <div className="berean-md-table-wrap">
      <table className="berean-md-table" {...props}>
        {children}
      </table>
    </div>
  ),

  td: ({ node, children, style, ...props }) => {
    const text = reactText(children).trim();
    if (TIER_RE.test(text)) {
      const tier = text[0].toUpperCase();
      return (
        <td style={style} {...props}>
          <span className={`berean-tier-badge berean-tier-${tier}`}>{text}</span>
        </td>
      );
    }
    const isNum = text !== '' && NUM_RE.test(text);
    return (
      <td className={isNum ? 'berean-td-num' : undefined} style={style} {...props}>
        {children}
      </td>
    );
  },
};

export default function AdvancedMarkdown({ content, sourcesById }) {
  const processed = useMemo(
    () => preprocessLogicMarkdown(preprocessCitations(content || '')),
    [content],
  );
  return (
    <LibraryLinkBoundary>
      <CitationProvider sourcesById={sourcesById}>
        <div className="berean-md">
          <ReactMarkdown
            remarkPlugins={remarkPlugins}
            rehypePlugins={rehypePlugins}
            components={components}
          >
            {processed}
          </ReactMarkdown>
        </div>
      </CitationProvider>
    </LibraryLinkBoundary>
  );
}
