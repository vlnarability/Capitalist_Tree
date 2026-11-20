/**
 * Growth (TDD §7.6, GDD §5.5).
 *
 * Growth rates respond to:
 *   - Age (mature trees grow slower structurally — handled by maturityMultiplier)
 *   - Genetics (species.growthRate)
 *   - Energy availability (allocated eu from energy-allocation)
 *   - Nutrient availability (Liebig factor — already capped production)
 *   - Water availability (Liebig factor — already capped production)
 *   - Seasonal conditions (winter dormancy — allocation already zero for leaves)
 *   - Environmental stress (stress affects maintenance, not growth directly;
 *     stressed trees have less surplus to allocate)
 *
 * Growth approaches a species-specific biological ceiling asymptotically
 * (PROVISIONAL_BIOLOGY_MATURITY_GROWTH_CURVE_EXPONENT controls the curve).
 * Mature trees retain maintenance and production functions even when structural
 * growth becomes minimal (GDD §5.5: "Maturity is not a failure state").
 *
 * Pure functions: callers apply the deltas to the tree state.
 */
import type { TreeState } from '@capitalist-tree/shared';
import {
  PROVISIONAL_BIOLOGY_GROWTH_CONVERSION_MULTIPLIER,
  PROVISIONAL_BIOLOGY_MATURITY_GROWTH_CURVE_EXPONENT,
} from '@capitalist-tree/shared';
import type { BiologyContext } from './types.js';
import type { EnergyAllocation } from './energy-allocation.js';
import type { BiologyParameters } from '../progression/trait-effects.js';

/**
 * The neutral biology parameter set (every multiplier 1.0). Used as the
 * default when no trait-adjusted parameters are supplied — keeps the
 * pre-P9c callers' behavior unchanged.
 */
const NEUTRAL_PARAMS: BiologyParameters = {
  growthRateMultiplier: 1,
  earlyGrowthMultiplier: 1,
  structuralGrowthMultiplier: 1,
  maxGrowthMultiplier: 1,
  productionCapacityMultiplier: 1,
  energyProductionMultiplier: 1,
  waterDemandMultiplier: 1,
  droughtResistanceMultiplier: 1,
  reservesCapacityMultiplier: 1,
  pestVulnerabilityMultiplier: 1,
  frostSurvivalMultiplier: 1,
  warmClimatePerformanceMultiplier: 1,
};

/**
 * Asymptotic growth factor in [0, 1] for a single dimension.
 *
 *   factor = (1 - fractionComplete) ^ EXPONENT
 *
 * `fractionComplete` is `current / maximum`. As the tree approaches its
 * ceiling, the growth factor shrinks toward 0.
 *
 *   sapling (frac=0.01): factor ≈ 0.98 (almost full growth)
 *   halfway (frac=0.5):  factor ≈ 0.25 (sharply reduced)
 *   mature  (frac=0.95): factor ≈ 0.0025 (almost no growth)
 *
 * Higher EXPONENT → sharper asymptote.
 */
export function growthFactor(fractionComplete: number): number {
  const clamped = Math.max(0, Math.min(1, fractionComplete));
  return Math.pow(1 - clamped, PROVISIONAL_BIOLOGY_MATURITY_GROWTH_CURVE_EXPONENT);
}

/**
 * Apply growth in one structural dimension.
 *
 *   delta = eu * GROWTH_CONVERSION * species.growthRate * growthFactor * stepDays
 *
 * `eu` is the energy allocated to this dimension. The conversion multiplier
 * turns eu into metres (height, trunk) or dimensionless (branch, root) growth.
 * The growth factor slows growth near the ceiling.
 *
 * Returns the new value, clamped at `maximum` (NEVER exceeds the ceiling).
 *
 * DR-4 (was P11 W27 / RV2-3): height + diameter now grow from INDEPENDENT
 * energy buckets (`alloc.heightGrowth` vs `alloc.trunkGrowth`), split per the
 * species' `heightDiameterSplit`. The shared asymptotic `growthFactor`
 * (1 − frac)^EXPONENT still governs each dimension's curve (both height + trunk
 * slow near their ceilings) — a dedicated height-specific S-curve (fast juvenile
 * extension, then plateau) remains @provisional for a later phase. The coupling
 * RV2-3 flagged (both driven by one bucket) is resolved; the shared growth-factor
 * approximation is documented as a separate, intentional simplification.
 */
export function growDimension(
  current: number,
  maximum: number,
  eu: number,
  speciesGrowthRate: number,
  ctx: BiologyContext,
  /** P11 (W9/RV4-F-M7): trait-adjusted growth multiplier. Defaults to neutral. */
  params: BiologyParameters = NEUTRAL_PARAMS,
): number {
  if (maximum <= 0 || eu <= 0) return current;
  const frac = current / maximum;
  const factor = growthFactor(frac);
  // P11 (W9): apply the trait-adjusted growthRateMultiplier (e.g. rapid-growth
  // raises it, pest-resistance lowers it). The multiplier composes onto the
  // species' baseline growthRate multiplicatively (see trait-effects stacking).
  const delta =
    eu *
    PROVISIONAL_BIOLOGY_GROWTH_CONVERSION_MULTIPLIER *
    speciesGrowthRate *
    params.growthRateMultiplier *
    factor *
    ctx.stepDays;
  // delta is in metres (height/trunk) or dimensionless (branch/root) per step.
  return Math.min(maximum, current + delta);
}

/**
 * Grow the tree's structural dimensions and roots from the energy allocation.
 *
 * Pure: returns a partial TreeState patch with the new structural + root values.
 * The BiologySystem applies these. The maturity multiplier (already applied
 * inside `allocateEnergy` to scale the eu each dimension receives) is NOT
 * re-applied here — that would double-count.
 *
 * Leaf growth uses an accumulator (`leafGrowthProgress`) so per-step energy
 * that's too small to grow a whole leaf isn't wasted. Each step adds
 * `alloc.leafGrowth / species.leafEnergyCost` to the progress; when it crosses
 * 1.0, a new leaf is grown and the remainder carries over. The caller must
 * persist the new `leafGrowthProgress` back onto the tree.
 */
export interface GrowthResult {
  height: number;
  trunkDiameter: number;
  branchDevelopment: number;
  rootDevelopment: number;
  /** Number of new leaves grown this step (integer). */
  newLeaves: number;
  /** Updated fractional progress toward the next leaf, in [0, 1). */
  leafGrowthProgress: number;
}

export function applyGrowth(
  tree: TreeState,
  ctx: BiologyContext,
  alloc: EnergyAllocation,
  /** Maximum leaves the tree can support this step (from seasons.maxSupportedLeaves). */
  maxLeaves: number,
  /** P11 (W9/RV4-F-M7): trait-adjusted biology parameters. Defaults to neutral. */
  params: BiologyParameters = NEUTRAL_PARAMS,
): GrowthResult {
  const sp = ctx.species;
  // DR-4: height + diameter grow from INDEPENDENT energy buckets. Height uses
  // alloc.heightGrowth; diameter uses alloc.trunkGrowth (diameter-only now).
  // This decouples them (RV2-3: both used alloc.trunkGrowth) — a tree can now
  // grow taller while adding relatively little girth, or vice versa, per the
  // species' heightDiameterSplit.
  const heightGrown = growDimension(
    tree.structure.height,
    sp.maximumHeight,
    alloc.heightGrowth,
    sp.growthRate,
    ctx,
    params,
  );
  const trunkDiameter = growDimension(
    tree.structure.trunkDiameter,
    sp.maximumTrunkDiameter,
    alloc.trunkGrowth,
    sp.growthRate,
    ctx,
    params,
  );
  // DR-4 allometric constraint: a tree cannot grow taller than
  // `trunkDiameter × maxSlendernessRatio`. If height growth would push the
  // ratio above the species' sustainable bound, cap height growth at the bound
  // — the tree must add girth before it can add height (a spindly tree is
  // structurally unstable). The cap never SHRINKS the tree: if the current
  // height already exceeds the cap (an already-slender tree), height growth is
  // simply halted (max with current height) until diameter catches up.
  // Guarded against zero diameter (a sapling with no measured girth yet is
  // exempt until it has some).
  const slendernessCap =
    trunkDiameter > 0 ? trunkDiameter * sp.maxSlendernessRatio : Infinity;
  const height = Math.max(
    tree.structure.height,
    Math.min(heightGrown, slendernessCap),
  );
  const branchDevelopment = growDimension(
    tree.structure.branchDevelopment,
    sp.maximumBranchDevelopment,
    alloc.branchGrowth,
    sp.growthRate,
    ctx,
    params,
  );
  const rootDevelopment = tree.roots.development + alloc.rootGrowth * sp.rootDevelopmentRate * params.growthRateMultiplier * ctx.stepDays;

  // Leaf growth with accumulator: each step adds the fractional leaf-equivalent
  // of `alloc.leafGrowth` to the existing progress. When progress crosses 1.0,
  // we grow a leaf and carry the remainder. This means a sapling's small
  // per-step leafGrowth energy (often < 1 leaf's worth) accumulates over many
  // steps until a leaf materialises — instead of being silently discarded
  // by `Math.floor(0.0007 / 2) = 0`.
  const capacityRoom = Math.max(0, maxLeaves - tree.foliage.currentLeaves);
  const leafEnergyCost = sp.leafEnergyCost;
  const progressDelta = leafEnergyCost > 0 ? alloc.leafGrowth / leafEnergyCost : 0;
  const accumulated = tree.foliage.leafGrowthProgress + progressDelta;
  const leavesFromEnergy = Math.floor(accumulated);
  const newLeaves = Math.max(0, Math.min(capacityRoom, leavesFromEnergy));
  // Carry the remainder; if we hit capacityRoom (couldn't grow all the leaves
  // progress allowed), the spent progress is still consumed (don't carry it).
  const consumedProgress = newLeaves;
  const leafGrowthProgress = Math.max(0, accumulated - consumedProgress);

  return {
    height,
    trunkDiameter,
    branchDevelopment,
    rootDevelopment,
    newLeaves,
    leafGrowthProgress: Math.min(0.9999, leafGrowthProgress),
  };
}
