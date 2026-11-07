import React from 'react';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const harness = vi.hoisted(() => ({ updateTab: vi.fn(), library: null, confirm: vi.fn(), saveFile: vi.fn() }));
vi.mock('@/components/knowledgeweb/useWebLibrary', () => ({ default: () => harness.library }));
vi.mock('@/lib/WorkspaceTabs', async original => ({ ...await original(),
  useCurrentWorkspaceTab: () => ({ id: 'home', kind: 'home', path: '/LibraryHome' }), useIsActiveTab: () => true, useTabTitle: () => {},
  useWorkspaceTabs: () => ({ tabs: [{ id: 'home', kind: 'home', path: '/LibraryHome' }], updateTab: harness.updateTab, selectTab: vi.fn(), closeTab: vi.fn() }),
}));
vi.mock('@/lib/PrivateWebContext', () => ({ usePrivateWeb: () => ({ getKey: () => null }) }));
vi.mock('@/lib/timegraph/timegraphStore', () => ({ listTimegraphs: async () => [] }));
vi.mock('@/components/scripture/ScriptureSearch', () => ({ default: () => null }));
vi.mock('@/components/search/GlobalSearch', () => ({ LibrarySpotlightSearch: () => null }));
vi.mock('@/components/shaders/Card3DTilt', () => ({ default: ({ children }) => <>{children}</> }));
vi.mock('@/components/ui/confirm-dialog', () => ({ confirmDialog: (...args) => harness.confirm(...args) }));
vi.mock('@/lib/saveExportFile', () => ({ saveExportFile: (...args) => harness.saveFile(...args) }));
import LibraryHome from '@/pages/LibraryHome';

beforeEach(() => {
  harness.updateTab.mockReset(); harness.confirm.mockResolvedValue(true);
  harness.library = { loaded: true, webs: [], notes: [], folders: [], refresh: vi.fn(), showCreatePrivateModal: false };
  window.bexDesktop = { isDesktop: true,
    listLocalEntities: vi.fn(async () => ({ ok: true, records: [{ id: 7, title: 'Evidence matrix' }] })),
    createLocalEntity: vi.fn(async (_type, payload) => ({ ok: true, record: { ...payload, id: 8 } })),
    deleteLocalEntity: vi.fn(async () => ({ ok: true, result: { deleted: true } })),
  };
});
afterEach(() => { delete window.bexDesktop; localStorage.clear(); });

describe('spreadsheet home modality', () => {
  it('shows the fourth library category and creates a sparse workbook in a spreadsheet workspace', async () => {
    render(<LibraryHome />);
    await screen.findByTestId('library-item-spreadsheet-7');
    expect(screen.getByTestId('library-column-spreadsheet')).toBeTruthy();
    fireEvent.click(screen.getByTestId('library-create-spreadsheet'));
    await waitFor(() => expect(window.bexDesktop.createLocalEntity).toHaveBeenCalled());
    const [type, payload] = window.bexDesktop.createLocalEntity.mock.calls[0];
    expect(type).toBe('Spreadsheet'); expect(payload.workbook.sheets[0].cells).toEqual({});
    await waitFor(() => expect(harness.updateTab).toHaveBeenCalledWith('home', expect.objectContaining({ kind: 'spreadsheet', path: '/spreadsheets/untitled-spreadsheet-8' })));
  });
  it('opens an existing workbook and deletes it through the same library controls', async () => {
    render(<LibraryHome />);
    const row = await screen.findByTestId('library-item-spreadsheet-7');
    fireEvent.click(within(row).getByRole('button', { name: 'Evidence matrix' }));
    expect(harness.updateTab).toHaveBeenCalledWith('home', expect.objectContaining({ path: '/spreadsheets/evidence-matrix-7' }));
    fireEvent.contextMenu(row);
    fireEvent.click(within(screen.getByTestId('library-item-context-menu')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(window.bexDesktop.deleteLocalEntity).toHaveBeenCalledWith('Spreadsheet', 7));
    await waitFor(() => expect(screen.queryByTestId('library-item-spreadsheet-7')).toBeNull());
  });
});
