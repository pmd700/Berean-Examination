import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const store = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn(), create: vi.fn() }));
vi.mock('@/lib/platform/entities', () => ({ platformEntities: { Keyword: store } }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: true, isLoadingAuth: false, user: {} }) }));
vi.mock('@/lib/WorkspaceTabs', () => ({ useIsActiveTab: () => true }));
vi.mock('@/components/navigation/BackToLibraryHomeButton', () => ({ default: () => null, useReturnToLibraryHome: () => () => {} }));
vi.mock('@/components/utils/activityTracker', () => ({ trackActivity: vi.fn() }));
vi.mock('@/components/editor/TEXT_EDITOR_MACHINERY', () => ({
  default: ({ content, onChange }) => <textarea aria-label="Explanation" value={content} onChange={event => onChange(event.target.value)} />,
}));
import Keywords from '@/pages/Keywords';

const original = {
  id: 1, title: 'Original keyword', category: 'Theology', explanation: '<p>Original explanation</p>',
  created_date: '2026-11-08T12:00:00Z', updated_date: '2026-11-08T12:00:00Z',
};
beforeEach(() => {
  store.list.mockResolvedValue([{ ...original }]);
  store.update.mockResolvedValue(undefined);
  store.create.mockResolvedValue(undefined);
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

async function openKeyword() {
  render(<MemoryRouter><Keywords /></MemoryRouter>);
  fireEvent.click(await screen.findByText(original.title));
  vi.useFakeTimers();
}
const advance = async ms => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

it('accepts all 30 category characters when creating a keyword and caps longer input', async () => {
  render(<MemoryRouter><Keywords /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'New Keyword' }));
  const category = screen.getByLabelText(/Category/);
  const value = 'Eschatological Identification!';
  expect(value).toHaveLength(30);
  fireEvent.change(category, { target: { value: `${value} extra` } });
  expect(category.value).toBe(value);
  expect(screen.getByText('30/30')).toBeTruthy();
  expect(screen.getByText('(optional, max 30 characters)')).toBeTruthy();
  fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'New keyword' } });
  fireEvent.change(screen.getByLabelText('Explanation'), { target: { value: '<p>New explanation</p>' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create Keyword' })); });
  expect(store.create).toHaveBeenCalledExactlyOnceWith({ title: 'New keyword', category: value, explanation: '<p>New explanation</p>' });
});

it.each([
  [/Title/, 'Changed title', 'title'],
  [/Category/, 'Changed category', 'category'],
  ['Explanation', '<p>Changed explanation</p>', 'explanation'],
])('autosaves a %s change after 400ms and keeps the list current when reopened', async (label, value, field) => {
  await openKeyword();
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
  await advance(399);
  expect(store.update).not.toHaveBeenCalled();
  await advance(1);
  expect(store.update).toHaveBeenCalledExactlyOnceWith(1, {
    title: original.title, category: original.category, explanation: original.explanation, [field]: value,
  });
  expect(screen.getByText('Saved')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  fireEvent.click(screen.getByText(field === 'title' ? value : original.title));
  expect(screen.getByLabelText(label).value).toBe(value);
});

it('saves ongoing typing within 1500ms with the latest complete form', async () => {
  await openKeyword();
  fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Updated title' } });
  for (let i = 1; i <= 4; i++) {
    await advance(300);
    fireEvent.change(screen.getByLabelText('Explanation'), { target: { value: `<p>Edit ${i}</p>` } });
  }
  await advance(299);
  expect(store.update).not.toHaveBeenCalled();
  await advance(1);
  expect(store.update).toHaveBeenCalledExactlyOnceWith(1, {
    title: 'Updated title', category: original.category, explanation: '<p>Edit 4</p>',
  });
});

it('keeps a failed keyword write unsaved and retries on the next edit', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  store.update.mockRejectedValueOnce(new Error('Write failed'));
  await openKeyword();
  fireEvent.change(screen.getByLabelText(/Category/), { target: { value: 'First edit' } });
  await advance(400);
  expect(screen.getByText('Unsaved changes')).toBeTruthy();
  fireEvent.change(screen.getByLabelText(/Category/), { target: { value: 'Retry edit' } });
  await advance(400);
  expect(store.update).toHaveBeenLastCalledWith(1, expect.objectContaining({ category: 'Retry edit' }));
  expect(screen.getByText('Saved')).toBeTruthy();
});

it('finishes a slow autosave before applying an explicit update with newer text', async () => {
  let finish;
  store.update.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await openKeyword();
  fireEvent.change(screen.getByLabelText('Explanation'), { target: { value: '<p>First edit</p>' } });
  await advance(400);
  fireEvent.change(screen.getByLabelText('Explanation'), { target: { value: '<p>Latest edit</p>' } });
  fireEvent.click(screen.getByRole('button', { name: 'Update Keyword' }));
  await advance(0);
  expect(store.update).toHaveBeenCalledTimes(1);
  await act(async () => { finish(); });
  expect(store.update).toHaveBeenLastCalledWith(1, expect.objectContaining({ explanation: '<p>Latest edit</p>' }));
  expect(screen.queryByRole('button', { name: 'Update Keyword' })).toBeNull();
});
