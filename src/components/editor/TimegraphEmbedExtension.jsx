import React from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { CalendarRange, Maximize2, Pencil, Trash2, X } from 'lucide-react';
import TimegraphCanvas from '@/components/timegraph/TimegraphCanvas';
import TimegraphEditor from '@/components/timegraph/TimegraphEditor';
import { useTimegraph } from '@/lib/timegraph/timegraphStore';
import { createViewport, viewportForRange } from '@/lib/timegraph/timegraphScale';
import { eventsBounds, requiredHeight } from '@/lib/timegraph/timegraphLayout';

/**
 * A Timegraph embedded in a document.
 *
 * The node stores nothing but `timegraphId`. That reference is what makes the
 * graph a reusable object: the events live in one record, so editing it from any
 * embed — or from another note entirely — updates all of them, and deleting the
 * embed only removes the reference. The document keeps no copy that could drift.
 *
 * Because every rich-text surface in the app shares one RichTextEditor, adding
 * this node reaches markdown notes, Knowledge Web cards, keywords and study notes
 * at once.
 */

const PREVIEW_MIN_HEIGHT = 260;

function TimegraphEmbedView({ node, deleteNode, editor, selected }) {
  const { timegraphId } = node.attrs;
  const { timegraph, status, error } = useTimegraph(timegraphId);
  const [expanded, setExpanded] = React.useState(false);
  const hostRef = React.useRef(null);
  const [width, setWidth] = React.useState(760);
  const [height, setHeight] = React.useState(PREVIEW_MIN_HEIGHT);
  const editable = editor?.isEditable !== false;

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.max(320, Math.round(entry.contentRect.width));
      setWidth((current) => (current === next ? current : next));
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  // The preview frames the whole chronology, which is the useful default for
  // something read inline rather than panned around.
  const viewport = React.useMemo(() => {
    const bounds = timegraph ? eventsBounds(timegraph.events) : null;
    if (!bounds) {
      return createViewport({
        centerYear: new Date().getFullYear(),
        yearsPerPixel: 0.5,
        width,
        height,
      });
    }
    return viewportForRange(bounds.from, bounds.to, { width, height });
  }, [timegraph, width, height]);

  return (
    <NodeViewWrapper>
      <div
        className={`bex-timegraph-embed ${selected ? 'is-selected' : ''}`}
        contentEditable={false}
        data-timegraph-id={timegraphId}
        data-testid="timegraph-embed"
      >
        <div className="bex-timegraph-embed__bar">
          <span className="flex items-center gap-1.5 min-w-0">
            <CalendarRange className="w-3.5 h-3.5 shrink-0" style={{ color: 'rgb(var(--brand-strong))' }} />
            <span className="bex-timegraph-embed__title">
              {timegraph?.title || (status === 'error' ? 'Timegraph unavailable' : 'Loading…')}
            </span>
            {timegraph && (
              <span style={{ color: 'rgb(var(--ink-faint))' }}>
                · {timegraph.events.length} event{timegraph.events.length === 1 ? '' : 's'}
              </span>
            )}
          </span>
          <span className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              className="bex-tg-button"
              onClick={() => setExpanded(true)}
              title={editable ? 'Edit this timegraph' : 'Open full size'}
              data-testid="timegraph-embed-edit"
            >
              {editable ? <Pencil className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
              {editable ? 'Edit' : 'Open'}
            </button>
            {editable && (
              <button
                type="button"
                className="bex-tg-button"
                onClick={deleteNode}
                // Worth being explicit: this is the one place a user might expect
                // removal to destroy the graph, and it must not.
                title="Remove this embed (the timegraph itself is kept)"
                data-testid="timegraph-embed-remove"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </span>
        </div>

        <div ref={hostRef}>
          {status === 'error' ? (
            <div className="bex-timegraph-embed__missing" data-testid="timegraph-embed-missing">
              {error?.message || 'This timegraph could not be found. It may have been deleted.'}
            </div>
          ) : timegraph ? (
            <TimegraphCanvas
              timegraph={timegraph}
              viewport={viewport}
              interactive={false}
              showCursorGuide={false}
              onHeightNeeded={(needed) => setHeight(Math.max(PREVIEW_MIN_HEIGHT, needed))}
            />
          ) : (
            <div className="bex-timegraph-embed__missing">Loading timegraph…</div>
          )}
        </div>
      </div>

      {expanded && (
        <div
          className="fixed inset-0 z-[150] flex flex-col"
          style={{ background: 'rgb(var(--app))' }}
          data-testid="timegraph-embed-modal"
        >
          <div
            className="flex items-center justify-between px-4 py-2"
            style={{ borderBottom: '1px solid rgb(var(--line))' }}
          >
            <span className="text-sm font-semibold" style={{ color: 'rgb(var(--ink))' }}>
              {timegraph?.title || 'Timegraph'}
            </span>
            <button
              type="button"
              className="bex-tg-button"
              onClick={() => setExpanded(false)}
              data-testid="timegraph-embed-modal-close"
            >
              <X className="w-3 h-3" /> Done
            </button>
          </div>
          <div className="flex-1 min-h-0">
            <TimegraphEditor
              timegraphId={timegraphId}
              onClose={() => setExpanded(false)}
              className="h-full"
            />
          </div>
        </div>
      )}
    </NodeViewWrapper>
  );
}

export const TimegraphEmbed = Node.create({
  name: 'timegraphEmbed',
  group: 'block',
  atom: true,
  // Selectable and draggable so it behaves like any other block in the document.
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      timegraphId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-timegraph-id'),
        renderHTML: (attributes) => (
          attributes.timegraphId ? { 'data-timegraph-id': attributes.timegraphId } : {}
        ),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-timegraph-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    // Only the reference is written into the document HTML — never the events.
    return ['div', mergeAttributes(HTMLAttributes, { class: 'bex-timegraph-embed' })];
  },

  addCommands() {
    return {
      insertTimegraph: (timegraphId) => ({ commands }) => {
        if (!timegraphId) return false;
        return commands.insertContent({
          type: this.name,
          attrs: { timegraphId: String(timegraphId) },
        });
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(TimegraphEmbedView);
  },
});

export default TimegraphEmbed;
export { requiredHeight };
