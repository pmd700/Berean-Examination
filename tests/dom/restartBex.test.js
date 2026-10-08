import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { restartBex } from '@/lib/restartBex';
import { waitForLocalEntityWritesToSettle } from '@/lib/localEntities';
vi.mock('@/lib/localEntities', () => ({ waitForLocalEntityWritesToSettle: vi.fn() }));

beforeEach(() => {
  waitForLocalEntityWritesToSettle.mockReset();
  window.bexDesktop = { isDesktop: true, restartApp: vi.fn(async () => ({ ok: true })) };
});
afterEach(() => { delete window.bexDesktop; });

it('waits for pending edits before requesting the desktop restart', async () => {
  let finish;
  waitForLocalEntityWritesToSettle.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const request = restartBex();
  expect(window.bexDesktop.restartApp).not.toHaveBeenCalled();
  finish();
  await request;
  expect(window.bexDesktop.restartApp).toHaveBeenCalledOnce();
});

it('keeps the app open if edits cannot be saved', async () => {
  waitForLocalEntityWritesToSettle.mockRejectedValueOnce(new Error('disk unavailable'));
  await expect(restartBex()).rejects.toThrow('could not save recent edits');
  expect(window.bexDesktop.restartApp).not.toHaveBeenCalled();
});

it('reports unavailable restart support and desktop failure without raw IPC errors', async () => {
  delete window.bexDesktop.restartApp;
  await expect(restartBex()).rejects.toThrow('older desktop process');
  window.bexDesktop.restartApp = vi.fn(async () => { throw Error('No handler registered app:restart'); });
  await expect(restartBex()).rejects.toThrow('could not start the restart');
});
