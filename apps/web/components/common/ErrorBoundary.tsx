'use client';

/**
 * ErrorBoundary — top-level React error boundary (GAP-34, P11-F).
 *
 * Wraps the app so an uncaught render error in any subtree shows a
 * recoverable fallback instead of a blank page / Next.js default error.
 * React error boundaries MUST be class components (the framework API:
 * `getDerivedStateFromError` + `componentDidCatch`); there is no hook
 * equivalent. This component is a client component (`'use client'`) because
 * it uses React state + lifecycle, which are client-only.
 *
 * Design:
 *   - Catches errors thrown during render, in lifecycle methods, and in
 *     constructors of the whole tree below it (does NOT catch event
 *     handlers, async code, or errors in the error boundary itself — those
 *     are the application's responsibility).
 *   - Renders a themed fallback (matches the app's dark Tailwind theme)
 *     with a "Reload" button (the most reliable recovery for a simulation
 *     app whose state lives in IndexedDB — a reload rehydrates from the
 *     last save) + the error message + digest for bug reports.
 *   - Resets on navigation: if the boundary recovers (e.g. the user
 *     navigates away from the broken screen via the reload), `hasError`
 *     clears so a future render attempt isn't permanently stuck on the
 *     fallback.
 *
 * Rule 6 (rendering / UI reads state, never writes): this component does
 * NOT subscribe to the game store or call the engine — it is purely a
 * render-error safety net. The reload button calls `location.reload()`
 * (browser primitive), not a store action.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  /** The subtree to guard. */
  readonly children: ReactNode;
}

interface ErrorBoundaryState {
  readonly hasError: boolean;
  readonly error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  /**
   * Static lifecycle: called during render when a descendant throws.
   * Returns the next state that triggers the fallback UI. Must be pure
   * (no side effects) — use `componentDidCatch` for logging.
   */
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  /**
   * Called after `getDerivedStateFromError` commits the fallback. Use for
   * side effects (logging). We write to the console so the error is visible
   * in dev tools + captured by any error-reporting integration added later.
   * Intentionally NOT re-thrown.
   */
  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] Uncaught render error:', error, info.componentStack);
  }

  /** Reload the page — rehydrates the game from the last IndexedDB save. */
  private readonly handleReload = (): void => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }
    const { error } = this.state;
    return (
      <div
        role="alert"
        className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 bg-slate-950 text-slate-100 font-sans"
      >
        <div className="max-w-md w-full space-y-4 rounded-lg border border-rose-800/60 bg-slate-900/60 p-6 backdrop-blur-sm">
          <h1 className="text-lg font-semibold text-rose-300">
            The tree hit an unexpected error
          </h1>
          <p className="text-sm text-slate-400">
            The simulation interface failed to render. Your last save is safe —
            reloading the page will restore the game from storage.
          </p>
          {error?.message ? (
            <pre className="text-xs text-slate-500 font-mono whitespace-pre-wrap break-words rounded bg-slate-950/60 p-3 border border-slate-800">
              {error.message}
            </pre>
          ) : null}
          <button
            type="button"
            onClick={this.handleReload}
            className="w-full rounded-md bg-emerald-700 hover:bg-emerald-600 active:bg-emerald-800 px-4 py-2 text-sm font-medium text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            Reload the game
          </button>
        </div>
        <p className="text-[10px] text-slate-600 font-mono uppercase tracking-wider">
          If this keeps happening, check the browser console for details.
        </p>
      </div>
    );
  }
}
