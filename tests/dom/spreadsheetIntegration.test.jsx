import { describe, it, expect, vi, afterEach } from 'vitest';
import { spreadsheetDeepLink } from '@/utils';
import { libraryLinkPath, libraryLinkHref } from '@/lib/libraryLinks';
import { kindForPath, TAB_KINDS } from '@/lib/WorkspaceTabs';
import { searchLocalLibrary } from '@/lib/localGlobalSearch';
import { buildSpotlightPath, sameSpotlightWorkspace } from '@/lib/spotlightNavigation';
import { buildAiLibraryMarkdown, readAiLibrarySnapshot } from '@/lib/aiLibraryExport';
import { localLinkReference } from '@/lib/aiExportMarkdown';

const workbook = { version: 1, activeSheetId: 'sheet-a', sheets: [{ id: 'sheet-a', name: 'Evidence', rowCount: 1200, columnCount: 26, cells: {
  A1024: { v: 'SYNTHETIC_SOURCE_1024', link: '/notes/3', note: 'Independent source' },
  B1024: { v: 4 }, C1024: { v: '', f: 'B1024*2' },
} }] };
const record = { id: 7, title: 'Evidence matrix', workbook };
afterEach(() => { delete window.bexDesktop; });

describe('spreadsheet integration with the BEX library', () => {
  it('recognizes durable workbook and cell links and reuses the same tab across cells', () => {
    const link = spreadsheetDeepLink(7, 'Evidence matrix', { sheet: 'sheet-a', cell: 'A1024' });
    expect(link).toBe('/spreadsheets/evidence-matrix-7?sheet=sheet-a&cell=A1024');
    expect(libraryLinkPath(link)).toBe(link);
    expect(libraryLinkHref({ kind: 'spreadsheet', id: 7 })).toBe('/spreadsheets/7');
    expect(kindForPath(link)).toBe(TAB_KINDS.SPREADSHEET);
    expect(sameSpotlightWorkspace(link, '/spreadsheets/7?sheet=sheet-b&cell=B3')).toBe(true);
    expect(localLinkReference(link)).toBe('spreadsheet:7/sheet:sheet-a/cell:A1024');
    expect(libraryLinkPath('https://remote.invalid/spreadsheets/7', 'https://bex.local/')).toBeNull();
  });

  it('finds a source at row 1024 and lands on the exact cell', () => {
    const hits = searchLocalLibrary({ spreadsheets: [record] }, 'SYNTHETIC_SOURCE_1024');
    expect(hits).toHaveLength(1);
    expect(hits[0].type).toBe('Spreadsheet Cell');
    expect(buildSpotlightPath(hits[0], 'SYNTHETIC_SOURCE_1024', 1)).toContain('sheet=sheet-a&cell=A1024');
    expect(searchLocalLibrary({ spreadsheets: [record] }, 'Independent source')[0].targetId).toBe('A1024');
  });

  it('exports sparse cells with source IDs and formulas without binary source workbooks', () => {
    const snapshot = { notes: [{ id: 3, title: 'Source', content: '<p>Original writing.</p>' }], spreadsheets: [{ ...record, workbook: { ...workbook, sourceXlsx: 'DO_NOT_EMBED_BINARY' } }] };
    const result = buildAiLibraryMarkdown(snapshot, { exportedAt: '2026-11-05T00:00:00Z' });
    expect(result.counts.spreadsheets).toBe(1);
    for (const value of ['spreadsheet:7/sheet:sheet-a/cell:A1024', 'SYNTHETIC_SOURCE_1024', '=B1024*2', 'Independent source', 'note:3']) expect(result.text).toContain(value);
    expect(result.text).not.toContain('DO_NOT_EMBED_BINARY');
    expect(result.text).not.toContain('cell:A1023');
  });

  it('hydrates metadata-only spreadsheet lists before a fallback AI snapshot', async () => {
    const get = vi.fn(async () => record);
    const types = ['MindNote', 'KnowledgeWeb', 'Timegraph', 'Keyword', 'Annotation', 'StudyChapter', 'WebCard', 'WebConnection', 'CanvasObject', 'Drawing', 'MindLink', 'WebFolder', 'StudyCanvasObject', 'StudyConnection'];
    const entities = Object.fromEntries(types.map(type => [type, { listPage: async () => ({ records: [], nextCursor: null }) }]));
    entities.Spreadsheet = { listPage: async () => ({ records: [{ id: 7, title: record.title }], nextCursor: null }), get };
    const snapshot = await readAiLibrarySnapshot({ entities });
    expect(get).toHaveBeenCalledWith(7);
    expect(snapshot.spreadsheets[0].workbook.sheets[0].cells.A1024.v).toBe('SYNTHETIC_SOURCE_1024');
  });
});
