import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  library: null,
  saveFile: vi.fn(),
  error: vi.fn(),
  privateWeb: { unlocked: {}, getKey: () => null },
}));
vi.mock('@/components/knowledgeweb/useWebLibrary', () => ({ default: () => harness.library }));
vi.mock('@/lib/WorkspaceTabs', async importOriginal => ({
  ...await importOriginal(),
  useCurrentWorkspaceTab: () => null,
  useIsActiveTab: () => true,
  useTabTitle: () => {},
  useWorkspaceTabs: () => ({ tabs: [], updateTab: () => {}, selectTab: () => {}, closeTab: () => {} }),
}));
vi.mock('@/lib/PrivateWebContext', () => ({ usePrivateWeb: () => harness.privateWeb }));
vi.mock('@/lib/timegraph/timegraphStore', () => ({ listTimegraphs: async () => [] }));
vi.mock('@/components/scripture/ScriptureSearch', () => ({ default: () => null }));
vi.mock('@/components/search/GlobalSearch', () => ({ LibrarySpotlightSearch: () => null }));
vi.mock('@/components/shaders/Card3DTilt', () => ({ default: ({ children }) => <>{children}</> }));
vi.mock('@/lib/saveExportFile', () => ({ saveExportFile: (...args) => harness.saveFile(...args) }));
vi.mock('sonner', () => ({ toast: { error: (...args) => harness.error(...args) } }));

import LibraryHome from '@/pages/LibraryHome';
import { desktopClient } from '@/api/desktopClient';
import { extractNoteBackupPayload } from '@/lib/noteBackupMarkdown';

const original = { id: 71, title: 'Research', content: '<p>First exported version.</p>' };
let stored;
let exported;

function blobText(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsText(blob);
  });
}
async function exportFromContextMenu() {
  fireEvent.contextMenu(await screen.findByTestId('library-item-note-71'));
  fireEvent.click(within(screen.getByTestId('library-item-context-menu')).getByRole('button', { name: 'Export' }));
}

beforeEach(() => {
  stored = { ...original };
  exported = [];
  harness.library = { loaded: true, webs: [], folders: [], notes: [{ ...original }], refresh: vi.fn(), showCreatePrivateModal: false };
  harness.error.mockReset();
  harness.saveFile.mockReset();
  harness.saveFile.mockImplementation(async (blob, fileName) => {
    exported.push({ fileName, text: await blobText(blob) });
    return { status: 'saved', fileName };
  });
  window.bexDesktop = {
    isDesktop: true,
    getLocalEntity: vi.fn(async () => stored ? { ok: true, record: { ...stored } } : { ok: false, error: 'This note was deleted.' }),
    updateLocalEntity: vi.fn(async (_type, _id, patch) => {
      stored = { ...stored, ...patch };
      return { ok: true, record: { ...stored } };
    }),
  };
});
afterEach(() => { delete window.bexDesktop; window.localStorage.clear(); });

describe('exporting the current note from the library', () => {
  it('exports saved edits again despite an unchanged library snapshot, including the exact restore payload', async () => {
    render(<LibraryHome />);
    await exportFromContextMenu();
    await waitFor(() => expect(exported).toHaveLength(1), { timeout: 2500 });
    expect(exported[0].text).toContain('First exported version.');

    const content = '<p>Second exported version with <strong>new evidence</strong>.</p>';
    await desktopClient.entities.MindNote.update(71, { title: 'Revised Research', content });
    await exportFromContextMenu();
    await waitFor(() => expect(exported).toHaveLength(2), { timeout: 2500 });
    expect(exported[1].fileName).toBe('revised-research.md');
    expect(exported[1].text).toContain('Second exported version');
    expect(exported[1].text).not.toContain('First exported version.');
    expect(extractNoteBackupPayload(exported[1].text)).toMatchObject({ title: 'Revised Research', html: content });
  });

  it('waits for the note debounce and its in-flight save before exporting', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    window.bexDesktop.updateLocalEntity.mockImplementation(async (_type, _id, patch) => {
      await gate;
      stored = { ...stored, ...patch };
      return { ok: true, record: { ...stored } };
    });
    render(<LibraryHome />);
    let save;
    const debounce = setTimeout(() => { save = desktopClient.entities.MindNote.update(71, { content: '<p>Just typed before export.</p>' }); }, 600);
    try {
      await exportFromContextMenu();
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 850)); });
      expect(harness.saveFile).not.toHaveBeenCalled();
      expect(window.bexDesktop.getLocalEntity).not.toHaveBeenCalled();
      await act(async () => { release(); await save; });
      await waitFor(() => expect(exported).toHaveLength(1), { timeout: 2500 });
      expect(exported[0].text).toContain('Just typed before export.');
    } finally { clearTimeout(debounce); release(); await save; }
  });

  it('does not fall back to cached content when the current note cannot be read', async () => {
    stored = null;
    render(<LibraryHome />);
    await exportFromContextMenu();
    await waitFor(() => expect(harness.error).toHaveBeenCalledWith('This note was deleted.'), { timeout: 2500 });
    expect(harness.saveFile).not.toHaveBeenCalled();
    expect(screen.queryByTestId('library-export-complete')).toBeNull();
  });

  it('also reads current note content for a selected-items ZIP', async () => {
    const secondNote = { id: 72, title: 'Other note', content: '<p>Other body.</p>' };
    harness.library.notes.push(secondNote);
    stored.content = '<p>Updated content inside the ZIP.</p>';
    window.bexDesktop.getLocalEntity.mockImplementation(async (_type, id) => ({ ok: true, record: id === 71 ? { ...stored } : secondNote }));
    let archive;
    harness.saveFile.mockImplementation(async (blob, fileName) => {
      archive = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(new Uint8Array(reader.result));
        reader.onerror = reject;
        reader.readAsArrayBuffer(blob);
      });
      return { status: 'saved', fileName };
    });
    render(<LibraryHome />);
    fireEvent.click(await screen.findByTestId('library-select-note-71'));
    fireEvent.click(screen.getByTestId('library-select-note-72'));
    fireEvent.click(within(screen.getByTestId('library-mass-actions')).getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(archive).toBeDefined(), { timeout: 3000 });
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(archive);
    const markdown = await zip.file('research.md').async('string');
    expect(markdown).toContain('Updated content inside the ZIP.');
    expect(markdown).not.toContain('First exported version.');
    expect(extractNoteBackupPayload(markdown).html).toBe(stored.content);
    expect(await zip.file('other-note.md').async('string')).toContain('Other body.');
  });

  it('blocks stale exports after a failed autosave and permits export after the same edit is saved', async () => {
    window.bexDesktop.updateLocalEntity.mockResolvedValueOnce({ ok: false, error: 'Disk full.' });
    await expect(desktopClient.entities.MindNote.update(71, { content: '<p>Must not be lost.</p>' })).rejects.toThrow('Disk full.');
    try {
      render(<LibraryHome />);
      await exportFromContextMenu();
      await waitFor(() => expect(harness.error).toHaveBeenCalled(), { timeout: 2500 });
      expect(harness.error.mock.calls[0][0]).toContain('try Export again');
      expect(harness.saveFile).not.toHaveBeenCalled();
      expect(screen.queryByTestId('library-export-complete')).toBeNull();
    } finally {
      await desktopClient.entities.MindNote.update(71, { content: '<p>Must not be lost.</p>' });
    }
    await exportFromContextMenu();
    await waitFor(() => expect(exported).toHaveLength(1), { timeout: 2500 });
    expect(exported[0].text).toContain('Must not be lost.');
  });
});
