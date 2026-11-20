import { useMediaSource } from '@/lib/mediaSource';
import { useEffect, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { ChevronLeft, ChevronRight, Minus, Plus, Scan } from 'lucide-react';
import 'react-pdf/dist/Page/TextLayer.css';
import { isVaultAttachmentUrl } from './attachmentModel';

// Keep worker configuration in the rendering module, as React-PDF recommends.
// Vite includes the matching installed worker; no CDN or online viewer is used.
pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
const assetRoot = `${/** @type {ImportMeta & {env?: {BASE_URL?: string}}} */ (import.meta).env?.BASE_URL || '/'}pdf-assets/`;
const PDF_OPTIONS = Object.freeze({
  cMapUrl: `${assetRoot}cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${assetRoot}standard_fonts/`,
  wasmUrl: `${assetRoot}wasm/`,
  isEvalSupported: false,
  useSystemFonts: true,
});

export default function PdfAttachmentDocument({ attachment, thumbnail = false }) {
  const mediaSource=useMediaSource(attachment.url);
  const viewportRef = useRef(null);
  const [width, setWidth] = useState(700);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [failed, setFailed] = useState(false);
  const [passwordRequest, setPasswordRequest] = useState(null);
  const [password, setPassword] = useState('');

  useEffect(() => {
    const element = viewportRef.current;
    if (!element || thumbnail) return undefined;
    const measure = () => { if (element.clientWidth) setWidth(Math.max(200, element.clientWidth - 32)); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [thumbnail]);

  useEffect(() => {
    setPage(1); setPages(0); setZoom(1); setFailed(false); setPasswordRequest(null); setPassword('');
  }, [attachment.url]);

  const requestPassword = (callback, reason) => {
    if (thumbnail) { setFailed(true); return; }
    setPassword('');
    setPasswordRequest({ callback, incorrect: reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD });
  };

  if (!isVaultAttachmentUrl(attachment.url)) return <PdfFailure thumbnail={thumbnail}>This attachment has an invalid vault reference.</PdfFailure>;
  if (failed) return <PdfFailure thumbnail={thumbnail}>{thumbnail ? 'Preview unavailable. Open file.' : 'BEX could not display this PDF. Use Open in default app.'}</PdfFailure>;

  return (
    <div data-testid={thumbnail ? 'attachment-pdf-thumbnail' : 'attachment-pdf'} className={thumbnail ? 'pointer-events-none p-2' : 'flex min-h-0 flex-1 flex-col'}>
      {!thumbnail && <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 border-b border-white/10 p-2 text-sm text-slate-300">
        <PdfToolbarButton label="Previous page" disabled={page <= 1 || !pages} onClick={() => setPage(value => value - 1)}><ChevronLeft size={16} /></PdfToolbarButton>
        <label className="flex items-center gap-2">Page <input aria-label="PDF page" type="number" min={1} max={pages || 1} step={1} disabled={!pages} value={page} onChange={event => setPage(Math.max(1, Math.min(pages, Math.floor(Number(event.target.value)) || 1)))} className="w-14 rounded border border-white/10 bg-black/20 px-2 py-1 text-center [appearance:textfield]" /></label>
        <span aria-live="polite" className="sr-only">{pages ? `Page ${page} of ${pages}` : 'Loading pages'}</span>
        <span aria-hidden="true">of {pages || '…'}</span>
        <PdfToolbarButton label="Next page" disabled={!pages || page >= pages} onClick={() => setPage(value => value + 1)}><ChevronRight size={16} /></PdfToolbarButton>
        <span className="mx-1 h-5 border-r border-white/10" aria-hidden="true" />
        <PdfToolbarButton label="Zoom out" disabled={zoom <= 0.5} onClick={() => setZoom(value => Math.max(0.5, Math.round((value - 0.25) * 100) / 100))}><Minus size={16} /></PdfToolbarButton>
        <span aria-label="PDF zoom" className="w-12 text-center">{Math.round(zoom * 100)}%</span>
        <PdfToolbarButton label="Zoom in" disabled={zoom >= 3} onClick={() => setZoom(value => Math.min(3, Math.round((value + 0.25) * 100) / 100))}><Plus size={16} /></PdfToolbarButton>
        <PdfToolbarButton label="Fit width" onClick={() => setZoom(1)}><Scan size={16} /></PdfToolbarButton>
      </div>}
      {passwordRequest && <form className="flex flex-wrap items-center justify-center gap-2 p-4 text-sm" onSubmit={event => { event.preventDefault(); passwordRequest.callback(password); setPasswordRequest(null); setPassword(''); }}>
        <label htmlFor="attachment-pdf-password">{passwordRequest.incorrect ? 'Incorrect password. Try again:' : 'PDF password'}</label>
        <input id="attachment-pdf-password" type="password" autoComplete="off" value={password} onChange={event => setPassword(event.target.value)} className="rounded border border-white/10 bg-black/20 px-3 py-2" autoFocus />
        <button type="submit" className="rounded bg-white/10 px-3 py-2">Unlock PDF</button>
      </form>}
      <div ref={viewportRef} className={thumbnail ? '' : 'min-h-0 flex-1 overflow-auto p-4'}>
        <Document file={mediaSource||undefined} options={PDF_OPTIONS} className="mx-auto w-fit" onLoadSuccess={({ numPages }) => setPages(numPages)} onLoadError={() => setFailed(true)} onSourceError={() => setFailed(true)} onPassword={requestPassword} loading={<PdfStatus>Loading {thumbnail ? 'thumbnail' : 'PDF'}…</PdfStatus>} error={<PdfFailure thumbnail={thumbnail}>PDF unavailable.</PdfFailure>}>
          {!passwordRequest && <Page pageNumber={thumbnail ? 1 : page} width={thumbnail ? 180 : width * zoom} renderTextLayer={!thumbnail} renderAnnotationLayer={false} renderForms={false} devicePixelRatio={Math.min(window.devicePixelRatio || 1, 2)} onLoadError={() => setFailed(true)} onRenderError={() => setFailed(true)} loading={<PdfStatus>Loading page…</PdfStatus>} />}
        </Document>
      </div>
    </div>
  );
}

function PdfToolbarButton({ label, children, ...props }) {
  return <button type="button" aria-label={label} title={label} className="rounded p-2 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400 disabled:opacity-30" {...props}>{children}</button>;
}
function PdfStatus({ children }) { return <p role="status" className="px-3 py-5 text-center text-xs text-slate-400">{children}</p>; }
function PdfFailure({ children, thumbnail }) { return <p role={thumbnail ? 'status' : 'alert'} className="px-3 py-5 text-center text-sm text-slate-400">{children}</p>; }
