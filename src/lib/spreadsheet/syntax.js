// Excel escapes special characters in table column names with an apostrophe.
export function structuredToken(text) {
  const prefix = /^(?:[A-Za-z_\\][\w.\\]*)?\[/.exec(text);
  if (!prefix) return null;
  let depth = 0;
  for (let i = prefix[0].length - 1; i < text.length; i++) {
    if (text[i] === "'" && /['#[\]@]/.test(text[i + 1] || '')) { i++; continue; }
    if (text[i] === '[') depth++;
    if (text[i] === ']' && --depth === 0) return text.slice(0, i + 1);
  }
  throw new Error('#REF!');
}

// Fill/move/rename must never rewrite A1-like column names inside a table
// reference, or A1-like text inside a quoted formula string.
export function mapFormulaCode(formula, transform, transformTable = table => table) {
  const text = String(formula);
  let result = '', code = '', i = 0;
  while (i < text.length) {
    const tail = text.slice(i);
    const literal = /^"(?:[^"]|"")*"/.exec(tail)?.[0];
    const table = !literal && (i === 0 || !/[\w.]/.test(text[i - 1])) ? structuredToken(tail) : null;
    if (literal || table) {
      result += transform(code) + (literal || transformTable(table));
      code = ''; i += (literal || table).length;
    } else { code += text[i++]; }
  }
  return result + transform(code);
}

// OOXML marks post-2007 functions with the future-function namespace. Excel
// and other readers may otherwise treat valid new functions as undefined names.
const futureFunctions = new Set(['IFNA', 'IFS', 'SWITCH', 'XOR', 'CONCAT', 'TEXTJOIN', 'XLOOKUP', 'XMATCH', 'MAXIFS', 'MINIFS', 'MODE.SNGL', 'STDEV.S', 'STDEV.P', 'VAR.S', 'VAR.P', 'RANK.EQ', 'PERCENTILE.INC', 'QUARTILE.INC', 'CEILING.MATH', 'FLOOR.MATH']);
export function excelFormula(formula) {
  return mapFormulaCode(formula, code => code.replace(/(?<![\w.])([A-Za-z_][\w.]*)(?=\s*\()/g,
    (all, name) => futureFunctions.has(name.toUpperCase()) ? `_xlfn.${name.toUpperCase()}` : all));
}
