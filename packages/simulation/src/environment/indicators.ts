/**
 * Additional environmental indicators (P13-A / GAP-21 — GDD §10.1).
 *
 * Pure helper that advances the four indicators P3b/P7 deferred — air quality,
 * ocean health, wetland coverage, + nutrient runoff — one tick. The
 * EnvironmentSystem calls this after `stepBiodiversity`; it never mutates its
 * input.
 *
 *   - `airQuality` [0,1] relaxes toward a target set by `atmosphere.emissions`
 *     (high emissions → poor air). Recover + degrade at the shared relaxation
 *     rate.
 *   - `oceanHealth` [0,1] relaxes toward a target set by the global-temperature
 *     anomaly (warming → bleaching) + excess CO2 (acidification). A long-horizon
 *     indicator — only visibly degrades across many sim years of warming.
 *   - `wetlandCoverage` [0,1] relaxes toward a target set by `landUse.protected`
 *     (restoration) minus `landUse.developed` (drainage).
 *   - `nutrientRunoff` (≥ 0, a stock) accumulates when soil nutrients exceed
 *     the holding capacity (surplus leaches) + decays exponentially
 *     (biological uptake).
 *
 * All rates are PROVISIONAL (see constants/environment.ts) — tuned for
 * visible-but-slow response (indicators move over sim seasons, not single
 * ticks). At the pristine defaults (emissions 0, temp baseline, no development,
 * low soil nutrients) the targets are all 1.0/0.0 so behaviour is unchanged.
 */
import type { EnvironmentState } from '@capitalist-tree/shared';
import { PROVISIONAL_ENV_BASELINE_TEMP_C } from './climate.js';
import {
  PROVISIONAL_ENV_CO2_BASELINE_PPM,
  PROVISIONAL_ENV_INDICATOR_RELAXATION_PER_DAY,
  PROVISIONAL_ENV_AIR_QUALITY_EMISSION_SENSITIVITY,
  PROVISIONAL_ENV_OCEAN_TEMP_SENSITIVITY,
  PROVISIONAL_ENV_OCEAN_CO2_SENSITIVITY,
  PROVISIONAL_ENV_WETLAND_PROTECTED_FACTOR,
  PROVISIONAL_ENV_WETLAND_DEVELOPED_FACTOR,
  PROVISIONAL_ENV_NUTRIENT_RUNOFF_ACCUMULATION_RATE,
  PROVISIONAL_ENV_NUTRIENT_RUNOFF_DECAY_PER_DAY,
  PROVISIONAL_RESOURCE_SOIL_NUTRIENT_CAPACITY,
} from '@capitalist-tree/shared';

const SECONDS_PER_DAY = 24 * 60 * 60;

/** The four P13-A indicators, returned for the caller to assign back to `env`. */
export interface IndicatorDelta {
  airQuality: number;
  oceanHealth: number;
  wetlandCoverage: number;
  nutrientRunoff: number;
}

/**
 * Advance the four P13-A indicators one step.
 *
 * Pure: takes the environment + step length, returns the new indicator values.
 * The caller assigns them back to `env.airQuality` etc.
 */
export function stepIndicators(
  env: EnvironmentState,
  dtSeconds: number,
): IndicatorDelta {
  const dtDays = dtSeconds / SECONDS_PER_DAY;
  const relax = PROVISIONAL_ENV_INDICATOR_RELAXATION_PER_DAY * dtDays;

  // 1. airQuality: target = 1 - clamp(emissions × SENSITIVITY, 0, 1).
  const airTarget = Math.max(
    0,
    Math.min(1, 1 - env.atmosphere.emissions * PROVISIONAL_ENV_AIR_QUALITY_EMISSION_SENSITIVITY),
  );
  const airQuality = Math.max(0, Math.min(1, env.airQuality + (airTarget - env.airQuality) * relax));

  // 2. oceanHealth: target = 1 - clamp(tempAnomaly × TEMP_SENS + co2Excess × CO2_SENS, 0, 1).
  const tempAnomaly = env.globalTemperature - PROVISIONAL_ENV_BASELINE_TEMP_C;
  const co2Excess = Math.max(0, env.atmosphere.co2Concentration - PROVISIONAL_ENV_CO2_BASELINE_PPM);
  const oceanTarget = Math.max(
    0,
    Math.min(
      1,
      1 -
        tempAnomaly * PROVISIONAL_ENV_OCEAN_TEMP_SENSITIVITY -
        co2Excess * PROVISIONAL_ENV_OCEAN_CO2_SENSITIVITY,
    ),
  );
  const oceanHealth = Math.max(
    0,
    Math.min(1, env.oceanHealth + (oceanTarget - env.oceanHealth) * relax),
  );

  // 3. wetlandCoverage: target = clamp(protected × PROT - developed × DEV, 0, 1).
  const wetlandTarget = Math.max(
    0,
    Math.min(
      1,
      env.landUse.protected * PROVISIONAL_ENV_WETLAND_PROTECTED_FACTOR -
        env.landUse.developed * PROVISIONAL_ENV_WETLAND_DEVELOPED_FACTOR,
    ),
  );
  const wetlandCoverage = Math.max(
    0,
    Math.min(1, env.wetlandCoverage + (wetlandTarget - env.wetlandCoverage) * relax),
  );

  // 4. nutrientRunoff: accumulate surplus above capacity, then exponential decay.
  const soilN = env.soil.nutrients;
  const totalSoilNutrients = soilN.nitrogen + soilN.phosphorus + soilN.potassium;
  const capacityTotal = PROVISIONAL_RESOURCE_SOIL_NUTRIENT_CAPACITY * 3;
  const surplus = Math.max(0, totalSoilNutrients - capacityTotal);
  const accumulated = surplus * PROVISIONAL_ENV_NUTRIENT_RUNOFF_ACCUMULATION_RATE * dtDays;
  const decayed = env.nutrientRunoff * Math.pow(1 - PROVISIONAL_ENV_NUTRIENT_RUNOFF_DECAY_PER_DAY, dtDays);
  const nutrientRunoff = Math.max(0, decayed + accumulated);

  return { airQuality, oceanHealth, wetlandCoverage, nutrientRunoff };
}
