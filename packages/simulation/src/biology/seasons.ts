/**
 * Seasonal behavior (TDD §7.6, GDD §4.4, §5.2).
 *
 * For deciduous species, the tree's `foliage.seasonalCondition` (in [0, 1])
 * approaches a season-specific target each day:
 *
 *   spring: budding — partial canopy (PROVISIONAL_BIOLOGY_DECIDUOUS_SEASONAL_FOLIAGE.spring)
 *   summer: full canopy         (PROVISIONAL_BIOLOGY_DECIDUOUS_SEASONAL_FOLIAGE.summer)
 *   autumn: senescence begins   (PROVISIONAL_BIOLOGY_DECIDUOUS_SEASONAL_FOLIAGE.autumn)
 *   winter: full dormancy       (PROVISIONAL_BIOLOGY_DECIDUOUS_SEASONAL_FOLIAGE.winter = 0)
 *
 * `currentLeaves` is bounded by `leafCapacity * seasonalCondition` — the tree
 * naturally loses leaves in autumn/winter and regrows them in spring/summer.
 *
 * Evergreen species (deciduous=false) keep seasonalCondition = 1 year-round;
 * P1 ships only a deciduous species but the engine handles both.
 *
 * Pure functions: callers apply the deltas to the tree state.
 */
import type { TreeState } from '@capitalist-tree/shared';
import {
  PROVISIONAL_BIOLOGY_DECIDUOUS_SEASONAL_FOLIAGE,
  PROVISIONAL_BIOLOGY_SEASONAL_TRANSITION_RATE,
} from '@capitalist-tree/shared';
import type { Season } from '@capitalist-tree/shared';
import type { BiologyContext } from './types.js';

/**
 * Target seasonal condition for a species in a given season.
 *
 * Deciduous: full PROVISIONAL_BIOLOGY_DECIDUOUS_SEASONAL_FOLIAGE lookup.
 * Evergreen: 1.0 year-round (no seasonal senescence).
 */
export function seasonalTarget(species: { deciduous: boolean }, season: Season): number {
  if (!species.deciduous) return 1;
  // noUncheckedIndexedAccess: the lookup is exhaustive over the 4 seasons.
  const value = PROVISIONAL_BIOLOGY_DECIDUOUS_SEASONAL_FOLIAGE[season];
  return value ?? 1;
}

/**
 * Advance `foliage.seasonalCondition` toward the seasonal target.
 *
 * The condition moves at PROVISIONAL_BIOLOGY_SEASONAL_TRANSITION_RATE per day.
 * A rate of 0.2 means the condition closes ~20% of the gap each day, so a full
 * transition (e.g. spring budding from 0 to 0.6) takes ~5-10 days.
 *
 * Returns the new seasonalCondition in [0, 1].
 */
export function advanceSeasonalCondition(
  tree: TreeState,
  ctx: BiologyContext,
): number {
  const target = seasonalTarget(ctx.species, ctx.season);
  const rate = PROVISIONAL_BIOLOGY_SEASONAL_TRANSITION_RATE;
  const delta = (target - tree.foliage.seasonalCondition) * rate * ctx.stepDays;
  // stepDays is small (1/1440); delta per step is tiny — accumulate.
  return Math.max(0, Math.min(1, tree.foliage.seasonalCondition + delta));
}

/**
 * Maximum leaves the tree can currently support given the season and capacity.
 *
 *   maxLeaves = floor(leafCapacity * seasonalCondition)
 *
 * The BiologySystem uses this to:
 *   - Cap currentLeaves (senesce excess leaves in autumn/winter).
 *   - Bound new leaf growth (don't grow more than the season allows).
 */
export function maxSupportedLeaves(tree: TreeState): number {
  return Math.floor(tree.foliage.leafCapacity * tree.foliage.seasonalCondition);
}
