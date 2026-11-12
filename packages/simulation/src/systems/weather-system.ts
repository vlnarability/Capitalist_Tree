/**
 * WeatherSystem (TDD §4.2, §9; GDD §4.3).
 *
 * Replaces the P0 stub at registry slot #2. Runs once per simulation step
 * BEFORE BiologySystem so biology reacts to the new weather.
 *
 * Each step:
 *   1. Restore the persisted weather RNG sub-stream from
 *      `state.rngStreams.weather`. If zero (uninitialized, e.g. a migrated
 *      v3 save), fork from the root RNG to seed it.
 *   2. Look up the active climate baseline + transition matrix by season.
 *   3. Roll the Markov chain to pick the next condition.
 *   4. Roll a fresh intensity in [0, 1].
 *   5. Compute the local temperature (climate baseline + condition delta,
 *      intensity-modulated).
 *   6. Update state.world.weather.{condition, temperature, intensity,
 *      prevCondition, daysInCondition}.
 *   7. R-P2-1 (resolved P7d): NO LONGER mirrors localTemp into
 *      `environment.globalTemperature`. The EnvironmentSystem (slot #10) owns
 *      the climate-scale `globalTemperature` via the climate model; the
 *      previous per-tick mirror dominated the climate trajectory. WeatherSystem
 *      writes ONLY the weather-scale `state.world.weather.temperature`.
 *   8. If the new condition is damage-capable and intensity exceeds the
 *      threshold, emit a `weather-damage` event.
 *   9. If the condition changed, emit a `weather-changed` event.
 *  10. Persist the weather RNG sub-stream back to state.rngStreams.weather.
 *
 * Determinism: the weather RNG sub-stream is persisted on GameState so the
 * sequence survives save/load. Same seed + same step count → identical
 * weather sequence (TDD §18.3).
 *
 * The system is pure: it deep-copies the input state, mutates the copy, and
 * returns the new state. The input is NEVER mutated.
 */
import type {
  GameState,
  SimulationEvent,
  WeatherState,
} from '@capitalist-tree/shared';
import {
  PROVISIONAL_WEATHER_DEFAULT_CLIMATE_ID,
} from '@capitalist-tree/shared';
import {
  findClimateById,
  findTransitionMatrix,
  WEATHER_EVENT_MAP,
} from '@capitalist-tree/content';
import type { System, SystemContext, SystemResult } from './system.js';
import { deepCopy } from '../deep-copy.js';
import { Rng } from '../rng.js';
import { pickNextCondition } from '../weather/markov.js';
import {
  computeDamageSeverity,
  computeLocalTemperature,
  shouldEmitDamage,
} from '../weather/effects.js';

export const weatherSystem: System = {
  id: 'WeatherSystem',
  execute(state: GameState, ctx: SystemContext): SystemResult {
    const next = deepCopy(state);
    const events: SimulationEvent[] = [];

    // 1. Restore or initialize the weather RNG sub-stream.
    const persistedStream = next.rngStreams?.weather;
    const isZero =
      persistedStream &&
      persistedStream[0] === 0 &&
      persistedStream[1] === 0 &&
      persistedStream[2] === 0 &&
      persistedStream[3] === 0;
    let weatherRng: Rng;
    if (persistedStream && !isZero) {
      weatherRng = Rng.fromState(persistedStream);
    } else {
      // Fresh (zero) state — fork from the root RNG. This is the path taken
      // for v3 saves migrated to v4 (rngStreams.weather defaults to zero).
      weatherRng = ctx.rng.fork('WeatherSystem');
    }

    // 2. Look up the active climate + transition matrix.
    const climateId = PROVISIONAL_WEATHER_DEFAULT_CLIMATE_ID;
    const climate = findClimateById(climateId);
    if (!climate) {
      // Defensive — content package should always ship the default climate.
      return { state: next, events };
    }
    const matrix = findTransitionMatrix(climateId, next.clock.season);
    if (!matrix) {
      return { state: next, events };
    }

    // 3. Roll the Markov chain to pick the next condition.
    const currentWeather: WeatherState = next.world.weather;
    const nextCondition = pickNextCondition(
      matrix,
      currentWeather.condition,
      currentWeather.daysInCondition,
      weatherRng,
    );

    // 4. Roll a fresh intensity in [0, 1].
    const intensity = weatherRng.next();

    // 5. Compute the local temperature.
    const eventDef = WEATHER_EVENT_MAP[nextCondition];
    if (!eventDef) {
      // Defensive — schema guarantees all conditions have a definition.
      return { state: next, events };
    }
    const localTemp = computeLocalTemperature(
      climate,
      next.clock.season,
      nextCondition,
      intensity,
      eventDef,
    );

    // 6. Update state.world.weather.
    const conditionChanged = nextCondition !== currentWeather.condition;
    const newDaysInCondition = conditionChanged ? 0 : currentWeather.daysInCondition + Math.ceil(ctx.stepSeconds / 86400);
    next.world.weather = {
      condition: nextCondition,
      temperature: localTemp,
      intensity,
      prevCondition: currentWeather.condition,
      daysInCondition: newDaysInCondition,
    };

    // 7. R-P2-1 RESOLVED (P7d): WeatherSystem NO LONGER mirrors the local
    //    temperature into `environment.globalTemperature`. The EnvironmentSystem
    //    (slot #10) owns `globalTemperature` via the climate model
    //    (`stepTemperature` — forcing-driven equilibrium with thermal inertia).
    //    The previous per-tick mirror made the climate-driven trajectory
    //    "dominated by weather" (the EnvironmentSystem's nudge was overwritten
    //    at the start of every subsequent tick). WeatherSystem now writes ONLY
    //    the regional / weather-scale `state.world.weather.temperature`; the
    //    climate-scale `globalTemperature` is seeded at 18 °C by initial-state
    //    and evolved by the EnvironmentSystem. BiologySystem reads
    //    `environment.globalTemperature` (the climate value) for its
    //    temperature Liebig factor — a one-tick lag on tick 0 is acceptable
    //    for a slowly-evolving climate variable. See docs/environment.md §6
    //    + R-P7-2, and the updated R-P2-1 in docs/resources-weather.md.

    // 8. Emit weather-damage if applicable.
    if (shouldEmitDamage(eventDef, intensity)) {
      const severity = computeDamageSeverity(eventDef, intensity);
      events.push({
        type: 'weather-damage',
        at: ctx.now,
        payload: {
          condition: nextCondition,
          intensity,
          damageType: eventDef.damageType!,
          severity,
          treeIds: [next.originalTree.id],
        },
      });
    }

    // 9. Emit weather-changed when the condition changed.
    if (conditionChanged) {
      events.push({
        type: 'weather-changed',
        at: ctx.now,
        payload: {
          from: currentWeather.condition,
          to: nextCondition,
        },
      });
    }

    // 10. Persist the weather RNG sub-stream.
    next.rngStreams = {
      ...next.rngStreams,
      weather: weatherRng.getState(),
    };

    return { state: next, events };
  },
};
