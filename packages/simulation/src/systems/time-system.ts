/**
 * TimeSystem (TDD §6.1).
 *
 * Advances the SimulationClock by exactly one fixed step per `execute` call:
 *
 *   - `elapsedSeconds += stepSeconds`
 *   - `day` recomputed from `elapsedSeconds / SECONDS_PER_DAY`
 *   - `season` derived from day-of-year, shaped by the climate's `seasonality`
 *     (GAP-17 follow-up (b): four-season / wet-dry / polar day-count profiles —
 *     see `SEASON_DURATIONS_BY_SEASONALITY` + `seasonFromDay` below)
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
import type { ClimateBaseline, GameState, SimulationEvent, Season } from '@capitalist-tree/shared';
import { SEASONS_IN_ORDER } from '@capitalist-tree/shared';
import {
  PROVISIONAL_DAYS_PER_YEAR,
  PROVISIONAL_SIMULATION_STEP_SECONDS,
} from '@capitalist-tree/shared';
import { findClimateById } from '@capitalist-tree/content';
import type { System, SystemContext, SystemResult } from './system.js';

export const SECONDS_PER_DAY = 24 * 60 * 60; // 86400

/**
 * GAP-17 follow-up (b) — seasonality → season-calendar channel. The Köppen
 * zones carry a `seasonality` (`'wet-dry' | 'four-season' | 'polar'`) that was
 * previously data-only; the season calendar was always the fixed 4-season
 * quarterly cycle. This mapping gives each seasonality a distinct day-count per
 * season (spring / summer / autumn / winter), so the calendar reflects the
 * climate's actual seasonal pattern. Each row sums to `PROVISIONAL_DAYS_PER_YEAR`
 * (120); the Season type stays the 4 temperate names (consumers — deciduous
 * winter dormancy, seasonal foliage condition — read `clock.season` unchanged).
 *
 *   - **four-season** (temperate): equal quarters — the historical calendar
 *     (preserved exactly: `seasonFromDay(0) === 'spring'`, transitions at
 *     30/60/90/120). The default + the backward-compat fallback.
 *   - **wet-dry** (tropical / arid): a wet season (spring onset + summer peak)
 *     + a dry season (autumn onset + winter peak), with the dry season LONGER —
 *     models the savanna / monsoon / desert asymmetry where the dry outlasts the
 *     wet. Drought-deciduous trees go dormant in the long winter (= dry peak).
 *   - **polar**: a SHORT growing window (brief spring + short summer + brief
 *     autumn) + a LONG dormant winter — the polar tree has ~30 days to grow +
 *     ~60 dormant (GDD §5.6 extreme environments: the short growing window is
 *     the polar limiting factor, not just the cold).
 */
const SEASON_DURATIONS_BY_SEASONALITY: Record<
  ClimateBaseline['seasonality'],
  readonly [number, number, number, number]
> = Object.freeze({
  'four-season': [30, 30, 30, 30],
  'wet-dry': [20, 30, 20, 50],
  'polar': [15, 30, 15, 60],
}) as Record<ClimateBaseline['seasonality'], readonly [number, number, number, number]>;

/**
 * Map day-of-year (0-based) to a season, optionally shaped by the climate's
 * `seasonality`. Omitting `seasonality` (or passing `'four-season'`) preserves
 * the historical 4-season quarterly calendar — backward compatible with callers
 * that don't thread the climate through (e.g. pre-GAP-17 states, unit tests).
 */
export function seasonFromDay(
  day: number,
  seasonality: ClimateBaseline['seasonality'] = 'four-season',
): Season {
  const dayOfYear =
    ((day % PROVISIONAL_DAYS_PER_YEAR) + PROVISIONAL_DAYS_PER_YEAR) %
    PROVISIONAL_DAYS_PER_YEAR;
  const durations = SEASON_DURATIONS_BY_SEASONALITY[seasonality];
  let cumulative = 0;
  for (let i = 0; i < SEASONS_IN_ORDER.length; i++) {
    cumulative += durations[i] ?? 0;
    if (dayOfYear < cumulative) {
      const season = SEASONS_IN_ORDER[i];
      if (season) return season;
    }
  }
  // Defensive — unreachable given dayOfYear < PROVISIONAL_DAYS_PER_YEAR + the
  // duration rows sum to exactly that. Fall back to winter (the last season).
  return SEASONS_IN_ORDER[SEASONS_IN_ORDER.length - 1]!;
}

/** Resolve the effective climate's seasonality for a state (backward-compat
 *  fallback to `'four-season'` when the state has no resolvable climate). */
function seasonalityOf(state: GameState): ClimateBaseline['seasonality'] {
  const climate = state.world.climateId ? findClimateById(state.world.climateId) : undefined;
  return climate?.seasonality ?? 'four-season';
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
    next.clock.season = seasonFromDay(next.clock.day, seasonalityOf(next));
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
