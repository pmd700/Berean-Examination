import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ErrorBoundary from '@/components/ErrorBoundary';

/**
 * Behaviour, not shape.
 *
 * The equivalent checks in tests/crashContainment.test.js can only assert that
 * the source still *contains* `getDerivedStateFromError`. These assert that a
 * component actually throwing produces a contained failure — which is the thing
 * that matters and the thing a refactor could quietly break while leaving every
 * source assertion passing.
 */

function Boom({ armed, label = 'child' }) {
  if (armed) throw new Error('render exploded');
  return <p>{label} is fine</p>;
}

/** React logs caught errors to console.error; that noise is expected here. */
function silenceReactErrorLogging() {
  return vi.spyOn(console, 'error').mockImplementation(() => {});
}

describe('ErrorBoundary', () => {
  it('renders its children untouched when nothing throws', () => {
    render(
      <ErrorBoundary label="Pane">
        <Boom armed={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('child is fine')).toBeTruthy();
    expect(screen.queryByTestId('error-boundary-fallback')).toBeNull();
  });

  it('catches a throw and shows the fallback instead of unmounting', () => {
    const spy = silenceReactErrorLogging();
    render(
      <ErrorBoundary label="Pane">
        <Boom armed />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('error-boundary-fallback')).toBeTruthy();
    expect(screen.getByTestId('error-boundary-message').textContent).toBe('render exploded');
    spy.mockRestore();
  });

  it('names the pane that failed, so the user knows what broke', () => {
    const spy = silenceReactErrorLogging();
    render(
      <ErrorBoundary label="Romans 3">
        <Boom armed />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/Romans 3 hit a problem/)).toBeTruthy();
    spy.mockRestore();
  });

  it('contains the failure: a sibling boundary keeps rendering', () => {
    const spy = silenceReactErrorLogging();
    render(
      <div>
        <ErrorBoundary label="One"><Boom armed={false} label="one" /></ErrorBoundary>
        <ErrorBoundary label="Two"><Boom armed /></ErrorBoundary>
        <ErrorBoundary label="Three"><Boom armed={false} label="three" /></ErrorBoundary>
      </div>,
    );

    // This is the whole point: before boundaries, one throw unmounted everything.
    expect(screen.getAllByTestId('error-boundary-fallback')).toHaveLength(1);
    expect(screen.getByText('one is fine')).toBeTruthy();
    expect(screen.getByText('three is fine')).toBeTruthy();
    spy.mockRestore();
  });

  it('recovers when the cause is gone', async () => {
    const spy = silenceReactErrorLogging();
    const user = userEvent.setup();

    function Host() {
      const [armed, setArmed] = React.useState(true);
      return (
        <>
          <button type="button" onClick={() => setArmed(false)}>defuse</button>
          <ErrorBoundary label="Pane"><Boom armed={armed} /></ErrorBoundary>
        </>
      );
    }

    render(<Host />);
    expect(screen.getByTestId('error-boundary-fallback')).toBeTruthy();

    await user.click(screen.getByText('defuse'));
    await user.click(screen.getByTestId('error-boundary-retry'));

    expect(screen.queryByTestId('error-boundary-fallback')).toBeNull();
    expect(screen.getByText('child is fine')).toBeTruthy();
    spy.mockRestore();
  });

  it('stays in the fallback when retrying while still broken', async () => {
    const spy = silenceReactErrorLogging();
    const user = userEvent.setup();
    render(<ErrorBoundary label="Pane"><Boom armed /></ErrorBoundary>);

    await user.click(screen.getByTestId('error-boundary-retry'));

    // Correct: retry remounts, the cause is unchanged, so it fails again rather
    // than pretending to have recovered.
    expect(screen.getByTestId('error-boundary-fallback')).toBeTruthy();
    spy.mockRestore();
  });

  it('clears itself when the pane navigates somewhere else', () => {
    const spy = silenceReactErrorLogging();
    const { rerender } = render(
      <ErrorBoundary label="Pane" resetKey="/notes/1"><Boom armed /></ErrorBoundary>,
    );
    expect(screen.getByTestId('error-boundary-fallback')).toBeTruthy();

    rerender(
      <ErrorBoundary label="Pane" resetKey="/Study"><Boom armed={false} /></ErrorBoundary>,
    );
    expect(screen.queryByTestId('error-boundary-fallback')).toBeNull();
    expect(screen.getByText('child is fine')).toBeTruthy();
    spy.mockRestore();
  });

  it('reports the error to the host without swallowing it', () => {
    const spy = silenceReactErrorLogging();
    const onError = vi.fn();
    render(<ErrorBoundary label="Pane" onError={onError}><Boom armed /></ErrorBoundary>);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe('render exploded');
    spy.mockRestore();
  });

  it('lets a host supply its own fallback', () => {
    const spy = silenceReactErrorLogging();
    render(
      <ErrorBoundary fallback={({ error }) => <p>custom: {error.message}</p>}>
        <Boom armed />
      </ErrorBoundary>,
    );
    expect(screen.getByText('custom: render exploded')).toBeTruthy();
    expect(screen.queryByTestId('error-boundary-fallback')).toBeNull();
    spy.mockRestore();
  });
});
