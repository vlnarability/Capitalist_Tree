/**
 * EventSystem module — public surface (P10b — TDD §6.4 Event Scheduling, TDD
 * line 200 EventSystem; GDD §10 Environment and Climate, §148-152 influence
 * over regional/global markets/governments/regulations, §404-408 monetary
 * authority; TDD Milestone 9: Regional environments, Governments, Monetary
 * policy, Global markets, Climate feedback, Global objectives).
 *
 * All EventSystem logic lives here:
 *   - `errors.ts`:     typed errors thrown by the event action handlers
 *     (UnknownEventDefinitionError / UnknownActiveEventError /
 *     UnknownScheduledEventError). Runtime-only signals, NOT part of the
 *     saved GameState.
 *   - `scheduler.ts`:  the P0 `GameState.scheduler` priority-queue helpers
 *     (`schedule` / `due` / `cancel`) + the P10b EventSystem scheduler
 *     helpers (`scheduleEvent` / `cancelScheduledEvent` /
 *     `triggerEventImmediate` / `resolveActiveEvent` /
 *     `processScheduledEvents`) over `eventState.scheduler`.
 *   - `regional.ts`:   regional drift + global aggregation pure helpers
 *     (`seedDefaultRegions` / `evolveRegions` / `aggregateGlobalIndicators` /
 *     `minRegionalIndicators`).
 *   - `global.ts`:     event-effect application + government / monetary
 *     policy reaction helpers (`applyEventEffects` /
 *     `updateGovernmentPolicy` / `updateMonetaryPolicy` /
 *     `severityMultiplier`).
 *   - `actions.ts`:    the six EventSystem action handlers (schedule-event /
 *     cancel-event / trigger-event / resolve-event / set-government-policy /
 *     set-monetary-policy).
 *
 * The EventSystem (`packages/simulation/src/systems/events.ts`, slot #12 —
 * the LAST system) is the only system that touches `state.eventState` for
 * tick-driven updates; the pure functions take state + params and return new
 * state + events.
 *
 * Tests import these directly (`packages/simulation/test/events.test.ts`)
 * to assert the invariants the GDD and TDD require (TDD §18.1, §18.4).
 */
export * from './errors.js';
export {
  // P0 scheduler (GameState.scheduler) — preserved.
  schedule,
  due,
  cancel,
  // P10b EventSystem scheduler (eventState.scheduler).
  scheduleEvent,
  cancelScheduledEvent,
  triggerEventImmediate,
  resolveActiveEvent,
  processScheduledEvents,
} from './scheduler.js';
export {
  seedDefaultRegions,
  evolveRegions,
  aggregateGlobalIndicators,
  minRegionalIndicators,
  REGIONAL_DRIFT_CONSTANTS,
  DEFAULT_REGION_IDS,
  ECOSYSTEM_RESILIENCE_WEIGHTS,
  type RegionalMinima,
  type GlobalAggregatedIndicators,
} from './regional.js';
export {
  applyEventEffects,
  updateGovernmentPolicy,
  updateMonetaryPolicy,
  severityMultiplier,
  POLICY_CONSTANTS,
} from './global.js';
export {
  scheduleEventHandler,
  cancelEventHandler,
  triggerEventHandler,
  resolveEventHandler,
  setGovernmentPolicyHandler,
  setMonetaryPolicyHandler,
} from './actions.js';
