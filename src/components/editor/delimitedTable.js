/**
 * Recognising a pasted table that arrived as plain text.
 *
 * Copy a table out of a spreadsheet, a CSV file, or a chat answer and what
 * reaches the clipboard is often just delimited text — the editor already
 * understood markdown pipe tables, but not the far more common comma- and
 * tab-separated shapes.
 *
 * The whole difficulty is telling a table from prose that happens to contain
 * commas. Guessing wrong in that direction is much worse than missing a table:
 * a paragraph silently exploded into a grid is baffling and tedious to undo,
 * while an unrecognised table is merely the behaviour from before. So every
 * rule below is a reason to REFUSE, and anything that is not clearly tabular is
 * left alone as text.
 */

// Ordered by how strongly each one implies a table. A tab is almost never typed
// into prose — it is what every spreadsheet puts on the clipboard — so it is
// trusted with two columns. The rest have to clear a higher bar.
const DELIMITERS = Object.freeze([
  { char: '\t', name: 'tab', minColumns: 2, requireNumericColumn: false },
  { char: ',', name: 'comma', minColumns: 3, requireNumericColumn: true },
  { char: ';', name: 'semicolon', minColumns: 3, requireNumericColumn: true },
  { char: '|', name: 'pipe', minColumns: 3, requireNumericColumn: true },
]);

const MAX_FIELD_LENGTH = 180;
const MAX_ROWS = 500;
const MAX_COLUMNS = 64;

/**
 * One line of delimited text, honouring the quoting rules everything that
 * writes CSV agrees on: a quoted field may contain the delimiter and newlines
 * are already split off, and "" inside quotes is a literal quote.
 */
function splitDelimitedLine(line, delimiter) {
  const fields = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char !== '"') { field += char; continue; }
      if (line[i + 1] === '"') { field += '"'; i += 1; continue; }
      quoted = false;
      continue;
    }
    if (char === '"' && field.trim() === '') { quoted = true; field = ''; continue; }
    if (char === delimiter) { fields.push(field.trim()); field = ''; continue; }
    field += char;
  }
  fields.push(field.trim());
  return fields;
}

function looksNumeric(field) {
  if (!field) return false;
  // Money, percentages and thousands separators are still numbers to a reader.
  return /^[-+]?[$£€]?\s*\d[\d,]*(\.\d+)?\s*%?$/.test(field.trim());
}

/**
 * Prose gives itself away by sentence structure. A cell holds a label or a
 * value; once it runs on past a full stop, or ends on one, or is longer than
 * any column heading reasonably would be, the text is being read wrong.
 */
function looksLikeProse(field) {
  if (field.length > MAX_FIELD_LENGTH) return true;
  if (/[.!?]\s+["'\u201c\u2018]?[A-Z]/.test(field)) return true;
  // A trailing full stop ends a sentence, not a cell — but 3.5 and 42. are
  // numbers, and a lone initial like "J." is a name.
  return /[.!?]$/.test(field) && /\s/.test(field) && !looksNumeric(field);
}

/**
 * A column that is nothing but numbers, all the way down.
 *
 * This is what separates a comma-separated TABLE from comma-separated WRITING.
 * "The first point, however, is simple." splits into three tidy fields on three
 * tidy lines and satisfies every structural rule there is; what it does not
 * have, and what essentially every real CSV does, is a column of figures. Tabs
 * are exempt because nothing but a spreadsheet puts them on the clipboard.
 */
function hasNumericColumn(rows, columns) {
  const body = rows.length > 1 ? rows.slice(1) : rows;
  for (let column = 0; column < columns; column += 1) {
    if (body.every((row) => looksNumeric(row[column]))) return true;
  }
  return false;
}

function parseWith(lines, delimiter) {
  const rows = lines.map((line) => splitDelimitedLine(line, delimiter.char));
  const columns = rows[0].length;

  if (columns < delimiter.minColumns || columns > MAX_COLUMNS) return null;
  // A ragged shape is the clearest sign this is not a table: real tables have
  // the same number of fields on every line, and prose does not.
  if (rows.some((row) => row.length !== columns)) return null;
  // Every field empty in a column, or a row of nothing, means the delimiter
  // matched something incidental.
  if (rows.some((row) => row.every((field) => field === ''))) return null;
  if (rows.some((row) => row.some(looksLikeProse))) return null;
  if (delimiter.requireNumericColumn && !hasNumericColumn(rows, columns)) return null;

  return { delimiter: delimiter.name, columns, rows };
}

/**
 * Does the first row name the columns?
 *
 * A header is a row of labels above rows of values, so the tell is that the
 * body holds numbers where the first row holds words. Without that contrast
 * there is nothing to go on, and the first row is treated as a header anyway —
 * that is the spreadsheet convention, and it is what the markdown table paste
 * beside this has always done.
 */
export function firstRowIsHeader(rows) {
  if (rows.length < 2) return true;
  const [first, ...body] = rows;
  if (first.some(looksNumeric)) {
    const headerNumbers = first.filter(looksNumeric).length;
    const bodyNumbers = Math.max(...body.map((row) => row.filter(looksNumeric).length));
    return headerNumbers < bodyNumbers;
  }
  return true;
}

/**
 * The pasted text as a table, or null when it should stay text.
 *
 * Delimiters are tried in order and the first that yields a consistent grid
 * wins, so a file with commas inside tab-separated fields is read the way it
 * was written rather than shredded by the weaker delimiter.
 */
export function detectDelimitedTable(text) {
  if (!text || typeof text !== 'string') return null;

  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((line) => line.trim() !== '');
  if (lines.length < 2 || lines.length > MAX_ROWS) return null;

  // A markdown table is delimited too, but it has its own handler that reads
  // the alignment row and the inline formatting inside each cell.
  if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/m.test(text)) return null;

  for (const delimiter of DELIMITERS) {
    if (!lines.every((line) => line.includes(delimiter.char))) continue;
    const parsed = parseWith(lines, delimiter);
    if (!parsed) continue;
    const header = firstRowIsHeader(parsed.rows);
    return {
      delimiter: parsed.delimiter,
      columns: parsed.columns,
      header: header ? parsed.rows[0] : null,
      body: header ? parsed.rows.slice(1) : parsed.rows,
    };
  }
  return null;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cell(tag, value) {
  // An empty cell still needs something to hold its height open, and an empty
  // paragraph would collapse the row.
  return `<${tag}><p>${escapeHtml(value) || '&nbsp;'}</p></${tag}>`;
}

/** The same markup shape the markdown table paste produces. */
export function delimitedTableToHtml(text) {
  const table = detectDelimitedTable(text);
  if (!table) return null;

  const head = table.header ? `<tr>${table.header.map((value) => cell('th', value)).join('')}</tr>` : '';
  const body = table.body.map((row) => `<tr>${row.map((value) => cell('td', value)).join('')}</tr>`).join('');
  if (!head && !body) return null;
  return `<table class="rt-table"><tbody>${head}${body}</tbody></table>`;
}
