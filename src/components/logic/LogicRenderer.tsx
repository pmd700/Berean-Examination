import React, { memo, useLayoutEffect, useMemo, useRef } from 'react';
import { renderLogicToHtml } from '@/lib/logic/logic-render';
import { observeLogicBlockFit } from '@/lib/logic/logic-fit';
import './logic-renderer.css';

export type LogicRendererProps = {
  children: string;
  display?: 'inline' | 'block';
  className?: string;
  sourceFormat?: 'unicode' | 'latex';
};

function LogicRendererComponent({
  children,
  display = 'block',
  className = '',
  sourceFormat = 'unicode',
}: LogicRendererProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const surfaceRef = useRef<HTMLSpanElement>(null);
  const rendered = useMemo(
    () => renderLogicToHtml(children, { display, sourceFormat }),
    [children, display, sourceFormat],
  );

  const classes = [
    'logic-renderer',
    `logic-renderer--${display}`,
    rendered.ok ? '' : 'logic-renderer--error',
    className,
  ].filter(Boolean).join(' ');

  useLayoutEffect(() => {
    if (!rendered.ok || display !== 'block' || !containerRef.current || !surfaceRef.current) return undefined;
    const controller = observeLogicBlockFit(containerRef.current, surfaceRef.current);
    return () => controller.destroy();
  }, [children, display, rendered.ok]);

  if (!rendered.ok) {
    if (import.meta.env.DEV) console.warn('BEX logic rendering failed:', rendered.error);
    return (
      <span className={classes} aria-label={`Logic expression: ${children}`} title={rendered.error}>
        <code className="logic-renderer__fallback">{children}</code>
      </span>
    );
  }

  return (
    <span ref={containerRef} className={classes} aria-label={`Logic expression: ${children}`}>
      <span
        ref={surfaceRef}
        className="logic-renderer__surface"
        dangerouslySetInnerHTML={{ __html: rendered.html }}
      />
    </span>
  );
}

export const LogicRenderer = memo(LogicRendererComponent);
export default LogicRenderer;
