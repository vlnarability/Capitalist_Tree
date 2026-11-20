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
import type { SimulationEvent } from '@capitalist-tree/shared';
import { mapSimulationEventToAnalytics } from './bridge.js';

let collector: AnalyticsCollector | null = null;

/**
 * Create + install the collector backed by `store`. Called once at boot (in the
 * browser). Returns the collector so the caller can hold a ref if needed.
 */
export function initAnalytics(store: AnalyticsStore): AnalyticsCollector {
  collector = createCollector(store);
  return collector;
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
