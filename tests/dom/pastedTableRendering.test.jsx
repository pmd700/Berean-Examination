import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { delimitedTableToHtml } from '@/components/editor/delimitedTable';

/**
 * The markup actually becoming a table in the editor.
 *
 * tests/delimitedTable.test.js checks the HTML string; this checks that the
 * editor's schema accepts it and builds real table nodes. The two can disagree
 * — a cell whose content the schema rejects is dropped silently, so the string
 * looks right while the pasted table arrives with empty rows.
 */

const CSV = `category,verses,instances_gap0,chapters,books
Idolatry (+spiritual-adultery),559,436,250,39
Deceit/false witness,284,266,203,50
Blasphemy of the Holy Spirit,6,3,3,3`;

let editor;
let host;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  editor = new Editor({
    element: host,
    extensions: [
      StarterKit,
      Table.configure({ resizable: true, HTMLAttributes: { class: 'rt-table' } }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: '<p></p>',
  });
});

afterEach(() => { editor?.destroy(); host?.remove(); });

function pasteCsv(text) {
  editor.chain().focus().insertContent(delimitedTableToHtml(text)).run();
}

function firstTable() {
  let table = null;
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'table' && !table) table = node;
  });
  return table;
}

describe('a pasted CSV in the editor', () => {
  it('becomes a real table node, not a paragraph of text', () => {
    pasteCsv(CSV);
    expect(firstTable()).toBeTruthy();
  });

  it('has one row per line and one cell per field', () => {
    pasteCsv(CSV);
    const table = firstTable();
    expect(table.childCount).toBe(4);
    table.forEach((row) => expect(row.childCount).toBe(5));
  });

  it('makes the first row header cells and the rest ordinary cells', () => {
    pasteCsv(CSV);
    const table = firstTable();
    table.child(0).forEach((cell) => expect(cell.type.name).toBe('tableHeader'));
    table.child(1).forEach((cell) => expect(cell.type.name).toBe('tableCell'));
  });

  it('keeps every value, including the ones with punctuation in them', () => {
    pasteCsv(CSV);
    const table = firstTable();
    expect(table.child(0).child(0).textContent).toBe('category');
    expect(table.child(1).child(0).textContent).toBe('Idolatry (+spiritual-adultery)');
    expect(table.child(2).child(0).textContent).toBe('Deceit/false witness');
    expect(table.child(3).child(1).textContent).toBe('6');
  });

  it('renders a real table element on the page', () => {
    pasteCsv(CSV);
    const table = host.querySelector('table');
    expect(table).toBeTruthy();
    expect(table.querySelectorAll('th')).toHaveLength(5);
    expect(table.querySelectorAll('tr')).toHaveLength(4);
  });

  it('carries the table class into the saved HTML the card preview styles', () => {
    // Only the saved HTML has it — the resizable node view builds its own
    // <table> element while editing, which is why index.css styles
    // `.ProseMirror table` alongside `table.rt-table`.
    pasteCsv(CSV);
    expect(editor.getHTML()).toMatch(/<table class="rt-table"/);
  });

  it('survives a round trip through saved HTML', () => {
    // Notes are stored as HTML, so a table that cannot be re-parsed comes back
    // as a wall of text the next time the note is opened.
    pasteCsv(CSV);
    const saved = editor.getHTML();
    editor.commands.setContent(saved);
    const table = firstTable();
    expect(table.childCount).toBe(4);
    expect(table.child(1).child(0).textContent).toBe('Idolatry (+spiritual-adultery)');
  });
});
