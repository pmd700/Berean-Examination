import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

/**
 * Contains a render crash to one part of the app.
 *
 * React unmounts the *entire* tree when a component throws during render and
 * nothing catches it. In BEX that means one bad component blanks the whole
 * window and takes every open workspace with it — including whatever was sitting
 * in an editor behind its autosave debounce, which is the part that actually
 * costs the user something.
 *
 * A boundary around each tab pane turns that into a single broken pane: the
 * other tabs keep their canvas position, scroll, undo history and unsaved edits,
 * and the broken one offers to remount itself.
 *
 * This has to be a class — `componentDidCatch` and `getDerivedStateFromError`
 * have no hook equivalent.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, attempt: 0 };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Kept to the console rather than sent anywhere: this is a local-first app
    // and a crash report is a page of the user's own study material.
    console.error(`[${this.props.label || 'BEX'}] render error:`, error, info?.componentStack);
    this.props.onError?.(error, info);
  }

  componentDidUpdate(previousProps) {
    // A changed resetKey means the thing that crashed has been navigated away
    // from, so give the subtree a fresh chance rather than stranding the pane.
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  retry = () => {
    // Bumping `attempt` remounts the subtree via its key, so a component that
    // failed on a transient condition gets a genuinely clean start rather than
    // re-rendering straight back into its broken state.
    this.setState((current) => ({ error: null, attempt: current.attempt + 1 }));
  };

  render() {
    const { error, attempt } = this.state;
    const { children, label, fallback } = this.props;

    if (!error) {
      return <React.Fragment key={attempt}>{children}</React.Fragment>;
    }

    if (fallback) return fallback({ error, retry: this.retry });

    return (
      <div
        className="flex h-full min-h-[12rem] w-full items-center justify-center p-6"
        role="alert"
        data-testid="error-boundary-fallback"
      >
        <div
          className="w-full max-w-md rounded-xl p-4 space-y-3"
          style={{ background: 'rgb(var(--surface))', border: '1px solid rgb(var(--line))' }}
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: '#fbbf24' }} />
            <h2 className="text-sm font-semibold" style={{ color: 'rgb(var(--ink))' }}>
              {label ? `${label} hit a problem` : 'Something went wrong here'}
            </h2>
          </div>

          <p className="text-xs leading-relaxed" style={{ color: 'rgb(var(--ink-muted))' }}>
            The rest of BEX is still running and your other tabs are untouched.
            Reloading this pane usually clears it.
          </p>

          {/* The message only — a component stack means nothing to the reader,
              and it is in the console for when it does matter. */}
          <p
            className="rounded-md px-2 py-1.5 font-mono text-[11px] break-words"
            style={{ background: 'rgb(var(--elevated) / 0.6)', color: 'rgb(var(--ink-faint))' }}
            data-testid="error-boundary-message"
          >
            {String(error?.message || error)}
          </p>

          <button
            type="button"
            onClick={this.retry}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors"
            style={{ background: 'rgb(var(--brand-strong))', color: '#fff' }}
            data-testid="error-boundary-retry"
          >
            <RotateCcw className="h-3 w-3" /> Reload this pane
          </button>
        </div>
      </div>
    );
  }
}
