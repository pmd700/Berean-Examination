import React from 'react';
import TimegraphTagInput from './TimegraphTagInput';
import TimegraphDescriptionEditor from './TimegraphDescriptionEditor';
import {
  AlignCenter, AlignLeft, AlignRight, ArrowDownToLine, ArrowUpToLine,
  Copy, Image as ImageIcon, Link2, Trash2, X,
} from 'lucide-react';
import {
  EVENT_COLORS,
  MARKER_STYLES,
} from '@/lib/timegraph/timegraphModel';
import { formatTimePoint, parseTimeInput } from '@/lib/timegraph/timegraphDate';

/**
 * The right-hand editing panel for one event.
 *
 * Dates are free text rather than a date picker on purpose: this app has to
 * express "c. 1514", "776 BCE" and "13.8 billion BCE", none of which a native
 * `<input type="date">` can hold. The field accepts those forms directly and
 * reports only genuine parsing errors, keeping the panel quiet while editing.
 */
export default function TimegraphEventPanel({
  event,
  onChange,
  onDuplicate,
  onDelete,
  onClose,
  linkTargets = [],
  availableTags = [],
}) {
  if (!event) return null;

  const patch = (fields) => onChange?.({ ...event, ...fields });

  return (
    <aside className="bex-tg-panel" data-testid="timegraph-panel">
      <div
        className="flex items-center justify-between gap-2 px-3 py-2.5 sticky top-0 z-10"
        style={{ background: 'rgb(var(--surface))', borderBottom: '1px solid rgb(var(--line))' }}
      >
        <h3 className="bex-tg-label" style={{ marginBottom: 0 }}>Event</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="grid h-7 w-7 place-items-center rounded text-red-400 hover:bg-red-400/10 hover:text-red-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400"
            onClick={() => onDelete?.(event.id)}
            aria-label="Delete event"
            title="Delete event"
            data-testid="timegraph-delete-event"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        <button
          type="button"
          onClick={onClose}
          className="bex-tg-button"
          style={{ height: '1.4rem', padding: '0 0.3rem' }}
          aria-label="Close event panel"
        >
          <X className="w-3 h-3" />
        </button>
        </div>
      </div>

      <div className="p-3 space-y-3">
        <div>
          <label className="bex-tg-label" htmlFor="tg-title">Title</label>
          <input
            id="tg-title"
            className="bex-tg-input"
            value={event.title}
            onChange={(e) => patch({ title: e.target.value })}
            placeholder="New event"
            data-testid="timegraph-event-title"
          />
        </div>

        <div>
          <TimegraphDescriptionEditor
            key={event.id}
            content={event.description}
            onChange={(description) => patch({ description })}
          />
        </div>

        <DateField
          id="tg-start"
          label="Start date"
          point={event.start}
          required
          onCommit={(point) => point && patch({ start: point })}
        />

        <DateField
          id="tg-end"
          label="End date (optional)"
          point={event.end}
          onCommit={(point) => patch({ end: point })}
          onClear={() => patch({ end: null })}
        />

        <div>
          <span className="bex-tg-label">Colour</span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Event colour">
            {EVENT_COLORS.map((color) => (
              <button
                key={color.id}
                type="button"
                className={`bex-tg-swatch ${event.color === color.id ? 'is-active' : ''}`}
                style={{ background: color.fill }}
                onClick={() => patch({ color: color.id })}
                title={color.label}
                aria-label={color.label}
                aria-pressed={event.color === color.id}
                data-testid={`timegraph-color-${color.id}`}
              />
            ))}
          </div>
        </div>

        <div>
          <span className="bex-tg-label">Position</span>
          <div className="flex gap-1.5">
            {[
              { value: 'above', label: 'Above', Icon: ArrowUpToLine },
              { value: 'below', label: 'Below', Icon: ArrowDownToLine },
            ].map(({ value, label, Icon }) => (
              <button
                key={value}
                type="button"
                className={`bex-tg-button flex-1 justify-center ${event.position === value ? 'is-active' : ''}`}
                onClick={() => patch({ position: value })}
                aria-pressed={event.position === value}
                data-testid={`timegraph-position-${value}`}
              >
                <Icon className="w-3 h-3" /> {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="bex-tg-label">Text alignment</span>
          <div className="flex gap-1.5">
            {[
              { value: 'left', Icon: AlignLeft },
              { value: 'center', Icon: AlignCenter },
              { value: 'right', Icon: AlignRight },
            ].map(({ value, Icon }) => (
              <button
                key={value}
                type="button"
                className={`bex-tg-button flex-1 justify-center ${event.align === value ? 'is-active' : ''}`}
                onClick={() => patch({ align: value })}
                aria-label={`Align ${value}`}
                aria-pressed={event.align === value}
              >
                <Icon className="w-3 h-3" />
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="bex-tg-label" htmlFor="tg-marker">Marker</label>
          <select
            id="tg-marker"
            className="bex-tg-select"
            value={event.marker}
            onChange={(e) => patch({ marker: e.target.value })}
            data-testid="timegraph-marker"
          >
            {MARKER_STYLES.map((style) => (
              <option key={style} value={style}>
                {style.charAt(0).toUpperCase() + style.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="bex-tg-label" htmlFor="tg-scale">
            Size — {event.scale.toFixed(2)}×
          </label>
          <input
            id="tg-scale"
            type="range"
            min="0.6"
            max="2.5"
            step="0.05"
            value={event.scale}
            onChange={(e) => patch({ scale: Number(e.target.value) })}
            className="w-full"
            data-testid="timegraph-scale"
          />
        </div>

        <TimegraphTagInput
          key={event.id}
          value={event.tags}
          availableTags={availableTags}
          onChange={(tags) => patch({ tags })}
        />

        <MediaField event={event} onChange={patch} />

        <LinkField event={event} onChange={patch} linkTargets={linkTargets} />

        <div
          className="flex gap-1.5 pt-2"
          style={{ borderTop: '1px solid rgb(var(--line))' }}
        >
          <button
            type="button"
            className="bex-tg-button flex-1 justify-center"
            onClick={() => onDuplicate?.(event.id)}
            data-testid="timegraph-duplicate-event"
          >
            <Copy className="w-3 h-3" /> Duplicate
          </button>
        </div>
      </div>
    </aside>
  );
}

/**
 * A date field that keeps what you typed while you type and parses on blur or
 * Enter. Reformatting mid-keystroke would fight the user.
 */
function DateField({ id, label, point, onCommit, onClear, required = false }) {
  const [draft, setDraft] = React.useState(() => (point ? formatTimePoint(point) : ''));
  const [dirty, setDirty] = React.useState(false);
  const [error, setError] = React.useState(null);

  // Follow the model when the selection changes, unless mid-edit.
  React.useEffect(() => {
    if (dirty) return;
    setDraft(point ? formatTimePoint(point) : '');
    setError(null);
  }, [point, dirty]);

  const commit = () => {
    setDirty(false);
    const text = draft.trim();
    if (!text) {
      if (required) {
        setDraft(point ? formatTimePoint(point) : '');
        setError(null);
        return;
      }
      setError(null);
      onClear ? onClear() : onCommit?.(null);
      return;
    }
    const parsed = parseTimeInput(text);
    if (!parsed) {
      setError('Not a date BEX can read.');
      return;
    }
    setError(null);
    setDraft(formatTimePoint(parsed));
    onCommit?.(parsed);
  };

  return (
    <div>
      <label className="bex-tg-label" htmlFor={id}>{label}</label>
      <input
        id={id}
        className="bex-tg-input"
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setDirty(true); }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') {
            setDirty(false);
            setDraft(point ? formatTimePoint(point) : '');
            setError(null);
          }
        }}
        aria-invalid={error ? 'true' : undefined}
        data-testid={`${id}-input`}
      />
      {error && <p className="bex-tg-hint" style={{ color: '#f87171' }}>{error}</p>}
    </div>
  );
}

function MediaField({ event, onChange }) {
  const [url, setUrl] = React.useState('');
  const add = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    onChange({ media: [...event.media, { kind: 'image', url: trimmed, caption: '' }] });
    setUrl('');
  };

  return (
    <div>
      <span className="bex-tg-label">Attachments</span>
      {event.media.length > 0 && (
        <ul className="space-y-1 mb-1.5">
          {event.media.map((item, index) => (
            <li key={`${item.url}-${index}`} className="flex items-center gap-1.5">
              <ImageIcon className="w-3 h-3 shrink-0" style={{ color: 'rgb(var(--ink-faint))' }} />
              <span
                className="flex-1 truncate text-[11px]"
                style={{ color: 'rgb(var(--ink-muted))' }}
                title={item.url}
              >
                {item.url}
              </span>
              <button
                type="button"
                onClick={() => onChange({ media: event.media.filter((_, i) => i !== index) })}
                aria-label="Remove attachment"
                className="bex-tg-button"
                style={{ height: '1.2rem', padding: '0 0.25rem' }}
              >
                <X className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-1.5">
        <input
          className="bex-tg-input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder="https://… image or link"
          aria-label="Attachment URL"
          data-testid="timegraph-media-url"
        />
        <button type="button" className="bex-tg-button" onClick={add} disabled={!url.trim()}>
          Add
        </button>
      </div>
      <p className="bex-tg-hint">Only http(s) and local library media are accepted.</p>
    </div>
  );
}

/**
 * Links tie an event to the rest of the app — a note, a keyword, a Knowledge Web
 * card, a study chapter — so a date on the axis can lead back to the study behind
 * it. Targets are supplied by whichever surface is hosting the editor.
 */
function LinkField({ event, onChange, linkTargets }) {
  const [choice, setChoice] = React.useState('');

  const add = () => {
    const target = linkTargets.find((entry) => `${entry.kind}:${entry.id}` === choice);
    if (!target) return;
    const exists = event.links.some((link) => link.kind === target.kind && link.id === target.id);
    if (!exists) {
      onChange({
        links: [...event.links, { kind: target.kind, id: target.id, label: target.label }],
      });
    }
    setChoice('');
  };

  return (
    <div>
      <span className="bex-tg-label">Links</span>
      {event.links.length > 0 && (
        <ul className="space-y-1 mb-1.5">
          {event.links.map((link) => (
            <li key={`${link.kind}:${link.id}`} className="flex items-center gap-1.5">
              <Link2 className="w-3 h-3 shrink-0" style={{ color: 'rgb(var(--ink-faint))' }} />
              <span className="flex-1 truncate text-[11px]" style={{ color: 'rgb(var(--ink-muted))' }}>
                {link.label || link.id}
                <span style={{ color: 'rgb(var(--ink-faint))' }}> · {link.kind}</span>
              </span>
              <button
                type="button"
                aria-label={`Remove link to ${link.label || link.id}`}
                className="bex-tg-button"
                style={{ height: '1.2rem', padding: '0 0.25rem' }}
                onClick={() => onChange({
                  links: event.links.filter(
                    (candidate) => !(candidate.kind === link.kind && candidate.id === link.id),
                  ),
                })}
              >
                <X className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {linkTargets.length > 0 ? (
        <div className="flex gap-1.5">
          <select
            className="bex-tg-select"
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            aria-label="Link this event to"
            data-testid="timegraph-link-select"
          >
            <option value="">Choose…</option>
            {linkTargets.map((target) => (
              <option key={`${target.kind}:${target.id}`} value={`${target.kind}:${target.id}`}>
                {target.label} ({target.kind})
              </option>
            ))}
          </select>
          <button type="button" className="bex-tg-button" onClick={add} disabled={!choice}>
            Link
          </button>
        </div>
      ) : null}
    </div>
  );
}
