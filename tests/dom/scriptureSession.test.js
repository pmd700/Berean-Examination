import { afterEach, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import useScriptureSearchSession from '@/components/scripture/useScriptureSearchSession';
import { SCRIPTURE_SETUP_CHANGED_EVENT } from '@/lib/scriptureSetup';

afterEach(() => { vi.useRealTimers(); delete window.bexDesktop; });
const response = fetchedAt => ({ ok: true, result: { fetchedAt, data: { content: [{ type: 'text', text: 'Temporary Scripture body' }] } } });
it('expires an already open cached view at its original retrieval deadline', async () => {
  window.bexDesktop = { isDesktop: true, fetchScriptureContent: vi.fn(async () => response(Date.now() - 14 * 86400000 + 10000)) };
  const { result } = renderHook(() => useScriptureSearchSession());
  act(() => result.current.start('Romans 1', 'edition', 'TEST'));
  await waitFor(() => expect(result.current.search.loading).toBe(false));
  expect(result.current.search.results[0].data).toBeTruthy();
  vi.useFakeTimers();
  // Rerender so the expiry timer is created on the fake clock.
  act(() => result.current.retry());
  await act(() => vi.advanceTimersByTimeAsync(10001));
  expect(result.current.search.results[0].data).toBeNull();
  expect(result.current.search.results[0].error).toContain('expired');
});
it('a credential change clears visible bodies and ignores the old in-flight reply', async () => {
  let release;
  window.bexDesktop = { isDesktop: true, fetchScriptureContent: vi.fn(() => new Promise(resolve => { release = resolve; })),
    cancelScriptureRequest: vi.fn(async () => ({ ok: true })) };
  const { result } = renderHook(() => useScriptureSearchSession());
  act(() => result.current.start('Romans 1', 'edition', 'TEST'));
  act(() => window.dispatchEvent(new CustomEvent(SCRIPTURE_SETUP_CHANGED_EVENT, { detail: { configured: false } })));
  await act(async () => release(response(Date.now())));
  expect(result.current.search.loading).toBe(false);
  expect(result.current.search.results[0].data).toBeNull();
  expect(result.current.search.results[0].error).toContain('setup changed');
});
