/**
 * Energy reserves (TDD §7.4, GDD §5.3).
 *
 * The reserve system tracks accumulated stored energy:
 *
 *   new_reserves =
 *     previous_reserves
 *     + stored photosynthetic energy (from allocation surplus)
 *     - maintenance deficit (when production < maintenance)
 *     - recovery consumption (stress recovery)
 *     - other metabolic costs (P2+ will add drought/stress responses here)
 *
 * Reserve capacity scales with structural development (GDD §5.3: "Mature,
 * healthy trees can accumulate larger reserves"). A sapling has small reserves;
 * a mature oak can stockpile thousands of eu.
 *
 * Reserve depletion increases mortality risk (GDD §5.6).
 *
 * Pure functions: callers apply the deltas to the tree state.
 */
import type { TreeState, TreeSpecies } from '@capitalist-tree/shared';
import {
  PROVISIONAL_BIOLOGY_LEAF_CAPACITY_PER_BRANCH,
  PROVISIONAL_BIOLOGY_RESERVE_CAPACITY_DEVELOPMENT_GAIN,
} from '@capitalist-tree/shared';
import type { BiologyContext } from './types.js';
import { biomassScore } from './energy-allocation.js';

/**
 * Current reserve capacity (eu) given the tree's development and species.
 *
 * Capacity interpolates between the sapling baseline (`species.initial.reserveCapacity`,
 * small — a sapling has small reserves) and the mature baseline scaled by biomass:
 *
 *   capacity = initial.reserveCapacity
 *            + species.reserveCapacity * (biomass / 4) * DEVELOPMENT_GAIN
 *
 * `biomassScore` is in [0, 4] (0 = sapling, 4 = full canopy + max roots).
 * For a sapling (biomass ≈ 0.1) the capacity is close to `initial.reserveCapacity`
 * (~50 eu for White Oak). A mature tree (biomass = 4) reaches
 * `species.reserveCapacity * DEVELOPMENT_GAIN` (~1000 eu). This matches GDD §5.3
 * ("Young trees have relatively small reserves; mature, healthy trees can
 * accumulate larger reserves") without inflating sapling capacity.
 *
 * The result is always >= `species.initial.reserveCapacity` (or 1, whichever is
 * larger) so a sapling always has a non-trivial reserve buffer.
 */
export function computeReserveCapacity(
  tree: TreeState,
  species: TreeSpecies,
): number {
  const biomass = biomassScore(tree, species);
  const baseline = Math.max(1, species.initial.reserveCapacity);
  const developed =
    species.reserveCapacity * (biomass / 4) * PROVISIONAL_BIOLOGY_RESERVE_CAPACITY_DEVELOPMENT_GAIN;
  return Math.max(1, baseline + developed);
}

/**
 * Apply reserve changes for one step.
 *
 *   reserves = clamp(reserves + reserveStorage - reserveDraw - recoveryCost,
 *                    0, capacity)
 *
 * `reserveStorage` is surplus energy allocated to reserves.
 * `reserveDraw` is the deficit drawn to cover maintenance.
 * `recoveryCost` is the energy spent reducing stress (see stress.ts).
 *
 * Returns the updated reserves value (caller writes it back to the tree).
 * NEVER returns negative — reserves are clamped at 0.
 */
export function applyReserveDelta(
  tree: TreeState,
  capacity: number,
  reserveStorage: number,
  reserveDraw: number,
  recoveryCost: number,
): number {
  const next =
    tree.energy.reserves + reserveStorage - reserveDraw - recoveryCost;
  return Math.max(0, Math.min(capacity, next));
}

/**
 * Compute the tree's current leaf capacity (GDD §5.1 "leafCapacity").
 *
 * Leaf capacity grows with branch development. A sapling starts with
 * `species.initial.leafCapacity`; each unit of branch development adds
 * `PROVISIONAL_BIOLOGY_LEAF_CAPACITY_PER_BRANCH` leaves.
 *
 *   capacity = initial.leafCapacity + branchDevelopment * PER_BRANCH
 *
 * The BiologySystem updates `tree.foliage.leafCapacity` each step from this.
 */
export function computeLeafCapacity(
  branchDevelopment: number,
  initialLeafCapacity: number,
): number {
  return Math.floor(
    initialLeafCapacity + branchDevelopment * PROVISIONAL_BIOLOGY_LEAF_CAPACITY_PER_BRANCH,
  );
}

/**
 * Fraction of reserve capacity currently filled, in [0, 1].
 *
 * Used by mortality checks and the health derivation.
 */
export function reserveFraction(tree: TreeState, capacity: number): number {
  if (capacity <= 0) return 0;
  return Math.max(0, Math.min(1, tree.energy.reserves / capacity));
}

/** Re-exported for the biology system to pass through. */
export { biomassScore } from './energy-allocation.js';
export type { BiologyContext };
