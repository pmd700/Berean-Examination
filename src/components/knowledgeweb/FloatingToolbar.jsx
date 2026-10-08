import React, { useState } from 'react';
import { Plus, Square, Link2, X, Pencil, LayoutGrid, Image as ImageIcon, Hand, Eraser, Dot, Network, Settings2 } from 'lucide-react';
import TimelineGlyph from '@/components/timegraph/TimelineGlyph';
import { motion, AnimatePresence } from 'framer-motion';

// Knowledge Web tool set with spec default keys. Exported so the keybind
// remap UI (useKeybinds) can render the same labels and defaults.
export const KW_TOOLS = [
  { id: 'card',       label: 'Card',     icon: Square,     defaultKey: '1', description: 'Click canvas to place' },
  { id: 'connection', label: 'Connect',  icon: Link2,      defaultKey: '2', description: 'Click card A then B' },
  { id: 'draw',       label: 'Draw',     icon: Pencil,     defaultKey: '3', description: 'Freehand sketch — drag on canvas' },
  { id: 'section',    label: 'Section',  icon: LayoutGrid, defaultKey: '4', description: 'Group cards visually' },
  { id: 'image',      label: 'Image',    icon: ImageIcon,  defaultKey: '5', description: 'Click to place image' },
  { id: 'timegraph',  label: 'Timeline', icon: TimelineGlyph, defaultKey: '6', description: 'Place a live timeline overview' },
  { id: 'point',      label: 'Point',    icon: Dot,        defaultKey: '7', description: 'Drop a routing dot' },
  { id: 'erase',      label: 'Erase',    icon: Eraser,     defaultKey: '8', description: 'Click items to delete' },
  { id: 'web_link',   label: 'Web Link', icon: Network,    defaultKey: '9', description: 'Link another knowledge web' },
  { id: 'hand',       label: 'Hand',     icon: Hand,       defaultKey: '`', description: 'Normal drag and click' },
];

export const KW_DEFAULT_KEYS = KW_TOOLS.reduce((m, t) => { m[t.id] = t.defaultKey; return m; }, {});

const prettyKey = (k) => (k === '`' ? '`' : k === 'space' ? 'Space' : (k || '').toUpperCase());

// Palette presented when the Draw tool is active. Kept short and
// inside the existing palette ethos (deep charcoal canvas; violet,
// gold, silver accents; no orange/amber per design system).
const DRAW_COLORS = [
  '#C9A94E', // muted gold
  '#7C5CB7', // violet
  '#A8B2C1', // silver
  '#E8EBF0', // ink white
  '#3FB68B', // emerald (data positive)
  '#D14B4B', // crimson (data negative)
];
const THICKNESS_MIN = 1;
const THICKNESS_MAX = 16;

export default function FloatingToolbar({
  mode,
  onModeChange,
  connectorStyle = 'curvy',
  onToggleConnectorStyle,
  drawColor,
  onDrawColorChange,
  drawThickness,
  onDrawThicknessChange,
  keybinds = {},
  onOpenRemap,
}) {
  const [expanded, setExpanded] = useState(false);

  const tools = KW_TOOLS;
  const keyFor = (t) => keybinds[t.id] || t.defaultKey;

  const activeTool = tools.find(t => t.id === mode);
  const ActiveIcon = activeTool?.icon ?? null;

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30">
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="mb-2 bg-gray-800 border border-gray-700 rounded-xl p-1.5 shadow-2xl grid grid-cols-2 gap-1"
          >
            {tools.map(tool => {
              const Icon = tool.icon;
              const isActive = mode === tool.id;
              return (
                <button
                  key={tool.id}
                  onClick={() => {
                    onModeChange(isActive ? 'hand' : tool.id);
                    setExpanded(false);
                  }}
                  className={`flex items-center justify-between gap-3 px-2.5 py-2 rounded-lg text-xs transition-all ${
                    isActive ? 'bg-violet-600/10 text-ink-faint' : 'text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Icon className="w-3.5 h-3.5" />
                    <div className="text-left">
                      <div className="font-medium text-[11px]">{tool.label}</div>
                    </div>
                  </div>
                  <span className="text-[10px] font-semibold text-gray-500">{prettyKey(keyFor(tool))}</span>
                </button>
              );
            })}
            {onOpenRemap && (
              <button
                onClick={() => { onOpenRemap(); setExpanded(false); }}
                title="Customize keyboard shortcuts"
                data-testid="tool-remap-kw"
                className="col-span-2 flex items-center justify-center gap-2 px-2.5 py-2 rounded-lg text-[11px] text-gray-300 hover:bg-gray-700 border-t border-gray-700 mt-0.5"
              >
                <Settings2 className="w-3.5 h-3.5" /> Customize shortcuts
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {mode === 'draw' && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-2 bg-gray-800 border border-gray-700 rounded-xl p-2 shadow-2xl flex items-center gap-3"
        >
          <div className="flex items-center gap-1">
            {DRAW_COLORS.map(c => (
              <button
                key={c}
                onClick={() => onDrawColorChange && onDrawColorChange(c)}
                className={`w-5 h-5 rounded-full border-2 transition-transform ${
                  drawColor === c ? 'scale-110 border-white' : 'border-gray-600 hover:scale-105'
                }`}
                style={{ background: c }}
                title={c}
                data-testid={`button-draw-color-${c.replace('#', '')}`}
              />
            ))}
          </div>
          <div className="h-5 w-px bg-gray-600" />
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-400 font-medium">Thickness</span>
            <input
              type="range"
              min={THICKNESS_MIN}
              max={THICKNESS_MAX}
              value={drawThickness ?? 3}
              onChange={(e) => onDrawThicknessChange && onDrawThicknessChange(Number(e.target.value))}
              className="w-24 accent-violet-500"
              data-testid="input-draw-thickness"
            />
            <span className="text-[10px] text-gray-300 font-semibold w-5 text-right">{drawThickness ?? 3}</span>
          </div>
        </motion.div>
      )}

      <div className="flex items-center gap-2">
        {activeTool && mode !== 'hand' && (
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className="bg-violet-600/10 border border-line rounded-lg px-3 py-2 flex items-center gap-2"
          >
            {ActiveIcon && <ActiveIcon className="w-4 h-4 text-ink-faint" />}
            <span className="text-xs text-ink-soft font-medium">{activeTool.label}</span>
            <span className="text-[10px] text-ink font-semibold">{prettyKey(keyFor(activeTool))}</span>
            <button
              onClick={() => onModeChange('hand')}
              className="text-ink-faint hover:text-ink-muted ml-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}

        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setExpanded(!expanded)}
          className={`w-12 h-12 rounded-full shadow-xl flex items-center justify-center transition-colors ${
            expanded ? 'bg-gray-700 text-gray-300' : 'bg-brand hover:bg-elevated text-white'
          }`}
        >
          {expanded ? <X className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
        </motion.button>
      </div>
    </div>
  );
}
