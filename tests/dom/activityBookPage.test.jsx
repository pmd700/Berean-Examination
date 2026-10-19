import { beforeEach, describe, expect, it, vi } from 'vitest';
const owner = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('@/api/desktopClient', () => ({ desktopClient: { owner: { updatePreferences: owner.save } } }));
import { trackActivity, flushActivity, buildActivityUrl } from '@/components/utils/activityTracker';
import { flushPendingEditorSaves } from '@/lib/pendingEditorSaves';
beforeEach(() => { owner.save.mockReset().mockResolvedValue({}); });
describe('page-aware resume activity', () => {
  it('flushes the newest exact note page before a refresh, without waiting for its debounce', async () => {
    trackActivity({ type: 'mind_note', deep_link: '/notes/book-50?page=9' });
    trackActivity({ type: 'mind_note', deep_link: '/notes/book-50?page=10' });
    await flushPendingEditorSaves();
    expect(owner.save).toHaveBeenCalledTimes(1);
    const activity = JSON.parse(owner.save.mock.calls[0][0].last_activity);
    expect(buildActivityUrl(activity)).toBe('/notes/book-50?page=10');
  });
  it('keeps a failed destination queued and drains a newer page arriving during a save', async () => {
    owner.save.mockRejectedValueOnce(new Error('Disk unavailable'));
    trackActivity({ type: 'mind_note', deep_link: '/notes/other-book-51?page=10' });
    await expect(flushActivity()).rejects.toThrow('Disk unavailable');
    let release;
    owner.save.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const saving = flushActivity();
    trackActivity({ type: 'mind_note', deep_link: '/notes/other-book-51?page=12' });
    release({});
    await saving;
    expect(JSON.parse(owner.save.mock.calls.at(-1)[0].last_activity).deep_link).toBe('/notes/other-book-51?page=12');
    expect(await flushActivity()).toBe(false);
  });
});
