import BackToMenu from '@/components/navigation/BackToMenu';
import React from 'react';
import { createPortal } from 'react-dom';
import SpreadsheetGrid from './SpreadsheetGrid';
import { Tool, ColorPicker, BorderPicker } from './SpreadsheetControls';
import { useNavigate } from 'react-router-dom';
import { Bold, Italic, Undo2, Redo2, Upload, Download, Plus, Search, Link2, MessageSquare, X, Check, ChevronDown, Table2, BarChart3, Printer, Save, AlignLeft, AlignCenter, AlignRight, Filter, ArrowDownAZ, ArrowUpAZ, Merge, Snowflake } from 'lucide-react';
import { toast } from 'sonner';
import { desktopClient } from '@/api/desktopClient';
import { saveExportFile } from '@/lib/saveExportFile';
import { registerPendingEditorSave } from '@/lib/pendingEditorSaves';
import { useIsActiveTab } from '@/lib/WorkspaceTabs';
import { libraryLinkHref } from '@/lib/libraryLinks';
import { createWorkbook, cellAddress, parseCellAddress, cellInput, setCell, translateFormula, renameSheet, copyCellRange, moveCellRange, duplicateSheet } from '@/lib/spreadsheet/model';
import { createCalculator } from '@/lib/spreadsheet/formulas';
import { importWorkbook, exportXlsx, exportCsv } from '@/lib/spreadsheet/files';
import './spreadsheet.css';

const HEADER = 30, GUTTER = 48, ROW = 28, COL = 132;
const EMPTY_CELL = Object.freeze({});
const safeColor = color => /^#[0-9a-f]{3,8}$/i.test(color || "") ? color : undefined;
const rid = () => globalThis.crypto.randomUUID();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const address = (r, c) => cellAddress(r, c);
const rangeOf = (selection) => ({ r0: Math.min(selection.row, selection.endRow), r1: Math.max(selection.row, selection.endRow), c0: Math.min(selection.col, selection.endCol), c1: Math.max(selection.col, selection.endCol) });
function offsetList(count, dimensions, fallback) { const out = [0]; for (let i = 0; i < count; i++) out.push(out[i] + (Number(dimensions?.[i]) || fallback)); return out; }
function firstAt(offsets, position) { let a = 0, b = offsets.length - 1; while (a < b) { const m = Math.floor((a + b + 1) / 2); if (offsets[m] <= position) a = m; else b = m - 1; } return a; }
function parseClipboard(text) {
  const rows = []; let row = [], value = '', quoted = false;
  for (let i=0;i<text.length;i++) {
    const c=text[i];
    if (c==='"' && (quoted || value==='')) { if (quoted && text[i+1]==='"') { value+='"'; i++; } else quoted=!quoted; }
    else if (!quoted && c==='\t') { row.push(value); value=''; }
    else if (!quoted && (c==='\r' || c==='\n')) { row.push(value); rows.push(row); row=[]; value=''; if(c==='\r' && text[i+1]==='\n') i++; }
    else value+=c;
  }
  if (value!=='' || row.length || !rows.length) { row.push(value); rows.push(row); }
  return rows;
}
function pretty(value, style) {
  if (value == null) return '';
  if (typeof value !== 'number') return String(value);
  if (!Number.isFinite(value)) return '#NUM!';
  const format = style?.numberFormat || '';
  if (format.includes('%')) return new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 2 }).format(value);
  if (format.includes('$')) return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(value);
  if (format === '0.00') return value.toFixed(2);
  return String(Number(value.toPrecision(12)));
}
function Dialog({ title, close, children }) { return <div className="sheet-overlay" onMouseDown={e => { if (e.target === e.currentTarget) close(); }} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') close(); }}><section role="dialog" aria-modal="true" aria-label={title} className="sheet-dialog"><header><h2>{title}</h2><Tool icon={X} title="Close dialog" onClick={close} /></header>{children}</section></div>; }

export default function SpreadsheetEditor({ record, onChange, onSave, status = 'saved', error = '', initialSheet, initialCell, initialView = null, onViewChange = null }) {
  const book = record.workbook || createWorkbook();
  const [sheetId, setSheetId] = React.useState(initialSheet || initialView?.sheetId || book.activeSheetId || book.sheets[0].id);
  const sheet = book.sheets.find(s => s.id === sheetId) || book.sheets[0];
  const [selection, setSelection] = React.useState(() => { const p = parseCellAddress(initialCell || initialView?.cell || 'A1') || { row: 0, col: 0 }; return { ...p, endRow: p.row, endCol: p.col }; });
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const [viewport, setViewport] = React.useState({ top: 0, left: 0, width: 1100, height: 600 });
  const [dialog, setDialog] = React.useState(null);
  const [details, setDetails] = React.useState(false);
  const [moving, setMoving] = React.useState(null);
  const moveState = React.useRef(null), moveActions = React.useRef(null);
  const [filter, setFilter] = React.useState('');
  const [find, setFind] = React.useState('');
  const [showFind, setShowFind] = React.useState(false);
  const [zoom, setZoom] = React.useState(initialView?.zoom || 100);
  const [busy, setBusy] = React.useState(false);
  const [links, setLinks] = React.useState([]);
  const [printMode, setPrintMode] = React.useState(false);
  const scroll = React.useRef(null), root = React.useRef(null), file = React.useRef(null), input = React.useRef(null);
  const editSession = React.useRef(false), formulaDirty = React.useRef(false), flushDraft = React.useRef(null);
  const drag = React.useRef(false), history = React.useRef({ undo: [], redo: [] }), latest = React.useRef(book);
  const active = useIsActiveTab();
  const navigate = useNavigate();
  latest.current = book;
  const calc = React.useMemo(() => createCalculator(book), [book]);
  const value = React.useCallback((r, c) => calc(sheet.id, address(r, c)), [calc, sheet.id]);
  const currentAddress = address(selection.row, selection.col);
  const currentCell = sheet.cells[currentAddress] || EMPTY_CELL;
  const selected = rangeOf(selection);
  const scale = zoom / 100;
  const columns = offsetList(sheet.columnCount, Object.fromEntries(Object.entries(sheet.columnWidths || {}).map(([k, v]) => [k, v * scale])), COL * scale);
  const rows = React.useMemo(() => {
    const indices = Array.from({ length: sheet.rowCount }, (_, i) => i);
    if (!filter) return indices;
    const matches = new Set();
    for (const [a] of Object.entries(sheet.cells)) {
      const p = parseCellAddress(a);
      if (String(calc(sheet.id, a)).toLocaleLowerCase().includes(filter.toLocaleLowerCase())) matches.add(p.row);
    }
    return indices.filter(i => matches.has(i) || (sheet.hasHeader && i === 0));
  }, [sheet, filter, calc]);
  const wrappedHeights = new Map();
  for (const [a, cell] of Object.entries(sheet.cells)) {
    if ((cell.style?.textMode || (cell.style?.wrap ? 'wrap' : 'overflow')) !== 'wrap') continue;
    const point = parseCellAddress(a); if (!point) continue;
    const text = String(calc(sheet.id,a) ?? '');
    const width = Math.max(20,(sheet.columnWidths?.[point.col] || COL)-14);
    const lines = text.split('\n').reduce((count,line)=>count+Math.max(1,Math.ceil([...line].length*7.5/width)),0);
    wrappedHeights.set(point.row,Math.min(800,Math.max(wrappedHeights.get(point.row)||ROW,lines*19+8)));
  }
  const heights = rows.map(r => Math.max(sheet.rowHeights?.[r] || ROW, wrappedHeights.get(r)||ROW) * scale);
  const rowOffsets = [0]; for (const h of heights) rowOffsets.push(rowOffsets.at(-1) + h);
  const startRow = Math.max(0, firstAt(rowOffsets, viewport.top - HEADER) - 3);
  const endRow = Math.min(rows.length, firstAt(rowOffsets, viewport.top + viewport.height) + 4);
  const startCol = Math.max(0, firstAt(columns, viewport.left - GUTTER) - 2);
  const endCol = Math.min(sheet.columnCount, firstAt(columns, viewport.left + viewport.width) + 3);
  const renderRows = [...new Set([...Array.from({ length: Math.min(sheet.freezeRows || 0, rows.length) }, (_, i) => i), ...Array.from({ length: Math.max(0, endRow - startRow) }, (_, i) => i + startRow)])];
  const renderCols = [...new Set([...Array.from({ length: Math.min(sheet.freezeColumns || 0, sheet.columnCount) }, (_, i) => i), ...Array.from({ length: endCol - startCol }, (_, i) => i + startCol)])];
  const commitBook = React.useCallback(next => {
    const previous = latest.current;
    if (next === previous) return;
    history.current.undo.push(previous); if (history.current.undo.length > 50) history.current.undo.shift(); history.current.redo = [];
    latest.current = next; onChange({ workbook: next });
  }, [onChange]);
  const changeSheet = (next) => commitBook({ ...latest.current, sheets: latest.current.sheets.map(s => s.id === next.id ? next : s) });
  const undo = (redo = false) => {
    const from = redo ? history.current.redo : history.current.undo, to = redo ? history.current.undo : history.current.redo;
    if (!from.length) return; to.push(latest.current); const next = from.pop(); latest.current = next; onChange({ workbook: next }); setEditing(false);
  };
  const focusCell = (r, c, extend = false) => {
    if (editSession.current || formulaDirty.current) commitInput();
    r = clamp(r, 0, 1048575); c = clamp(c, 0, 16383);
    setSelection(prev => extend ? { ...prev, endRow: r, endCol: c } : { row: r, col: c, endRow: r, endCol: c });
    setEditing(false);
    const index = rows.indexOf(r), el = scroll.current;
    if (el && index >= 0) {
      if (rowOffsets[index] < el.scrollTop) el.scrollTop = rowOffsets[index];
      else if (rowOffsets[index + 1] > el.scrollTop + el.clientHeight - HEADER) el.scrollTop = rowOffsets[index + 1] - el.clientHeight + HEADER;
      if (columns[c] < el.scrollLeft) el.scrollLeft = columns[c];
      else if (columns[c + 1] > el.scrollLeft + el.clientWidth - GUTTER) el.scrollLeft = columns[c + 1] - el.clientWidth + GUTTER;
    }
    if (el) setViewport(v => ({ ...v, top: el.scrollTop, left: el.scrollLeft }));
    root.current?.focus({ preventScroll: true });
  };
  const commitInput = (text = draft, move = null) => {
    editSession.current = false; formulaDirty.current = false;
    if (String(text) !== String(cellInput(currentCell))) changeSheet(setCell(sheet, currentAddress, text)); setEditing(false);
    if (move) focusCell(selection.row + move[0], selection.col + move[1]);
  };
  flushDraft.current = () => { if (editSession.current || formulaDirty.current) { commitInput(); return true; } return false; };
  React.useEffect(() => registerPendingEditorSave(async () => { const changed = flushDraft.current?.(); if (changed) await onSave(); return changed; }), [onSave]);
  React.useEffect(() => { if (!editing) setDraft(cellInput(currentCell)); }, [currentAddress, currentCell, editing]);
  React.useLayoutEffect(() => {
    if (!editing || !input.current) return;
    input.current.focus({preventScroll:true});
    const end=input.current.value.length; input.current.setSelectionRange(end,end);
  }, [editing,currentAddress]);
  React.useEffect(() => {
    const el = scroll.current; if (!el) return;
    const measure = () => setViewport(v => ({ ...v, width: el.clientWidth, height: el.clientHeight }));
    measure(); const observer = new ResizeObserver(measure); observer.observe(el); return () => observer.disconnect();
  }, []);
  React.useEffect(() => {
    if (!active) return;
    const key = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f' && !e.shiftKey) { e.preventDefault(); e.stopImmediatePropagation(); setShowFind(v => !v); }
    };
    window.addEventListener('keydown', key, true); return () => window.removeEventListener('keydown', key, true);
  }, [active]);
  React.useEffect(() => {
    const move = e => { if (!drag.current) return; const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-sheet-cell]'); if (el) setSelection(v => ({ ...v, endRow: Number(el.dataset.row), endCol: Number(el.dataset.col) })); };
    const up = () => { drag.current = false; };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, []);
  React.useLayoutEffect(() => {
    if (initialSheet && book.sheets.some(s => s.id === initialSheet) && sheet.id !== initialSheet) { setSheetId(initialSheet); return; }
    const p = parseCellAddress(initialCell || initialView?.cell || 'A1');
    if (!p) return;
    setSelection({ ...p, endRow: p.row, endCol: p.col });
    const el = scroll.current, index = rows.indexOf(p.row);
    if (el && index >= 0) {
      el.scrollTop = Math.max(0, !initialCell && initialView ? initialView.top || 0 : rowOffsets[index] - 60);
      el.scrollLeft = Math.max(0, !initialCell && initialView ? initialView.left || 0 : columns[p.col] - 100);
      setViewport(v => ({ ...v, top: el.scrollTop, left: el.scrollLeft }));
    }
  }, [initialSheet, initialCell, sheet.id]);
  React.useEffect(() => {
    if (!onViewChange) return;
    const view = { sheetId: sheet.id, cell: currentAddress, top: viewport.top, left: viewport.left, zoom };
    const timer = setTimeout(() => onViewChange(view), 220);
    return () => { clearTimeout(timer); onViewChange(view); };
  }, [onViewChange, sheet.id, currentAddress, viewport.top, viewport.left, zoom]);
  const applyToRange = fn => {
    const cells = { ...sheet.cells };
    if ((selected.r1 - selected.r0 + 1) * (selected.c1 - selected.c0 + 1) > 100000) { toast.error('Select up to 100,000 cells for this operation.'); return; }
    for (let r = selected.r0; r <= selected.r1; r++) for (let c = selected.c0; c <= selected.c1; c++) { const a = address(r, c); const next = fn({ ...cells[a] }, r, c); if (next) cells[a] = next; else delete cells[a]; }
    changeSheet({ ...sheet, cells });
  };
  const style = patch => applyToRange(cell => ({ ...cell, style: { ...cell.style, ...patch } }));
  const paste = text => {
    // Quoted tabs and newlines survive rectangular text paste.
    const lines = parseClipboard(text);
    if (lines.length * Math.max(...lines.map(r => r.length)) > 100000) { toast.error('Paste up to 100,000 cells at a time.'); return; }
    let next = sheet;
    lines.forEach((line, y) => line.forEach((inputValue, x) => { const r = selection.row + y, c = selection.col + x; if (r < 1048576 && c < 16384) next = setCell(next, address(r, c), inputValue); }));
    changeSheet({ ...next, rowCount: Math.max(next.rowCount, selection.row + lines.length), columnCount: Math.max(next.columnCount, selection.col + Math.max(...lines.map(r => r.length))) });
    setSelection(v => ({ ...v, endRow: v.row + lines.length - 1, endCol: v.col + lines[0].length - 1 }));
  };
  const clipboardText = () => {
    if ((selected.r1-selected.r0+1)*(selected.c1-selected.c0+1)>100000) throw new Error('Copy up to 100,000 cells at a time.');
    const out = []; for (let r = selected.r0; r <= selected.r1; r++) { const row = []; for (let c = selected.c0; c <= selected.c1; c++) { const text = pretty(value(r, c), sheet.cells[address(r, c)]?.style); row.push(/[\t\r\n"]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text); } out.push(row.join('\t')); } return out.join('\n');
  };
  const resize = (e, axis, index) => {
    e.preventDefault(); e.stopPropagation();
    const begin = axis === 'column' ? e.clientX : e.clientY;
    const key = axis === 'column' ? 'columnWidths' : 'rowHeights';
    const previous = sheet[key]?.[index] || (axis === 'column' ? COL : ROW);
    let final = previous;
    const move = ev => { final = clamp(previous + ((axis === 'column' ? ev.clientX : ev.clientY) - begin) / scale, axis === 'column' ? 36 : 20, axis === 'column' ? 1600 : 800); latest.current = { ...book, sheets: book.sheets.map(s => s.id === sheet.id ? { ...sheet, [key]: { ...sheet[key], [index]: final } } : s) }; onChange({ workbook: latest.current }); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); history.current.undo.push(book); history.current.redo = []; };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const sort = descending => {
    const occupiedRows = [...new Set(Object.keys(sheet.cells).map(a => parseCellAddress(a).row))].filter(r => r >= Math.max(sheet.freezeRows || 0, sheet.hasHeader ? 1 : 0)).sort((a, b) => a - b);
    const sorted = [...occupiedRows].sort((a, b) => { const x = value(a, selection.col), y = value(b, selection.col); return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * (descending ? -1 : 1); });
    const mapping = new Map(sorted.map((r, i) => [r, occupiedRows[i]]));
    const cells = {};
    for (const [a, cell] of Object.entries(sheet.cells)) { const p = parseCellAddress(a), r = mapping.get(p.row) ?? p.row; cells[address(r, p.col)] = { ...cell, ...(cell.f ? { f: translateFormula(cell.f, r - p.row, 0) } : {}) }; }
    changeSheet({ ...sheet, cells });
  };
  const fillDown = () => applyToRange((cell, r, c) => { const source = sheet.cells[address(selected.r0, c)]; return source ? { ...source, ...(source.f ? { f: translateFormula(source.f, r - selected.r0, 0) } : {}) } : null; });
  const loadFile = async incoming => {
    if (!incoming) return; setBusy(true);
    try { const next = await importWorkbook(incoming); commitBook(next); setSheetId(next.sheets[0].id); setSelection({ row: 0, col: 0, endRow: 0, endCol: 0 }); setFilter(''); setDialog(next.importWarnings?.length ? 'importReport' : null); toast.success(`Imported ${next.sheets.length} sheet${next.sheets.length === 1 ? '' : 's'}.`); }
    catch (e) { toast.error(e.message || 'Could not import this workbook.'); } finally { setBusy(false); if (file.current) file.current.value = ''; }
  };
  const download = async format => {
    setBusy(true);
    try {
      if (format !== 'csv' && book.charts?.length) toast('BEX charts stay editable in BEX; Excel receives their source cells, not native Excel charts.');
      flushDraft.current?.(); await onSave();
      const macro = Boolean(book.hasMacros);
      const ext = format === 'csv' ? 'csv' : macro ? 'xlsm' : 'xlsx';
      const data = format === 'csv' ? exportCsv(sheet, book) : await exportXlsx(book);
      const result = await saveExportFile(new Blob([data], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${(record.title || 'Spreadsheet').replace(/[/\\:*?"<>|]/g, '-')}.${ext}`);
      if (result.status === 'saved') toast.success('Spreadsheet exported.');
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const copyLink = async () => {
    const path = `/spreadsheets/${record.id}?sheet=${encodeURIComponent(sheet.id)}&cell=${currentAddress}`;
    try { await navigator.clipboard.writeText(new URL(path, window.location.href).href); toast.success(`Link to ${sheet.name}!${currentAddress} copied.`); } catch { toast.error('Could not copy link.'); }
  };
  const switchSheet = id => { flushDraft.current?.(); setSheetId(id); commitBook({ ...latest.current, activeSheetId: id }); setSelection({ row: 0, col: 0, endRow: 0, endCol: 0 }); setFilter(''); setEditing(false); if (scroll.current) { scroll.current.scrollTop = 0; scroll.current.scrollLeft = 0; } };
  const addSheet = () => { flushDraft.current?.(); const book = latest.current; const next = createWorkbook().sheets[0]; const names = new Set(book.sheets.map(s => s.name)); let n = book.sheets.length + 1; while (names.has(`Sheet ${n}`)) n++; next.name = `Sheet ${n}`; commitBook({ ...book, sheets: [...book.sheets, next], activeSheetId: next.id }); setSheetId(next.id); };
  const numbers = Object.entries(sheet.cells).filter(([a]) => { const p = parseCellAddress(a); return p.row >= selected.r0 && p.row <= selected.r1 && p.col >= selected.c0 && p.col <= selected.c1; }).map(([a]) => calc(sheet.id, a)).filter(v => typeof v === 'number' && Number.isFinite(v));
  const mergeRange = `${address(selected.r0, selected.c0)}:${address(selected.r1, selected.c1)}`;
  const merges = (sheet.merges || []).map(text => { const [a, b = a] = text.split(':').map(parseCellAddress); return { a, b }; }).filter(m => m.a && m.b);
  const styleOf = cell => ({ fontWeight: cell?.style?.bold ? 700 : undefined, fontStyle: cell?.style?.italic ? 'italic' : undefined, color: safeColor(cell?.style?.color), backgroundColor: safeColor(cell?.style?.background), textAlign: cell?.style?.align || (typeof cell?.v === 'number' || cell?.f ? 'right' : 'left'), whiteSpace: (cell?.style?.textMode==='wrap'||(!cell?.style?.textMode&&cell?.style?.wrap)) ? 'pre-wrap' : 'nowrap', alignItems:({top:'flex-start',middle:'center',bottom:'flex-end'})[cell?.style?.verticalAlign||'middle'], fontSize: 13 * scale });
  const findNext = () => { const matches = Object.keys(sheet.cells).filter(a => String(calc(sheet.id, a)).toLowerCase().includes(find.toLowerCase())).sort((a, b) => { const p = parseCellAddress(a), q = parseCellAddress(b); return p.row - q.row || p.col - q.col; }); const i = matches.indexOf(currentAddress); if (matches.length) { const p = parseCellAddress(matches[(i + 1) % matches.length]); focusCell(p.row, p.col); } else toast('No matching cells.'); };
  const openLinks = async () => {
    setDetails(false); setDialog('links');
    const kinds = [['note', 'MindNote'], ['web', 'KnowledgeWeb'], ['timeline', 'Timegraph'], ['spreadsheet', 'Spreadsheet']];
    const results = await Promise.allSettled(kinds.map(async ([kind, entity]) => (await desktopClient.entities[entity].list()).filter(r => !r.is_private).map(r => ({ id: r.id, kind, title: r.title || `Untitled ${kind}` }))));
    setLinks(results.flatMap(r => r.status === 'fulfilled' ? r.value : []));
  };
  const charts = book.charts || [];
  const renderChart = chart => {
    const target = book.sheets.find(s => s.id === chart.sheetId); if (!target) return null;
    const [a, b] = chart.range.split(':').map(parseCellAddress); if (!a || !b) return null;
    const data = []; for (let r = a.row; r <= Math.min(b.row, a.row + 39); r++) { const number = calc(target.id, address(r, b.col)); if (typeof number === 'number') data.push({ label: String(calc(target.id, address(r, a.col))), number }); }
    const max = Math.max(...data.map(d => Math.abs(d.number)), 1);
    return <div className="sheet-chart" key={chart.id}><h3>{chart.title || 'Chart'}</h3>{data.length ? data.map((d, i) => <div className="sheet-bar" key={i}><span title={d.label}>{d.label}</span><i style={{ width: `${Math.abs(d.number) / max * 65}%`, background: d.number < 0 ? '#f87171' : '#34d399' }} /><b>{pretty(d.number)}</b></div>) : <p>Select labels in the first column and numbers in the last column.</p>}<Tool onClick={() => commitBook({ ...book, charts: charts.filter(c => c.id !== chart.id) })}>Remove chart</Tool></div>;
  };
  const applyBorders = ({pattern,width,color}) => applyToRange((cell,r,c)=>{
    const borders={...cell.style?.borders};
    if(pattern==='none') return {...cell,style:{...cell.style,borders:{}}};
    const sides={top:pattern==='all'||pattern==='top'||(pattern==='outer'&&r===selected.r0)||(pattern==='inner'&&r>selected.r0),bottom:pattern==='all'||pattern==='bottom'||(pattern==='outer'&&r===selected.r1)||(pattern==='inner'&&r<selected.r1),left:pattern==='all'||pattern==='left'||(pattern==='outer'&&c===selected.c0)||(pattern==='inner'&&c>selected.c0),right:pattern==='all'||pattern==='right'||(pattern==='outer'&&c===selected.c1)||(pattern==='inner'&&c<selected.c1)};
    for(const [side,apply] of Object.entries(sides))if(apply)borders[side]={width,color};
    return {...cell,style:{...cell.style,borders}};
  });
  const copySelection = e => {
    if(editing||/INPUT|TEXTAREA/.test(e.target.tagName))return;
    e.preventDefault();
    try { const snapshot=copyCellRange(sheet,selected);e.clipboardData.setData('text/plain',clipboardText());e.clipboardData.setData('application/x-bex-cells',JSON.stringify({...snapshot,version:2,sheetId:sheet.id,row:selected.r0,col:selected.c0})); }
    catch(err){toast.error(err.message);}
  };
  const pasteSelection = e => {
    if(editing||/INPUT|TEXTAREA/.test(e.target.tagName))return;
    e.preventDefault();const rich=e.clipboardData.getData('application/x-bex-cells');
    if(rich){try{
      const data=JSON.parse(rich);
      if(data.version!==2)throw new Error('Use plain text for older clipboard data.');
      if(!Number.isInteger(data.rows)||!Number.isInteger(data.columns)||data.rows<1||data.columns<1||data.rows*data.columns>100000||!data.cells||typeof data.cells!=='object')throw new Error('Invalid clipboard rectangle.');
      const rowsToPaste=(selected.r1-selected.r0+1)%data.rows===0?Math.max(data.rows,selected.r1-selected.r0+1):data.rows;
      const colsToPaste=(selected.c1-selected.c0+1)%data.columns===0?Math.max(data.columns,selected.c1-selected.c0+1):data.columns;
      if(rowsToPaste*colsToPaste>100000||selected.r0+rowsToPaste>1048576||selected.c0+colsToPaste>16384)throw new Error('Clipboard rectangle exceeds the sheet limits.');
      const cells={...sheet.cells};
      for(let y=0;y<rowsToPaste;y++)for(let x=0;x<colsToPaste;x++){
        const r=selected.r0+y,c=selected.c0+x,a=address(r,c),rel=address(y%data.rows,x%data.columns),cell=data.cells[rel];
        delete cells[a];
        if(cell&&typeof cell==='object'&&!Array.isArray(cell)){
          const cloned=JSON.parse(JSON.stringify(cell));
          if(cloned.v!=null&&!['string','number','boolean'].includes(typeof cloned.v))throw new Error('Invalid clipboard value.');
          if(cloned.f!=null&&typeof cloned.f!=='string')throw new Error('Invalid clipboard formula.');
          if(cloned.choices&&!Array.isArray(cloned.choices))delete cloned.choices;
          if(cloned.f)cloned.f=translateFormula(cloned.f,r-(data.row+y%data.rows),c-(data.col+x%data.columns));
          cells[a]=cloned;
        }
      }
      changeSheet({...sheet,cells,rowCount:Math.max(sheet.rowCount,selected.r0+rowsToPaste),columnCount:Math.max(sheet.columnCount,selected.c0+colsToPaste)});
      setSelection({row:selected.r0,col:selected.c0,endRow:selected.r0+rowsToPaste-1,endCol:selected.c0+colsToPaste-1});return;
    }catch(err){toast.error(err.message);return;}}
    paste(e.clipboardData.getData('text/plain'));
  };
  const targetAt=(event,state)=>{
    const el=scroll.current,box=el.getBoundingClientRect();
    const hit=document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-sheet-cell]');
    if(hit&&hit.closest('.sheet-scroll')===el){const row=Number(hit.dataset.row),col=Number(hit.dataset.col);return{targetRow:clamp(row-(state.grabRow-state.range.r0),0,Math.max(0,sheet.rowCount-(state.range.r1-state.range.r0+1))),targetCol:clamp(col-(state.grabCol-state.range.c0),0,Math.max(0,sheet.columnCount-(state.range.c1-state.range.c0+1))) };}
    const frozenW=columns[sheet.freezeColumns||0]||0,frozenH=rowOffsets[sheet.freezeRows||0]||0;
    const x=event.clientX-box.left-GUTTER+(event.clientX-box.left<GUTTER+frozenW?0:el.scrollLeft);
    const y=event.clientY-box.top-HEADER+(event.clientY-box.top<HEADER+frozenH?0:el.scrollTop);
    const index=clamp(firstAt(rowOffsets,Math.max(0,y)),0,rows.length-1),col=clamp(firstAt(columns,Math.max(0,x)),0,sheet.columnCount-1);
    return {targetRow:clamp(rows[index]-(state.grabRow-state.range.r0),0,Math.max(0,sheet.rowCount-(state.range.r1-state.range.r0+1))),targetCol:clamp(col-(state.grabCol-state.range.c0),0,Math.max(0,sheet.columnCount-(state.range.c1-state.range.c0+1)))};
  };
  const startMove=(e,r,c)=>{
    e.preventDefault();e.stopPropagation();drag.current=false;
    try{copyCellRange(sheet,selected);}catch(err){toast.error(err.message);return;}
    const next={range:{...selected},grabRow:r,grabCol:c,startX:e.clientX,startY:e.clientY,x:e.clientX,y:e.clientY,targetRow:selected.r0,targetCol:selected.c0,active:false};moveState.current=next;
  };
  moveActions.current={move:event=>{
    const state=moveState.current;if(!state)return;
    const active=state.active||Math.hypot(event.clientX-state.startX,event.clientY-state.startY)>3;
    const el=scroll.current,box=el.getBoundingClientRect();
    const valid=box.width===0||(event.clientX>=box.left+GUTTER&&event.clientX<=box.right&&event.clientY>=box.top+HEADER&&event.clientY<=box.bottom);
    const next={...state,active,valid,x:event.clientX,y:event.clientY,...targetAt(event,state)};moveState.current=next;setMoving(next);
    if(event.clientY>box.bottom-25)el.scrollTop+=ROW;else if(event.clientY<box.top+HEADER+20)el.scrollTop-=ROW;
    if(event.clientX>box.right-25)el.scrollLeft+=COL/2;else if(event.clientX<box.left+GUTTER+20)el.scrollLeft-=COL/2;
  },drop:()=>{
    const state=moveState.current;moveState.current=null;setMoving(null);
    if(!state?.active||state.valid===false||(state.targetRow===state.range.r0&&state.targetCol===state.range.c0))return;
    try{commitBook(moveCellRange(latest.current,sheet.id,state.range,state.targetRow,state.targetCol));setSelection({row:state.targetRow,col:state.targetCol,endRow:state.targetRow+state.range.r1-state.range.r0,endCol:state.targetCol+state.range.c1-state.range.c0});root.current?.focus({preventScroll:true});}
    catch(err){toast.error(err.message);}
  }};
  React.useEffect(()=>{
    const move=e=>moveActions.current?.move(e),up=()=>moveActions.current?.drop(),cancel=()=>{moveState.current=null;setMoving(null);};
    const escape=e=>{if(e.key==='Escape'&&moveState.current){e.preventDefault();cancel();}};
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',cancel);window.addEventListener('keydown',escape,true);
    return()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',cancel);window.removeEventListener('keydown',escape,true);};
  },[]);
  const renderCell=(r,c,position)=>{
    const {index}=position,a=address(r,c),cell=sheet.cells[a],isSelected=r>=selected.r0&&r<=selected.r1&&c>=selected.c0&&c<=selected.c1;
    const merging=merges.find(m=>r>=m.a.row&&r<=m.b.row&&c>=m.a.col&&c<=m.b.col);
    if(merging&&(r!==merging.a.row||c!==merging.a.col))return null;
    const result=value(r,c),mode=cell?.style?.textMode||(cell?.style?.wrap?'wrap':'overflow');
    const width=merging?columns[merging.b.col+1]-columns[c]:position.width;
    const height=merging?rowOffsets[Math.min(rows.length,index+merging.b.row-r+1)]-rowOffsets[index]:position.height;
    const rule=(sheet.conditionalRules||[]).find(rule=>{const [from,to]=rule.range.split(':').map(parseCellAddress);return from&&to&&r>=from.row&&r<=to.row&&c>=from.col&&c<=to.col&&typeof result==='number'&&result>rule.greaterThan;});
    const borders={};for(const side of ['top','bottom','left','right']){const border=cell?.style?.borders?.[side];if(border&&safeColor(border.color)&&[1,2,3,4].includes(border.width))borders[`border${side[0].toUpperCase()+side.slice(1)}`]=`${border.width}px solid ${border.color}`;}
    const hasText=result!==''&&result!=null;
    let spaceLeft=width,spaceRight=width;
    if(mode==='overflow'&&hasText&&!merging){
      for(let next=c+1;next<sheet.columnCount;next++){const other=sheet.cells[address(r,next)];if(other?.f||other?.v!=null&&other.v!=='')break;spaceRight+=columns[next+1]-columns[next];if(spaceRight>5000)break;}
      for(let next=c-1;next>=0;next--){const other=sheet.cells[address(r,next)];if(other?.f||other?.v!=null&&other.v!=='')break;spaceLeft+=columns[next+1]-columns[next];if(spaceLeft>5000)break;}
    }
    const align=cell?.style?.align||(typeof result==='number'?'right':'left');
    const overflowWidth=align==='left'?spaceRight:align==='right'?spaceLeft:2*Math.min(spaceRight-width/2,spaceLeft-width/2);
    const textStyle=mode==='overflow'?{width:Math.max(width,overflowWidth)-14,flexShrink:0,transform:align==='right'?`translateX(-${overflowWidth-width}px)`:align==='center'?`translateX(-${(overflowWidth-width)/2}px)`:undefined}:undefined;
    const drop=moving?.active&&r>=moving.targetRow&&r<=moving.targetRow+moving.range.r1-moving.range.r0&&c>=moving.targetCol&&c<=moving.targetCol+moving.range.c1-moving.range.c0;
    return <div key={a} role="gridcell" aria-rowindex={r+1} aria-colindex={c+1} aria-selected={isSelected} data-sheet-cell={a} data-row={r} data-col={c} data-text-mode={mode} className={`sheet-cell ${isSelected?'selected':''} ${a===currentAddress?'current':''} ${drop?'drop-target':''} ${find&&String(result).toLowerCase().includes(find.toLowerCase())?'found':''}`} style={{...styleOf(cell),...borders,...(rule?{backgroundColor:safeColor(rule.color)}:{}),left:position.left,top:position.top,width,height,overflow:mode==='overflow'?'visible':'hidden',zIndex:hasText||isSelected?3:1,textAlign:align}}
      onPointerDown={e=>{if(editing&&a===currentAddress)return;e.preventDefault();focusCell(r,c,e.shiftKey);drag.current=true;}}
      onDoubleClick={()=>{setDraft(cellInput(cell));editSession.current=true;setEditing(true);}}>
      {editing&&a===currentAddress?<textarea aria-label={`Edit ${a}`} ref={input} autoFocus value={draft} onChange={e=>setDraft(e.target.value)} onBlur={()=>{if(editSession.current)commitInput();}} onKeyDown={e=>{e.stopPropagation();if(e.key==='Enter'&&!e.altKey){e.preventDefault();commitInput(draft,[e.shiftKey?-1:1,0]);}else if(e.key==='Tab'){e.preventDefault();commitInput(draft,[0,e.shiftKey?-1:1]);}else if(e.key==='Escape'){editSession.current=false;setDraft(cellInput(cell));setEditing(false);root.current?.focus();}}}/>:<><span className="sheet-cell-text" style={textStyle}>{pretty(result,cell?.style)}</span>{cell?.note&&<button type="button" className="sheet-note-mark" aria-label={`Comment on ${a}`} onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();focusCell(r,c);setDetails(true);}}/>}{cell?.link&&<a href={cell.link} title="Open linked BEX item" onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.preventDefault();e.stopPropagation();if(cell.link.startsWith('/'))navigate(cell.link);else if(/^https?:\/\//.test(cell.link))window.bexDesktop?.openExternalUrl?.(cell.link);}}><Link2 size={11}/></a>}{Array.isArray(cell?.choices)&&a===currentAddress&&<select aria-label={`Choose ${a}`} value={cell.v||''} onPointerDown={e=>e.stopPropagation()} onChange={e=>commitInput(e.target.value)}><option value=""/>{cell.choices.map(choice=><option key={choice}>{choice}</option>)}</select>}</>}
      {isSelected&&!editing&&[['top',r===selected.r0],['bottom',r===selected.r1],['left',c===selected.c0],['right',c===selected.c1]].filter(([,show])=>show).map(([edge])=><div key={edge} className={`sheet-move-edge ${edge}`} data-edge={edge} title="Drag selected cells" onPointerDown={e=>startMove(e,r,c)}/>)}
    </div>;
  };
  return <div className="bex-spreadsheet" data-testid="spreadsheet-editor" ref={root} tabIndex={0}
    onCopy={copySelection}
    onPaste={pasteSelection}
    onKeyDown={e => {
      if (dialog || details || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); setSelection({ row:0,col:0,endRow:sheet.rowCount-1,endCol:sheet.columnCount-1 }); return; }
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(e.shiftKey); return; }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); void onSave().catch(() => {}); return; }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); fillDown(); return; }
      if (mod && ['b', 'i'].includes(e.key.toLowerCase())) { e.preventDefault(); const field = e.key.toLowerCase() === 'b' ? 'bold' : 'italic'; style({ [field]: !currentCell.style?.[field] }); return; }
      const directions = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], Tab: [0, e.shiftKey ? -1 : 1], Enter: [e.shiftKey ? -1 : 1, 0] };
      if (directions[e.key]) { e.preventDefault(); const [dr, dc] = directions[e.key]; focusCell((e.shiftKey && e.key.startsWith('Arrow') ? selection.endRow : selection.row) + dr, (e.shiftKey && e.key.startsWith('Arrow') ? selection.endCol : selection.col) + dc, e.shiftKey && e.key.startsWith('Arrow')); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); applyToRange(cell => { const { v, f, ...rest } = cell; return Object.keys(rest).length ? rest : null; }); }
      else if (e.key === 'F2') { e.preventDefault(); setDraft(cellInput(currentCell)); editSession.current = true; setEditing(true); }
      else if (!mod && !e.altKey && e.key.length === 1) { e.preventDefault(); setDraft(e.key); editSession.current = true; setEditing(true); }
    }}>
    <header className="sheet-heading"><BackToMenu /><span className="sheet-logo"><Table2 size={20} /></span><input aria-label="Spreadsheet title" value={record.title || ''} placeholder="Untitled spreadsheet" onChange={e => onChange({ title: e.target.value })} /><span className={`sheet-save ${status}`}>{status === 'saved' ? <Check size={13} /> : <Save size={13} />}{status === 'error' ? 'Save failed' : status === 'unsaved' ? 'Unsaved' : status === 'saving' ? 'Saving…' : 'Saved'}</span><div className="sheet-heading-actions"><Tool icon={Link2} title="Copy link to selected cell" onClick={copyLink}>Link</Tool><Tool icon={Upload} onClick={() => file.current?.click()} disabled={busy}>Import</Tool><Tool icon={Download} onClick={() => download('xlsx')} disabled={busy}>Excel</Tool><Tool onClick={() => download('csv')} title="Export current sheet values as CSV (formatting and formulas require Excel export)" disabled={busy}>CSV</Tool><Tool icon={Printer} title="Print sheet" onClick={() => { setPrintMode(true); setTimeout(() => { window.print(); setPrintMode(false); }, 100); }} /></div><input hidden ref={file} type="file" accept=".xlsx,.csv,.xlsm" data-testid="spreadsheet-import" onChange={e => loadFile(e.target.files[0])} /></header>
    {error && <div role="alert" className="sheet-alert">{error}<Tool onClick={() => { flushDraft.current?.(); void onSave().catch(() => {}); }}>Retry save</Tool></div>}
    <nav className="sheet-toolbar" aria-label="Spreadsheet tools"><Tool icon={Undo2} title="Undo" onClick={() => undo()} /><Tool icon={Redo2} title="Redo" onClick={() => undo(true)} /><span className="sheet-divider" /><Tool icon={Bold} title="Bold" active={currentCell.style?.bold} onClick={() => style({ bold: !currentCell.style?.bold })} /><Tool icon={Italic} title="Italic" active={currentCell.style?.italic} onClick={() => style({ italic: !currentCell.style?.italic })} /><ColorPicker label="Text color" value={currentCell.style?.color || '#e2e8f0'} allowClear onChange={color=>style({color:color||undefined})}/><ColorPicker label="Cell fill" value={currentCell.style?.background || '#101620'} allowClear onChange={background=>style({background:background||undefined})}/><BorderPicker onApply={applyBorders}/>
<span className="sheet-divider" />{[[AlignLeft, 'left'], [AlignCenter, 'center'], [AlignRight, 'right']].map(([Icon, align]) => <Tool key={align} icon={Icon} title={`Align ${align}`} active={currentCell.style?.align === align} onClick={() => style({ align })} />)}<label className="sheet-select-label">Vertical<select aria-label="Vertical alignment" value={currentCell.style?.verticalAlign || 'middle'} onChange={e=>style({verticalAlign:e.target.value})}><option value="top">Top</option><option value="middle">Middle</option><option value="bottom">Bottom</option></select></label><label className="sheet-select-label">Text<select aria-label="Text display" value={currentCell.style?.textMode || (currentCell.style?.wrap?'wrap':'overflow')} onChange={e=>style({textMode:e.target.value,wrap:e.target.value==='wrap'})}><option value="overflow">Overflow</option><option value="wrap">Wrap</option><option value="clip">Clip</option></select></label><select aria-label="Number format" value={currentCell.style?.numberFormat || ''} onChange={e => style({ numberFormat: e.target.value })}><option value="">General</option><option value="0.00">Decimal</option><option value="0.00%">Percent</option><option value="$0.00">Currency</option></select><Tool icon={Merge} title="Merge or unmerge selected cells" onClick={() => { const existing = (sheet.merges || []).find(m => { const [a, b] = m.split(':').map(parseCellAddress); return a && b && selection.row >= a.row && selection.row <= b.row && selection.col >= a.col && selection.col <= b.col; }); changeSheet({ ...sheet, merges: existing ? sheet.merges.filter(m => m !== existing) : [...(sheet.merges || []), mergeRange] }); }} /><span className="sheet-divider" /><Tool icon={ArrowDownAZ} title="Sort ascending by selected column" onClick={() => sort(false)} /><Tool icon={ArrowUpAZ} title="Sort descending by selected column" onClick={() => sort(true)} /><Tool icon={Filter} title="Filter rows" active={dialog === 'filter'} onClick={() => setDialog('filter')} /><Tool icon={Snowflake} title="Freeze rows and columns" active={Boolean(sheet.freezeRows || sheet.freezeColumns)} onClick={() => setDialog('freeze')} /><Tool onClick={fillDown} title="Fill selection down (Cmd+D)">Fill ↓</Tool><span className="sheet-divider" /><Tool icon={BarChart3} title="Chart selected range" onClick={() => { commitBook({ ...book, charts: [...charts, { id: rid(), sheetId: sheet.id, range: mergeRange, title: `${sheet.name} · ${mergeRange}` }] }); setDialog('charts'); }} /><Tool onClick={() => setDialog('pivot')}>Summarize</Tool><Tool onClick={() => setDialog('conditional')}>Rules</Tool><Tool onClick={() => setDialog('dropdown')}>Dropdown</Tool><Tool icon={MessageSquare} title="Cell notes and links" active={details} onClick={() => setDetails(v => !v)} /><Tool icon={Search} title="Find in sheet" onClick={() => setShowFind(v => !v)} /></nav>
    <div className="sheet-formula"><input className="sheet-address" aria-label="Go to cell" key={`${sheet.id}:${currentAddress}`} defaultValue={currentAddress} onKeyDown={e => { if (e.key === 'Enter') { const p = parseCellAddress(e.currentTarget.value.toUpperCase()); if (p) { if (p.row >= sheet.rowCount || p.col >= sheet.columnCount) changeSheet({ ...sheet, rowCount: Math.max(sheet.rowCount, p.row + 50), columnCount: Math.max(sheet.columnCount, p.col + 5) }); focusCell(p.row, p.col); } } }} /><span>ƒx</span><input title="Type a value or formula, e.g. =SUM(B2:B1025), =AVERAGE(C2:C50), or =IF(A1>0,1,0)" aria-label="Formula bar" data-testid="spreadsheet-formula" value={draft} onFocus={() => setEditing(false)} onChange={e => { formulaDirty.current = true; setDraft(e.target.value); }} onBlur={() => { if (formulaDirty.current) commitInput(); }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitInput(); root.current?.focus(); } else if (e.key === 'Escape') { formulaDirty.current = false; setDraft(cellInput(currentCell)); root.current?.focus(); } }} /></div>
    {showFind && <div className="sheet-find"><Search size={14} /><input aria-label="Find cells" autoFocus placeholder="Find values…" value={find} onChange={e => setFind(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') findNext(); if (e.key === 'Escape') setShowFind(false); }} /><Tool onClick={findNext}>Next</Tool><Tool icon={X} title="Close find" onClick={() => setShowFind(false)} /></div>}
    <div className="sheet-workspace"><SpreadsheetGrid sheet={sheet} rows={rows} columns={columns} rowOffsets={rowOffsets} heights={heights} renderRows={renderRows} renderCols={renderCols} scrollRef={scroll} onScroll={e=>{const top=e.currentTarget.scrollTop,left=e.currentTarget.scrollLeft;setViewport(v=>({...v,top,left}));}} renderCell={renderCell} onSelectRow={r=>setSelection({row:r,endRow:r,col:0,endCol:sheet.columnCount-1})} onSelectColumn={c=>setSelection({row:0,endRow:sheet.rowCount-1,col:c,endCol:c})} onSelectAll={()=>setSelection({row:0,col:0,endRow:sheet.rowCount-1,endCol:sheet.columnCount-1})} onResize={resize} onAutoFit={c=>{const lengths=Object.entries(sheet.cells).filter(([a])=>parseCellAddress(a).col===c).map(([a])=>String(calc(sheet.id,a)).length);changeSheet({...sheet,columnWidths:{...sheet.columnWidths,[c]:clamp(Math.max(10,...lengths)*8+24,60,650)}});}} /></div>
    {details && <Dialog title="Cell notes and links" close={()=>setDetails(false)}><div className="sheet-comment-popup"><p>{sheet.name}!{currentAddress}</p><label>Cell note<textarea aria-label="Cell note" autoFocus placeholder="Source, reasoning, or commentary…" value={currentCell.note||''} onChange={e=>changeSheet({...sheet,cells:{...sheet.cells,[currentAddress]:{...currentCell,note:e.target.value}}})}/></label><label>Link<input aria-label="Cell link" placeholder="BEX link or https://…" value={currentCell.link||''} onChange={e=>changeSheet({...sheet,cells:{...sheet.cells,[currentAddress]:{...currentCell,link:e.target.value}}})}/></label><Tool icon={Link2} onClick={openLinks}>Link to BEX library</Tool><Tool onClick={()=>changeSheet({...sheet,cells:{...sheet.cells,[currentAddress]:{...currentCell,link:`/Study?q=${encodeURIComponent(String(currentCell.v||'John 1:1'))}`}}})}>Link this text to Scripture</Tool><Tool onClick={()=>setDetails(false)}>Done</Tool></div></Dialog>}
    {moving?.active && createPortal(<div data-testid="sheet-move-ghost" className="sheet-move-ghost" style={{left:moving.x+14,top:moving.y+16}}><div className="sheet-move-caption">{address(moving.range.r0,moving.range.c0)}{moving.range.r1!==moving.range.r0||moving.range.c1!==moving.range.c0?`:${address(moving.range.r1,moving.range.c1)}`:''} → {address(moving.targetRow,moving.targetCol)}</div><div className="sheet-move-preview" style={{gridTemplateColumns:`repeat(${Math.min(5,moving.range.c1-moving.range.c0+1)},minmax(90px,160px))`}}>{Array.from({length:Math.min(6,moving.range.r1-moving.range.r0+1)},(_,dr)=>Array.from({length:Math.min(5,moving.range.c1-moving.range.c0+1)},(_,dc)=>{const r=moving.range.r0+dr,c=moving.range.c0+dc,cell=sheet.cells[address(r,c)];return <div key={`${r}:${c}`} style={styleOf(cell)}>{pretty(value(r,c),cell?.style)||'\u00a0'}</div>;}))}</div></div>,document.body)}
    <footer className="sheet-footer"><Tool icon={Plus} title="Add sheet" onClick={addSheet} /><div className="sheet-tabs">{book.sheets.map(s => <button key={s.id} className={s.id === sheet.id ? 'active' : ''} onClick={() => switchSheet(s.id)} onDoubleClick={() => setDialog('renameSheet')}>{s.name}</button>)}</div><Tool icon={ChevronDown} title="Sheet options" onClick={() => setDialog('sheets')} /><span className="sheet-summary">{filter && <button onClick={() => setFilter('')}>Clear filter · </button>}{numbers.length ? `Count ${numbers.length}  ·  Sum ${pretty(numbers.reduce((a, b) => a + b, 0))}  ·  Average ${pretty(numbers.reduce((a, b) => a + b, 0) / numbers.length)}` : `${sheet.rowCount.toLocaleString()} rows · ${sheet.columnCount} columns`}</span><select aria-label="Zoom" value={zoom} onChange={e => setZoom(Number(e.target.value))}>{[50, 75, 90, 100, 110, 125, 150, 200].map(z => <option key={z} value={z}>{z}%</option>)}</select><Tool title="Save spreadsheet now" onClick={() => { flushDraft.current?.(); void onSave().catch(() => {}); }}>Save</Tool></footer>
    {dialog && <Dialog title={{ filter: 'Filter rows', freeze: 'Freeze panes', sheets: 'Sheet options', renameSheet: 'Rename sheet', conditional: 'Conditional formatting', dropdown: 'Cell dropdown', links: 'Link to your BEX library', charts: 'Charts', pivot: 'Summarize data', importReport: 'Import details' }[dialog]} close={() => setDialog(null)}>
      {dialog === 'filter' && <><p>Show rows containing this text anywhere in the sheet.</p><label><input type="checkbox" aria-label="First row is headings" checked={Boolean(sheet.hasHeader)} onChange={e => changeSheet({ ...sheet, hasHeader:e.target.checked })} /> Keep the first row as headings when filtering or sorting</label><input autoFocus aria-label="Filter rows" value={filter} onChange={e => setFilter(e.target.value)} /><Tool onClick={() => setDialog(null)}>Apply</Tool><Tool onClick={() => { setFilter(''); setDialog(null); }}>Clear filter</Tool></>}
      {dialog === 'freeze' && <><p>Freeze the first rows and columns while scrolling.</p><label>Rows<input type="number" aria-label="Frozen rows" min="0" max="10" value={sheet.freezeRows || 0} onChange={e => changeSheet({ ...sheet, freezeRows: clamp(Number(e.target.value), 0, 10) })} /></label><label>Columns<input type="number" aria-label="Frozen columns" min="0" max="5" value={sheet.freezeColumns || 0} onChange={e => changeSheet({ ...sheet, freezeColumns: clamp(Number(e.target.value), 0, 5) })} /></label></>}
      {dialog === 'renameSheet' && <form onSubmit={e => { e.preventDefault(); const name = new FormData(e.currentTarget).get('name').trim(); if (!name || /[\\/?*[\]:]/.test(name) || name.length > 31 || book.sheets.some(s => s.id !== sheet.id && s.name.toLowerCase() === name.toLowerCase())) { toast.error('Use a unique sheet name of up to 31 characters without []:*?/\\.'); return; } commitBook(renameSheet(latest.current, sheet.id, name)); setDialog(null); }}><input name="name" aria-label="Sheet name" autoFocus defaultValue={sheet.name} /><button className="sheet-tool" type="submit">Rename</button></form>}
      {dialog === 'sheets' && <><Tool onClick={() => setDialog('renameSheet')}>Rename current sheet</Tool><Tool onClick={() => { const next = duplicateSheet(book, sheet.id); commitBook({ ...book, sheets: [...book.sheets, next] }); setSheetId(next.id); setDialog(null); }}>Duplicate sheet</Tool><Tool disabled={book.sheets.length === 1} onClick={() => { const next = book.sheets.filter(s => s.id !== sheet.id); commitBook({ ...book, sheets: next, activeSheetId: next[0].id }); setSheetId(next[0].id); setDialog(null); }}>Delete current sheet (Undo available)</Tool><Tool onClick={() => { changeSheet({ ...sheet, rowCount: Math.min(1048576, sheet.rowCount + 100) }); setDialog(null); }}>Add 100 rows</Tool><Tool onClick={() => { changeSheet({ ...sheet, columnCount: Math.min(16384, sheet.columnCount + 10) }); setDialog(null); }}>Add 10 columns</Tool></>}
      {dialog === 'conditional' && <form onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); changeSheet({ ...sheet, conditionalRules: [...(sheet.conditionalRules || []), { range: mergeRange, greaterThan: Number(data.get('threshold')), color: data.get('color') }] }); setDialog(null); }}><p>Highlight numbers in {mergeRange} greater than:</p><input name="threshold" aria-label="Rule threshold" type="number" step="any" defaultValue="0" /><input name="color" aria-label="Rule color" type="color" defaultValue="#164e3f" /><button type="submit" className="sheet-tool">Add rule</button><Tool onClick={() => { changeSheet({ ...sheet, conditionalRules: [] }); setDialog(null); }}>Clear rules</Tool></form>}
      {dialog === 'dropdown' && <form onSubmit={e => { e.preventDefault(); const choices = String(new FormData(e.currentTarget).get('choices')).split('\n').map(s => s.trim()).filter(Boolean); applyToRange(cell => ({ ...cell, choices })); setDialog(null); }}><p>Choices for {mergeRange}, one per line.</p><textarea autoFocus name="choices" aria-label="Dropdown choices" defaultValue={currentCell.choices?.join('\n') || ''} /><button className="sheet-tool" type="submit">Apply dropdown</button></form>}
      {dialog === 'links' && <div className="sheet-link-list">{links.map(item => <button className="sheet-tool" key={`${item.kind}:${item.id}`} onClick={() => { const link = libraryLinkHref(item); changeSheet({ ...sheet, cells: { ...sheet.cells, [currentAddress]: { ...currentCell, link } } }); setDialog(null); }}>{item.title}<small>{item.kind}</small></button>)}</div>}
      {dialog === 'charts' && <>{charts.length ? charts.map(renderChart) : <p>Select labels and numbers, then choose Chart.</p>}</>}
      {dialog === 'pivot' && <><p>Groups the selected range by its first column and sums numbers in its last column.</p>{(() => { const sums = new Map(); for (let r = selected.r0; r <= selected.r1; r++) { const key = String(value(r, selected.c0) ?? ''), number = value(r, selected.c1); if (typeof number === 'number') sums.set(key, (sums.get(key) || 0) + number); } return <><div className="sheet-pivot">{[...sums].map(([k, v]) => <div key={k}><span>{k}</span><b>{pretty(v)}</b></div>)}</div><Tool onClick={() => { const next = createWorkbook().sheets[0]; next.name = `Summary ${book.sheets.length}`; let cells = { A1: { v: 'Group', style: { bold: true } }, B1: { v: 'Sum', style: { bold: true } } }; [...sums].forEach(([key, v], i) => { cells[`A${i + 2}`] = { v: key }; cells[`B${i + 2}`] = { v }; }); next.cells = cells; commitBook({ ...book, sheets: [...book.sheets, next] }); setSheetId(next.id); setDialog(null); }}>Create summary sheet</Tool></>; })()}</>}
      {dialog === 'importReport' && <>{(book.importWarnings || []).map((warning, i) => <p key={i}>{warning}</p>)}<p>Original Excel package parts are retained for round-trip preservation; unsupported features are not executed or recalculated.</p></>}
    </Dialog>}
    {busy && <div role="status" className="sheet-busy">Processing workbook…</div>}
    {printMode && <div className="sheet-print"><h1>{record.title} — {sheet.name}</h1><table><tbody>{Array.from({ length: Math.min(sheet.rowCount, Math.max(1, ...Object.keys(sheet.cells).map(a => parseCellAddress(a).row + 1))) }, (_, r) => <tr key={r}>{Array.from({ length: Math.min(sheet.columnCount, Math.max(1, ...Object.keys(sheet.cells).map(a => parseCellAddress(a).col + 1))) }, (_, c) => <td key={c} style={styleOf(sheet.cells[address(r, c)])}>{pretty(value(r, c), sheet.cells[address(r, c)]?.style)}</td>)}</tr>)}</tbody></table></div>}
  </div>;
}
