import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { buildBandGhost } from '@/components/editor/TableGripExtension';
import { GRIP_AXIS } from '@/components/editor/tableGripModel';

/**
 * The phantom band carried under the pointer.
 *
 * A drop line says WHERE a column will land but not WHICH column is moving, so
 * a faded copy of the real cells travels with the cursor the same way a dragged
 * paragraph does. It is built by cloning the table and deleting everything that
 * is not the band, which keeps the real widths and styling — and which is
 * exactly why it has to be checked that nothing else came along with it.
 */

let host;

const TABLE = `
  <table>
    <colgroup><col><col><col></colgroup>
    <tbody>
      <tr><th id="h1"><p>category</p></th><th><p>verses</p></th><th><p>books</p></th></tr>
      <tr><td class="selectedCell"><p>Idolatry</p></td><td><p>559</p></td><td><p>39</p></td></tr>
      <tr><td><p>Deceit</p></td><td><p>284</p></td><td><p>50</p></td></tr>
    </tbody>
  </table>
`;

beforeEach(() => {
  host = document.createElement('div');
  host.innerHTML = TABLE;
  document.body.appendChild(host);
});

afterEach(() => host.remove());

const table = () => host.querySelector('table');
const cells = (ghost) => [...ghost.querySelectorAll('tr')].map((row) => (
  [...row.children].map((cell) => cell.textContent)
));

describe('the phantom column', () => {
  it('keeps that column and every row of it', () => {
    const ghost = buildBandGhost(table(), GRIP_AXIS.COLUMN, 1);
    expect(cells(ghost)).toEqual([['verses'], ['559'], ['284']]);
  });

  it('keeps the first column when that is the one being carried', () => {
    const ghost = buildBandGhost(table(), GRIP_AXIS.COLUMN, 0);
    expect(cells(ghost)).toEqual([['category'], ['Idolatry'], ['Deceit']]);
  });

  it('keeps the last column', () => {
    const ghost = buildBandGhost(table(), GRIP_AXIS.COLUMN, 2);
    expect(cells(ghost)).toEqual([['books'], ['39'], ['50']]);
  });

  it('narrows the colgroup with it, so the copy keeps the real width', () => {
    const ghost = buildBandGhost(table(), GRIP_AXIS.COLUMN, 1);
    expect(ghost.querySelectorAll('colgroup col')).toHaveLength(1);
  });
});

describe('the phantom row', () => {
  it('keeps that row and all of its columns', () => {
    const ghost = buildBandGhost(table(), GRIP_AXIS.ROW, 1);
    expect(cells(ghost)).toEqual([['Idolatry', '559', '39']]);
  });

  it('keeps the header row when that is the one being carried', () => {
    const ghost = buildBandGhost(table(), GRIP_AXIS.ROW, 0);
    expect(cells(ghost)).toEqual([['category', 'verses', 'books']]);
  });

  it('leaves the colgroup alone, since every column is still there', () => {
    const ghost = buildBandGhost(table(), GRIP_AXIS.ROW, 1);
    expect(ghost.querySelectorAll('colgroup col')).toHaveLength(3);
  });
});

describe('what the phantom must not bring with it', () => {
  it('carries no ids, which would then exist twice in the page', () => {
    const ghost = buildBandGhost(table(), GRIP_AXIS.ROW, 0);
    expect(ghost.querySelector('[id]')).toBeNull();
  });

  it('is not editable, so it cannot take the caret', () => {
    host.querySelector('td').setAttribute('contenteditable', 'true');
    const ghost = buildBandGhost(table(), GRIP_AXIS.ROW, 1);
    expect(ghost.querySelector('[contenteditable]')).toBeNull();
  });

  it('drops the selection highlight — it is being carried, not selected', () => {
    const ghost = buildBandGhost(table(), GRIP_AXIS.COLUMN, 0);
    expect(ghost.querySelector('.selectedCell')).toBeNull();
  });

  it('does not disturb the table it copied', () => {
    buildBandGhost(table(), GRIP_AXIS.COLUMN, 1);
    expect(cells(table())).toEqual([
      ['category', 'verses', 'books'],
      ['Idolatry', '559', '39'],
      ['Deceit', '284', '50'],
    ]);
    expect(host.querySelector('#h1')).toBeTruthy();
    expect(host.querySelector('.selectedCell')).toBeTruthy();
  });
});
