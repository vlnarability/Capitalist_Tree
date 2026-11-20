/**
 * GAP-31 (DR-13) — Analytics collector.
 *
 * The collector is the bridge between high-signal call sites (the sim's
 * SimulationEvent stream, bridged in apps/web) + the persisted store. It:
 *   - shapes each `emit(name, category, data?)` into a versioned `AnalyticsEvent`,
 *   - validates the shape (zod) — invalid events are dropped, not thrown,
 *   - buffers + flushes to the store asynchronously (fire-and-forget),
 *   - swallows ALL store failures so the caller (the sim) is never affected.
 *
 * Design §4: "the sim never awaits the collector" + "a full IndexedDB failure
 * degrades only analytics, not the sim." The collector enforces that contract:
 * `emit` is sync, returns `void`, + every async persistence path is wrapped in
 * try/catch that discards the error.
 */
import { analyticsEventSchema, ANALYTICS_SCHEMA_VERSION } from './schema.js';
import type { AnalyticsEventCategory } from './schema.js';
import type { AnalyticsEmitter } from './emitter.js';
import type { AnalyticsStore } from './store.js';

export interface AnalyticsCollector extends AnalyticsEmitter {
  /** Update the collector's notion of the current in-sim time (ms). The
   *  bridging layer calls this each tick / state publish so subsequent emits
   *  stamp the right `simulationTime`. Out-of-sim events (pre-boot load
   *  failures) leave this at 0. */
  setSimTime(ms: number): void;
}

/**
 * Build a collector that persists to `store`. `emit` is safe to call from the
 * sim's hot path — it never awaits, never throws.
 *
 * Concurrency: a flush is a single async drain loop guarded by `flushing`. New
 * emits during a flush append to `pending`; the drain loop keeps going until
 * `pending` is empty, so no event is lost + no flush overlaps.
 */
export function createCollector(store: AnalyticsStore): AnalyticsCollector {
  let simTimeMs = 0;
  let seq = 0;
  let pending: AnalyticsEventShape[] = [];
  let flushing = false;

  type AnalyticsEventShape = ReturnType<typeof analyticsEventSchema.parse>;

  function flush(): void {
    if (flushing) return;
    flushing = true;
    void (async () => {
      try {
        while (pending.length > 0) {
          const batch = pending;
          pending = [];
          for (const ev of batch) {
            try {
              await store.put(ev);
            } catch {
              // per-event store failure — drop + continue (design §4: analytics
              // failure must not break the sim)
            }
          }
        }
      } catch {
        // belt-and-suspenders: any unexpected error in the drain loop is swallowed
      } finally {
        flushing = false;
      }
    })();
  }

  return {
    setSimTime(ms: number): void {
      simTimeMs = ms;
    },
    emit(
      event: string,
      category: AnalyticsEventCategory,
      data?: Record<string, unknown>,
    ): void {
      try {
        // `exactOptionalPropertyTypes` is on — only include `data` when provided.
        const raw: Record<string, unknown> = {
          id: `a-${Date.now().toString(36)}-${(seq++).toString(36)}`,
          schemaVersion: ANALYTICS_SCHEMA_VERSION,
          timestamp: Date.now(),
          simulationTime: simTimeMs,
          category,
          event,
        };
        if (data !== undefined) raw.data = data;
        const parsed = analyticsEventSchema.safeParse(raw);
        if (!parsed.success) return; // drop invalid — never throw
        pending.push(parsed.data);
        flush();
      } catch {
        // never throw from emit — the caller (sim) must not be affected
      }
    },
  };
}
