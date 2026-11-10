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
} from '@capitalist-tree/shared';
import type { Rng } from '../rng.js';
import { computeReserveCapacity, reserveFraction } from './reserves.js';
import type { BiologyContext } from './types.js';

const SECONDS_PER_DAY = 24 * 60 * 60;

/** Cause codes emitted with the `tree-died` event. */
export type DeathCause =
  | 'reserves-exhausted'
  | 'stress'
  | 'defoliation'
  | 'structural'
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
): MortalityCheck {
  if (!tree.alive) return { died: false };

  const stepDays = ctx.stepDays;
  const capacity = computeReserveCapacity(tree, ctx.species);
  const reserveFrac = reserveFraction(tree, capacity);
  const defoliations = recentSevereDefoliations(tree, ctx.now);

  // 1. Repeated severe defoliation: if the count meets/exceeds the threshold,
  //    the tree is at high mortality risk regardless of current stress.
  if (defoliations >= PROVISIONAL_BIOLOGY_DEATH_DEFOLIATION_COUNT) {
    const prob =
      PROVISIONAL_BIOLOGY_DEATH_DAILY_PROBABILITY * stepDays * 2; // doubled for repeat events
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
    const prob = PROVISIONAL_BIOLOGY_DEATH_DAILY_PROBABILITY * stressOverage * stepDays;
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

  // 3. Stress alone (no reserves crisis) — still slow mortality risk.
  if (stressCritical) {
    const stressOverage =
      (tree.stress - PROVISIONAL_BIOLOGY_DEATH_STRESS_CRITICAL) /
      (1 - PROVISIONAL_BIOLOGY_DEATH_STRESS_CRITICAL);
    const prob = PROVISIONAL_BIOLOGY_DEATH_DAILY_PROBABILITY * 0.5 * stressOverage * stepDays;
    if (rng.next() < prob) {
      return {
        died: true,
        cause: 'stress',
        detail: `Stress at ${(tree.stress * 100).toFixed(1)}% (critical threshold ${PROVISIONAL_BIOLOGY_DEATH_STRESS_CRITICAL * 100}%).`,
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
