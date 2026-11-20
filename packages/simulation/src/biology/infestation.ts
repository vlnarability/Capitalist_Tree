/**
 * Pest + disease infestations (P12-B / GAP-18).
 *
 * Biological threats that accumulate `pest` / `disease` damage records on the
 * tree, driving the DR-1 6–12 month neglect-death target. Each tick the
 * BiologySystem rolls (via a dedicated RNG fork `BiologySystem:infestation`)
 * for a pest infestation + a disease infestation; when one takes hold, a
 * damage record is appended to `tree.damage`. The existing damage-stress
 * calculation (stress.ts: `STRESS_DAMAGE_PER_DAY × activeDamage × stepDays`)
 * + the age-based prune (biology-system.ts: `pruneDamage`) handle the rest —
 * no further wiring needed for the stress/mortality path.
 *
 * The infestation rates are per-day + scaled by `stepDays`, so the per-tick
 * probability matches the calibrated daily rate (same pattern as the weather
 * transition fix + RV4-F-H2). See `packages/shared/src/constants/biology.ts`
 * for the steady-state neglect-death analysis.
 *
 * Pure (given the RNG): takes the tree + context + an RNG fork, returns the
 * new damage records (0, 1, or 2 per call). Deterministic per seed (TDD §18.3).
 */
import type { Rng } from '../rng.js';
import type { TreeDamageState } from '@capitalist-tree/shared';
import {
  PROVISIONAL_BIOLOGY_PEST_INFESTATION_RATE_PER_DAY,
  PROVISIONAL_BIOLOGY_DISEASE_INFESTATION_RATE_PER_DAY,
  PROVISIONAL_BIOLOGY_INFESTATION_SEVERITY_MIN,
  PROVISIONAL_BIOLOGY_INFESTATION_SEVERITY_MAX,
} from '@capitalist-tree/shared';

/** A biology context — the slice of SystemContext the infestation roll needs. */
export interface InfestationContext {
  /** Current sim time (seconds since epoch) — used as the damage `appliedAt`. */
  readonly now: number;
}

/**
 * Roll for pest + disease infestations this tick.
 *
 * Returns the new damage records to append to `tree.damage` (the caller
 * appends + emits the corresponding `infestation` events). Each roll is
 * independent; both, one, or neither may fire in a single tick.
 *
 * The tree must be alive + have foliage for pests to take hold (pests eat
 * leaves); disease can take hold on any living tree. This gating keeps the
 * infestation realistic + avoids damage records on a bare/dead tree.
 */
export function rollInfestation(
  hasFoliage: boolean,
  ctx: InfestationContext,
  rng: Rng,
  stepDays: number,
): TreeDamageState[] {
  const newDamage: TreeDamageState[] = [];

  // Pest infestation — gated on foliage (pests eat leaves).
  if (hasFoliage && rng.next() < PROVISIONAL_BIOLOGY_PEST_INFESTATION_RATE_PER_DAY * stepDays) {
    newDamage.push({
      type: 'pest',
      severity: severityRoll(rng),
      appliedAt: ctx.now,
    });
  }

  // Disease infestation — can take hold on any living tree.
  if (rng.next() < PROVISIONAL_BIOLOGY_DISEASE_INFESTATION_RATE_PER_DAY * stepDays) {
    newDamage.push({
      type: 'disease',
      severity: severityRoll(rng),
      appliedAt: ctx.now,
    });
  }

  return newDamage;
}

/** Uniform severity in [MIN, MAX] for an infestation damage record. */
function severityRoll(rng: Rng): number {
  return (
    PROVISIONAL_BIOLOGY_INFESTATION_SEVERITY_MIN +
    rng.next() * (PROVISIONAL_BIOLOGY_INFESTATION_SEVERITY_MAX - PROVISIONAL_BIOLOGY_INFESTATION_SEVERITY_MIN)
  );
}
