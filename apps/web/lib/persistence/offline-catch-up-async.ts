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
import { type CatchUpOnLoadResult, type CatchUpOnLoadStore } from './offline-catch-up-trigger';
import { beginOfflineCatchUp } from '@capitalist-tree/simulation';
import { PROVISIONAL_OFFLINE_PROMPT_THRESHOLD_MS } from '../constants';
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
  // SSR / test / non-browser environment — fall back to the async chunked
  // path (W34: yields between chunks so the main thread stays responsive).
  if (typeof Worker === 'undefined' || typeof window === 'undefined') {
    return runChunkedFallback(state, nowMs, onProgress);
  }

  return new Promise<CatchUpAsyncResult>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(
        new URL('../../workers/offline-catch-up-worker.ts', import.meta.url),
        { type: 'module' },
      );
    } catch {
      // Worker URL failed to instantiate — fall back to the async chunked
      // path (W34: no main-thread freeze).
      resolve(runChunkedFallback(state, nowMs, onProgress));
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
        // Reconstruct the error — OfflineClockTamperedError is the expected
        // one. The worker sends the 3 numeric fields (lastSimulatedAt,
        // nowMs, backwardsMs) needed to build a real instance; the trigger
        // checks `instanceof OfflineClockTamperedError`, so a plain Error
        // with a name wouldn't satisfy it.
        if (msg.name === 'OfflineClockTamperedError') {
          reject(
            new OfflineClockTamperedError(
              msg.lastSimulatedAt ?? 0,
              msg.nowMs ?? 0,
              msg.backwardsMs ?? 0,
            ),
          );
        } else {
          reject(new Error(msg.message));
        }
      }
    };

    const onError = () => {
      // Worker failed to load/run (e.g. module resolution error in dev) —
      // fall back to the async chunked path so the catch-up still completes
      // WITHOUT freezing the main thread (W34).
      cleanup();
      resolve(runChunkedFallback(state, nowMs, onProgress));
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage({ type: 'run', state, nowMs });
  });
}

/**
 * P11 (W34 / RV5-F1 follow-up): async chunked fallback for when the Web
 * Worker is unavailable (SSR, test env, or the worker URL fails to load).
 *
 * Pre-W34, the fallback called the synchronous `catchUpOnLoad`, which runs
 * all ~1800 chunks of a 30-real-day absence in one `for` loop on the main
 * thread — freezing the UI for minutes (the exact bug W11 closed for the
 * Worker path). This version drives the pure `beginOfflineCatchUp` stepper
 * one chunk at a time, yielding to the event loop (`setTimeout(0)`) between
 * chunks so the main thread can paint + stay responsive. The result is
 * bit-identical to `catchUpOnLoad` (the stepper produces the same state +
 * summary + events as `runOfflineCatchUp`).
 *
 * Mirrors `catchUpOnLoad`'s decision tree: a fresh save (elapsed ≤ the prompt
 * threshold) returns the input state with `summary: null`; a zero-chunk
 * catch-up (elapsed crossed the threshold but rounded to 0 chunks) returns
 * `summary: null` too (no modal). Throws `OfflineClockTamperedError` on a
 * backwards clock (via `beginOfflineCatchUp` → `planOfflineCatchUp`).
 */
async function runChunkedFallback(
  state: GameState,
  nowMs: number,
  onProgress?: CatchUpProgressFn,
): Promise<CatchUpAsyncResult> {
  const lastSimulatedAt = state.metadata.lastSimulatedAt;
  const elapsed = nowMs - lastSimulatedAt;

  // Fresh save — non-negative elapsed within the prompt threshold. A NEGATIVE
  // elapsed (backwards clock) is deliberately NOT caught here: it falls
  // through to beginOfflineCatchUp, which applies the tolerance check + throws
  // OfflineClockTamperedError on a real tamper (mirrors catchUpOnLoad).
  if (elapsed >= 0 && elapsed <= PROVISIONAL_OFFLINE_PROMPT_THRESHOLD_MS) {
    onProgress?.(0, 0);
    return { state, summary: null, events: [] };
  }

  // Stale save OR backwards clock — drive the chunked stepper.
  const stepper = beginOfflineCatchUp(state, nowMs);
  const total = stepper.total;

  if (total === 0) {
    // Zero-chunk catch-up: summary suppressed (no modal), state from the
    // processor. Mirrors catchUpOnLoad's zero-chunk branch.
    onProgress?.(0, 0);
    const result = stepper.finish();
    return { state: result.state, summary: null, events: result.events };
  }

  onProgress?.(0, total);
  for (let i = 0; i < total; i++) {
    stepper.step();
    onProgress?.(i + 1, total);
    // Yield to the event loop between chunks so the main thread can paint +
    // stay responsive. This is the W34 fix: a 30-day absence (1800 chunks) on
    // the fallback path no longer blocks for the full duration.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  const result = stepper.finish();
  return { state: result.state, summary: result.summary, events: result.events };
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
