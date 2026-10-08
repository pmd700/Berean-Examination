import React, { useState } from 'react';
import {
  Plus, X, Link2, Network, NotebookPen, MousePointer2, Eraser, Hand, Settings2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// Reduced Mind View tool set. Two kinds of entries:
//   - `mode`   → sets the persistent interaction mode (connect/point/erase/hand)
//   - `action` → fires once (create a new web / note) and leaves mode alone
// Default keybinds match the project spec; the live keys are passed in via
// `keybinds` so the remap UI (useKeybinds) can override them.
export const MIND_TOOLS = [
  { id: 'connect', label: 'Connect',  icon: Link2,         kind: 'mode',   defaultKey: '1', description: 'Drag one node onto another to link them' },
  { id: 'web',     label: 'New Web',  icon: Network,       kind: 'action', defaultKey: '2', description: 'Create a new Knowledge Web' },
  { id: 'note',    label: 'New Note', icon: NotebookPen,   kind: 'action', defaultKey: '3', description: 'Create a new Mind Note' },
  { id: 'point',   label: 'Point',    icon: MousePointer2, kind: 'mode',   defaultKey: '7', description: 'Select, drag and open nodes' },
  { id: 'erase',   label: 'Erase',    icon: Eraser,        kind: 'mode',   defaultKey: '8', description: 'Click a node or link to delete it' },
  { id: 'hand',    label: 'Hand',     icon: Hand,          kind: 'mode',   defaultKey: '`', description: 'Pan the canvas by dragging anywhere' },
];

const prettyKey = (k) => (k === '`' ? '`' : (k || '').toUpperCase());

export default function MindMapToolbar({
  mode = 'point',
  onModeChange,
  onNewWeb,
  onNewNote,
  onOpenRemap,
  keybinds = {},
}) {
  const [expanded, setExpanded] = useState(false);

  const keyFor = (t) => keybinds[t.id] || t.defaultKey;
  const activeTool = MIND_TOOLS.find((t) => t.id === mode && t.kind === 'mode');
  const ActiveIcon = activeTool?.icon ?? null;

  const handlePick = (tool) => {
    if (tool.kind === 'action') {
      if (tool.id === 'web') onNewWeb && onNewWeb();
      if (tool.id === 'note') onNewNote && onNewNote();
      setExpanded(false);
      return;
    }
    // Mode tool: clicking the active mode toggles back to Point (the default).
    onModeChange && onModeChange(mode === tool.id ? 'point' : tool.id);
    setExpanded(false);
  };

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30" data-testid="mindmap-toolbar">
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="mb-2 card-metal rounded-xl p-1.5 shadow-2xl grid grid-cols-2 gap-1 w-[280px]"
          >
            {MIND_TOOLS.map((tool) => {
              const Icon = tool.icon;
              const isActive = tool.kind === 'mode' && mode === tool.id;
              return (
                <button
                  key={tool.id}
                  onClick={() => handlePick(tool)}
                  title={tool.description}
                  data-testid={`tool-${tool.id}`}
                  className={`flex items-center justify-between gap-3 px-2.5 py-2 rounded-lg text-xs transition-all ${
                    isActive
                      ? 'bg-brand/25 text-ink ring-1 ring-brand-strong/50'
                      : 'text-ink-muted hover:bg-white/5'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon className={`w-3.5 h-3.5 shrink-0 ${tool.kind === 'action' ? 'text-gold' : ''}`} />
                    <span className="font-medium text-[11px] truncate">{tool.label}</span>
                  </div>
                  <span className="text-[10px] font-semibold text-ink-muted/50 shrink-0">{prettyKey(keyFor(tool))}</span>
                </button>
              );
            })}
            {onOpenRemap && (
              <button
                onClick={() => { onOpenRemap(); setExpanded(false); }}
                title="Customize keyboard shortcuts"
                data-testid="tool-remap"
                className="col-span-2 flex items-center justify-center gap-2 px-2.5 py-2 rounded-lg text-[11px] text-ink-muted/80 hover:bg-white/5 border-t border-white/10 mt-0.5"
              >
                <Settings2 className="w-3.5 h-3.5" /> Customize shortcuts
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-center gap-2">
        {activeTool && mode !== 'point' && (
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className="card-metal rounded-lg px-3 py-2 flex items-center gap-2"
          >
            {ActiveIcon && <ActiveIcon className="w-4 h-4 text-brand-strong" />}
            <span className="text-xs text-ink font-medium">{activeTool.label}</span>
            <span className="text-[10px] text-gold font-semibold">{prettyKey(keyFor(activeTool))}</span>
            <button
              onClick={() => onModeChange && onModeChange('point')}
              className="text-ink-muted/60 hover:text-ink-muted ml-1"
              title="Back to Point"
              data-testid="button-clear-mode"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}

        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setExpanded((v) => !v)}
          data-testid="button-toolbar-expand"
          title="Mind Map tools"
          className={`w-12 h-12 rounded-full shadow-xl flex items-center justify-center transition-colors ${
            expanded ? 'bg-[#2A2540] text-ink-muted' : 'bg-brand hover:bg-brand-strong text-white'
          }`}
        >
          {expanded ? <X className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
        </motion.button>
      </div>
    </div>
  );
}
