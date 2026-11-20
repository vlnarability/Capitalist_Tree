/**
 * CatchUpProgressBar — progress UI for the Web Worker offline catch-up
 * (P11 W11 / RV5-F1).
 *
 * Renders a modal-style progress bar while the Web Worker runs the offline
 * catch-up chunks. Reads `ui.catchUpProgress` (`{completed, total}` or `null`)
 * via a narrow Zustand selector. Returns `null` when no catch-up is running.
 *
 * The bar shows "Catching up… N / M chunks" + a fill bar. For a zero-chunk
 * catch-up (`total=0`), it shows "Catching up…" with an indeterminate bar
 * (briefly, before the OfflineModal renders the summary).
 *
 * This component NEVER runs simulation logic — it only reads the progress
 * the worker posts via `postMessage` (rule 6: render reads state, never writes).
 */
import { type ReactElement } from 'react';
import { useGameStore } from '../../stores/game-store';

export interface CatchUpProgressBarProps {
  className?: string;
}

export function CatchUpProgressBar({ className }: CatchUpProgressBarProps = {}): ReactElement | null {
  const progress = useGameStore((s) => s.ui.catchUpProgress);
  if (progress === null) return null;

  const pct = progress.total > 0 ? Math.min(100, (progress.completed / progress.total) * 100) : 0;
  const indeterminate = progress.total === 0;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Catching up ${progress.completed} of ${progress.total} chunks`}
      className={
        'fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm ' +
        (className ?? '')
      }
    >
      <div className="w-[min(90vw,28rem)] rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <h2 className="mb-3 text-lg font-semibold text-slate-100">Catching up…</h2>
        <p className="mb-4 text-sm text-slate-400">
          Simulating your absence offline. The game will resume shortly.
        </p>
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-700">
          {indeterminate ? (
            <div
              className="h-full w-1/3 animate-pulse rounded-full bg-emerald-500"
              aria-hidden="true"
            />
          ) : (
            <div
              className="h-full rounded-full bg-emerald-500 transition-[width] duration-150 ease-out"
              style={{ width: `${pct}%` }}
              aria-hidden="true"
            />
          )}
        </div>
        {!indeterminate && (
          <p className="mt-2 text-right text-xs tabular-nums text-slate-400">
            {progress.completed} / {progress.total} chunks
          </p>
        )}
      </div>
    </div>
  );
}
