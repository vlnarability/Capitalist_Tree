/**
 * Event scheduler (TDD §6.4).
 *
 * A serializable priority queue of scheduled events keyed by simulation time
 * (`at`, in sim seconds). Events fire when `clock.elapsedSeconds >= at`.
 *
 * The scheduler state is stored on `GameState.scheduler` so it survives
 * save/load. P0 stubs the event payloads; later phases populate real kinds
 * (season-transition, bill-due, loan-payment, maintenance, market-review,
 * scheduled-harvest).
 *
 * API:
 *   - `schedule(state, event)` -> new state with event added (pure)
 *   - `due(state, now)` -> [events due, new state with those removed]
 *   - `cancel(state, eventId)` -> new state with event removed (pure)
 *
 * The scheduler is invoked by the engine AFTER all systems run, once per
 * simulation step (see `packages/simulation/src/simulation.ts`).
 */
import type { GameState, ScheduledEvent } from '@capitalist-tree/shared';

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
