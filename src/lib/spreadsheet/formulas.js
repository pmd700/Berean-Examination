import { cellAddress, parseCellAddress } from './model.js';
import { structuredToken } from './syntax.js';
import { resolveTableReference } from './tableReferences.js';
import { FUNCTION_ARITY, callFunction } from './formulaFunctions.js';
import { ERROR, binary, checked, compare, errorValue, fail, isError, isRange, number, scalar, truth } from './formulaValues.js';

const MAX_VISITS = 1000000, MAX_RANGE_CELLS = 100000;
function tokens(source) {
  const result = []; let i = 0;
  while (i < source.length) {
    if (/\s/.test(source[i])) { i++; continue; }
    const tail = source.slice(i);
    let match;
    const structured = structuredToken(tail);
    if (structured) { result.push({ type: 'table', value: structured }); i += structured.length; continue; }
    if ((match = /^"((?:[^"]|"")*)"/.exec(tail))) result.push({ type: 'value', value: match[1].replace(/""/g, '"') });
    else if ((match = /^(#(?:REF!|DIV\/0!|VALUE!|NAME\?|NUM!|N\/A|NULL!|SPILL!|CALC!))/i.exec(tail))) result.push({ type: 'error', value: match[0].toUpperCase() });
    else if ((match = /^(?:(?:'(?:[^']|'')+'|[A-Za-z_][\w.]*)!)?\$?[A-Za-z]{1,3}\$?[1-9]\d*(?![\w(\[])/.exec(tail))) result.push({ type: 'ref', value: match[0] });
    else if ((match = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/.exec(tail))) result.push({ type: 'value', value: Number(match[0]) });
    else if ((match = /^[A-Za-z_\\][\w.\\]*/.exec(tail))) result.push({ type: 'name', value: match[0] });
    else if ((match = /^(?:<>|<=|>=|[+\-*/^&=<>():,;%@])/.exec(tail))) result.push({ type: match[0] });
    else fail('#ERROR!');
    i += match[0].length;
    if (result.length > 10000) fail('#NUM!');
  }
  return result;
}
function parse(formula) {
  const ts = tokens(formula); let pos = 0, depth = 0;
  const eat = type => { if (ts[pos]?.type === type) { pos++; return true; } return false; };
  const expect = type => { if (!eat(type)) fail('#ERROR!'); };
  const precedence = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 5 };
  function primary() {
    if (eat('+')) return { unary: '+', child: primary() };
    if (eat('-')) return { unary: '-', child: primary() };
    if (eat('@')) return { unary: '@', child: primary() };
    if (eat('(')) { const node = expression(0); expect(')'); return node; }
    const token = ts[pos++];
    if (!token) fail('#ERROR!');
    if (token.type === 'value' || token.type === 'error') return token;
    if (token.type === 'table') return { table: token.value };
    if (token.type === 'ref') {
      if (eat(':')) { const end = ts[pos++]; if (end?.type !== 'ref') fail('#REF!'); return { range: [token.value, end.value] }; }
      return { ref: token.value };
    }
    if (token.type === 'name') {
      const name = token.value.toUpperCase().replace(/^(?:_XLFN\.|_XLWS\.)+/, '');
      if (!eat('(')) {
        if (['TRUE', 'FALSE'].includes(name)) return { type: 'value', value: name === 'TRUE' };
        return { name: token.value };
      }
      const args = [];
      if (!eat(')')) {
        while (true) {
          args.push([',', ';', ')'].includes(ts[pos]?.type) ? { type: 'value', value: null } : expression(0));
          if (eat(')')) break;
          if (!eat(',') && !eat(';')) fail('#ERROR!');
        }
      }
      return { fn: name, args };
    }
    fail('#ERROR!');
  }
  function expression(min) {
    if (++depth > 256) fail('#NUM!');
    let left = primary();
    while (eat('%')) left = { unary: '%', child: left };
    while (precedence[ts[pos]?.type] >= min) {
      const op = ts[pos++].type;
      const right = expression(precedence[op] + (op === '^' ? 0 : 1));
      left = { op, left, right };
    }
    depth--;
    return left;
  }
  const tree = expression(0);
  if (pos !== ts.length) fail('#ERROR!');
  return tree;
}

export function createCalculator(workbook) {
  const cache = new Map(), active = new Set(), trees = new Map(), ranges = new Map();
  const sheets = new Map(workbook.sheets.flatMap(sheet => [[sheet.id, sheet], [sheet.name.toLowerCase(), sheet]]));
  let visits = 0;
  const tree = formula => { if (!trees.has(formula)) trees.set(formula, parse(formula.replace(/^=/, ''))); return trees.get(formula); };
  function resolveRef(defaultSheet, ref) {
    const bang = ref.lastIndexOf('!');
    const name = bang < 0 ? null : ref.slice(0, bang).replace(/^'|'$/g, '').replace(/''/g, "'");
    const sheet = name == null ? defaultSheet : sheets.get(name.toLowerCase());
    const address = (bang < 0 ? ref : ref.slice(bang + 1)).replace(/\$/g, '').toUpperCase();
    if (!sheet || !parseCellAddress(address)) fail('#REF!');
    return { sheet, address };
  }
  function readRange(sheet, r0, r1, c0, c1) {
    const rows = Math.max(0, r1 - r0 + 1), cols = c1 - c0 + 1;
    if (rows * cols > MAX_RANGE_CELLS) fail('#NUM!');
    const key = `${sheet.id}:${r0}:${r1}:${c0}:${c1}`;
    if (ranges.has(key)) return ranges.get(key);
    const values = [];
    for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) {
      if (++visits > MAX_VISITS) fail('#NUM!');
      values.push(calculateRaw(sheet, cellAddress(row, col)));
    }
    const range = { kind: 'range', sheetId: sheet.id, r0, c0, rows, cols, values };
    // A cyclic range is dependent on the active traversal. Never let its
    // temporary cycle error poison unrelated later calculations.
    if (!values.some(value => isError(value) && value.code === '#CYCLE!')) ranges.set(key, range);
    return range;
  }
  function evaluate(node, sheet, address) {
    if (++visits > MAX_VISITS) fail('#NUM!');
    const run = child => evaluate(child, sheet, address);
    const point = parseCellAddress(address), context = { r0: point.row, c0: point.col };
    if (node.type === 'value') return node.value;
    if (node.type === 'error') fail(node.value);
    if (node.ref) { const r = resolveRef(sheet, node.ref), p = parseCellAddress(r.address); return readRange(r.sheet, p.row, p.row, p.col, p.col); }
    if (node.range) {
      const a = resolveRef(sheet, node.range[0]), b = resolveRef(a.sheet, node.range[1]);
      if (a.sheet.id !== b.sheet.id) fail('#REF!');
      const start = parseCellAddress(a.address), end = parseCellAddress(b.address);
      return readRange(a.sheet, Math.min(start.row, end.row), Math.max(start.row, end.row), Math.min(start.col, end.col), Math.max(start.col, end.col));
    }
    if (node.table) {
      const r = resolveTableReference(workbook, sheet, address, node.table);
      return readRange(r.sheet, r.r0, r.r1, r.c0, r.c1);
    }
    if (node.name) {
      const name = node.name.toLowerCase();
      const names = (workbook.definedNames || []).filter(n => n.name.toLowerCase() === name);
      const definition = names.find(n => n.sheetId === sheet.id) || names.find(n => !n.sheetId);
      if (!definition) {
        if (workbook.sheets.some(s => s.tables?.some(t => [t.name, t.displayName].some(n => n?.toLowerCase() === name)))) return run({ table: `${node.name}[#Data]` });
        fail('#NAME?');
      }
      const key = `name:${definition.sheetId || sheet.id}:${name}`;
      if (active.has(key)) fail('#CYCLE!');
      active.add(key);
      try { return evaluate(tree(definition.formula), sheet, address); } finally { active.delete(key); }
    }
    if (node.unary) {
      const value = run(node.child);
      if (node.unary === '@') {
        if (!isRange(value) || value.values.length === 1) return scalar(value);
        if (value.cols === 1 && point.row >= value.r0 && point.row < value.r0 + value.rows) return checked(value.values[point.row - value.r0]);
        if (value.rows === 1 && point.col >= value.c0 && point.col < value.c0 + value.cols) return checked(value.values[point.col - value.c0]);
        fail('#VALUE!');
      }
      return node.unary === '-' ? binary('*', value, -1) : node.unary === '%' ? binary('/', value, 100) : binary('*', value, 1);
    }
    if (node.op) return binary(node.op, run(node.left), run(node.right));
    const limits = FUNCTION_ARITY[node.fn];
    if (!limits) fail('#NAME?');
    if (node.args.length < limits[0] || node.args.length > limits[1]) fail('#VALUE!');
    if (node.fn === 'IF') return truth(run(node.args[0])) ? run(node.args[1]) : node.args[2] ? run(node.args[2]) : false;
    if (node.fn === 'IFERROR' || node.fn === 'IFNA') {
      try { const value = run(node.args[0]); scalar(value); return value; }
      catch (error) { if (node.fn === 'IFNA' && error.message !== '#N/A') throw error; return run(node.args[1]); }
    }
    if (node.fn === 'IFS') {
      if (node.args.length % 2) fail('#VALUE!');
      for (let i = 0; i < node.args.length; i += 2) if (truth(run(node.args[i]))) return run(node.args[i + 1]);
      fail('#N/A');
    }
    if (node.fn === 'SWITCH') {
      const key = run(node.args[0]);
      for (let i = 1; i + 1 < node.args.length; i += 2) if (compare(key, run(node.args[i])) === 0) return run(node.args[i + 1]);
      if (node.args.length % 2 === 0) return run(node.args.at(-1));
      fail('#N/A');
    }
    if (node.fn === 'CHOOSE') {
      const index = Math.trunc(number(run(node.args[0])));
      if (index < 1 || index >= node.args.length) fail('#VALUE!');
      return run(node.args[index]);
    }
    // Predicate functions need the error as a value, not an exception, so they
    // can inspect both a formula error and a referenced error cell consistently.
    const args = node.args.map(arg => {
      if (!node.fn.startsWith('IS') && !['COUNT', 'COUNTA'].includes(node.fn)) return run(arg);
      try { return run(arg); } catch (error) { return errorValue(error.message); }
    });
    return callFunction(node.fn, args, context);
  }
  function calculateRaw(sheet, address) {
    const key = `${sheet.id}:${address}`;
    if (cache.has(key)) return cache.get(key);
    if (active.has(key)) return errorValue('#CYCLE!');
    const cell = sheet.cells[address];
    if (!cell?.f) return cell?.error ? errorValue(cell.v) : cell?.v ?? null;
    active.add(key);
    let value;
    try {
      if (active.size > 256) fail('#NUM!');
      value = scalar(evaluate(tree(cell.f), sheet, address)) ?? 0;
      if (typeof value === 'number' && !Number.isFinite(value)) fail('#NUM!');
      if (typeof value === 'string' && value.length > 32767) fail('#VALUE!');
    } catch (error) { value = errorValue(error.message); }
    finally { active.delete(key); }
    cache.set(key, value); return value;
  }
  return function calculate(sheetId, address) {
    const sheet = sheets.get(sheetId) || sheets.get(String(sheetId).toLowerCase());
    if (!sheet || !parseCellAddress(address)) return '#REF!';
    if (active.size === 0) visits = 0;
    try { const value = calculateRaw(sheet, address.replace(/\$/g, '').toUpperCase()); return isError(value) ? value.code : value ?? ''; }
    catch (error) { return ERROR.test(error.message) ? error.message : '#ERROR!'; }
  };
}
