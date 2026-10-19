import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import SlashCommands, { filterSlashCommands, getSlashState } from '@/components/editor/slashCommands';
import SlashCommandMenu from '@/components/editor/SlashCommandMenu';
import FileInsertHost from '@/components/editor/FileInsertHost';
import FileAttachment from '@/components/editor/FileAttachmentExtension';

vi.mock('@/components/attachments/AttachmentViewer', () => ({
  default: ({ attachment, onClose }) => <div data-testid="attachment-viewer">{attachment.name}<button onClick={onClose}>Close viewer</button></div>,
}));
vi.mock('@/components/attachments/AttachmentPreview', () => ({
  default: ({ attachment }) => <div data-testid="attachment-preview">{attachment.name}</div>,
}));

const url = 'bex-media://library/file-12345678-1234-4234-9234-123456789abc.pdf';
const attachment = { url, name: 'Study notes.pdf', mimeType: 'application/pdf', size: 300, kind: 'pdf' };
let editor;

function Harness({ content = '<p>/file</p>' }) {
  const instance = useEditor({
    extensions: [StarterKit, SlashCommands, FileAttachment], content,
    editorProps: { handleScrollToSelection: () => true },
    onCreate: ({ editor: next }) => {
      editor = next;
      next.view.coordsAtPos = () => ({ left: 100, right: 100, top: 100, bottom: 120 });
      next.commands.setTextSelection(next.state.doc.content.size - 1);
    },
  });
  return <><EditorContent editor={instance} /><SlashCommandMenu editor={instance} /><FileInsertHost editor={instance} /></>;
}

async function mount(content) {
  render(<Harness content={content} />);
  await waitFor(() => expect(editor).toBeDefined());
}

beforeEach(() => {
  editor = undefined;
  window.bexDesktop = {
    isDesktop: true,
    importLocalFiles: vi.fn().mockResolvedValue({ ok: true, attachments: [attachment] }),
    openLocalFile: vi.fn().mockResolvedValue({ ok: true }),
  };
});
afterEach(() => { act(() => editor?.destroy()); delete window.bexDesktop; });

describe('note file attachments', () => {
  it('filters /file to File and inserts vault references as compact icons with Enter', async () => {
    expect(filterSlashCommands('file').map(item => item.id)).toEqual(['file']);
    await mount();
    expect(screen.getByTestId('button-slash-file').textContent).toContain('File');
    fireEvent.keyDown(editor.view.dom, { key: 'Enter' });
    await screen.findByTestId('file-attachment-open');
    expect(window.bexDesktop.importLocalFiles).toHaveBeenCalledTimes(1);
    expect(editor.getHTML()).toContain('data-file-url="' + url + '"');
    expect(editor.getHTML()).toContain('data-file-display="icon"');
    expect(editor.getText()).toContain('Study notes.pdf');
    expect(screen.queryByTestId('attachment-preview')).toBeNull();
    expect(getSlashState(editor.state).panel).toBeNull();
  });

  it('opens supported media in BEX and unsupported files automatically in the default app', async () => {
    await mount();
    fireEvent.mouseDown(screen.getByTestId('button-slash-file'));
    fireEvent.click(await screen.findByTestId('file-attachment-open'));
    expect(screen.getByTestId('attachment-viewer').textContent).toContain(attachment.name);
    expect(window.bexDesktop.openLocalFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Close viewer'));
    const zipUrl = url.replace('.pdf', '.zip');
    act(() => editor.commands.setContent({ type: 'doc', content: [
      { type: 'fileAttachment', attrs: { ...attachment, url: zipUrl, name: 'Archive.zip', mimeType: 'application/zip', kind: 'file' } },
      { type: 'paragraph' },
    ] }));
    fireEvent.click(screen.getByTestId('file-attachment-open'));
    await waitFor(() => expect(window.bexDesktop.openLocalFile).toHaveBeenCalledWith(zipUrl));
    expect(screen.queryByTestId('attachment-viewer')).toBeNull();
  });

  it('saves the preview choice and restores attachment metadata from note HTML', async () => {
    await mount();
    fireEvent.keyDown(editor.view.dom, { key: 'Enter' });
    await screen.findByTestId('file-attachment-options');
    fireEvent.keyDown(screen.getByTestId('file-attachment-options'), { key: 'Enter' });
    fireEvent.click(await screen.findByTestId('file-attachment-preview-toggle'));
    expect(screen.getByTestId('attachment-preview')).toBeDefined();
    const html = editor.getHTML();
    const restored = new Editor({ extensions: [StarterKit, FileAttachment], content: html });
    expect(restored.getJSON().content.find(node => node.type === 'fileAttachment').attrs).toEqual({ ...attachment, display: 'preview' });
    restored.destroy();
    act(() => editor.commands.undo());
    expect(screen.queryByTestId('attachment-preview')).toBeNull();
  });

  it('does not insert an attachment when the picker is canceled', async () => {
    window.bexDesktop.importLocalFiles.mockResolvedValue({ ok: true, canceled: true, attachments: [] });
    await mount();
    fireEvent.keyDown(editor.view.dom, { key: 'Enter' });
    await waitFor(() => expect(getSlashState(editor.state).panel).toBeNull());
    expect(screen.queryByTestId('file-attachment')).toBeNull();
    expect(editor.getHTML()).toBe('<p></p>');
  });

  it('keeps the insertion position mapped while the picker is open', async () => {
    let finishImport;
    window.bexDesktop.importLocalFiles.mockReturnValue(new Promise(resolve => { finishImport = resolve; }));
    await mount('<p>Before</p><p>/file</p><p>After</p>');
    act(() => editor.commands.setTextSelection(14));
    fireEvent.keyDown(editor.view.dom, { key: 'Enter' });
    await waitFor(() => expect(finishImport).toBeDefined());
    act(() => editor.commands.insertContentAt(1, 'New '));
    await act(async () => finishImport({ ok: true, attachments: [attachment] }));
    await screen.findByTestId('file-attachment-open');
    const html = editor.getHTML();
    expect(html.indexOf('New Before')).toBeLessThan(html.indexOf('data-bex-file'));
    expect(html.indexOf('data-bex-file')).toBeLessThan(html.indexOf('After'));
  });

  it('leaves a usable editor after a failed import', async () => {
    window.bexDesktop.importLocalFiles.mockResolvedValue({ ok: false, error: 'Vault is locked.' });
    await mount();
    fireEvent.keyDown(editor.view.dom, { key: 'Enter' });
    await waitFor(() => expect(getSlashState(editor.state).panel).toBeNull());
    expect(screen.queryByTestId('file-attachment')).toBeNull();
    act(() => editor.commands.insertContent('Continue writing'));
    expect(editor.getText()).toBe('Continue writing');
  });

  it('rejects remote and filesystem URLs in saved or pasted attachment HTML', () => {
    for (const badUrl of ['javascript:alert(1)', 'file:///etc/passwd', 'https://example.org/test.pdf', 'bex-media://library/../../file.pdf']) {
      const restored = new Editor({ extensions: [StarterKit, FileAttachment], content: `<div data-bex-file="true" data-file-url="${badUrl}" data-file-name="Unsafe"></div>` });
      expect(restored.getJSON().content[0].attrs.url).toBe('');
      restored.destroy();
    }
  });
});
