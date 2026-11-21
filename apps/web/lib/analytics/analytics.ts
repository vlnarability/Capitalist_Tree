/**
 * GAP-31 (DR-13) — Analytics collector singleton (apps/web).
 *
 * A module-level collector that the game store + the boot hook share. Before
 * `initAnalytics` is called (SSR, unit tests, or before the boot effect runs),
 * the collector is `null` + every `recordSimEvents` / `recordAnalyticsEvent` /
 * `setAnalyticsSimTime` call is a no-op — the sim is unaffected (design §4:
 * "the emitter is a no-op if no collector is attached").
 *
 * The boot hook (`useSimulationLoop`) calls `initAnalytics(createBrowserAnalyticsStore())`
 * once on mount in the browser. The game store calls `recordSimEvents` +
 * `setAnalyticsSimTime` in `dispatch` / `commitSimState` (the two event-entry
 * points). Out-of-sim events (save-loaded, load errors) call `recordAnalyticsEvent`
 * directly.
 */
import {
  createCollector,
  type AnalyticsCollector,
  type AnalyticsEventCategory,
  type AnalyticsStore,
} from '@capitalist-tree/analytics';
import type { GameState, SimulationEvent } from '@capitalist-tree/shared';
import { mapSimulationEventToAnalytics } from './bridge.js';
import { extractSimSummary, isSimSummaryDue } from './sim-summary.js';

let collector: AnalyticsCollector | null = null;

/**
 * Create + install the collector backed by `store`. Called once at boot (in the
 * browser). Returns the collector so the caller can hold a ref if needed.
 * Re-init also resets the sim-summary cadence (a fresh collector = a fresh
 * cadence baseline), which keeps unit tests isolated.
 */
export function initAnalytics(store: AnalyticsStore): AnalyticsCollector {
  collector = createCollector(store);
  lastSimSummarySeconds = null;
  return collector;
}

/** Tear down the collector + reset the sim-summary cadence. For unit tests +
 *  StrictMode double-mount hygiene: ensures no state leaks between tests. */
export function resetAnalytics(): void {
  collector = null;
  lastSimSummarySeconds = null;
}

/** Whether a collector is installed (false in SSR / before boot / unit tests). */
export function isAnalyticsInitialized(): boolean {
  return collector !== null;
}

/**
 * Update the collector's notion of the current in-sim time (ms). The store
 * calls this on each `dispatch` / `commitSimState` so subsequent emits stamp the
 * right `simulationTime`. No-op if no collector is installed.
 */
export function setAnalyticsSimTime(elapsedSeconds: number): void {
  collector?.setSimTime(elapsedSeconds * 1000);
}

/**
 * Bridge a batch of SimulationEvents to analytics emits. Iterates
 * `mapSimulationEventToAnalytics` + emits each. No-op if no collector is
 * installed or the batch is empty. Never throws.
 */
export function recordSimEvents(events: readonly SimulationEvent[]): void {
  if (!collector || events.length === 0) return;
  for (const ev of events) {
    for (const a of mapSimulationEventToAnalytics(ev)) {
      try {
        collector.emit(a.event, a.category, a.data);
      } catch {
        // never let an analytics failure propagate to the sim
      }
    }
  }
}

/**
 * Record a single out-of-sim analytics event (e.g. `save-loaded`, `load-failed`,
 * an ErrorBoundary event). No-op if no collector is installed. Never throws.
 */
export function recordAnalyticsEvent(
  event: string,
  category: AnalyticsEventCategory,
  data?: Record<string, unknown>,
): void {
  try {
    collector?.emit(event, category, data);
  } catch {
    // swallow
  }
}

// ─── Phase 2: periodic sim-state aggregation (design §3) ────────────────────
//
// One sim-summary per sim-day (86_400 sim-seconds). The first commit SEEDS the
// cadence (no emit) so the boot/initial state isn't recorded as a "summary"; a
// backward clock (newGame / load) re-seeds. The store calls this from
// `commitSimState` after each engine snapshot.
let lastSimSummarySeconds: number | null = null;

/**
 * Emit a sim-summary if a sim-day has elapsed since the last summary. No-op if
 * no collector is installed. Never throws. Returns true if a summary was emitted
 * (useful for tests).
 */
export function recordSimSummaryIfDue(state: GameState): boolean {
  if (!collector) return false;
  const elapsed = state.clock.elapsedSeconds;
  if (!isSimSummaryDue(elapsed, lastSimSummarySeconds)) {
    // Seed / re-seed on the first commit or a clock reset (no emit).
    if (lastSimSummarySeconds === null || elapsed < lastSimSummarySeconds) {
      lastSimSummarySeconds = elapsed;
    }
    return false;
  }
  // Stamp the collector's sim-time so the event's simulationTime is correct.
  // The store also calls setAnalyticsSimTime, but this makes recordSimSummaryIfDue
  // self-contained for direct callers / tests.
  setAnalyticsSimTime(elapsed);
  recordAnalyticsEvent('sim-summary', 'simulation', extractSimSummary(state));
  lastSimSummarySeconds = elapsed;
  return true;
}
