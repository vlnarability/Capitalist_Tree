/**
 * Typed errors for the EventSystem module (P10b — TDD §6.4 Event Scheduling,
 * TDD line 200 EventSystem; GDD §10 Environment and Climate, §148-152
 * influence over regional/global markets/governments/regulations, §404-408
 * monetary authority).
 *
 * Each error is a real `class` so callers can use `instanceof` for routing
 * (e.g. the UI surfaces "unknown event definition" as a toast without
 * crashing the engine). The EventSystem itself never throws for graceful
 * failure conditions — it converts them into events where applicable (a
 * scheduled event whose `scheduledAt` never arrives simply stays queued).
 * These errors are for *programmer* mistakes or player-action rejections: a
 * `schedule-event` / `trigger-event` action referencing an event-type id that
 * does not exist in content, or a `resolve-event` / `cancel-event` action
 * targeting an id that is neither scheduled nor active.
 *
 * The errors are NOT part of the saved GameState — they are runtime-only
 * signals, mirroring the progression module's `progression/errors.ts` + the
 * business module's `business/errors.ts` + the automation module's
 * `automation/errors.ts` pattern. They live here (not in
 * `@capitalist-tree/shared`) because P10a froze the shared error surface
 * (`packages/shared/` is read-only per the P10b task contract); P10b stays in
 * the simulation package.
 *
 * @provisional — a future phase that promotes EventSystem errors to the shared
 * package (so the web app imports them from `@capitalist-tree/shared`) would
 * move these classes verbatim. The `name` strings are part of the public
 * interface — do NOT rename.
 */

/**
 * A `schedule-event` / `trigger-event` action referenced an unknown
 * `eventTypeId` — no `EventDefinition` with that id is registered in
 * `packages/content/src/events/event-types.ts` (reachable via
 * `getEventDefinitionById`). Thrown rather than silently no-op'ing so the
 * caller gets a clear signal (and a UI can avoid offering the option until
 * the event type is registered). Mirrors `UnknownResearchNodeError` +
 * `UnknownBusinessTypeError`.
 */
export class UnknownEventDefinitionError extends Error {
  readonly eventTypeId: string;

  constructor(eventTypeId: string) {
    super(
      `Unknown event definition "${eventTypeId}". Register the event in ` +
        `packages/content/src/events/event-types.ts (getEventDefinitionById).`,
    );
    this.name = 'UnknownEventDefinitionError';
    this.eventTypeId = eventTypeId;
  }
}

/**
 * A `resolve-event` action targeted an event id that is neither in
 * `eventState.scheduler.active` nor in `scheduled` (it was never scheduled, or
 * it already concluded and was retired to `history`). Thrown so the caller
 * gets a clear signal rather than the engine silently no-op'ing on a stale
 * id — mirroring `TraitNotAcquiredError`'s "nothing to act on" rejection.
 */
export class UnknownActiveEventError extends Error {
  readonly eventId: string;

  constructor(eventId: string) {
    super(
      `Unknown active event "${eventId}". The id is not in ` +
        `eventState.scheduler.active (it was never triggered, or it has ` +
        `already concluded and been retired to history).`,
    );
    this.name = 'UnknownActiveEventError';
    this.eventId = eventId;
  }
}

/**
 * A `cancel-event` action targeted a scheduled-event id that is not in
 * `eventState.scheduler.scheduled` (it was never scheduled, or it already
 * fired and moved to `active`). Exported for callers that prefer a thrown
 * signal over the idempotent no-op the `cancel-event` action handler uses
 * (the handler itself does NOT throw — it mirrors P6b2's
 * enable/disable-automation idempotency per the actions-events schema doc;
 * this class is available for admin / test code that wants the strict path).
 */
export class UnknownScheduledEventError extends Error {
  readonly eventId: string;

  constructor(eventId: string) {
    super(
      `Unknown scheduled event "${eventId}". The id is not in ` +
        `eventState.scheduler.scheduled (it was never scheduled, or it has ` +
        `already fired and moved to active — use resolve-event to retire an ` +
        `active event early).`,
    );
    this.name = 'UnknownScheduledEventError';
    this.eventId = eventId;
  }
}
