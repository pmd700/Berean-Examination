import React, { useCallback, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import CanvasCard from '../../src/components/knowledgeweb/CanvasCard';
import ConnectionLines from '../../src/components/knowledgeweb/ConnectionLines';
import { estimateSmartCardGeometry, getCardGeometrySignature } from '../../src/components/knowledgeweb/smartCardGeometry';
import { installAppTypography } from '../../src/styles/typography';
installAppTypography();
const initialCards = Array.from({ length: 61 }, (_, i) => ({
    id: i + 1, title: i ? `Research card ${i}: a title that wraps over several lines` : 'Resize this card',
    description: '<p>Saved research with <strong>rich formatting</strong> and a body preview.</p>'.repeat(4),
    x: i ? 550 + (i % 6) * 185 : 70, y: i ? 40 + Math.floor(i / 6) * 150 : 65,
    width: i ? 175 : 260, height: 150, layout_mode: i ? 'smart' : 'manual',
}));
const connections = initialCards.slice(1).map(card => ({ id: card.id, from_card_id: 1, to_card_id: card.id }));
function App() {
    const [cards, setCards] = useState(initialCards);
    const [measured, setMeasured] = useState({});
    const [zoom, setZoom] = useState(1);
    const geometries = useMemo(() => Object.fromEntries(cards.map(card => [card.id,
        measured[card.id]?.signature === getCardGeometrySignature(card) ? measured[card.id] : estimateSmartCardGeometry(card),
    ])), [cards, measured]);
    const onGeometryChange = useCallback((id, geometry) => {
        window.resizeMetrics.measurements++;
        setMeasured(prev => prev[id]?.signature === geometry.signature && prev[id]?.path === geometry.path ? prev : { ...prev, [id]: geometry });
    }, []);
    const onResize = useCallback((id, width, height, options) => {
        window.resizeMetrics.updates++;
        setCards(prev => prev.map(card => card.id === id ? { ...card, width: Math.round(width), height: Math.round(height), layout_mode: options.layoutMode } : card));
    }, []);
    window.resizeProof = {
        ready: () => Object.keys(measured).length >= 60,
        reset: () => { window.resizeMetrics = { estimates: 0, measurements: 0, updates: 0 }; },
        setZoom,
        setSmart: () => setCards(prev => prev.map(card => card.id === 1 ? { ...card, title: 'A much wider first line\nShort', width: 260, layout_mode: 'smart' } : card)),
        rects: () => {
            const root = document.querySelector('[data-card-id="1"]');
            const box = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
            return { root: box(root), shape: box(root.querySelector('[data-card-shape]')), grip: box(root.querySelector('button')), card: cards[0], metrics: window.resizeMetrics,
                transition: getComputedStyle(root.querySelector('[data-card-shape]')).transitionProperty };
        },
        event: (type, x, y) => {
            const target = type === 'mousedown' ? document.querySelector('[data-card-id="1"] button') : window;
            target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === 'mouseup' ? 0 : 1, clientX: x, clientY: y }));
        },
        frames: async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); },
    };
    return <div className="relative overflow-clip h-screen bg-gray-900 text-gray-100">
    <div className="absolute origin-top-left" style={{ width: '100%', height: '100%', transform: `scale(${zoom})` }}>
      <ConnectionLines cards={cards} connections={connections} cardGeometries={geometries}/>
      {cards.map(card => <CanvasCard key={card.id} card={card} geometry={geometries[card.id]} onGeometryChange={onGeometryChange} zoom={zoom} onResize={onResize} onSelect={() => { }} onDragEnd={() => { }} onQuickRename={() => { }}/>)}
    </div>
  </div>;
}
window.resizeMetrics = { estimates: 0, measurements: 0, updates: 0 };
createRoot(document.getElementById('root')).render(<App />);
