import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import {
  CellSelection,
  TableMap,
  moveTableColumn,
  moveTableRow,
} from '@tiptap/pm/tables';
import {
  GRIP_AXIS,
  bandFromRect,
  dropIndexForPointer,
  dropMarkerRect,
  gripRect,
} from './tableGripModel';
import { cleanGhostClone } from './BlockDragExtension';

/**
 * Notion-style grips on a table's edges.
 *
 * Hovering a cell raises two pills — one on the top border over that column,
 * one on the left border beside that row. Clicking a pill selects the whole
 * band and opens its menu; dragging one moves the band to a new position.
 *
 * The pills are plain DOM parked on the body rather than ProseMirror
 * decorations: they live OUTSIDE the table's own rectangle, which a decoration
 * cannot do, and re-rendering the document on every mouse move to reposition
 * them would be absurd.
 */

export const tableGripPluginKey = new PluginKey('bexTableGrip');

/** Fired at the editor DOM when a grip is clicked, for React to open a menu. */
export const TABLE_GRIP_MENU_EVENT = 'bex-table-grip-menu';

const DRAG_THRESHOLD = 4;

function place(element, rect) {
  element.style.left = `${rect.left}px`;
  element.style.top = `${rect.top}px`;
  element.style.width = `${rect.width}px`;
  element.style.height = `${rect.height}px`;
}

/**
 * A faded copy of one column or row, to carry under the pointer.
 *
 * Built by cloning the whole table and deleting everything that is not the
 * band: the surviving cells keep the real column widths, borders and type, so
 * what follows the cursor is the actual band rather than an approximation of
 * it. `cleanGhostClone` strips the editing machinery — ids, contenteditable —
 * that must not exist twice in the page.
 */
export function buildBandGhost(tableDom, axis, index) {
  const clone = cleanGhostClone(tableDom);

  if (axis === GRIP_AXIS.COLUMN) {
    const colgroup = clone.querySelector('colgroup');
    if (colgroup) {
      [...colgroup.children].forEach((col, position) => { if (position !== index) col.remove(); });
    }
    [...clone.querySelectorAll('tr')].forEach((row) => {
      [...row.children].forEach((cell, position) => { if (position !== index) cell.remove(); });
    });
  } else {
    [...clone.querySelectorAll('tr')].forEach((row, position) => {
      if (position !== index) row.remove();
    });
  }

  // The copy is being carried, not selected.
  clone.querySelectorAll('.selectedCell').forEach((cell) => cell.classList.remove('selectedCell'));
  clone.style.width = '';
  return clone;
}

/** The table, its map, and where the pointer's cell sits inside it. */
function tableContextAt(view, coords) {
  const found = view.posAtCoords(coords);
  if (!found) return null;

  const $pos = view.state.doc.resolve(found.pos);
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type.spec.tableRole !== 'cell'
      && $pos.node(depth).type.spec.tableRole !== 'header_cell') continue;

    const cellPos = $pos.before(depth);
    const tableDepth = depth - 2;
    if (tableDepth < 0) return null;
    const table = $pos.node(tableDepth);
    if (table.type.spec.tableRole !== 'table') return null;

    const tableStart = $pos.start(tableDepth);
    const map = TableMap.get(table);
    const rect = map.findCell(cellPos - tableStart);
    const dom = view.nodeDOM(cellPos);
    const tableDom = dom instanceof HTMLElement ? dom.closest('table') : null;
    if (!tableDom) return null;

    return {
      table,
      tableStart,
      tablePos: tableStart - 1,
      map,
      column: rect.left,
      row: rect.top,
      tableDom,
    };
  }
  return null;
}

/** Every column's or row's extent along the axis, in viewport pixels. */
function bandRects(tableDom, axis) {
  const rows = [...tableDom.querySelectorAll('tr')];
  if (!rows.length) return [];

  if (axis === GRIP_AXIS.ROW) {
    return rows.map((row) => row.getBoundingClientRect());
  }
  // Column extents come from the widest row's cells, which is the header in
  // every table this editor produces.
  const widest = rows.reduce((best, row) => (row.children.length > best.children.length ? row : best), rows[0]);
  return [...widest.children].map((cell) => cell.getBoundingClientRect());
}

function selectBand(view, context, axis) {
  const { map, tableStart, column, row } = context;
  const cellIndex = axis === GRIP_AXIS.COLUMN
    ? map.positionAt(0, column, context.table)
    : map.positionAt(row, 0, context.table);
  const $cell = view.state.doc.resolve(tableStart + cellIndex);
  const selection = axis === GRIP_AXIS.COLUMN
    ? CellSelection.colSelection($cell)
    : CellSelection.rowSelection($cell);
  view.dispatch(view.state.tr.setSelection(selection));
}

class TableGripView {
  constructor(view) {
    this.view = view;
    this.context = null;
    this.axis = null;
    this.gesture = null;

    this.grips = {
      [GRIP_AXIS.COLUMN]: this.createGrip(GRIP_AXIS.COLUMN),
      [GRIP_AXIS.ROW]: this.createGrip(GRIP_AXIS.ROW),
    };

    this.marker = document.createElement('div');
    this.marker.className = 'bex-table-drop-marker';
    this.marker.setAttribute('aria-hidden', 'true');
    document.body.appendChild(this.marker);

    // The clone goes inside a .ProseMirror wrapper: the table's borders,
    // padding and header colours are all written as descendant rules on that
    // class, so parked bare on the body the phantom would be naked text.
    this.ghost = document.createElement('div');
    this.ghost.className = 'bex-table-band-ghost';
    this.ghost.setAttribute('aria-hidden', 'true');
    this.ghostSurface = document.createElement('div');
    this.ghostSurface.className = 'ProseMirror bex-table-band-ghost__surface';
    this.ghost.appendChild(this.ghostSurface);
    document.body.appendChild(this.ghost);

    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerLeave = this.onPointerLeave.bind(this);
    this.onScroll = this.onScroll.bind(this);

    view.dom.addEventListener('pointermove', this.onPointerMove);
    view.dom.addEventListener('pointerleave', this.onPointerLeave);
    document.addEventListener('scroll', this.onScroll, true);
  }

  createGrip(axis) {
    const grip = document.createElement('button');
    grip.type = 'button';
    grip.className = `bex-table-grip bex-table-grip--${axis}`;
    grip.dataset.axis = axis;
    grip.setAttribute('aria-label', axis === GRIP_AXIS.COLUMN ? 'Column actions' : 'Row actions');
    // The same six dots the block handle uses, so "this is a thing you drag"
    // is stated the same way everywhere in the editor.
    grip.innerHTML = '<span></span><span></span><span></span><span></span><span></span><span></span>';
    grip.addEventListener('pointerdown', (event) => this.startGesture(event, axis));
    document.body.appendChild(grip);
    return grip;
  }

  hideGrips() {
    Object.values(this.grips).forEach((grip) => grip.classList.remove('is-visible'));
    this.context = null;
  }

  onPointerLeave(event) {
    // Moving onto a grip counts as staying: the pills sit outside the editor.
    if (event.relatedTarget instanceof Node
      && Object.values(this.grips).some((grip) => grip.contains(event.relatedTarget))) return;
    if (this.gesture) return;
    this.hideGrips();
  }

  onScroll() {
    if (this.gesture) return;
    this.hideGrips();
  }

  onPointerMove(event) {
    if (this.gesture) return;
    const context = tableContextAt(this.view, { left: event.clientX, top: event.clientY });
    if (!context) {
      this.hideGrips();
      return;
    }
    this.context = context;
    this.showGripsFor(context);
  }

  showGripsFor(context) {
    const tableRect = context.tableDom.getBoundingClientRect();
    const columns = bandRects(context.tableDom, GRIP_AXIS.COLUMN);
    const rows = bandRects(context.tableDom, GRIP_AXIS.ROW);

    const pairs = [
      [GRIP_AXIS.COLUMN, columns[context.column]],
      [GRIP_AXIS.ROW, rows[context.row]],
    ];
    pairs.forEach(([axis, bandRect]) => {
      const grip = this.grips[axis];
      const rect = bandRect ? gripRect(axis, bandRect, tableRect) : null;
      if (!rect) {
        grip.classList.remove('is-visible');
        return;
      }
      place(grip, rect);
      grip.classList.add('is-visible');
    });
  }

  startGesture(event, axis) {
    if (event.button !== 0 || !this.context) return;
    event.preventDefault();
    event.stopPropagation();

    const context = this.context;
    const startPoint = axis === GRIP_AXIS.COLUMN ? event.clientX : event.clientY;
    const from = axis === GRIP_AXIS.COLUMN ? context.column : context.row;
    const bands = bandRects(context.tableDom, axis).map((rect) => bandFromRect(axis, rect));
    const tableRect = context.tableDom.getBoundingClientRect();

    let moved = false;
    let dropIndex = from;

    // Where inside the band the grab happened, so the copy lifts off in place
    // rather than snapping its edge to the cursor.
    const bandRect = bandRects(context.tableDom, axis)[from];
    const grabOffset = bandRect
      ? startPoint - (axis === GRIP_AXIS.COLUMN ? bandRect.left : bandRect.top)
      : 0;

    const onMove = (moveEvent) => {
      const point = axis === GRIP_AXIS.COLUMN ? moveEvent.clientX : moveEvent.clientY;
      if (!moved && Math.abs(point - startPoint) < DRAG_THRESHOLD) return;
      if (!moved) {
        moved = true;
        document.body.classList.add('bex-is-dragging-table-band');
        this.grips[axis].classList.add('is-dragging');
        this.ghostSurface.replaceChildren(buildBandGhost(context.tableDom, axis, from));
        this.ghost.classList.add('is-visible');
      }

      // Only the dragged axis follows the pointer; across it the copy stays
      // lined up with the table it came from.
      if (bandRect) {
        const along = point - grabOffset;
        Object.assign(this.ghost.style, axis === GRIP_AXIS.COLUMN
          ? { left: `${along}px`, top: `${tableRect.top}px`, width: `${bandRect.width}px`, height: '' }
          : { left: `${tableRect.left}px`, top: `${along}px`, width: `${tableRect.width}px`, height: '' });
      }
      dropIndex = dropIndexForPointer(bands, from, point);
      const rect = dropMarkerRect(axis, bands, from, dropIndex, tableRect);
      if (rect) {
        place(this.marker, rect);
        this.marker.classList.add('is-visible');
      } else {
        this.marker.classList.remove('is-visible');
      }
    };

    const finish = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', finish, true);
      window.removeEventListener('pointercancel', cancel, true);
      this.gesture = null;
      this.marker.classList.remove('is-visible');
      this.ghost.classList.remove('is-visible');
      this.ghostSurface.replaceChildren();
      this.grips[axis].classList.remove('is-dragging');
      document.body.classList.remove('bex-is-dragging-table-band');

      const { state, dispatch } = this.view;
      if (moved && dropIndex !== from) {
        const move = axis === GRIP_AXIS.COLUMN ? moveTableColumn : moveTableRow;
        move({ from, to: dropIndex, pos: context.tableStart })(state, dispatch);
        this.view.focus();
        return;
      }

      // A press that never travelled is a click: select the band and hand the
      // menu to React, which owns every other popover in this editor.
      selectBand(this.view, context, axis);
      // The grip is a button outside the editor, so without this the selection
      // is highlighted but the editor never has focus — and Backspace, which is
      // how you delete the band you just selected, goes nowhere.
      this.view.focus();
      this.view.dom.dispatchEvent(new CustomEvent(TABLE_GRIP_MENU_EVENT, {
        bubbles: true,
        detail: {
          axis,
          index: from,
          tablePos: context.tablePos,
          gripRect: this.grips[axis].getBoundingClientRect().toJSON(),
        },
      }));
    };

    const cancel = () => {
      moved = false;
      finish();
    };

    this.gesture = { axis };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', finish, true);
    window.addEventListener('pointercancel', cancel, true);
  }

  destroy() {
    this.view.dom.removeEventListener('pointermove', this.onPointerMove);
    this.view.dom.removeEventListener('pointerleave', this.onPointerLeave);
    document.removeEventListener('scroll', this.onScroll, true);
    Object.values(this.grips).forEach((grip) => grip.remove());
    this.marker.remove();
    this.ghost.remove();
  }
}

export const TableGrips = Extension.create({
  name: 'tableGrips',

  /**
   * Backspace on a whole column or row removes it.
   *
   * The table library's default for a cell selection is to empty the cells and
   * leave them standing, which is right when you have swept across part of a
   * table. But selecting a COMPLETE band is how you say "this column" — the
   * grips exist to do exactly that — and having it merely blank itself is not
   * what deleting it means. A partial selection still falls through to the
   * default, so sweeping a few cells and clearing them is unchanged.
   */
  addKeyboardShortcuts() {
    const deleteWholeBand = () => {
      const { selection } = this.editor.state;
      if (!(selection instanceof CellSelection)) return false;
      if (selection.isColSelection()) return this.editor.commands.deleteColumn();
      if (selection.isRowSelection()) return this.editor.commands.deleteRow();
      return false;
    };

    return { Backspace: deleteWholeBand, Delete: deleteWholeBand };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: tableGripPluginKey,
        view: (view) => new TableGripView(view),
      }),
    ];
  },
});

export default TableGrips;
