import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import {
  TableCellWithBackground,
  TableHeaderWithBackground,
} from '@/components/editor/TableCellBackground';
import { GRIP_AXIS } from '@/components/editor/tableGripModel';
import TableGripMenu from '@/components/editor/TableGripMenu';

/**
 * The grip menu, as the user meets it.
 *
 * The order of these rows was specified exactly, and an order is precisely the
 * sort of thing that drifts when somebody adds an item later — so it is
 * asserted as a list, not item by item.
 */

const TABLE = `
  <table>
    <tbody>
      <tr><th><p>category</p></th><th><p>verses</p></th><th><p>books</p></th></tr>
      <tr><td><p>Idolatry</p></td><td><p>559</p></td><td><p>39</p></td></tr>
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

afterEach(() => { cleanup(); editor?.destroy(); host?.remove(); });

function tablePos() {
  let found = null;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'table' && found === null) found = pos;
  });
  return found;
}

const gripRect = { left: 200, top: 100, width: 60, height: 12 };

function open(axis, index = 0) {
  render(
    <TableGripMenu
      editor={editor}
      request={{ axis, index, tablePos: tablePos(), gripRect }}
      onClose={() => {}}
    />,
  );
}

const labels = () => [...screen.getByTestId('table-grip-menu').querySelectorAll('[role="menuitem"]')]
  .map((item) => item.textContent.trim());

describe('the grip menu', () => {
  it('offers the column actions in the specified order', () => {
    open(GRIP_AXIS.COLUMN);
    expect(labels()).toEqual([
      'Clear contents', 'Insert left', 'Insert right', 'Duplicate', 'Color', 'Delete',
    ]);
  });

  it('offers the row actions in the same order, worded for rows', () => {
    open(GRIP_AXIS.ROW);
    expect(labels()).toEqual([
      'Clear contents', 'Insert above', 'Insert below', 'Duplicate', 'Color', 'Delete',
    ]);
  });

  it('does not repeat what the whole-table menu already covers', () => {
    open(GRIP_AXIS.COLUMN);
    const text = screen.getByTestId('table-grip-menu').textContent;
    expect(text).not.toContain('Delete table');
    expect(text).not.toContain('Toggle header row');
  });

  it('renders nothing at all when no grip was clicked', () => {
    render(<TableGripMenu editor={editor} request={null} onClose={() => {}} />);
    expect(screen.queryByTestId('table-grip-menu')).toBeNull();
  });

  it('opens the colour list on demand, closed to begin with', () => {
    open(GRIP_AXIS.COLUMN);
    expect(screen.queryByTestId('table-grip-color-menu')).toBeNull();

    fireEvent.click(screen.getByText('Color').closest('button'));

    const colors = [...screen.getByTestId('table-grip-color-menu').querySelectorAll('[role="menuitem"]')]
      .map((item) => item.textContent.trim());
    expect(colors[0]).toBe('Default');
    expect(colors).toContain('Green');
    expect(colors.length).toBeGreaterThan(5);
  });

  it('names itself for the band it belongs to', () => {
    open(GRIP_AXIS.ROW);
    expect(screen.getByTestId('table-grip-menu').getAttribute('aria-label')).toBe('Row actions');
  });
});

describe('acting on a band from the menu', () => {
  const grid = () => {
    const table = editor.state.doc.nodeAt(tablePos());
    const rows = [];
    table.forEach((row) => {
      const cells = [];
      row.forEach((cell) => cells.push(cell.textContent));
      rows.push(cells);
    });
    return rows;
  };

  it('deletes the band the grip belongs to, not the one holding the caret', () => {
    // The caret is parked in the first cell; without selecting the band first
    // the command would take the wrong column away.
    editor.commands.setTextSelection(3);
    open(GRIP_AXIS.COLUMN, 2);
    fireEvent.click(screen.getByText('Delete').closest('button'));
    expect(grid()[0]).toEqual(['category', 'verses']);
  });

  it('inserts beside the band the grip belongs to', () => {
    editor.commands.setTextSelection(3);
    open(GRIP_AXIS.COLUMN, 2);
    fireEvent.click(screen.getByText('Insert right').closest('button'));
    expect(grid()[0]).toEqual(['category', 'verses', 'books', '']);
  });

  it('duplicates the band', () => {
    open(GRIP_AXIS.ROW, 1);
    fireEvent.click(screen.getByText('Duplicate').closest('button'));
    expect(grid()).toEqual([
      ['category', 'verses', 'books'],
      ['Idolatry', '559', '39'],
      ['Idolatry', '559', '39'],
    ]);
  });

  it('clears the band without removing it', () => {
    open(GRIP_AXIS.COLUMN, 1);
    fireEvent.click(screen.getByText('Clear contents').closest('button'));
    expect(grid()).toEqual([
      ['category', '', 'books'],
      ['Idolatry', '', '39'],
    ]);
  });

  it('paints the band from the colour list', () => {
    open(GRIP_AXIS.ROW, 1);
    fireEvent.click(screen.getByText('Color').closest('button'));
    fireEvent.click(screen.getByText('Green').closest('button'));

    const table = editor.state.doc.nodeAt(tablePos());
    const painted = [];
    table.child(1).forEach((cell) => painted.push(cell.attrs.backgroundColor));
    expect(painted.every((value) => value && value.startsWith('rgba'))).toBe(true);
  });
});
