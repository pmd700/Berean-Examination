import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeTimegraph } from '@/lib/timegraph/timegraphModel';
import { toYearValue } from '@/lib/timegraph/timegraphDate';

const captured = vi.hoisted(() => ({ graph: null, canvas: null, selected: null }));
// Keep the editor's real event creation, filters, viewport, shortcuts and history.
// Only replace persistence and child editors/canvas rendering.
vi.mock('@/lib/timegraph/timegraphStore', () => ({
  useTimegraph: () => {
    const [graph, setGraph] = React.useState(captured.graph);
    const ref = React.useRef(graph);
    const update = React.useCallback((mutation) => {
      const next = typeof mutation === 'function' ? mutation(ref.current) : mutation;
      ref.current = next;
      captured.graph = next;
      setGraph(next);
      return next;
    }, []);
    return { timegraph: graph, status: 'ready', saveState: 'saved', update, flush: async () => {} };
  },
}));
vi.mock('@/lib/WorkspaceTabs', () => ({ useIsActiveTab: () => true }));
vi.mock('@/components/scripture/TextSizeControl', () => ({
  default: () => null,
  useTextSizePreference: () => [16, () => {}],
}));
vi.mock('@/components/timegraph/TimegraphCanvas', () => ({ default: (props) => {
  captured.canvas = props;
  return <div data-testid="test-canvas" />;
} }));
vi.mock('@/components/timegraph/TimegraphEventPanel', () => ({ default: ({ event }) => {
  captured.selected = event;
  return <div data-testid="test-event-panel" />;
} }));
vi.mock('@/components/timegraph/TimegraphExportDialog', () => ({ default: () => null }));
import TimegraphEditor from '@/components/timegraph/TimegraphEditor';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 24, 11, 51));
  captured.selected = null;
  captured.graph = normalizeTimegraph({
    id: 'journey', title: 'Journey',
    view: { centerYear: 1520, yearsPerPixel: 0.001 },
    events: [{ id: 'existing', title: 'Existing event', start: '1520' }],
  });
});
afterEach(() => vi.useRealTimers());

const create = () => fireEvent.click(screen.getByTestId('timegraph-new-event'));
const exact = (year, month, day) => ({ year, month, day, precision: 'exact' });
const expectSelected = (point) => {
  expect(captured.selected.start).toEqual(point);
  expect(captured.canvas.viewport.centerYear).toBe(toYearValue(point));
  expect(captured.canvas.viewport.yearsPerPixel).toBe(0.001);
  expect(captured.canvas.selectedIds).toEqual([captured.selected.id]);
  expect(captured.canvas.timegraph.events.some(event => event.id === captured.selected.id)).toBe(true);
};

describe('New event uses the local date at the time of the action', () => {
  it('creates and centers an exact date even when viewing another century, with working undo', () => {
    render(<TimegraphEditor timegraphId="journey" />);
    create();
    expectSelected(exact(2026, 9, 24));
    expect(captured.graph.events).toHaveLength(2);
    fireEvent.keyDown(window, { key: 'z', metaKey: true });
    expect(captured.graph.events).toHaveLength(1);
    expect(captured.graph.events[0].id).toBe('existing');
  });

  it('reads tomorrow and next year without reopening the editor', () => {
    render(<TimegraphEditor timegraphId="journey" />);
    create();
    expectSelected(exact(2026, 9, 24));
    vi.setSystemTime(new Date(2026, 8, 25, 0, 1));
    create();
    expectSelected(exact(2026, 9, 25));
    vi.setSystemTime(new Date(2026, 11, 31, 23, 59));
    create();
    expectSelected(exact(2026, 12, 31));
    vi.setSystemTime(new Date(2027, 0, 1, 0, 1));
    fireEvent.keyDown(window, { key: 'e' });
    expectSelected(exact(2027, 1, 1));
  });

  it('supports leap day and the following day through the same shortcut', () => {
    render(<TimegraphEditor timegraphId="journey" />);
    vi.setSystemTime(new Date(2028, 1, 29, 12));
    fireEvent.keyDown(window, { key: 'e' });
    expectSelected(exact(2028, 2, 29));
    vi.setSystemTime(new Date(2028, 2, 1, 0, 1));
    create();
    expectSelected(exact(2028, 3, 1));
  });

  it('reveals the new event when a search filter would hide it', () => {
    render(<TimegraphEditor timegraphId="journey" />);
    fireEvent.click(screen.getByTestId('timegraph-filter-toggle'));
    fireEvent.change(screen.getByTestId('timegraph-filter-query'), { target: { value: 'Existing event' } });
    create();
    expectSelected(exact(2026, 9, 24));
    expect(screen.getByTestId('timegraph-filter-query').value).toBe('');
  });
});
