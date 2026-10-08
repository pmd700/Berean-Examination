// TEMPORARY verification harness — delete after checking the content-sync guard.
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import RichTextEditor from '@/components/editor/RichTextEditor';

export default function SyncHarness() {
  const [content, setContent] = React.useState('<p>original sentence</p>');
  React.useEffect(() => { window.__push = setContent; }, []);
  return (
    <MemoryRouter>
      <div className="h-screen overflow-y-auto p-10" style={{ background: 'rgb(var(--app))' }}>
        <div className="max-w-[820px] mx-auto">
          <RichTextEditor
            content={content}
            onChange={setContent}
            onEditorReady={(editor) => { window.__editor = editor; }}
            bare
          />
        </div>
      </div>
    </MemoryRouter>
  );
}
