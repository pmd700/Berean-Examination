import React from 'react';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
const captured = vi.hoisted(() => ({ editor: null }));
vi.mock('@/api/desktopClient', () => ({ desktopClient: { entities: { Keyword: { list: async () => [] } } } }));
vi.mock('@/components/editor/RichTextEditor', async importOriginal => {
  const original = await importOriginal();
  return { default: props => <original.default {...props} onEditorReady={editor => { captured.editor = editor; }} /> };
});
import TimegraphDescriptionEditor from '@/components/timegraph/TimegraphDescriptionEditor';
import { requestLocalFindShortcut } from '@/lib/localFindShortcut';
import { normalizeEvent, filterEvents } from '@/lib/timegraph/timegraphModel';
function Harness({ initial, onChange }) {
  const [content, setContent] = React.useState(initial);
  return <TimegraphDescriptionEditor content={content} onChange={html => { setContent(html); onChange(html); }} />;
}
const mount = (content, onChange = vi.fn()) => render(<MemoryRouter><Harness initial={content} onChange={onChange} /></MemoryRouter>);

describe('timeline rich descriptions', () => {
  it('renders existing Markdown with the shared editor without saving on open', async () => {
    const save = vi.fn();
    mount('On **9 March 1522**, during **Lent**.\n\n## Background\n\n- First\n- Second', save);
    await waitFor(() => expect(document.querySelector('.ProseMirror strong')?.textContent).toBe('9 March 1522'));
    expect(document.querySelector('.ProseMirror h2').textContent).toBe('Background');
    expect(document.querySelectorAll('.ProseMirror li')).toHaveLength(2);
    expect(save).not.toHaveBeenCalled();
    expect(captured.editor.commands.insertTable).toBeTypeOf('function');
    expect(captured.editor.commands.setDetails).toBeTypeOf('function');
    expect(captured.editor.commands.setFindTerm).toBeTypeOf('function');
  });
  it('saves formatting and retains tables and dropdowns on reopening', async () => {
    let saved;
    const view = mount('<p>Original</p><details><summary>More</summary><div data-type="detailsContent"><p>Hidden</p></div></details><table><tr><td><p>Cell</p></td></tr></table>', html => { saved = html; });
    await waitFor(() => expect(captured.editor).toBeTruthy());
    act(() => captured.editor.chain().setTextSelection({ from: 1, to: 9 }).toggleBold().run());
    expect(saved).toContain('<strong>Original</strong>');
    expect(saved).toContain('<table');
    view.unmount();
    mount(saved);
    await waitFor(() => expect(document.querySelector('.ProseMirror strong')?.textContent).toBe('Original'));
    expect(document.querySelector('.toggle-block')).toBeTruthy();
    expect(document.querySelector('.ProseMirror table')).toBeTruthy();
  });
  it('converts pasted Markdown and opens local Cmd+F', async () => {
    mount('<p>Text</p>');
    await act(async () => { captured.editor.commands.focus('end'); await new Promise(resolve => setTimeout(resolve, 30)); });
    fireEvent.paste(captured.editor.view.dom, { clipboardData: { getData: type => type === 'text/plain' ? '## Pasted heading\n\n**Bold paragraph**' : '', items: [], files: [] } });
    await waitFor(() => expect(document.querySelector('.ProseMirror h2')?.textContent).toBe('Pasted heading'));
    // The local finder only claims a visible editor. jsdom has no layout,
    // so supply the visibility geometry the real timeline panel provides.
    const host = captured.editor.view.dom.closest('[data-bex-global-editor]');
    Object.defineProperty(host, 'offsetParent', { configurable: true, value: document.body });
    host.getBoundingClientRect = () => ({ left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300 });
    act(() => { requestLocalFindShortcut(); });
    await waitFor(() => expect(screen.getByTestId('input-editor-find')).toBeTruthy());
  });
  it('preserves rich descriptions beyond the old limit and searches visible text across marks', () => {
    const html = `<p>${'Long description '.repeat(700)}</p><p>living <strong>word</strong></p>`;
    const event = normalizeEvent({ title: 'Event', start: '1522', description: html });
    expect(event.description).toBe(html);
    expect(filterEvents([event], { query: 'living word' })).toHaveLength(1);
    expect(filterEvents([event], { query: '<strong>' })).toHaveLength(0);
  });
});


it('switches all three description sizes without remounting the editor or losing text', async () => {
  mount('<p>Preserve this text</p>');
  await waitFor(() => expect(captured.editor).toBeTruthy());
  const editor = captured.editor;
  fireEvent.click(screen.getByRole('button', { name: 'Expanded' }));
  expect(screen.getByTestId('timegraph-description-editor').dataset.sizeMode).toBe('expanded');
  fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
  expect(screen.getByTestId('timegraph-description-editor').dataset.sizeMode).toBe('fullscreen');
  expect(captured.editor).toBe(editor);
  expect(editor.getText()).toContain('Preserve this text');
  fireEvent.click(screen.getByRole('button', { name: 'Compact' }));
  expect(screen.getByTestId('timegraph-description-editor').dataset.sizeMode).toBe('compact');
});
