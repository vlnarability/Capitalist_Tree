/**
 * Async offline catch-up via Web Worker (P11 W11 / RV5-F1).
 *
 * Wraps the synchronous `catchUpOnLoad` in a Web Worker so the catch-up
 * simulation runs OFF the main thread. A 30-real-day absence (~1800 1-sim-day
 * chunks) would otherwise freeze the UI for minutes; the worker posts
 * `{type: 'progress'}` after each chunk so the main thread can render a
 * progress bar and stay responsive.
 *
 * Fallback: if `Worker` is unavailable (test environment, SSR, or the worker
 * URL fails to instantiate), this falls back to the synchronous
 * `catchUpOnLoad` on the main thread — correct behavior, just without the
 * progress bar. The fallback runs the same `runOfflineCatchUpChunked`
 * processor, so results are identical.
 */
import { catchUpOnLoad, type CatchUpOnLoadResult, type CatchUpOnLoadStore } from './offline-catch-up-trigger';
import { errorToNotification } from '../dispatch-wrapper';
import type { GameState, OfflineSummary, SimulationEvent } from '@capitalist-tree/shared';
import { OfflineClockTamperedError } from '@capitalist-tree/shared';

/** Progress callback: `(completedChunks, totalChunks)`. `total=0` = no chunks. */
export type CatchUpProgressFn = (completed: number, total: number) => void;

/** The result is the same as the synchronous `catchUpOnLoad`. */
export type CatchUpAsyncResult = CatchUpOnLoadResult;

/**
 * Run the offline catch-up in a Web Worker, reporting progress.
 *
 * Returns a promise that resolves to the catch-up result (state + summary +
 * events). The `onProgress` callback is called after each chunk with
 * `(completed, total)`. Rejects with `OfflineClockTamperedError` if the
 * processor detects a backwards clock (the caller routes this via the
 * existing error-to-notification bridge — `applyCatchUpOnLoad`).
 *
 * If `Worker` is unavailable, falls back to synchronous `catchUpOnLoad`
 * (calls `onProgress` once with the final counts, then resolves).
 */
export function catchUpOnLoadAsync(
  state: GameState,
  nowMs: number,
  onProgress?: CatchUpProgressFn,
): Promise<CatchUpAsyncResult> {
  // SSR / test / non-browser environment — fall back to synchronous.
  if (typeof Worker === 'undefined' || typeof window === 'undefined') {
    return Promise.resolve(runSynchronousFallback(state, nowMs, onProgress));
  }

  return new Promise<CatchUpAsyncResult>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(
        new URL('../../workers/offline-catch-up-worker.ts', import.meta.url),
        { type: 'module' },
      );
    } catch {
      // Worker URL failed to instantiate — fall back to synchronous.
      resolve(runSynchronousFallback(state, nowMs, onProgress));
      return;
    }

    const cleanup = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      worker.terminate();
    };

    const onMessage = (e: MessageEvent) => {
      const msg = e.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'progress') {
        onProgress?.(msg.completed, msg.total);
      } else if (msg.type === 'done') {
        cleanup();
        resolve({
          state: msg.state as GameState,
          summary: msg.summary as OfflineSummary | null,
          events: msg.events as SimulationEvent[],
        });
      } else if (msg.type === 'error') {
        cleanup();
        // Reconstruct the error — OfflineClockTamperedError is the expected one.
        if (msg.name === 'OfflineClockTamperedError') {
          reject(new OfflineClockTamperedError(msg.message));
        } else {
          reject(new Error(msg.message));
        }
      }
    };

    const onError = () => {
      // Worker failed to load/run (e.g. module resolution error in dev) —
      // fall back to synchronous so the catch-up still completes.
      cleanup();
      resolve(runSynchronousFallback(state, nowMs, onProgress));
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage({ type: 'run', state, nowMs });
  });
}

/** Synchronous fallback (same processor, no worker). */
function runSynchronousFallback(
  state: GameState,
  nowMs: number,
  onProgress?: CatchUpProgressFn,
): CatchUpAsyncResult {
  // Report a single progress tick (0→done) so the UI can dismiss cleanly.
  // The synchronous path is fast for small absences; for large ones the
  // fallback is a degraded experience but still correct.
  const result = catchUpOnLoad(state, nowMs);
  if (onProgress) {
    // If the summary exists, report its chunk count; else 0/0.
    const total = result.summary?.chunksRun ?? 0;
    onProgress(total, total);
  }
  return result;
}

/**
 * Async side-effect wrapper — mirrors {@link applyCatchUpOnLoad} but runs the
 * catch-up in a Web Worker (off the main thread) with progress reporting.
 *
 * On a tampered clock: routes `OfflineClockTamperedError` to the notification
 * bridge (same as `applyCatchUpOnLoad`) and returns the original state with
 * `summary: null`. On unknown errors: re-throws.
 *
 * The `onProgress` callback is called after each chunk with
 * `(completed, total)` so the UI can render a progress bar.
 */
export async function applyCatchUpOnLoadAsync(
  state: GameState,
  nowMs: number,
  store: CatchUpOnLoadStore,
  onProgress?: CatchUpProgressFn,
): Promise<CatchUpAsyncResult> {
  try {
    return await catchUpOnLoadAsync(state, nowMs, onProgress);
  } catch (err) {
    if (!(err instanceof OfflineClockTamperedError)) {
      throw err;
    }
    const at = store.simState?.clock.elapsedSeconds ?? 0;
    const payload = errorToNotification(err, at);
    if (payload !== null) {
      store.pushNotification(payload);
    }
    return { state, summary: null, events: [] };
  }
}
