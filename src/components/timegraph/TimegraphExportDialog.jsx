import React from 'react';
import { Loader2, X } from 'lucide-react';
import TimegraphCanvas from './TimegraphCanvas';
import {
  EXPORT_FORMATS,
  EXPORT_SCOPES,
  docxParts,
  exportFileName,
  exportFrame,
  resolveScope,
  toCsv,
  toJson,
  wrapSvg,
} from '@/lib/timegraph/timegraphExport';
import { formatTimePoint, parseTimeInput } from '@/lib/timegraph/timegraphDate';
import { toast } from 'sonner';

/**
 * Export dialog.
 *
 * The image formats are produced from a hidden, non-interactive `TimegraphCanvas`
 * mounted at the export frame — the same component the screen uses. That is
 * deliberate: a separate drawing routine for export is the usual reason exported
 * images drift from what the user saw, and it is what makes "must not crop event
 * cards or date labels" hard to keep true. Here the frame is computed from the
 * laid-out lane count, so the image is sized to its content.
 */

const EXPORT_WIDTH = 1600;
const PNG_SCALE = 2;

const FORMAT_LABELS = Object.freeze({
  png: 'PNG image',
  svg: 'SVG vector',
  pdf: 'PDF document',
  docx: 'Word document',
  csv: 'CSV spreadsheet',
  json: 'JSON (re-importable)',
});

const SCOPE_LABELS = Object.freeze({
  [EXPORT_SCOPES.ALL]: 'Entire timegraph',
  [EXPORT_SCOPES.VIEW]: 'Current view',
  [EXPORT_SCOPES.SELECTION]: 'Selected events',
  [EXPORT_SCOPES.RANGE]: 'Custom date range',
});

function download(blob, fileName) {
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export default function TimegraphExportDialog({ timegraph, viewport, selectedIds = [], onClose }) {
  const [format, setFormat] = React.useState('png');
  const [scope, setScope] = React.useState(EXPORT_SCOPES.ALL);
  const [rangeFrom, setRangeFrom] = React.useState('');
  const [rangeTo, setRangeTo] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const frameRef = React.useRef(null);

  const parsedRange = React.useMemo(() => ({
    from: parseTimeInput(rangeFrom),
    to: parseTimeInput(rangeTo),
  }), [rangeFrom, rangeTo]);

  const scoped = React.useMemo(() => resolveScope(timegraph, {
    scope,
    viewport,
    selectedIds,
    from: parsedRange.from ? parsedRange.from.year : null,
    to: parsedRange.to ? parsedRange.to.year : null,
  }), [timegraph, scope, viewport, selectedIds, parsedRange]);

  // The frame used for image exports: wide, and tall enough for every lane.
  const frame = React.useMemo(
    () => exportFrame(scoped.events, { from: scoped.from, to: scoped.to, width: EXPORT_WIDTH }),
    [scoped],
  );

  const needsCanvas = format === 'png' || format === 'svg' || format === 'pdf';

  const serializeSvg = () => {
    const svg = frameRef.current?.querySelector('svg');
    if (!svg) throw new Error('The timegraph could not be prepared for export.');
    const markup = new XMLSerializer().serializeToString(svg);
    return wrapSvg(markup, { width: frame.width, height: frame.height });
  };

  const svgToPngBlob = async (svgText) => {
    const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    try {
      const image = await new Promise((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error('The timegraph image could not be rendered.'));
        element.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = frame.width * PNG_SCALE;
      canvas.height = frame.height * PNG_SCALE;
      const context = canvas.getContext('2d');
      context.scale(PNG_SCALE, PNG_SCALE);
      context.drawImage(image, 0, 0, frame.width, frame.height);
      return await new Promise((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed.'))), 'image/png');
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const run = async () => {
    if (!scoped.events.length && format !== 'json') {
      toast.error('That selection contains no events.');
      return;
    }
    setBusy(true);
    try {
      const name = (extension) => exportFileName(timegraph.title, extension, scope);

      if (format === 'json') {
        download(
          new Blob([toJson(timegraph, { events: scoped.events })], { type: 'application/json' }),
          name('json'),
        );
      } else if (format === 'csv') {
        download(new Blob([toCsv(scoped.events)], { type: 'text/csv;charset=utf-8' }), name('csv'));
      } else if (format === 'docx') {
        const { default: JSZip } = await import('jszip');
        const zip = new JSZip();
        for (const [path, content] of Object.entries(docxParts(timegraph, scoped.events))) {
          zip.file(path, content);
        }
        const blob = await zip.generateAsync({
          type: 'blob',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
        download(blob, name('docx'));
      } else if (format === 'svg') {
        download(new Blob([serializeSvg()], { type: 'image/svg+xml;charset=utf-8' }), name('svg'));
      } else if (format === 'png') {
        download(await svgToPngBlob(serializeSvg()), name('png'));
      } else if (format === 'pdf') {
        const pngBlob = await svgToPngBlob(serializeSvg());
        const dataUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(pngBlob);
        });
        const { jsPDF } = await import('jspdf');
        // Page follows the image's own aspect ratio, so the graph is never
        // letterboxed or cropped to fit a fixed page size.
        const pdf = new jsPDF({
          orientation: frame.width >= frame.height ? 'landscape' : 'portrait',
          unit: 'pt',
          format: [frame.width, frame.height],
          // Without this jsPDF embeds the bitmap uncompressed: the same graph came
          // out as a 12.6MB PDF from a 153KB PNG.
          compress: true,
        });
        // 'FAST' keeps the deflate cheap; the image is already PNG-compressed and
        // the gain from 'SLOW' on a flat-colour chart is not worth the stall.
        pdf.addImage(dataUrl, 'PNG', 0, 0, frame.width, frame.height, undefined, 'FAST');
        pdf.save(name('pdf'));
      }
      toast.success(`Exported ${scoped.events.length} event${scoped.events.length === 1 ? '' : 's'} as ${format.toUpperCase()}.`);
      onClose?.();
    } catch (error) {
      toast.error(error?.message || 'BEX could not complete that export.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center p-4"
      style={{ background: 'rgb(0 0 0 / 0.6)', backdropFilter: 'blur(3px)' }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose?.(); }}
      data-testid="timegraph-export-dialog"
    >
      <div
        className="w-full max-w-md rounded-xl p-4 space-y-3"
        style={{ background: 'rgb(var(--surface))', border: '1px solid rgb(var(--line))' }}
        role="dialog"
        aria-modal="true"
        aria-label="Export timegraph"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold" style={{ color: 'rgb(var(--ink))' }}>
            Export timegraph
          </h3>
          <button type="button" className="bex-tg-button" onClick={onClose} aria-label="Close">
            <X className="w-3 h-3" />
          </button>
        </div>

        <div>
          <span className="bex-tg-label">Format</span>
          <div className="grid grid-cols-3 gap-1.5">
            {EXPORT_FORMATS.map((entry) => (
              <button
                key={entry}
                type="button"
                className={`bex-tg-button justify-center ${format === entry ? 'is-active' : ''}`}
                onClick={() => setFormat(entry)}
                aria-pressed={format === entry}
                data-testid={`timegraph-format-${entry}`}
              >
                {entry.toUpperCase()}
              </button>
            ))}
          </div>
          <p className="bex-tg-hint">{FORMAT_LABELS[format]}</p>
        </div>

        <div>
          <span className="bex-tg-label">What to export</span>
          <div className="space-y-1">
            {Object.entries(SCOPE_LABELS).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-xs" style={{ color: 'rgb(var(--ink-muted))' }}>
                <input
                  type="radio"
                  name="timegraph-export-scope"
                  value={value}
                  checked={scope === value}
                  onChange={() => setScope(value)}
                  disabled={value === EXPORT_SCOPES.SELECTION && selectedIds.length === 0}
                  data-testid={`timegraph-scope-${value}`}
                />
                {label}
                {value === EXPORT_SCOPES.SELECTION && selectedIds.length === 0 && (
                  <span style={{ color: 'rgb(var(--ink-faint))' }}>(nothing selected)</span>
                )}
              </label>
            ))}
          </div>
        </div>

        {scope === EXPORT_SCOPES.RANGE && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="bex-tg-label" htmlFor="tg-range-from">From</label>
              <input
                id="tg-range-from"
                className="bex-tg-input"
                value={rangeFrom}
                onChange={(event) => setRangeFrom(event.target.value)}
                placeholder="1400"
                data-testid="timegraph-range-from"
              />
              <p className="bex-tg-hint">
                {parsedRange.from ? formatTimePoint(parsedRange.from) : 'Year, or 776 BCE'}
              </p>
            </div>
            <div>
              <label className="bex-tg-label" htmlFor="tg-range-to">To</label>
              <input
                id="tg-range-to"
                className="bex-tg-input"
                value={rangeTo}
                onChange={(event) => setRangeTo(event.target.value)}
                placeholder="1600"
                data-testid="timegraph-range-to"
              />
              <p className="bex-tg-hint">
                {parsedRange.to ? formatTimePoint(parsedRange.to) : 'Year, or 33 CE'}
              </p>
            </div>
          </div>
        )}

        <p className="text-[11px]" style={{ color: 'rgb(var(--ink-faint))' }} data-testid="timegraph-export-summary">
          {scoped.events.length} event{scoped.events.length === 1 ? '' : 's'}
          {needsCanvas && ` · ${frame.width}×${frame.height}px`}
        </p>

        <div className="flex justify-end gap-1.5 pt-1">
          <button type="button" className="bex-tg-button" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="bex-tg-button is-primary"
            onClick={run}
            disabled={busy}
            data-testid="timegraph-export-run"
          >
            {busy && <Loader2 className="w-3 h-3 animate-spin" />}
            Export
          </button>
        </div>
      </div>

      {/* The hidden export frame. Off-screen rather than display:none, because a
          display:none subtree has no layout and the text measurement the layout
          depends on would come back as zero. */}
      {needsCanvas && (
        <div
          ref={frameRef}
          aria-hidden="true"
          style={{
            position: 'fixed',
            left: -100000,
            top: 0,
            width: frame.width,
            height: frame.height,
            pointerEvents: 'none',
          }}
        >
          <TimegraphCanvas
            timegraph={{ ...timegraph, events: scoped.events }}
            viewport={frame}
            interactive={false}
            showCursorGuide={false}
          />
        </div>
      )}
    </div>
  );
}
