import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({ choose: vi.fn(), cancel: vi.fn(), save: vi.fn(), error: vi.fn(), success: vi.fn(), pdf: vi.fn() }));
vi.mock('@/lib/saveExportFile', () => ({ saveExportFile: (...args) => harness.save(...args), chooseExportFile: (...args) => harness.choose(...args), cancelExportFile: (...args) => harness.cancel(...args) }));
vi.mock('@/lib/notePdf',()=>({exportNotePdf:(...args)=>harness.pdf(...args)}));
vi.mock('sonner', () => ({ toast: { error: (...args) => harness.error(...args), success: (...args) => harness.success(...args) } }));
vi.mock('@/lib/PrivateWebContext', () => ({ usePrivateWeb: () => ({ getKey: () => null }) }));
// Exercise real note/book state and persistence; replace only the text widget.
vi.mock('@/components/editor/TEXT_EDITOR_MACHINERY', () => ({ default: ({ content, onChange }) =>
  <textarea aria-label="Note body" value={content} onChange={event => onChange(event.target.value)} />,
}));

import NoteEditorPanel from '@/components/knowledgeweb/NoteEditorPanel';
import useWebLibrary from '@/components/knowledgeweb/useWebLibrary';
import { desktopClient } from '@/api/desktopClient';
import { extractNoteBackupPayload } from '@/lib/noteBackupMarkdown';
import { flushPendingEditorSaves } from '@/lib/pendingEditorSaves';
import { PAGE_BREAK } from '@/components/notes/bookModel';
import { COPY_FEEDBACK_EVENT } from '@/lib/copyFeedback';

const original = { id: 71, title: 'Research', content: '<p>Old first page.</p>' + PAGE_BREAK + '<p>Keep the second page.</p>' };
let stored;
let artifacts;
let status;
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function readBlob(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsText(blob);
  });
}
function LibraryMirror() {
  const library = useWebLibrary();
  return <output data-testid="live-library">{JSON.stringify(library.notes)}</output>;
}
function mount({ duplicate = false, onNoteSaved = null, requestedPage = null } = {}) {
  return render(<MemoryRouter>
    <div data-testid="first-editor"><NoteEditorPanel noteId={71} notes={[{ ...original }]} onNoteSaved={onNoteSaved} requestedPage={requestedPage} /></div>
    {duplicate && <div data-testid="second-editor"><NoteEditorPanel noteId={71} notes={[{ ...original }]} onNoteSaved={onNoteSaved} /></div>}
    <LibraryMirror />
  </MemoryRouter>);
}
function changeBody(html, editor = 'first-editor') {
  fireEvent.change(within(screen.getByTestId(editor)).getByRole('textbox', { name: 'Note body' }), { target: { value: html } });
}
function exportNote(format = 'md') {
  const button = within(screen.getByTestId('first-editor')).getByRole('button', { name: 'Export note' });
  if (button.disabled) return;
  fireEvent.keyDown(button, { key: 'Enter' });
  fireEvent.click(screen.getByRole('menuitem', { name: format === 'pdf' ? 'PDF (.pdf)' : 'Markdown (.md)' }));
}

beforeEach(() => {
  harness.choose.mockReset(); harness.choose.mockResolvedValue({ status: 'ready', selectionId: 'chosen-location' });
  harness.cancel.mockReset(); harness.cancel.mockResolvedValue(undefined);
  stored = { ...original };
  artifacts = [];
  status = 'saved';
  harness.pdf.mockReset();harness.pdf.mockResolvedValue({status:'saved'});
  harness.error.mockReset(); harness.success.mockReset(); harness.save.mockReset();
  harness.save.mockImplementation(async (blob, fileName) => {
    artifacts.push({ fileName, text: await readBlob(blob) });
    return { status };
  });
  window.bexDesktop = {
    isDesktop: true,
    listLocalEntities: vi.fn(async type => ({ ok: true, records: type === 'MindNote' && stored ? [{ ...stored }] : [] })),
    getLocalEntity: vi.fn(async () => stored ? { ok: true, record: { ...stored } } : { ok: false, error: 'This note was deleted.' }),
    updateLocalEntity: vi.fn(async (_type, _id, patch) => {
      stored = { ...stored, ...patch };
      return { ok: true, record: { ...stored } };
    }),
  };
});
afterEach(() => { cleanup(); vi.useRealTimers(); delete window.bexDesktop; delete document.execCommand; window.localStorage.clear(); });

describe('top-of-note Export and current note views', () => {
  it('copies a rich reference to the current notebook page beside Export without copying or exporting its contents', async () => {
    const payload = {}, feedback = vi.fn();
    document.execCommand = vi.fn(() => {
      const event = new Event('copy', { cancelable: true });
      event.clipboardData = { setData: (type, text) => { payload[type] = text; } };
      window.dispatchEvent(event); return true;
    });
    window.addEventListener(COPY_FEEDBACK_EVENT, feedback);
    try {
      mount({ requestedPage: 1 });
      const button = await screen.findByRole('button', { name: 'Copy link to note' });
      await waitFor(() => expect(button.disabled).toBe(false));
      expect(button.previousElementSibling).toBe(screen.getByRole('button', { name: 'Export note' }));
      const body = screen.getByRole('textbox', { name: 'Note body' });
      body.focus();
      fireEvent.click(button);
      const anchor = new DOMParser().parseFromString(payload['text/html'], 'text/html').querySelector('a');
      expect(anchor.getAttribute('href')).toBe('/notes/research-71?page=2');
      expect(anchor.textContent).toBe('Research — Page 2');
      expect(payload['text/plain']).toBe('[Research — Page 2](/notes/research-71?page=2)');
      expect(document.activeElement).toBe(body);
      expect(payload['text/html']).not.toContain('Keep the second page.');
      expect(harness.save).not.toHaveBeenCalled();
      expect(feedback.mock.calls.at(-1)[0].detail).toEqual({ ok: true, message: 'Note link copied' });
    } finally { window.removeEventListener(COPY_FEEDBACK_EVENT, feedback); }
  });

  it('reports a blocked link copy without claiming success', async () => {
    document.execCommand = vi.fn(() => false);
    const feedback = vi.fn(); window.addEventListener(COPY_FEEDBACK_EVENT, feedback);
    try {
      mount();
      const button = await screen.findByRole('button', { name: 'Copy link to note' });
      await waitFor(() => expect(button.disabled).toBe(false));
      fireEvent.click(button);
      expect(feedback.mock.calls.at(-1)[0].detail).toEqual({ ok: false, message: 'Could not copy note link' });
      expect(document.querySelector('textarea[readonly]')).toBeNull();
    } finally { window.removeEventListener(COPY_FEEDBACK_EVENT, feedback); }
  });

  it('immediately saves current title/body and exports the whole book; repeat export contains only the new version', async () => {
    mount();
    await screen.findByRole('button', { name: 'Export note' });
    fireEvent.change(screen.getByTestId('input-note-title'), { target: { value: 'Revised Research' } });
    changeBody('<p>New first export.</p>');
    exportNote();
    await waitFor(() => expect(artifacts).toHaveLength(1), { timeout: 2500 });
    expect(artifacts[0].fileName).toBe('revised-research.md');
    expect(artifacts[0].text).toContain('New first export.');
    expect(artifacts[0].text).toContain('Keep the second page.');
    expect(extractNoteBackupPayload(artifacts[0].text)).toMatchObject({ title: stored.title, html: stored.content });
    changeBody('<p>Newest second export.</p>');
    exportNote();
    await waitFor(() => expect(artifacts).toHaveLength(2), { timeout: 2500 });
    expect(artifacts[1].text).toContain('Newest second export.');
    expect(artifacts[1].text).not.toContain('New first export.');
    expect(artifacts[1].text).not.toContain('Old first page.');
    expect(extractNoteBackupPayload(artifacts[1].text).html).toBe(stored.content);
  });

  it('waits for an in-flight autosave, serializes later edits, and ignores duplicate export clicks', async () => {
    const gate = deferred();
    window.bexDesktop.updateLocalEntity.mockImplementationOnce(async (_type, _id, patch) => {
      await gate.promise;
      stored = { ...stored, ...patch };
      return { ok: true, record: { ...stored } };
    });
    mount();
    changeBody('<p>First pending edit.</p>');
    await waitFor(() => expect(window.bexDesktop.updateLocalEntity).toHaveBeenCalledOnce(), { timeout: 1500 });
    changeBody('<p>Latest edit during save.</p>');
    exportNote(); exportNote();
    expect(window.bexDesktop.getLocalEntity).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Export note' }).disabled).toBe(true);
    await act(async () => { gate.resolve(); });
    await waitFor(() => expect(artifacts).toHaveLength(1), { timeout: 2500 });
    expect(window.bexDesktop.updateLocalEntity).toHaveBeenCalledTimes(2);
    expect(artifacts[0].text).toContain('Latest edit during save.');
    expect(artifacts[0].text).not.toContain('First pending edit.');
  });

  it('retains a failed edit and blocks exporting stale vault content until that edit saves on retry', async () => {
    window.bexDesktop.updateLocalEntity.mockResolvedValueOnce({ ok: false, error: 'Disk full.' });
    mount();
    changeBody('<p>Must survive the failed save.</p>');
    exportNote();
    await waitFor(() => expect(harness.error).toHaveBeenCalled());
    expect(harness.save).not.toHaveBeenCalled();
    expect(window.bexDesktop.getLocalEntity).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Note body' }).value).toContain('Must survive');
    expect(screen.getByRole('button', { name: 'Export note' }).disabled).toBe(false);
    exportNote();
    await waitFor(() => expect(artifacts).toHaveLength(1), { timeout: 2500 });
    expect(artifacts[0].text).toContain('Must survive the failed save.');
    expect(artifacts[0].text).not.toContain('Old first page.');
  });

  it('uses the latest vault record and never falls back to the panel snapshot on a read failure', async () => {
    mount();
    stored = { ...stored, title: 'Changed in vault', content: '<p>Current vault content.</p>' };
    exportNote();
    await waitFor(() => expect(artifacts).toHaveLength(1), { timeout: 2500 });
    expect(artifacts[0]).toMatchObject({ fileName: 'changed-in-vault.md' });
    expect(artifacts[0].text).toContain('Current vault content.');
    stored = null;
    exportNote();
    await waitFor(() => expect(harness.error).toHaveBeenCalledWith('This note was deleted.'), { timeout: 2500 });
    expect(artifacts).toHaveLength(1);
  });

  it('keeps clean duplicate editors and the background library current without overwriting a dirty duplicate', async () => {
    mount({ duplicate: true });
    await waitFor(() => expect(JSON.parse(screen.getByTestId('live-library').textContent)).toHaveLength(1));
    await act(async () => { await desktopClient.entities.MindNote.update(71, { title: 'Current title', content: '<p>Shared committed edit.</p>' }); });
    expect(JSON.parse(screen.getByTestId('live-library').textContent)[0]).toMatchObject({ title: 'Current title', content: '<p>Shared committed edit.</p>' });
    expect(within(screen.getByTestId('second-editor')).getByRole('textbox', { name: 'Note body' }).value).toContain('Shared committed edit.');
    changeBody('<p>Local duplicate draft.</p>', 'second-editor');
    await act(async () => { await desktopClient.entities.MindNote.update(71, { content: '<p>Another committed edit.</p>' }); });
    expect(within(screen.getByTestId('first-editor')).getByRole('textbox', { name: 'Note body' }).value).toContain('Another committed edit.');
    expect(within(screen.getByTestId('second-editor')).getByRole('textbox', { name: 'Note body' }).value).toContain('Local duplicate draft.');
    await act(async () => { await flushPendingEditorSaves(); });
    expect(within(screen.getByTestId('first-editor')).getByRole('textbox', { name: 'Note body' }).value).toContain('Local duplicate draft.');
    expect(JSON.parse(screen.getByTestId('live-library').textContent)[0].content).toContain('Local duplicate draft.');
  });

  it('does not let an older slow list response restore a stale library version after a save', async () => {
    const read = deferred();
    let firstNoteRead = true;
    window.bexDesktop.listLocalEntities.mockImplementation(async type => {
      if (type !== 'MindNote') return { ok: true, records: [] };
      if (firstNoteRead) { firstNoteRead = false; await read.promise; return { ok: true, records: [{ ...original }] }; }
      return { ok: true, records: [{ ...stored }] };
    });
    render(<LibraryMirror />);
    await act(async () => { await desktopClient.entities.MindNote.update(71, { title: 'Latest title', content: '<p>Latest content.</p>' }); read.resolve(); });
    await waitFor(() => expect(JSON.parse(screen.getByTestId('live-library').textContent)[0]?.title).toBe('Latest title'));
    expect(JSON.parse(screen.getByTestId('live-library').textContent)[0].content).toBe('<p>Latest content.</p>');
    expect(window.bexDesktop.listLocalEntities.mock.calls.filter(([type]) => type === 'MindNote')).toHaveLength(2);
  });

  it('converges both dirty duplicate editors on the final committed note after concurrent saves', async () => {
    const onNoteSaved = vi.fn();
    mount({ duplicate: true, onNoteSaved });
    changeBody('<p>First duplicate draft.</p>');
    changeBody('<p>Second duplicate draft.</p>', 'second-editor');
    await act(async () => { await flushPendingEditorSaves(); });
    const committedBody = stored.content.includes('Second duplicate draft.') ? 'Second duplicate draft.' : 'First duplicate draft.';
    for (const editor of ['first-editor', 'second-editor']) {
      expect(within(screen.getByTestId(editor)).getByRole('textbox', { name: 'Note body' }).value).toContain(committedBody);
    }
    expect(JSON.parse(screen.getByTestId('live-library').textContent)[0].content).toBe(stored.content);
    expect(onNoteSaved).toHaveBeenCalledTimes(2);
    for (const [note] of onNoteSaved.mock.calls) expect(note.content).toBe(stored.content);
  });

  it('reports success only for a confirmed saved export, and removes deleted notes from mounted lists', async () => {
    status = 'canceled';
    window.bexDesktop.deleteLocalEntity = vi.fn(async () => ({ ok: true, result: { deleted: true } }));
    mount();
    exportNote();
    await waitFor(() => expect(artifacts).toHaveLength(1), { timeout: 2500 });
    expect(harness.success).not.toHaveBeenCalled();
    await act(async () => { await desktopClient.entities.MindNote.delete(71); });
    expect(JSON.parse(screen.getByTestId('live-library').textContent)).toEqual([]);
  });

  it('keeps a stalled save open and never exports later after the timeout', async () => {
    vi.useFakeTimers();
    const gate = deferred();
    window.bexDesktop.updateLocalEntity.mockImplementationOnce(async (_type, _id, patch) => {
      await gate.promise;
      stored = { ...stored, ...patch };
      return { ok: true, record: { ...stored } };
    });
    mount();
    changeBody('<p>Slow pending save.</p>');
    exportNote();
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(harness.error.mock.calls.at(-1)[0]).toContain('BEX is still saving');
    expect(harness.save).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Export note' }).disabled).toBe(false);
    await act(async () => { gate.resolve(); await flushPendingEditorSaves(); });
    expect(harness.save).not.toHaveBeenCalled();
  });
});

it('shows formats only after Export opens and exports the whole current note as PDF',async()=>{mount();await waitFor(()=>expect(screen.getByRole('button',{name:'Export note'}).disabled).toBe(false));expect(screen.queryByText('PDF (.pdf)')).toBeNull();expect(screen.queryByRole('combobox',{name:'Note export format'})).toBeNull();exportNote('pdf');await waitFor(()=>expect(harness.pdf).toHaveBeenCalled());expect(harness.pdf.mock.calls[0][0]).toMatchObject({title:'Research',pages:expect.arrayContaining([expect.stringContaining('Keep the second page.')])});expect(harness.save).not.toHaveBeenCalled();});
it('exports selected pages as PDF using the freshly saved book',async()=>{mount();fireEvent.click(await screen.findByTestId('button-page-overview'));fireEvent.click(await screen.findByTestId('checkbox-page-2'));fireEvent.keyDown(screen.getByTestId('button-pages-export'),{key:'Enter'});fireEvent.click(screen.getByRole('menuitem',{name:'PDF (.pdf)'}));await waitFor(()=>expect(harness.pdf).toHaveBeenCalled());expect(harness.pdf.mock.calls[0][0]).toMatchObject({title:'Research',indices:[1],pages:expect.arrayContaining([expect.stringContaining('Keep the second page.')])});});

it('opens the save chooser before preparing a PDF and stops completely on cancel', async () => { harness.choose.mockResolvedValue({status:'canceled'}); mount(); exportNote('pdf'); await waitFor(()=>expect(harness.choose).toHaveBeenCalledWith('research.pdf')); expect(harness.pdf).not.toHaveBeenCalled(); expect(harness.save).not.toHaveBeenCalled(); expect(await screen.findByText('Export canceled.')).toBeTruthy(); });
it('routes selected Markdown pages through the native save flow with confirmation',async()=>{mount();fireEvent.click(await screen.findByTestId('button-page-overview'));fireEvent.click(await screen.findByTestId('checkbox-page-2'));fireEvent.keyDown(screen.getByTestId('button-pages-export'),{key:'Enter'});fireEvent.click(screen.getByRole('menuitem',{name:'Markdown (.md)'}));await waitFor(()=>expect(artifacts).toHaveLength(1));expect(artifacts[0].fileName).toBe('research-page-2.md');expect(artifacts[0].text).toContain('Keep the second page.');expect(artifacts[0].text).not.toContain('Old first page.');expect(harness.save.mock.calls[0][2]).toEqual({status:'ready',selectionId:'chosen-location'});expect(await screen.findByText('Saved research-page-2.md')).toBeTruthy();});

it('holds an incoming sync refresh until the export destination and write finish', async () => {
  const chooser = deferred(); harness.choose.mockReturnValue(chooser.promise);
  mount(); exportNote('pdf');
  await waitFor(()=>expect(harness.choose).toHaveBeenCalled());
  let prepared=false;
  const apply=window.__bexBeginRemoteApply().then(()=>{prepared=true;});
  await act(async()=>{await Promise.resolve();});
  expect(prepared).toBe(false);
  expect(document.body.textContent).not.toContain('Receiving your synchronized changes');
  await act(async()=>{chooser.resolve({status:'ready',selectionId:'chosen-location'});});
  await waitFor(()=>expect(harness.pdf).toHaveBeenCalled());
  await act(async()=>{await apply;});
  expect(prepared).toBe(true);
  window.__bexEndRemoteApply(false);
});
