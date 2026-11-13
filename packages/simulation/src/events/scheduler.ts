/**
 * Event scheduling (TDD §6.4).
 *
 * This file holds TWO coexisting schedulers:
 *
 *   1. The P0 `SchedulerState` scheduler — a serializable priority queue of
 *      scheduled events keyed by simulation time (`at`, in sim seconds),
 *      stored on `GameState.scheduler`. Events fire when
 *      `clock.elapsedSeconds >= at`. Used by the engine for engine-internal
 *      timed callbacks (the PersonalSystem's `bill-due` events). API:
 *      `schedule` / `due` / `cancel`. The engine fires due P0 events after
 *      all systems run (see `packages/simulation/src/simulation.ts`).
 *
 *   2. The P10b EventSystem scheduler — a richer sibling stored on
 *      `GameState.eventState.scheduler` (P10a schema). It tracks *scheduled*
 *      (queued) + *active* (in-progress) + *history* (concluded) events,
 *      keyed by event *type* ids from content
 *      (`packages/content/src/events/`). Events have durations + consequences
 *      (GDD §10.3 environmental feedback). API: `scheduleEvent` /
 *      `cancelScheduledEvent` / `triggerEventImmediate` /
 *      `resolveActiveEvent` / `processScheduledEvents`. The EventSystem
 *      (slot #12, `packages/simulation/src/systems/events.ts`) drives the
 *      per-tick processing.
 *
 * The two coexist (P0: opaque `{id, at, kind, payload}` for engine callbacks;
 * EventSystem: typed `{id, type, scheduledAt, payload, resolved, resolvedAt,
 * priority}` + active + history for gameplay events) — see the naming note in
 * `packages/shared/src/schemas/event-system.ts` for why the EventSystem's
 * queued-event type is `ScheduledEventInstance` rather than `ScheduledEvent`.
 *
 * All functions are pure: they return a new state (and events) without
 * mutating the input (TDD §4.1, §18.4). Deterministic given (state, params)
 * (TDD §18.3) — the EventSystem RNG fork is DEFERRED as R-P10-N (see
 * `packages/simulation/src/systems/events.ts`); P10b's transforms are fully
 * deterministic (no random event rolling — that lands in P10c with the global
 * markets / climate feedback loops).
 */
import type {
  GameState,
  ScheduledEvent,
  SimulationEvent,
  EventState,
  ScheduledEventInstance,
  ActiveEvent,
  EventHistoryEntry,
  EventSeverity,
  EventPriority,
  EventOutcome,
} from '@capitalist-tree/shared';
import {
  PROVISIONAL_EVENT_CHECK_INTERVAL_TICKS,
  PROVISIONAL_SIMULATION_STEP_SECONDS,
} from '@capitalist-tree/shared';
import { getEventDefinitionById } from '@capitalist-tree/content';
import { applyEventEffects } from './global.js';
import { UnknownEventDefinitionError, UnknownActiveEventError } from './errors.js';

// ---------------------------------------------------------------------------
// P0 scheduler — time-keyed priority queue on `GameState.scheduler`
// ---------------------------------------------------------------------------

/** Add a scheduled event to the state's scheduler. Pure — returns new state. */
export function schedule(state: GameState, event: ScheduledEvent): GameState {
  const events = [...state.scheduler.events, event];
  events.sort((a, b) => a.at - b.at);
  return {
    ...state,
    scheduler: { events },
  };
}

/**
 * Find events due at or before `now` (sim seconds) and remove them from the
 * scheduler. Returns the fired events and the new state.
 *
 * The engine turns each fired event into a `scheduled-event` SimulationEvent.
 */
export function due(
  state: GameState,
  now: number,
): { fired: ScheduledEvent[]; state: GameState } {
  const fired: ScheduledEvent[] = [];
  const remaining: ScheduledEvent[] = [];
  for (const ev of state.scheduler.events) {
    if (ev.at <= now) {
      fired.push(ev);
    } else {
      remaining.push(ev);
    }
  }
  return {
    fired,
    state: { ...state, scheduler: { events: remaining } },
  };
}

/** Cancel a scheduled event by id. Pure — returns new state. */
export function cancel(state: GameState, eventId: string): GameState {
  return {
    ...state,
    scheduler: {
      events: state.scheduler.events.filter((e) => e.id !== eventId),
    },
  };
}

// ---------------------------------------------------------------------------
// EventSystem scheduler — scheduled / active / history on
// `GameState.eventState.scheduler` (P10b — TDD §6.4)
// ---------------------------------------------------------------------------
//
// TIME MODEL (TDD §18.3 — deterministic):
//   - `scheduledAt` / `startedAt` / `occurredAt` / `resolvedAt` / `duration`
//     / `remaining` on the EventSystem scheduler entries are TICK INDICES
//     (per the P10a schema comments — one tick = PROVISIONAL_SIMULATION_
//     STEP_SECONDS sim seconds). The content `durationRange` is likewise in
//     ticks.
//   - The helpers below take `now` in SIM SECONDS (the SystemContext.now /
//     action.payload.tick value, consistent with every other system's event
//     `at`). They derive the tick index internally via
//     `Math.floor(now / PROVISIONAL_SIMULATION_STEP_SECONDS)` so the emitted
//     SimulationEvent `at` stays in sim seconds (uniform with the rest of the
//     engine) while the persisted scheduler fields stay in tick indices.
//
// THROTTLE: `processScheduledEvents` self-throttles — it is a no-op when the
// current tick index is NOT a multiple of
// `PROVISIONAL_EVENT_CHECK_INTERVAL_TICKS`. The EventSystem calls it every
// tick; the throttle gate skips the work on off-cadence ticks (TDD §6.4 —
// discrete scheduled events are checked on a cadence, not every tick). When
// it runs, it decrements each already-active event's `remaining` by the
// interval (the number of ticks elapsed since the last check) so an event
// whose `duration` is D ticks survives roughly D ticks of wall time despite
// the throttled check cadence. Events fired THIS check are added with
// `remaining = duration` and are NOT decremented this check (they get their
// first decrement at the next check).
//
// DURATION ROLL: P10b does NOT roll a random duration within
// `EventDefinition.durationRange` — that would require an RNG sub-stream,
// which is deferred (R-P10-N). Instead the helpers use the midpoint of the
// definition's `durationRange` (deterministic). Random severity / duration
// rolls land in P10c alongside the RNG fork + global markets / climate
// feedback. An explicit `severity` in the payload (or action) is honored
// verbatim; an omitted severity defaults to `'moderate'` (the schema default).

/** Convert a sim-seconds `now` to a tick index. */
function tickFromNow(now: number): number {
  return Math.floor(now / PROVISIONAL_SIMULATION_STEP_SECONDS);
}

/**
 * Deterministic duration for a freshly-fired event — the midpoint of the
 * EventDefinition's `durationRange` (rounded down). Random duration rolling
 * is deferred to P10c (R-P10-N — requires the RNG fork); P10b uses the
 * midpoint so the scheduler is fully deterministic. An explicit `duration`
 * carried in the event `payload` overrides this.
 */
function resolveDuration(eventTypeId: string, payload: Record<string, unknown>): number {
  const explicit = payload['duration'];
  if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit >= 0) {
    return Math.floor(explicit);
  }
  const def = getEventDefinitionById(eventTypeId);
  if (!def) return 0;
  const [min, max] = def.durationRange;
  return Math.floor((min + max) / 2);
}

/** Resolve the severity for a freshly-fired event (explicit payload wins, else 'moderate'). */
function resolveSeverity(payload: Record<string, unknown>): EventSeverity {
  const explicit = payload['severity'];
  if (
    explicit === 'minor' ||
    explicit === 'moderate' ||
    explicit === 'severe' ||
    explicit === 'catastrophic'
  ) {
    return explicit;
  }
  return 'moderate';
}

/** Build the next deterministic scheduled-event id from the scheduler counter. */
function nextId(scheduler: EventState['scheduler']): string {
  return `evt-${scheduler.nextEventId}`;
}

/**
 * Allocate the next scheduled-event id and return the id + the scheduler with
 * the counter incremented. Pure.
 */
function allocateId(scheduler: EventState['scheduler']): {
  id: string;
  scheduler: EventState['scheduler'];
} {
  const id = nextId(scheduler);
  return {
    id,
    scheduler: { ...scheduler, nextEventId: scheduler.nextEventId + 1 },
  };
}

/**
 * `scheduleEvent` — queue a scheduled event (TDD §6.4 — discrete scheduled
 * events use an event scheduler). Pure: returns a new state + an
 * `event-scheduled` event.
 *
 *   1. Resolve the event type via `getEventDefinitionById` (content gate —
 *      unknown id raises `UnknownEventDefinitionError`).
 *   2. Allocate a deterministic id from `eventState.scheduler.nextEventId`
 *      and increment the counter.
 *   3. Append a `ScheduledEventInstance` to `eventState.scheduler.scheduled`.
 *   4. Emit an `event-scheduled` event carrying the allocated id + fire tick.
 *
 * `scheduledAt` is a tick index; `now` is the sim second used for the emitted
 * event's `at` (determinism — TDD §18.3).
 */
export function scheduleEvent(
  state: GameState,
  type: string,
  scheduledAt: number,
  payload: Record<string, unknown>,
  priority: EventPriority,
  now: number,
): { state: GameState; events: SimulationEvent[] } {
  const def = getEventDefinitionById(type);
  if (!def) {
    throw new UnknownEventDefinitionError(type);
  }

  const scheduler = state.eventState.scheduler;
  const { id, scheduler: schedulerWithId } = allocateId(scheduler);
  const instance: ScheduledEventInstance = {
    id,
    type,
    scheduledAt,
    payload,
    resolved: false,
    resolvedAt: 0,
    priority,
  };

  // Targeted clone (P10c perf — avoids a full structuredClone per tick). Only
  // the eventState.scheduler path is cloned (scheduled list + nextEventId);
  // the rest of the state is shared by reference. Pure: the frozen input is
  // never touched.
  const next: GameState = {
    ...state,
    eventState: {
      ...state.eventState,
      scheduler: {
        ...schedulerWithId,
        scheduled: [...schedulerWithId.scheduled, instance],
      },
    },
  };

  const event: SimulationEvent = {
    type: 'event-scheduled',
    at: now,
    payload: {
      eventId: id,
      eventTypeId: type,
      scheduledAt,
      priority,
    },
  };

  return { state: next, events: [event] };
}

/**
 * `cancelScheduledEvent` — remove a scheduled event by id (before it fires).
 * Idempotent: a missing id is a no-op (mirrors P6b2's enable/disable-
 * automation idempotency per the actions-events schema doc). Pure: returns a
 * new state. Emits NO event (the cancellation is reflected in the scheduler
 * state; the EventSystem does not emit a separate cancel event variant).
 */
export function cancelScheduledEvent(
  state: GameState,
  id: string,
): { state: GameState; events: SimulationEvent[] } {
  const scheduler = state.eventState.scheduler;
  const filtered = scheduler.scheduled.filter((e) => e.id !== id);
  if (filtered.length === scheduler.scheduled.length) {
    // Idempotent no-op — id not found.
    return { state, events: [] };
  }
  // Targeted clone (P10c perf — avoids a full structuredClone per tick). Only
  // the eventState.scheduler.scheduled path is cloned; the rest of the state
  // is shared by reference. Pure: the frozen input is never touched.
  const next: GameState = {
    ...state,
    eventState: {
      ...state.eventState,
      scheduler: { ...scheduler, scheduled: filtered },
    },
  };
  return { state: next, events: [] };
}

/**
 * `triggerEventImmediate` — bypass the scheduler queue and fire an event
 * immediately (for testing / admin — TDD §6.4). Pure: returns a new state +
 * an `event-triggered` event.
 *
 *   1. Resolve the event type via `getEventDefinitionById` (content gate).
 *   2. Resolve severity (explicit `payload.severity` wins; else `'moderate'`)
 *      + duration (explicit `payload.duration` wins; else the midpoint of the
 *      definition's `durationRange` — random rolling deferred, R-P10-N).
 *   3. Allocate an id, build an `ActiveEvent` (`startedAt` = tick index of
 *      `now`), append to `eventState.scheduler.active`.
 *   4. Apply the event's effects via `applyEventEffects` (content `effects`
 *      deltas scaled by severity + global degradation).
 *   5. Emit an `event-triggered` event.
 */
export function triggerEventImmediate(
  state: GameState,
  type: string,
  payload: Record<string, unknown>,
  now: number,
): { state: GameState; events: SimulationEvent[] } {
  const def = getEventDefinitionById(type);
  if (!def) {
    throw new UnknownEventDefinitionError(type);
  }

  const scheduler = state.eventState.scheduler;
  const { id, scheduler: schedulerWithId } = allocateId(scheduler);
  const severity = resolveSeverity(payload);
  const duration = resolveDuration(type, payload);
  const startedAt = tickFromNow(now);

  const active: ActiveEvent = {
    id,
    type,
    startedAt,
    duration,
    remaining: duration,
    payload,
    severity,
  };

  // Targeted clone of the scheduler path (P10c perf — avoids a full
  // structuredClone). Adds the active event to eventState.scheduler.active +
  // bumps nextEventId; the rest of the state is shared by reference. Pure: the
  // frozen input is never touched.
  const withScheduler: GameState = {
    ...state,
    eventState: {
      ...state.eventState,
      scheduler: {
        ...schedulerWithId,
        active: [...schedulerWithId.active, active],
      },
    },
  };

  // Apply the event's effects to regional / global state (GDD §10.3 —
  // environmental damage creates secondary consequences). applyEventEffects
  // does its own targeted clone of the eventState.global path and PRESERVES the
  // scheduler we just set (it spreads eventState and only overrides `global`,
  // keeping the scheduler reference), so the returned state carries both the
  // new active event and the applied effects.
  const effectsResult = applyEventEffects(withScheduler, active);
  const next = effectsResult.state;

  const event: SimulationEvent = {
    type: 'event-triggered',
    at: now,
    payload: {
      eventId: id,
      eventTypeId: type,
      startedAt,
      duration,
      severity,
    },
  };

  return { state: next, events: [event] };
}

/**
 * `resolveActiveEvent` — manually resolve an active event early (player
 * mitigates an ongoing crisis — GDD §10.3 recovery is possible but costly).
 * Pure: returns a new state + an `event-resolved` event.
 *
 *   1. Find the active event by id; raise `UnknownActiveEventError` if not
 *      found.
 *   2. Remove it from `active`, retire it to `history` with `outcome:
 *      'mitigated'`.
 *   3. Emit an `event-resolved` event (outcome `'mitigated'`).
 *
 * P10b does NOT revert the event's applied effects here — recovery is gradual
 * via `evolveRegions`'s `PROVISIONAL_EVENT_RECOVERY_RATE` (GDD §10.3 —
 * recovery is possible but costly; damage lingers). A future mitigation
 * system (P10c) may apply a partial revert / reduced-magnitude marker.
 */
export function resolveActiveEvent(
  state: GameState,
  id: string,
  now: number,
): { state: GameState; events: SimulationEvent[] } {
  const scheduler = state.eventState.scheduler;
  const idx = scheduler.active.findIndex((e) => e.id === id);
  if (idx < 0) {
    throw new UnknownActiveEventError(id);
  }
  const active = scheduler.active[idx]!;
  const resolvedAt = tickFromNow(now);
  const def = getEventDefinitionById(active.type);
  const historyEntry: EventHistoryEntry = {
    id: active.id,
    type: active.type,
    occurredAt: active.startedAt,
    resolvedAt,
    severity: active.severity,
    outcome: 'mitigated',
    description: def
      ? `${def.name} (${active.severity}) — mitigated early`
      : `${active.type} — mitigated early`,
  };

  // Targeted clone (P10c perf — avoids a full structuredClone per tick). Only
  // the eventState.scheduler path is cloned (active list minus the resolved
  // event + history with the new entry); the rest of the state is shared by
  // reference. Pure: the frozen input is never touched.
  const next: GameState = {
    ...state,
    eventState: {
      ...state.eventState,
      scheduler: {
        ...scheduler,
        active: scheduler.active.filter((e) => e.id !== id),
        history: [...scheduler.history, historyEntry],
      },
    },
  };

  const event: SimulationEvent = {
    type: 'event-resolved',
    at: now,
    payload: {
      eventId: id,
      eventTypeId: active.type,
      resolvedAt,
      outcome: 'mitigated' as EventOutcome,
    },
  };

  return { state: next, events: [event] };
}

/**
 * `processScheduledEvents` — the per-tick scheduler tick (TDD §6.4). Pure:
 * returns a new state + events.
 *
 * Self-throttles: a no-op when the current tick index is NOT a multiple of
 * `PROVISIONAL_EVENT_CHECK_INTERVAL_TICKS`. When it runs:
 *
 *   1. EXPIRE phase — for each event already active (fired at a prior check),
 *      decrement `remaining` by the check interval (the ticks elapsed since
 *      the last check); retire those whose `remaining` reaches <= 0 to
 *      `history` with `outcome: 'expired'` + emit `event-expired`. (Natural
 *      end without mitigation = `'expired'` per the events-events schema doc;
 *      P10b has no mitigation mechanic, so all natural ends are `'expired'`.
 *      A future mitigation system — P10c — will flip surviving events to
 *      `'resolved'`.)
 *   2. FIRE phase — for each scheduled event whose `scheduledAt <=
 *      tickIndex`, resolve its type + severity + (midpoint) duration, build
 *      an `ActiveEvent` (`startedAt` = tickIndex), apply its effects via
 *      `applyEventEffects`, move it from `scheduled` → `active`, emit
 *      `event-triggered`. Newly-fired events are NOT decremented this check
 *      (their first decrement lands at the next check).
 *
 * Effects are NOT reverted at expiry — recovery is gradual via
 * `evolveRegions` (GDD §10.3 — recovery is costly; damage lingers).
 */
export function processScheduledEvents(
  state: GameState,
  now: number,
): { state: GameState; events: SimulationEvent[] } {
  const tickIndex = tickFromNow(now);
  // Throttle gate — only run on the check cadence.
  if (tickIndex % PROVISIONAL_EVENT_CHECK_INTERVAL_TICKS !== 0) {
    return { state, events: [] };
  }

  // `working` threads the accumulated event-effects (eventState.global) through
  // the FIRE loop: each applyEventEffects call reads the current global and
  // returns a new state with the effects applied. It starts as the (frozen)
  // input — only read from until the first applyEventEffects reassigns it to a
  // fresh state. The scheduler path is cloned once at the end (P10c perf —
  // avoids a full structuredClone per tick). Pure: the frozen input is never
  // mutated.
  let working: GameState = state;
  const scheduler = state.eventState.scheduler;
  const events: SimulationEvent[] = [];
  const interval = PROVISIONAL_EVENT_CHECK_INTERVAL_TICKS;

  // 1. EXPIRE phase — decrement + retire concluded active events.
  const stillActive: ActiveEvent[] = [];
  const newHistory: EventHistoryEntry[] = [];
  for (const active of scheduler.active) {
    const remaining = active.remaining - interval;
    if (remaining <= 0) {
      // Retire to history with outcome 'expired' (natural end, no mitigation).
      const def = getEventDefinitionById(active.type);
      newHistory.push({
        id: active.id,
        type: active.type,
        occurredAt: active.startedAt,
        resolvedAt: tickIndex,
        severity: active.severity,
        outcome: 'expired',
        description: def
          ? `${def.name} (${active.severity}) — expired (ran its course)`
          : `${active.type} — expired`,
      });
      events.push({
        type: 'event-expired',
        at: now,
        payload: {
          eventId: active.id,
          eventTypeId: active.type,
          expiredAt: tickIndex,
        },
      });
    } else {
      stillActive.push({ ...active, remaining });
    }
  }

  // 2. FIRE phase — fire due scheduled events (scheduledAt <= tickIndex).
  const dueInstances: ScheduledEventInstance[] = [];
  const remainingScheduled: ScheduledEventInstance[] = [];
  for (const inst of scheduler.scheduled) {
    if (inst.scheduledAt <= tickIndex) {
      dueInstances.push(inst);
    } else {
      remainingScheduled.push(inst);
    }
  }
  // Sort due events by priority (critical → low) then by scheduledAt for
  // deterministic firing order within a check.
  const priorityRank: Record<EventPriority, number> = {
    critical: 0,
    high: 1,
    normal: 2,
    low: 3,
  };
  dueInstances.sort((a, b) => {
    const pr = priorityRank[a.priority] - priorityRank[b.priority];
    if (pr !== 0) return pr;
    return a.scheduledAt - b.scheduledAt;
  });

  let activeList = stillActive;
  for (const inst of dueInstances) {
    const def = getEventDefinitionById(inst.type);
    if (!def) {
      // Unknown type in the queue — skip firing (do not crash the scheduler).
      // The scheduleEvent gate should have caught this at schedule time; a
      // re-loaded save with a stale type id is gracefully dropped here.
      continue;
    }
    const severity = resolveSeverity(inst.payload);
    const duration = resolveDuration(inst.type, inst.payload);
    const active: ActiveEvent = {
      id: inst.id,
      type: inst.type,
      startedAt: tickIndex,
      duration,
      remaining: duration,
      payload: inst.payload,
      severity,
    };
    activeList = [...activeList, active];
    events.push({
      type: 'event-triggered',
      at: now,
      payload: {
        eventId: inst.id,
        eventTypeId: inst.type,
        startedAt: tickIndex,
        duration,
        severity,
      },
    });
    // Apply the event's effects (targeted clone of the eventState.global
    // path). Thread the result back into `working` so the next iteration's
    // applyEventEffects reads the accumulated global state. applyEventEffects
    // preserves the scheduler (it spreads eventState and only overrides
    // `global`), so working.eventState.scheduler stays === state's scheduler
    // until the final merge below.
    const effectsResult = applyEventEffects(working, active);
    working = effectsResult.state;
    // applyEventEffects may emit events for policy-category government-policy
    // nudges; thread them through.
    events.push(...effectsResult.events);
  }

  // Targeted clone — merge the accumulated event-effects global (on
  // `working.eventState.global`) with the new scheduler (scheduled / active /
  // history) in a single spread chain. The rest of the state is shared by
  // reference. Pure: the frozen input is never touched.
  const next: GameState = {
    ...working,
    eventState: {
      ...working.eventState,
      scheduler: {
        ...scheduler,
        scheduled: remainingScheduled,
        active: activeList,
        history: [...scheduler.history, ...newHistory],
      },
    },
  };

  return { state: next, events };
}
