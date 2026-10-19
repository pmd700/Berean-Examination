import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TimegraphEditor from '@/components/timegraph/TimegraphEditor';
import { flushTimegraph, getTimegraphSnapshot, resetTimegraphStore, seedTimegraph, updateTimegraph } from '@/lib/timegraph/timegraphStore';
import { flushPendingEditorSaves } from '@/lib/pendingEditorSaves';

const test = vi.hoisted(() => ({ canvas: null, stored: new Map(), update: vi.fn(), active: true }));
vi.mock('@/lib/platform/entities', () => ({ platformEntities: { Timegraph: {
  get: async id => test.stored.get(id), update: (...args) => test.update(...args),
} } }));
vi.mock('@/lib/WorkspaceTabs', () => ({ useIsActiveTab: () => test.active }));
vi.mock('@/components/scripture/TextSizeControl', () => ({ default: () => null, useTextSizePreference: () => [16, () => {}] }));
vi.mock('@/components/timegraph/TimegraphCanvas', () => ({ default: props => { test.canvas = props; return <div />; } }));
vi.mock('@/components/timegraph/TimegraphEventPanel', () => ({ default: () => null }));
vi.mock('@/components/timegraph/TimegraphExportDialog', () => ({ default: () => null }));

const filters = { query: '', tags: [], hiddenTags: ['Hidden'], hideUntagged: false, colors: [] };
const graph = id => ({ id, title: `Timeline ${id}`, view: { centerYear: 2026.782, yearsPerPixel: 0.00013, scrollTop: 137, filters },
  events: [{ id: 'a', title: 'An event', start: '2026', tags: ['Hidden'] }] });
beforeEach(() => {
  test.active = true; test.stored.clear(); resetTimegraphStore();
  test.update.mockReset().mockImplementation(async (id, patch) => {
    const saved = { ...test.stored.get(id), ...structuredClone(patch), id };
    test.stored.set(id, saved); return saved;
  });
  for (const id of [1, 2]) { test.stored.set(id, graph(id)); seedTimegraph(graph(id)); }
});
afterEach(() => { resetTimegraphStore(); });
const ready = () => waitFor(() => expect(screen.getByTestId('timegraph-editor').dataset.viewRestored).toBe('true'));

describe('timeline view recovery', () => {
  it('automatically saves pan, zoom, vertical position and tag filters and restores them on a fresh mount', async () => {
    const view = render(<TimegraphEditor timegraphId={1} />);
    await ready(1);
    expect(test.canvas.viewport.centerYear).toBe(2026.782);
    expect(screen.getByRole('checkbox', { name: 'Show events tagged Hidden' }).checked).toBe(false);
    act(() => { test.canvas.onViewportChange({ ...test.canvas.viewport, centerYear: 1521.234567, yearsPerPixel: 0.00009123 }); });
    const host = screen.getByTestId('timegraph-scroll'); host.scrollTop = 271;
    fireEvent.scroll(host);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show events tagged Hidden' }));
    await act(async () => { await flushPendingEditorSaves(); });
    const saved = test.stored.get(1).view;
    expect(saved).toMatchObject({ centerYear: 1521.234567, yearsPerPixel: 0.00009123, scrollTop: 271, filters: { hiddenTags: [] } });
    view.unmount(); resetTimegraphStore();
    render(<TimegraphEditor timegraphId={1} />);
    await ready(1);
    expect(test.canvas.viewport.centerYear).toBe(saved.centerYear);
    expect(test.canvas.viewport.yearsPerPixel).toBe(saved.yearsPerPixel);
    expect(screen.getByTestId('timegraph-scroll').scrollTop).toBe(271);
    expect(screen.getByRole('checkbox', { name: 'Hide events tagged Hidden' }).checked).toBe(true);
  });

  it('keeps separate positions per timeline and prevents Undo from reverting the saved camera', async () => {
    const view = render(<TimegraphEditor timegraphId={1} />); await ready(1);
    act(() => { test.canvas.onViewportChange({ ...test.canvas.viewport, centerYear: 1800, yearsPerPixel: 0.1 }); });
    fireEvent.click(screen.getByTestId('timegraph-new-event'));
    const center = test.canvas.viewport.centerYear;
    fireEvent.keyDown(window, { key: 'z', metaKey: true });
    await act(async () => { await flushPendingEditorSaves(); });
    expect(test.stored.get(1).view.centerYear).toBe(center);
    expect(test.stored.get(1).events).toHaveLength(1);
    view.rerender(<TimegraphEditor timegraphId={2} />); await ready(2);
    expect(test.canvas.viewport.centerYear).toBe(2026.782);
    expect(getTimegraphSnapshot(1).view.centerYear).toBe(center);
  });

  it('waits for movement made during an in-flight save before refresh can finish', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    test.update.mockImplementationOnce(async (id, patch) => { await gate; test.stored.set(id, { ...patch, id }); return test.stored.get(id); });
    updateTimegraph(1, current => ({ ...current, view: { ...current.view, centerYear: 1600 } }));
    const first = flushTimegraph(1);
    updateTimegraph(1, current => ({ ...current, view: { ...current.view, centerYear: 1700 } }));
    const second = flushTimegraph(1);
    expect(second).toBe(first);
    release(); await second;
    expect(test.update).toHaveBeenCalledTimes(2);
    expect(test.stored.get(1).view.centerYear).toBe(1700);
  });
});
