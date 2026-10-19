import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The division of labour between the two table menus.
 *
 * The whole-table button keeps only what is genuinely about the whole table.
 * Everything that acts on one column or one row moved onto the grips, where the
 * band is chosen by pointing at it rather than by hoping the caret is in the
 * right cell.
 */

const root = path.resolve(import.meta.dirname, '..');
const editor = fs.readFileSync(path.join(root, 'src/components/editor/TEXT_EDITOR_MACHINERY.jsx'), 'utf8');
const menu = editor.slice(editor.indexOf('pluginKey="tableMenu"'));

describe('the whole-table menu', () => {
  it('keeps the actions that are about the whole table', () => {
    ['toggleHeaderRow', 'mergeOrSplit', 'deleteTable'].forEach((command) => {
      assert.match(menu, new RegExp(`\\.${command}\\(\\)`), `lost ${command}`);
    });
  });

  it('no longer carries the per-band actions', () => {
    ['addColumnBefore', 'addColumnAfter', 'deleteColumn',
      'addRowBefore', 'addRowAfter', 'deleteRow'].forEach((command) => {
      assert.doesNotMatch(menu, new RegExp(`\\.${command}\\(\\)`), `${command} is still on the table menu`);
    });
  });

  it('does not leave the Columns and Rows headings behind', () => {
    assert.doesNotMatch(menu, />Columns</);
    assert.doesNotMatch(menu, />Rows</);
  });
});

describe('the grip extension', () => {
  const grips = fs.readFileSync(path.join(root, 'src/components/editor/TableGripExtension.js'), 'utf8');

  it('hands the menu to React rather than drawing its own', () => {
    // Every other popover in this editor is React's; a second, DOM-built menu
    // would have its own dismissal, focus and theming to keep in step.
    assert.match(grips, /new CustomEvent\(TABLE_GRIP_MENU_EVENT/);
    assert.match(editor, /addEventListener\(TABLE_GRIP_MENU_EVENT, onGrip\)/);
    assert.match(editor, /removeEventListener\(TABLE_GRIP_MENU_EVENT, onGrip\)/);
  });

  it('tells a click apart from a drag before deciding what to do', () => {
    assert.match(grips, /if \(moved && dropIndex !== from\)/);
    assert.match(grips, /DRAG_THRESHOLD/);
  });

  it('moves the band with the table library rather than rebuilding it', () => {
    assert.match(grips, /moveTableColumn/);
    assert.match(grips, /moveTableRow/);
  });

  it('draws the six dots that say the pill can be dragged', () => {
    // Same markup as the block handle, so "this is a thing you grab" is stated
    // the same way everywhere in the editor.
    assert.match(grips, /grip\.innerHTML = '(<span><\/span>){6}'/);
  });

  it('carries a faded copy of the band under the pointer', () => {
    // A line says where the column lands but not which one is moving.
    assert.match(grips, /this\.ghostSurface\.replaceChildren\(buildBandGhost\(/);
    // Inside a .ProseMirror wrapper, or the copy loses every border, colour and
    // padding the table's styling gives it and arrives as naked text.
    assert.match(grips, /this\.ghostSurface\.className = 'ProseMirror bex-table-band-ghost__surface'/);
  });

  it('gives the editor focus when a grip selects a band', () => {
    // The grip is a button OUTSIDE the editor. Without this the band is
    // highlighted but the editor never has focus, so Backspace — which is how
    // you delete the band you just selected — goes nowhere. No DOM test catches
    // it either: dispatching handleKeyDown directly bypasses focus entirely.
    const click = grips.slice(grips.indexOf('selectBand(this.view, context, axis)'));
    assert.match(click.slice(0, 400), /this\.view\.focus\(\)/);
  });

  it('closes the menu once the document changes under it', () => {
    // The menu names a column by index; after a delete that index means a
    // different column, or none.
    assert.match(editor, /if \(transaction\.docChanged\) setGripMenu\(null\)/);
  });

  it('cleans up everything it put on the page', () => {
    const destroy = grips.slice(grips.indexOf('  destroy()'));
    assert.match(destroy, /removeEventListener\('pointermove'/);
    assert.match(destroy, /grip\.remove\(\)/);
    assert.match(destroy, /this\.marker\.remove\(\)/);
    assert.match(destroy, /this\.ghost\.remove\(\)/);
  });
});

describe('the selected band', () => {
  const css = fs.readFileSync(path.join(root, 'src/components/editor/TEXT_EDITOR_MACHINERY.jsx'), 'utf8');

  it('highlights in purple, and does so on the table the editor actually renders', () => {
    // The rule used to be written for table.rt-table alone. The LIVE table
    // never carries that class — the resizable node view builds its own table
    // element and the class survives only into the saved HTML — so clicking a
    // grip selected the band and showed nothing at all.
    assert.match(css, /\.ProseMirror table \.selectedCell,\s*\n\s*\.ProseMirror table\.rt-table \.selectedCell \{[^}]*rgba\(139, 92, 246/s);
    assert.match(css, /\.dark \.ProseMirror table \.selectedCell,/);
  });

  it('is not the browser default blue', () => {
    const selected = css.slice(css.indexOf('.ProseMirror table .selectedCell'));
    assert.doesNotMatch(selected.slice(0, 400), /rgba?\(\s*(0|[1-9]\d?),\s*\d+,\s*2[0-5]\d\s*[,)]/);
  });
});

describe('the grip pill', () => {
  const css = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');
  const pill = css.slice(css.indexOf('.bex-table-grip {'), css.indexOf('.bex-table-drop-marker'));

  it('lays its dots out along the pill, the way round the pill points', () => {
    assert.match(pill, /\.bex-table-grip--row \{\s*grid-template-columns: repeat\(2, 2px\)/);
    assert.match(pill, /\.bex-table-grip--column \{\s*grid-template-columns: repeat\(3, 2px\)/);
    assert.match(pill, /\.bex-table-grip span \{[^}]*border-radius: 999px/s);
  });

  it('keeps the dots small enough for the pill to stay small', () => {
    // The dots set the pill's floor: 3px dots forced a 14px pill, which read
    // as a bar stuck to the table rather than a handle on its edge.
    assert.match(pill, /\.bex-table-grip span \{\s*width: 2px;\s*height: 2px/);
  });
});
