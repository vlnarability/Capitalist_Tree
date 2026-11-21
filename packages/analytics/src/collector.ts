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
import { DEFAULT_MAX_AGE_MS } from './store.js';

export interface AnalyticsCollector extends AnalyticsEmitter {
  /** Update the collector's notion of the current in-sim time (ms). The
   *  bridging layer calls this each tick / state publish so subsequent emits
   *  stamp the right `simulationTime`. Out-of-sim events (pre-boot load
   *  failures) leave this at 0. */
  setSimTime(ms: number): void;
}

/** Retention policy for the collector. `maxEvents` is enforced by the store on
 *  each `put` (evicts oldest over cap). `maxAgeMs` is enforced by a periodic
 *  `store.prune(maxAgeMs)` call (design §7: "a maximum age ... oldest records
 *  are evicted first"). */
export interface RetentionConfig {
  /** Wall-clock ms — events older than this are pruned periodically. */
  maxAgeMs: number;
  /** Call `store.prune` every Nth flush (avoids pruning on every emit). */
  pruneEveryNFlushes: number;
}

export const DEFAULT_RETENTION: RetentionConfig = {
  maxAgeMs: DEFAULT_MAX_AGE_MS,
  // Prune roughly once a minute at the default flush cadence (a flush fires
  // per emit batch; high-signal events are rare enough that ~60 flushes ≈ 1min).
  pruneEveryNFlushes: 60,
};

/**
 * Build a collector that persists to `store`. `emit` is safe to call from the
 * sim's hot path — it never awaits, never throws.
 *
 * Concurrency: a flush is a single async drain loop guarded by `flushing`. New
 * emits during a flush append to `pending`; the drain loop keeps going until
 * `pending` is empty, so no event is lost + no flush overlaps.
 *
 * Retention: every `retention.pruneEveryNFlushes` flushes, the collector calls
 * `store.prune(retention.maxAgeMs)` to evict events older than `maxAgeMs`. The
 * store's `put` separately enforces the `maxEvents` cap. Both are best-effort +
 * swallowed on failure.
 */
export function createCollector(
  store: AnalyticsStore,
  retention: RetentionConfig = DEFAULT_RETENTION,
): AnalyticsCollector {
  let simTimeMs = 0;
  let seq = 0;
  let pending: AnalyticsEventShape[] = [];
  let flushing = false;
  let flushCount = 0;

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
        // Periodic max-age prune (design §7). Counted per completed flush so the
        // prune cadence tracks emit activity, not wall-clock (a long idle period
        // doesn't spuriously prune). Swallowed on failure.
        flushCount++;
        if (flushCount % retention.pruneEveryNFlushes === 0) {
          try {
            await store.prune(retention.maxAgeMs);
          } catch {
            // prune failure is non-fatal — the maxEvents cap still bounds growth
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
