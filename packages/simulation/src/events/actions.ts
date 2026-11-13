/**
 * EventSystem action handlers (P10b — TDD §6.4 Event Scheduling, TDD line
 * 200 EventSystem; GDD §10 Environment, §148-152 influence over governments
 * + regulations, §404-408 monetary authority).
 *
 * Six player / admin actions live here, registered in the action dispatch
 * (`packages/simulation/src/actions/handlers.ts`) and dispatched by
 * `executeAction` via the `actionHandlers` map:
 *
 *   - `schedule-event`: queue a scheduled event. Delegates to the pure
 *     `scheduleEvent`. Emits `event-scheduled`.
 *   - `cancel-event`: remove a scheduled event by id. Delegates to the pure
 *     `cancelScheduledEvent` (idempotent no-op on a missing id).
 *   - `trigger-event`: immediately fire an event (testing / admin). Delegates
 *     to the pure `triggerEventImmediate`. Emits `event-triggered`.
 *   - `resolve-event`: manually resolve an active event early (player
 *     mitigates an ongoing crisis). Delegates to the pure
 *     `resolveActiveEvent`. Emits `event-resolved` (outcome `'mitigated'`).
 *   - `set-government-policy`: merge a partial `GovernmentPolicy` into
 *     `eventState.global.governmentPolicy` (shallow merge — `subsidies`
 *     replaced wholesale when supplied). Emits `government-policy-changed`
 *     carrying the resulting full policy.
 *   - `set-monetary-policy`: merge a partial `MonetaryPolicy` into
 *     `eventState.global.monetaryPolicy` (shallow merge). Emits
 *     `monetary-policy-changed` carrying the resulting full policy.
 *
 * All handlers are pure: they return a new state + events without mutating
 * the input (TDD §4.1, §18.4). Deterministic given (state, action) (TDD
 * §18.3). Each validates inputs (unknown event-type ids raise
 * `UnknownEventDefinitionError`; resolving an unknown active id raises
 * `UnknownActiveEventError`).
 *
 * `tick` (the action's sim second) is used as the emitted event's `at` for
 * determinism (TDD §18.3) — passed through to the pure helpers as `now`.
 */
import type {
  GameState,
  SimulationEvent,
  ScheduleEventAction,
  CancelEventAction,
  TriggerEventAction,
  ResolveEventAction,
  SetGovernmentPolicyAction,
  SetMonetaryPolicyAction,
  GovernmentPolicy,
  MonetaryPolicy,
} from '@capitalist-tree/shared';
import type { ActionListener } from '../actions/handlers.js';
import {
  scheduleEvent,
  cancelScheduledEvent,
  triggerEventImmediate,
  resolveActiveEvent,
} from './scheduler.js';

// ---------------------------------------------------------------------------
// schedule-event
// ---------------------------------------------------------------------------

/**
 * `schedule-event` action handler (P10b — TDD §6.4 — discrete scheduled
 * events use an event scheduler). Delegates to the pure `scheduleEvent`,
 * which resolves the event type via `getEventDefinitionById` (raising
 * `UnknownEventDefinitionError` on an unknown id), allocates a deterministic
 * id, appends the `ScheduledEventInstance`, and emits `event-scheduled`.
 */
export const scheduleEventHandler: ActionListener<ScheduleEventAction> = (state, action) => {
  const { eventTypeId, scheduledAt, payload, priority, tick } = action.payload;
  return scheduleEvent(state, eventTypeId, scheduledAt, payload, priority, tick);
};

// ---------------------------------------------------------------------------
// cancel-event
// ---------------------------------------------------------------------------

/**
 * `cancel-event` action handler (P10b — remove a scheduled event before it
 * fires). Delegates to the pure `cancelScheduledEvent` (idempotent no-op on a
 * missing id, mirroring P6b2's enable/disable-automation idempotency). Emits
 * NO event — the cancellation is reflected in the scheduler state.
 */
export const cancelEventHandler: ActionListener<CancelEventAction> = (state, action) => {
  return cancelScheduledEvent(state, action.payload.eventId);
};

// ---------------------------------------------------------------------------
// trigger-event
// ---------------------------------------------------------------------------

/**
 * `trigger-event` action handler (P10b — immediately fire an event for
 * testing / admin). Delegates to the pure `triggerEventImmediate`, which
 * resolves the event type, resolves severity (explicit `severity` wins; else
 * `'moderate'`), resolves duration (explicit `payload.duration` wins; else
 * the midpoint of the definition's `durationRange` — random rolling deferred,
 * R-P10-N), builds the `ActiveEvent`, applies its effects, and emits
 * `event-triggered`.
 *
 * The action's `regionId` + `severity` are merged into the event `payload` so
 * `applyEventEffects` can target the region + scale by the severity.
 */
export const triggerEventHandler: ActionListener<TriggerEventAction> = (state, action) => {
  const { eventTypeId, regionId, severity, payload, tick } = action.payload;
  const mergedPayload: Record<string, unknown> = { ...payload };
  if (regionId !== undefined) {
    mergedPayload['regionId'] = regionId;
  }
  if (severity !== undefined) {
    mergedPayload['severity'] = severity;
  }
  return triggerEventImmediate(state, eventTypeId, mergedPayload, tick);
};

// ---------------------------------------------------------------------------
// resolve-event
// ---------------------------------------------------------------------------

/**
 * `resolve-event` action handler (P10b — manually resolve an active event
 * early; GDD §10.3 recovery is possible but costly). Delegates to the pure
 * `resolveActiveEvent`, which finds the active event by id (raising
 * `UnknownActiveEventError` if not found), retires it to `history` with
 * `outcome: 'mitigated'`, and emits `event-resolved`.
 */
export const resolveEventHandler: ActionListener<ResolveEventAction> = (state, action) => {
  return resolveActiveEvent(state, action.payload.eventId, action.payload.tick);
};

// ---------------------------------------------------------------------------
// set-government-policy
// ---------------------------------------------------------------------------

/**
 * `set-government-policy` action handler (P10b — GDD §148-152 player
 * influence over governments + regulations; §6 monetary authority).
 *
 * Merges the partial `policy` into `eventState.global.governmentPolicy`
 * (shallow merge — only the supplied fields are overwritten; `subsidies` is
 * replaced wholesale when supplied). Emits `government-policy-changed`
 * carrying the resulting full policy. Pure.
 */
export const setGovernmentPolicyHandler: ActionListener<SetGovernmentPolicyAction> = (
  state,
  action,
) => {
  const { policy: partial, tick } = action.payload;
  const current = state.eventState.global.governmentPolicy;
  const merged: GovernmentPolicy = {
    environmentalRegulations:
      partial.environmentalRegulations ?? current.environmentalRegulations,
    carbonTaxRate: partial.carbonTaxRate ?? current.carbonTaxRate,
    subsidies: partial.subsidies ?? current.subsidies,
  };
  // Targeted clone (P10c perf — avoids a full structuredClone). Only the
  // eventState.global.governmentPolicy path is cloned; the rest is shared by
  // reference. Pure: the frozen input is never touched.
  const next: GameState = {
    ...state,
    eventState: {
      ...state.eventState,
      global: {
        ...state.eventState.global,
        governmentPolicy: merged,
      },
    },
  };
  const event: SimulationEvent = {
    type: 'government-policy-changed',
    at: tick,
    payload: { policy: merged },
  };
  return { state: next, events: [event] };
};

// ---------------------------------------------------------------------------
// set-monetary-policy
// ---------------------------------------------------------------------------

/**
 * `set-monetary-policy` action handler (P10b — GDD §404-408 monetary policy
 * tools).
 *
 * Merges the partial `policy` into `eventState.global.monetaryPolicy`
 * (shallow merge — only the supplied fields are overwritten). Emits
 * `monetary-policy-changed` carrying the resulting full policy. Pure.
 */
export const setMonetaryPolicyHandler: ActionListener<SetMonetaryPolicyAction> = (
  state,
  action,
) => {
  const { policy: partial, tick } = action.payload;
  const current = state.eventState.global.monetaryPolicy;
  const merged: MonetaryPolicy = {
    interestRate: partial.interestRate ?? current.interestRate,
    inflationTarget: partial.inflationTarget ?? current.inflationTarget,
    moneySupplyGrowth: partial.moneySupplyGrowth ?? current.moneySupplyGrowth,
  };
  // Targeted clone (P10c perf — avoids a full structuredClone). Only the
  // eventState.global.monetaryPolicy path is cloned; the rest is shared by
  // reference. Pure: the frozen input is never touched.
  const next: GameState = {
    ...state,
    eventState: {
      ...state.eventState,
      global: {
        ...state.eventState.global,
        monetaryPolicy: merged,
      },
    },
  };
  const event: SimulationEvent = {
    type: 'monetary-policy-changed',
    at: tick,
    payload: { policy: merged },
  };
  return { state: next, events: [event] };
};
