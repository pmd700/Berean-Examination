import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAutoSave } from '@/components/editor/useAutoSave';

function Editor({ content, save }) {
  const { saveStatus } = useAutoSave({ content, initialContent: '', onSave: save, delay: 400, maxWait: 1500 });
  return <output>{saveStatus}</output>;
}
const advance = async ms => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('saves annotation text 400ms after typing stops, without a Save click', async () => {
  const save = vi.fn(async () => {});
  const view = render(<Editor content="" save={save} />);
  view.rerender(<Editor content="My annotation" save={save} />);
  await advance(399);
  expect(save).not.toHaveBeenCalled();
  await advance(1);
  expect(save).toHaveBeenCalledExactlyOnceWith('My annotation');
  expect(screen.getByRole('status').textContent).toBe('saved');
});

it('saves the latest text within 1500ms even while typing continues', async () => {
  const save = vi.fn(async () => {});
  const view = render(<Editor content="First" save={save} />);
  for (let i = 1; i <= 4; i++) {
    await advance(300);
    view.rerender(<Editor content={`Edit ${i}`} save={save} />);
  }
  await advance(299);
  expect(save).not.toHaveBeenCalled();
  await advance(1);
  expect(save).toHaveBeenCalledExactlyOnceWith('Edit 4');
});

it('serializes a slow save and drains newer edits before showing Saved', async () => {
  let finish;
  const save = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(undefined);
  const view = render(<Editor content="First" save={save} />);
  await advance(400);
  view.rerender(<Editor content="Latest" save={save} />);
  await advance(500);
  expect(save).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status').textContent).toBe('saving');
  await act(async () => { finish(); });
  expect(save.mock.calls).toEqual([['First'], ['Latest']]);
  expect(screen.getByRole('status').textContent).toBe('saved');
  await advance(2000);
  expect(save).toHaveBeenCalledTimes(2);
});

it('keeps a failed save unsaved and retries with the next edit', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const save = vi.fn().mockRejectedValueOnce(new Error('Write failed')).mockResolvedValue(undefined);
  const view = render(<Editor content="Must survive" save={save} />);
  await advance(400);
  expect(screen.getByRole('status').textContent).toBe('unsaved');
  view.rerender(<Editor content="Must survive, updated" save={save} />);
  await advance(400);
  expect(save.mock.calls).toEqual([['Must survive'], ['Must survive, updated']]);
  expect(screen.getByRole('status').textContent).toBe('saved');
  log.mockRestore();
});
