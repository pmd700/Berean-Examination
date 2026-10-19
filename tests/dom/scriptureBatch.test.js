import { afterEach, expect, it, vi } from 'vitest';
import { fetchScriptureBatch } from '@/lib/scriptureClient';

const requests = ['ROM.1', 'JHN.1', 'MRK.1'].map(id => ({ id, type: 'chapter' }));
afterEach(() => { vi.useRealTimers(); delete window.bexDesktop; });
it('a twenty-second deadline cancels active requests, skips queued units and settles even if IPC never replies', async () => {
  vi.useFakeTimers();
  window.bexDesktop = { isDesktop: true, fetchScriptureContent: vi.fn(() => new Promise(() => {})), cancelScriptureRequest: vi.fn(async () => ({ ok: true })) };
  const progress = vi.fn();
  const pending = fetchScriptureBatch(requests, { bibleId: 'edition', batchId: 'deadline', onProgress: progress });
  expect(window.bexDesktop.fetchScriptureContent).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(20000);
  const results = await pending;
  expect(window.bexDesktop.cancelScriptureRequest).toHaveBeenCalledTimes(2);
  expect(window.bexDesktop.fetchScriptureContent).toHaveBeenCalledTimes(2);
  expect(results.every(result => result.status === 'cancelled')).toBe(true);
  expect(results[2].error).toContain('timed out');
  expect(progress.mock.calls.at(-1)[0].total).toBe(3);
});
it('an already-cancelled batch makes no IPC content requests', async () => {
  window.bexDesktop = { isDesktop: true, fetchScriptureContent: vi.fn() };
  const controller = new AbortController(); controller.abort();
  const results = await fetchScriptureBatch(requests, { bibleId: 'edition', signal: controller.signal });
  expect(window.bexDesktop.fetchScriptureContent).not.toHaveBeenCalled();
  expect(results.every(result => result.status === 'cancelled')).toBe(true);
});
