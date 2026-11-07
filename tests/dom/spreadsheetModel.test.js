import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { createWorkbook, createSheet, setCell, cellAddress, columnName, parseCellAddress, translateFormula, sheetBounds, renameSheet } from '@/lib/spreadsheet/model';
import { createCalculator } from '@/lib/spreadsheet/formulas';
import { importWorkbook, exportXlsx, exportCsv, parseCsv } from '@/lib/spreadsheet/files';
const inputFile = (name, bytes) => ({ name, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), text: async () => new TextDecoder().decode(bytes) });
const csvFile = (text) => inputFile('test.csv', new TextEncoder().encode(text));
function workbook(entries) { const b = createWorkbook(); for (const [a, v] of entries) b.sheets[0] = setCell(b.sheets[0], a, v); return b; }

describe('Sparse spreadsheet model and formulas', () => {
  it('stores populated cells only and handles full Excel addresses', () => {
    const b = createWorkbook(), s = b.sheets[0];
    expect(s.rowCount).toBe(1200); expect(Object.keys(s.cells)).toHaveLength(0);
    expect(columnName(16383)).toBe('XFD'); expect(parseCellAddress('XFD1048576')).toEqual({ row: 1048575, col: 16383 });
    expect(parseCellAddress('XFE1')).toBeNull(); expect(parseCellAddress('A0')).toBeNull();
    const next = setCell(s, 'B1024', '8'); expect(s.cells).toEqual({}); expect(next.cells.B1024.v).toBe(8);
    expect(sheetBounds(next)).toEqual({ rows: 1024, columns: 2 });
    expect(setCell(next, 'B1024', '').cells).toEqual({});
    expect(setCell(s, 'A1', "'=SUM(B1)").cells.A1).toEqual({ v: '=SUM(B1)' });
  });
  it('calculates dependencies, cross-sheet references, ranges, absolute refs and lazy branches', () => {
    const b = workbook([['A1', 2], ['A2', 4], ['B1', '=SUM(A1:A2)*3'], ['B2', '=IF(A1>0,B1,1/0)'], ['B3', '=ROUND(AVERAGE(A1:A2)/7,3)'], ['C1', '=IFERROR(1/0,99)'], ['C2', '=COUNT(A1:A5)'], ['C3', '=COUNTA(A1:A5)']]);
    const second = createSheet('Evidence scores'); second.cells.A1 = { v: 7 }; b.sheets.push(second);
    b.sheets[0] = setCell(b.sheets[0], 'D1', "='Evidence scores'!$A$1+B1");
    b.sheets[0]=setCell(b.sheets[0],'D2','=COUNTIF(A1:A2,">2")');b.sheets[0]=setCell(b.sheets[0],'D3','=SUMIF(A1:A2,">2")');
    const calc = createCalculator(b), id = b.sheets[0].id;
    expect(calc(id,'D2')).toBe(1);expect(calc(id,'D3')).toBe(4);
    expect(calc(id, 'B1')).toBe(18); expect(calc(id, 'B2')).toBe(18); expect(calc(id, 'B3')).toBe(.429);
    expect(calc(id, 'C1')).toBe(99); expect(calc(id, 'C2')).toBe(2); expect(calc(id, 'C3')).toBe(2); expect(calc(id, 'D1')).toBe(25);
    expect(translateFormula('SUM($A1,B$2,"A1")', 3, 2)).toBe('SUM($A4,D$2,"A1")');
  });
  it('renames quoted and unquoted sheet references but preserves literal text and other sheet references', () => {
    const b=createWorkbook(), source=b.sheets[0];source.name='Scores';const other=createSheet('Other');other.cells.A1={f:'Scores!A1+scores!A2+\"Scores!A1\"'};other.cells.A2={f:"'Scores'!A1+Other!A1"};b.sheets.push(other);
    const next=renameSheet(b,source.id,"Paul's scores");
    expect(next.sheets[1].cells.A1.f).toBe("'Paul''s scores'!A1+'Paul''s scores'!A2+\"Scores!A1\"");
    expect(next.sheets[1].cells.A2.f).toBe("'Paul''s scores'!A1+Other!A1");expect(source.name).toBe('Scores');
    expect(()=>renameSheet(b,source.id,'Other')).toThrow(/unique/);
  });
  it('reports errors and cycles without executing JavaScript', () => {
    const b = workbook([['A1', '=A2'], ['A2', '=A1'], ['B1', '=1/0'], ['B2', '=MISSING(2)'], ['B3', '=globalThis.alert(1)'], ['B4', '=SQRT(-1)']]);
    const calc = createCalculator(b), id = b.sheets[0].id;
    expect(calc(id, 'A1')).toBe('#CYCLE!'); expect(calc(id, 'B1')).toBe('#DIV/0!'); expect(calc(id, 'B2')).toBe('#NAME?'); expect(calc(id, 'B3')).toBe('#NAME?'); expect(calc(id, 'B4')).toBe('#NUM!');
  });
});
describe('Spreadsheet file round trips', () => {
  it('imports CSV multiline quotes, Unicode, zeros and large identifiers without data loss', async () => {
    const rows = parseCsv('name,quote,id\r\n"α,β","first\nsecond ""quoted""",00123\r\n');
    expect(rows[1]).toEqual(['α,β', 'first\nsecond "quoted"', '00123']);
    const b = await importWorkbook(csvFile('name,code,big,value\nα,00123,123456789012345678,12.5'));
    expect(b.sheets[0].cells.B2.v).toBe('00123'); expect(b.sheets[0].cells.C2.v).toBe('123456789012345678'); expect(b.sheets[0].cells.D2.v).toBe(12.5);
    const again = await importWorkbook(csvFile(exportCsv(b.sheets[0], b)));
    expect(again.sheets[0].cells).toEqual(b.sheets[0].cells);
    expect(() => parseCsv('"unclosed')).toThrow(/unclosed/);
  });
  it('round trips 1024 rows, formulas, typed values, styles, multiple sheets, dimensions, merges and BEX links', async () => {
    const b = createWorkbook(), s = b.sheets[0];
    for (let r = 0; r < 1024; r++) { s.cells[cellAddress(r, 0)] = { v: r + 1 }; s.cells[cellAddress(r, 1)] = { f: `A${r + 1}*2` }; }
    s.cells.C1 = { v: 'Evidence α', style: { bold: true, background: '#335577', color: '#ffffff', align: 'center', wrap: true }, link: '/notes/test-12' };
    s.cells.C2 = { v: true }; s.cells.C3 = { f: 'SUM(A1:A1024)' }; s.columnWidths[0] = 250; s.rowHeights[0] = 42; s.merges = ['C4:D4']; s.freezeRows = 1;
    const second = createSheet('Second'); second.cells.A1 = { v: 'two sheets' }; b.sheets.push(second);
    const bytes = await exportXlsx(b), again = await importWorkbook(inputFile('research.xlsx', bytes));
    expect(again.sheets).toHaveLength(2); const imported = again.sheets[0];
    expect(imported.cells.A1024.v).toBe(1024); expect(imported.cells.B1024.f).toBe('A1024*2'); expect(imported.cells.C2.v).toBe(true);
    expect(imported.cells.C1.style).toMatchObject({ bold: true, background: '#335577', color: '#FFFFFF', align: 'center', wrap: true });
    expect(imported.cells.C1.link).toBe('/notes/test-12'); expect(imported.columnWidths[0]).toBe(250); expect(imported.rowHeights[0]).toBe(42); expect(imported.merges).toEqual(['C4:D4']); expect(imported.freezeRows).toBe(1);
    expect(createCalculator(again)(imported.id, 'C3')).toBe(524800); expect(Object.keys(imported.cells).length).toBeLessThan(2100);
    const twice = await importWorkbook(inputFile('twice.xlsx', await exportXlsx(again))); expect(twice.sheets[0].cells.B1024.f).toBe('A1024*2');
  });
  it('preserves original VBA and chart bytes while disclosing unsupported execution/rendering', async () => {
    const b = workbook([['A1', 5]]), zip = await JSZip.loadAsync(await exportXlsx(b));
    zip.file('xl/vbaProject.bin', new Uint8Array([1, 2, 3, 255])); zip.file('xl/charts/chart1.xml', '<chart>unchanged</chart>');
    const imported = await importWorkbook(inputFile('macros.xlsm', await zip.generateAsync({ type: 'uint8array' })));
    expect(imported.hasMacros).toBe(true); expect(imported.importWarnings.join(' ')).toMatch(/cannot execute/);
    const out = await JSZip.loadAsync(await exportXlsx(imported)); expect(await out.file('xl/vbaProject.bin').async('uint8array')).toEqual(new Uint8Array([1, 2, 3, 255])); expect(await out.file('xl/charts/chart1.xml').async('string')).toBe('<chart>unchanged</chart>');
  });
  it('keeps duplicate imported worksheets separate and preserves notes, dropdowns, rules and chart definitions', async () => {
    const base = workbook([['A1', 'original']]);
    const b = await importWorkbook(inputFile('source.xlsx', await exportXlsx(base)));
    const s = b.sheets[0];
    s.cells.A1.note = 'Primary source citation'; s.cells.A1.choices=['Strong','Weak'];
    s.conditionalRules=[{range:'A1:A10',greaterThan:3,color:'#115533'}];
    const copy={...s,id:crypto.randomUUID(),name:'Duplicate',cells:{A1:{v:'different'}}}; b.sheets.push(copy);
    b.charts=[{id:'chart',sheetId:s.id,range:'A1:B10',title:'Evidence'}];
    const bytes=await exportXlsx(b), again=await importWorkbook(inputFile('roundtrip.xlsx',bytes));
    expect(again.sheets[0].cells.A1.v).toBe('original');expect(again.sheets[1].cells.A1.v).toBe('different');
    expect(again.sheets[0].cells.A1.note).toBe('Primary source citation'); expect(again.sheets[0].cells.A1.choices).toEqual(['Strong','Weak']);
    expect(again.sheets[0].conditionalRules).toEqual(s.conditionalRules); expect(again.charts).toEqual(b.charts);
    const zip=await JSZip.loadAsync(bytes), sheetXml=await zip.file(again.sheets[0].sourcePath).async('string');
    expect(sheetXml).toContain('dataValidation');expect(sheetXml).toContain('conditionalFormatting');
    expect(await zip.file('xl/comments/bex-1.xml').async('string')).toContain('Primary source citation');
  });
  it('detects CSV delimiters outside quotes and expands imported dimensions for formatted empty cells', async () => {
    expect(parseCsv('"source;a;b",score\ntext,4')[0]).toEqual(['source;a;b','score']);
    const b=createWorkbook();b.sheets[0].columnWidths[39]=190;b.sheets[0].rowHeights[2000]=45;b.sheets[0].merges=['A3000:B3000'];
    const again=await importWorkbook(inputFile('empty-format.xlsx',await exportXlsx(b)));
    expect(again.sheets[0].columnCount).toBeGreaterThanOrEqual(40);expect(again.sheets[0].rowCount).toBeGreaterThanOrEqual(3000);
  });
  it('rejects unsupported, encrypted/invalid and oversized inputs with useful errors', async () => {
    await expect(importWorkbook(csvFile('a,b'))).resolves.toHaveProperty('sheets');
    await expect(importWorkbook(inputFile('x.xls', new Uint8Array()))).rejects.toThrow(/xlsx/);
    await expect(importWorkbook(inputFile('x.xlsx', new Uint8Array([1, 2])))).rejects.toThrow(/unencrypted/);
    await expect(importWorkbook({ name: 'x.xlsx', size: 21 * 1024 * 1024 })).rejects.toThrow(/20 MB/);
  });
});
