import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import FloatingZoomControls from '../../src/components/knowledgeweb/FloatingZoomControls';
import CanvasCard from '../../src/components/knowledgeweb/CanvasCard';
import useCanvasState from '../../src/components/knowledgeweb/useCanvasState';
import { installAppTypography } from '../../src/styles/typography';
installAppTypography();
function App() {
    const canvas = useCanvasState();
    const containerRef = useRef(null);
    const [sidebar, setSidebar] = useState(false);
    const [hidden, setHidden] = useState(false);
    window.zoomProof = { canvas, setSidebar, setHidden,
        focusDistant: () => document.querySelector('[data-card-id="distant"] button').focus(),
        scrollDistant: () => document.querySelector('[data-card-id="distant"] button').scrollIntoView(),
        snapshot: () => {
            const viewport = document.getElementById('viewport'), hud = document.querySelector('[data-testid="zoom-controls"]');
            const v = viewport.getBoundingClientRect(), h = hud.getBoundingClientRect();
            return { dx: v.right - h.right, dy: v.bottom - h.bottom, x: h.x, y: h.y,
                scrollX: viewport.scrollLeft, scrollY: viewport.scrollTop,
                ancestorX: viewport.parentElement.parentElement.scrollLeft,
                ancestorY: viewport.parentElement.parentElement.scrollTop,
                zoom: canvas.zoom, pan: canvas.pan, width: v.width, height: v.height,
                overflow: getComputedStyle(viewport).overflow };
        },
    };
    return <div className="flex flex-col h-screen bg-gray-900 text-gray-100">
    <header className="h-9 shrink-0 bg-gray-950">Knowledge Web · zoom anchoring regression</header>
    <div className="bex-tab-pane flex-1 min-h-0 min-w-0 flex flex-col overflow-y-auto">
      <div className="h-screen flex overflow-hidden" style={{ display: hidden ? 'none' : undefined }}>
        <div className="flex-1 flex flex-col min-w-0 relative">
          <header className="h-10 shrink-0 border-b border-gray-700">Canvas viewport</header>
          <div id="viewport" className={VIEWPORT_CLASS}>
            <div ref={containerRef} className="w-full h-full" data-canvas="true">
              <div className="absolute origin-top-left" style={{ width: '100%', height: '100%', transform: `translate(${canvas.pan.x}px,${canvas.pan.y}px) scale(${canvas.zoom})` }}>
                <CanvasCard card={{ id: 'near', title: 'Visible card', x: 100, y: 100, width: 200 }} zoom={canvas.zoom} onSelect={() => { }} onDragEnd={() => { }} onResize={() => { }}/>
                <CanvasCard card={{ id: 'distant', title: 'An off-screen card reached by keyboard', x: 1600, y: 950, width: 200 }} zoom={canvas.zoom} onSelect={() => { }} onDragEnd={() => { }} onResize={() => { }}/>
              </div>
            </div>
            <div id="tools" className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-purple-600 rounded-full w-12 h-12"/>
            <FloatingZoomControls zoom={canvas.zoom} multiplyZoom={canvas.multiplyZoom} smoothZoomTo={canvas.smoothZoomTo} containerRef={containerRef}/>
          </div>
        </div>
        {sidebar && <aside className="w-72 shrink-0 bg-gray-800">Inspector</aside>}
      </div>
    </div>
  </div>;
}
createRoot(document.getElementById('root')).render(<App />);
