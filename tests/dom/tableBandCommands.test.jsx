import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import { moveTableColumn, moveTableRow } from '@tiptap/pm/tables';
import {
  TableCellWithBackground,
  TableHeaderWithBackground,
} from '@/components/editor/TableCellBackground';
import { GRIP_AXIS } from '@/components/editor/tableGripModel';
import {
  clearBandContents,
  duplicateBand,
  selectBandCommand,
  setBandBackground,
} from '@/components/editor/tableBandCommands';

/**
 * What the grip menu actually does to the table.
 *
 * Insert and delete are the editor's own commands; duplicate, clear and colour
 * are not, and each walks the table map itself. A mistake in that arithmetic
 * does not throw — it quietly writes to the wrong column — so every one of
 * these reads the resulting grid back out cell by cell.
 */

const TABLE = `
  <table>
    <tbody>
      <tr><th><p>category</p></th><th><p>verses</p></th><th><p>books</p></th></tr>
      <tr><td><p>Idolatry</p></td><td><p>559</p></td><td><p>39</p></td></tr>
      <tr><td><p>Deceit</p></td><td><p>284</p></td><td><p>50</p></td></tr>
    </tbody>
  </table>
`;

let editor;
let host;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  editor = new Editor({
    element: host,
    extensions: [StarterKit, Table, TableRow, TableHeaderWithBackground, TableCellWithBackground],
    content: TABLE,
  });
});

afterEach(() => { editor?.destroy(); host?.remove(); });

function tablePos() {
  let found = null;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'table' && found === null) found = pos;
  });
  return found;
}

/** The whole grid as text, so a misplaced write is obvious. */
function grid() {
  const table = editor.state.doc.nodeAt(tablePos());
  const rows = [];
  table.forEach((row) => {
    const cells = [];
    row.forEach((cell) => cells.push(cell.textContent));
    rows.push(cells);
  });
  return rows;
}

function colors() {
  const table = editor.state.doc.nodeAt(tablePos());
  const rows = [];
  table.forEach((row) => {
    const cells = [];
    row.forEach((cell) => cells.push(cell.attrs.backgroundColor));
    rows.push(cells);
  });
  return rows;
}

const run = (command) => command(editor.state, editor.view.dispatch);

describe('clearing a band', () => {
  it('empties a column but keeps it', () => {
    run(clearBandContents(tablePos(), GRIP_AXIS.COLUMN, 1));
    expect(grid()).toEqual([
      ['category', '', 'books'],
      ['Idolatry', '', '39'],
      ['Deceit', '', '50'],
    ]);
  });

  it('empties a row but keeps it', () => {
    run(clearBandContents(tablePos(), GRIP_AXIS.ROW, 1));
    expect(grid()).toEqual([
      ['category', 'verses', 'books'],
      ['', '', ''],
      ['Deceit', '284', '50'],
    ]);
  });

  it('leaves cells that a schema needs, not holes', () => {
    // A table cell with no block inside is invalid here, so the cells have to
    // keep an empty paragraph rather than being emptied outright.
    run(clearBandContents(tablePos(), GRIP_AXIS.COLUMN, 0));
    const table = editor.state.doc.nodeAt(tablePos());
    table.forEach((row) => {
      const cell = row.child(0);
      expect(cell.childCount).toBe(1);
      expect(cell.firstChild.type.name).toBe('paragraph');
    });
  });

  it('does nothing to an already-empty band', () => {
    run(clearBandContents(tablePos(), GRIP_AXIS.COLUMN, 1));
    expect(run(clearBandContents(tablePos(), GRIP_AXIS.COLUMN, 1))).toBe(false);
  });
});

describe('duplicating a band', () => {
  it('copies a column, contents and all, in beside itself', () => {
    run(duplicateBand(tablePos(), GRIP_AXIS.COLUMN, 1));
    expect(grid()).toEqual([
      ['category', 'verses', 'verses', 'books'],
      ['Idolatry', '559', '559', '39'],
      ['Deceit', '284', '284', '50'],
    ]);
  });

  it('copies the first column without disturbing the rest', () => {
    run(duplicateBand(tablePos(), GRIP_AXIS.COLUMN, 0));
    expect(grid()[1]).toEqual(['Idolatry', 'Idolatry', '559', '39']);
  });

  it('copies the last column', () => {
    run(duplicateBand(tablePos(), GRIP_AXIS.COLUMN, 2));
    expect(grid()[2]).toEqual(['Deceit', '284', '50', '50']);
  });

  it('copies a row in below itself', () => {
    run(duplicateBand(tablePos(), GRIP_AXIS.ROW, 1));
    expect(grid()).toEqual([
      ['category', 'verses', 'books'],
      ['Idolatry', '559', '39'],
      ['Idolatry', '559', '39'],
      ['Deceit', '284', '50'],
    ]);
  });

  it('keeps a duplicated header row a header row', () => {
    run(duplicateBand(tablePos(), GRIP_AXIS.ROW, 0));
    const table = editor.state.doc.nodeAt(tablePos());
    expect(table.child(1).child(0).type.name).toBe('tableHeader');
  });

  it('refuses an index the table does not have', () => {
    expect(run(duplicateBand(tablePos(), GRIP_AXIS.COLUMN, 9))).toBe(false);
    expect(run(duplicateBand(tablePos(), GRIP_AXIS.ROW, 9))).toBe(false);
  });
});

describe('colouring a band', () => {
  it('paints every cell of a column and nothing else', () => {
    run(setBandBackground(tablePos(), GRIP_AXIS.COLUMN, 1, 'rgba(1, 2, 3, 0.2)'));
    expect(colors()).toEqual([
      [null, 'rgba(1, 2, 3, 0.2)', null],
      [null, 'rgba(1, 2, 3, 0.2)', null],
      [null, 'rgba(1, 2, 3, 0.2)', null],
    ]);
  });

  it('paints every cell of a row', () => {
    run(setBandBackground(tablePos(), GRIP_AXIS.ROW, 2, 'rgba(4, 5, 6, 0.2)'));
    expect(colors()[2]).toEqual(['rgba(4, 5, 6, 0.2)', 'rgba(4, 5, 6, 0.2)', 'rgba(4, 5, 6, 0.2)']);
    expect(colors()[1]).toEqual([null, null, null]);
  });

  it('clears the colour again', () => {
    run(setBandBackground(tablePos(), GRIP_AXIS.COLUMN, 0, 'rgba(1, 2, 3, 0.2)'));
    run(setBandBackground(tablePos(), GRIP_AXIS.COLUMN, 0, null));
    expect(colors().every((row) => row[0] === null)).toBe(true);
  });

  it('does not disturb the text it paints over', () => {
    run(setBandBackground(tablePos(), GRIP_AXIS.COLUMN, 1, 'rgba(1, 2, 3, 0.2)'));
    expect(grid()[1]).toEqual(['Idolatry', '559', '39']);
  });

  it('survives the round trip through saved HTML', () => {
    // Notes are stored as HTML; a colour that does not parse back is a colour
    // that vanishes the next time the note is opened.
    run(setBandBackground(tablePos(), GRIP_AXIS.COLUMN, 1, 'rgba(1, 2, 3, 0.2)'));
    const saved = editor.getHTML();
    expect(saved).toContain('data-cell-color');
    editor.commands.setContent(saved);
    expect(colors()[1][1]).toBe('rgba(1, 2, 3, 0.2)');
  });

  it('renders as an inline style, for everywhere the editor is not running', () => {
    run(setBandBackground(tablePos(), GRIP_AXIS.ROW, 1, 'rgba(1, 2, 3, 0.2)'));
    expect(editor.getHTML()).toMatch(/background-color: rgba\(1, 2, 3, 0\.2\)/);
  });
});

describe('selecting a band', () => {
  it('selects the whole column, so editor commands act on it', () => {
    expect(run(selectBandCommand(tablePos(), GRIP_AXIS.COLUMN, 2))).toBe(true);
    editor.commands.deleteColumn();
    expect(grid()[0]).toEqual(['category', 'verses']);
  });

  it('selects the whole row', () => {
    expect(run(selectBandCommand(tablePos(), GRIP_AXIS.ROW, 1))).toBe(true);
    editor.commands.deleteRow();
    expect(grid()).toEqual([
      ['category', 'verses', 'books'],
      ['Deceit', '284', '50'],
    ]);
  });

  it('inserts beside the band the grip belongs to, not beside the caret', () => {
    // The caret is left in the first cell; without selecting the band first the
    // insert lands in the wrong column entirely.
    editor.commands.setTextSelection(3);
    run(selectBandCommand(tablePos(), GRIP_AXIS.COLUMN, 2));
    editor.commands.addColumnAfter();
    expect(grid()[0]).toEqual(['category', 'verses', 'books', '']);
  });

  it('refuses an index the table does not have', () => {
    expect(run(selectBandCommand(tablePos(), GRIP_AXIS.COLUMN, 9))).toBe(false);
  });
});

describe('moving a band by its grip', () => {
  it('moves a column to a new position', () => {
    moveTableColumn({ from: 2, to: 0, pos: tablePos() + 1 })(editor.state, editor.view.dispatch);
    expect(grid()[0]).toEqual(['books', 'category', 'verses']);
    expect(grid()[1]).toEqual(['39', 'Idolatry', '559']);
  });

  it('moves a row to a new position', () => {
    moveTableRow({ from: 2, to: 1, pos: tablePos() + 1 })(editor.state, editor.view.dispatch);
    expect(grid()).toEqual([
      ['category', 'verses', 'books'],
      ['Deceit', '284', '50'],
      ['Idolatry', '559', '39'],
    ]);
  });
});
