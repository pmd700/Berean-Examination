import { mapFormulaCode } from './syntax.js';

export const MAX_ROWS = 1048576;
export const MAX_COLUMNS = 16384;
export function columnName(index) {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_COLUMNS) throw new Error('Invalid column');
  let name = '';
  for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name;
  return name;
}
export function parseCellAddress(address) {
  const match = /^\$?([A-Z]{1,3})\$?([1-9]\d*)$/i.exec(String(address));
  if (!match) return null;
  const col = [...match[1].toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  const row = Number(match[2]) - 1;
  return row < MAX_ROWS && col < MAX_COLUMNS ? { row, col } : null;
}
export function cellAddress(row, col) {
  if (!Number.isInteger(row) || row < 0 || row >= MAX_ROWS) throw new Error('Invalid row');
  return `${columnName(col)}${row + 1}`;
}
export function createSheet(name = 'Sheet1') {
  return { id: crypto.randomUUID(), name, rowCount: 1200, columnCount: 26, cells: {}, columnWidths: {}, rowHeights: {}, merges: [], freezeRows: 0, freezeColumns: 0 };
}
export function createWorkbook() {
  const sheet = createSheet();
  return { version: 1, sheets: [sheet], activeSheetId: sheet.id };
}
export function cellInput(cell) { return cell?.f != null ? `=${cell.f}` : cell?.v ?? ''; }
export function setCell(sheet, address, input) {
  const point = parseCellAddress(address);
  if (!point) throw new Error('Invalid cell address');
  address = cellAddress(point.row, point.col);
  const cell = { ...sheet.cells[address] };
  delete cell.f; delete cell.v; delete cell.error;
  if (typeof input === 'number' && Number.isFinite(input)) cell.v = input;
  else if (typeof input === 'boolean') cell.v = input;
  else {
    const raw = String(input ?? '');
    if (raw.startsWith('=')) cell.f = raw.slice(1);
    else if (raw.startsWith("'")) cell.v = raw.slice(1);
    else if (raw !== '') cell.v = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(raw.trim()) && Number.isFinite(Number(raw)) ? Number(raw) : raw;
  }
  const cells = { ...sheet.cells };
  if (Object.keys(cell).length) cells[address] = cell; else delete cells[address];
  // Typing a new record immediately below a table extends its data range.
  // Clearing cells or editing elsewhere must never shrink/expand a table.
  const tables = sheet.tables?.map(table => {
    const [start, end = start] = String(table.ref).split(':').map(parseCellAddress);
    if (!start || !end || table.totalsRowCount || (cell.v == null && !cell.f) || point.row !== end.row + 1 || point.col < start.col || point.col > end.col) return table;
    return { ...table, ref: `${cellAddress(start.row, start.col)}:${cellAddress(point.row, end.col)}` };
  });
  return { ...sheet, cells, ...(tables ? { tables } : {}), rowCount: Math.max(sheet.rowCount, point.row + 1), columnCount: Math.max(sheet.columnCount, point.col + 1) };
}
export function sheetBounds(sheet) {
  let rows = 0, columns = 0;
  for (const address of Object.keys(sheet.cells || {})) {
    const p = parseCellAddress(address);
    if (p) { rows = Math.max(rows, p.row + 1); columns = Math.max(columns, p.col + 1); }
  }
  return { rows, columns };
}

/** Excel table names are workbook-global, so a copied sheet needs fresh names. */
export function duplicateSheet(workbook, sheetId) {
  const source = workbook.sheets.find(s => s.id === sheetId);
  if (!source) throw new Error('Sheet not found.');
  const sheet = JSON.parse(JSON.stringify(source));
  sheet.id = crypto.randomUUID(); delete sheet.sourcePath;
  let suffix = 1;
  do { sheet.name = `${source.name.slice(0, 22)} copy ${suffix++}`; }
  while (workbook.sheets.some(s => s.name.toLowerCase() === sheet.name.toLowerCase()));
  const used = new Set(workbook.sheets.flatMap(s => (s.tables || []).flatMap(t => [t.name, t.displayName].filter(Boolean).map(n => n.toLowerCase()))));
  const names = new Map();
  sheet.tables = sheet.tables?.map(table => {
    let index = 1, name;
    do { name = `${table.name.slice(0, 230)}_copy${index++}`; } while (used.has(name.toLowerCase()));
    used.add(name.toLowerCase());
    for (const previous of [table.name, table.displayName].filter(Boolean)) names.set(previous.toLowerCase(), name);
    return { ...table, name, displayName: name };
  });
  for (const cell of Object.values(sheet.cells)) if (cell.f) {
    cell.f = mapFormulaCode(cell.f, code => code, table => table.replace(/^[^\[]+/, old => names.get(old.toLowerCase()) || old));
  }
  return sheet;
}
export function translateFormula(formula, rowDelta, colDelta) {
  return mapFormulaCode(formula, part => part.replace(/(?<![A-Za-z0-9_])((?:'(?:[^']|'')+'|[A-Za-z_][\w.]*)!)?(\$?)([A-Z]{1,3})(\$?)([1-9]\d*)(?![\w(])/gi, (all, prefix = '', absoluteCol, letters, absoluteRow, digits) => {
    const p = parseCellAddress(`${letters}${digits}`);
    if (!p) return all;
    const row = p.row + (absoluteRow ? 0 : rowDelta), col = p.col + (absoluteCol ? 0 : colDelta);
    return row < 0 || row >= MAX_ROWS || col < 0 || col >= MAX_COLUMNS ? '#REF!' : `${prefix}${absoluteCol}${columnName(col)}${absoluteRow}${row + 1}`;
  }));
}

/** Rename sheet references without rewriting string literals or cell contents. */
export function renameSheet(workbook, id, name) {
  name = String(name ?? '').trim();
  const source = workbook.sheets.find(s => s.id === id);
  if (!source) throw new Error('Sheet not found');
  if (!name || name.length > 31 || /[\\/?*[\]:]/.test(name) || workbook.sheets.some(s => s.id !== id && s.name.toLowerCase() === name.toLowerCase())) throw new Error('Use a unique sheet name of up to 31 characters without []:*?/\\.');
  const prefix = `'${name.replace(/'/g, "''")}'!`;
  const rewrite = formula => mapFormulaCode(formula, part => part.replace(/('(?:[^']|'')+'|[A-Za-z_][\w.]*)!/g, (all, ref) => ref.replace(/^'|'$/g, '').replace(/''/g, "'").toLowerCase() === source.name.toLowerCase() ? prefix : all));
  return { ...workbook, ...(workbook.definedNames ? { definedNames: workbook.definedNames.map(n => ({ ...n, formula: rewrite(n.formula) })) } : {}), sheets: workbook.sheets.map(sheet => ({ ...sheet, name: sheet.id === id ? name : sheet.name, cells: Object.fromEntries(Object.entries(sheet.cells).map(([address, cell]) => [address, cell.f ? { ...cell, f: rewrite(cell.f) } : cell])) })) };
}

function checkedRange(range) {
  const { r0, r1, c0, c1 } = range || {};
  if (![r0, r1, c0, c1].every(Number.isInteger) || r0 < 0 || c0 < 0 || r1 < r0 || c1 < c0 || r1 >= MAX_ROWS || c1 >= MAX_COLUMNS || (r1 - r0 + 1) * (c1 - c0 + 1) > 100000) throw new Error('Select a valid range of at most 100,000 cells.');
  return { r0, r1, c0, c1 };
}
const inRange = (point, range) => point && point.row >= range.r0 && point.row <= range.r1 && point.col >= range.c0 && point.col <= range.c1;
const intersects = (a, b) => a.r0 <= b.r1 && a.r1 >= b.r0 && a.c0 <= b.c1 && a.c1 >= b.c0;
function mergeBounds(merge) {
  const [a, b = a] = String(merge).split(':').map(parseCellAddress);
  if (!a || !b) throw new Error('A merged range is invalid.');
  return { r0: Math.min(a.row, b.row), r1: Math.max(a.row, b.row), c0: Math.min(a.col, b.col), c1: Math.max(a.col, b.col) };
}
const containsRange = (outer, inner) => outer.r0 <= inner.r0 && outer.r1 >= inner.r1 && outer.c0 <= inner.c0 && outer.c1 >= inner.c1;
const cloneCell = cell => JSON.parse(JSON.stringify(cell));

/** Sparse, complete clipboard snapshot; absent coordinates explicitly mean blank. */
export function copyCellRange(sheet, range) {
  range = checkedRange(range);
  const cells = {};
  for (const [address, cell] of Object.entries(sheet.cells || {})) {
    const point = parseCellAddress(address);
    if (inRange(point, range)) cells[cellAddress(point.row - range.r0, point.col - range.c0)] = cloneCell(cell);
  }
  const merges = [];
  for (const merge of sheet.merges || []) {
    const bounds = mergeBounds(merge);
    if (!intersects(range, bounds)) continue;
    if (!containsRange(range, bounds)) throw new Error('Select the entire merged cell before copying or moving it.');
    merges.push(`${cellAddress(bounds.r0 - range.r0, bounds.c0 - range.c0)}:${cellAddress(bounds.r1 - range.r0, bounds.c1 - range.c0)}`);
  }
  return { version: 1, range: { ...range }, rows: range.r1 - range.r0 + 1, columns: range.c1 - range.c0 + 1, cells, merges };
}

/** Cut/move keeps reference identity: even absolute references follow moved cells. */
export function moveCellRange(workbook, sheetId, range, targetRow, targetCol) {
  range = checkedRange(range);
  const source = workbook.sheets.find(sheet => sheet.id === sheetId);
  if (!source) throw new Error('Sheet not found.');
  const height = range.r1 - range.r0 + 1, width = range.c1 - range.c0 + 1;
  const target = checkedRange({ r0: targetRow, r1: targetRow + height - 1, c0: targetCol, c1: targetCol + width - 1 });
  const dr = targetRow - range.r0, dc = targetCol - range.c0;
  if (!dr && !dc) return workbook;
  const snapshot = copyCellRange(source, range);
  // Prevent overwriting a fragment of an unrelated merge.
  const preservedMerges = [];
  for (const merge of source.merges || []) {
    const bounds = mergeBounds(merge);
    if (containsRange(range, bounds)) continue;
    if (intersects(target, bounds)) {
      if (!containsRange(target, bounds)) throw new Error('The destination intersects part of a merged cell.');
      continue;
    }
    preservedMerges.push(merge);
  }
  const movedCells = {};
  for (const [address, cell] of Object.entries(source.cells || {})) {
    const p = parseCellAddress(address);
    if (!inRange(p, range) && !inRange(p, target)) movedCells[address] = cell;
  }
  for (const [relative, cell] of Object.entries(snapshot.cells)) {
    const p = parseCellAddress(relative); movedCells[cellAddress(targetRow + p.row, targetCol + p.col)] = cell;
  }
  const movedMerges = snapshot.merges.map(merge => merge.split(':').map(addr => { const p = parseCellAddress(addr); return cellAddress(targetRow + p.row, targetCol + p.col); }).join(':'));
  const reference = /(?<![A-Za-z0-9_.!\]])((?:'(?:[^']|'')+'|[A-Za-z_][\w.]*)!)?(\$?[A-Z]{1,3}\$?[1-9]\d*)(?:\s*:\s*((?:'(?:[^']|'')+'|[A-Za-z_][\w.]*)!)?(\$?[A-Z]{1,3}\$?[1-9]\d*))?(?![\w(])/gi;
  const refSheet = (prefix, current) => prefix ? prefix.slice(0, -1).replace(/^'|'$/g, '').replace(/''/g, "'") : current.name;
  const shiftedAddress = address => {
    const p = parseCellAddress(address), parts = /^(\$?)[A-Z]+(\$?)\d+$/i.exec(address);
    return `${parts[1]}${columnName(p.col + dc)}${parts[2]}${p.row + dr + 1}`;
  };
  const rewrite = (formula, current) => mapFormulaCode(formula, part => part.replace(reference, (all, prefix = '', a, endPrefix = '', b) => {
    const name = refSheet(prefix, current);
    if (name.toLowerCase() !== source.name.toLowerCase()) return all;
    const p = parseCellAddress(a); if (!p) return all;
    if (!b) return inRange(p, range) ? `${prefix}${shiftedAddress(a)}` : all;
    if (refSheet(endPrefix || prefix, current).toLowerCase() !== source.name.toLowerCase()) return all;
    const q = parseCellAddress(b); if (!q) return all;
    const bounds = { r0: Math.min(p.row, q.row), r1: Math.max(p.row, q.row), c0: Math.min(p.col, q.col), c1: Math.max(p.col, q.col) };
    if (!intersects(bounds, range)) return all;
    if (!containsRange(range, bounds)) throw new Error('This move would split a formula range; move the whole referenced range instead.');
    return `${prefix}${shiftedAddress(a)}:${endPrefix}${shiftedAddress(b)}`;
  }));
  // All validation/reference rewrites complete before any workbook is replaced.
  return { ...workbook, sheets: workbook.sheets.map(sheet => {
    const cells = Object.fromEntries(Object.entries(sheet.id === sheetId ? movedCells : sheet.cells || {}).map(([address, cell]) => [address, cell.f ? { ...cell, f: rewrite(cell.f, sheet) } : cell]));
    return { ...sheet, cells, ...(sheet.id === sheetId ? { rowCount: Math.max(sheet.rowCount, target.r1 + 1), columnCount: Math.max(sheet.columnCount, target.c1 + 1), merges: [...preservedMerges, ...movedMerges] } : {}) };
  }) };
}
