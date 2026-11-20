/**
 * GAP-31 (DR-13) — Analytics emitter interface.
 *
 * A thin, sync, fire-and-forget emitter. The collector implements this
 * interface; the simulation/UI calls `emit(name, category, data?)` at
 * high-signal points. `emit` MUST NOT throw — a collector failure (quota
 * exhausted, IndexedDB unavailable, invalid shape) is swallowed so the caller
 * (the sim) continues regardless.
 *
 * If no collector is attached (e.g. unit tests), use `noopEmitter` — calls are
 * discarded. This keeps the sim pure in tests: zero analytics side effects.
 */
import type { AnalyticsEventCategory } from './schema.js';

export interface AnalyticsEmitter {
  /**
   * Record an analytics event. Fire-and-forget: returns immediately, never
   * throws, never awaits persistence.
   *
   * @param event    stable event name, e.g. `'tree-died'`, `'objective-completed'`.
   * @param category one of gameplay / simulation / performance / error.
   * @param data     optional structured payload (cause, objective id, …).
   */
  emit(
    event: string,
    category: AnalyticsEventCategory,
    data?: Record<string, unknown>,
  ): void;
}

/** A no-op emitter for environments without a collector (unit tests, SSR). */
export const noopEmitter: AnalyticsEmitter = {
  emit() {
    /* analytics is a no-op until a collector is attached */
  },
};
