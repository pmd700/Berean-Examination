import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { createWorkbook, createSheet, setCell, translateFormula, renameSheet, moveCellRange, duplicateSheet } from '@/lib/spreadsheet/model';
import { createCalculator } from '@/lib/spreadsheet/formulas';
import { exportXlsx, importWorkbook, restoreWorkbookReferences } from '@/lib/spreadsheet/files';

const inputFile = bytes => ({ name: 'tables.xlsx', size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
function fixture() {
  const book = createWorkbook(), sheet = book.sheets[0];
  sheet.name = 'Research';
  const rows = [
    ['Origin', 'Score', 'Tier', 'A1'],
    ['Original inventory', 10, 1, 'Alpha'],
    ['Friend supplement', 20, 2, 'Beta'],
    ['Original inventory', 30, 1, 'alphabet'],
    ['Friend supplement', 40, 3, 'literal*'],
  ];
  const letters = ['A', 'B', 'C', 'D'];
  rows.forEach((row, i) => row.forEach((v, j) => { sheet.cells[`${letters[j]}${i + 1}`] = { v }; }));
  sheet.tables = [{ name: 'Claims', displayName: 'Claims', ref: 'A1:D5', headerRowCount: 1, totalsRowCount: 0, columns: rows[0].map(name => ({ name })) }];
  sheet.cells.F1 = { f: '""' }; sheet.cells.F2 = { v: true }; sheet.cells.F3 = { v: '12' }; sheet.cells.F4 = { f: '1/0' }; sheet.cells.F5 = { v: 0 };
  const guide = createSheet('Guide'); book.sheets.push(guide);
  book.definedNames = [{ name: 'Scores', formula: "'Research'!$B$2:$B$5" }, { name: 'Limit', formula: '20' }];
  return book;
}
function run(formula, book = fixture(), address = 'Z1', sheet = book.sheets[0]) {
  sheet.cells[address] = { f: formula.replace(/^=/, '') };
  return createCalculator(book)(sheet.id, address);
}

describe('structured table references and dependent calculations', () => {
  it('resolves table columns across sheets without including header rows', () => {
    const b = fixture();
    expect(run('COUNTA(Claims[Origin])', b)).toBe(4);
    expect(run('COUNTIFS(Claims[Origin],"Original inventory")', b)).toBe(2);
    expect(run('COUNTIFS(Claims[Origin],"Friend supplement",Claims[Score],">20")', b)).toBe(1);
    expect(run('SUM(Claims[Score])', b, 'A1', b.sheets[1])).toBe(100);
    expect(run('SUM(Claims[[Score]:[Tier]])', b)).toBe(107);
    expect(run('ROWS(Claims)', b)).toBe(4);
    expect(run('COLUMNS(Claims[#All])', b)).toBe(4);
    expect(run('COUNTA(Claims[[#Headers],[Score]])', b)).toBe(1);
    expect(run('COUNTA(Claims[[#All],[Origin]])', b)).toBe(5);
  });
  it('supports implicit this-row columns, explicit this-row references and special characters', () => {
    const b = fixture();
    expect(run('[@Score]*2', b, 'D3')).toBe(40);
    expect(run('Claims[[#This Row],[Score]]+1', b, 'D4')).toBe(31);
    expect(run('Claims[@[Score]]+1', b, 'D5')).toBe(41);
    expect(run('Claims[@Score]', b, 'Z1')).toBe('#VALUE!');
    b.sheets[0].tables[0].columns[1].name = 'Cost [USD]';
    expect(run("SUM(Claims[Cost '[USD']])", b)).toBe(100);
    expect(run('SUM(Missing[Score])', b)).toBe('#NAME?');
    expect(run('SUM(Claims[Missing column])', b)).toBe('#REF!');
  });
  it('supports table totals, named ranges and sheet-local name precedence', () => {
    const b = fixture(); b.sheets[0].tables[0].totalsRowCount = 1;
    expect(run('SUM(Claims[Score])', b)).toBe(60);
    expect(run('SUM(Claims[[#Totals],[Score]])', b)).toBe(40);
    expect(run('SUM(Scores)+Limit', b)).toBe(120);
    b.definedNames.push({ name: 'Limit', formula: '5', sheetId: b.sheets[1].id });
    expect(run('Limit', b, 'A1', b.sheets[1])).toBe(5);
    b.definedNames.push({ name: 'Loop', formula: 'Loop' }); expect(run('Loop', b)).toBe('#CYCLE!');
    const renamed = renameSheet(b, b.sheets[0].id, "Paul's notes");
    expect(run('SUM(Scores)', renamed)).toBe(100);
  });
  it('does not corrupt A1-like table/column names while filling or moving formulas', () => {
    expect(translateFormula('SUM(Table1[A1])+B2+"C3"', 2, 1)).toBe('SUM(Table1[A1])+C4+"C3"');
    const b = fixture(); b.sheets[0].cells.G1 = { f: 'COUNTA(Claims[A1])+B2' };
    const moved = moveCellRange(b, b.sheets[0].id, { r0: 1, r1: 1, c0: 1, c1: 1 }, 6, 6);
    expect(moved.sheets[0].cells.G1.f).toBe('COUNTA(Claims[A1])+G7');
  });
  it('recalculates after data edits and extends the table for an appended record', () => {
    const b = fixture();
    expect(run('SUMIFS(Claims[Score],Claims[Tier],1)', b)).toBe(40);
    b.sheets[0] = setCell(b.sheets[0], 'B2', 50);
    expect(run('SUMIFS(Claims[Score],Claims[Tier],1)', b)).toBe(80);
    b.sheets[0] = setCell(b.sheets[0], 'A6', 'Original inventory');
    b.sheets[0] = setCell(b.sheets[0], 'B6', 60);
    expect(b.sheets[0].tables[0].ref).toBe('A1:D6');
    expect(run('COUNTIFS(Claims[Origin],"Original inventory")', b)).toBe(3);
    expect(run('SUM(Claims[Score])', b)).toBe(200);
  });
  it('gives a copied worksheet independent table names and formulas', async () => {
    const b = fixture(); b.sheets[0].cells.G1 = { f: 'SUM(Claims[Score])' };
    const copy = duplicateSheet(b, b.sheets[0].id); b.sheets.push(copy);
    expect(copy.tables[0].name).not.toBe('Claims');
    expect(copy.cells.G1.f).toBe(`SUM(${copy.tables[0].name}[Score])`);
    b.sheets[2] = setCell(copy, 'B2', 500);
    const roundTrip = await importWorkbook(inputFile(await exportXlsx(b)));
    const calc = createCalculator(roundTrip);
    expect(calc(roundTrip.sheets[0].id, 'G1')).toBe(100);
    expect(calc(roundTrip.sheets[2].id, 'G1')).toBe(590);
  });
});

describe('conditional aggregation and blank/error semantics', () => {
  it.each([
    ['SUMIFS(B2:B5,A2:A5,"Original*",C2:C5,1)', 40],
    ['AVERAGEIFS(B2:B5,A2:A5,"Original inventory")', 20],
    ['MAXIFS(B2:B5,A2:A5,"Friend*")', 40],
    ['MINIFS(B2:B5,A2:A5,"Friend*")', 20],
    ['COUNTIF(D2:D5,"alpha*")', 2], ['COUNTIF(D2:D5,"literal~*")', 1],
    ['COUNTIFS(D2:D5,"????",B2:B5,">=20")', 1],
    ['COUNTIFS(B2:B5,">="&B3,B2:B5,"<40")', 2],
    ['SUMIF(A2:A5,"Friend*",B2:B5)', 60],
    ['AVERAGEIF(A2:A5,"Original*",B2:B5)', 20],
    ['COUNT(F1:F6)', 1], ['COUNTA(F1:F6)', 5], ['COUNTBLANK(F1:F6)', 2],
    ['COUNT(1,"2",TRUE,"text")', 3], ['ISBLANK(F1)', false], ['ISBLANK(F6)', true],
    ['COUNT(NA(),1/0,2)', 1], ['COUNTA(NA(),1/0,"")', 3],
    ['IFERROR(SUM(F1:F6),"error")', 'error'], ['COUNTIF(F1:F6,"#DIV/0!")', 1],
    ['COUNTIFS(A2:A5,"Friend*",B2:B4,">0")', '#VALUE!'],
    ['AVERAGEIFS(B2:B5,A2:A5,"Missing")', '#DIV/0!'],
    ['SUMIFS(B2:B5,A2:A5,"Missing")', 0], ['MINIFS(B2:B5,A2:A5,"Missing")', 0],
    ['COUNTIFS(A2:A5)', '#VALUE!'], ['SUMIFS(B2:B5,A2:A5)', '#VALUE!'],
  ])('%s = %s', (formula, expected) => { expect(run(formula)).toBe(expected); });
});

describe('statistical, logical, text, math and lookup functions', () => {
  it.each([
    ['AVERAGE(B2:B5)', 25], ['SUM(B2:B5,TRUE,"5")', 106], ['PRODUCT(C2:C5)', 6], ['SUMSQ(C2:C5)', 15],
    ['SUMPRODUCT(B2:B5,C2:C5)', 200], ['SUMPRODUCT((C2:C5=1)*B2:B5)', 40],
    ['SUMPRODUCT(B2:B5,C2:C4)', '#VALUE!'], ['MEDIAN(B2:B5)', 25], ['MODE.SNGL(C2:C5)', 1],
    ['STDEV.S(B2:B5)', Math.sqrt(500 / 3)], ['STDEV.P(B2:B5)', Math.sqrt(125)],
    ['VAR.S(B2:B5)', 500 / 3], ['VAR.P(B2:B5)', 125],
    ['LARGE(B2:B5,2)', 30], ['SMALL(B2:B5,3)', 30], ['RANK.EQ(20,B2:B5)', 3],
    ['PERCENTILE.INC(B2:B5,0.25)', 17.5], ['QUARTILE.INC(B2:B5,3)', 32.5],
    ['IF(FALSE,1/0,42)', 42], ['IFS(FALSE,1/0,TRUE,12)', 12], ['SWITCH(2,1,1/0,2,23,99)', 23],
    ['CHOOSE(2,1/0,17)', 17], ['IFNA(NA(),9)', 9], ['IFNA(1/0,9)', '#DIV/0!'],
    ['AND(TRUE,B2>1)', true], ['OR(FALSE,TRUE)', true], ['XOR(TRUE,TRUE,FALSE)', false], ['NOT(FALSE())', true],
    ['ISERROR(1/0)', true], ['ISERR(NA())', false], ['ISNA(NA())', true], ['ISNUMBER(B2)', true], ['ISTEXT(D2)', true], ['ISLOGICAL(TRUE)', true], ['N(TRUE)', 1], ['T(12)', ''],
    ['ROUND(-1.25,1)', -1.3], ['ROUNDUP(1.201,2)', 1.21], ['ROUNDDOWN(-1.29,1)', -1.2], ['INT(-1.2)', -2], ['TRUNC(-1.2)', -1],
    ['MOD(-7,3)', 2], ['QUOTIENT(7,3)', 2], ['SIGN(-2)', -1], ['MROUND(13,5)', 15], ['CEILING.MATH(-4.3)', -4], ['FLOOR.MATH(-4.3)', -5],
    ['ABS(-3)', 3], ['SQRT(16)', 4], ['POWER(2,3)', 8], ['LOG10(100)', 2], ['LN(EXP(1))', 1],
    ['INDEX(B2:C5,3,2)', 1], ['INDEX(B2:B5,MATCH("Friend supplement",A2:A5,0))', 20],
    ['MATCH(25,B2:B5,1)', 2], ['XMATCH("Friend supplement",A2:A5,0,-1)', 4],
    ['XLOOKUP("Friend supplement",A2:A5,B2:B5)', 20], ['XLOOKUP("Friend supplement",A2:A5,B2:B5,"Missing",0,-1)', 40],
    ['XLOOKUP("original*",A2:A5,B2:B5,"Missing",2)', 10], ['XLOOKUP("none",A2:A5,B2:B5,"Missing")', 'Missing'],
    ['XLOOKUP(25,B2:B5,C2:C5,, -1)', 2], ['XLOOKUP(25,B2:B5,C2:C5,, 1)', 1],
    ['XLOOKUP("none",A2:A5,B2:B5,,0)', '#N/A'], ['XLOOKUP("none",A2:A5,B2:B5,"",0)', ''],
    ['VLOOKUP("Friend supplement",A2:C5,2,FALSE)', 20], ['HLOOKUP("Score",A1:D5,3,FALSE)', 20],
    ['ROWS(A2:D5)', 4], ['COLUMNS(A2:D5)', 4], ['ROW(B3)', 3], ['COLUMN(B3)', 2], ['ROW()', 1], ['COLUMN()', 26],
    ['LEFT(D2,2)&RIGHT(D3,2)', 'Alta'], ['MID(D4,2,3)', 'lph'], ['LEN(D2)', 5],
    ['TRIM("  two   words  ")', 'two words'], ['UPPER("aBc")', 'ABC'], ['LOWER("aBc")', 'abc'],
    ['CONCAT(D2,":",B2)', 'Alpha:10'], ['TEXTJOIN(",",TRUE,F1,F6,D2:D3)', 'Alpha,Beta'],
    ['SUBSTITUTE("a-b-a","a","x",2)', 'a-b-x'], ['REPLACE("abcdef",2,3,"X")', 'aXef'],
    ['FIND("ph",D2)', 3], ['SEARCH("ALP*",D4)', 1], ['EXACT("A","a")', false],
    ['VALUE("1,234.5")', 1234.5], ['VALUE("25%")', .25], ['CODE(CHAR(65))', 65], ['CLEAN(CHAR(10)&"word")', 'word'],
    ['_xlfn.XLOOKUP("Friend supplement",A2:A5,B2:B5)', 20],
    ['MISSING(1)', '#NAME?'], ['SUM(1/0)', '#DIV/0!'], ['INDEX(B2:C5,99,2)', '#REF!'], ['SQRT(-1)', '#NUM!'],
  ])('%s = %s', (formula, expected) => {
    const result = run(formula);
    if (typeof expected === 'number') expect(result).toBeCloseTo(expected, 10); else expect(result).toBe(expected);
  });
});

describe('Excel tables, legacy imports and reference metadata round trips', () => {
  it('preserves table identities and live formulas through Excel export/import', async () => {
    const b = fixture(); b.sheets[1].cells.A1 = { f: 'COUNTIFS(Claims[Origin],"Original inventory")' };
    const bytes = await exportXlsx(b), imported = await importWorkbook(inputFile(bytes));
    expect(imported.sheets[0].tables[0]).toMatchObject({ name: 'Claims', ref: 'A1:D5', columns: [{ name: 'Origin' }, { name: 'Score' }, { name: 'Tier' }, { name: 'A1' }] });
    expect(createCalculator(imported)(imported.sheets[1].id, 'A1')).toBe(2);
    imported.sheets[0] = setCell(imported.sheets[0], 'A6', 'Original inventory');
    const again = await importWorkbook(inputFile(await exportXlsx(imported)));
    expect(again.sheets[0].tables[0].ref).toBe('A1:D6');
    expect(createCalculator(again)(again.sheets[1].id, 'A1')).toBe(3);
    expect(run('SUM(Scores)', again)).toBe(100);
  });
  it('repairs reference metadata for an earlier BEX import without reverting edited cells', async () => {
    const imported = await importWorkbook(inputFile(await exportXlsx(fixture())));
    const legacy = { ...imported }; delete legacy.referenceVersion; delete legacy.definedNames;
    legacy.sheets = legacy.sheets.map(s => { const copy = { ...s }; delete copy.tables; return copy; });
    legacy.sheets[0] = setCell(legacy.sheets[0], 'B2', 999);
    const restored = await restoreWorkbookReferences(legacy);
    expect(restored.sheets[0].id).toBe(legacy.sheets[0].id);
    expect(restored.sheets[0].cells).toBe(legacy.sheets[0].cells);
    expect(run('SUM(Claims[Score])', restored)).toBe(1089);
    expect(await restoreWorkbookReferences(restored)).toBe(restored);
  });
  it('writes current calculated values, not stale imported caches, into Excel exports', async () => {
    const b = fixture(); b.sheets[1].cells.A1 = { f: 'SUM(Claims[Score])', v: 12345 };
    const bytes = await exportXlsx(b), zip = await JSZip.loadAsync(bytes);
    const out = await importWorkbook(inputFile(bytes));
    expect(out.sheets[1].cells.A1.v).toBe(100);
    expect(out.sheets[1].cells.A1.f).toBe('SUM(Claims[Score])');
    expect(Object.keys(zip.files).some(f => f.startsWith('xl/tables/') && f.endsWith('.xml'))).toBe(true);
  });
  it('emits the required future-function markers for modern Excel formulas without double-prefixing', async () => {
    const b = fixture();
    b.sheets[1].cells.A1 = { f: 'XLOOKUP("Friend supplement",Claims[Origin],Claims[Score])' };
    b.sheets[1].cells.A2 = { f: '_xlfn.MAXIFS(Claims[Score],Claims[Tier],1)' };
    const imported = await importWorkbook(inputFile(await exportXlsx(b)));
    expect(imported.sheets[1].cells.A1.f).toMatch(/^_xlfn\.XLOOKUP/);
    expect(imported.sheets[1].cells.A2.f).toBe('_xlfn.MAXIFS(Claims[Score],Claims[Tier],1)');
    expect(createCalculator(imported)(imported.sheets[1].id, 'A1')).toBe(20);
    expect(createCalculator(imported)(imported.sheets[1].id, 'A2')).toBe(30);
  });
});
