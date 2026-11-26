/**
 * Timber yield computation (W-axe — the wood value of felling a tree).
 *
 * Pure: `computeTimberYield(tree, species)` returns the wood volume
 * (`biomassScore`, the canonical [0,4] "how big is the tree" metric from
 * `energy-allocation.ts`) + a quality factor (structural integrity × health,
 * reduced by wear + stress) + the sell value in bigint minor currency.
 *
 * Mirrors the leaf-harvest value pattern
 * (`BigInt(leavesHarvested) * BigInt(species.leafDenominationMinor)` in
 * `biology/harvest.ts:146`) but uses a flat per-biomass timber value
 * (`PROVISIONAL_TIMBER_VALUE_PER_BIOMASS_MINOR`) rather than a per-species
 * denomination — sufficient for the initial feature; a per-species
 * `woodDenominationMinor` field can be added later if differentiation is
 * needed.
 */
import type { TreeState, TreeSpecies } from '@capitalist-tree/shared';
import { PROVISIONAL_TIMBER_VALUE_PER_BIOMASS_MINOR } from '@capitalist-tree/shared';
import { biomassScore } from './energy-allocation.js';

/** The wood yield from felling a tree. Pure — no state mutation. */
export interface TimberYield {
  /** Raw wood volume metric — `biomassScore(tree, species)` ∈ [0, 4]. */
  readonly woodUnits: number;
  /** Quality multiplier ∈ [0, 1] — integrity × health, reduced by wear/stress. */
  readonly qualityFactor: number;
  /** Sell value in bigint minor currency units (string, TDD §10.1). */
  readonly amountMinor: string;
}

/** Clamp a number into [0, 1]. */
function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Compute the timber yield from felling `tree`. Pure — neither `tree` nor
 * `species` is mutated.
 *
 *   woodUnits    = biomassScore(tree, species)              // [0, 4]
 *   qualityFactor= integrity × health × wearPenalty × stressPenalty  // [0, 1]
 *   amountMinor  = round(woodUnits × qualityFactor × TIMBER_VALUE)   // bigint
 *
 * A sapling (low biomassScore) yields little; a mature, healthy, structurally
 * sound tree yields the most. Heavy wear (cumulative damage) + high stress
 * reduce the merchantable wood — a neglected tree is worth less as timber.
 */
export function computeTimberYield(tree: TreeState, species: TreeSpecies): TimberYield {
  const woodUnits = biomassScore(tree, species);
  const integrity = clamp01(tree.structure.structuralIntegrity);
  const health = clamp01(tree.health);
  // Wear is ≥ 0 (unbounded in principle); ~10 wear roughly zeroes the yield.
  const wearPenalty = clamp01(1 - tree.wear / 10);
  // Stress ∈ [0, 1]; halve the quality penalty so a stressed-but-standing tree
  // still yields most of its wood.
  const stressPenalty = clamp01(1 - tree.stress * 0.5);
  const qualityFactor = clamp01(integrity * health * wearPenalty * stressPenalty);

  const valueMinor = Number(PROVISIONAL_TIMBER_VALUE_PER_BIOMASS_MINOR);
  const amountMinor = BigInt(
    Math.max(0, Math.round(woodUnits * qualityFactor * valueMinor)),
  );

  return {
    woodUnits,
    qualityFactor,
    amountMinor: amountMinor.toString(10),
  };
}
