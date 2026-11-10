/**
 * TimeSystem (TDD §6.1).
 *
 * Advances the SimulationClock by exactly one fixed step per `execute` call:
 *
 *   - `elapsedSeconds += stepSeconds`
 *   - `day` recomputed from `elapsedSeconds / SECONDS_PER_DAY`
 *   - `season` derived from day-of-year (PROVISIONAL_DAYS_PER_SEASON per season)
 *   - `timeOfDay` recomputed as a fraction in [0, 1) of the in-game day
 *   - `speedMultiplier` and `paused` are left UNCHANGED — pause is enforced
 *     by the accumulator layer in apps/web (Pause contract — see
 *     docs/simulation.md).
 *
 * Emits:
 *   - `tick` after each step
 *   - `season-changed` when the season differs from the previous step
 *
 * TimeSystem is the only "real" system in P0; the others are no-op stubs.
 */
import type { GameState, SimulationEvent, Season } from '@capitalist-tree/shared';
import { SEASONS_IN_ORDER } from '@capitalist-tree/shared';
import {
  PROVISIONAL_DAYS_PER_SEASON,
  PROVISIONAL_DAYS_PER_YEAR,
  PROVISIONAL_SIMULATION_STEP_SECONDS,
} from '@capitalist-tree/shared';
import type { System, SystemContext, SystemResult } from './system.js';

export const SECONDS_PER_DAY = 24 * 60 * 60; // 86400

/** Map day-of-year (0-based) to a season. */
export function seasonFromDay(day: number): Season {
  const dayOfYear = ((day % PROVISIONAL_DAYS_PER_YEAR) + PROVISIONAL_DAYS_PER_YEAR) % PROVISIONAL_DAYS_PER_YEAR;
  const idx = Math.floor(dayOfYear / PROVISIONAL_DAYS_PER_SEASON);
  const clamped = Math.min(Math.max(idx, 0), SEASONS_IN_ORDER.length - 1);
  // noUncheckedIndexedAccess — guard the array access.
  const season = SEASONS_IN_ORDER[clamped];
  if (!season) {
    // Defensive — should be unreachable given the clamping above.
    return SEASONS_IN_ORDER[0]!;
  }
  return season;
}

/** Compute time-of-day fraction in [0, 1) from elapsedSeconds. */
export function timeOfDayFraction(elapsedSeconds: number): number {
  const sec = ((elapsedSeconds % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
  return sec / SECONDS_PER_DAY;
}

export const timeSystem: System = {
  id: 'TimeSystem',
  execute(state: GameState, ctx: SystemContext): SystemResult {
    // TimeSystem mutates a fresh copy. We trust upstream (`advance`) to pass
    // us a fresh copy, but we defensively make our own to keep the system
    // self-contained.
    const next: GameState = {
      ...state,
      clock: { ...state.clock },
    };

    const prevSeason = next.clock.season;
    next.clock.elapsedSeconds = next.clock.elapsedSeconds + ctx.stepSeconds;
    next.clock.day = Math.floor(next.clock.elapsedSeconds / SECONDS_PER_DAY);
    next.clock.season = seasonFromDay(next.clock.day);
    next.clock.timeOfDay = timeOfDayFraction(next.clock.elapsedSeconds);

    const events: SimulationEvent[] = [
      {
        type: 'tick',
        at: next.clock.elapsedSeconds,
        payload: {
          step: Math.floor(next.clock.elapsedSeconds / PROVISIONAL_SIMULATION_STEP_SECONDS),
          day: next.clock.day,
          timeOfDay: next.clock.timeOfDay,
        },
      },
    ];

    if (next.clock.season !== prevSeason) {
      events.push({
        type: 'season-changed',
        at: next.clock.elapsedSeconds,
        payload: {
          from: prevSeason,
          to: next.clock.season,
          day: next.clock.day,
        },
      });
    }

    return { state: next, events };
  },
};
