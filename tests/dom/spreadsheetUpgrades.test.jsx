import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SpreadsheetEditor from '@/components/spreadsheet/SpreadsheetEditor';
import { createWorkbook } from '@/lib/spreadsheet/model';

let latest;
function Controlled({ initial }) {
  const [record, setRecord] = React.useState(initial);
  latest = record;
  return <SpreadsheetEditor record={record} onChange={patch => setRecord(current => ({ ...current, ...patch }))} onSave={async () => true} />;
}
function mount(cells = {}) {
  const workbook = createWorkbook();
  workbook.sheets[0].cells = cells;
  return render(<MemoryRouter><Controlled initial={{ id: 1, title: 'Upgrades fixture', workbook }} /></MemoryRouter>);
}
const cell = address => document.querySelector(`[data-sheet-cell="${address}"]`);
function select(address, extend = false) {
  fireEvent.pointerDown(cell(address), { button: 0, shiftKey: extend });
  fireEvent.pointerUp(window);
}
function clipboard() {
  const values = {};
  return { getData: type => values[type] || '', setData: (type, value) => { values[type] = value; } };
}
beforeEach(() => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  if (!document.elementFromPoint) Object.defineProperty(document, 'elementFromPoint', { configurable: true, writable: true, value: () => null });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function () { return this.classList.contains('sheet-scroll') ? 1100 : 0; });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function () { return this.classList.contains('sheet-scroll') ? 480 : 0; });
});
afterEach(() => vi.unstubAllGlobals());

describe('spreadsheet editing upgrades', () => {
  it('types sequential letters in their natural order and commits at the caret end', async () => {
    mount();
    select('A1');
    const user = userEvent.setup();
    await user.keyboard('hello');
    const input = screen.getByLabelText('Edit A1');
    expect(input.value).toBe('hello');
    expect(input.selectionStart).toBe(5);
    expect(input.selectionEnd).toBe(5);
    await user.keyboard('{Enter}');
    expect(latest.workbook.sheets[0].cells.A1.v).toBe('hello');
  });

  it('copies the full blank rectangle and clears destination content and formatting on rich paste', () => {
    mount(Object.fromEntries(['D3', 'E3', 'D4', 'E4'].map(a => [a, { v: `old-${a}`, style: { bold: true, background: '#ff0000' }, note: 'old note' }])));
    select('A1'); select('B2', true);
    const data = clipboard();
    fireEvent.copy(screen.getByTestId('spreadsheet-editor'), { clipboardData: data });
    select('D3');
    fireEvent.paste(screen.getByTestId('spreadsheet-editor'), { clipboardData: data });
    for (const a of ['D3', 'E3', 'D4', 'E4']) {
      const pasted = latest.workbook.sheets[0].cells[a];
      expect(pasted?.v).toBeUndefined();
      expect(pasted?.style).toBeUndefined();
      expect(pasted?.note).toBeUndefined();
    }
  });

  it('copies formatting from an empty cell while replacing every old destination field', () => {
    mount({A1:{style:{color:'#ef4444',verticalAlign:'bottom'}},C3:{v:'erase me',f:'1+2',style:{bold:true,background:'#166534'},note:'remove',link:'/notes/9'}});
    select('A1');const data=clipboard();fireEvent.copy(screen.getByTestId('spreadsheet-editor'),{clipboardData:data});
    select('C3');fireEvent.paste(screen.getByTestId('spreadsheet-editor'),{clipboardData:data});
    expect(latest.workbook.sheets[0].cells.C3).toEqual({style:{color:'#ef4444',verticalAlign:'bottom'}});
  });

  it('applies quick text presets and border widths to the selected range', () => {
    mount({A1:{v:'first'},B2:{v:'last'}});select('A1');select('B2',true);
    fireEvent.click(screen.getByRole('button',{name:'Text color',exact:true}));
    fireEvent.click(screen.getByRole('radio',{name:'Text color #ef4444'}));
    fireEvent.click(screen.getByRole('button',{name:'Cell borders',exact:true}));
    fireEvent.click(screen.getByRole('radio',{name:'All borders'}));
    fireEvent.click(screen.getByRole('radio',{name:'3 pixel border'}));
    fireEvent.click(screen.getByRole('radio',{name:'Border color #2563eb'}));
    fireEvent.click(screen.getByRole('button',{name:'Apply borders'}));
    for(const a of ['A1','B1','A2','B2']){
      expect(latest.workbook.sheets[0].cells[a].style.color).toBe('#ef4444');
      expect(latest.workbook.sheets[0].cells[a].style.borders).toEqual(Object.fromEntries(['top','right','bottom','left'].map(side=>[side,{width:3,color:'#2563eb'}])));
    }
  });

  it('moves selected contents and formatting through an edge drag and can undo the move', async () => {
    mount({ A1: { v: 'Move me', style: { bold: true, background: '#164e3f' }, note: 'source note' } });
    select('A1');
    const edge = document.querySelector('.sheet-move-edge');
    expect(edge).not.toBeNull();
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(cell('B3'));
    fireEvent.pointerDown(edge, { button: 0, clientX: 100, clientY: 80 });
    fireEvent.pointerMove(window, { clientX: 250, clientY: 145 });
    expect(screen.getByTestId('sheet-move-ghost')).not.toBeNull();
    fireEvent.pointerUp(window, { clientX: 250, clientY: 145 });
    await waitFor(() => expect(latest.workbook.sheets[0].cells.B3?.v).toBe('Move me'));
    expect(latest.workbook.sheets[0].cells.B3.style).toEqual({ bold: true, background: '#164e3f' });
    expect(latest.workbook.sheets[0].cells.A1).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(latest.workbook.sheets[0].cells.A1.v).toBe('Move me');
    expect(latest.workbook.sheets[0].cells.B3).toBeUndefined();
  });

  it('offers distinct overflow, wrapping and clipping modes plus independent alignment controls', () => {
    mount({ A1: { v: 'A long source description that needs deliberate text layout.' } });
    const display = screen.getByLabelText('Text display');
    expect(Array.from(display.options).map(option => option.textContent)).toEqual(['Overflow', 'Wrap', 'Clip']);
    for (const mode of ['wrap', 'clip', 'overflow']) {
      fireEvent.change(display, { target: { value: mode } });
      expect(screen.getByLabelText('Text display').value).toBe(mode);
      expect(latest.workbook.sheets[0].cells.A1.v).toContain('long source description');
    }
    fireEvent.click(screen.getByRole('button', { name: 'Align right' }));
    fireEvent.change(screen.getByLabelText('Vertical alignment'), { target: { value: 'bottom' } });
    expect(latest.workbook.sheets[0].cells.A1.style.align).toBe('right');
    expect(screen.getByLabelText('Vertical alignment').value).toBe('bottom');
    fireEvent.change(screen.getByLabelText('Vertical alignment'), { target: { value: 'top' } });
    expect(latest.workbook.sheets[0].cells.A1.style.align).toBe('right');
  });

  it('edits cell notes in a popup without taking a sidebar away from the grid', () => {
    mount({ A1: { v: 'Historical source' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cell notes and links' }));
    const popup = screen.getByRole('dialog', { name: 'Cell notes and links' });
    expect(document.querySelector('aside.sheet-details')).toBeNull();
    fireEvent.change(within(popup).getByLabelText('Cell note'), { target: { value: 'Check the original citation.' } });
    expect(latest.workbook.sheets[0].cells.A1.note).toBe('Check the original citation.');
    fireEvent.click(within(popup).getByRole('button', { name: 'Close dialog' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(latest.workbook.sheets[0].cells.A1.v).toBe('Historical source');
  });
});
