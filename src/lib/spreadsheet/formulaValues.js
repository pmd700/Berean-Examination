export const ERROR = /^#(?:REF!|DIV\/0!|VALUE!|NAME\?|NUM!|N\/A|CYCLE!|ERROR!|NULL!|SPILL!|CALC!)$/;
export const fail = code => { throw new Error(code); };
export const errorValue = code => ({ kind: 'error', code: ERROR.test(code) ? code : '#ERROR!' });
export const isError = value => value?.kind === 'error';
export const checked = value => { if (isError(value)) fail(value.code); return value; };
export const isRange = value => value?.kind === 'range';
export const values = value => isRange(value) ? value.values : [value];
export const flatten = args => args.flatMap(values);
export function scalar(value) {
  if (isRange(value)) { if (value.values.length !== 1) fail('#VALUE!'); value = value.values[0]; }
  return checked(value);
}
export function number(value) {
  value = scalar(value);
  if (value == null || value === '') return 0;
  if (typeof value === 'boolean') return Number(value);
  const n = Number(value);
  if (!Number.isFinite(n)) fail('#VALUE!');
  return n;
}
export function text(value) {
  value = scalar(value);
  return value == null ? '' : typeof value === 'boolean' ? (value ? 'TRUE' : 'FALSE') : String(value);
}
export function truth(value) {
  value = scalar(value);
  if (value == null || value === '') return false;
  if (typeof value === 'string') {
    if (/^true$/i.test(value)) return true;
    if (/^false$/i.test(value)) return false;
    fail('#VALUE!');
  }
  return Boolean(value);
}
export function compare(a, b) {
  a = scalar(a); b = scalar(b);
  if (a == null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
  if (b == null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
  if (typeof a === 'string') a = a.toLowerCase();
  if (typeof b === 'string') b = b.toLowerCase();
  if (typeof a !== typeof b) {
    const order = { number: 0, string: 1, boolean: 2 };
    return (order[typeof a] ?? -1) < (order[typeof b] ?? -1) ? -1 : 1;
  }
  return a === b ? 0 : a < b ? -1 : 1;
}
export function wildcard(pattern) {
  let source = '^';
  for (let i = 0; i < pattern.length; i++) {
    let c = pattern[i];
    if (c === '~' && /[?*~]/.test(pattern[i + 1] || '')) c = pattern[++i];
    else if (c === '*') { source += '.*'; continue; }
    else if (c === '?') { source += '.'; continue; }
    source += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(source + '$', 'is');
}
export function criterionMatcher(criterion) {
  criterion = scalar(criterion);
  if (typeof criterion !== 'string') {
    // Excel treats a criterion pointing to an empty cell as zero.
    const target = criterion ?? 0;
    return value => !isError(value) && (typeof target === 'number'
      ? value !== '' && (value == null || typeof value === 'number') && (value ?? 0) === target
      : value === target);
  }
  const [, operator = '=', body] = /^(>=|<=|<>|>|<|=)?([\s\S]*)$/.exec(criterion);
  const numeric = body.trim() !== '' && Number.isFinite(Number(body));
  const pattern = !numeric && /[?*~]/.test(body) ? wildcard(body) : null;
  return value => {
    if (isError(value)) return (operator === '=' && value.code.toLowerCase() === body.toLowerCase()) || (operator === '<>' && value.code.toLowerCase() !== body.toLowerCase());
    let comparison;
    if (numeric) {
      // Numeric criteria can match numeric text, but relational operators do
      // not sort arbitrary text into the numeric comparison domain.
      if (typeof value === 'boolean' || (value != null && value !== '' && !Number.isFinite(Number(value)))) return operator === '<>';
      if (value === '') return operator === '<>';
      comparison = (Number(value ?? 0) - Number(body));
    } else {
      if (pattern && ['=', '<>'].includes(operator)) {
        const same = typeof value === 'string' && pattern.test(value);
        return operator === '=' ? same : !same;
      }
      if (typeof value !== 'string' && value != null) return operator === '<>';
      comparison = compare(value ?? '', body);
    }
    if (operator === '=') return comparison === 0;
    if (operator === '<>') return comparison !== 0;
    if (operator === '>') return comparison > 0;
    if (operator === '<') return comparison < 0;
    if (operator === '>=') return comparison >= 0;
    return comparison <= 0;
  };
}
export function numericArguments(args) {
  const result = [];
  for (const arg of args) {
    if (isRange(arg)) {
      for (const value of arg.values) { checked(value); if (typeof value === 'number') result.push(value); }
    } else { checked(arg); if (arg != null) result.push(number(arg)); }
  }
  return result;
}
export function sameShape(a, b) {
  return (a?.rows ?? 1) === (b?.rows ?? 1) && (a?.cols ?? 1) === (b?.cols ?? 1);
}
export function binary(op, a, b) {
  if (isRange(a) || isRange(b)) {
    if (isRange(a) && isRange(b) && !sameShape(a, b)) fail('#VALUE!');
    const range = isRange(a) ? a : b;
    return { kind: 'range', rows: range.rows, cols: range.cols, values: range.values.map((_, i) => {
      try { return binary(op, isRange(a) ? a.values[i] : a, isRange(b) ? b.values[i] : b); }
      catch (error) { return errorValue(error.message); }
    }) };
  }
  checked(a); checked(b);
  if (op === '&') return text(a) + text(b);
  if (['=', '<>', '<', '>', '<=', '>='].includes(op)) {
    const c = compare(a, b);
    return op === '=' ? c === 0 : op === '<>' ? c !== 0 : op === '<' ? c < 0 : op === '>' ? c > 0 : op === '<=' ? c <= 0 : c >= 0;
  }
  const x = number(a), y = number(b);
  if (op === '+') return x + y;
  if (op === '-') return x - y;
  if (op === '*') return x * y;
  if (op === '/') { if (!y) fail('#DIV/0!'); return x / y; }
  if (op === '^') return x ** y;
  fail('#ERROR!');
}
