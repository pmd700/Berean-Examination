import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TabBar from '@/components/tabs/TabBar';
import RefreshBexButton from '@/components/tabs/RefreshBexButton';
import { useAutoSave } from '@/components/editor/useAutoSave';
import { WorkspaceTabsProvider } from '@/lib/WorkspaceTabs';
import { refreshBex } from '@/lib/refreshBex';
import { flushPendingEditorSaves } from '@/lib/pendingEditorSaves';
import { waitForLocalEntityWritesToSettle } from '@/lib/localEntities';

const error = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { error } }));
vi.mock('@/lib/localEntities', () => ({ waitForLocalEntityWritesToSettle: vi.fn() }));

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function Editor({ content, onSave, enabled = true }) {
  const { saveStatus } = useAutoSave({ content, initialContent: 'Original', onSave, enabled, delay: 5000 });
  return <output data-testid="save-status">{saveStatus}</output>;
}

beforeEach(() => {
  waitForLocalEntityWritesToSettle.mockReset();
  waitForLocalEntityWritesToSettle.mockResolvedValue(undefined);
  error.mockReset();
  window.localStorage.clear();
});
afterEach(() => { cleanup(); vi.useRealTimers(); window.localStorage.clear(); });

describe('refreshing BEX without dropping autosaved edits', () => {
  it('flushes long-delay editors from multiple tabs and waits for the vault before reloading', async () => {
    const save = deferred();
    const vault = deferred();
    const onSave = vi.fn(() => save.promise);
    const backgroundSave = vi.fn(async () => {});
    const reload = vi.fn();
    waitForLocalEntityWritesToSettle.mockReturnValueOnce(vault.promise);
    const view = render(<><Editor content="Original" onSave={onSave} /><Editor content="Original" onSave={backgroundSave} /></>);
    view.rerender(<><Editor content="Current study text" onSave={onSave} /><Editor content="Background tab text" onSave={backgroundSave} /></>);
    let request;
    await act(async () => { request = refreshBex({ reload }); });
    expect(onSave).toHaveBeenCalledExactlyOnceWith('Current study text');
    expect(backgroundSave).toHaveBeenCalledExactlyOnceWith('Background tab text');
    expect(reload).not.toHaveBeenCalled();
    expect(waitForLocalEntityWritesToSettle).not.toHaveBeenCalled();
    await act(async () => { save.resolve(); });
    expect(waitForLocalEntityWritesToSettle).toHaveBeenCalledWith({ quietMs: 1000, operationName: 'Refresh' });
    expect(reload).not.toHaveBeenCalled();
    await act(async () => { vault.resolve(); await request; });
    expect(reload).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('joins an already-running timer save and saves edits made during it exactly once', async () => {
    vi.useFakeTimers();
    const first = deferred();
    const second = deferred();
    const onSave = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const reload = vi.fn();
    const view = render(<Editor content="Original" onSave={onSave} />);
    view.rerender(<Editor content="First edit" onSave={onSave} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(4999); });
    expect(onSave).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(onSave).toHaveBeenCalledExactlyOnceWith('First edit');
    let request;
    let concurrent;
    await act(async () => { request = refreshBex({ reload }); concurrent = flushPendingEditorSaves(); });
    view.rerender(<Editor content="Latest edit" onSave={onSave} />);
    await act(async () => { first.resolve(); });
    expect(onSave.mock.calls).toEqual([['First edit'], ['Latest edit']]);
    expect(reload).not.toHaveBeenCalled();
    await act(async () => { second.resolve(); await Promise.all([request, concurrent]); });
    expect(reload).toHaveBeenCalledOnce();
    expect(screen.getByTestId('save-status').textContent).toBe('saved');
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it('saves a study edit made during the vault wait and waits again before reload', async () => {
    const vault = deferred();
    const onSave = vi.fn(async () => {});
    const reload = vi.fn();
    waitForLocalEntityWritesToSettle.mockReturnValueOnce(vault.promise);
    const view = render(<Editor content="First edit" onSave={onSave} />);
    let request;
    await act(async () => { request = refreshBex({ reload }); });
    view.rerender(<Editor content="Second edit while waiting" onSave={onSave} />);
    await act(async () => { vault.resolve(); await request; });
    expect(onSave.mock.calls).toEqual([['First edit'], ['Second edit while waiting']]);
    expect(waitForLocalEntityWritesToSettle).toHaveBeenCalledTimes(2);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('shows a save failure, keeps the interface open, and retries the same dirty text', async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error('Disk full.')).mockResolvedValue(undefined);
    const reload = vi.fn();
    render(<><Editor content="Must survive" onSave={onSave} /><RefreshBexButton onRefresh={() => refreshBex({ reload })} /></>);
    const button = screen.getByRole('button', { name: 'Refresh BEX' });
    fireEvent.click(button);
    await waitFor(() => expect(error).toHaveBeenCalledOnce());
    expect(error.mock.calls[0][0]).toContain('Your workspace has been kept open');
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByTestId('save-status').textContent).toBe('unsaved');
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(onSave.mock.calls).toEqual([['Must survive'], ['Must survive']]);
  });

  it('disables repeat clicks while saving and exposes accessible progress', async () => {
    const save = deferred();
    const onRefresh = vi.fn(() => save.promise);
    render(<RefreshBexButton onRefresh={onRefresh} />);
    const button = screen.getByRole('button', { name: 'Refresh BEX' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status').textContent).toContain('Saving edits');
    expect(onRefresh).toHaveBeenCalledOnce();
    await act(async () => { save.resolve(); });
    expect(button.disabled).toBe(false);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('blocks reload after a failed note/import barrier or a stalled editor save', async () => {
    const reload = vi.fn();
    waitForLocalEntityWritesToSettle.mockRejectedValueOnce(new Error('Earlier note save failed.'));
    await expect(refreshBex({ reload })).rejects.toThrow('a recent save failed');
    expect(reload).not.toHaveBeenCalled();

    vi.useFakeTimers();
    const stalled = deferred();
    render(<Editor content="Pending edit" onSave={() => stalled.promise} />);
    let request;
    await act(async () => {
      request = expect(refreshBex({ reload, timeoutMs: 100 })).rejects.toThrow('Your workspace has been kept open');
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); await request; });
    expect(reload).not.toHaveBeenCalled();
    await act(async () => { stalled.resolve(); });
    expect(reload).not.toHaveBeenCalled(); // A late save cannot trigger a late reload.
  });

  it('unregisters closed editors and does not save disabled editor contents', async () => {
    const closedSave = vi.fn();
    const closed = render(<Editor content="Closed draft" onSave={closedSave} />);
    closed.unmount();
    const disabledSave = vi.fn();
    render(<Editor content="Inactive form" onSave={disabledSave} enabled={false} />);
    const reload = vi.fn();
    await act(async () => { await refreshBex({ reload }); });
    expect(closedSave).not.toHaveBeenCalled();
    expect(disabledSave).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('puts the button beside new-tab and preserves the active tab, order, and preferences across remount', async () => {
    const session = {
      tabs: [
        { id: 'notes-7', kind: 'notes', title: 'Research', path: '/notes/7/Research' },
        { id: 'study-8', kind: 'study', title: 'John 1', path: '/Study?chapter_id=8' },
      ],
      activeId: 'study-8',
    };
    window.localStorage.setItem('bex_workspace_tabs_v1', JSON.stringify(session));
    window.localStorage.setItem('bex_test_preference', 'dark');
    const mount = () => render(<WorkspaceTabsProvider initialPath="/LibraryHome"><TabBar /></WorkspaceTabsProvider>);
    let view = mount();
    const button = screen.getByRole('button', { name: 'Refresh BEX' });
    expect(button.previousElementSibling.getAttribute('data-testid')).toBe('workspace-tab-new');
    const stored = window.localStorage.getItem('bex_workspace_tabs_v1');
    await act(async () => { await refreshBex({ reload: () => view.unmount() }); });
    expect(window.localStorage.getItem('bex_workspace_tabs_v1')).toBe(stored);
    view = mount();
    expect(screen.getByTestId('workspace-tab-study-8').getAttribute('data-active')).toBe('true');
    expect([...screen.getByTestId('workspace-tab-bar').querySelectorAll('[data-active]')].map(tab => tab.getAttribute('data-testid')))
      .toEqual(['workspace-tab-notes-7', 'workspace-tab-study-8']);
    expect(window.localStorage.getItem('bex_test_preference')).toBe('dark');
    view.unmount();
  });
});
