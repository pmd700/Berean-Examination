import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { GRIP_AXIS } from './tableGripModel';

/**
 * The actions a column or row grip offers.
 *
 * Insert and delete already exist as editor commands; duplicate, clear and
 * colour do not, and each has to walk the table map itself. They are written
 * against the map rather than the DOM so a merged cell — one spanning two
 * columns — is handled by the same rule everywhere: a band operation touches
 * every cell the map reports in that band, once.
 */

function resolveTable(state, tablePos) {
  const node = state.doc.nodeAt(tablePos);
  if (!node || node.type.spec.tableRole !== 'table') return null;
  return { table: node, start: tablePos + 1, map: TableMap.get(node) };
}

/** Every distinct cell in one band, as document positions, top-left first. */
function cellsInBand(context, axis, index) {
  const { map, table, start } = context;
  const positions = axis === GRIP_AXIS.COLUMN
    ? map.cellsInRect({ left: index, right: index + 1, top: 0, bottom: map.height })
    : map.cellsInRect({ left: 0, right: map.width, top: index, bottom: index + 1 });
  return positions.map((offset) => ({ pos: start + offset, node: table.nodeAt(offset) }));
}

/** Selects the whole band, which every editor command then acts on. */
export function selectBandCommand(tablePos, axis, index) {
  return (state, dispatch) => {
    const context = resolveTable(state, tablePos);
    if (!context) return false;
    const { map, table, start } = context;
    if (axis === GRIP_AXIS.COLUMN ? index >= map.width : index >= map.height) return false;

    const offset = axis === GRIP_AXIS.COLUMN
      ? map.positionAt(0, index, table)
      : map.positionAt(index, 0, table);
    const $cell = state.doc.resolve(start + offset);
    const selection = axis === GRIP_AXIS.COLUMN
      ? CellSelection.colSelection($cell)
      : CellSelection.rowSelection($cell);
    if (dispatch) dispatch(state.tr.setSelection(selection));
    return true;
  };
}

/**
 * Empties every cell in the band, leaving the band itself in place.
 *
 * Deliberately not `deleteCellSelection`: that leaves the cells holding nothing
 * at all, and a table cell with no block inside is invalid in this schema.
 */
export function clearBandContents(tablePos, axis, index) {
  return (state, dispatch) => {
    const context = resolveTable(state, tablePos);
    if (!context) return false;
    const cells = cellsInBand(context, axis, index).filter(({ node }) => node && node.content.size > 2);
    if (!cells.length) return false;
    if (!dispatch) return true;

    const { tr } = state;
    // Back to front: an earlier replacement shifts every later position.
    [...cells].reverse().forEach(({ pos, node }) => {
      const empty = node.type.createAndFill(node.attrs);
      if (empty) tr.replaceWith(pos, pos + node.nodeSize, empty);
    });
    dispatch(tr);
    return true;
  };
}

/** Paints every cell in the band, or clears the paint when value is null. */
export function setBandBackground(tablePos, axis, index, value) {
  return (state, dispatch) => {
    const context = resolveTable(state, tablePos);
    if (!context) return false;
    const cells = cellsInBand(context, axis, index);
    if (!cells.length) return false;
    if (!dispatch) return true;

    const { tr } = state;
    cells.forEach(({ pos, node }) => {
      if (node) tr.setNodeMarkup(pos, undefined, { ...node.attrs, backgroundColor: value });
    });
    dispatch(tr);
    return true;
  };
}

/**
 * Copies the band, contents and all, in beside itself.
 *
 * A column is rebuilt row by row rather than by inserting an empty column and
 * filling it: the empty-then-fill route has to re-read the map between the two
 * steps, and gets it wrong the moment any cell spans more than one row.
 */
export function duplicateBand(tablePos, axis, index) {
  return (state, dispatch) => {
    const context = resolveTable(state, tablePos);
    if (!context) return false;
    const { map, table, start } = context;
    if (axis === GRIP_AXIS.COLUMN ? index >= map.width : index >= map.height) return false;
    if (!dispatch) return true;

    const { tr } = state;

    if (axis === GRIP_AXIS.ROW) {
      // A table's children are its rows, so the row is simply the nth child and
      // its position is the sum of the ones before it.
      let offset = 0;
      for (let before = 0; before < index; before += 1) offset += table.child(before).nodeSize;
      const row = table.child(index);
      tr.insert(start + offset + row.nodeSize, row.copy(row.content));
      dispatch(tr);
      return true;
    }

    // Columns: insert a copy of each cell immediately after its original, from
    // the last row upward so the positions ahead of the edit stay valid.
    for (let row = map.height - 1; row >= 0; row -= 1) {
      const offset = map.positionAt(row, index, table);
      const cell = table.nodeAt(offset);
      if (!cell) continue;
      const at = start + offset + cell.nodeSize;
      tr.insert(tr.mapping.map(at), cell.copy(cell.content));
    }
    dispatch(tr);
    return true;
  };
}
