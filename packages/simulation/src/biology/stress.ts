/**
 * Stress accumulation and recovery (GDD §5.1, §5.6).
 *
 * Stress is a normalized [0, 1] indicator. It increases when the tree
 * experiences adverse conditions:
 *
 *   - Water deficiency (stored water below half the daily requirement).
 *   - Nutrient deficiency (any nutrient below half its requirement).
 *   - Low reserves (below PROVISIONAL_BIOLOGY_DEATH_RESERVE_CRITICAL_FRACTION).
 *   - Recent damage (defoliation, drought, etc. — recorded in `tree.damage[]`).
 *   - Winter dormancy for deciduous trees (mild stress; reserves-driven).
 *
 * Stress decreases when conditions are favourable and reserves are healthy:
 *   - No active stressors + reserves above critical → slow recovery.
 *   - Stress recovery costs energy (PROVISIONAL_BIOLOGY_STRESS_RECOVERY_ENERGY_COST
 *     per unit stress reduced).
 *
 * Pure functions: callers apply the deltas to the tree state.
 */
import type { TreeState } from '@capitalist-tree/shared';
import {
  PROVISIONAL_BIOLOGY_DEATH_RESERVE_CRITICAL_FRACTION,
  PROVISIONAL_BIOLOGY_STRESS_MAINTENANCE_MULTIPLIER,
  PROVISIONAL_BIOLOGY_STRESS_RECOVERY_ENERGY_COST,
  PROVISIONAL_BIOLOGY_STRESS_RECOVERY_RATE,
  PROVISIONAL_BIOLOGY_STRESS_WATER_PER_DAY,
  PROVISIONAL_BIOLOGY_STRESS_NUTRIENT_PER_DAY,
  PROVISIONAL_BIOLOGY_STRESS_RESERVE_PER_DAY,
  PROVISIONAL_BIOLOGY_STRESS_DAMAGE_PER_DAY,
} from '@capitalist-tree/shared';
import type { BiologyContext } from './types.js';
import { dailyWaterNeed, nutrientFactor, waterFactor } from './photosynthesis.js';
import { reserveFraction, computeReserveCapacity } from './reserves.js';

export interface StressUpdate {
  /** New stress value in [0, 1]. */
  stress: number;
  /** Energy spent on stress recovery this step (eu). >= 0. */
  recoveryCost: number;
}

/**
 * Compute stress change for one step.
 *
 * Pure: takes the tree + context, returns the new stress value and the energy
 * cost of recovery. The BiologySystem applies these and deducts recovery energy
 * from reserves.
 */
export function updateStress(tree: TreeState, ctx: BiologyContext): StressUpdate {
  if (!tree.alive) {
    return { stress: 1, recoveryCost: 0 };
  }

  const stepDays = ctx.stepDays;
  let stressAdd = 0;

  // Water deficiency stress.
  const dailyWater = dailyWaterNeed(tree, ctx.species);
  const waterF = waterFactor(tree, dailyWater);
  if (waterF < 0.5) {
    stressAdd += PROVISIONAL_BIOLOGY_STRESS_WATER_PER_DAY * (0.5 - waterF) * 2 * stepDays;
  }

  // Nutrient deficiency stress.
  const nutrientF = nutrientFactor(tree.nutrients, ctx.species.nutrientRequirement);
  if (nutrientF < 0.5) {
    stressAdd += PROVISIONAL_BIOLOGY_STRESS_NUTRIENT_PER_DAY * (0.5 - nutrientF) * 2 * stepDays;
  }

  // Low reserves stress.
  const capacity = computeReserveCapacity(tree, ctx.species);
  const reserveFrac = reserveFraction(tree, capacity);
  if (reserveFrac < PROVISIONAL_BIOLOGY_DEATH_RESERVE_CRITICAL_FRACTION) {
    stressAdd +=
      PROVISIONAL_BIOLOGY_STRESS_RESERVE_PER_DAY *
      ((PROVISIONAL_BIOLOGY_DEATH_RESERVE_CRITICAL_FRACTION - reserveFrac) /
        PROVISIONAL_BIOLOGY_DEATH_RESERVE_CRITICAL_FRACTION) *
      stepDays;
  }

  // Active damage stress — each unresolved damage record contributes.
  // (Damage records decay naturally via age; the BiologySystem prunes them.)
  const activeDamage = tree.damage.length;
  stressAdd += PROVISIONAL_BIOLOGY_STRESS_DAMAGE_PER_DAY * activeDamage * stepDays;

  // Stress recovery: if no major stressors (water OK, nutrients OK, reserves
  // OK), slowly recover. Recovery costs energy — only recover if we have
  // stress to reduce and reserves are above the critical threshold.
  let recoveryCost = 0;
  let stressReduce = 0;
  const conditionsFavourable =
    waterF >= 0.5 && nutrientF >= 0.5 && reserveFrac >= PROVISIONAL_BIOLOGY_DEATH_RESERVE_CRITICAL_FRACTION;
  if (conditionsFavourable && tree.stress > 0) {
    const recoveryPerDay = PROVISIONAL_BIOLOGY_STRESS_RECOVERY_RATE;
    stressReduce = Math.min(tree.stress, recoveryPerDay * stepDays);
    recoveryCost = stressReduce * PROVISIONAL_BIOLOGY_STRESS_RECOVERY_ENERGY_COST;
  }

  const newStress = Math.max(0, Math.min(1, tree.stress + stressAdd - stressReduce));

  return { stress: newStress, recoveryCost };
}

/**
 * Stress maintenance multiplier — exposed for the energy-allocation module
 * to use (it's already imported there; re-exported here for callers that
 * want the same source of truth).
 */
export const STRESS_MAINTENANCE_MULTIPLIER = PROVISIONAL_BIOLOGY_STRESS_MAINTENANCE_MULTIPLIER;
