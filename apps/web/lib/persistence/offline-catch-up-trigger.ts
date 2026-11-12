/**
 * Catch-up-on-load trigger (P6d2 — TDD §14.4, GDD §4.2).
 *
 * The bridge between the save-load flow (`useSimulationLoop`'s boot effect +
 * `load()` callback) and the P6a offline catch-up processor
 * (`@capitalist-tree/simulation`'s `runOfflineCatchUp`). When a save is
 * loaded, the loop computes `nowMs = Date.now()` and asks this helper whether
 * the save is stale enough to warrant a "while you were away" catch-up.
 *
 * Two functions are exported:
 *
 *   - `catchUpOnLoad(state, nowMs)` — pure. Computes the elapsed real-ms
 *     since `state.metadata.lastSimulatedAt`; if it exceeds
 *     `PROVISIONAL_OFFLINE_PROMPT_THRESHOLD_MS`, calls `runOfflineCatchUp`
 *     and returns the new state + summary + events. Fresh saves (< threshold)
 *     return the input state unchanged with `summary: null` (no modal).
 *     Throws `OfflineClockTamperedError` if the processor detects a backwards
 *     clock — the caller routes it via `applyCatchUpOnLoad`.
 *
 *   - `applyCatchUpOnLoad(state, nowMs, store)` — the side-effect wrapper the
 *     loop calls. Catches `OfflineClockTamperedError` and routes it to the
 *     notification bridge (a "your clock changed" toast) via the shared
 *     `errorToNotification` mapper from `lib/dispatch-wrapper.ts`. On a
 *     tampered clock the original state is returned unchanged (the save is
 *     intact — only the catch-up was refused) with `summary: null`.
 *
 * Why split pure + side-effect? The pure core is unit-testable without a
 * store; the side-effect wrapper is the thin layer that owns the
 * notification. Mirrors the `dispatch` / `safeDispatch` split in
 * `lib/dispatch-wrapper.ts`.
 *
 * Rule 6 (rendering / UI reads state, never writes): the trigger never
 * mutates `simState` directly — `runOfflineCatchUp` returns a fresh state
 * (P6a purity contract) and the loop publishes it via `commitSimState`.
 * Rule 2 (purity): `catchUpOnLoad` is a pure function of (state, nowMs);
 * `applyCatchUpOnLoad`'s only side effect is the notification push.
 */
import { runOfflineCatchUp } from '@capitalist-tree/simulation';
import type { GameState, OfflineSummary, SimulationEvent } from '@capitalist-tree/shared';
import { OfflineClockTamperedError } from '@capitalist-tree/shared';
import { PROVISIONAL_OFFLINE_PROMPT_THRESHOLD_MS } from '../constants';
import { errorToNotification } from '../dispatch-wrapper';
import type { UiNotification } from '../../stores/game-store';

// ----------------------------------------------------------------------------
// Public types.
// ----------------------------------------------------------------------------

/**
 * Result of {@link catchUpOnLoad} / {@link applyCatchUpOnLoad}.
 *
 *   - `state` — the post-catch-up state (a fresh reference when a catch-up
 *     ran; the input reference when no catch-up was needed / the clock was
 *     tampered). The loop publishes this via `commitSimState`.
 *   - `summary` — the `OfflineSummary` produced by the catch-up, or `null`
 *     when no modal should render (fresh save, zero-chunk catch-up, or a
 *     tampered clock). The loop parks a non-null summary on the UI slice via
 *     `setPendingOfflineSummary` so the OfflineModal renders.
 *   - `events` — the catch-up event stream (bookend events + chunk events).
 *     Empty when no catch-up ran. The loop can append these to the
 *     recent-event log alongside the `commitSimState` call.
 */
export interface CatchUpOnLoadResult {
  readonly state: GameState;
  readonly summary: OfflineSummary | null;
  readonly events: readonly SimulationEvent[];
}

/**
 * Narrow store-like interface {@link applyCatchUpOnLoad} needs. Mirrors
 * `DispatchWrapperStore` from `lib/dispatch-wrapper.ts` — narrowed so the
 * trigger is testable without dragging in the full Zustand store. Tests pass
 * a stub object implementing just `simState` + `pushNotification`.
 */
export interface CatchUpOnLoadStore {
  /** The current simState (read for the notification `at` field). */
  readonly simState: GameState | null;
  /** The store's notification mutator (UI slice only — rule 6). */
  pushNotification: (n: Omit<UiNotification, 'id' | 'createdAtMs'>) => unknown;
}

// ----------------------------------------------------------------------------
// Pure core.
// ----------------------------------------------------------------------------

/**
 * Run the offline catch-up for a save loaded at real time `nowMs`, IF the
 * save is stale (elapsed real-ms > `PROVISIONAL_OFFLINE_PROMPT_THRESHOLD_MS`).
 *
 * Pure + total modulo the `OfflineClockTamperedError` throw (a tampered clock
 * is an exceptional condition the caller routes via {@link applyCatchUpOnLoad}).
 *
 * Decision tree:
 *   - `0 ≤ elapsed ≤ threshold` → fresh save; return the input state unchanged
 *     with `summary: null` + no events. The live rAF loop just resumes.
 *   - `elapsed < 0` (backwards clock) OR `elapsed > threshold` → call
 *     `runOfflineCatchUp(state, nowMs)`. The backwards-clock case is NOT
 *     short-circuited here because the processor owns the tolerance check: a
 *     small backwards jitter within
 *     `PROVISIONAL_OFFLINE_BACKWARDS_CLOCK_TOLERANCE_MS` is treated as zero
 *     elapsed (0 chunks, fresh state returned by the processor), while a
 *     larger jump throws `OfflineClockTamperedError` (which the caller
 *     routes). Short-circuiting on `elapsed < 0` would silently swallow a
 *     tampered clock as "fresh" — that defeats the safeguard (TDD §14.4).
 *     - `summary.chunksRun > 0` → return `{ state, summary, events }`. The
 *       loop parks the summary on the UI slice → OfflineModal renders.
 *     - `summary.chunksRun === 0` → the elapsed interval crossed the
 *       threshold but rounded down to 0 sim chunks (e.g. 90 real seconds →
 *       5_400 sim sec → 0 chunks at the 86_400-sim-s chunk size), OR the
 *       backwards clock was within tolerance (treated as zero elapsed).
 *       Return the processor's fresh state with `summary: null` — no modal
 *       for a zero-chunk catch-up, but the state's `lastSimulatedAt` is
 *       advanced (P6a step 10) so the next load doesn't re-evaluate the
 *       same gap.
 *   - Backwards clock beyond tolerance → `runOfflineCatchUp` throws
 *     `OfflineClockTamperedError`; this function does NOT catch — re-throws
 *     so {@link applyCatchUpOnLoad} can route it.
 *
 * Purity (rule 2): the input state is never mutated — `runOfflineCatchUp`
 * deep-copies on entry (P6a). When no catch-up runs (fresh save), the input
 * reference is returned as-is (the caller publishes it; no fresh copy is
 * needed because nothing changed).
 */
export function catchUpOnLoad(state: GameState, nowMs: number): CatchUpOnLoadResult {
  const lastSimulatedAt = state.metadata.lastSimulatedAt;
  const elapsed = nowMs - lastSimulatedAt;

  // Fresh save — non-negative elapsed within the prompt threshold. A
  // NEGATIVE elapsed (backwards clock) is deliberately NOT caught here: it
  // falls through to runOfflineCatchUp, which applies the tolerance check
  // and throws OfflineClockTamperedError on a real tamper (TDD §14.4).
  if (elapsed >= 0 && elapsed <= PROVISIONAL_OFFLINE_PROMPT_THRESHOLD_MS) {
    return { state, summary: null, events: [] };
  }

  // Stale save OR backwards clock — delegate to the P6a processor. Throws
  // OfflineClockTamperedError on a backwards clock beyond tolerance; the
  // caller (applyCatchUpOnLoad) routes it.
  const result = runOfflineCatchUp(state, nowMs);

  // Zero-chunk catch-up (elapsed crossed the threshold but rounded to 0 sim
  // chunks, or a within-tolerance backwards clock treated as zero elapsed).
  // The state's lastSimulatedAt was still advanced by the processor
  // (P6a step 10) so the next load won't re-evaluate the same gap; we just
  // suppress the modal by reporting summary: null.
  if (result.summary.chunksRun === 0) {
    return { state: result.state, summary: null, events: result.events };
  }

  return {
    state: result.state,
    summary: result.summary,
    events: result.events,
  };
}

// ----------------------------------------------------------------------------
// Side-effect wrapper (notification routing).
// ----------------------------------------------------------------------------

/**
 * Run {@link catchUpOnLoad} and route any `OfflineClockTamperedError` to the
 * notification bridge via the shared `errorToNotification` mapper from
 * `lib/dispatch-wrapper.ts`.
 *
 * On a tampered clock:
 *   1. Read `store.simState?.clock.elapsedSeconds` (the `at` field for the
 *      notification). Defaults to 0 if the store hasn't booted.
 *   2. Map the error to a notification payload. The mapping always succeeds
 *      for `OfflineClockTamperedError` (the dispatch-wrapper knows the class).
 *   3. `store.pushNotification(payload)` — surfaces the "your clock changed"
 *      toast (GDD §13.5).
 *   4. Return the ORIGINAL state unchanged with `summary: null` + no events.
 *      The save is intact — only the catch-up was refused. The player can
 *      keep playing from the loaded save (or surface a "load anyway?" dialog
 *      in a future revision).
 *
 * On success: returns {@link catchUpOnLoad}'s result verbatim.
 *
 * Rule 6: the only mutation is `pushNotification` (a UI-slice mutator);
 * `simState` is referentially unchanged on the tampered-clock path.
 */
export function applyCatchUpOnLoad(
  state: GameState,
  nowMs: number,
  store: CatchUpOnLoadStore,
): CatchUpOnLoadResult {
  try {
    return catchUpOnLoad(state, nowMs);
  } catch (err) {
    if (!(err instanceof OfflineClockTamperedError)) {
      // Unknown error — re-throw so it surfaces as an unhandled rejection.
      // Matches `safeDispatch`'s contract: the wrapper does NOT swallow
      // unexpected errors.
      throw err;
    }
    const at = store.simState?.clock.elapsedSeconds ?? 0;
    const payload = errorToNotification(err, at);
    // The mapper knows OfflineClockTamperedError, so payload is non-null in
    // practice. Defensive: if a future refactor drops the case, surface a
    // generic notice rather than silently swallowing the tamper signal.
    if (payload !== null) {
      store.pushNotification(payload);
    }
    return { state, summary: null, events: [] };
  }
}
