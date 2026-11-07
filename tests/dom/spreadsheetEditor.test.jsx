import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SpreadsheetEditor from '@/components/spreadsheet/SpreadsheetEditor';
import Spreadsheets from '@/pages/Spreadsheets';
import { createWorkbook, createSheet, setCell } from '@/lib/spreadsheet/model';
import { exportXlsx, importWorkbook } from '@/lib/spreadsheet/files';
import { flushPendingEditorSaves } from '@/lib/pendingEditorSaves';

vi.mock('@/lib/WorkspaceTabs', async original => ({ ...await original(), useTabTitle: () => {} }));
let latestRecord;
function fixture(entries = []) {
  const workbook = createWorkbook();
  for (const [address, value] of entries) workbook.sheets[0] = setCell(workbook.sheets[0], address, value);
  return { id: 7, title: 'Research matrix', workbook };
}
function Controlled({ initial = fixture(), initialSheet, initialCell }) {
  const [record, setRecord] = React.useState(initial);
  latestRecord = record;
  return <SpreadsheetEditor record={record} onChange={patch => setRecord(current => ({ ...current, ...patch }))} onSave={async () => true} initialSheet={initialSheet} initialCell={initialCell} />;
}
function mount(initial = fixture(), props = {}) {
  return render(<MemoryRouter><Controlled initial={initial} {...props} /></MemoryRouter>);
}
const cell = address => document.querySelector(`[data-sheet-cell="${address}"]`);
function goto(address) { const input = screen.getByLabelText('Go to cell'); fireEvent.change(input, { target: { value: address } }); fireEvent.keyDown(input, { key: 'Enter' }); }
function formula(text) { const bar = screen.getByLabelText('Formula bar'); fireEvent.change(bar, { target: { value: text } }); fireEvent.keyDown(bar, { key: 'Enter' }); }
function select(address, extend = false) { fireEvent.pointerDown(cell(address), { button: 0, shiftKey: extend }); fireEvent.pointerUp(window); }

beforeEach(() => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  // jsdom lacks layout; give only the actual grid a viewport for virtualized DOM assertions.
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function () { return this.classList.contains('sheet-scroll') ? 900 : 0; });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function () { return this.classList.contains('sheet-scroll') ? 420 : 0; });
});
afterEach(() => { delete window.bexDesktop; vi.unstubAllGlobals(); });

describe('the actual BEX spreadsheet editor', () => {
  it('edits cells and formulas, recalculates dependencies, and supports undo/redo', () => {
    mount();
    formula('4');
    expect(cell('A1').textContent).toBe('4');
    goto('B1');
    fireEvent.doubleClick(cell('B1'));
    const inline = screen.getByLabelText('Edit B1');
    fireEvent.change(inline, { target: { value: '=A1*3' } });
    fireEvent.keyDown(inline, { key: 'Enter' });
    expect(cell('B1').textContent).toBe('12');
    expect(latestRecord.workbook.sheets[0].cells.B1.f).toBe('A1*3');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(latestRecord.workbook.sheets[0].cells.B1).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(cell('B1').textContent).toBe('12');
    goto('A1'); formula('5'); expect(cell('B1').textContent).toBe('15');
  });

  it('commits a typed inline draft to its original cell before moving the selection', () => {
    mount(fixture([['A1', 'original'], ['B1', 'untouched']]));
    fireEvent.doubleClick(cell('A1'));
    fireEvent.change(screen.getByLabelText('Edit A1'), { target: { value: 'draft before selection moved' } });
    select('B1');
    expect(latestRecord.workbook.sheets[0].cells.A1.v).toBe('draft before selection moved');
    expect(latestRecord.workbook.sheets[0].cells.B1.v).toBe('untouched');
    expect(screen.getByLabelText('Go to cell').value).toBe('B1');
    expect(screen.getByLabelText('Formula bar').value).toBe('untouched');
  });

  it('Escape cancels inline typing without committing it or overwriting the original value', async () => {
    mount(fixture([['A1', 'original']]));
    fireEvent.doubleClick(cell('A1'));
    const input = screen.getByLabelText('Edit A1');
    fireEvent.change(input, { target: { value: 'must not persist' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByLabelText('Edit A1')).toBeNull();
    expect(latestRecord.workbook.sheets[0].cells.A1.v).toBe('original');
    await act(async () => { await flushPendingEditorSaves(); });
    expect(latestRecord.workbook.sheets[0].cells.A1.v).toBe('original');
  });

  it('Escape cancels formula-bar typing even when moving focus causes blur', async () => {
    mount(fixture([['A1', 'original']]));
    const input = screen.getByLabelText('Formula bar');
    act(() => input.focus());
    fireEvent.change(input, { target: { value: 'must not persist' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    await act(async () => { await flushPendingEditorSaves(); });
    expect(latestRecord.workbook.sheets[0].cells.A1.v).toBe('original');
    expect(input.value).toBe('original');
  });

  it('keeps a declared heading row in place while sorting complete records', () => {
    mount(fixture([['A1','Score'],['B1','Source'],['A2',3],['B2','third'],['A3',1],['B3','first']]));
    fireEvent.click(screen.getByRole('button',{name:'Filter rows'}));
    fireEvent.click(screen.getByLabelText('First row is headings'));
    fireEvent.click(screen.getByRole('button',{name:'Apply',exact:true}));
    fireEvent.click(screen.getByRole('button',{name:'Sort ascending by selected column'}));
    expect(latestRecord.workbook.sheets[0].cells.A1.v).toBe('Score');
    expect(latestRecord.workbook.sheets[0].cells.A2.v).toBe(1);
    expect(latestRecord.workbook.sheets[0].cells.B2.v).toBe('first');
    expect(latestRecord.workbook.sheets[0].cells.B3.v).toBe('third');
  });

  it('switches independent sheets, creates a new sheet, and follows explicit deep-link targets', () => {
    const original = fixture([['A1', 'first']]);
    const second = createSheet('Sources'); second.cells.B2 = { v: 'second sheet evidence' }; original.workbook.sheets.push(second);
    const view = mount(original);
    fireEvent.click(screen.getByRole('button', { name: 'Sources', exact: true }));
    expect(screen.getByRole('grid').getAttribute('aria-label')).toBe('Sources');
    goto('B2'); expect(screen.getByLabelText('Formula bar').value).toBe('second sheet evidence');
    fireEvent.click(screen.getByRole('button', { name: 'Sheet1', exact: true }));
    expect(cell('A1').textContent).toBe('first');
    view.rerender(<MemoryRouter><Controlled initial={original} initialSheet={second.id} initialCell="B2" /></MemoryRouter>);
    expect(screen.getByRole('grid').getAttribute('aria-label')).toBe('Sources');
    expect(screen.getByLabelText('Go to cell').value).toBe('B2');
    fireEvent.click(screen.getByRole('button', { name: 'Add sheet' }));
    expect(latestRecord.workbook.sheets).toHaveLength(3);
  });

  it('virtualizes a 1024-row source and reveals row 1024 when scrolled', () => {
    const data = fixture(Array.from({ length: 1024 }, (_, i) => [`A${i + 1}`, `Source ${i + 1}`]));
    mount(data);
    expect(screen.getAllByRole('gridcell').length).toBeLessThan(500);
    expect(cell('A1024')).toBeNull();
    const grid = screen.getByRole('grid');
    fireEvent.scroll(grid, { target: { scrollTop: 1010 * 28 } });
    expect(cell('A1024').textContent).toBe('Source 1024');
    expect(cell('A1')).toBeNull();
    expect(screen.getAllByRole('gridcell').length).toBeLessThan(500);
    expect(Object.keys(latestRecord.workbook.sheets[0].cells)).toHaveLength(1024);
  });

  it('reveals a far-away cell when opening a deep link and using the address box', async () => {
    const data = fixture([['A1024', 'FAR_AWAY_CELL']]);
    mount(data, { initialCell: 'A1024' });
    expect(screen.getByLabelText('Go to cell').value).toBe('A1024');
    await waitFor(() => expect(cell('A1024')?.textContent).toBe('FAR_AWAY_CELL'));
    goto('A1');
    await waitFor(() => expect(cell('A1')).not.toBeNull());
    goto('A1024');
    await waitFor(() => expect(cell('A1024')?.textContent).toBe('FAR_AWAY_CELL'));
  });

  it('fills a selected range with relative formulas and preserves the original input column', () => {
    mount(fixture([['A1', 3], ['A2', 4], ['A3', 5], ['B1', '=A1*2']]));
    select('B1'); select('B3', true);
    expect(cell('B3').getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Fill selection down (Cmd+D)' }));
    expect(cell('B1').textContent).toBe('6'); expect(cell('B2').textContent).toBe('8'); expect(cell('B3').textContent).toBe('10');
    expect(latestRecord.workbook.sheets[0].cells.B3.f).toBe('A3*2');
    expect(latestRecord.workbook.sheets[0].cells.A3.v).toBe(5);
  });

  it('resizes columns and rows independently through their actual pointer handles', () => {
    mount();
    fireEvent.pointerDown(screen.getByRole('separator', { name: 'Resize column A' }), { clientX: 100, button: 0 });
    fireEvent.pointerMove(window, { clientX: 164 }); fireEvent.pointerUp(window);
    expect(latestRecord.workbook.sheets[0].columnWidths[0]).toBe(196);
    expect(latestRecord.workbook.sheets[0].rowHeights[0]).toBeUndefined();
    fireEvent.pointerDown(screen.getByRole('separator', { name: 'Resize row 1' }), { clientY: 100, button: 0 });
    fireEvent.pointerMove(window, { clientY: 124 }); fireEvent.pointerUp(window);
    expect(latestRecord.workbook.sheets[0].rowHeights[0]).toBe(52);
    expect(latestRecord.workbook.sheets[0].columnWidths[0]).toBe(196);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(latestRecord.workbook.sheets[0].rowHeights[0]).toBeUndefined();
  });

  it('imports actual XLSX bytes with two sheets and row 1024 through the visible import control', async () => {
    const source = fixture([['A1024', 'IMPORTED_1024'], ['B1', 7], ['C1', '=B1*2']]).workbook;
    source.sheets.push(createSheet('Witnesses'));
    const bytes = await exportXlsx(source);
    const input = { name: 'actual.xlsx', size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    mount();
    fireEvent.change(screen.getByTestId('spreadsheet-import'), { target: { files: [input] } });
    await waitFor(() => expect(latestRecord.workbook.sheets).toHaveLength(2));
    expect(latestRecord.workbook.sheets[0].cells.A1024.v).toBe('IMPORTED_1024');
    expect(latestRecord.workbook.sheets[0].cells.C1.f).toBe('B1*2');
    expect(cell('C1').textContent).toBe('14');
    fireEvent.click(screen.getByRole('button', { name: 'Witnesses', exact: true }));
    expect(screen.getByRole('grid').getAttribute('aria-label')).toBe('Witnesses');
  });
});

describe('spreadsheet page saving and refresh barrier', () => {
  it('flushes a pending cell edit before refresh and restores the saved cell on remount', async () => {
    let stored = fixture();
    const update = vi.fn(async (_type, _id, patch) => { stored = { ...stored, ...patch }; return { ok: true, record: stored }; });
    window.bexDesktop = { isDesktop: true, getLocalEntity: vi.fn(async () => ({ ok: true, record: stored })), updateLocalEntity: update };
    const tree = <MemoryRouter initialEntries={['/spreadsheets/research-7?sheet=' + stored.workbook.sheets[0].id + '&cell=B2']}><Routes><Route path="/spreadsheets/:slugId" element={<Spreadsheets />} /></Routes></MemoryRouter>;
    const view = render(tree);
    await screen.findByTestId('spreadsheet-editor');
    expect(screen.getByLabelText('Go to cell').value).toBe('B2');
    formula('=6*7');
    expect(update).not.toHaveBeenCalled();
    await act(async () => { await flushPendingEditorSaves(); });
    expect(update).toHaveBeenCalledWith('Spreadsheet', 7, expect.objectContaining({ workbook: expect.any(Object) }));
    expect(stored.workbook.sheets[0].cells.B2.f).toBe('6*7');
    view.unmount(); render(tree);
    await screen.findByTestId('spreadsheet-editor');
    expect(screen.getByLabelText('Formula bar').value).toBe('=6*7');
    expect(cell('B2').textContent).toBe('42');
  });

  it('flushes uncommitted inline typing to the Vault before refresh without requiring blur', async () => {
    let stored = fixture([['A1', 'original']]);
    const update = vi.fn(async (_type, _id, patch) => { stored = { ...stored, ...patch }; return { ok: true, record: stored }; });
    window.bexDesktop = { isDesktop: true, getLocalEntity: vi.fn(async () => ({ ok: true, record: stored })), updateLocalEntity: update };
    render(<MemoryRouter initialEntries={['/spreadsheets/7']}><Routes><Route path="/spreadsheets/:slugId" element={<Spreadsheets />} /></Routes></MemoryRouter>);
    await screen.findByTestId('spreadsheet-editor');
    fireEvent.doubleClick(cell('A1'));
    fireEvent.change(screen.getByLabelText('Edit A1'), { target: { value: 'last inline keystrokes before refresh' } });
    expect(update).not.toHaveBeenCalled();
    await act(async () => { await flushPendingEditorSaves(); });
    expect(stored.workbook.sheets[0].cells.A1.v).toBe('last inline keystrokes before refresh');
    expect(update).toHaveBeenCalledWith('Spreadsheet', 7, expect.any(Object));
  });

  it('keeps edits made while a previous save is in flight and flushes the newest value', async () => {
    let stored = fixture();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const update = vi.fn(async (_type, _id, patch) => { if (update.mock.calls.length === 1) await gate; stored = { ...stored, ...patch }; return { ok: true, record: stored }; });
    window.bexDesktop = { isDesktop: true, getLocalEntity: vi.fn(async () => ({ ok: true, record: stored })), updateLocalEntity: update };
    render(<MemoryRouter initialEntries={['/spreadsheets/7']}><Routes><Route path="/spreadsheets/:slugId" element={<Spreadsheets />} /></Routes></MemoryRouter>);
    await screen.findByTestId('spreadsheet-editor');
    formula('10');
    let first;
    await act(async () => { first = flushPendingEditorSaves(); await Promise.resolve(); });
    expect(update).toHaveBeenCalledTimes(1);
    formula('25');
    fireEvent.change(screen.getByLabelText('Spreadsheet title'), { target: { value: 'Latest title' } });
    await act(async () => { release(); await first; await flushPendingEditorSaves(); });
    expect(update).toHaveBeenCalledTimes(2);
    expect(stored.title).toBe('Latest title');
    expect(stored.workbook.sheets[0].cells.A1.v).toBe(25);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('blocks refresh on failed saves and retains the latest edit for retry', async () => {
    const stored = fixture();
    const update = vi.fn(async () => ({ ok: false, error: 'Disk unavailable.' }));
    window.bexDesktop = { isDesktop: true, getLocalEntity: vi.fn(async () => ({ ok: true, record: stored })), updateLocalEntity: update };
    render(<MemoryRouter initialEntries={['/spreadsheets/7']}><Routes><Route path="/spreadsheets/:slugId" element={<Spreadsheets />} /></Routes></MemoryRouter>);
    await screen.findByTestId('spreadsheet-editor');
    formula('99');
    await act(async () => { await expect(flushPendingEditorSaves()).rejects.toThrow('Disk unavailable.'); });
    expect(screen.getByRole('alert').textContent).toContain('Disk unavailable.');
    expect(cell('A1').textContent).toBe('99');
    update.mockImplementation(async (_type, _id, patch) => ({ ok: true, record: { ...stored, ...patch } }));
    await act(async () => { await flushPendingEditorSaves(); });
    expect(update.mock.calls.at(-1)[2].workbook.sheets[0].cells.A1.v).toBe(99);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('repairs table references in a saved older import and retains the repair after an edit and reopen', async () => {
    const book = createWorkbook(), s = book.sheets[0];
    s.cells = { A1: { v: 'Origin' }, A2: { v: 'Original' }, A3: { v: 'Friend' }, B1: { f: 'COUNTIFS(Claims[Origin],"Original")' } };
    s.tables = [{ name: 'Claims', ref: 'A1:A3', columns: [{ name: 'Origin' }] }];
    const bytes = await exportXlsx(book);
    const imported = await importWorkbook({ name: 'legacy.xlsx', size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
    delete imported.referenceVersion; delete imported.definedNames;
    imported.sheets.forEach(sheet => { delete sheet.tables; });
    let stored = { id: 7, title: 'Earlier import', workbook: imported };
    const update = vi.fn(async (_type, _id, patch) => { stored = { ...stored, ...patch }; return { ok: true, record: stored }; });
    window.bexDesktop = { isDesktop: true, getLocalEntity: vi.fn(async () => ({ ok: true, record: stored })), updateLocalEntity: update };
    const tree = <MemoryRouter initialEntries={['/spreadsheets/7']}><Routes><Route path="/spreadsheets/:slugId" element={<Spreadsheets />} /></Routes></MemoryRouter>;
    const view = render(tree);
    await screen.findByTestId('spreadsheet-editor');
    expect(cell('B1').textContent).toBe('1');
    goto('A3'); formula('Original');
    expect(cell('B1').textContent).toBe('2');
    await act(async () => { await flushPendingEditorSaves(); });
    expect(stored.workbook.sheets[0].tables[0].name).toBe('Claims');
    view.unmount(); render(tree);
    await screen.findByTestId('spreadsheet-editor');
    expect(cell('B1').textContent).toBe('2');
  });
  it('restores sheet/cell/scroll/zoom view state and reports changes', async () => {
    const record = fixture([['A1024', 'last evidence row']]);
    const onViewChange = vi.fn();
    render(<MemoryRouter><SpreadsheetEditor record={record} onChange={() => {}} onSave={async () => true} initialView={{sheetId:record.workbook.sheets[0].id,cell:'A1024',top:28500,left:0,zoom:100}} onViewChange={onViewChange} /></MemoryRouter>);
    expect(screen.getByLabelText('Go to cell').value).toBe('A1024');
    expect(screen.getByRole('grid').scrollTop).toBe(28500);
    expect(cell('A1024').textContent).toBe('last evidence row');
    await waitFor(() => expect(onViewChange).toHaveBeenCalledWith(expect.objectContaining({cell:'A1024',top:28500,zoom:100})));
  });

  it('shares edits between two mounted workbook views without stale pending writes', async () => {
    let stored = fixture([['A1', 'original']]);
    const update = vi.fn(async (_type,_id,patch) => { stored={...stored,...patch}; return {ok:true,record:stored}; });
    window.bexDesktop={isDesktop:true,getLocalEntity:vi.fn(async()=>({ok:true,record:stored})),updateLocalEntity:update};
    render(<MemoryRouter initialEntries={['/spreadsheets/7']}><Routes><Route path="/spreadsheets/:slugId" element={<><div data-testid="view-one"><Spreadsheets /></div><div data-testid="view-two"><Spreadsheets /></div></>} /></Routes></MemoryRouter>);
    await waitFor(()=>expect(screen.getAllByTestId('spreadsheet-editor')).toHaveLength(2));
    const one=within(screen.getByTestId('view-one')), two=within(screen.getByTestId('view-two'));
    const bar=one.getByLabelText('Formula bar');fireEvent.change(bar,{target:{value:'12'}});fireEvent.keyDown(bar,{key:'Enter'});
    expect(two.getByLabelText('Formula bar').value).toBe('12');
    fireEvent.change(two.getByLabelText('Spreadsheet title'),{target:{value:'Shared latest title'}});
    const goto=two.getByLabelText('Go to cell');fireEvent.change(goto,{target:{value:'B1'}});fireEvent.keyDown(goto,{key:'Enter'});
    const second=two.getByLabelText('Formula bar');fireEvent.change(second,{target:{value:'=A1*2'}});fireEvent.keyDown(second,{key:'Enter'});
    expect(screen.getByTestId('view-one').querySelector('[data-sheet-cell="B1"]').textContent).toBe('24');
    await act(async()=>{await flushPendingEditorSaves();});
    expect(stored.title).toBe('Shared latest title');expect(stored.workbook.sheets[0].cells.A1.v).toBe(12);expect(stored.workbook.sheets[0].cells.B1.f).toBe('A1*2');
  });

});
