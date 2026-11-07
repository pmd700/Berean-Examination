import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Tool, ColorPicker, BorderPicker, SPREADSHEET_COLORS } from '@/components/spreadsheet/SpreadsheetControls';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const delay = ms => act(() => vi.advanceTimersByTime(ms));

describe('spreadsheet toolbar controls', () => {
  it('shows its own delayed tooltip on hover, without a duplicate native title, and cancels on leave/click/scroll', () => {
    const click = vi.fn();
    render(<Tool title="Wrap selected text" onClick={click}>Wrap</Tool>);
    const button = screen.getByRole('button', { name: 'Wrap selected text' });
    expect(button.hasAttribute('title')).toBe(false);
    fireEvent.pointerEnter(button);
    delay(179); expect(screen.queryByRole('tooltip')).toBeNull();
    delay(1); expect(screen.getByRole('tooltip').textContent).toBe('Wrap selected text');
    expect(button.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id);
    fireEvent.pointerLeave(button); expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.pointerEnter(button); delay(100); fireEvent.pointerLeave(button); delay(200);
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.pointerEnter(button); delay(180); fireEvent.click(button);
    expect(click).toHaveBeenCalledTimes(1); expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.pointerEnter(button); delay(180); fireEvent.scroll(window);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('supports focus tooltips, clamps them to the viewport edge and clears pending work on unmount', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this.getAttribute('role') === 'tooltip') return { width: 220, height: 35, left: 0, top: 0, right: 220, bottom: 35 };
      return { left: window.innerWidth - 20, right: window.innerWidth, top: window.innerHeight - 30, bottom: window.innerHeight - 10, width: 20, height: 20 };
    });
    const view = render(<Tool title="Bold selected cells">B</Tool>);
    const button = screen.getByRole('button', { name: 'Bold selected cells' });
    fireEvent.focus(button); delay(180);
    const tooltip = screen.getByRole('tooltip');
    expect(Number.parseFloat(tooltip.style.left) + 220).toBeLessThanOrEqual(window.innerWidth - 8);
    expect(Number.parseFloat(tooltip.style.top) + 35).toBeLessThanOrEqual(window.innerHeight - 8);
    fireEvent.blur(button); expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.pointerEnter(button); view.unmount(); delay(200); expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('provides forty quickly selectable preset colors in a portal and preserves the exact selected color', () => {
    const change = vi.fn();
    const view = render(<div style={{ overflow: 'hidden' }}><ColorPicker label="Text color" value="#ffffff" onChange={change} /></div>);
    const button = screen.getByRole('button', { name: 'Text color', exact: true });
    fireEvent.click(button);
    const panel = screen.getByRole('dialog', { name: 'Text color', exact: true });
    expect(view.container.contains(panel)).toBe(false);
    expect(screen.getAllByRole('radio')).toHaveLength(SPREADSHEET_COLORS.length);
    expect(SPREADSHEET_COLORS.length).toBeGreaterThanOrEqual(24);
    expect(screen.getByRole('radio', { name: 'Text color #ffffff' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Text color #ef4444' }));
    expect(change).toHaveBeenCalledWith('#ef4444');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('allows custom colors and clear, and dismisses on outside press or Escape', () => {
    const change = vi.fn();
    render(<ColorPicker label="Cell fill" value="#166534" onChange={change} allowClear />);
    const button = screen.getByRole('button', { name: 'Cell fill', exact: true });
    fireEvent.click(button);
    fireEvent.change(screen.getByLabelText('Custom cell fill'), { target: { value: '#123456' } });
    expect(change).toHaveBeenCalledWith('#123456');
    fireEvent.click(button); fireEvent.click(screen.getByRole('button', { name: 'Clear cell fill' }));
    expect(change).toHaveBeenCalledWith(null);
    fireEvent.click(button); fireEvent.pointerDown(document.body); expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(button); fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('applies border placement, width and palette color together and supports removing borders', () => {
    const apply = vi.fn();
    render(<BorderPicker onApply={apply} />);
    const button = screen.getByRole('button', { name: 'Cell borders', exact: true });
    fireEvent.click(button);
    expect(within(screen.getByRole('radiogroup', { name: 'Border placement' })).getAllByRole('radio')).toHaveLength(8);
    fireEvent.click(screen.getByRole('radio', { name: 'Outer borders' }));
    fireEvent.click(screen.getByRole('radio', { name: '3 pixel border' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Border color #2563eb' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply borders' }));
    expect(apply).toHaveBeenLastCalledWith({ pattern: 'outer', width: 3, color: '#2563eb' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(button); fireEvent.click(screen.getByRole('radio', { name: 'No borders' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply borders' }));
    expect(apply).toHaveBeenLastCalledWith({ pattern: 'none', width: 3, color: '#2563eb' });
  });
});
