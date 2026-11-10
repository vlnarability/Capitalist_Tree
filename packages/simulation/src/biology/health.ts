/**
 * Derived overall health (GDD §5.1).
 *
 * Health is NOT an independent magic stat — it is computed each tick from
 * underlying biological factors:
 *
 *   health = w_stress * (1 - stress)
 *          + w_reserves * reserveFraction
 *          + w_foliage * foliageFraction
 *
 * Where:
 *   - stress is in [0, 1]
 *   - reserveFraction = reserves / reserveCapacity (in [0, 1])
 *   - foliageFraction = currentLeaves / leafCapacity (in [0, 1])
 *
 * Weights sum to 1 so health is in [0, 1]. A dead tree has health 0.
 *
 * Stored on the tree so consumers (P4 renderer, P3 economy for risk pricing,
 * UI panels) can read it without recomputing — but BiologySystem is the ONLY
 * writer. P0 leaves health at 1.0 as a placeholder; P1 recomputes it each tick.
 */
import type { TreeState } from '@capitalist-tree/shared';
import { computeReserveCapacity, reserveFraction } from './reserves.js';
import type { BiologyContext } from './types.js';

const W_STRESS = 0.5;
const W_RESERVES = 0.3;
const W_FOLIAGE = 0.2;

/**
 * Compute derived health in [0, 1].
 *
 * Pure: takes the tree, returns the health value. BiologySystem writes it back
 * to `tree.health`.
 */
export function computeHealth(tree: TreeState, ctx: BiologyContext): number {
  if (!tree.alive) return 0;

  const stressComponent = 1 - tree.stress;

  const capacity = computeReserveCapacity(tree, ctx.species);
  const reserveFrac = reserveFraction(tree, capacity);

  const cap = Math.max(1, tree.foliage.leafCapacity);
  const foliageFraction = Math.min(1, tree.foliage.currentLeaves / cap);

  const health =
    W_STRESS * stressComponent +
    W_RESERVES * reserveFrac +
    W_FOLIAGE * foliageFraction;

  return Math.max(0, Math.min(1, health));
}
