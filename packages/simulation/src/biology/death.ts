/**
 * Tree death (TDD §7, GDD §5.6).
 *
 * Death can result from:
 *   - Repeated severe defoliation (>= PROVISIONAL_BIOLOGY_DEATH_DEFOLIATION_COUNT
 *     events within PROVISIONAL_BIOLOGY_DEATH_DEFOLIATION_WINDOW_DAYS).
 *   - Exhausted energy reserves (reserves below critical threshold).
 *   - Severe drought (waterF = 0 for prolonged period — tracked via stress).
 *   - Prolonged nutrient deficiencies (tracked via stress).
 *   - Disease / pest damage (P6+ — recorded in `tree.damage[]`).
 *
 * Death is permanent for the original tree (GDD §16.3): once alive=false, the
 * tree persists as a stump/dead trunk but cannot revive.
 *
 * The mortality check uses a daily probability when conditions are critical, so
 * death is stochastic but deterministic given the RNG seed.
 */
import type { TreeState } from '@capitalist-tree/shared';
import {
  PROVISIONAL_BIOLOGY_DEATH_CRITICAL_STRESS_PER_DAY,
  PROVISIONAL_BIOLOGY_DEATH_DAILY_PROBABILITY,
  PROVISIONAL_BIOLOGY_DEATH_DEFOLIATION_COUNT,
  PROVISIONAL_BIOLOGY_DEATH_DEFOLIATION_WINDOW_DAYS,
  PROVISIONAL_BIOLOGY_DEATH_RESERVE_CRITICAL_FRACTION,
  PROVISIONAL_BIOLOGY_DEATH_STRESS_CRITICAL,
  PROVISIONAL_BIOLOGY_WEAR_DEATH_THRESHOLD,
  PROVISIONAL_BIOLOGY_WEAR_MORTALITY_ONSET,
} from '@capitalist-tree/shared';
import type { Rng } from '../rng.js';
import { computeReserveCapacity, reserveFraction } from './reserves.js';
import type { BiologyContext } from './types.js';
import { type BiologyParameters, NEUTRAL_BIOLOGY_PARAMS } from '../progression/trait-effects.js';

const SECONDS_PER_DAY = 24 * 60 * 60;

/** Cause codes emitted with the `tree-died` event. */
export type DeathCause =
  | 'reserves-exhausted'
  | 'stress'
  | 'defoliation'
  | 'structural'
  | 'wear'
  | 'unknown';

export interface MortalityCheck {
  /** True if the tree died this step. */
  died: boolean;
  /** Cause code (only meaningful when died === true). */
  cause?: DeathCause;
  /** Human-readable diagnostic for the event log. */
  detail?: string;
}

/**
 * Count severe defoliation events within the rolling window.
 *
 * Severe defoliations are recorded in `tree.damage[]` with `type: 'severe-defoliation'`.
 * The window is in simulation days; we convert to seconds for comparison with
 * `appliedAt` (which is in sim seconds).
 */
export function recentSevereDefoliations(tree: TreeState, nowSeconds: number): number {
  const windowSeconds = PROVISIONAL_BIOLOGY_DEATH_DEFOLIATION_WINDOW_DAYS * SECONDS_PER_DAY;
  const cutoff = nowSeconds - windowSeconds;
  return tree.damage.filter(
    (d) => d.type === 'severe-defoliation' && d.appliedAt >= cutoff,
  ).length;
}

/**
 * Check whether the tree dies this step.
 *
 * Pure (given the RNG): takes the tree + context + an RNG fork, returns the
 * mortality result. BiologySystem applies `alive = false` if died and emits
 * the `tree-died` event.
 *
 * The probability is per-day; we scale by stepDays. A tree that's already
 * dead stays dead (idempotent).
 */
export function checkMortality(
  tree: TreeState,
  ctx: BiologyContext,
  rng: Rng,
  /** P11 (W32): trait-adjusted multipliers. Defaults to neutral. */
  params: BiologyParameters = NEUTRAL_BIOLOGY_PARAMS,
): MortalityCheck {
  if (!tree.alive) return { died: false };

  const stepDays = ctx.stepDays;
  // P11 (W32): pass params so reservesCapacityMultiplier (thick-trunk) is
  // honoured — a larger reserve capacity raises reserveFrac → lower mortality.
  const capacity = computeReserveCapacity(tree, ctx.species, params);
  const reserveFrac = reserveFraction(tree, capacity);
  const defoliations = recentSevereDefoliations(tree, ctx.now);

  // P11 (W32): frostSurvivalMultiplier scales the mortality probability when
  // the tree has recent frost damage (the cold-resistance benefit — +50% frost
  // survival at magnitude 1). frostSurvivalMultiplier > 1 = better survival →
  // LOWER death prob (prob × 1/multiplier). Only applies when frost damage is
  // present (cold-resistance is irrelevant in frost-free conditions). The
  // window matches the defoliation prune window so "recent" is consistent.
  const frostWindowSeconds = PROVISIONAL_BIOLOGY_DEATH_DEFOLIATION_WINDOW_DAYS * SECONDS_PER_DAY;
  const hasRecentFrost = tree.damage.some(
    (d) => d.type === 'weather:frost' && d.appliedAt >= ctx.now - frostWindowSeconds,
  );
  const frostSurvivalFactor = hasRecentFrost ? 1 / params.frostSurvivalMultiplier : 1;

  // 1. Repeated severe defoliation: if the count meets/exceeds the threshold,
  //    the tree is at high mortality risk regardless of current stress.
  if (defoliations >= PROVISIONAL_BIOLOGY_DEATH_DEFOLIATION_COUNT) {
    const prob =
      PROVISIONAL_BIOLOGY_DEATH_DAILY_PROBABILITY * stepDays * 2 * frostSurvivalFactor; // doubled for repeat events
    if (rng.next() < prob) {
      return {
        died: true,
        cause: 'defoliation',
        detail: `Repeated severe defoliation (${defoliations} events in last ${PROVISIONAL_BIOLOGY_DEATH_DEFOLIATION_WINDOW_DAYS} days) exceeded mortality threshold.`,
      };
    }
  }

  // 2. Exhausted reserves + critical stress.
  const reservesCritical = reserveFrac < PROVISIONAL_BIOLOGY_DEATH_RESERVE_CRITICAL_FRACTION;
  const stressCritical = tree.stress >= PROVISIONAL_BIOLOGY_DEATH_STRESS_CRITICAL;
  if (reservesCritical && stressCritical) {
    // Probability rises with stress above the critical threshold.
    const stressOverage =
      (tree.stress - PROVISIONAL_BIOLOGY_DEATH_STRESS_CRITICAL) /
      (1 - PROVISIONAL_BIOLOGY_DEATH_STRESS_CRITICAL);
    const prob = PROVISIONAL_BIOLOGY_DEATH_DAILY_PROBABILITY * stressOverage * stepDays * frostSurvivalFactor;
    if (rng.next() < prob) {
      return {
        died: true,
        cause: 'reserves-exhausted',
        detail: `Reserves at ${(reserveFrac * 100).toFixed(1)}% of capacity and stress at ${(tree.stress * 100).toFixed(1)}%.`,
      };
    }
    // Add critical stress for the next tick's accumulation.
    return { died: false };
  }

  // 3. (Removed in P12-C redesign) Stress-alone mortality path. Pre-P12-C this
  //    fired when stress >= STRESS_CRITICAL (regardless of reserves), killing
  //    the idle tree at ~3mo via the infestation-driven stress — before the
  //    wear path's ~6mo onset could fire, defeating the DR-1 6-12mo target.
  //    The chronic-neglect case is now handled by the wear path (path 4 below),
  //    which is robust against the activeDamage prune-window fluctuation +
  //    Poisson variance. The acute-crisis case (stress + depleted reserves)
  //    is still handled by path 2 above. A stressed-but-resilient tree (high
  //    stress, high reserves) now lingers until the wear accumulates —
  //    consistent, since the wear reflects the same chronic damage.

  // 4. Cumulative wear (P12-C redesign — chronic neglect). The monotonic wear
  //    counter accumulates non-weather damage severity (pest/disease/
  //    severe-defoliation) + never decays. When it crosses the onset, the
  //    mortality probability ramps linearly to DEATH_DAILY_PROBABILITY at the
  //    threshold. This gives a reliable 6-12mo neglect death regardless of the
  //    activeDamage prune-window fluctuation + Poisson variance that makes the
  //    stress-based paths fragile near the recovery threshold.
  if (tree.wear > PROVISIONAL_BIOLOGY_WEAR_MORTALITY_ONSET) {
    const wearOverage =
      (tree.wear - PROVISIONAL_BIOLOGY_WEAR_MORTALITY_ONSET) /
      (PROVISIONAL_BIOLOGY_WEAR_DEATH_THRESHOLD - PROVISIONAL_BIOLOGY_WEAR_MORTALITY_ONSET);
    const prob =
      PROVISIONAL_BIOLOGY_DEATH_DAILY_PROBABILITY * Math.min(1, wearOverage) * stepDays * frostSurvivalFactor;
    if (rng.next() < prob) {
      return {
        died: true,
        cause: 'wear',
        detail: `Cumulative wear ${tree.wear.toFixed(2)} (onset ${PROVISIONAL_BIOLOGY_WEAR_MORTALITY_ONSET}, threshold ${PROVISIONAL_BIOLOGY_WEAR_DEATH_THRESHOLD}) — chronic neglect from accumulated pest/disease/severe-defoliation damage.`,
      };
    }
  }

  return { died: false };
}

/**
 * Per-day stress accumulation when in a critical state (reserves low or stress
 * high). Used by the BiologySystem to escalate toward death rather than letting
 * a near-dead tree linger indefinitely. PROVISIONAL.
 */
export function criticalStressPerDay(): number {
  return PROVISIONAL_BIOLOGY_DEATH_CRITICAL_STRESS_PER_DAY;
}
