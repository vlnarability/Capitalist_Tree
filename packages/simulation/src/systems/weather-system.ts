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
  PROVISIONAL_WEATHER_DAMAGE_LEAF_LOSS_FRACTION,
} from '@capitalist-tree/shared';
import {
  applyHighlandModifier,
  findClimateById,
  findTransitionMatrix,
  WEATHER_EVENT_MAP,
} from '@capitalist-tree/content';
import type { System, SystemContext, SystemResult } from './system.js';
import { Rng } from '../rng.js';
import { pickNextCondition } from '../weather/markov.js';
import {
  computeDamageSeverity,
  computeLocalTemperature,
  shouldEmitDamage,
} from '../weather/effects.js';

const SECONDS_PER_DAY = 24 * 60 * 60;

export const weatherSystem: System = {
  id: 'WeatherSystem',
  execute(state: GameState, ctx: SystemContext): SystemResult {
    // Targeted clone (R-P10-6 perf — avoids a full structuredClone of the
    // entire GameState per tick). WeatherSystem writes only
    // `state.world.weather` (reassigned wholesale) and `state.rngStreams`
    // (reassigned wholesale). Only `world` is shallow-cloned so the weather
    // reassignment lands on a fresh object; `rngStreams` is reassigned on the
    // fresh top-level object. Everything else is shared by reference. Pure:
    // the frozen input is never touched.
    const next: GameState = {
      ...state,
      world: { ...state.world },
    };
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
    // GAP-17 (DR-11) Phase 3: read the selected climate from state (stamped at
    // initialize from `config.climateId`) instead of the hardwired default, so
    // the per-zone transition matrix (weather-event weighting) + the zone's
    // `seasonalBaseTemp` (→ temperature → growth curve) reflect the player's
    // chosen Köppen zone. Falls back to the default for pre-GAP-17 states.
    const climateId = next.world.climateId ?? PROVISIONAL_WEATHER_DEFAULT_CLIMATE_ID;
    const baseClimate = findClimateById(climateId);
    if (!baseClimate) {
      // Defensive — content package should always ship the default climate.
      return { state: next, events };
    }
    // GAP-17 (DR-11) Phase 4: apply the highland elevation modifier (lapse
    // rate 6.5 °C/km) when > 0 — a highland game is colder at altitude. The
    // modifier returns a new ClimateZone (base untouched) with shifted
    // seasonalBaseTemp + bumped frostRisk; the shifted temps feed
    // computeLocalTemperature → the temperature→growth curve. (The transition
    // matrix stays per-base-zone — runtime frost-risk re-derivation is Phase 5.)
    const elevationM = next.world.elevationM ?? 0;
    const climate = elevationM > 0 ? applyHighlandModifier(baseClimate, elevationM) : baseClimate;
    const matrix = findTransitionMatrix(climateId, next.clock.season);
    if (!matrix) {
      return { state: next, events };
    }

    // 3. Roll the Markov chain to pick the next condition.
    const currentWeather: WeatherState = next.world.weather;
    // stepDays = the fraction of a day this tick represents (60s → ~0.000694).
    // Passed to pickNextCondition so the daily transition matrix is scaled to
    // the per-tick rate (pre-fix the matrix was applied every tick, changing
    // the condition ~1440× too fast). Also used for the daysInCondition
    // increment (pre-fix Math.ceil rounded 60s up to 1 day per tick, inflating
    // daysInCondition + tripping the staleness bias almost immediately).
    const stepDays = ctx.stepSeconds / SECONDS_PER_DAY;
    const nextCondition = pickNextCondition(
      matrix,
      currentWeather.condition,
      currentWeather.daysInCondition,
      weatherRng,
      stepDays,
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
    const newDaysInCondition = conditionChanged ? 0 : currentWeather.daysInCondition + stepDays;
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
    //    P11 (W4 / RV2-1): APPLY the damage to the tree, not just emit an event.
    //    Pre-fix, the `weather-damage` event was emitted but no consumer
    //    applied it to `tree.damage` — weather damage was dead code (GDD §5.6
    //    "Extreme environmental conditions" + "Physical destruction" death
    //    causes were unreachable). The BiologySystem (slot #3, runs AFTER this
    //    system) reads `tree.damage` for stress/health/death, so writing the
    //    damage entry here makes frost/storm/heat-wave actually wound the tree.
    //
    //    Gated on `conditionChanged` so damage fires once per weather EPISODE
    //    (when the weather transitions INTO a damage-capable condition), not
    //    every tick the condition persists. This matches the GDD §5.6 semantics
    //    (a frost EVENT damages the tree) and bounds the damage array — without
    //    this gate, a multi-day frost would append one entry per tick (O(n²)
    //    array growth over long runs). The severity captures the episode's
    //    damage magnitude; the BiologySystem's age-based prune (slot #3) cleans
    //    up entries older than the defoliation window.
    if (conditionChanged && shouldEmitDamage(eventDef, intensity)) {
      const severity = computeDamageSeverity(eventDef, intensity);
      // Targeted clone of originalTree + its damage array (the rest of state
      // is already shared by reference from the line-67 shallow clone).
      const damageType = eventDef.damageType!;
      // P12-C: the weather damage's mechanical impact is DEFOILIATION (leaf
      // loss), not stress. Pre-P12-C the only impact was via the damage-stress
      // path (counting ALL damage records), which made the weather damage the
      // dominant neglect-death driver (~2mo, 3-6× too fast vs the DR-1 6-12mo
      // target). Now the weather:* records are excluded from the stress count
      // (biology/stress.ts), + the canopy loss here is the weather damage's
      // mechanical impact: reduced photosynthesis → slower reserve accrual.
      // The leaf loss scales with severity × FRACTION of current leaves (a
      // mature tree loses more canopy in absolute terms).
      const currentLeaves = next.originalTree.foliage.currentLeaves;
      const leafLoss = currentLeaves * severity * PROVISIONAL_WEATHER_DAMAGE_LEAF_LOSS_FRACTION;
      const newLeaves = Math.max(0, currentLeaves - leafLoss);
      next.originalTree = {
        ...next.originalTree,
        damage: [
          ...next.originalTree.damage,
          {
            type: `weather:${damageType}`,
            severity,
            appliedAt: ctx.now,
          },
        ],
        foliage: {
          ...next.originalTree.foliage,
          currentLeaves: newLeaves,
        },
      };
      events.push({
        type: 'weather-damage',
        at: ctx.now,
        payload: {
          condition: nextCondition,
          intensity,
          damageType,
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
