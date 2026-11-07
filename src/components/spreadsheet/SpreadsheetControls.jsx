import React from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Grid2X2, X } from 'lucide-react';
import './SpreadsheetControls.css';

export const SPREADSHEET_COLORS = Object.freeze([
  '#ffffff', '#e2e8f0', '#94a3b8', '#64748b', '#334155', '#0f172a', '#000000', '#fef3c7',
  '#fee2e2', '#fecaca', '#ef4444', '#b91c1c', '#ffedd5', '#fb923c', '#ea580c', '#9a3412',
  '#fef08a', '#facc15', '#eab308', '#854d0e', '#dcfce7', '#86efac', '#22c55e', '#166534',
  '#ccfbf1', '#5eead4', '#14b8a6', '#115e59', '#dbeafe', '#60a5fa', '#2563eb', '#1e3a8a',
  '#ede9fe', '#c4b5fd', '#8b5cf6', '#5b21b6', '#fce7f3', '#f9a8d4', '#ec4899', '#9d174d',
]);
const clamp = (n, min, max) => Math.max(min, Math.min(n, max));

function Floating({ anchor, children, className, role, id, label }) {
  const element = React.useRef(null);
  const [position, setPosition] = React.useState({ left: 8, top: 8, visibility: 'hidden' });
  React.useLayoutEffect(() => {
    if (!anchor || !element.current) return;
    const a = anchor.getBoundingClientRect(), b = element.current.getBoundingClientRect();
    const width = window.innerWidth || document.documentElement.clientWidth;
    const height = window.innerHeight || document.documentElement.clientHeight;
    const top = a.bottom + 8 + b.height <= height - 8 ? a.bottom + 8 : Math.max(8, a.top - b.height - 8);
    setPosition({ left: clamp(a.left, 8, Math.max(8, width - b.width - 8)), top: clamp(top, 8, Math.max(8, height - b.height - 8)), visibility: 'visible' });
  }, [anchor]);
  return createPortal(<div ref={element} role={role} id={id} aria-label={label} className={className} style={position}>{children}</div>, document.body);
}

/** A real, accessible tooltip without relying on the operating system's title delay. */
export const Tool = React.forwardRef(function Tool({ icon: Icon, children, active, title, className = '', onPointerEnter, onPointerLeave, onFocus, onBlur, onClick, ...props }, forwardedRef) {
  const button = React.useRef(null), timer = React.useRef(null);
  const [visible, setVisible] = React.useState(false);
  const tooltipId = React.useId();
  const text = title || (typeof children === 'string' ? children : '');
  const cancel = React.useCallback(() => { clearTimeout(timer.current); timer.current = null; setVisible(false); }, []);
  const show = () => { clearTimeout(timer.current); if (text) timer.current = setTimeout(() => setVisible(true), 180); };
  React.useEffect(() => {
    const hide = () => cancel();
    window.addEventListener('scroll', hide, true); window.addEventListener('resize', hide); window.addEventListener('blur', hide);
    return () => { clearTimeout(timer.current); window.removeEventListener('scroll', hide, true); window.removeEventListener('resize', hide); window.removeEventListener('blur', hide); };
  }, [cancel]);
  return <>
    <button type="button" {...props} ref={node => { button.current = node; if (typeof forwardedRef === 'function') forwardedRef(node); else if (forwardedRef) forwardedRef.current = node; }}
      className={`sheet-tool ${active ? 'is-active' : ''} ${className}`.trim()}
      aria-label={props['aria-label'] || text || undefined} aria-describedby={visible ? [props['aria-describedby'], tooltipId].filter(Boolean).join(' ') : props['aria-describedby']}
      onPointerEnter={e => { show(); onPointerEnter?.(e); }} onPointerLeave={e => { cancel(); onPointerLeave?.(e); }}
      onFocus={e => { show(); onFocus?.(e); }} onBlur={e => { cancel(); onBlur?.(e); }}
      onClick={e => { cancel(); onClick?.(e); }}>
      {Icon && <Icon size={15} aria-hidden="true" />}{children}
    </button>
    {visible && button.current && <Floating anchor={button.current} role="tooltip" id={tooltipId} className="sheet-control-tooltip">{text}</Floating>}
  </>;
});

function usePopover() {
  const [open, setOpen] = React.useState(false);
  const trigger = React.useRef(null), panel = React.useRef(null);
  const close = React.useCallback(() => setOpen(false), []);
  React.useEffect(() => {
    if (!open) return;
    const pointer = e => { if (!trigger.current?.contains(e.target) && !panel.current?.contains(e.target)) close(); };
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); trigger.current?.focus(); } };
    const scroll = e => { if (!panel.current?.contains(e.target)) close(); };
    document.addEventListener('pointerdown', pointer, true); document.addEventListener('keydown', key, true);
    window.addEventListener('resize', close); window.addEventListener('scroll', scroll, true);
    return () => { document.removeEventListener('pointerdown', pointer, true); document.removeEventListener('keydown', key, true); window.removeEventListener('resize', close); window.removeEventListener('scroll', scroll, true); };
  }, [open, close]);
  return { open, setOpen, trigger, panel, close };
}
function Palette({ label, value, onChange }) {
  return <div className="sheet-color-presets" role="radiogroup" aria-label={`${label} presets`}>
    {SPREADSHEET_COLORS.map(color => <button key={color} type="button" role="radio" aria-label={`${label} ${color}`} aria-checked={color === String(value || '').toLowerCase()} className="sheet-color-swatch" style={{ backgroundColor: color }} onClick={() => onChange(color)}>{color === String(value || '').toLowerCase() && <span aria-hidden="true">✓</span>}</button>)}
  </div>;
}
const validColor = value => /^#[0-9a-f]{6}$/i.test(value || '');

export function ColorPicker({ label, value, onChange, allowClear = false }) {
  const popup = usePopover();
  const id = React.useId();
  const apply = color => { onChange(color); popup.close(); };
  return <>
    <Tool ref={popup.trigger} title={label} active={popup.open} aria-haspopup="dialog" aria-expanded={popup.open} aria-controls={popup.open ? id : undefined} className="sheet-color-trigger" onClick={() => popup.setOpen(v => !v)}>
      <span className="sheet-color-trigger-icon" aria-hidden="true">{label.toLowerCase().includes('text') ? 'A' : '▧'}<i style={{ backgroundColor: value || 'transparent' }} /></span><ChevronDown size={10} aria-hidden="true" />
    </Tool>
    {popup.open && <Floating anchor={popup.trigger.current} role="dialog" id={id} label={label} className="sheet-control-popover">
      <div ref={popup.panel} onKeyDown={e => e.stopPropagation()}>
        <header><strong>{label}</strong><button type="button" aria-label={`Close ${label}`} onClick={popup.close}><X size={14} /></button></header>
        <Palette label={label} value={value} onChange={apply} />
        <label className="sheet-custom-color">Custom color<input type="color" aria-label={`Custom ${label.toLowerCase()}`} value={validColor(value) ? value : '#000000'} onChange={e => apply(e.target.value)} /></label>
        {allowClear && <button type="button" className="sheet-control-action" onClick={() => apply(null)}>Clear {label.toLowerCase()}</button>}
      </div>
    </Floating>}
  </>;
}

const BORDER_PATTERNS = [
  ['all', 'All borders'], ['outer', 'Outer borders'], ['inner', 'Inner borders'], ['top', 'Top border'],
  ['bottom', 'Bottom border'], ['left', 'Left border'], ['right', 'Right border'], ['none', 'No borders'],
];
function BorderIcon({ pattern }) {
  const lines = { top: [3,3,21,3], bottom: [3,21,21,21], left: [3,3,3,21], right: [21,3,21,21], vertical: [12,3,12,21], horizontal: [3,12,21,12] };
  const keys = pattern === 'all' ? Object.keys(lines) : pattern === 'outer' ? ['top','bottom','left','right'] : pattern === 'inner' ? ['vertical','horizontal'] : pattern === 'none' ? [] : [pattern];
  return <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" fill="none" stroke="currentColor" strokeDasharray="1 3" opacity=".35" />{keys.map(key => <line key={key} x1={lines[key][0]} y1={lines[key][1]} x2={lines[key][2]} y2={lines[key][3]} stroke="currentColor" strokeWidth="1.6" />)}{pattern === 'none' && <path d="m5 5 14 14" stroke="currentColor" />}</svg>;
}
export function BorderPicker({ onApply }) {
  const popup = usePopover(), id = React.useId();
  const [pattern, setPattern] = React.useState('all'), [width, setWidth] = React.useState(1), [color, setColor] = React.useState('#64748b');
  return <>
    <Tool ref={popup.trigger} icon={Grid2X2} title="Cell borders" active={popup.open} aria-haspopup="dialog" aria-expanded={popup.open} aria-controls={popup.open ? id : undefined} onClick={() => popup.setOpen(v => !v)}><ChevronDown size={10} aria-hidden="true" /></Tool>
    {popup.open && <Floating anchor={popup.trigger.current} role="dialog" id={id} label="Cell borders" className="sheet-control-popover">
      <div ref={popup.panel} onKeyDown={e => e.stopPropagation()}>
        <header><strong>Cell borders</strong><button type="button" aria-label="Close cell borders" onClick={popup.close}><X size={14} /></button></header>
        <div className="sheet-border-patterns" role="radiogroup" aria-label="Border placement">{BORDER_PATTERNS.map(([key, label]) => <button key={key} type="button" role="radio" aria-checked={pattern === key} aria-label={label} onClick={() => setPattern(key)}><BorderIcon pattern={key} /><span>{label}</span></button>)}</div>
        <div className="sheet-border-widths" role="radiogroup" aria-label="Border width">{[1,2,3,4].map(w => <button key={w} type="button" role="radio" aria-checked={width === w} aria-label={`${w} pixel border`} onClick={() => setWidth(w)}><i style={{ borderTopWidth: w }} /><span>{w} px</span></button>)}</div>
        <p className="sheet-control-caption">Border color</p><Palette label="Border color" value={color} onChange={setColor} />
        <label className="sheet-custom-color">Custom color<input type="color" aria-label="Custom border color" value={color} onChange={e => setColor(e.target.value)} /></label>
        <button type="button" className="sheet-control-action primary" onClick={() => { onApply({ pattern, width, color }); popup.close(); }}>Apply borders</button>
      </div>
    </Floating>}
  </>;
}
