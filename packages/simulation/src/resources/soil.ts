/**
 * Soil health derivation (TDD §8.3, GDD §10.1).
 *
 * Soil health is a DERIVED indicator — it is NOT an independent stat. It is
 * recomputed each tick from underlying factors:
 *
 *   health = w_organic * organicFrac
 *          + w_nutrients * nutrientFrac
 *          + w_moisture * moistureFrac
 *          + w_contamination * (1 - contaminationFrac)
 *          + w_ph * phFrac                      // P12-D: tent around pH 6.5
 *          + w_compaction * (1 - compactionFrac) // P12-D: linear
 *          + w_microbial * microbialFrac         // P12-D: direct
 *
 * Where each `*Frac` is in [0, 1]. Weights sum to 1.0 (defined in
 * PROVISIONAL_RESOURCE_SOIL_HEALTH_WEIGHTS). P12-D (GAP-20) promoted the pH,
 * compaction, + microbial factors from P2 stubs (always 1.0) into modeled
 * dynamics: pH is a symmetric tent around the ideal (6.5) — strongly acidic
 * or alkaline soils lock up nutrients + suppress microbes; compaction reduces
 * root respiration + infiltration linearly; microbial activity drives organic
 * matter decomposition + nutrient cycling directly.
 *
 * PROVISIONAL: every tuning constant here lives in
 * `packages/shared/src/constants/resources.ts` and is marked with the GDD
 * §17 item it resolves (e.g., "detailed resource simulation equations").
 *
 * Pure functions: callers apply the result to env.soil.health.
 */
import type { EnvironmentState, NutrientState } from '@capitalist-tree/shared';
import {
  PROVISIONAL_RESOURCE_CONTAMINATION_FULL_DEGRADE,
  PROVISIONAL_RESOURCE_IDEAL_SOIL_WATER_FRACTION,
  PROVISIONAL_RESOURCE_ORGANIC_MATTER_SATURATION,
  PROVISIONAL_RESOURCE_SOIL_HEALTH_WEIGHTS,
  PROVISIONAL_RESOURCE_SOIL_NUTRIENT_CAPACITY,
  PROVISIONAL_RESOURCE_SOIL_PH_IDEAL,
  PROVISIONAL_RESOURCE_SOIL_PH_TOLERANCE,
  PROVISIONAL_RESOURCE_SOIL_WATER_CAPACITY,
} from '@capitalist-tree/shared';

/**
 * Compute the organic-matter component of soil health in [0, 1].
 *
 *   organicFrac = min(1, organicMatter / ORGANIC_MATTER_SATURATION)
 *
 * At or above the saturation level, organic matter contributes its full
 * weight to health. Below, it scales linearly.
 *
 * Pure: takes the organic matter value, returns the fraction.
 */
export function organicMatterFraction(organicMatter: number): number {
  if (organicMatter <= 0) return 0;
  return Math.min(1, organicMatter / PROVISIONAL_RESOURCE_ORGANIC_MATTER_SATURATION);
}

/**
 * Compute the nutrient component of soil health in [0, 1].
 *
 * Uses the Liebig minimum of N, P, K relative to the soil nutrient capacity.
 * This mirrors the BiologySystem's nutrientFactor logic: the scarcest
 * nutrient limits the soil's productivity.
 *
 * Pure: takes the nutrient state, returns the fraction.
 */
export function nutrientFraction(nutrients: NutrientState): number {
  const cap = PROVISIONAL_RESOURCE_SOIL_NUTRIENT_CAPACITY;
  if (cap <= 0) return 1;
  const n = Math.min(1, nutrients.nitrogen / cap);
  const p = Math.min(1, nutrients.phosphorus / cap);
  const k = Math.min(1, nutrients.potassium / cap);
  return Math.max(0, Math.min(n, p, k, 1));
}

/**
 * Compute the moisture component of soil health in [0, 1].
 *
 * Soil water is best at IDEAL_SOIL_WATER_FRACTION (50% of capacity by default).
 * Below: drought stress reduces the factor. Above: waterlogging reduces it.
 * A simple triangle: 0 at 0%, 1 at IDEAL%, 0 at 100% (linear interpolation).
 *
 * Pure: takes the soil water content, returns the fraction.
 */
export function moistureFraction(soilWater: number): number {
  const cap = PROVISIONAL_RESOURCE_SOIL_WATER_CAPACITY;
  if (cap <= 0) return 1;
  const frac = Math.min(1, Math.max(0, soilWater / cap));
  const ideal = PROVISIONAL_RESOURCE_IDEAL_SOIL_WATER_FRACTION;
  if (frac <= ideal) {
    return frac / ideal;
  }
  // Above ideal: linear decline to 0 at 100%.
  return Math.max(0, (1 - frac) / (1 - ideal));
}

/**
 * Compute the contamination component of soil health in [0, 1].
 *
 *   contaminationFrac = 1 - min(1, contamination / CONTAMINATION_FULL_DEGRADE)
 *
 * At zero contamination, the factor is 1 (no harm). At CONTAMINATION_FULL_DEGRADE
 * or above, the factor is 0 (fully degraded).
 *
 * Pure: takes the contamination value, returns the fraction.
 */
export function contaminationFraction(contamination: number): number {
  if (contamination <= 0) return 1;
  return Math.max(0, 1 - Math.min(1, contamination / PROVISIONAL_RESOURCE_CONTAMINATION_FULL_DEGRADE));
}

/**
 * Compute the pH component of soil health in [0, 1] (P12-D / GAP-20).
 *
 * Most nutrients are maximally available near pH 6.5 (slightly acidic).
 * Strongly acidic (< ~5) or alkaline (> ~8) soils lock up N/P/K + suppress
 * microbial function. Modeled as a symmetric tent: 1.0 at PH_IDEAL, declining
 * linearly to 0 at PH_IDEAL ± PH_TOLERANCE. Outside the tent the factor is 0.
 *
 *   phFrac = clamp(1 - |ph - ideal| / tolerance, 0, 1)
 *
 * Pure: takes the soil pH, returns the fraction.
 */
export function phFraction(ph: number): number {
  const ideal = PROVISIONAL_RESOURCE_SOIL_PH_IDEAL;
  const tolerance = PROVISIONAL_RESOURCE_SOIL_PH_TOLERANCE;
  if (tolerance <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - Math.abs(ph - ideal) / tolerance));
}

/**
 * Compute the compaction component of soil health in [0, 1] (P12-D / GAP-20).
 *
 * Compaction (in [0, 1], 0 = loose, 1 = fully compacted) reduces root
 * respiration, water infiltration, + nutrient uptake linearly. The factor is
 * the complement: 1 at no compaction, 0 at fully compacted.
 *
 *   compactionFrac = 1 - clamp(compaction, 0, 1)
 *
 * Pure: takes the compaction value, returns the fraction.
 */
export function compactionFraction(compaction: number): number {
  if (compaction <= 0) return 1;
  if (compaction >= 1) return 0;
  return 1 - compaction;
}

/**
 * Compute the microbial-activity component of soil health in [0, 1]
 * (P12-D / GAP-20).
 *
 * Microbial activity (in [0, 1], 1 = thriving) drives organic-matter
 * decomposition + nutrient cycling. The factor is the activity value directly:
 * 1 at thriving, 0 at microbe-dead.
 *
 *   microbialFrac = clamp(microbialActivity, 0, 1)
 *
 * Pure: takes the microbial-activity value, returns the fraction.
 */
export function microbialFraction(microbialActivity: number): number {
  if (microbialActivity <= 0) return 0;
  if (microbialActivity >= 1) return 1;
  return microbialActivity;
}

/**
 * Compute derived soil health in [0, 1] from the underlying factors.
 *
 * Pure: takes the environment state, returns the health value. Caller writes
 * it back to env.soil.health.
 */
export function computeSoilHealth(env: EnvironmentState): number {
  const w = PROVISIONAL_RESOURCE_SOIL_HEALTH_WEIGHTS;
  const organicFrac = organicMatterFraction(env.soil.organicMatter);
  const nutrientFrac = nutrientFraction(env.soil.nutrients);
  const moistFrac = moistureFraction(env.soil.soilWater);
  const contamFrac = contaminationFraction(env.soil.contamination);

  // P12-D (GAP-20): promoted from P2 stubs (always 1.0) into modeled dynamics.
  // pH tent around the ideal, compaction complement, microbial direct.
  const phFrac = phFraction(env.soil.ph);
  const compactionFrac = compactionFraction(env.soil.compaction);
  const microbialFrac = microbialFraction(env.soil.microbialActivity);

  const health =
    w.organicMatter * organicFrac +
    w.nutrients * nutrientFrac +
    w.moisture * moistFrac +
    w.contamination * contamFrac +
    w.ph * phFrac +
    w.compaction * compactionFrac +
    w.microbial * microbialFrac;

  return Math.max(0, Math.min(1, health));
}
