import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Study from '@/pages/Study';
import { WorkspaceTabsProvider, ActiveTabProvider } from '@/lib/WorkspaceTabs';
import { platformEntities } from '@/lib/platform/entities';
import { writeClipboardText } from '@/lib/writeClipboardText';

vi.mock('@/api/desktopClient', () => ({ desktopClient: { entities: { Keyword: { list: async () => [] } } } }));

vi.mock('@/lib/writeClipboardText', () => ({ writeClipboardText: vi.fn(async () => {}) }));

vi.mock('@/components/shaders/Card3DTilt', () => ({ default: ({ children, 'data-testid': id }) => <div data-testid={id}>{children}</div> }));
vi.mock('@/lib/platform/entities', () => ({ platformEntities: {
  ChapterArtCatalog: { list: vi.fn(async () => []) }, Keyword: { list: vi.fn(async () => []) },
  StudyChapter: { list: vi.fn(), filter: vi.fn(), create: vi.fn(), update: vi.fn() },
  Annotation: { list: vi.fn(async () => []), filter: vi.fn(async () => []), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  Drawing: { filter: vi.fn(async () => []) }, TextHighlight: { filter: vi.fn(async () => []) },
} }));

const payload = text => ({ ok: true, result: { data: { content: [{ type: 'tag', name: 'para', attrs: { style: 'p' }, items: [
  { type: 'tag', name: 'verse', attrs: { number: '1' } }, { type: 'text', text },
] }] } } });
let calls, records;
beforeEach(() => {
  writeClipboardText.mockClear();
  calls = []; records = [];
  localStorage.clear();
  const chapters = platformEntities.StudyChapter;
  chapters.list.mockImplementation(async () => records);
  chapters.filter.mockImplementation(async query => records.filter(record => Object.entries(query).every(([key, value]) => key === 'id' ? String(record[key]) === String(value) : record[key] === value)));
  chapters.create.mockImplementation(async value => { const record = { id: records.length + 1, ...value }; records.push(record); return record; });
  chapters.update.mockImplementation(async (id, patch) => { const record = records.find(item => item.id === id); Object.assign(record, patch); return record; });
  window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.bexDesktop = {
    isDesktop: true,
    getLocalOwner: vi.fn(async () => ({ ok: true, owner: { is_local_owner: true } })),
    getScriptureStatus: vi.fn(async () => ({ ok: true, status: { configured: true } })),
    getScriptureCatalog: vi.fn(async () => ({ ok: true, result: { data: [{ id: '317e03834065a236-01', abbreviation: 'BSB' }, { id: 'de4e12af7f28f599-02', abbreviation: 'KJV' }] } })),
    fetchScriptureContent: vi.fn(options => new Promise(resolve => calls.push({ ...options, resolve }))),
    cancelScriptureRequest: vi.fn(async () => ({ ok: true })),
  };
});
afterEach(() => { delete window.bexDesktop; delete window.IntersectionObserver; });
function mount(query = 'Romans 1, John 1', path = `/Study?q=${encodeURIComponent(query)}`, options) {
  localStorage.setItem('bex_workspace_tabs_v1', JSON.stringify({ tabs: [{ id: 'proof', kind: 'study', path, title: 'Reader' }], activeId: 'proof' }));
  return render(<MemoryRouter initialEntries={[path]}><WorkspaceTabsProvider><ActiveTabProvider isActive tabId="proof"><Study /></ActiveTabProvider></WorkspaceTabsProvider></MemoryRouter>, options);
}
const settle = async (index, result) => { await act(async () => { calls[index].resolve(result); }); };
const submit = async query => {
  fireEvent.change(screen.getByLabelText('Search scripture'), { target: { value: query } });
  fireEvent.submit(screen.getByLabelText('Search scripture').closest('form'));
  await act(async () => {});
};

describe('progressive Scripture loading and recovery', () => {
  it('loads NBLA by the supplied ID with Spanish text, inline notes and publisher attribution', async () => {
    const id = 'ce11b813f9a27e20-01';
    window.bexDesktop.getScriptureCatalog.mockResolvedValue({ ok: true, result: { data: [
      { id: '317e03834065a236-01', abbreviation: 'BSB' },
      { id, abbreviation: 'NBLA', name: 'Nueva Biblia de las Américas', language: { name: 'Spanish' } },
    ] } });
    mount('Matthew 16:17');
    await waitFor(() => expect(calls).toHaveLength(1));
    fireEvent.click(await screen.findByRole('button', { name: 'Select Bible Version' }));
    fireEvent.click(await screen.findByRole('button', { name: /NBLA.*Nueva Biblia de las Américas/ }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toMatchObject({ bibleId: id, id: 'MAT.16.17' });
    const result = payload('Texto español de prueba.');
    result.result.data.content[0].items[0].attrs.number = '17';
    result.result.data.content[0].items.push({ name: 'note', type: 'tag', attrs: { style: 'f', caller: 'a' }, items: [{ type: 'text', text: 'Nota del editor.' }] });
    result.result.data.copyright = 'Aviso de derechos reservados — The Lockman Foundation';
    await settle(1, result);
    await screen.findByRole('button', { name: 'Footnote a for Matthew 16:17' });
    expect(screen.getByTestId('text-scripture-attribution').textContent).toContain(result.result.data.copyright);
    expect(records[0]).toMatchObject({ version: `API:${id}`, display_version: 'NBLA', raw_text: '' });
  });

  it('migrates a remembered retired NASB 2020 selection to the working API ID', async () => {
    localStorage.setItem('bex_scripture_selected_bible_id', 'nasb2020');
    mount('Romans 3');
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ bibleId: 'a761ca71e0b3ddcf-01', id: 'ROM.3' });
    expect(localStorage.getItem('bex_scripture_selected_bible_id')).toBe('a761ca71e0b3ddcf-01');
  });

  it('shows NLT plan removal for saved API studies without making unavailable API requests or changing personal writing', async () => {
    records.push({ id: 42, version: 'API:nlt-edition', display_version: 'NLT', api_bible_id: 'nlt-edition',
      book: 'Romans', chapter_number: 3, raw_text: '', notes: 'Permanent personal writing' });
    mount('', '/Study?chapter_id=42');
    await screen.findByText('Temporarily removed from plan.');
    expect(calls).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Copy scripture' })).toBeNull();
    expect(records[0].notes).toBe('Permanent personal writing');
    fireEvent.click(screen.getByRole('button', { name: 'Retry unfinished' }));
    await act(async () => {});
    expect(calls).toHaveLength(0);
  });

  it('renders NASB 1995 supplied notes at their publisher offsets without shifting annotations or copying notes', async () => {
    const id = 'b8ee27bcd1cae43a-01';
    window.bexDesktop.getScriptureCatalog.mockResolvedValue({ ok: true, result: { data: [
      { id: '317e03834065a236-01', abbreviation: 'BSB' },
      { id, abbreviation: 'NASB1995', name: 'New American Standard Bible 1995' },
    ] } });
    mount('Matthew 16:17');
    await waitFor(() => expect(calls).toHaveLength(1));
    fireEvent.click(await screen.findByRole('button', { name: 'Select Bible Version' }));
    fireEvent.click(await screen.findByRole('button', { name: /NASB1995.*New American Standard Bible 1995/ }));
    await waitFor(() => expect(calls).toHaveLength(2));
    const tag = (name, attrs, items) => ({ type: 'tag', name, attrs, items });
    const text = text => ({ type: 'text', text });
    const note = caller => tag('note', { style: 'f', caller }, [text(`Publisher note ${caller}.`)]);
    await settle(1, { ok: true, result: { data: { content: [tag('para', { style: 'p' }, [
      tag('verse', { number: '17' }), text('  Simon '), note('a'), text('Barjona, and '), note('b'), text('Peter'), note('c'), text('.  '),
    ])] } } });
    const marker = await screen.findByRole('button', { name: 'Footnote a for Matthew 16:17' });
    const verse = marker.closest('[data-verse-id]');
    expect(verse.textContent).toBe('Simon aBarjona, and bPeterc.');
    const identities = () => {
      const tokens = {};
      verse.querySelectorAll('[data-token-key]').forEach(token => {
        const key = token.getAttribute('data-token-key');
        tokens[key] = (tokens[key] || '') + token.textContent;
      });
      return tokens;
    };
    const before = identities();
    fireEvent.click(marker);
    expect(screen.getByRole('dialog', { name: 'Footnote a for Matthew 16:17' }).textContent).toContain('Publisher note a.');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Footnote a for Matthew 16:17' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Copy scripture' }));
    await waitFor(() => expect(writeClipboardText).toHaveBeenCalledWith('Matthew 16:17\nSimon Barjona, and Peter.'));
    fireEvent.click(screen.getByTestId('toggle-textual-notes'));
    expect(verse.querySelector('.bible-footnote-marker')).toBeNull();
    expect(identities()).toEqual(before);
    expect(verse.textContent).toBe('Simon Barjona, and Peter.');
  });

  it('copies a displayed verse range under one citation despite inline notes and section headings', async () => {
    mount('Matthew 16:16-21');
    await waitFor(() => expect(calls).toHaveLength(1));
    const tag = (name, attrs, items = []) => ({ type: 'tag', name, attrs, items });
    const text = text => ({ type: 'text', text });
    await settle(0, { ok: true, result: { data: { content: [
      tag('para', { style: 'p' }, [16, 17, 18, 19, 20].flatMap(number => [
        tag('verse', { number: String(number) }), text(`Verse ${number} `),
        tag('note', { style: 'f', caller: 'a' }, [text('Do not copy this publisher note.')]), text('reading text.'),
      ])),
      tag('para', { style: 's1' }, [text('Do not copy this subtitle.')]),
      tag('para', { style: 'p' }, [tag('verse', { number: '21' }), text('Verse 21 reading text.')]),
    ] } } });
    fireEvent.click(await screen.findByRole('button', { name: 'Copy scripture' }));
    await waitFor(() => expect(writeClipboardText).toHaveBeenCalledWith(
      'Matthew 16:16-21\n' + [16, 17, 18, 19, 20, 21].map(number => `Verse ${number} reading text.`).join('\n')
    ));
  });

  it('hides Copy when retired scripture exists in storage but is not displayed', async () => {
    records.push({ id: 42, version: 'NLT', book: 'Romans', chapter_number: 3,
      raw_text: '1 Stored scripture must stay hidden.',
      blocks: [{ type: 'verse', verseNumber: 1, text: 'Stored scripture must stay hidden.' }] });
    mount('', '/Study?chapter_id=42');
    await screen.findByTestId('banner-removed-translation');
    expect(document.querySelector('[data-scripture-root]').textContent).toBe('');
    expect(screen.queryByRole('button', { name: 'Copy scripture' })).toBeNull();
    expect(writeClipboardText).not.toHaveBeenCalled();
  });

  it('hides Copy during loading, after failure, and for an empty API response', async () => {
    mount('Romans 1');
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(screen.queryByRole('button', { name: 'Copy scripture' })).toBeNull();
    await settle(0, { ok: false, error: 'No passage available.' });
    const retry = await screen.findByRole('button', { name: 'Retry Romans 1' });
    expect(screen.queryByRole('button', { name: 'Copy scripture' })).toBeNull();
    fireEvent.click(retry);
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(screen.queryByRole('button', { name: 'Copy scripture' })).toBeNull();
    await settle(1, payload(''));
    await screen.findByRole('button', { name: 'Retry Romans 1' });
    expect(screen.queryByRole('button', { name: 'Copy scripture' })).toBeNull();
    expect(writeClipboardText).not.toHaveBeenCalled();
  });

  it('copies only loaded displayed verses and hides Copy immediately for a replacement search', async () => {
    mount();
    await waitFor(() => expect(calls).toHaveLength(2));
    await settle(1, payload('Only the displayed passage.'));
    fireEvent.click(await screen.findByRole('button', { name: 'Copy scripture' }));
    await waitFor(() => expect(writeClipboardText).toHaveBeenCalledWith('John 1:1\nOnly the displayed passage.'));
    await submit('Mark 1');
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(screen.queryByRole('button', { name: 'Copy scripture' })).toBeNull();
    expect(writeClipboardText).toHaveBeenCalledTimes(1);
  });

  it('reads the authorized NASB 1995 edition without the retired-local-source banner and keeps its copyright', async () => {
    const id = 'b8ee27bcd1cae43a-01';
    window.bexDesktop.getScriptureCatalog.mockResolvedValue({ ok: true, result: { data: [
      { id: '317e03834065a236-01', abbreviation: 'BSB', name: 'Berean Standard Bible' },
      { id, abbreviation: 'NASB1995', name: 'New American Standard Bible 1995' },
    ] } });
    mount('Romans 3');
    await waitFor(() => expect(calls).toHaveLength(1));
    fireEvent.click(await screen.findByRole('button', { name: 'Select Bible Version' }));
    fireEvent.click(await screen.findByRole('button', { name: /NASB1995.*New American Standard Bible 1995/ }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toMatchObject({ bibleId: id, id: 'ROM.3', type: 'chapter' });
    const result = payload('Invented NASB edition fixture text.');
    result.result.data.copyright = 'NASB 1995 © The Lockman Foundation. All rights reserved.';
    await settle(1, result);
    await waitFor(() => expect(document.querySelector('[data-scripture-root]')?.textContent).toContain('Invented NASB edition fixture text.'));
    expect(screen.queryByTestId('banner-removed-translation')).toBeNull();
    expect(screen.getByTestId('text-scripture-attribution').textContent).toContain(result.result.data.copyright);
    expect(screen.getByRole('link', { name: 'Additional license' }).getAttribute('href')).toBe('https://api.bible/');
    expect(records[0]).toMatchObject({ version: `API:${id}`, api_bible_id: id, raw_text: '' });
    expect(records[0].blocks).toBeUndefined();
  });

  it('reopens a retired NASB 1995 study through the API while preserving its personal fields and ID', async () => {
    records.push({ id: 42, version: 'NASB1995', book: 'Romans', chapter_number: 3, raw_text: '',
      notes: 'Permanent personal writing', context: 'Permanent context', application: 'Permanent application' });
    mount('', '/Study?chapter_id=42');
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ bibleId: 'b8ee27bcd1cae43a-01', id: 'ROM.3' });
    await settle(0, payload('Freshly fetched edition fixture.'));
    await waitFor(() => expect(document.querySelector('[data-scripture-root]')?.textContent).toContain('Freshly fetched edition fixture.'));
    expect(screen.queryByTestId('banner-removed-translation')).toBeNull();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ id: 42, notes: 'Permanent personal writing', context: 'Permanent context',
      application: 'Permanent application', raw_text: '', api_bible_id: 'b8ee27bcd1cae43a-01' });
  });

  it('keeps controls, renders out-of-order successes in query order, and retries only a failed unit', async () => {
    mount();
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(screen.getByTestId('reading-controls-panel')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    await settle(1, payload('Second passage stays visible.'));
    await waitFor(() => expect(document.body.textContent).toContain('Second passage stays visible.'));
    expect(screen.getByTestId('scripture-request-0').compareDocumentPosition(document.querySelector('[data-token-key]')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId('scripture-loading-status').textContent).toContain('1 of 2 requests finished');
    await settle(0, { ok: false, error: 'Offline for the first passage.' });
    fireEvent.click(await screen.findByRole('button', { name: 'Retry Romans 1' }));
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2].id).toBe('ROM.1');
    expect(calls.filter(call => call.id === 'JHN.1')).toHaveLength(1);
    expect(document.body.textContent).toContain('Second passage stays visible.');
    await settle(2, payload('First passage recovered.'));
    await waitFor(() => expect(document.body.textContent).toContain('First passage recovered.'));
    await waitFor(() => expect(screen.queryByTestId('scripture-loading-status')).toBeNull());
    expect(records).toHaveLength(2);
    for (const record of records) { expect(record.raw_text).toBe(''); expect(record.blocks).toBeUndefined(); }
  });

  it('cancels a replaced search and ignores a late response even when the bridge ignores cancellation', async () => {
    mount('Romans 1');
    await waitFor(() => expect(calls).toHaveLength(1));
    await submit('John 1');
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(window.bexDesktop.cancelScriptureRequest).toHaveBeenCalledWith(calls[0].requestId);
    await settle(1, payload('Newest search belongs here.'));
    await waitFor(() => expect(document.body.textContent).toContain('Newest search belongs here.'));
    await settle(0, payload('Outdated text must stay hidden.'));
    expect(document.body.textContent).not.toContain('Outdated text must stay hidden.');
    expect(screen.getByLabelText('Search scripture').value).toBe('John 1');
    expect(records.map(record => record.book)).toEqual(['John']);
  });

  it('keeps loaded verses on Cancel, stops queued units, and can resume unfinished requests', async () => {
    mount('Romans 1, John 1, Mark 1, Luke 1');
    await waitFor(() => expect(calls).toHaveLength(2));
    await settle(0, payload('Keep this loaded passage.'));
    await waitFor(() => expect(calls).toHaveLength(3));
    await waitFor(() => expect(document.body.textContent).toContain('Keep this loaded passage.'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByTestId('scripture-loading-status').textContent).toContain('Loading stopped'));
    expect(calls).toHaveLength(3);
    expect(document.body.textContent).toContain('Keep this loaded passage.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry unfinished' }));
    await waitFor(() => expect(calls).toHaveLength(5));
    expect(calls.filter(call => call.id === 'ROM.1')).toHaveLength(1);
  });

  it('reopens API history through retrieval and preserves the permanent parent and personal writing', async () => {
    records.push({ id: 7, book: 'Romans', chapter_number: 1, version: 'API:317e03834065a236-01', display_version: 'BSB',
      api_bible_id: '317e03834065a236-01', raw_text: 'Old cached body must not be used', blocks: [{ type: 'verse', verseNumber: 1, text: 'Old cached body' }], notes: 'Keep my writing', annotation_count: 4 });
    mount('', '/Study?chapter_id=7');
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(document.body.textContent).not.toContain('Old cached body');
    await settle(0, payload('Fresh retrieved scripture.'));
    await waitFor(() => expect(document.body.textContent).toContain('Fresh retrieved scripture.'));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ id: 7, raw_text: '', notes: 'Keep my writing', annotation_count: 4 });
    expect(records[0].blocks).toBeNull();
  });

  it('ignores a stale annotation read after a replacement search', async () => {
    let releaseOld;
    platformEntities.Annotation.filter.mockImplementationOnce(() => new Promise(resolve => { releaseOld = resolve; }));
    mount('Romans 1');
    await waitFor(() => expect(calls).toHaveLength(1));
    await settle(0, payload('Older scripture pending annotation read.'));
    await waitFor(() => expect(releaseOld).toBeTypeOf('function'));
    await submit('John 1');
    await waitFor(() => expect(calls).toHaveLength(2));
    await settle(1, payload('New scripture has no stale markers.'));
    await waitFor(() => expect(document.body.textContent).toContain('New scripture has no stale markers.'));
    await act(async () => releaseOld([{ id: 5, book: 'Romans', chapter_number: 1, version: 'API:317e03834065a236-01', start_verse: 1, end_verse: 1, start_token_index: 0, end_token_index: 0, content: 'stale' }]));
    expect(document.body.textContent).not.toContain('Older scripture pending annotation read.');
  });

  it('a version change cancels the previous edition and keeps its late text out of the new view', async () => {
    mount('Romans 1');
    await waitFor(() => expect(calls).toHaveLength(1));
    fireEvent.click(await screen.findByRole('button', { name: 'Select Bible Version' }));
    fireEvent.click(screen.getByText('KJV').closest('button'));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].bibleId).toBe('de4e12af7f28f599-02');
    await settle(1, payload('The chosen edition.'));
    await waitFor(() => expect(document.body.textContent).toContain('The chosen edition.'));
    await settle(0, payload('Previous edition must stay hidden.'));
    expect(document.body.textContent).not.toContain('Previous edition must stay hidden.');
    expect(screen.getByRole('button', { name: 'Select Bible Version' }).textContent).toBe('KJV');
  });

  it('retries a failed vault read using the completed response without spending another content request', async () => {
    platformEntities.StudyChapter.create.mockRejectedValueOnce(new Error('Vault temporarily unavailable'));
    mount('Romans 1');
    await waitFor(() => expect(calls).toHaveLength(1));
    await settle(0, payload('Recovered without another fetch.'));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry study data' }));
    await waitFor(() => expect(document.body.textContent).toContain('Recovered without another fetch.'));
    expect(calls).toHaveLength(1);
    expect(records).toHaveLength(1);
  });

  it('a delayed history deep-link read cannot replace a manually submitted search', async () => {
    let releaseHistory;
    platformEntities.StudyChapter.filter.mockImplementationOnce(() => new Promise(resolve => { releaseHistory = resolve; }));
    mount('', '/Study?chapter_id=7');
    await waitFor(() => expect(releaseHistory).toBeTypeOf('function'));
    await submit('John 1');
    await waitFor(() => expect(calls).toHaveLength(1));
    await settle(0, payload('Manual search takes priority.'));
    await waitFor(() => expect(document.body.textContent).toContain('Manual search takes priority.'));
    await act(async () => releaseHistory([{ id: 7, book: 'Romans', chapter_number: 1, version: 'BSB', raw_text: '~1 Old history text' }]));
    expect(document.body.textContent).not.toContain('Old history text');
    expect(document.body.textContent).toContain('Manual search takes priority.');
  });

  it('closing the reader cancels its current request without dispatching queued content', async () => {
    const view = mount('Romans 1, John 1, Mark 1');
    await waitFor(() => expect(calls).toHaveLength(2));
    view.unmount();
    expect(window.bexDesktop.cancelScriptureRequest).toHaveBeenCalledTimes(2);
    await settle(0, payload('Late response after closing.'));
    expect(calls).toHaveLength(2);
  });
});


describe('gutter editing with the shared text machinery', () => {
  async function openAnnotations() {
    const saved = [1, 2].map(id => ({ id, book: 'Romans', chapter_number: 1, version: 'API:317e03834065a236-01',
      start_verse: 1, end_verse: 1, start_token_index: 0, end_token_index: 0,
      selected_text: 'Passage', content: `<p>Commentary ${id}</p>` }));
    platformEntities.Annotation.filter.mockImplementation(async query => saved.filter(item => Object.entries(query).every(([key, value]) => item[key] === value)));
    platformEntities.Annotation.list.mockImplementation(async () => saved);
    platformEntities.Annotation.update.mockImplementation(async (id, patch) => { Object.assign(saved.find(item => item.id === id), patch); return { ...saved.find(item => item.id === id) }; });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(300, 100, 800, 100));
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function () { return this.dataset.annotationIds ? [new DOMRect(400, 100, 80, 20)] : []; });
    mount('Romans 1');
    await waitFor(() => expect(calls).toHaveLength(1));
    await settle(0, payload('Passage for annotation.'));
    await screen.findByTestId('gutter-annotation-1');
    return saved;
  }
  it('edits inside the original card, autosaves rich content, and flushes before switching cards', async () => {
    const saved = await openAnnotations();
    const card = screen.getByTestId('gutter-annotation-1');
    fireEvent.click(card.querySelector('button[title="Edit annotation"]'));
    const host = await screen.findByTestId('gutter-annotation-editor');
    expect(card.contains(host)).toBe(true);
    expect(screen.queryByTestId('window-annotation')).toBeNull();
    expect(host.querySelector('[role="status"]').textContent).toBe('');
    expect(host.querySelector('[data-saved-card-icon]')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete annotation' }).querySelector('svg')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Done editing annotation' }).textContent).toBe('');
    const surface = host.querySelector('.ProseMirror');
    await waitFor(() => expect(surface.editor).toBeTruthy());
    await act(async () => { surface.editor.commands.setContent('<p><strong>My edited argument</strong> <a href="https://example.com">source</a></p>', true); });
    expect(host.querySelector('[data-save-status="pending"] .lucide-loader-circle')).toBeTruthy();
    await waitFor(() => expect(saved[0].content).toContain('<strong>My edited argument</strong>'));
    await waitFor(() => expect(host.querySelector('[data-save-status="saved"] [data-saved-card-icon]')).toBeTruthy());
    expect(saved[0].content).toContain('href="https://example.com"');
    expect(host.querySelector('.ProseMirror')).toBe(surface); // Autosave must not remount the editor.
    await act(async () => { surface.editor.commands.insertContent(' latest change'); });
    fireEvent.click(screen.getByTestId('gutter-annotation-2').querySelector('button[title="Edit annotation"]'));
    await waitFor(() => expect(screen.getByTestId('gutter-annotation-2').querySelector('.ProseMirror')).toBeTruthy());
    expect(saved[0].content).toContain('latest change');
    fireEvent.click(screen.getByTestId('button-gutter-done'));
    await waitFor(() => expect(screen.queryByTestId('gutter-annotation-editor')).toBeNull());
    expect(screen.queryByTestId('window-annotation')).toBeNull();
  });
  it('keeps a failed draft in its card when Done or another Edit is clicked, and retries without duplicate records', async () => {
    const saved = await openAnnotations();
    fireEvent.click(screen.getByTestId('gutter-annotation-1').querySelector('button[title="Edit annotation"]'));
    const host = await screen.findByTestId('gutter-annotation-editor');
    const surface = host.querySelector('.ProseMirror');
    await waitFor(() => expect(surface.editor).toBeTruthy());
    const update = platformEntities.Annotation.update.getMockImplementation();
    platformEntities.Annotation.update.mockRejectedValue(new Error('Disk unavailable'));
    await act(async () => { surface.editor.commands.insertContent(' Keep my writing'); });
    fireEvent.click(screen.getByTestId('button-gutter-done'));
    await waitFor(() => expect(platformEntities.Annotation.update).toHaveBeenCalled());
    expect(host.querySelector('[data-save-status="error"]')).toBeTruthy();
    expect(host.querySelector('[role="status"]').getAttribute('aria-label')).toContain('Disk unavailable');
    fireEvent.click(screen.getByTestId('gutter-annotation-2').querySelector('button[title="Edit annotation"]'));
    await act(async () => {});
    expect(screen.getByTestId('gutter-annotation-1').contains(surface)).toBe(true);
    expect(surface.textContent).toContain('Keep my writing');
    expect(screen.getByTestId('gutter-annotation-2').querySelector('.ProseMirror')).toBeNull();
    expect(screen.queryByTestId('window-annotation')).toBeNull();
    platformEntities.Annotation.update.mockImplementation(update);
    fireEvent.click(screen.getByTestId('button-gutter-done'));
    await waitFor(() => expect(screen.queryByTestId('gutter-annotation-editor')).toBeNull());
    expect(saved[0].content).toContain('Keep my writing');
    expect(saved).toHaveLength(2);
  });
  it('adds a stable editable card without a popup and dismisses an empty new draft', async () => {
    const saved = await openAnnotations();
    platformEntities.Annotation.create.mockImplementation(async value => { const record = { id: 3, ...value }; saved.push(record); return record; });
    platformEntities.Annotation.delete.mockImplementation(async id => { saved.splice(saved.findIndex(item => item.id === id), 1); });
    const token = document.querySelector('[data-token-key]');
    const range = document.createRange(); range.selectNodeContents(token);
    range.getBoundingClientRect = () => new DOMRect(400, 100, 80, 20);
    range.getClientRects = () => [range.getBoundingClientRect()];
    window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
    fireEvent.mouseUp(window);
    fireEvent.click(await screen.findByTestId('button-popover-add-annotation'));
    const host = await screen.findByTestId('gutter-annotation-editor');
    expect(screen.getByTestId('gutter-annotation-3').contains(host)).toBe(true);
    expect(saved[2]).toMatchObject({ book: 'Romans', chapter_number: 1, version: 'API:317e03834065a236-01' });
    expect(screen.queryByTestId('window-annotation')).toBeNull();
    fireEvent.click(screen.getByTestId('button-gutter-done'));
    await waitFor(() => expect(screen.queryByTestId('gutter-annotation-3')).toBeNull());
    expect(saved).toHaveLength(2);
    expect(platformEntities.Annotation.delete).toHaveBeenCalledWith(3);
  });

  it('allows Scripture selection and highlighting while a gutter editor remains open', async () => {
    await openAnnotations();
    fireEvent.click(screen.getByTestId('gutter-annotation-1').querySelector('button[title="Edit annotation"]'));
    const host = await screen.findByTestId('gutter-annotation-editor');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 150)); });
    const token = document.querySelector('[data-token-key]');
    const range = document.createRange(); range.selectNodeContents(token);
    range.getBoundingClientRect = () => new DOMRect(400, 100, 80, 20);
    range.getClientRects = () => [range.getBoundingClientRect()];
    window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
    fireEvent.mouseUp(window);
    expect(await screen.findByTestId('button-popover-add-annotation')).toBeTruthy();
    expect(host.querySelector('.ProseMirror')).toBeTruthy();
    expect(window.getSelection().toString()).toBe(token.textContent);
    expect(screen.queryByTestId('window-annotation')).toBeNull();
  });

});


describe('Scripture scroll shortcuts', () => {
  it.each(['gutter', 'hover'])('ignores controls, footer and note height; navigates the %s reader only when the passage overflows', async style => {
    window.bexDesktop.getLocalOwner.mockResolvedValue({ ok: true, owner: { is_local_owner: true, scripture_annotation_display: style } });
    let passageHeight = 760;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this.hasAttribute('data-scripture-root')) return new DOMRect(300, -200, 800, passageHeight);
      return new DOMRect(300, 0, 800, 2200); // A tall card/workspace is not a long passage.
    });
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800);
    mount('Romans 1', undefined, { wrapper: ({ children }) => <div className="bex-tab-pane">{children}</div> });
    await waitFor(() => expect(calls).toHaveLength(1));
    await settle(0, payload('A passage that fits on screen.'));
    await screen.findByTestId('text-scripture-attribution');
    await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
    expect(screen.queryByRole('button', { name: 'Scroll to bottom' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Scroll to top' })).toBeNull();
    passageHeight = 801; // Fractional/one-pixel layout rounding should not add controls.
    fireEvent.resize(window);
    await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
    expect(screen.queryByRole('button', { name: 'Scroll to bottom' })).toBeNull();
    passageHeight = 1400;
    fireEvent.resize(window);
    await screen.findByRole('button', { name: 'Scroll to bottom' });
    expect(screen.getByRole('button', { name: 'Scroll to top' })).toBeTruthy();
    const pane = document.querySelector('.bex-tab-pane');
    pane.scrollTo = vi.fn();
    const reader = document.querySelector('.bex-study-page');
    const requests = vi.fn();
    reader.addEventListener('scripture-workspace-center', event => requests(event.detail));
    fireEvent.click(screen.getByRole('button', { name: 'Scroll to bottom' }));
    if (style === 'gutter') expect(requests).toHaveBeenLastCalledWith({ target: reader, align: 'bottom', axis: 'vertical' });
    else expect(pane.scrollTo).toHaveBeenCalledWith({ top: 1416, behavior: 'smooth' });
    fireEvent.click(screen.getByRole('button', { name: 'Scroll to top' }));
    if (style === 'gutter') {
      expect(requests).toHaveBeenLastCalledWith({ target: reader, align: 'top', axis: 'vertical' });
      expect(pane.scrollTo).not.toHaveBeenCalled();
    } else expect(pane.scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'smooth' });
    passageHeight = 800; // Shrinking text or enlarging the window hides both again.
    fireEvent.resize(window);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Scroll to bottom' })).toBeNull());
    expect(screen.queryByRole('button', { name: 'Scroll to top' })).toBeNull();
  });
});


describe('commentary links restore their Bible edition', () => {
  for (const [id, abbreviation, storedVersion] of [['a761ca71e0b3ddcf-01', 'NASB'], ['b8ee27bcd1cae43a-01', 'NASB1995'], ['a761ca71e0b3ddcf-01', 'NASB', 'NASB']]) {
    it(`opens existing ${abbreviation} ${storedVersion || 'API'} commentary from an older link instead of the remembered BSB`, async () => {
      const note = { id: 7, book: 'Matthew', chapter_number: 16, version: storedVersion || `API:${id}`,
        start_verse: 17, end_verse: 17, start_token_index: 0, end_token_index: 0,
        selected_text: 'Passage', content: '<p>My commentary in the correct edition.</p>' };
      if (storedVersion) records.push({ id: 55, book: note.book, chapter_number: 16, version: storedVersion, api_bible_id: id, display_version: abbreviation, scripture_source: 'api', raw_text: '', notes: 'Preserved chapter writing' });
      localStorage.setItem('bex_scripture_selected_bible_id', '317e03834065a236-01');
      window.bexDesktop.getScriptureCatalog.mockResolvedValue({ ok: true, result: { data: [
        { id: '317e03834065a236-01', abbreviation: 'BSB' }, { id, abbreviation },
      ] } });
      platformEntities.Annotation.filter.mockImplementation(async query => Object.entries(query).every(([key, value]) => key === 'id' ? String(note[key]) === String(value) : note[key] === value) ? [note] : []);
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(300, 100, 800, 100));
      vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function () { return this.dataset.annotationIds ? [new DOMRect(400, 100, 80, 20)] : []; });
      mount('', '/Study?q=Matthew%2016%3A17&annotation_id=7');
      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0]).toMatchObject({ bibleId: id, id: 'MAT.16.17' });
      const result = payload('Passage for commentary.');
      result.result.data.content[0].items[0].attrs.number = '17';
      await settle(0, result);
      await screen.findByTestId('gutter-annotation-7');
      expect(screen.getByText('My commentary in the correct edition.')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Select Bible Version' }).textContent).toContain(abbreviation);
      const link = screen.getByTestId('gutter-annotation-7').querySelector('button[title^="Copy link"]');
      expect(link.title).toContain(abbreviation === 'NASB' ? 'NASB 2020' : 'NASB 1995');
      expect(calls.every(call => call.bibleId === id)).toBe(true);
    });
  }
  it('keeps the explicitly linked API edition when the commentary no longer exists', async () => {
    platformEntities.Annotation.filter.mockResolvedValue([]);
    mount('', '/Study?q=John%2020%3A23&annotation_id=99&version=API%3Ab8ee27bcd1cae43a-01');
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ bibleId: 'b8ee27bcd1cae43a-01', id: 'JHN.20.23' });
  });
  it('does not let a delayed commentary lookup overwrite a newer search', async () => {
    let release;
    platformEntities.Annotation.filter.mockImplementation(query => query.id ? new Promise(resolve => { release = resolve; }) : Promise.resolve([]));
    mount('', '/Study?q=John%2020%3A23&annotation_id=7');
    await waitFor(() => expect(release).toBeTruthy());
    await submit('Romans 4');
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => release([{ id: 7, version: 'API:a761ca71e0b3ddcf-01' }]));
    expect(calls).toHaveLength(1);
    expect(calls[0].id).toBe('ROM.4');
  });
});

describe('Study highlighting selection boundaries and toolbar', () => {
  it.each(['preset', 'custom'])('saves a %s highlight from whole-verse selection in its own reader', async mode => {
    const highlights = [];
    platformEntities.TextHighlight.create = vi.fn(async data => { const record = { id: 'highlight-1', ...data }; highlights.push(record); return record; });
    platformEntities.TextHighlight.filter.mockImplementation(async () => highlights);
    mount('Romans 1');
    await waitFor(() => expect(calls).toHaveLength(1));
    await settle(0, payload('First word.'));
    await waitFor(() => expect(document.querySelector('[data-token-key]')).toBeTruthy());
    const verse = document.querySelector('[data-token-key]').closest('[data-study-chapter-id]');
    // A second mounted Study tab can precede this one in document order.
    const inactiveReader = document.createElement('div');
    inactiveReader.dataset.scriptureRoot = 'true'; document.body.prepend(inactiveReader);
    try {
      const range = document.createRange(); range.selectNodeContents(verse);
      range.getBoundingClientRect = () => new DOMRect(400, 100, 80, 20);
      range.getClientRects = () => [range.getBoundingClientRect()];
      window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
      fireEvent.keyUp(verse, { key: 'Shift' });
      const yellow = await screen.findByRole('button', { name: 'Highlight yellow' });
      if (mode === 'preset') {
        // Keyboard activation dispatches click, not mousedown.
        fireEvent.click(yellow);
      } else {
        fireEvent.click(screen.getByRole('button', { name: 'Custom highlight color' }));
        const input = document.querySelector('[data-selection-popover] input[type="color"]');
        // Native color pickers may clear the DOM selection. The captured words
        // must remain available until Apply is activated.
        window.getSelection().removeAllRanges();
        fireEvent.mouseUp(input);
        fireEvent.change(input, { target: { value: '#123456' } });
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 80)); });
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
      }
      await waitFor(() => expect(platformEntities.TextHighlight.create).toHaveBeenCalledTimes(1));
      expect(highlights[0]).toMatchObject({ book: 'Romans', chapter_number: 1, start_verse: 1, start_token_index: 0,
        end_verse: 1, end_token_index: 2, color: mode === 'preset' ? '#fde047' : '#123456' });
      await waitFor(() => expect(document.querySelector('[data-token-key]').style.backgroundColor).not.toBe(''));
    } finally { inactiveReader.remove(); }
  });
});
