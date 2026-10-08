import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TimegraphTagInput from '@/components/timegraph/TimegraphTagInput';
function setup(value = [], availableTags = ['zwingli', 'Zwingli', 'Zurich', 'Rome']) {
  const save = vi.fn();
  render(<TimegraphTagInput value={value} availableTags={availableTags} onChange={save} />);
  const input = screen.getByRole('combobox');
  fireEvent.focus(input);
  return { input, save };
}
function type(input, text) { fireEvent.change(input, { target: { value: text, selectionStart: text.length } }); }
describe('timeline tag suggestions', () => {
  it('deduplicates suggestions and accepts the first match with Enter without saving partial input', () => {
    const { input, save } = setup();
    type(input, 'z');
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(save).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(save).toHaveBeenLastCalledWith(['Zurich']);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
  it('completes zwingli immediately and preserves existing comma-separated tags', () => {
    const { input, save } = setup(['Rome'], ['Rome', 'zwingli']);
    type(input, 'Rome, z');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(save).toHaveBeenLastCalledWith(['Rome', 'zwingli']);
    expect(input.value).toBe('Rome, zwingli');
  });
  it('supports arrows and clicking a suggestion', () => {
    const { input, save } = setup([], ['zwingli', 'Zurich']);
    type(input, 'z');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(save).toHaveBeenLastCalledWith(['zwingli']);
    type(input, 'zu');
    fireEvent.click(screen.getByRole('option', { name: 'Zurich' }));
    expect(save).toHaveBeenLastCalledWith(['Zurich']);
  });
  it('allows custom tags on blur and excludes already selected suggestions', () => {
    const { input, save } = setup(['zwingli']);
    type(input, 'zwingli, z');
    expect(screen.getAllByRole('option').map(el => el.textContent)).toEqual(['Zurich']);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    type(input, 'zwingli, New topic');
    fireEvent.blur(input);
    expect(save).toHaveBeenLastCalledWith(['zwingli', 'New topic']);
  });
});
