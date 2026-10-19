import React, { useEffect } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import AttachmentViewer from '@/components/attachments/AttachmentViewer';
import AttachmentPreview from '@/components/attachments/AttachmentPreview';
import { getAttachmentPreviewKind, isVaultAttachmentUrl, openAttachmentExternally } from '@/components/attachments/attachmentModel';

const pdfHarness = vi.hoisted(() => ({ options: null, pageProps: null, loadError: false, password: false, passwordCallback: vi.fn(), workerOptions: {} }));
vi.mock('react-pdf', () => ({
  pdfjs: { GlobalWorkerOptions: pdfHarness.workerOptions, PasswordResponses: { INCORRECT_PASSWORD: 2 } },
  Document: ({ file, children, onLoadSuccess, onLoadError, onPassword, options }) => {
    pdfHarness.options = options;
    useEffect(() => {
      let active = true;
      queueMicrotask(() => {
        if (!active) return;
        if (pdfHarness.loadError) onLoadError(new Error('Unreadable document'));
        else if (pdfHarness.password) onPassword(pdfHarness.passwordCallback, 1);
        else onLoadSuccess({ numPages: 3 });
      });
      return () => { active = false; };
    }, [file]);
    return <div data-testid="mock-pdf-document">{children}</div>;
  },
  Page: props => {
    pdfHarness.pageProps = props;
    return <div data-testid="mock-pdf-page">PDF page {props.pageNumber}</div>;
  },
}));

const attachment = (name, mimeType) => ({ name, mimeType, size: 120, url: `bex-media://library/file-01234567-89ab-4cde-8012-3456789abcde.${name.split('.').at(-1).toLowerCase()}` });
let statusListener;
let unsubscribe;
beforeEach(() => {
  pdfHarness.loadError = false;
  pdfHarness.password = false;
  pdfHarness.passwordCallback.mockReset();
  unsubscribe = vi.fn();
  window.bexDesktop = {
    openLocalFile: vi.fn(async () => ({ ok: true })),
    onPrivacyStatusChanged: vi.fn(callback => { statusListener = callback; return unsubscribe; }),
  };
});
afterEach(() => { delete window.bexDesktop; });

describe('vault attachment viewers', () => {
  it('only classifies PDF/audio/video and rejects remote or malformed references', () => {
    expect(getAttachmentPreviewKind(attachment('Study.PDF', 'application/octet-stream'))).toBe('pdf');
    expect(getAttachmentPreviewKind(attachment('Lecture.mp3', 'audio/mpeg'))).toBe('audio');
    expect(getAttachmentPreviewKind(attachment('Class.webm', 'video/webm'))).toBe('video');
    expect(getAttachmentPreviewKind(attachment('Notes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'))).toBeNull();
    expect(isVaultAttachmentUrl('bex-media://library/file-not-a-uuid.pdf')).toBe(false);
    for (const url of ['https://example.com/file.pdf', 'file:///tmp/a.pdf', 'bex-media://other/a.pdf', 'bex-media://library/../../a.pdf', 'bex-media://library/%2e%2e/a.pdf', 'bex-media://library/a.pdf?script=1', 'bex-media://user@library/a.pdf']) {
      expect(isVaultAttachmentUrl(url)).toBe(false);
      expect(getAttachmentPreviewKind({ url, name: 'a.pdf' })).toBeNull();
    }
  });

  it('navigates real controls and zoom, and passes hardened options to the PDF library', async () => {
    render(<AttachmentViewer attachment={attachment('Study.pdf', 'application/pdf')} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Page 1 of 3')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Previous page' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('Page 2 of 3')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('PDF page'), { target: { value: '1.5' } });
    expect(screen.getByText('Page 1 of 3')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('PDF page'), { target: { value: '99' } });
    expect(screen.getByText('Page 3 of 3')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next page' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByLabelText('PDF zoom').textContent).toBe('125%');
    fireEvent.click(screen.getByRole('button', { name: 'Fit width' }));
    expect(screen.getByLabelText('PDF zoom').textContent).toBe('100%');
    expect(pdfHarness.options.isEvalSupported).toBe(false);
    expect(pdfHarness.options.cMapUrl).toBe('/pdf-assets/cmaps/');
    expect(pdfHarness.pageProps.renderAnnotationLayer).toBe(false);
    expect(pdfHarness.pageProps.renderForms).toBe(false);
    expect(pdfHarness.pageProps.renderTextLayer).toBe(true);
    expect(pdfHarness.workerOptions.workerSrc).not.toMatch(/unpkg|cdn/);
  });

  it('shows a first-page PDF thumbnail and opens its existing attachment', async () => {
    const onOpen = vi.fn();
    render(<AttachmentPreview attachment={attachment('Study.pdf', 'application/pdf')} onOpen={onOpen} />);
    await screen.findByTestId('mock-pdf-page');
    expect(pdfHarness.pageProps).toMatchObject({ pageNumber: 1, width: 180, renderAnnotationLayer: false, renderTextLayer: false });
    fireEvent.click(screen.getByRole('button', { name: 'Open Study.pdf' }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('uses native audio and video controls without autoplay and provides the external action', async () => {
    const audio = attachment('Lecture.mp3', 'audio/mpeg');
    const view = render(<AttachmentViewer attachment={audio} onClose={vi.fn()} />);
    expect(screen.getByTestId('attachment-audio').controls).toBe(true);
    expect(screen.getByTestId('attachment-audio').autoplay).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Open in default app' }));
    await waitFor(() => expect(window.bexDesktop.openLocalFile).toHaveBeenCalledWith(audio.url));
    view.rerender(<AttachmentViewer attachment={attachment('Class.webm', 'video/webm')} onClose={vi.fn()} />);
    expect(screen.getByTestId('attachment-video').controls).toBe(true);
    expect(screen.getByTestId('attachment-video').autoplay).toBe(false);
    fireEvent.error(screen.getByTestId('attachment-video'));
    expect(screen.getByRole('alert').textContent).toContain('could not play');
    expect(screen.getByRole('button', { name: 'Open in default app' })).toBeTruthy();
  });

  it('shows native audio playback inline and opens videos from their first-frame preview', () => {
    const onOpen = vi.fn();
    const view = render(<AttachmentPreview attachment={attachment('Lecture.mp3', 'audio/mpeg')} onOpen={onOpen} />);
    const audio = screen.getByLabelText('Audio preview: Lecture.mp3');
    expect(audio.controls).toBe(true);
    expect(audio.autoplay).toBe(false);
    view.rerender(<AttachmentPreview attachment={attachment('Class.webm', 'video/webm')} onOpen={onOpen} />);
    const video = screen.getByLabelText('Video preview: Class.webm');
    expect(video.controls).toBe(false);
    expect(video.muted).toBe(true);
    expect(video.autoplay).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Open Class.webm' }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('drops media and closes the viewer immediately when the vault locks', () => {
    const onClose = vi.fn();
    const view = render(<AttachmentViewer attachment={attachment('Lecture.mp3', 'audio/mpeg')} onClose={onClose} />);
    const audio = screen.getByTestId('attachment-audio');
    Object.defineProperty(audio, 'paused', { configurable: true, value: false });
    Object.defineProperty(audio, 'networkState', { configurable: true, value: 2 });
    const pause = vi.spyOn(audio, 'pause').mockImplementation(() => {});
    const load = vi.spyOn(audio, 'load').mockImplementation(() => {});
    act(() => statusListener({ locked: true }));
    expect(screen.queryByTestId('attachment-audio')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
    expect(pause).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledOnce();
    expect(audio.hasAttribute('src')).toBe(false);
    view.unmount();
    expect(unsubscribe).toHaveBeenCalled();
    render(<AttachmentPreview attachment={attachment('Class.webm', 'video/webm')} onOpen={vi.fn()} />);
    act(() => statusListener({ locked: true }));
    expect(screen.queryByTestId('attachment-preview')).toBeNull();
  });

  it('checks current lock status on preview remount and ignores an older unlocked response', async () => {
    let resolveStatus;
    window.bexDesktop.getPrivacyStatus = vi.fn(() => new Promise(resolve => { resolveStatus = resolve; }));
    const view = render(<AttachmentPreview attachment={attachment('Lecture.mp3', 'audio/mpeg')} onOpen={vi.fn()} />);
    expect(screen.queryByTestId('attachment-preview')).toBeNull();
    act(() => statusListener({ locked: true }));
    await act(async () => resolveStatus({ ok: true, status: { locked: false } }));
    expect(screen.queryByTestId('attachment-preview')).toBeNull();
    view.unmount();
    window.bexDesktop.getPrivacyStatus.mockResolvedValue({ ok: true, status: { locked: true } });
    render(<AttachmentPreview attachment={attachment('Lecture.mp3', 'audio/mpeg')} onOpen={vi.fn()} />);
    await act(async () => {});
    expect(screen.queryByTestId('attachment-preview')).toBeNull();
    act(() => statusListener({ locked: false }));
    expect(screen.getByTestId('attachment-preview')).toBeTruthy();
  });

  it('surfaces corrupt PDF and OS-open errors while retaining a useful fallback action', async () => {
    pdfHarness.loadError = true;
    window.bexDesktop.openLocalFile.mockResolvedValue({ ok: false, error: 'No default application.' });
    render(<AttachmentViewer attachment={attachment('Corrupt.pdf', 'application/pdf')} onClose={vi.fn()} />);
    await screen.findByText('BEX could not display this PDF. Use Open in default app.');
    fireEvent.click(screen.getByRole('button', { name: 'Open in default app' }));
    await screen.findByText('No default application.');
    await expect(openAttachmentExternally('https://example.com/bad.pdf')).rejects.toThrow('invalid vault reference');
  });

  it('requests encrypted PDF passwords in memory and never embeds unsafe remote PDFs', async () => {
    pdfHarness.password = true;
    const view = render(<AttachmentViewer attachment={attachment('Private.pdf', 'application/pdf')} onClose={vi.fn()} />);
    const input = await screen.findByLabelText('PDF password');
    fireEvent.change(input, { target: { value: 'only-in-memory' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock PDF' }));
    expect(pdfHarness.passwordCallback).toHaveBeenCalledWith('only-in-memory');
    view.rerender(<AttachmentViewer attachment={{ url: 'https://example.com/remote.pdf', name: 'Remote.pdf', mimeType: 'application/pdf' }} onClose={vi.fn()} />);
    expect(screen.queryByTestId('mock-pdf-document')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open in default app' }).disabled).toBe(true);
  });
});
