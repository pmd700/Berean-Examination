import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/components/shaders/HolographicShader', () => ({ default: () => null }));
import { ConfirmDialogHost, confirmDialog } from '@/components/ui/confirm-dialog';

const options = { title: 'Delete note?', confirmText: 'Delete note', cancelText: 'Keep', confirmDelaySeconds: 5 };
let view;
beforeEach(() => {
  vi.useFakeTimers();
  view = render(<ConfirmDialogHost />);
});
afterEach(() => {
  view.unmount();
  vi.useRealTimers();
});
function open(opts = options) {
  let result;
  act(() => { result = confirmDialog(opts); });
  return result;
}
const advance = async ms => { await act(async () => { vi.advanceTimersByTime(ms); }); };

describe('mandatory note-delete countdown', () => {
  it('shows 5 through 1 and blocks click/Enter until five full seconds pass', async () => {
    const resolved = vi.fn();
    open().then(resolved);
    const button = screen.getByTestId('button-confirm-accept');
    expect(document.activeElement).toBe(screen.getByTestId('button-confirm-cancel'));
    for (let seconds = 5; seconds > 0; seconds--) {
      expect(screen.getByTestId('confirm-countdown').textContent).toBe(`Please wait ${seconds}s`);
      expect(button.disabled).toBe(true);
      expect(button.getAttribute('data-waiting')).toBe('true');
      fireEvent.click(button);
      fireEvent.keyDown(window, { key: 'Enter' });
      await advance(seconds === 1 ? 999 : 1000);
      expect(resolved).not.toHaveBeenCalled();
    }
    expect(button.disabled).toBe(true);
    await advance(1);
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('data-waiting')).toBe('false');
    expect(resolved).not.toHaveBeenCalled(); // Reaching zero never deletes automatically.
    fireEvent.click(button);
    await advance(360);
    expect(resolved).toHaveBeenCalledExactlyOnceWith(true);
  });

  it.each(['Keep', 'Escape'])('allows %s during the wait and resets on reopening', async method => {
    const result = open();
    await advance(3000);
    if (method === 'Keep') fireEvent.click(screen.getByTestId('button-confirm-cancel'));
    else fireEvent.keyDown(window, { key: 'Escape' });
    expect(await result).toBe(false);
    await advance(200);
    open();
    expect(screen.getByTestId('confirm-countdown').textContent).toBe('Please wait 5s');
    await advance(2000);
    expect(screen.getByTestId('button-confirm-accept').disabled).toBe(true);
    expect(screen.getByTestId('confirm-countdown').textContent).toBe('Please wait 3s');
  });

  it('does not inherit the previous request countdown when replacing a dialog', async () => {
    const first = open();
    await advance(4000);
    open({ ...options, title: 'Delete another note?' });
    expect(await first).toBe(false);
    await advance(1000);
    expect(screen.getByTestId('button-confirm-accept').disabled).toBe(true);
    expect(screen.getByTestId('confirm-countdown').textContent).toBe('Please wait 4s');
  });

  it('keeps ordinary confirmations, including home-screen delete, immediately usable', async () => {
    const result = open({ title: 'Delete library item?', confirmText: 'Delete', tone: 'danger' });
    expect(screen.queryByTestId('confirm-countdown')).toBeNull();
    expect(screen.getByTestId('button-confirm-accept').disabled).toBe(false);
    fireEvent.click(screen.getByTestId('button-confirm-accept'));
    await advance(360);
    expect(await result).toBe(true);
  });

  it('cannot bypass the required wait through the native-confirm fallback', async () => {
    view.unmount();
    const native = vi.spyOn(window, 'confirm').mockReturnValue(true);
    expect(await confirmDialog(options)).toBe(false);
    expect(native).not.toHaveBeenCalled();
  });
});
