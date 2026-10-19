import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({ read: vi.fn(), prepare: vi.fn(), save: vi.fn(), unlock: vi.fn(), getKey: vi.fn() }));
vi.mock('@/lib/PrivateWebContext', () => ({ usePrivateWeb: () => ({ unlock: harness.unlock, getKey: harness.getKey }) }));
vi.mock('@/lib/aiLibraryExport', async original => ({ ...await original(), readAiLibrarySnapshot: (...args) => harness.read(...args), prepareAiLibraryExport: (...args) => harness.prepare(...args) }));
vi.mock('@/lib/saveExportFile', () => ({ saveExportFile: (...args) => harness.save(...args) }));
import AiExportButton from '@/components/library/AiExportButton';

const snapshot = () => ({ notes: [{ id: 1, title: 'Book', content: 'Writing.' }], webs: [], cards: [], connections: [], objects: [], timelines: [], commentaries: [], studies: [], keywords: [], drawings: [], mindLinks: [], folders: [] });
const built = { text: '# All ideas\nOriginal writing.', counts: { notes: 1, pages: 1, webs: 0, cards: 0, timelines: 0, events: 0, commentaries: 0, keywords: 0 }, sourceCount: 2, byteLength: 31, warningCount: 0, fileName: 'ideas.md' };
beforeEach(() => {
  for (const mock of Object.values(harness)) mock.mockReset();
  harness.read.mockResolvedValue(snapshot());
  harness.prepare.mockResolvedValue(built);
  harness.save.mockResolvedValue({ status: 'saved', fileName: 'ideas.md' });
  harness.getKey.mockReturnValue(null);
});
afterEach(() => vi.unstubAllGlobals());
const open = async () => {
  render(<AiExportButton />);
  fireEvent.click(screen.getByTestId('library-ai-export-button'));
  await waitFor(() => expect(screen.getByTestId('ai-export-save').disabled).toBe(false));
};

describe('single-file AI export control', () => {
  it('saves one Markdown file, suppresses repeated clicks and distinguishes cancellation from saved output', async () => {
    await open();
    fireEvent.click(screen.getByTestId('ai-export-save'));
    fireEvent.click(screen.getByTestId('ai-export-save'));
    await screen.findByText('Your AI export is saved.');
    expect(harness.prepare).toHaveBeenCalledTimes(1);
    expect(harness.save).toHaveBeenCalledTimes(1);
    expect(harness.save.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(harness.save.mock.calls[0][1]).toBe('ideas.md');
    harness.save.mockResolvedValue({ status: 'canceled' });
    fireEvent.click(screen.getByTestId('ai-export-save'));
    await screen.findByText('Save canceled. No file was written.');
    expect(screen.queryByText('Your AI export is saved.')).toBeNull();
  });

  it('requires private-web unlock and passes its key into the export without storing the passphrase', async () => {
    const privateSnapshot = snapshot(); privateSnapshot.webs = [{ id: 7, title: 'Private', is_private: true }];
    harness.read.mockResolvedValue(privateSnapshot);
    const key = { type: 'secret' }; harness.unlock.mockResolvedValue(key);
    render(<AiExportButton />);
    fireEvent.click(screen.getByTestId('library-ai-export-button'));
    const passphrase = await screen.findByPlaceholderText('Passphrase');
    expect(screen.getByTestId('ai-export-save').disabled).toBe(true);
    fireEvent.change(passphrase, { target: { value: 'synthetic passphrase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await waitFor(() => expect(screen.getByTestId('ai-export-save').disabled).toBe(false));
    fireEvent.click(screen.getByTestId('ai-export-save'));
    await screen.findByText('Your AI export is saved.');
    expect(harness.prepare.mock.calls[0][0].getKey(7)).toBe(key);
    expect(harness.save.mock.calls[0][1]).toBe('ideas.md');
    expect(screen.queryByDisplayValue('synthetic passphrase')).toBeNull();
  });

  it('cancels preparation without opening Save As and surfaces save failures without stale success', async () => {
    harness.prepare.mockImplementation(({ signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Canceled', 'AbortError')))));
    await open();
    fireEvent.click(screen.getByTestId('ai-export-save'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel export' }));
    await screen.findByText('Export canceled.');
    expect(harness.save).not.toHaveBeenCalled();
    harness.prepare.mockResolvedValue(built);
    harness.save.mockRejectedValue(new Error('Disk full.'));
    fireEvent.click(screen.getByTestId('ai-export-save'));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Disk full.');
    expect(screen.queryByText('Your AI export is saved.')).toBeNull();
  });
});
