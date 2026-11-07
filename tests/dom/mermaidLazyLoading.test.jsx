import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({ imports: 0, initialize: vi.fn(), parse: vi.fn(), render: vi.fn(), gate: null, release: null }));
vi.mock('mermaid', async () => {
  harness.imports++;
  await harness.gate;
  return { default: { initialize: harness.initialize, parse: harness.parse, render: harness.render } };
});
import MermaidBlock from '@/components/markdown/MermaidBlock';

describe('on-demand Mermaid diagrams', () => {
  it('does not load the engine for empty blocks; initializes once for diagrams and ignores obsolete work', async () => {
    harness.gate = new Promise(resolve => { harness.release = resolve; });
    harness.parse.mockResolvedValue(true);
    harness.render.mockImplementation(async (_id, source) => ({ svg: `<svg><text>${source.includes('fresh') ? 'Fresh diagram' : 'Old diagram'}</text></svg>` }));
    const view = render(<MermaidBlock code="  " />);
    expect(harness.imports).toBe(0);
    view.rerender(<MermaidBlock code="graph TD; old-->node" />);
    await waitFor(() => expect(harness.imports).toBe(1));
    view.rerender(<MermaidBlock code="graph TD; fresh-->node" />);
    await act(async () => { harness.release(); });
    await screen.findByText('Fresh diagram');
    expect(harness.parse).toHaveBeenCalledTimes(1);
    expect(harness.initialize).toHaveBeenCalledExactlyOnceWith({ startOnLoad: false, securityLevel: 'strict', fontFamily: 'inherit', theme: 'default' });
    view.rerender(<MermaidBlock code="graph TD; fresh-->second" />);
    await waitFor(() => expect(harness.render).toHaveBeenCalledTimes(2));
    expect(harness.initialize).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('keeps parse errors inside the diagram and retains the source toggle', async () => {
    harness.parse.mockRejectedValueOnce(new Error('Invalid diagram syntax'));
    render(<MermaidBlock code="broken graph" />);
    await screen.findByText('Invalid diagram syntax');
    expect(screen.getByTestId('mermaid-error')).toBeTruthy();
    fireEvent.click(screen.getByTestId('button-mermaid-source'));
    expect(screen.getByText('broken graph')).toBeTruthy();
  });

  it('does not render a diagram after the block unmounts during parsing', async () => {
    let finish;
    harness.parse.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const before = harness.render.mock.calls.length;
    const view = render(<MermaidBlock code="graph TD; gone-->node" />);
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    view.unmount();
    await act(async () => { finish(true); });
    expect(harness.render.mock.calls.length).toBe(before);
  });
});
