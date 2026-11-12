/**
 * Soil dynamics (TDD §13 Environment System, §8.3; GDD §10.1).
 *
 * Pure helper that advances the soil's extension-point dynamics one tick and
 * nudges `soil.health` from the EnvironmentSystem's specific degradation /
 * recovery rates. The EnvironmentSystem calls this after the water step; it
 * never mutates its input.
 *
 * The ResourceSystem (slot #4) already derives `soil.health` each tick from
 * the base factors (organic matter, nutrients, moisture, contamination) via
 * `computeSoilHealth` — with the extension-point factors (pH, compaction,
 * microbial activity) stubbed at full contribution (factor = 1.0). The
 * EnvironmentSystem (slot #10) runs after it and:
 *
 *   1. Decays `compaction` slowly toward 0 (root penetration + natural
 *      loosening undo past compaction).
 *   2. Moves `microbialActivity` toward a target derived from `organicMatter`
 *      (more organic matter → more microbial activity; the two are coupled in
 *      real soils).
 *   3. Nudges `health` with the ENV-specific degradation + recovery rates:
 *        health -= contaminationStress * DEGRADATION_RATE * dtDays
 *        health += organicRecovery  * RECOVERY_RATE  * dtDays
 *      Recovery is slower than degradation (PROVISIONAL_ENV_SOIL_RECOVERY_RATE
 *      < PROVISIONAL_ENV_SOIL_DEGRADATION_RATE) — GDD §10.3 "recovery ...
 *      depends on the severity ... recovery lags remediation". The nudge is
 *      applied ON TOP of the ResourceSystem's derived value, so the final
 *      health reflects both the static factor model and the dynamic evolution.
 *
 * The EnvironmentSystem does NOT touch `soil.soilWater`, `soil.nutrients`, or
 * the base `soil.organicMatter` / `soil.contamination` accumulators — those
 * are the ResourceSystem's fields (rule: biology/resources consistent, the
 * EnvironmentSystem reads biology/resources outputs but does not modify them).
 *
 * @provisional overlap with ResourceSystem: both systems write `soil.health`.
 * ResourceSystem's write is the static derivation; the EnvironmentSystem's is
 * a dynamic nudge layered on top. The layering is intentional (the ENV rates
 * are slower + asymmetric) but a future refactor may fold both into one
 * owner. The pure `stepSoil` function is unit-tested in isolation.
 */
import type { EnvironmentState } from '@capitalist-tree/shared';
import {
  PROVISIONAL_ENV_SOIL_DEGRADATION_RATE,
  PROVISIONAL_ENV_SOIL_RECOVERY_RATE,
  PROVISIONAL_RESOURCE_CONTAMINATION_FULL_DEGRADE,
  PROVISIONAL_RESOURCE_ORGANIC_MATTER_SATURATION,
} from '@capitalist-tree/shared';

const SECONDS_PER_DAY = 24 * 60 * 60;

// @provisional (GDD §17: Environmental recovery timescales) — fraction of the
// compaction removed per sim day by root penetration + natural loosening.
// Slow (0.005/day) so compaction from heavy equipment lingers across many
// ticks. Tunable; promote once the soil-compaction model is calibrated.
export const PROVISIONAL_ENV_COMPACTION_DECAY_RATE = 0.005; // per sim day

// @provisional (GDD §17: detailed resource simulation equations) — rate at
// which `microbialActivity` moves toward its organic-matter-derived target per
// sim day. Small (0.05/day) so microbial populations track organic matter
// slowly (real-world microbial turnover is ~weeks). Tunable.
export const PROVISIONAL_ENV_MICROBIAL_RESPONSE_RATE = 0.05; // per sim day

/**
 * Compute the target microbial activity (in [0, 1+]) for a given organic
 * matter level. More organic matter → more microbial activity. Saturates at
 * the organic-matter saturation level (factor → 1.0); above it, microbes can
 * exceed baseline (factor > 1.0) up to a cap.
 *
 * Pure: takes the organic matter value, returns the target activity.
 */
export function microbialTarget(organicMatter: number): number {
  if (organicMatter <= 0) return 0;
  const sat = Math.min(1, organicMatter / PROVISIONAL_RESOURCE_ORGANIC_MATTER_SATURATION);
  // Linear from 0 (no organic matter) to 1.0 (at saturation) to ~1.3 (well
  // above saturation). Capped at 1.3 so a microbial bloom doesn't run away.
  return Math.min(1.3, sat * 1.0 + Math.max(0, organicMatter - PROVISIONAL_RESOURCE_ORGANIC_MATTER_SATURATION) / PROVISIONAL_RESOURCE_ORGANIC_MATTER_SATURATION * 0.3);
}

/**
 * Advance the soil's extension-point dynamics + health nudge one tick.
 *
 * Pure: takes the environment + step length, returns a NEW soil object. The
 * caller assigns it back to `env.soil`.
 */
export function stepSoil(
  env: EnvironmentState,
  dtSeconds: number,
): EnvironmentState['soil'] {
  const dtDays = dtSeconds / SECONDS_PER_DAY;
  const s = env.soil;

  // 1. Compaction decays slowly toward 0.
  const compaction = Math.max(0, s.compaction - s.compaction * PROVISIONAL_ENV_COMPACTION_DECAY_RATE * dtDays);

  // 2. Microbial activity moves toward the organic-matter-derived target.
  const target = microbialTarget(s.organicMatter);
  const microbialActivity = Math.max(0, s.microbialActivity + (target - s.microbialActivity) * PROVISIONAL_ENV_MICROBIAL_RESPONSE_RATE * dtDays);

  // 3. Health nudge: degradation from contamination stress, recovery from
  //    organic matter. Both rates are per-tick; scaled by dtDays so a longer
  //    step accumulates proportionally.
  const contaminationStress = Math.min(1, s.contamination / PROVISIONAL_RESOURCE_CONTAMINATION_FULL_DEGRADE);
  const organicRecovery = Math.min(1, s.organicMatter / PROVISIONAL_RESOURCE_ORGANIC_MATTER_SATURATION);
  const healthDelta =
    organicRecovery * PROVISIONAL_ENV_SOIL_RECOVERY_RATE * dtDays
    - contaminationStress * PROVISIONAL_ENV_SOIL_DEGRADATION_RATE * dtDays;
  const health = Math.max(0, Math.min(1, s.health + healthDelta));

  return {
    ...s,
    compaction,
    microbialActivity,
    health,
  };
}
