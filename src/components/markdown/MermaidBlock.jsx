import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';

let enginePromise;
function loadEngine() {
  if (!enginePromise) enginePromise = import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      fontFamily: 'inherit',
      theme: 'default',
    });
    return mermaid;
  }).catch(error => {
    enginePromise = undefined;
    throw error;
  });
  return enginePromise;
}

let counter = 0;

// Renders a fenced ```mermaid block as a real diagram. Falls back to a polished
// error card (with a "View source" toggle) if Mermaid fails — never crashes the
// surrounding message.
export default function MermaidBlock({ code }) {
  const [svg, setSvg] = useState('');
  const [error, setError] = useState(null);
  const [showSource, setShowSource] = useState(false);
  const baseId = useRef(`berean-mermaid-${(counter += 1)}`);
  const source = (code || '').replace(/\n$/, '');

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!source.trim()) {
        setSvg('');
        setError(null);
        return;
      }
      const isDark =
        typeof document !== 'undefined' &&
        document.documentElement.classList.contains('dark');
      const themed = `%%{init: {'theme':'${isDark ? 'dark' : 'default'}'}}%%\n${source}`;
      const renderId = `${baseId.current}-${(counter += 1)}`;
      try {
        const mermaid = await loadEngine();
        if (cancelled) return;
        await mermaid.parse(themed);
        if (cancelled) return;
        const { svg: out } = await mermaid.render(renderId, themed);
        if (!cancelled) {
          setSvg(out);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setSvg('');
          setError(e?.message || String(e));
        }
      }
    }
    run();
    return () => {
      cancelled = true;
    };
    // Re-render if the diagram source changes.
  }, [source]);

  if (error) {
    return (
      <div className="berean-md-card berean-mermaid-error" data-testid="mermaid-error">
        <div className="berean-mermaid-error-head">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>Diagram could not be rendered</span>
        </div>
        <p className="berean-mermaid-error-msg">{error}</p>
        <button
          type="button"
          className="berean-md-toggle"
          onClick={() => setShowSource((v) => !v)}
          data-testid="button-mermaid-source"
        >
          {showSource ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          View source
        </button>
        {showSource && (
          <pre className="berean-md-pre mt-2">
            <code>{source}</code>
          </pre>
        )}
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="berean-md-card berean-mermaid-loading" data-testid="mermaid-loading">
        Rendering diagram…
      </div>
    );
  }

  return (
    <div className="berean-md-card berean-mermaid" data-testid="mermaid-diagram">
      <div className="berean-mermaid-scroll" dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  );
}
