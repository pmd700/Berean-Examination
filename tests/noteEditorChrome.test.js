import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Two presentation/behaviour contracts that are single lines each, invisible in
 * any model test, and immediately obvious to the user when broken.
 */

const root = path.resolve(import.meta.dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('marquee selection chrome', () => {
  it('keeps document text flush while gutter controls remain out of flow', () => {
    const css = read('src/index.css');
    const editorGutter = css.slice(
      css.indexOf('.ProseMirror.bex-block-editor {'),
      css.indexOf('.bex-draggable-block {'),
    );
    assert.match(editorGutter, /padding-left: 0 !important/);
  });

  it('reserves an internal marquee and handle gutter in bounded card editors', () => {
    const css = read('src/index.css');
    const cardEditor = read('src/components/knowledgeweb/CardEditor.jsx');
    const cardGutter = css.slice(
      css.indexOf('.bex-card-text-editor .ProseMirror.bex-block-editor {'),
      css.indexOf('.bex-draggable-block {'),
    );
    assert.match(cardGutter, /padding-left: 36px !important/);
    assert.equal(
      (cardEditor.match(/bex-card-text-editor/g) || []).length,
      2,
      'both compact and fullscreen card editors need the bounded gutter',
    );
  });

  it('keeps an empty compact card description short without shrinking documents', () => {
    const cardEditor = read('src/components/knowledgeweb/CardEditor.jsx');
    const noteEditor = read('src/components/notes/BookSurface.jsx');
    assert.match(cardEditor, /descriptionIsEmpty = getDescriptionCharCount\(description\) === 0/);
    assert.match(cardEditor, /descriptionIsEmpty[\s\S]*?'min-h-\[10rem\]'/);
    assert.match(cardEditor, /scrollPastEnd=\{false\}/);
    assert.match(noteEditor, /scrollPastEnd/);
  });

  it('marks a caught row with a translucent fill only, no hard line', () => {
    const css = read('src/index.css');
    const itemBox = css.slice(
      css.indexOf('.bex-draggable-block.bex-item-box {'),
      css.indexOf('data-list-style="none"'),
    );
    assert.ok(itemBox, 'could not find the item-box rule');
    // An inset 1px border on every row turned a multi-block selection into a
    // stack of hard-edged boxes instead of one highlighted passage.
    assert.equal(/box-shadow/.test(itemBox), false, 'the per-row outline is back');
    assert.equal(/border(?!-radius)/.test(itemBox), false, 'the per-row border is back');
  });

  it('still fills the row translucently', () => {
    const css = read('src/index.css');
    const fill = css.slice(css.indexOf('.bex-draggable-block.bex-block-selected::before'));
    assert.match(fill.slice(0, 400), /background: rgba\(124, 92, 183, 0\.24\)/);
  });
});

describe('italics', () => {
  const editor = read('src/components/editor/RichTextEditor.jsx');

  it('keeps italics visible even when a future app font has no italic face', () => {
    // The global font is intentionally easy to swap. If a future choice lacks
    // an italic cut, the editor may synthesize that one style instead of
    // silently rendering an italic mark upright.
    const rule = editor.slice(
      editor.indexOf('.ProseMirror em,'),
      editor.indexOf('.ProseMirror:focus'),
    );
    assert.ok(rule, 'the italic rule is gone');
    assert.match(rule, /font-style: italic/);
    assert.match(rule, /font-synthesis: style/);
  });

  it('keeps font-synthesis off the broad descendant selector', () => {
    // That selector outspecifies the italic rule. With font-synthesis:none on
    // it, the mark applied and the text still rendered upright.
    const broad = editor.slice(
      editor.indexOf('.ProseMirror,\n        .ProseMirror :not(.katex):not(.katex *) {'),
    ).slice(0, 260);
    assert.ok(broad.includes('font-family'), 'could not find the descendant selector');
    assert.equal(
      /font-synthesis/.test(broad),
      false,
      'font-synthesis is back on the descendant selector and will hide italics',
    );
  });

  it('does not disable StarterKit italic, which carries Mod-i', () => {
    const starterKit = editor.slice(
      editor.indexOf('StarterKit.configure({'),
      editor.indexOf('Placeholder.configure'),
    );
    assert.equal(/italic:\s*false/.test(starterKit), false, 'italic has been switched off');
  });
});

describe('Notion-style quotes', () => {
  const editor = read('src/components/editor/RichTextEditor.jsx');
  const globalCss = read('src/index.css');

  it('uses a straight neutral rule and preserves the surrounding typography', () => {
    const rule = editor.slice(
      editor.indexOf('.ProseMirror blockquote {'),
      editor.indexOf('.ProseMirror hr {'),
    );
    assert.ok(rule, 'the editor blockquote rule is gone');
    assert.match(rule, /border-left: 3px solid hsl\(var\(--foreground\) \/ 0\.72\)/);
    assert.match(rule, /border-radius: 0/);
    assert.match(rule, /background: transparent/);
    assert.match(rule, /color: inherit/);
    assert.match(rule, /font-style: normal/);
    assert.doesNotMatch(rule, /#C46A2B/);
  });

  it('does not add decorative quotation marks around the text', () => {
    assert.match(
      editor,
      /blockquote p:first-of-type::before,[\s\S]*blockquote p:last-of-type::after \{[\s\S]*content: none/,
    );
  });

  it('keeps saved previews and comments on the same quote design', () => {
    const preview = globalCss.slice(
      globalCss.indexOf('.prose blockquote {'),
      globalCss.indexOf('.prose blockquote p:first-of-type::before'),
    );
    // Tooltip and footnote bodies share this rule set with comments, so the
    // selector is a list — slice from the start of that list to the next one.
    const comment = globalCss.slice(
      globalCss.indexOf('.bex-comment-body blockquote,'),
      globalCss.indexOf('.bex-comment-body code,'),
    );
    assert.match(preview, /border-radius: 0/);
    assert.match(preview, /color: inherit/);
    assert.match(comment, /border-radius: 0/);
    assert.match(comment, /background: transparent/);
  });
});

describe('note title', () => {
  const source = read('src/components/knowledgeweb/NoteEditorPanel.jsx');

  it('sends Enter into the note instead of growing the title', () => {
    // The title is a textarea so it can wrap, which meant Enter added a literal
    // newline to the note's name rather than moving on to the writing.
    assert.match(source, /if \(event\.key !== 'Enter' \|\| event\.shiftKey\) return;/);
    assert.match(source, /event\.preventDefault\(\);/);
    assert.match(source, /onKeyDown=\{handleTitleKeyDown\}/);
  });

  it('leaves Shift+Enter alone as the two-line-title escape hatch', () => {
    assert.match(source, /event\.shiftKey\) return;/);
  });

  it('moves DOM focus, not just the editor selection', () => {
    // focus('start') sets the selection but its focusing is deferred, so on its
    // own the caret sat at the body start while typing still went to the title.
    assert.match(source, /titleRef\.current\?\.blur\(\);/);
    assert.match(source, /editor\.view\.dom\.focus\(\);/);
  });

  it('gives an empty note a first line to land on', () => {
    assert.match(source, /if \(editor\.isEmpty\)/);
    assert.match(source, /insertContent\('<p><\/p>'\)/);
  });

  it('receives the body editor through onEditorReady', () => {
    assert.match(source, /onEditorReady=\{\(instance\) => \{ bodyEditorRef\.current = instance; \}\}/);
  });
});
