/**
 * GAP-31 (DR-13) — @capitalist-tree/analytics.
 *
 * Local-only, on-device analytics (see docs/reviews/GAP-31-analytics-design.md).
 * No external service / endpoint / account / third-party SDK. Events persist to
 * a dedicated IndexedDB store (browser) or an in-memory store (tests/SSR),
 * exposed through an observability panel (Phase 3).
 *
 * Architecture (design §4): the simulation engine never imports this package.
 * The collector subscribes to the existing SimulationEvent stream (bridged in
 * apps/web) + shapes events into the versioned `AnalyticsEvent` schema. This
 * keeps the sim pure (zero analytics coupling) + makes analytics a no-op in
 * unit tests (no collector attached).
 */
export {
  ANALYTICS_SCHEMA_VERSION,
  analyticsEventSchema,
  analyticsEventCategorySchema,
} from './schema.js';
export type {
  AnalyticsEvent,
  AnalyticsEventCategory,
  AnalyticsQuery,
} from './schema.js';
export { noopEmitter } from './emitter.js';
export type { AnalyticsEmitter } from './emitter.js';
export { InMemoryAnalyticsStore, DEFAULT_MAX_AGE_MS } from './store.js';
export type { AnalyticsStore } from './store.js';
export { createCollector, DEFAULT_RETENTION } from './collector.js';
export type { AnalyticsCollector, RetentionConfig } from './collector.js';
