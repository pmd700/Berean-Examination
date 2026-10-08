import React, { useState, useMemo } from 'react';
import { X, Plus, Tag } from 'lucide-react';

const PALETTE = [
  { label: 'Violet',  hex: '#7C5CB7' },
  { label: 'Blue',    hex: '#4A90D9' },
  { label: 'Cyan',    hex: '#38BDF8' },
  { label: 'Green',   hex: '#4CAF82' },
  { label: 'Gold',    hex: '#C9A94E' },
  { label: 'Orange',  hex: '#E07B4A' },
  { label: 'Red',     hex: '#E05A5A' },
  { label: 'Pink',    hex: '#D45C8A' },
  { label: 'Slate',   hex: '#8899AA' },
  { label: 'Teal',    hex: '#38B2AC' },
];

// Tint opacity defaults to 30 (matches the previous hard-coded ~0.18 alpha
// blend that CanvasCard used for tag tints) and tops out at 80 so tints
// never fully obscure the card body. Applied as a percent on the card tint
// gradient + ring.
const OPACITY_DEFAULT = 30;
const OPACITY_MAX = 80;

// Storage shape:
//   tagColors[tag] = '#hex'                        ← legacy
//   tagColors[tag] = { color: '#hex', opacity: N } ← current
// Always normalize on read so the rest of the panel can assume the object
// form without juggling two shapes.
export function normalizeTagColor(value) {
  if (!value) return null;
  if (typeof value === 'string') return { color: value, opacity: OPACITY_DEFAULT };
  if (typeof value === 'object' && value.color) {
    const op = typeof value.opacity === 'number' ? value.opacity : OPACITY_DEFAULT;
    return { color: value.color, opacity: Math.max(0, Math.min(OPACITY_MAX, op)) };
  }
  return null;
}

export default function TagColorPanel({ tagColors, onChange, onClose, cards }) {
  const [newTag, setNewTag] = useState('');
  const [newColor, setNewColor] = useState(PALETTE[0].hex);

  // Show suggestions in their normalized form so what the user picks is
  // exactly what gets stored.
  const allTags = useMemo(() => Array.from(
    new Set(
      cards
        .flatMap(c => c.tags || [])
        .map(t => String(t || '').trim().toLowerCase())
        .filter(Boolean),
    ),
  ).sort(), [cards]);

  const addMapping = () => {
    const tag = String(newTag || '').trim().toLowerCase();
    if (!tag) return;
    onChange({ ...tagColors, [tag]: { color: newColor, opacity: OPACITY_DEFAULT } });
    setNewTag('');
  };

  const removeMapping = (tag) => {
    const next = { ...tagColors };
    delete next[tag];
    onChange(next);
  };

  const updateMapping = (tag, patch) => {
    const current = normalizeTagColor(tagColors[tag]) || { color: PALETTE[0].hex, opacity: OPACITY_DEFAULT };
    onChange({ ...tagColors, [tag]: { ...current, ...patch } });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') addMapping();
  };

  return (
    <div className="absolute right-0 top-full mt-1 z-50 w-80 bg-surface border border-line rounded-lg shadow-2xl text-xs" data-testid="panel-tag-colors">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-line">
        <div className="flex items-center gap-2 text-ink-muted font-semibold">
          <Tag className="w-3.5 h-3.5" />
          Tag Colors
        </div>
        <button onClick={onClose} className="text-ink-faint hover:text-ink-muted transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="p-3 space-y-3">
        <div className="space-y-1.5">
          <div className="text-[10px] text-ink-faint uppercase tracking-wider">Add mapping</div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                value={newTag}
                onChange={e => setNewTag(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="tag name..."
                list="kw-tag-suggestions"
                className="w-full h-7 px-2 rounded bg-app border border-line text-ink placeholder:text-line-strong outline-none focus:border-brand transition-colors text-xs"
                data-testid="input-tag-name"
              />
              <datalist id="kw-tag-suggestions">
                {allTags.filter(t => !(t in tagColors)).map(t => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
            <button
              onClick={addMapping}
              disabled={!newTag.trim()}
              className="h-7 px-2 rounded bg-brand hover:bg-brand-strong text-white transition-colors disabled:opacity-40 flex items-center gap-1"
              data-testid="button-add-tag-color"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {PALETTE.map(p => (
              <button
                key={p.hex}
                onClick={() => setNewColor(p.hex)}
                title={p.label}
                className="w-5 h-5 rounded transition-transform hover:scale-110"
                style={{
                  backgroundColor: p.hex,
                  outline: newColor === p.hex ? `2px solid ${p.hex}` : '2px solid transparent',
                  outlineOffset: '2px',
                }}
              />
            ))}

            {/* Custom color picker — same conic-gradient affordance as the
                section inspector so the two surfaces feel consistent. */}
            <div
              className="relative w-5 h-5 rounded overflow-hidden ml-1"
              style={{
                background: 'conic-gradient(from 180deg, #ef4444, #f59e0b, #facc15, #22c55e, #06b6d4, #3b82f6, #a855f7, #ec4899, #ef4444)',
                outline: !PALETTE.some(p => p.hex.toLowerCase() === newColor.toLowerCase())
                  ? `2px solid ${newColor}` : '2px solid transparent',
                outlineOffset: '2px',
              }}
              title="Custom color"
            >
              <input
                type="color"
                value={newColor}
                onChange={e => setNewColor(e.target.value)}
                className="absolute inset-0 opacity-0 cursor-pointer"
                data-testid="input-tag-custom-color"
              />
            </div>
            <span className="ml-1 text-[10px] font-mono text-ink-faint">{newColor.toUpperCase()}</span>
          </div>
        </div>

        {Object.keys(tagColors).length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[10px] text-ink-faint uppercase tracking-wider">Active</div>
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {Object.entries(tagColors).map(([tag, raw]) => {
                const entry = normalizeTagColor(raw) || { color: PALETTE[0].hex, opacity: OPACITY_DEFAULT };
                return (
                  <div key={tag} className="px-2 py-2 rounded bg-elevated group space-y-1.5">
                    <div className="flex items-center gap-2">
                      <div className="relative w-4 h-4 rounded-sm flex-shrink-0 overflow-hidden" style={{ backgroundColor: entry.color }}>
                        <input
                          type="color"
                          value={entry.color}
                          onChange={e => updateMapping(tag, { color: e.target.value })}
                          className="absolute inset-0 opacity-0 cursor-pointer"
                          title="Change color"
                          data-testid={`input-tag-color-${tag}`}
                        />
                      </div>
                      <span className="flex-1 text-ink-muted truncate">#{tag}</span>
                      <span className="text-[10px] text-ink-faint font-mono w-9 text-right">{entry.opacity}%</span>
                      <button
                        onClick={() => removeMapping(tag)}
                        className="opacity-0 group-hover:opacity-100 text-ink-faint hover:text-red-400 transition-all"
                        data-testid={`button-remove-tag-${tag}`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={OPACITY_MAX}
                      step={1}
                      value={Math.min(entry.opacity, OPACITY_MAX)}
                      onChange={e => updateMapping(tag, { opacity: Number(e.target.value) })}
                      className="w-full accent-brand-strong"
                      data-testid={`input-tag-opacity-${tag}`}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {Object.keys(tagColors).length === 0 && (
          <p className="text-center text-line-strong py-2">No tag colors set yet</p>
        )}
      </div>
    </div>
  );
}
