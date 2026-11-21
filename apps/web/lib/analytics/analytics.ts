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
 *
 * Phase 3: a read-only query API (`queryAnalyticsEvents`, `countAnalyticsByCategory`,
 * `clearAnalytics`, `exportAnalyticsJson`) backs the observability panel (design §5).
 * The panel reads the store through these; it never touches `simState` (rule 6).
 */
import {
  createCollector,
  type AnalyticsCollector,
  type AnalyticsEvent,
  type AnalyticsEventCategory,
  type AnalyticsQuery,
  type AnalyticsStore,
} from '@capitalist-tree/analytics';
import type { GameState, SimulationEvent } from '@capitalist-tree/shared';
import { mapSimulationEventToAnalytics } from './bridge.js';
import { extractSimSummary, isSimSummaryDue } from './sim-summary.js';

let collector: AnalyticsCollector | null = null;
// The backing store, retained so the observability panel (Phase 3) can query /
// clear / export without reaching into the collector's closure.
let analyticsStore: AnalyticsStore | null = null;

/**
 * Create + install the collector backed by `store`. Called once at boot (in the
 * browser). Returns the collector so the caller can hold a ref if needed.
 * Re-init also resets the sim-summary cadence (a fresh collector = a fresh
 * cadence baseline), which keeps unit tests isolated.
 */
export function initAnalytics(store: AnalyticsStore): AnalyticsCollector {
  collector = createCollector(store);
  analyticsStore = store;
  lastSimSummarySeconds = null;
  return collector;
}

/** Tear down the collector + reset the sim-summary cadence. For unit tests +
 *  StrictMode double-mount hygiene: ensures no state leaks between tests. */
export function resetAnalytics(): void {
  collector = null;
  analyticsStore = null;
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

// ─── Phase 3: read-only query API for the observability panel (design §5) ────
//
// The panel reads the store through these. Every function is a no-op (returns
// empty / zero / null) when no store is installed, + never throws — a storage
// failure degrades only the panel, not the sim.

/** The backing store (null in SSR / before boot / unit tests). Exposed so the
 *  panel can call `prune` / `count` directly when needed. */
export function getAnalyticsStore(): AnalyticsStore | null {
  return analyticsStore;
}

/** Query events, most-recent first. Returns `[]` if no store or on failure. */
export async function queryAnalyticsEvents(
  q?: AnalyticsQuery,
): Promise<AnalyticsEvent[]> {
  if (!analyticsStore) return [];
  try {
    return await analyticsStore.query(q);
  } catch {
    return [];
  }
}

/** Count events per category. Returns zeros if no store. */
export async function countAnalyticsByCategory(): Promise<
  Record<AnalyticsEventCategory, number>
> {
  const zero = { gameplay: 0, simulation: 0, performance: 0, error: 0 } as Record<
    AnalyticsEventCategory,
    number
  >;
  if (!analyticsStore) return zero;
  const safe = async (c: AnalyticsEventCategory): Promise<number> => {
    try {
      return await analyticsStore!.count(c);
    } catch {
      return 0;
    }
  };
  const [gameplay, simulation, performance, error] = await Promise.all([
    safe('gameplay'),
    safe('simulation'),
    safe('performance'),
    safe('error'),
  ]);
  return { gameplay, simulation, performance, error };
}

/** Wipe all analytics records (design §7: "never touches the save blob"). */
export async function clearAnalytics(): Promise<void> {
  if (!analyticsStore) return;
  try {
    await analyticsStore.clear();
  } catch {
    // swallow — clearing is best-effort
  }
}

/**
 * Export the full diagnostics dump as a pretty-printed JSON string (design §5:
 * "Export diagnostics as JSON — a full dump for bug reports / balancing review").
 * Includes a header with the export timestamp + count, then every event. Returns
 * `'[]'` if no store or on failure.
 */
export async function exportAnalyticsJson(): Promise<string> {
  if (!analyticsStore) return '[]';
  try {
    const events = await analyticsStore.query(); // no limit → all events
    const dump = {
      exportedAt: new Date().toISOString(),
      count: events.length,
      events,
    };
    return JSON.stringify(dump, null, 2);
  } catch {
    return '[]';
  }
}
