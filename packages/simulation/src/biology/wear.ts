/**
 * Wear recovery (W59 / GDD §5.6).
 *
 * Pre-W59, `tree.wear` was a strictly monotonic counter that NEVER decayed.
 * Ambient pest/disease infestations added ~0.026 wear/day regardless of player
 * care, so even a perfectly-cared-for tree crossed the mortality onset (3.0) at
 * ~3-6mo + died. This made the "sustainable" playstyle impossible: the W58
 * design-promise bot found the tree dies at day 85 under sustainable harvesting.
 *
 * W59 adds a wear-recovery path (mirroring `updateStress`'s recovery in
 * `stress.ts`). When conditions are favourable (water/nutrient/reserves all OK)
 * AND there's been no severe-defoliation in the last 7 days, wear decays at
 * `PROVISIONAL_BIOLOGY_WEAR_RECOVERY_RATE_PER_DAY`. The rate (0.04/day) exceeds
 * the ambient infestation rate (~0.026/day), so a cared-for tree nets out
 * ~0.014/day wear recovery — it can sustain indefinite sustainable harvesting.
 *
 * Pure function: the caller (BiologySystem) applies the new wear value + deducts
 * the recovery energy cost from reserves.
 */
import type { TreeState } from '@capitalist-tree/shared';
import {
  PROVISIONAL_BIOLOGY_DEATH_RESERVE_CRITICAL_FRACTION,
  PROVISIONAL_BIOLOGY_WEAR_RECOVERY_RATE_PER_DAY,
  PROVISIONAL_BIOLOGY_WEAR_RECOVERY_PROPORTIONAL_FRACTION_PER_DAY,
  PROVISIONAL_BIOLOGY_WEAR_RECOVERY_ENERGY_COST,
} from '@capitalist-tree/shared';
import type { BiologyContext } from './types.js';
import { dailyWaterNeed, nutrientFactor, waterFactor } from './photosynthesis.js';
import { reserveFraction, computeReserveCapacity } from './reserves.js';

const DAY = 86_400;

/** A severe-defoliation within this window blocks wear recovery (acute crisis). */
const WEAR_RECOVERY_RECENT_DEFOLIATION_WINDOW_DAYS = 7;

export interface WearUpdate {
  /** New wear value (>= 0). */
  wear: number;
  /** Energy spent on wear recovery this step (eu). >= 0. */
  recoveryCost: number;
}

/**
 * Compute wear recovery for one step.
 *
 * Returns the new wear value + the energy cost of recovery. The BiologySystem
 * applies these + deducts the recovery energy from reserves (alongside the
 * stress-recovery cost).
 *
 * Recovery is gated on:
 *   - Tree is alive + has wear > 0.
 *   - Conditions favourable: water/nutrient/reserves all above their critical
 *     thresholds (same gate as stress recovery — a neglected tree does NOT
 *     recover wear, so chronic neglect still kills the tree).
 *   - No severe-defoliation in the last
 *     `WEAR_RECOVERY_RECENT_DEFOLIATION_WINDOW_DAYS` days — a recently
 *     over-harvested tree is in acute crisis + can't recover chronic wear.
 */
export function recoverWear(tree: TreeState, ctx: BiologyContext): WearUpdate {
  if (!tree.alive || tree.wear <= 0) {
    return { wear: tree.wear, recoveryCost: 0 };
  }

  const stepDays = ctx.stepDays;
  const dailyWater = dailyWaterNeed(tree, ctx.species);
  const waterF = waterFactor(tree, dailyWater);
  const nutrientF = nutrientFactor(tree.nutrients, ctx.species.nutrientRequirement);
  const capacity = computeReserveCapacity(tree, ctx.species);
  const reserveFrac = reserveFraction(tree, capacity);

  const conditionsFavourable =
    waterF >= 0.5 &&
    nutrientF >= 0.5 &&
    reserveFrac >= PROVISIONAL_BIOLOGY_DEATH_RESERVE_CRITICAL_FRACTION;

  // Block recovery if there's a recent severe-defoliation (acute crisis).
  const recentSevereDefoliation = tree.damage.some(
    (d) =>
      d.type === 'severe-defoliation' &&
      ctx.now - d.appliedAt < WEAR_RECOVERY_RECENT_DEFOLIATION_WINDOW_DAYS * DAY,
  );

  if (!conditionsFavourable || recentSevereDefoliation) {
    return { wear: tree.wear, recoveryCost: 0 };
  }

  // W78 (2026-11-25): hybrid recovery — the flat rate is a floor for low-wear
  // clearance, but a mature tree's disease-driven wear peaks escalate beyond
  // what the flat rate can clear (the 25yr long-horizon test found wear peaks
  // climbing 0.96 -> 2.13 as the tree grows, killing it at 9-17yr). The
  // proportional term (wear × fraction per day) is self-stabilizing: high wear
  // recovers fast, pulling peaks back down. The flat floor ensures low wear
  // still clears to ~0 quickly (no exponential lingering).
  const flatReduce = PROVISIONAL_BIOLOGY_WEAR_RECOVERY_RATE_PER_DAY * stepDays;
  const proportionalReduce =
    tree.wear * PROVISIONAL_BIOLOGY_WEAR_RECOVERY_PROPORTIONAL_FRACTION_PER_DAY * stepDays;
  const wearReduce = Math.min(tree.wear, Math.max(flatReduce, proportionalReduce));
  const recoveryCost = wearReduce * PROVISIONAL_BIOLOGY_WEAR_RECOVERY_ENERGY_COST;

  return { wear: tree.wear - wearReduce, recoveryCost };
}
