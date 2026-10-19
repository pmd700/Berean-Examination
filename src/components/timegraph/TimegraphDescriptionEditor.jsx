import React from 'react';
import { createPortal } from 'react-dom';
import SizeSwitch from '@/components/editor/TextEditorSizeSwitch';
import TEXT_EDITOR_MACHINERY from '@/components/editor/TEXT_EDITOR_MACHINERY';
import { markdownToNoteHtml } from '@/components/knowledgeweb/massKnowledgeImport';
import { useIsActiveTab } from '@/lib/WorkspaceTabs';

export function timelineDescriptionHtml(value) {
  const content = String(value || '');
  // Saved rich content goes through unchanged; legacy Markdown uses the same
  // conversion as imported Knowledge Web notes. Merely viewing doesn't save.
  return /<\/?(?:p|div|h[1-6]|ul|ol|li|blockquote|pre|table|details|img|hr|br|span|strong|em|a)\b[^>]*>/i.test(content)
    ? content : markdownToNoteHtml(content);
}

export default function TimegraphDescriptionEditor({ content, onChange }) {
  const html = React.useMemo(() => timelineDescriptionHtml(content), [content]);
  const [mode, setMode] = React.useState('compact');
  const active = useIsActiveTab();
  const fullscreen = mode === 'fullscreen' && active;
  const inline = React.useRef(null);
  const [surface] = React.useState(() => document.createElement('div'));
  React.useLayoutEffect(() => {
    // Move one stable portal host instead of remounting the editor. Body-level
    // fullscreen escapes scroll clipping and transformed embedded panels.
    const focused = surface.contains(document.activeElement) ? document.activeElement : null;
    const selection = window.getSelection();
    const range = selection?.rangeCount && surface.contains(selection.anchorNode) ? selection.getRangeAt(0).cloneRange() : null;
    (fullscreen ? document.body : inline.current)?.appendChild(surface);
    focused?.focus({ preventScroll: true });
    if (range) { selection.removeAllRanges(); selection.addRange(range); }
  }, [surface, fullscreen]);
  React.useEffect(() => () => surface.remove(), [surface]);
  React.useEffect(() => { if (!active) setMode('compact'); }, [active]);
  return <div ref={inline} className="min-w-0" data-testid="timegraph-description-slot">
    {createPortal(<section id="tg-description"
    className={fullscreen ? 'fixed inset-x-0 bottom-0 z-[90] flex flex-col p-5' : 'min-w-0'}
    style={fullscreen ? { top: 'var(--bex-tabbar-height, 2.25rem)', background: 'rgb(var(--surface))' } : undefined}
    data-testid="timegraph-description-editor" data-size-mode={mode}
    onKeyDown={event => {
      if (fullscreen && event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault(); event.stopPropagation(); setMode('compact');
      }
    }}>
    <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
      <div className="bex-tg-label" style={{ marginBottom: 0 }}>Description</div>
      <SizeSwitch mode={mode} onChange={setMode} iconsOnly />
    </div>
    <div className={`bex-card-text-editor bex-tg-description-writing min-h-0 overflow-hidden ${fullscreen ? 'flex-1' : mode === 'expanded' ? 'h-[28rem] max-h-[55vh]' : 'h-[10rem]'}`}>
      <TEXT_EDITOR_MACHINERY
        content={html}
        onChange={onChange}
        placeholder="Add description or notes with rich text or markdown..."
        fillHeight
        scrollPastEnd={fullscreen}
        localFindShortcut
      />
    </div>
    </section>, surface)}
  </div>;
}
