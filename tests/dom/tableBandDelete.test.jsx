import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import {
  TableCellWithBackground,
  TableHeaderWithBackground,
} from '@/components/editor/TableCellBackground';
import TableGrips from '@/components/editor/TableGripExtension';

/**
 * Backspace on a band selected from its grip.
 *
 * Selecting a COMPLETE column or row is how you say "this column"; having it
 * merely blank itself is not what deleting it means. A partial sweep across
 * some cells still clears their contents, which is the table library's default
 * and the right answer for that gesture — so both readings are pinned here,
 * because the difference between them is one predicate.
 */

let editor;
let host;

const TABLE = `
  <table>
    <tbody>
      <tr><th><p>category</p></th><th><p>verses</p></th><th><p>books</p></th></tr>
      <tr><td><p>Idolatry</p></td><td><p>559</p></td><td><p>39</p></td></tr>
      <tr><td><p>Deceit</p></td><td><p>284</p></td><td><p>50</p></td></tr>
    </tbody>
  </table>
`;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  editor = new Editor({
    element: host,
    extensions: [StarterKit, Table, TableRow, TableHeaderWithBackground, TableCellWithBackground, TableGrips],
    content: TABLE,
  });
});

afterEach(() => { editor?.destroy(); host?.remove(); });

function tableContext() {
  let pos = null;
  editor.state.doc.descendants((node, at) => {
    if (node.type.name === 'table' && pos === null) pos = at;
  });
  const table = editor.state.doc.nodeAt(pos);
  return { table, start: pos + 1, map: TableMap.get(table) };
}

function cellAt(row, column) {
  const { table, start, map } = tableContext();
  return editor.state.doc.resolve(start + map.positionAt(row, column, table));
}

const selectColumn = (column) => editor.view.dispatch(
  editor.state.tr.setSelection(CellSelection.colSelection(cellAt(0, column))),
);
const selectRow = (row) => editor.view.dispatch(
  editor.state.tr.setSelection(CellSelection.rowSelection(cellAt(row, 0))),
);
/** Two cells inside one column — a sweep, not a whole band. */
const selectSomeCells = () => editor.view.dispatch(
  editor.state.tr.setSelection(new CellSelection(cellAt(1, 1), cellAt(2, 1))),
);

function grid() {
  const { table } = tableContext();
  const rows = [];
  table.forEach((row) => {
    const cells = [];
    row.forEach((cell) => cells.push(cell.textContent));
    rows.push(cells);
  });
  return rows;
}

/**
 * A real keypress, down the path a real one takes.
 *
 * NOT editor.commands.keyboardShortcut: that captures the resulting steps and
 * replays them onto a fresh transaction, which mangles a multi-step structural
 * edit like removing a column — it re-inserted a stray cell and ate characters
 * out of a neighbouring one.
 */
const press = (key) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  return editor.view.someProp('handleKeyDown', (handler) => handler(editor.view, event)) === true;
};

describe('Backspace on a whole band', () => {
  it('deletes the selected column', () => {
    selectColumn(1);
    expect(press('Backspace')).toBe(true);
    expect(grid()).toEqual([
      ['category', 'books'],
      ['Idolatry', '39'],
      ['Deceit', '50'],
    ]);
  });

  it('deletes the selected row', () => {
    selectRow(1);
    expect(press('Backspace')).toBe(true);
    expect(grid()).toEqual([
      ['category', 'verses', 'books'],
      ['Deceit', '284', '50'],
    ]);
  });

  it('does the same on Delete', () => {
    selectColumn(2);
    expect(press('Delete')).toBe(true);
    expect(grid()[0]).toEqual(['category', 'verses']);
  });

  it('deletes the first column as readily as any other', () => {
    selectColumn(0);
    press('Backspace');
    expect(grid()[0]).toEqual(['verses', 'books']);
  });

  it('takes the header row with it when that is what was selected', () => {
    selectRow(0);
    press('Backspace');
    expect(grid()).toEqual([
      ['Idolatry', '559', '39'],
      ['Deceit', '284', '50'],
    ]);
  });
});

describe('Backspace on anything less than a whole band', () => {
  it('leaves a partial sweep to the default, which clears the cells', () => {
    // The table stays the shape it was; only the swept cells empty out.
    selectSomeCells();
    press('Backspace');
    expect(grid()).toEqual([
      ['category', 'verses', 'books'],
      ['Idolatry', '', '39'],
      ['Deceit', '', '50'],
    ]);
  });

  it('does not touch the table when the caret is simply in a cell', () => {
    editor.commands.setTextSelection(cellAt(1, 1).pos + 2);
    press('Backspace');
    expect(grid()[0]).toHaveLength(3);
    expect(grid()).toHaveLength(3);
  });
});
