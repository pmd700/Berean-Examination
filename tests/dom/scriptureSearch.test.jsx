import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ScriptureSearch from '@/components/scripture/ScriptureSearch';
import { restartBex } from '@/lib/restartBex';
vi.mock('@/lib/restartBex', () => ({ restartBex: vi.fn() }));

let configured;
let api;
beforeEach(() => {
  configured = false;
  restartBex.mockReset();
  api = {
    isDesktop: true,
    getScriptureStatus: vi.fn(async () => ({ ok: true, status: { configured } })),
    saveScriptureKey: vi.fn(async () => { configured = true; return { ok: true, status: { configured } }; }),
    clearScriptureKey: vi.fn(async () => { configured = false; return { ok: true, status: { configured } }; }),
    openExternalUrl: vi.fn(async () => ({ ok: true })),
  };
  window.bexDesktop = api;
  window.localStorage.clear();
});
afterEach(() => { cleanup(); delete window.bexDesktop; });
const keyInput = () => screen.getByLabelText('API.Bible API key');
const unlockButton = () => screen.getByRole('button', { name: 'unlock scripture reading here' });
const submit = () => fireEvent.submit(screen.getByRole('form', { name: 'Scripture search setup' }));
async function openSetup() {
  fireEvent.click(unlockButton());
  await screen.findByRole('dialog', { name: 'Free Use Bible API' });
  await waitFor(() => expect(keyInput().disabled).toBe(false));
}
async function mount() {
  const view = render(<ScriptureSearch />);
  await waitFor(() => expect(screen.getByTestId('scripture-search').getAttribute('aria-busy')).toBe('false'));
  return view;
}

describe('scripture search setup', () => {
  it('starts locked and masks the key, waits for successful storage, and clears the input', async () => {
    await mount();
    expect(unlockButton().textContent).toBe('unlock scripture reading here');
    expect(screen.queryByLabelText('API.Bible API key')).toBeNull();
    await openSetup();
    const link = screen.getByRole('link', { name: 'Free Use Bible API' });
    expect(link.getAttribute('href')).toBe('https://bible.helloao.org/docs/?ref=faith.tools');
    expect(screen.getByAltText('Free Use Bible API logo').getAttribute('src')).toContain('free-use-bible-api.png');
    expect(screen.queryByText('BEX · SCRIPTURE')).toBeNull();
    expect(screen.queryByText('Unlock scripture reading')).toBeNull();
    fireEvent.click(link);
    await waitFor(() => expect(api.openExternalUrl).toHaveBeenCalledWith('https://bible.helloao.org/docs/?ref=faith.tools'));
    expect(keyInput().placeholder).toBe('paste your api key here');
    expect(keyInput().type).toBe('password');
    let finish;
    api.saveScriptureKey.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    fireEvent.change(keyInput(), { target: { value: ' synthetic-test-key ' } });
    submit();
    expect(screen.getByTestId('scripture-search').dataset.locked).toBe('true');
    expect(screen.getByLabelText('Save API key').disabled).toBe(true);
    expect(screen.getByLabelText('Close scripture setup').disabled).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeTruthy();
    await act(async () => { finish({ ok: true, status: { configured: true } }); });
    expect(api.saveScriptureKey).toHaveBeenCalledWith('synthetic-test-key');
    expect(screen.getByLabelText('Search scripture').value).toBe('');
    expect(screen.getByTestId('scripture-search').dataset.locked).toBe('false');
    expect(document.querySelector('.scripture-search__aura')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.localStorage.length).toBe(0);
    expect(screen.getByRole('status').textContent).toContain('search is coming next');
  });

  it('retains the locked state on failure and rejects malformed input before IPC', async () => {
    await mount();
    await openSetup();
    fireEvent.change(keyInput(), { target: { value: 'bad key' } });
    submit();
    expect(api.saveScriptureKey).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('without spaces');
    api.saveScriptureKey.mockResolvedValue({ ok: false, error: 'Protected storage unavailable' });
    fireEvent.change(keyInput(), { target: { value: 'synthetic-test-key' } });
    submit();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Protected storage unavailable'));
    expect(keyInput().value).toBe('');
    expect(screen.getByTestId('scripture-search').dataset.locked).toBe('true');
  });

  it.each(['missing bridge', 'missing method', 'missing handler'])('opens quietly with a %s and explains recovery only after submission', async (scenario) => {
    if (scenario === 'missing bridge') delete window.bexDesktop;
    else if (scenario === 'missing method') {
      delete api.getScriptureStatus;
      delete api.saveScriptureKey;
    } else {
      api.getScriptureStatus.mockRejectedValue(new Error("Error invoking remote method 'scripture:get-status': Error: No handler registered for 'scripture:get-status'"));
      api.saveScriptureKey.mockRejectedValue(new Error("Error invoking remote method 'scripture:save-key': Error: No handler registered for 'scripture:save-key'"));
    }
    await mount();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('scripture-search').dataset.locked).toBe('true');
    expect(document.querySelector('.scripture-search__aura').parentElement).toBe(screen.getByTestId('scripture-search'));
    await openSetup();
    fireEvent.change(keyInput(), { target: { value: 'synthetic-test-key' } });
    submit();
    const message = await screen.findByRole('alert');
    expect(message.textContent).toContain('Restart BEX once');
    expect(message.textContent).not.toMatch(/remote method|No handler|scripture:/);
    expect(keyInput().value).toBe('');
    expect(window.localStorage.length).toBe(0);
  });

  it('recovers from a failed startup probe and hides raw transport errors on an explicit save', async () => {
    api.getScriptureStatus.mockRejectedValue(new Error('Transient IPC failure'));
    await mount();
    expect(screen.queryByRole('alert')).toBeNull();
    await openSetup();
    api.saveScriptureKey.mockRejectedValueOnce(new Error('Sensitive transport internals'));
    fireEvent.change(keyInput(), { target: { value: 'synthetic-test-key' } });
    submit();
    expect((await screen.findByRole('alert')).textContent).toBe('Scripture setup is temporarily unavailable. Please try again.');
    expect(screen.queryByRole('button', { name: 'Restart BEX' })).toBeNull();
    fireEvent.change(keyInput(), { target: { value: 'synthetic-test-key' } });
    submit();
    await screen.findByLabelText('Search scripture');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('offers one-click restart on the recovery message, locks the form, and permits retry after failure', async () => {
    api.saveScriptureKey.mockRejectedValue(new Error('No handler registered for scripture:save-key'));
    await mount();
    await openSetup();
    fireEvent.change(keyInput(), { target: { value: 'synthetic-test-key' } });
    submit();
    const button = await screen.findByRole('button', { name: 'Restart BEX' });
    let reject;
    restartBex.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    fireEvent.click(button);
    fireEvent.click(button);
    expect(restartBex).toHaveBeenCalledOnce();
    expect(keyInput().value).toBe('');
    expect(keyInput().disabled).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeTruthy();
    await act(async () => { reject(new Error('Recent edits could not be saved.')); });
    expect(keyInput().disabled).toBe(false);
    expect(screen.getByRole('alert').textContent).toContain('could not be saved');
    restartBex.mockResolvedValueOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Restart BEX' }));
    await waitFor(() => expect(restartBex).toHaveBeenCalledTimes(2));
  });

  it('restores saved setup without retrieving the key and can replace or remove it', async () => {
    configured = true;
    render(<ScriptureSearch />);
    await screen.findByLabelText('Search scripture');
    fireEvent.click(screen.getByLabelText('Manage scripture API key'));
    expect(keyInput().value).toBe('');
    fireEvent.change(keyInput(), { target: { value: 'synthetic-replacement-key' } });
    submit();
    await screen.findByLabelText('Search scripture');
    fireEvent.click(screen.getByLabelText('Manage scripture API key'));
    fireEvent.click(screen.getByText('Remove saved key'));
    await waitFor(() => expect(screen.getByTestId('scripture-search').dataset.locked).toBe('true'));
    expect(api.clearScriptureKey).toHaveBeenCalledOnce();
  });

  it('updates other mounted home tabs after a successful save or removal', async () => {
    render(<><ScriptureSearch /><ScriptureSearch /></>);
    await waitFor(() => expect(screen.getAllByTestId('scripture-search').every((root) => root.getAttribute('aria-busy') === 'false')).toBe(true));
    fireEvent.click(screen.getAllByRole('button', { name: 'unlock scripture reading here' })[0]);
    fireEvent.change(keyInput(), { target: { value: 'synthetic-key' } });
    submit();
    await waitFor(() => expect(screen.getAllByLabelText('Search scripture')).toHaveLength(2));
    expect(api.saveScriptureKey).toHaveBeenCalledOnce();
  });

  it('keeps draft search local and explicitly reports that results are a later stage', async () => {
    configured = true;
    render(<ScriptureSearch />);
    const input = await screen.findByLabelText('Search scripture');
    fireEvent.change(input, { target: { value: 'John 3:16' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Scripture search' }));
    expect(screen.getByRole('status').textContent).toContain('search is coming next');
    expect(api.saveScriptureKey).not.toHaveBeenCalled();
  });

  it('focuses the popup field, closes with Escape, restores focus, and discards a dismissed key', async () => {
    await mount();
    await openSetup();
    expect(document.activeElement).toBe(keyInput());
    fireEvent.change(keyInput(), { target: { value: 'unsaved-synthetic-key' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(unlockButton());
    await openSetup();
    expect(keyInput().value).toBe('');
    expect(api.saveScriptureKey).not.toHaveBeenCalled();
  });

  it('navigates to /ScriptureReader with encoded query when submitted inside a router', async () => {
    configured = true;
    const { MemoryRouter, useLocation } = await import('react-router-dom');
    function LocationWatcher({ onLocation }) {
      const loc = useLocation();
      React.useEffect(() => { onLocation(loc); }, [loc, onLocation]);
      return null;
    }
    let currentLoc;
    render(
      <MemoryRouter initialEntries={['/LibraryHome']}>
        <LocationWatcher onLocation={(l) => { currentLoc = l; }} />
        <ScriptureSearch />
      </MemoryRouter>
    );
    const input = await screen.findByLabelText('Search scripture');
    const complexQuery = 'revelation 4:1, 4, 9; Col 1:1, 2:2, 4-5; jere 50:1 - song of solomon 1:1, 4';
    fireEvent.change(input, { target: { value: complexQuery } });
    fireEvent.submit(screen.getByRole('form', { name: 'Scripture search' }));
    await waitFor(() => {
      expect(currentLoc.pathname).toBe('/Study');
      expect(currentLoc.search).toBe(`?q=${encodeURIComponent(complexQuery)}`);
    });
    // Ensure "search is coming next" popover is NOT displayed
    expect(screen.queryByText(/search is coming next/i)).toBeNull();
  });
});

