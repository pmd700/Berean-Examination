import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Two wiring bugs that were invisible from the code and only showed in a
 * running editor, recorded here because both are single lines whose regression
 * would be silent and immediately annoying.
 *
 * Neither can be exercised in jsdom: one depends on the order DOM listeners
 * were registered in relative to ProseMirror's own, the other on React 18
 * delegating events at its root container. Both were diagnosed against a live
 * editor in a browser and are asserted as source shape.
 */

const source = fs.readFileSync(
  path.join(path.resolve(import.meta.dirname, '..'), 'src/components/editor/TEXT_EDITOR_MACHINERY.jsx'),
  'utf8',
);

describe('pasting a table leaves only the table', () => {
  it('claims the paste in the capture phase', () => {
    // ProseMirror registered its paste handler on this same element when the
    // view was created, long before this effect runs. A bubble-phase listener
    // is therefore always second, and by the time it converts the text the
    // editor has already pasted it — the reported "keeps the ugly format too".
    assert.match(source, /dom\.addEventListener\('paste', onPaste, true\)/);
    assert.match(source, /dom\.removeEventListener\('paste', onPaste, true\)/);
  });

  it('stops the other handlers on the same element, not just the bubble', () => {
    // stopPropagation does not stop a listener already attached to the element
    // the event is passing through; stopImmediatePropagation does.
    const handler = source.slice(source.indexOf('const onPaste ='), source.indexOf("dom.addEventListener('paste'"));
    assert.match(handler, /e\.preventDefault\(\)/);
    assert.match(handler, /e\.stopImmediatePropagation\(\)/);
    assert.doesNotMatch(handler, /e\.stopPropagation\(\)/);
  });

  it('tries markdown before delimited text', () => {
    // A markdown table's alignment row would otherwise read as one more row of
    // delimited data, and its cells' bold/links would be escaped as literals.
    assert.match(
      source,
      /isMarkdownTable\(text\)\s*\?\s*markdownTableToHtml\(text\)\s*:\s*delimitedTableToHtml\(text\)/,
    );
  });
});

describe('the table menu can actually be clicked', () => {
  it('keeps the menu inside React’s root container', () => {
    // Tippy moves this element to whatever appendTo returns. Parked on
    // document.body it sits outside #root, and React 18 attaches its delegated
    // listeners to the root container — so every button rendered and was
    // visible while its onClick never fired.
    assert.match(source, /appendTo: \(\) => document\.getElementById\('root'\) \|\| document\.body/);
    assert.doesNotMatch(source, /appendTo: \(\) => document\.body/);
  });

  it('still offers the whole-table actions the menu is for', () => {
    // The per-column and per-row actions moved onto the edge grips — see
    // tests/tableMenuScope.test.js, which owns that split now.
    ['toggleHeaderRow', 'mergeOrSplit', 'deleteTable'].forEach((command) => {
      assert.match(source, new RegExp(`\\.${command}\\(\\)`), `menu lost ${command}`);
    });
  });

  it('holds editor focus when the button is pressed', () => {
    // Without this the mousedown blurs the editor, the selection leaves the
    // table, and the command runs against nothing.
    const menu = source.slice(source.indexOf('pluginKey="tableMenu"'));
    assert.match(menu, /onMouseDown=\{\(e\) => e\.preventDefault\(\)\}/);
  });
});
