import React, { useState, useEffect, useRef } from 'react';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { X, Trash2, LayoutGrid, Image as ImageIcon, CalendarRange, Lock, Unlock } from 'lucide-react';

// Curated palette of section colors. Stored as hex on the row so it round-trips
// cleanly through autosave/version-history without needing a separate enum.
const SECTION_PRESETS = [
  { label: 'Blue',    hex: '#3b82f6' },
  { label: 'Violet',  hex: '#6B4C9A' },
  { label: 'Purple',  hex: '#a855f7' },
  { label: 'Rose',    hex: '#f43f5e' },
  { label: 'Red',     hex: '#ef4444' },
  { label: 'Amber',   hex: '#f59e0b' },
  { label: 'Emerald', hex: '#10b981' },
  { label: 'Green',   hex: '#22c55e' },
  { label: 'Cyan',    hex: '#06b6d4' },
  { label: 'Slate',   hex: '#64748b' },
];

// Maps the legacy named ids that may still be in the DB to their hex value
// so the swatch ring lights up correctly on existing sections.
const LEGACY_NAMED = {
  default: '#3b82f6',
  blue: '#3b82f6',
  violet: '#6B4C9A',
  green: '#22c55e',
  purple: '#a855f7',
  red: '#ef4444',
};

function normalizeColor(value) {
  if (!value) return '#3b82f6';
  if (value.startsWith('#')) return value;
  return LEGACY_NAMED[value] || '#3b82f6';
}

// Cap opacity well below 100 so a section never visually drowns the cards
// inside it. 50% is plenty to clearly mark a region.
const OPACITY_MAX = 50;

export default function ObjectInspector({ obj, onUpdate, onDelete, onClose }) {
  const [title, setTitle] = useState(obj.title || '');
  const [content, setContent] = useState(obj.content || '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const saveTimer = useRef(null);

  useEffect(() => {
    setTitle(obj.title || '');
    setContent(obj.content || '');
    setConfirmDelete(false);
  }, [obj.id]);

  const autosave = (updates) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => onUpdate(obj.id, updates), 500);
  };

  const typeLabels = { section: 'Section', image: 'Image', drawing: 'Drawing', timegraph: 'Timeline' };
  const TypeIcon = obj.object_type === 'section' ? LayoutGrid : obj.object_type === 'timegraph' ? CalendarRange : ImageIcon;
  const currentHex = normalizeColor(obj.color);
  const currentOpacity = typeof obj.opacity === 'number' ? obj.opacity : 10;
  const isLocked = !!obj.is_locked;

  return (
    <div className="bex-card-inspector w-80 bg-gray-900 border-l border-gray-800 flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <TypeIcon className="w-3.5 h-3.5 text-sky-400" />
          <h3 className="text-sm font-semibold text-gray-200">{typeLabels[obj.object_type] || 'Object'}</h3>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X className="w-4 h-4" /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {obj.object_type === 'section' && (
          <>
            <div>
              <label className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Title</label>
              <Input
                value={title}
                onChange={e => { setTitle(e.target.value); autosave({ title: e.target.value }); }}
                className="mt-1 bg-gray-800/50 border-gray-700 text-gray-100 h-9 text-sm"
                placeholder="Section title"
                data-testid="input-section-title"
              />
            </div>

            <div>
              <button
                type="button"
                onClick={() => onUpdate(obj.id, { is_locked: !isLocked })}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-xs transition-colors ${
                  isLocked
                    ? 'bg-amber-500/10 border-amber-500/40 text-amber-200 hover:bg-amber-500/20'
                    : 'bg-gray-800/50 border-gray-700 text-gray-300 hover:border-gray-600'
                }`}
                data-testid="button-section-lock-toggle"
              >
                <span className="flex items-center gap-2">
                  {isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                  {isLocked ? 'Locked' : 'Unlocked'}
                </span>
                <span className="text-[10px] opacity-70">
                  {isLocked ? 'Click to unlock' : 'Click to lock'}
                </span>
              </button>
            </div>

            <div>
              <label className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Color</label>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {SECTION_PRESETS.map(c => {
                  const selected = currentHex.toLowerCase() === c.hex.toLowerCase();
                  return (
                    <button
                      key={c.hex}
                      type="button"
                      onClick={() => onUpdate(obj.id, { color: c.hex })}
                      title={c.label}
                      data-testid={`button-section-color-${c.label.toLowerCase()}`}
                      className={`w-7 h-7 rounded-lg border-2 transition-all ${
                        selected ? 'border-white scale-110' : 'border-transparent hover:scale-105'
                      }`}
                      style={{ background: c.hex + '30' }}
                    >
                      <div className="w-full h-full rounded-md" style={{ background: c.hex }} />
                    </button>
                  );
                })}
                <label
                  className="w-7 h-7 rounded-lg border-2 border-transparent hover:scale-105 transition-all cursor-pointer relative overflow-hidden"
                  title="Custom color"
                  style={{
                    background: 'conic-gradient(from 0deg, #ef4444, #f59e0b, #facc15, #22c55e, #06b6d4, #3b82f6, #a855f7, #ec4899, #ef4444)',
                  }}
                >
                  <input
                    type="color"
                    value={currentHex}
                    onChange={e => onUpdate(obj.id, { color: e.target.value })}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    data-testid="input-section-color-custom"
                  />
                </label>
              </div>
              <div className="mt-1.5 text-[10px] text-gray-500 font-mono">{currentHex.toUpperCase()}</div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
                  Background Opacity
                </label>
                {/* Editable number input — clamped on commit so users can
                    type any precise value within the allowed range. */}
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    min={0}
                    max={OPACITY_MAX}
                    step={1}
                    value={Math.min(currentOpacity, OPACITY_MAX)}
                    onChange={e => {
                      const raw = e.target.value;
                      if (raw === '') return;
                      const n = Number(raw);
                      if (Number.isNaN(n)) return;
                      const clamped = Math.max(0, Math.min(OPACITY_MAX, n));
                      onUpdate(obj.id, { opacity: clamped });
                    }}
                    className="h-6 w-14 px-1 py-0 text-[11px] font-mono text-right bg-[#0F1218] border-line"
                    data-testid="input-section-opacity-number"
                  />
                  <span className="text-[10px] text-gray-500 font-mono">%</span>
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={OPACITY_MAX}
                step={1}
                value={Math.min(currentOpacity, OPACITY_MAX)}
                onChange={e => onUpdate(obj.id, { opacity: Number(e.target.value) })}
                className="w-full mt-1.5 accent-brand-strong"
                data-testid="input-section-opacity"
              />
              <div className="text-[10px] text-gray-500 mt-1">
                Slide to 0 for a transparent fill (border only).
              </div>
            </div>

            {/* Title font size — slider + typable number, mirrors the
                opacity control above. */}
            <div>
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
                  Title Size
                </label>
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    min={10}
                    max={64}
                    step={1}
                    value={typeof obj.font_size === 'number' ? obj.font_size : 18}
                    onChange={e => {
                      const raw = e.target.value;
                      if (raw === '') return;
                      const n = Number(raw);
                      if (Number.isNaN(n)) return;
                      const clamped = Math.max(10, Math.min(64, n));
                      onUpdate(obj.id, { font_size: clamped });
                    }}
                    className="h-6 w-14 px-1 py-0 text-[11px] font-mono text-right bg-[#0F1218] border-line"
                    data-testid="input-section-font-size-number"
                  />
                  <span className="text-[10px] text-gray-500 font-mono">px</span>
                </div>
              </div>
              <input
                type="range"
                min={10}
                max={64}
                step={1}
                value={typeof obj.font_size === 'number' ? obj.font_size : 18}
                onChange={e => onUpdate(obj.id, { font_size: Number(e.target.value) })}
                className="w-full mt-1.5 accent-brand-strong"
                data-testid="input-section-font-size"
              />
            </div>

            <div>
              <label className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Size</label>
              <div className="flex gap-2 mt-1">
                <div>
                  <span className="text-[9px] text-gray-600">W</span>
                  <Input
                    type="number"
                    value={obj.width || 400}
                    onChange={e => onUpdate(obj.id, { width: Math.max(200, parseInt(e.target.value) || 400) })}
                    className="bg-gray-800/50 border-gray-700 text-gray-100 h-7 text-xs w-20"
                  />
                </div>
                <div>
                  <span className="text-[9px] text-gray-600">H</span>
                  <Input
                    type="number"
                    value={obj.height || 300}
                    onChange={e => onUpdate(obj.id, { height: Math.max(100, parseInt(e.target.value) || 300) })}
                    className="bg-gray-800/50 border-gray-700 text-gray-100 h-7 text-xs w-20"
                  />
                </div>
              </div>
            </div>
          </>
        )}

        {obj.object_type === 'image' && obj.image_url && (
          <div>
            <img src={obj.image_url} alt="" className="w-full rounded-lg" />
          </div>
        )}
      </div>

      <div className="p-3 border-t border-gray-800">
        {confirmDelete ? (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => onDelete(obj.id)} className="flex-1 h-8 text-xs bg-red-600 hover:bg-red-700 text-white">Confirm</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)} className="h-8 text-xs text-gray-400">Cancel</Button>
          </div>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)} className="w-full text-red-400/70 hover:text-red-300 hover:bg-red-950/20">
            <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete
          </Button>
        )}
      </div>
    </div>
  );
}
