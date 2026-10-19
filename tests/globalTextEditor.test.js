import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

const surfaces = [
  ['Knowledge Web descriptions', '../src/components/knowledgeweb/CardEditor.jsx'],
  // A note's writing surface is the page inside it — NoteEditorPanel owns the
  // title and the paging, BookSurface owns the page.
  ['Markdown Notes', '../src/components/notes/BookSurface.jsx'],
];

describe('global long-form text editor architecture', () => {
  for (const [label, path] of surfaces) {
    it(`${label} uses the one shared TEXT_EDITOR_MACHINERY`, () => {
      const source = read(path);
      assert.match(source, /import TEXT_EDITOR_MACHINERY from ['"]\.\.\/editor\/TEXT_EDITOR_MACHINERY['"]/);
      assert.match(source, /<TEXT_EDITOR_MACHINERY\b/);
      assert.doesNotMatch(source, /from ['"]@tiptap\//);
    });
  }

  it('the shared editor owns both itemized blocks and collapsible toggles', () => {
    const source = read('../src/components/editor/TEXT_EDITOR_MACHINERY.jsx');
    assert.match(source, /BlockDrag/);
    assert.match(source, /CollapsibleToggle/);
    assert.match(source, /ToggleSummary/);
    assert.match(source, /ToggleContent/);
    assert.match(source, /data-bex-global-editor="true"/);
  });

  it('Knowledge Webs cannot override the shared toggle or text styling locally', () => {
    const source = read('../src/components/knowledgeweb/CardEditor.jsx');
    assert.doesNotMatch(source, /\.kw-card-editor-rich/);
    assert.doesNotMatch(source, /\.toggle-block/);
    assert.doesNotMatch(source, /ViewSwitch/);
  });

  it('the fullscreen Knowledge Web editor is borderless and edge-to-edge', () => {
    const source = read('../src/components/knowledgeweb/CardEditor.jsx');
    assert.match(source, /className="[^"]*flex-1 overflow-y-auto kw-card-editor-fullscreen"/);
    assert.match(source, /\.kw-card-editor-fullscreen > div \{[\s\S]*border: 0;[\s\S]*border-radius: 0;/);
  });

  it('speed-ramps the Knowledge Web card inspector in from the right', () => {
    const editor = read('../src/components/knowledgeweb/CardEditor.jsx');
    const styles = read('../src/index.css');
    assert.match(editor, /kw-card-inspector-enter/);
    assert.match(styles, /@keyframes kwCardInspectorIn/);
    assert.match(styles, /cubic-bezier\(0\.16, 1, 0\.3, 1\)/);
    assert.match(styles, /prefers-reduced-motion: reduce/);
  });
});
