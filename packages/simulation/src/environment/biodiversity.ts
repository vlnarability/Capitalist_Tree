/**
 * Biodiversity dynamics (TDD §13 Environment System, §5.5; GDD §10.1, §59–67
 * sustainability pillars).
 *
 * Pure helper that advances the biodiversity index + species populations one
 * tick. The EnvironmentSystem calls this after the soil step (so it can read
 * the just-updated `soil.health`); it never mutates its input.
 *
 *   stress = w_pollution * pollutionStress
 *          + w_deforest  * (1 - forestCoverage)
 *          + w_tempAnom  * tempAnomaly
 *          + w_soil      * (1 - soil.health)
 *          + w_water     * freshwaterContamination
 *
 *   if stress > RECOVERY_THRESHOLD:
 *     index -= DECLINE_RATE * stress * dtDays            (decline scales with stress)
 *   else:
 *     index += RECOVERY_RATE * (1 - stress) * dtDays     (recovery scales with headroom)
 *
 *   speciesPopulations[i] *= newIndex / oldIndex          (populations track the index)
 *
 * Decline is faster than recovery (DECLINE_RATE > RECOVERY_RATE) — GDD §10.3
 * "Environmental recovery is possible, but the time and resources required
 * should depend on the severity"; recovery lags remediation so players feel
 * the cost of prior damage. Some losses (species extinction) are irreversible
 * within the current world (GDD §10.3) — modelled by clamping at 0 and not
 * auto-reviving extinct (population = 0) species.
 */
import type { EnvironmentState } from '@capitalist-tree/shared';
import {
  PROVISIONAL_ENV_BIODIVERSITY_DECLINE_RATE,
  PROVISIONAL_ENV_BIODIVERSITY_RECOVERY_RATE,
  PROVISIONAL_RESOURCE_CONTAMINATION_FULL_DEGRADE,
} from '@capitalist-tree/shared';
import { PROVISIONAL_ENV_BASELINE_TEMP_C } from './climate.js';

const SECONDS_PER_DAY = 24 * 60 * 60;

// @provisional (GDD §17: Environmental recovery timescales) — stress level
// above which biodiversity declines; below it, biodiversity recovers. 0.3
// matches the GDD §10.3 intent that a moderately stressed ecosystem still
// slowly recovers, while a heavily stressed one loses biodiversity. Tunable.
export const PROVISIONAL_ENV_BIODIVERSITY_STRESS_THRESHOLD = 0.3;

// @provisional (GDD §17: detailed climate model) — per-degree-of-warming
// contribution to biodiversity stress. ~0.1/°C so a +2 °C anomaly adds 0.2
// stress (below threshold alone, but compounds with other stressors). Tunable.
export const PROVISIONAL_ENV_BIODIVERSITY_TEMP_STRESS_PER_DEGREE = 0.1;

// Stress weights (sum to 1.0). @provisional (GDD §17: detailed resource
// simulation equations) — the relative influence of each stressor on
// biodiversity. Tunable; promote once playtesting calibrates the ecosystem
// response.
export const PROVISIONAL_ENV_BIODIVERSITY_STRESS_WEIGHTS = {
  pollution: 0.3, // soil contamination
  deforestation: 0.3, // low forest coverage
  tempAnomaly: 0.2, // climate warming
  soil: 0.1, // low soil health
  water: 0.1, // freshwater contamination
} as const;

/**
 * Compute the aggregate biodiversity stress in [0, 1+] from the environment.
 *
 * Pure: takes the environment, returns the stress value. Values above 1.0 are
 * allowed (extreme stress) — the decline term scales linearly with stress, so
 * super-threshold stress degrades the index faster.
 */
export function computeBiodiversityStress(env: EnvironmentState): number {
  const w = PROVISIONAL_ENV_BIODIVERSITY_STRESS_WEIGHTS;
  const pollutionStress = Math.min(1, env.soil.contamination / PROVISIONAL_RESOURCE_CONTAMINATION_FULL_DEGRADE);
  const deforestationStress = Math.max(0, 1 - env.forestCoverage);
  const tempAnomaly = Math.max(0, env.globalTemperature - PROVISIONAL_ENV_BASELINE_TEMP_C);
  const tempStress = tempAnomaly * PROVISIONAL_ENV_BIODIVERSITY_TEMP_STRESS_PER_DEGREE;
  const soilStress = Math.max(0, 1 - env.soil.health);
  // Freshwater contamination: normalize against the same full-degrade level
  // the soil uses (no separate freshwater-contamination constant exists in
  // P7a; @provisional — promote when the freshwater contamination model is
  // calibrated).
  const waterStress = Math.min(1, env.freshwater.contamination / PROVISIONAL_RESOURCE_CONTAMINATION_FULL_DEGRADE);
  return (
    w.pollution * pollutionStress +
    w.deforestation * deforestationStress +
    w.tempAnomaly * tempStress +
    w.soil * soilStress +
    w.water * waterStress
  );
}

/**
 * Advance the biodiversity index + species populations one tick.
 *
 * Pure: takes the environment + step length, returns a NEW biodiversity
 * object. The caller assigns it back to `env.biodiversity`. Species with a
 * population of 0 stay extinct (GDD §10.3 — some losses are irreversible).
 */
export function stepBiodiversity(
  env: EnvironmentState,
  dtSeconds: number,
): EnvironmentState['biodiversity'] {
  const dtDays = dtSeconds / SECONDS_PER_DAY;
  const b = env.biodiversity;
  const stress = computeBiodiversityStress(env);

  let index: number;
  if (stress > PROVISIONAL_ENV_BIODIVERSITY_STRESS_THRESHOLD) {
    index = b.index - PROVISIONAL_ENV_BIODIVERSITY_DECLINE_RATE * stress * dtDays;
  } else {
    index = b.index + PROVISIONAL_ENV_BIODIVERSITY_RECOVERY_RATE * (1 - stress) * dtDays;
  }
  index = Math.max(0, Math.min(1, index));

  // Species populations track the index: each scales by the index ratio. A
  // species at population 0 (extinct) stays at 0 (irreversible, GDD §10.3).
  const ratio = b.index > 0 ? index / b.index : 1;
  const speciesPopulations = b.speciesPopulations.map((sp) => ({
    speciesId: sp.speciesId,
    population: sp.population > 0 ? Math.max(0, sp.population * ratio) : 0,
  }));

  return { index, speciesPopulations };
}
