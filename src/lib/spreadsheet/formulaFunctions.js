import { checked, compare, criterionMatcher, fail, flatten, isError, isRange, number, numericArguments, sameShape, scalar, text, truth, values, wildcard } from './formulaValues.js';

const sum = nums => nums.reduce((a, b) => a + b, 0);
const integer = value => Math.trunc(number(value));
const argument = (condition, error = '#VALUE!') => { if (!condition) fail(error); };
const round = (value, digits, method = 'round') => {
  const n = number(value), d = integer(digits ?? 0);
  if (d > 308) return n;
  if (d < -308) return 0;
  const scale = 10 ** d, scaled = Math.abs(n) * scale;
  if (!Number.isFinite(scaled)) return n;
  const adjusted = method === 'round' ? Math.floor(scaled + .5 + Number.EPSILON * scaled) : method === 'up' ? Math.ceil(scaled) : Math.floor(scaled);
  return Math.sign(n) * adjusted / scale;
};
const asRange = value => isRange(value) ? value : { kind: 'range', values: [value], rows: 1, cols: 1 };
function sliceRange(range, r0, r1, c0, c1) {
  const result = [];
  for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) result.push(range.values[row * range.cols + col]);
  return { ...range, values: result, rows: r1 - r0 + 1, cols: c1 - c0 + 1, r0: (range.r0 || 0) + r0, c0: (range.c0 || 0) + c0 };
}
function conditional(name, args) {
  const single = ['COUNTIF', 'SUMIF', 'AVERAGEIF'].includes(name);
  const counting = name.startsWith('COUNT');
  const valueRange = counting ? asRange(args[0]) : asRange(args[single ? 2 : 0] ?? args[0]);
  const pairs = single ? [[asRange(args[0]), args[1]]] : [];
  if (!single) {
    const offset = counting ? 0 : 1;
    argument((args.length - offset) >= 2 && (args.length - offset) % 2 === 0);
    for (let i = offset; i < args.length; i += 2) pairs.push([asRange(args[i]), args[i + 1]]);
  }
  for (const [range] of pairs) argument(sameShape(valueRange, range));
  const predicates = pairs.map(([, criterion]) => criterionMatcher(criterion));
  let count = 0;
  const nums = [];
  for (let i = 0; i < valueRange.values.length; i++) {
    if (!pairs.every(([range], pi) => predicates[pi](range.values[i]))) continue;
    count++;
    if (!counting) { const value = checked(valueRange.values[i]); if (typeof value === 'number') nums.push(value); }
  }
  if (counting) return count;
  if (name.startsWith('AVERAGE')) { if (!nums.length) fail('#DIV/0!'); return sum(nums) / nums.length; }
  if (name.startsWith('MAX')) return nums.length ? Math.max(...nums) : 0;
  if (name.startsWith('MIN')) return nums.length ? Math.min(...nums) : 0;
  return sum(nums);
}
function lookupIndex(needle, haystack, matchMode = 0, reverse = false) {
  needle = scalar(needle);
  argument([0, -1, 1, 2].includes(matchMode));
  const pattern = matchMode === 2 ? wildcard(text(needle)) : null;
  let nearest = -1;
  for (let step = 0; step < haystack.length; step++) {
    const i = reverse ? haystack.length - step - 1 : step, value = haystack[i];
    if (isError(value)) continue;
    const c = compare(value, needle);
    if (pattern ? typeof value === 'string' && pattern.test(value) : c === 0) return i;
    if (matchMode === -1 && c < 0 && (nearest < 0 || compare(value, haystack[nearest]) > 0)) nearest = i;
    if (matchMode === 1 && c > 0 && (nearest < 0 || compare(value, haystack[nearest]) < 0)) nearest = i;
  }
  return nearest;
}
function percentile(nums, probability) {
  argument(nums.length > 0 && probability >= 0 && probability <= 1, '#NUM!');
  nums.sort((a, b) => a - b);
  const position = (nums.length - 1) * probability, index = Math.floor(position);
  return nums[index] + (nums[Math.min(index + 1, nums.length - 1)] - nums[index]) * (position - index);
}

// Arity is enforced before evaluating arguments. Unsupported names and modes
// return explicit spreadsheet errors; no external code, network, or eval runs.
export const FUNCTION_ARITY = {
  SUM: [1, 255], PRODUCT: [1, 255], SUMSQ: [1, 255], SUMPRODUCT: [1, 255], AVERAGE: [1, 255],
  MIN: [1, 255], MAX: [1, 255], COUNT: [1, 255], COUNTA: [1, 255], COUNTBLANK: [1, 1],
  COUNTIF: [2, 2], SUMIF: [2, 3], AVERAGEIF: [2, 3], COUNTIFS: [2, 254], SUMIFS: [3, 255], AVERAGEIFS: [3, 255], MINIFS: [3, 255], MAXIFS: [3, 255],
  IF: [2, 3], IFS: [2, 254], IFERROR: [2, 2], IFNA: [2, 2], SWITCH: [3, 254],
  AND: [1, 255], OR: [1, 255], XOR: [1, 255], NOT: [1, 1], TRUE: [0, 0], FALSE: [0, 0],
  ISNUMBER: [1, 1], ISTEXT: [1, 1], ISBLANK: [1, 1], ISLOGICAL: [1, 1], ISERROR: [1, 1], ISERR: [1, 1], ISNA: [1, 1], N: [1, 1], T: [1, 1], NA: [0, 0],
  MEDIAN: [1, 255], MODE: [1, 255], 'MODE.SNGL': [1, 255], STDEV: [1, 255], STDEVP: [1, 255], 'STDEV.S': [1, 255], 'STDEV.P': [1, 255], VAR: [1, 255], VARP: [1, 255], 'VAR.S': [1, 255], 'VAR.P': [1, 255],
  LARGE: [2, 2], SMALL: [2, 2], RANK: [2, 3], 'RANK.EQ': [2, 3], PERCENTILE: [2, 2], 'PERCENTILE.INC': [2, 2], QUARTILE: [2, 2], 'QUARTILE.INC': [2, 2],
  ABS: [1, 1], SQRT: [1, 1], POWER: [2, 2], MOD: [2, 2], ROUND: [2, 2], ROUNDUP: [2, 2], ROUNDDOWN: [2, 2], INT: [1, 1], TRUNC: [1, 2], QUOTIENT: [2, 2], SIGN: [1, 1], MROUND: [2, 2], CEILING: [2, 2], FLOOR: [2, 2], 'CEILING.MATH': [1, 3], 'FLOOR.MATH': [1, 3], LOG: [1, 2], LOG10: [1, 1], LN: [1, 1], EXP: [1, 1],
  INDEX: [2, 3], MATCH: [2, 3], XMATCH: [2, 4], XLOOKUP: [3, 6], VLOOKUP: [3, 4], HLOOKUP: [3, 4], CHOOSE: [2, 255], ROW: [0, 1], COLUMN: [0, 1], ROWS: [1, 1], COLUMNS: [1, 1],
  LEN: [1, 1], LEFT: [1, 2], RIGHT: [1, 2], MID: [3, 3], CONCAT: [1, 255], CONCATENATE: [1, 255], TEXTJOIN: [3, 255], UPPER: [1, 1], LOWER: [1, 1], TRIM: [1, 1], CLEAN: [1, 1], SUBSTITUTE: [3, 4], REPLACE: [4, 4], FIND: [2, 3], SEARCH: [2, 3], EXACT: [2, 2], VALUE: [1, 1], CHAR: [1, 1], CODE: [1, 1],
};

export function callFunction(name, args, context) {
  const a = args[0], b = args[1], c = args[2];
  if (['COUNTIF', 'SUMIF', 'AVERAGEIF', 'COUNTIFS', 'SUMIFS', 'AVERAGEIFS', 'MINIFS', 'MAXIFS'].includes(name)) return conditional(name, args);
  if (['SUM', 'PRODUCT', 'SUMSQ', 'AVERAGE', 'MIN', 'MAX', 'MEDIAN', 'MODE', 'MODE.SNGL', 'STDEV', 'STDEVP', 'STDEV.S', 'STDEV.P', 'VAR', 'VARP', 'VAR.S', 'VAR.P'].includes(name)) {
    const nums = numericArguments(args);
    if (name === 'SUM') return sum(nums);
    if (name === 'SUMSQ') return sum(nums.map(n => n * n));
    if (name === 'PRODUCT') return nums.length ? nums.reduce((x, y) => x * y, 1) : 0;
    if (name === 'MIN') return nums.length ? Math.min(...nums) : 0;
    if (name === 'MAX') return nums.length ? Math.max(...nums) : 0;
    if (name === 'AVERAGE') { if (!nums.length) fail('#DIV/0!'); return sum(nums) / nums.length; }
    if (name === 'MEDIAN') { if (!nums.length) fail('#NUM!'); return percentile(nums, .5); }
    if (name === 'MODE' || name === 'MODE.SNGL') {
      const counts = new Map(); for (const n of nums) counts.set(n, (counts.get(n) || 0) + 1);
      const maximum = Math.max(0, ...counts.values()); if (maximum < 2) fail('#N/A');
      return Math.min(...[...counts].filter(([, count]) => count === maximum).map(([n]) => n));
    }
    const sample = ['STDEV', 'STDEV.S', 'VAR', 'VAR.S'].includes(name), denominator = nums.length - (sample ? 1 : 0);
    if (denominator <= 0) fail('#DIV/0!');
    const mean = sum(nums) / nums.length, variance = sum(nums.map(n => (n - mean) ** 2)) / denominator;
    return name.startsWith('STDEV') ? Math.sqrt(variance) : variance;
  }
  switch (name) {
    case 'COUNT': return args.reduce((total, arg) => total + (isRange(arg) ? arg.values.filter(v => typeof v === 'number').length : (!isError(arg) && (typeof arg === 'number' || typeof arg === 'boolean' || (typeof arg === 'string' && arg.trim() !== '' && Number.isFinite(Number(arg)))) ? 1 : 0)), 0);
    case 'COUNTA': return flatten(args).filter(v => v != null).length;
    case 'COUNTBLANK': return values(a).filter(v => v == null || v === '').length;
    case 'SUMPRODUCT': {
      const ranges = args.map(asRange); ranges.forEach(r => argument(sameShape(r, ranges[0])));
      let result = 0;
      for (let i = 0; i < ranges[0].values.length; i++) result += ranges.reduce((product, range) => { const v = checked(range.values[i]); return product * (typeof v === 'number' ? v : 0); }, 1);
      return result;
    }
    case 'AND': case 'OR': case 'XOR': {
      const logical = args.flatMap(arg => isRange(arg) ? arg.values.filter(v => { checked(v); return typeof v === 'number' || typeof v === 'boolean'; }).map(truth) : [truth(arg)]);
      if (!logical.length) fail('#VALUE!');
      return name === 'AND' ? logical.every(Boolean) : name === 'OR' ? logical.some(Boolean) : logical.filter(Boolean).length % 2 === 1;
    }
    case 'NOT': return !truth(a);
    case 'TRUE': return true;
    case 'FALSE': return false;
    case 'ISNUMBER': return typeof values(a)[0] === 'number';
    case 'ISTEXT': return typeof values(a)[0] === 'string' && !isError(values(a)[0]);
    case 'ISLOGICAL': return typeof values(a)[0] === 'boolean';
    case 'ISBLANK': return values(a)[0] == null;
    case 'ISERROR': return isError(values(a)[0]);
    case 'ISERR': return isError(values(a)[0]) && values(a)[0].code !== '#N/A';
    case 'ISNA': return isError(values(a)[0]) && values(a)[0].code === '#N/A';
    case 'NA': fail('#N/A'); break;
    case 'N': { const v = scalar(a); return typeof v === 'number' || typeof v === 'boolean' ? Number(v) : 0; }
    case 'T': { const v = scalar(a); return typeof v === 'string' ? v : ''; }
    case 'ROUND': return round(a, b);
    case 'ROUNDUP': return round(a, b, 'up');
    case 'ROUNDDOWN': case 'TRUNC': return round(a, b ?? 0, 'down');
    case 'INT': return Math.floor(number(a));
    case 'SIGN': return Math.sign(number(a));
    case 'ABS': return Math.abs(number(a));
    case 'SQRT': return Math.sqrt(number(a));
    case 'POWER': return number(a) ** number(b);
    case 'MOD': { const x = number(a), y = number(b); if (!y) fail('#DIV/0!'); return x - y * Math.floor(x / y); }
    case 'QUOTIENT': if (!number(b)) fail('#DIV/0!'); return Math.trunc(number(a) / number(b));
    case 'MROUND': { const x = number(a), y = number(b); if (x * y < 0) fail('#NUM!'); return y ? round(x / y, 0) * y : 0; }
    case 'CEILING': case 'FLOOR': case 'CEILING.MATH': case 'FLOOR.MATH': {
      const x = number(a), significance = number(b ?? 1), y = Math.abs(significance), mode = number(c ?? 0);
      if (!y) return 0;
      if (!name.endsWith('.MATH') && x > 0 && significance < 0) fail('#NUM!');
      let up = name.startsWith('CEILING');
      if (x < 0 && (name.endsWith('.MATH') ? mode !== 0 : significance < 0)) up = !up;
      const result = (up ? Math.ceil(x / y) : Math.floor(x / y)) * y;
      return Number(result.toPrecision(15));
    }
    case 'LOG': case 'LN': case 'LOG10': { const x = number(a), base = name === 'LN' ? Math.E : name === 'LOG10' ? 10 : number(b ?? 10); if (x <= 0 || base <= 0 || base === 1) fail('#NUM!'); return Math.log(x) / Math.log(base); }
    case 'EXP': return Math.exp(number(a));
    case 'LARGE': case 'SMALL': { const nums = numericArguments([asRange(a)]).sort((x, y) => x - y), k = integer(b); argument(k >= 1 && k <= nums.length, '#NUM!'); return nums[name === 'SMALL' ? k - 1 : nums.length - k]; }
    case 'RANK': case 'RANK.EQ': { const n = number(a), nums = numericArguments([asRange(b)]); if (!nums.includes(n)) fail('#N/A'); return 1 + nums.filter(v => number(c ?? 0) ? v < n : v > n).length; }
    case 'PERCENTILE': case 'PERCENTILE.INC': return percentile(numericArguments([asRange(a)]), number(b));
    case 'QUARTILE': case 'QUARTILE.INC': { const q = integer(b); argument(q >= 0 && q <= 4, '#NUM!'); return percentile(numericArguments([asRange(a)]), q / 4); }
    case 'INDEX': {
      const range = asRange(a), row = integer(b), col = c == null ? (range.rows === 1 ? row : 1) : integer(c), actualRow = c == null && range.rows === 1 ? 1 : row;
      argument(actualRow >= 0 && actualRow <= range.rows && col >= 0 && col <= range.cols, '#REF!');
      return sliceRange(range, actualRow ? actualRow - 1 : 0, actualRow ? actualRow - 1 : range.rows - 1, col ? col - 1 : 0, col ? col - 1 : range.cols - 1);
    }
    case 'MATCH': case 'XMATCH': {
      const range = asRange(b); argument(range.rows === 1 || range.cols === 1, '#N/A');
      const mode = integer(c ?? (name === 'MATCH' ? 1 : 0));
      if (name === 'MATCH') argument([-1, 0, 1].includes(mode));
      const search = name === 'XMATCH' ? integer(args[3] ?? 1) : 1;
      argument([1, -1].includes(search));
      const matchMode = name === 'MATCH' ? mode === 1 ? -1 : mode === -1 ? 1 : (typeof scalar(a) === 'string' ? 2 : 0) : mode;
      const found = lookupIndex(a, range.values, matchMode, search === -1);
      if (found < 0) fail('#N/A'); return found + 1;
    }
    case 'XLOOKUP': {
      const lookup = asRange(b), results = asRange(c), mode = integer(args[4] ?? 0), search = integer(args[5] ?? 1);
      argument((lookup.rows === 1 || lookup.cols === 1) && [1, -1].includes(search));
      argument(lookup.cols === 1 ? results.rows === lookup.rows : results.cols === lookup.cols);
      const index = lookupIndex(a, lookup.values, mode, search === -1);
      if (index < 0) { if (args.length >= 4 && args[3] != null) return args[3]; fail('#N/A'); }
      return lookup.cols === 1 ? sliceRange(results, index, index, 0, results.cols - 1) : sliceRange(results, 0, results.rows - 1, index, index);
    }
    case 'VLOOKUP': case 'HLOOKUP': {
      const table = asRange(b), vertical = name === 'VLOOKUP', index = integer(c), approximate = args.length < 4 || truth(args[3]);
      argument(index >= 1, '#VALUE!'); argument(index <= (vertical ? table.cols : table.rows), '#REF!');
      const lookup = vertical ? sliceRange(table, 0, table.rows - 1, 0, 0) : sliceRange(table, 0, 0, 0, table.cols - 1);
      const found = lookupIndex(a, lookup.values, approximate ? -1 : typeof scalar(a) === 'string' ? 2 : 0);
      if (found < 0) fail('#N/A');
      return checked(table.values[vertical ? found * table.cols + index - 1 : (index - 1) * table.cols + found]) ?? 0;
    }
    case 'ROW': case 'COLUMN': {
      const ref = a == null ? context : a;
      argument(ref && Number.isInteger(name === 'ROW' ? ref.r0 : ref.c0));
      return (name === 'ROW' ? ref.r0 : ref.c0) + 1;
    }
    case 'ROWS': return asRange(a).rows;
    case 'COLUMNS': return asRange(a).cols;
    case 'LEN': return text(a).length;
    case 'LEFT': case 'RIGHT': { const str = text(a), n = integer(b ?? 1); argument(n >= 0); return name === 'LEFT' ? str.slice(0, n) : n ? str.slice(-n) : ''; }
    case 'MID': { const start = integer(b), count = integer(c); argument(start >= 1 && count >= 0); return text(a).slice(start - 1, start - 1 + count); }
    case 'CONCAT': case 'CONCATENATE': return flatten(args).map(text).join('');
    case 'TEXTJOIN': { const delimiter = text(a), ignoreEmpty = truth(b); return flatten(args.slice(2)).filter(v => !ignoreEmpty || (v != null && v !== '')).map(text).join(delimiter); }
    case 'UPPER': return text(a).toUpperCase();
    case 'LOWER': return text(a).toLowerCase();
    case 'TRIM': return text(a).replace(/^ +| +$/g, '').replace(/ +/g, ' ');
    case 'CLEAN': return text(a).replace(/[\x00-\x1F]/g, '');
    case 'EXACT': return text(a) === text(b);
    case 'SUBSTITUTE': {
      const original = text(a), from = text(b), to = text(c); if (!from) return original;
      if (args.length < 4) return original.split(from).join(to);
      const nth = integer(args[3]); argument(nth >= 1);
      let count = 0; return original.split(from).map((part, i) => i ? ((++count === nth ? to : from) + part) : part).join('');
    }
    case 'REPLACE': { const original = text(a), start = integer(b), count = integer(c); argument(start >= 1 && count >= 0); return original.slice(0, start - 1) + text(args[3]) + original.slice(start - 1 + count); }
    case 'FIND': case 'SEARCH': {
      const original = text(b), needle = text(a), start = integer(c ?? 1); argument(start >= 1 && start <= original.length + 1);
      const index = name === 'FIND' ? original.slice(start - 1).indexOf(needle) : original.slice(start - 1).search(new RegExp(wildcard(needle).source.slice(1, -1), 'is'));
      argument(index >= 0); return start + index;
    }
    case 'VALUE': { const str = text(a).trim(), percent = str.endsWith('%'), numeric = str.replace(/[$£€,\s%]/g, ''); if (!numeric || !Number.isFinite(Number(numeric))) fail('#VALUE!'); return Number(numeric) / (percent ? 100 : 1); }
    case 'CHAR': { const code = integer(a); argument(code >= 1 && code <= 255); return String.fromCharCode(code); }
    case 'CODE': { const str = text(a); argument(str.length > 0); return str.charCodeAt(0); }
    default: fail('#NAME?');
  }
}
