import { parseCellAddress } from './model.js';

export const REFERENCE_VERSION = 1;

export function tableBounds(table) {
  const [start, end = start] = String(table.ref || '').split(':').map(parseCellAddress);
  if (!start || !end || end.row < start.row || end.col < start.col) throw new Error('#REF!');
  return { r0: start.row, r1: end.row, c0: start.col, c1: end.col };
}

export function resolveTableReference(workbook, sheet, address, reference) {
  const bracket = reference.indexOf('['), name = reference.slice(0, bracket);
  let owner, table;
  if (name) {
    for (const candidate of workbook.sheets) {
      const found = (candidate.tables || []).find(t => [t.name, t.displayName].some(n => n?.toLowerCase() === name.toLowerCase()));
      if (found) { owner = candidate; table = found; break; }
    }
    if (!table) throw new Error('#NAME?');
  } else {
    const point = parseCellAddress(address);
    table = (sheet.tables || []).find(t => {
      const b = tableBounds(t);
      return point && point.row >= b.r0 && point.row <= b.r1 && point.col >= b.c0 && point.col <= b.c1;
    });
    owner = sheet;
    if (!table) throw new Error('#VALUE!');
  }
  const bounds = tableBounds(table);
  const headers = table.headerRowCount ?? 1, totals = table.totalsRowCount || 0;
  let body = reference.slice(bracket + 1, -1), currentRow = false;
  if (body.startsWith('@')) { currentRow = true; body = body.slice(1); }
  // Nested specifiers contain a bracket around every item; a single-column
  // reference does not. Keep punctuation and spaces inside column names.
  const items = body.startsWith('[')
    ? [...body.matchAll(/\[((?:'['#[\]@]|[^\[\]])*)\]/g)].map(m => m[1])
    : [body];
  const special = items.filter(v => v.startsWith('#')).map(v => v.toLowerCase());
  if (special.some(v => !['#all', '#data', '#headers', '#totals', '#this row'].includes(v))) throw new Error('#REF!');
  currentRow ||= special.includes('#this row');
  let r0 = bounds.r0 + headers, r1 = bounds.r1 - totals;
  if (special.includes('#all')) { r0 = bounds.r0; r1 = bounds.r1; }
  else if (special.includes('#headers') || special.includes('#totals')) {
    if (special.includes('#headers')) { if (!headers) throw new Error('#REF!'); r0 = bounds.r0; r1 = bounds.r0 + headers - 1; }
    if (special.includes('#data')) { r0 = bounds.r0; r1 = bounds.r1 - totals; }
    if (special.includes('#totals')) {
      if (!totals) throw new Error('#REF!');
      if (!special.includes('#headers') && !special.includes('#data')) r0 = bounds.r1 - totals + 1;
      r1 = bounds.r1;
    }
  }
  if (currentRow) {
    const point = parseCellAddress(address);
    if (sheet.id !== owner.id || !point || point.row < bounds.r0 + headers || point.row > bounds.r1 - totals) throw new Error('#VALUE!');
    r0 = r1 = point.row;
  }
  const columns = items.filter(v => v && !v.startsWith('#')).map(v => v.replace(/'(['#[\]@])/g, '$1'));
  let c0 = bounds.c0, c1 = bounds.c1;
  if (columns.length) {
    const indexes = columns.map(column => (table.columns || []).findIndex(c => (typeof c === 'string' ? c : c.name)?.toLowerCase() === column.toLowerCase()));
    if (indexes.some(index => index < 0) || indexes.length > 2) throw new Error('#REF!');
    c0 += Math.min(...indexes); c1 = bounds.c0 + Math.max(...indexes);
    if (c1 > bounds.c1) throw new Error('#REF!');
  }
  return { sheet: owner, r0, r1, c0, c1, currentRow };
}

