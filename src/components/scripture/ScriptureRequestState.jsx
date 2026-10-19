import React from 'react';
import { buttonVariants } from '@/components/ui/button';

export default function ScriptureRequestState({ block, onRetry, busy }) {
  const pending = block.status === 'pending' || block.status === 'loading';
  return (
    <div className="rounded-lg border border-line/60 bg-elevated/20 p-4" data-testid={`scripture-request-${block.requestIndex}`}>
      <p className="mb-2 text-xs font-medium text-ink-muted">{block.reference}</p>
      {pending ? (
        <div role="status" aria-label={`Loading ${block.reference}`} className="space-y-3">
          <span className="sr-only">Loading {block.reference}</span>
          <div className="h-3 w-11/12 rounded bg-ink-faint/10 motion-safe:animate-pulse" />
          <div className="h-3 w-3/4 rounded bg-ink-faint/10 motion-safe:animate-pulse" />
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-muted">{block.error || 'This passage could not be loaded.'}</p>
          <button type="button" className={buttonVariants({ variant: 'outline', size: 'sm' })} disabled={busy} onClick={onRetry}
            aria-label={`Retry ${block.reference}`}>Retry</button>
        </div>
      )}
    </div>
  );
}
