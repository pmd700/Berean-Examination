import React from 'react';
import SizeSwitch from '@/components/editor/TextEditorSizeSwitch';
import RichTextEditor from '@/components/editor/RichTextEditor';
import { markdownToNoteHtml } from '@/components/knowledgeweb/massKnowledgeImport';

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
  const fullscreen = mode === 'fullscreen';
  return <section id="tg-description"
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
    <div className={`bex-card-text-editor min-h-0 overflow-y-auto ${fullscreen ? 'flex-1' : mode === 'expanded' ? 'h-[28rem]' : 'max-h-[20rem] min-h-[10rem]'}`}>
      <RichTextEditor
        content={html}
        onChange={onChange}
        placeholder="Add description or notes with rich text or markdown..."
        scrollPastEnd={fullscreen}
        localFindShortcut
      />
    </div>
  </section>;
}
