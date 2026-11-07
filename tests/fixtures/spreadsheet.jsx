import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import SpreadsheetEditor from '@/components/spreadsheet/SpreadsheetEditor';
import { createWorkbook } from '@/lib/spreadsheet/model';
import { importWorkbook, exportXlsx } from '@/lib/spreadsheet/files';
import JSZip from 'jszip';

const initial = createWorkbook();
const sheet = initial.sheets[0];
sheet.name = 'Evidence sources';
sheet.columnWidths = { 0: 300, 1: 150, 2: 170, 3: 260 };
sheet.cells.A1 = { v: 'SOURCE / RECORD', style: { bold: true, color: '#6ee7b7', background: '#142c27' } };
sheet.cells.B1 = { v: 'SCORE', style: { bold: true, color: '#6ee7b7', background: '#142c27' } };
sheet.cells.C1 = { v: 'COMPARISON', style: { bold: true, color: '#6ee7b7', background: '#142c27' } };
sheet.cells.D1 = { v: 'RESEARCH NOTE', style: { bold: true, color: '#6ee7b7', background: '#142c27' } };
sheet.cells.A2 = { v: 'Synthetic independent source' };
sheet.cells.B2 = { v: 8 };
sheet.cells.C2 = { f: 'B2*2' };
sheet.cells.D2 = { v: 'Illustrative fixture data only.' };
sheet.cells.D8 = { v: 'A long synthetic source description can flow across empty cells, wrap onto several lines, or remain clipped within its own column.' };
for (let r = 4; r <= 1024; r++) {
  sheet.cells[`A${r}`] = { v: `SYNTHETIC-SOURCE-${r}` };
  sheet.cells[`B${r}`] = { v: r };
  sheet.cells[`C${r}`] = { f: `B${r}*2` };
}
function Fixture() {
  const [record, setRecord] = React.useState({ id: 1, title: 'Resurrection research · native proof', workbook: initial });
  const [saves, setSaves] = React.useState(0);
  window.sheetProof = {
    record: () => record,
    saves: () => saves,
    roundTrip: async () => {
      const bytes = await exportXlsx(record.workbook);
      const zip = await JSZip.loadAsync(bytes);
      for (const file of Object.values(zip.files).filter(f => /\.xml(?:\.rels)?$|\.rels$/.test(f.name))) {
        const xml = await file.async('string');
        const parsed = new DOMParser().parseFromString(xml, 'application/xml');
        if (parsed.getElementsByTagName('parsererror').length) return { errorFile: file.name, xml, error: parsed.getElementsByTagName('parsererror')[0].textContent };
      }
      const file = new File([bytes], 'native-proof.xlsx');
      const imported = await importWorkbook(file);
      return { rows: imported.sheets[0].rowCount, a3: imported.sheets[0].cells.A3, b3: imported.sheets[0].cells.B3, row1024: imported.sheets[0].cells.C1024, bytes: bytes.length };
    },
  };
  return <SpreadsheetEditor record={record} onChange={patch => setRecord(current => ({ ...current, ...patch }))} onSave={async () => { setSaves(n => n + 1); return true; }} />;
}
createRoot(document.getElementById('root')).render(<MemoryRouter><Fixture /></MemoryRouter>);
