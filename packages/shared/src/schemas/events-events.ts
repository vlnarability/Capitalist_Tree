import { z } from 'zod';
import {
  eventOutcomeSchema,
  eventSeveritySchema,
  governmentPolicySchema,
  monetaryPolicySchema,
  regionStateSchema,
} from './event-system.js';

/**
 * EventSystem-related SimulationEvent variants (P10a — TDD §6.4 Event
 * Scheduling, TDD line 200 EventSystem; GDD §10 Environment, §148-152
 * influence over governments/markets/regulations).
 *
 * Added to the `SimulationEvent` discriminated union via
 * `packages/shared/src/schemas/events.ts`. P10a introduces the *schema*
 * layer only; the EventSystem that emits these events lands in P10b.
 *
 * These events are the engine's *output* channel for EventSystem activity:
 * they tell the UI / audit layer what the EventSystem and the event action
 * handlers decided (event queued, fired, resolved, expired; policy changed;
 * regional condition shifted) without handing the rendering layer the
 * authority to run actions (rendering reads only — rule 8).
 *
 *   - `event-scheduled`: a `schedule-event` action (or the EventSystem) queued
 *     a scheduled event.
 *   - `event-triggered`: a scheduled event fired (or `trigger-event` forced
 *     one) — it is now active.
 *   - `event-resolved`: an active event concluded (resolved or mitigated).
 *   - `event-expired`: an active event's duration elapsed without mitigation.
 *   - `government-policy-changed`: government policy was updated (action or
 *     EventSystem cadence).
 *   - `monetary-policy-changed`: monetary policy was updated (action or
 *     EventSystem cadence).
 *   - `regional-condition-shifted`: a region's environmental condition
 *     shifted (an event effect or recovery moved a regional indicator past a
 *     threshold — GDD §10.3 feedback).
 *
 * HOW TO EXTEND: add a new variant with a unique `type` literal. Do NOT
 * loosen the union with a catch-all.
 */

/**
 * `event-scheduled` event — a scheduled event was queued (by `schedule-event`
 * or by the EventSystem seeding discrete scheduled events per TDD §6.4).
 *
 * Emitted by the `schedule-event` action handler (P10b) after it allocated an
 * id and appended the `ScheduledEventInstance` to the queue. Carries the
 * allocated id, the event type id, the fire tick, and the priority.
 */
export const eventScheduledEventSchema = z.object({
  type: z.literal('event-scheduled'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    /** Allocated scheduled-event id. */
    eventId: z.string().min(1),
    /** EventDefinition.id (the event type). */
    eventTypeId: z.string().min(1),
    /** Simulation tick at which the event will fire. */
    scheduledAt: z.number().int().nonnegative(),
    /** Firing priority. */
    priority: z.enum(['low', 'normal', 'high', 'critical']),
  }),
});
export type EventScheduledEvent = z.infer<typeof eventScheduledEventSchema>;

/**
 * `event-triggered` event — a scheduled event fired (or `trigger-event` forced
 * one) and is now active (TDD §6.4 — discrete scheduled events fire here).
 *
 * Emitted by the EventSystem (P10b) when a scheduled event's `scheduledAt`
 * arrives, or by the `trigger-event` action handler. Carries the event id,
 * type, the tick it became active, its duration, and its drawn severity.
 */
export const eventTriggeredEventSchema = z.object({
  type: z.literal('event-triggered'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    /** Active event id (matches the originating scheduled-event id). */
    eventId: z.string().min(1),
    /** EventDefinition.id (the event type). */
    eventTypeId: z.string().min(1),
    /** Tick at which the event became active. */
    startedAt: z.number().int().nonnegative(),
    /** Total duration in ticks the event will remain active. */
    duration: z.number().int().nonnegative(),
    /** Drawn severity band. */
    severity: eventSeveritySchema,
  }),
});
export type EventTriggeredEvent = z.infer<typeof eventTriggeredEventSchema>;

/**
 * `event-resolved` event — an active event concluded (resolved naturally or
 * mitigated early via `resolve-event`).
 *
 * Emitted by the EventSystem (P10b) when an active event's `remaining` hits 0
 * (outcome `'resolved'`) or by the `resolve-event` action handler (outcome
 * `'mitigated'`). Carries the event id, type, the tick it concluded, and the
 * outcome. (An event that runs its full duration without mitigation emits
 * `event-expired` instead when its outcome is `'expired'`.)
 */
export const eventResolvedEventSchema = z.object({
  type: z.literal('event-resolved'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    /** Event id (matches the originating active event id). */
    eventId: z.string().min(1),
    /** EventDefinition.id (the event type). */
    eventTypeId: z.string().min(1),
    /** Tick at which the event concluded. */
    resolvedAt: z.number().int().nonnegative(),
    /** How the event concluded. */
    outcome: eventOutcomeSchema,
  }),
});
export type EventResolvedEvent = z.infer<typeof eventResolvedEventSchema>;

/**
 * `event-expired` event — an active event's duration elapsed without
 * mitigation (GDD §10.3 — some damage lingers; recovery is costly).
 *
 * Emitted by the EventSystem (P10b) when an active event's `remaining` hits 0
 * with outcome `'expired'` (no mitigation applied). Carries the event id,
 * type, and the tick it expired.
 */
export const eventExpiredEventSchema = z.object({
  type: z.literal('event-expired'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    /** Event id (matches the originating active event id). */
    eventId: z.string().min(1),
    /** EventDefinition.id (the event type). */
    eventTypeId: z.string().min(1),
    /** Tick at which the event expired. */
    expiredAt: z.number().int().nonnegative(),
  }),
});
export type EventExpiredEvent = z.infer<typeof eventExpiredEventSchema>;

/**
 * `government-policy-changed` event — government policy was updated (by
 * `set-government-policy` action or by the EventSystem on its
 * `PROVISIONAL_GOVERNMENT_POLICY_INTERVAL_DAYS` cadence — GDD §148-152).
 *
 * Carries the resulting full `GovernmentPolicy` so the UI can render the new
 * regulatory posture without re-reading state.
 */
export const governmentPolicyChangedEventSchema = z.object({
  type: z.literal('government-policy-changed'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    /** The full resulting government policy. */
    policy: governmentPolicySchema,
  }),
});
export type GovernmentPolicyChangedEvent = z.infer<typeof governmentPolicyChangedEventSchema>;

/**
 * `monetary-policy-changed` event — monetary policy was updated (by
 * `set-monetary-policy` action or by the EventSystem on its
 * `PROVISIONAL_MONETARY_POLICY_INTERVAL_DAYS` cadence — GDD §404-408).
 *
 * Carries the resulting full `MonetaryPolicy` so the UI can render the new
 * central-bank posture without re-reading state.
 */
export const monetaryPolicyChangedEventSchema = z.object({
  type: z.literal('monetary-policy-changed'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    /** The full resulting monetary policy. */
    policy: monetaryPolicySchema,
  }),
});
export type MonetaryPolicyChangedEvent = z.infer<typeof monetaryPolicyChangedEventSchema>;

/**
 * `regional-condition-shifted` event — a region's environmental condition
 * shifted past a threshold (an event effect or recovery moved a regional
 * indicator — GDD §10.3 environmental feedback; §10.2 a collapsing local
 * ecosystem must be visible).
 *
 * Emitted by the EventSystem (P10b) when a regional indicator
 * (soilHealth / waterAvailability / biodiversity / forestCoverage /
 * industrialActivity / a pollution load) crosses a content-defined threshold.
 * Carries the region id, the indicator field path, the old + new values, and
 * a snapshot of the region state for the UI.
 */
export const regionalConditionShiftedEventSchema = z.object({
  type: z.literal('regional-condition-shifted'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    /** Region id whose condition shifted. */
    regionId: z.string().min(1),
    /** State field path that shifted (e.g. `waterAvailability`, `pollution.air`). */
    field: z.string().min(1),
    /** Value before the shift. */
    previousValue: z.number(),
    /** Value after the shift. */
    currentValue: z.number(),
    /** Snapshot of the region state after the shift (UI rendering — rule 8). */
    region: regionStateSchema,
  }),
});
export type RegionalConditionShiftedEvent = z.infer<typeof regionalConditionShiftedEventSchema>;
