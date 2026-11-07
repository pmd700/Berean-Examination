import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import SpreadsheetEditor from '@/components/spreadsheet/SpreadsheetEditor';
import { createCalculator } from '@/lib/spreadsheet/formulas';
import { importWorkbook, exportXlsx, restoreWorkbookReferences } from '@/lib/spreadsheet/files';
import { setCell } from '@/lib/spreadsheet/model';

function report(book) {
  const start = performance.now(), calc = createCalculator(book), errors = [], differences = [];
  let formulas = 0;
  for (const sheet of book.sheets) for (const [address, cell] of Object.entries(sheet.cells)) {
    if (!cell.f) continue;
    formulas++;
    const result = calc(sheet.id, address);
    if (typeof result === 'string' && /^#/.test(result)) errors.push({ sheet: sheet.name, address, result });
    const same = typeof cell.v === 'number' && typeof result === 'number'
      ? Math.abs(cell.v - result) <= 1e-10 * Math.max(1, Math.abs(cell.v)) : cell.v === result;
    if (cell.v != null && !same) differences.push({ sheet: sheet.name, address, formula: cell.f, expected: cell.v, result });
  }
  const inventory = book.sheets.find(s => s.name === 'Inventory');
  return { formulas, errors, differences, tables: book.sheets.reduce((n,s) => n + (s.tables?.length || 0), 0), milliseconds: Math.round(performance.now() - start), ...(inventory ? { headline: ['B4','D4','F4','B5','F5','V8','V9'].map(a => [a,calc(inventory.id,a)]) } : {}) };
}
function Fixture() {
  const [record, setRecord] = React.useState(null);
  window.formulaProof = {
    load: async bytes => {
      const book = await importWorkbook(new File([new Uint8Array(bytes)], 'research.xlsx'));
      setRecord({ id: 1, title: 'Research workbook · formula verification', workbook: book });
      return report(book);
    },
    edit: (name, address, input) => {
      const book = { ...record.workbook, sheets: record.workbook.sheets.map(s => s.name === name ? setCell(s, address, input) : s) };
      setRecord({ ...record, workbook: book });
      return report(book);
    },
    read: (name,address) => { const sheet = record.workbook.sheets.find(s => s.name === name); return createCalculator(record.workbook)(sheet.id,address); },
    legacy: async () => {
      const legacy = { ...record.workbook }; delete legacy.referenceVersion; delete legacy.definedNames;
      legacy.sheets = legacy.sheets.map(s => { const copy = { ...s }; delete copy.tables; return copy; });
      const restored = await restoreWorkbookReferences(legacy);
      return { result: report(restored), unchanged: restored.sheets.every((s,i) => s.cells === legacy.sheets[i].cells) };
    },
    roundTrip: async () => {
      const bytes = await exportXlsx(record.workbook);
      const reimported = await importWorkbook(new File([bytes], 'verified.xlsx'));
      return { report: report(reimported), bytes: Array.from(bytes) };
    },
  };
  return record ? <SpreadsheetEditor record={record} onChange={patch => setRecord(current => ({ ...current, ...patch }))} onSave={async () => true} /> : <p>Opening workbook proof…</p>;
}
createRoot(document.getElementById('root')).render(<MemoryRouter><Fixture /></MemoryRouter>);
