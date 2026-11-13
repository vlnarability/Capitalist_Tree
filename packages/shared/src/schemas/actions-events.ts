import { z } from 'zod';
import {
  eventPrioritySchema,
  eventSeveritySchema,
  governmentPolicySchema,
  monetaryPolicySchema,
} from './event-system.js';

/**
 * EventSystem-related GameAction variants (P10a — TDD §6.4 Event Scheduling,
 * TDD line 200 EventSystem; GDD §10 Environment, §148-152 influence over
 * governments/markets/regulations, §404-408 monetary authority).
 *
 * Added to the `GameAction` discriminated union via
 * `packages/shared/src/schemas/actions.ts`. P10a introduces the *schema*
 * layer only; the action handlers + EventSystem land in P10b. The variants:
 *
 *   - `schedule-event`: queue a scheduled event (a content EventDefinition id
 *     + a fire tick + optional payload/priority). Used by the engine/scheduler
 *     to seed discrete scheduled events (TDD §6.4: seasonal transitions,
 *     scheduled bills, loan payments, equipment maintenance, market reviews,
 *     scheduled harvesting) and by admin/testing to inject events.
 *   - `cancel-event`: remove a scheduled event by id (before it fires).
 *   - `trigger-event`: immediately trigger an event (for testing/admin —
 *     bypasses the scheduler's `scheduledAt` gate).
 *   - `resolve-event`: manually resolve an active event (player mitigates an
 *     ongoing crisis early — GDD §10.3 recovery is possible but costly).
 *   - `set-government-policy`: adjust environmental regulations / carbon tax /
 *     subsidies (GDD §148-152 — player influence over governments).
 *   - `set-monetary-policy`: adjust the central-bank interest rate / inflation
 *     target / money-supply growth (GDD §404-408 monetary policy tools).
 *
 * HOW TO EXTEND: add a new variant with a unique `type` literal. Register a
 * handler in `packages/simulation/src/actions/handlers.ts`. Keep actions pure
 * — never mutate input state. Reject unknown action types with
 * `UnknownActionError` (handled centrally by `executeAction`).
 *
 * Re-exported from `packages/shared/src/schemas/actions.ts` so consumers can
 * `import { ScheduleEventAction } from '@capitalist-tree/shared'`.
 */

/**
 * `schedule-event` action — queue a scheduled event (TDD §6.4 — discrete
 * scheduled events use an event scheduler).
 *
 * The handler (P10b):
 *   1. Resolves the event type by `eventTypeId` via `getEventDefinitionById`
 *      (content gate — unknown id raises `UnknownEventDefinitionError`).
 *   2. Allocates a deterministic id from `eventState.scheduler.nextEventId`
 *      and increments the counter.
 *   3. Appends a `ScheduledEventInstance` (`{id, type, scheduledAt, payload,
 *      resolved:false, resolvedAt:0, priority}`) to
 *      `eventState.scheduler.scheduled`.
 *   4. Emits an `event-scheduled` event carrying the allocated id + fire tick.
 *
 * `payload` carries the drawn severity band / target region id / magnitude
 * (optional — the EventSystem can roll these at fire time if omitted).
 * `priority` defaults to `'normal'`. `tick` is the simulation second used for
 * the emitted `event-scheduled` event's `at` (determinism — TDD §18.3).
 */
export const scheduleEventActionSchema = z.object({
  type: z.literal('schedule-event'),
  payload: z.object({
    /** EventDefinition.id from `packages/content/src/events/` (the event type). */
    eventTypeId: z.string().min(1),
    /** Simulation tick at which the event fires. */
    scheduledAt: z.number().int().nonnegative(),
    /** Drawn event parameters (severity, region, magnitude). Optional. */
    payload: z.record(z.string(), z.unknown()).default({}),
    /** Firing priority when several events are due in the same check. */
    priority: eventPrioritySchema.default('normal'),
    /** Simulation second at which the action runs (deterministic event `at`). */
    tick: z.number().int().nonnegative(),
  }),
});
export type ScheduleEventAction = z.infer<typeof scheduleEventActionSchema>;

/**
 * `cancel-event` action — remove a scheduled event by id (before it fires).
 *
 * The handler (P10b) removes the matching `ScheduledEventInstance` from
 * `eventState.scheduler.scheduled` (idempotent — a missing id is a no-op,
 * mirroring P6b2's enable/disable-automation idempotency) and emits an
 * `event-scheduled` cancellation (the EventSystem does NOT emit a separate
 * cancel event variant; the cancellation is reflected in the next
 * `event-scheduled`/scheduler state). `tick` is the action's sim second.
 */
export const cancelEventActionSchema = z.object({
  type: z.literal('cancel-event'),
  payload: z.object({
    /** ScheduledEventInstance.id to remove from the queue. */
    eventId: z.string().min(1),
    /** Simulation second at which the action runs (deterministic event `at`). */
    tick: z.number().int().nonnegative(),
  }),
});
export type CancelEventAction = z.infer<typeof cancelEventActionSchema>;

/**
 * `trigger-event` action — immediately trigger an event (testing/admin).
 *
 * Bypasses the scheduler's `scheduledAt` gate: the handler (P10b) resolves the
 * event type, rolls severity/duration from the definition, and immediately
 * moves the event into `eventState.scheduler.active` (startedAt = tick). Used
 * by tests + the admin console to force an event without waiting for its
 * scheduled tick. Emits an `event-triggered` event.
 *
 * `severity` is optional — the handler rolls within the definition's
 * `severityRange` when omitted (determinism — TDD §18.3: explicit only when
 * overriding). `regionId` targets a specific region; omit for a global event.
 */
export const triggerEventActionSchema = z.object({
  type: z.literal('trigger-event'),
  payload: z.object({
    /** EventDefinition.id (the event type to trigger). */
    eventTypeId: z.string().min(1),
    /** Target region id (omit for a global event). */
    regionId: z.string().min(1).optional(),
    /** Severity band (defaults to a roll within the definition's severityRange). */
    severity: eventSeveritySchema.optional(),
    /** Drawn event parameters (magnitude, etc.). Optional. */
    payload: z.record(z.string(), z.unknown()).default({}),
    /** Simulation second at which the action runs (deterministic event `at`). */
    tick: z.number().int().nonnegative(),
  }),
});
export type TriggerEventAction = z.infer<typeof triggerEventActionSchema>;

/**
 * `resolve-event` action — manually resolve an active event (player mitigates
 * an ongoing crisis early — GDD §10.3 recovery is possible but costly).
 *
 * The handler (P10b) finds the active event by id, applies any final
 * mitigation effect (reduced magnitude vs. letting it run), retires it to
 * `eventState.scheduler.history` with `outcome: 'mitigated'`, and emits an
 * `event-resolved` event. `tick` is the action's sim second.
 */
export const resolveEventActionSchema = z.object({
  type: z.literal('resolve-event'),
  payload: z.object({
    /** ActiveEvent.id to resolve early. */
    eventId: z.string().min(1),
    /** Simulation second at which the action runs (deterministic event `at`). */
    tick: z.number().int().nonnegative(),
  }),
});
export type ResolveEventAction = z.infer<typeof resolveEventActionSchema>;

/**
 * `set-government-policy` action — adjust environmental regulations / carbon
 * tax / subsidies (GDD §148-152 — player influence over governments +
 * regulations; GDD §6 monetary authority).
 *
 * The handler (P10b) merges `policy` into `eventState.global.governmentPolicy`
 * (shallow merge — only the supplied fields are overwritten; `subsidies` is
 * replaced wholesale when supplied) and emits a `government-policy-changed`
 * event carrying the resulting full policy. `tick` is the action's sim second.
 *
 * `policy` is a partial `GovernmentPolicy` — supply only the fields to change.
 */
export const setGovernmentPolicyActionSchema = z.object({
  type: z.literal('set-government-policy'),
  payload: z.object({
    /** Partial government policy to merge into `eventState.global.governmentPolicy`. */
    policy: governmentPolicySchema.partial(),
    /** Simulation second at which the action runs (deterministic event `at`). */
    tick: z.number().int().nonnegative(),
  }),
});
export type SetGovernmentPolicyAction = z.infer<typeof setGovernmentPolicyActionSchema>;

/**
 * `set-monetary-policy` action — adjust the central-bank interest rate /
 * inflation target / money-supply growth (GDD §404-408 monetary policy tools).
 *
 * The handler (P10b) merges `policy` into `eventState.global.monetaryPolicy`
 * (shallow merge — only the supplied fields are overwritten) and emits a
 * `monetary-policy-changed` event carrying the resulting full policy. `tick`
 * is the action's sim second.
 *
 * `policy` is a partial `MonetaryPolicy` — supply only the fields to change.
 */
export const setMonetaryPolicyActionSchema = z.object({
  type: z.literal('set-monetary-policy'),
  payload: z.object({
    /** Partial monetary policy to merge into `eventState.global.monetaryPolicy`. */
    policy: monetaryPolicySchema.partial(),
    /** Simulation second at which the action runs (deterministic event `at`). */
    tick: z.number().int().nonnegative(),
  }),
});
export type SetMonetaryPolicyAction = z.infer<typeof setMonetaryPolicyActionSchema>;
