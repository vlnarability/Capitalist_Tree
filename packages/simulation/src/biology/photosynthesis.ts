/**
 * Photosynthesis (TDD §7.2, GDD §5.2).
 *
 * Production depends on (Liebig's Law of the Minimum applied to):
 *   - Active leaf area (currentLeaves * leafAreaPerLeaf * effectiveLeafCondition)
 *   - Light availability (day/night; P2 will modulate by weather)
 *   - Temperature (species' min/opt/max triangle curve)
 *   - Water availability (stored water vs. daily requirement)
 *   - Carbon dioxide (saturation at PROVISIONAL_BIOLOGY_CO2_SATURATION_PPM)
 *   - Nutrient availability (Liebig min of N, P, K relative to requirements)
 *   - Leaf health (1 - stress)
 *
 * Increasing any single factor above the minimum does NOT increase production.
 * This is the Liebig model: the scarcest resource limits growth. Adding more
 * fertilizer when water is the limiting factor cannot buy more growth
 * (GDD §17 unresolved; PROVISIONAL constants tune the model).
 *
 * Units:
 *   - Production is in arbitrary "energy units" (eu) per simulation day.
 *   - `species.photosynthesisRate` is eu per leaf per day at optimum conditions
 *     (max light, optimum temp, full water/nutrients/CO2, healthy leaves).
 *   - `PROVISIONAL_BIOLOGY_MAX_PHOTOSYNTHESIS_RATE` is a global multiplier for
 *     top-level tuning.
 *
 * `activeLeafArea` (m²) is computed and stored on the tree as a derived
 * quantity for P4's renderer; production itself uses currentLeaves directly so
 * the energy math stays in eu/leaf/day.
 *
 * The function is PURE: it takes the current tree + environment and returns the
 * production in eu/day. Callers multiply by stepDays.
 */
import type { TreeState, TreeSpecies } from '@capitalist-tree/shared';
import {
  PROVISIONAL_BIOLOGY_CO2_SATURATION_PPM,
  PROVISIONAL_BIOLOGY_DAY_LIGHT_FACTOR,
  PROVISIONAL_BIOLOGY_LEAF_CAPACITY_PER_BRANCH,
  PROVISIONAL_BIOLOGY_LEAF_HEALTH_WEIGHT,
  PROVISIONAL_BIOLOGY_MAX_PHOTOSYNTHESIS_RATE,
  PROVISIONAL_BIOLOGY_NIGHT_PHOTOSYNTHESIS_FRACTION,
  PROVISIONAL_BIOLOGY_SEASONAL_CONDITION_WEIGHT,
  PROVISIONAL_DAY_END_FRACTION,
  PROVISIONAL_DAY_START_FRACTION,
} from '@capitalist-tree/shared';
import type { BiologyContext } from './types.js';

/**
 * Liebig temperature factor in [0, 1].
 *
 * Below `minimum` → 0. Between minimum and optimum → linear ramp 0→1.
 * Between optimum and maximum → linear ramp 1→0. Above maximum → 0.
 *
 * The triangle curve is a coarse approximation of the species' temperature
 * response. PROVISIONAL: real curves are asymmetric and species-specific
 * (GDD §17).
 */
export function temperatureFactor(
  tempC: number,
  range: { minimum: number; optimum: number; maximum: number },
): number {
  if (tempC <= range.minimum || tempC >= range.maximum) return 0;
  if (tempC <= range.optimum) {
    const span = range.optimum - range.minimum;
    return span <= 0 ? 1 : (tempC - range.minimum) / span;
  }
  const span = range.maximum - range.optimum;
  return span <= 0 ? 1 : (range.maximum - tempC) / span;
}

/** Light factor in [0, 1]. Day = full light; night = a small residual. */
export function lightFactor(timeOfDay: number): number {
  const isDay =
    timeOfDay >= PROVISIONAL_DAY_START_FRACTION &&
    timeOfDay < PROVISIONAL_DAY_END_FRACTION;
  return isDay
    ? PROVISIONAL_BIOLOGY_DAY_LIGHT_FACTOR
    : PROVISIONAL_BIOLOGY_NIGHT_PHOTOSYNTHESIS_FRACTION;
}

/**
 * Water factor in [0, 1].
 *
 * The tree needs `species.waterRequirement * foliageFraction` litres per day
 * at full foliage; we scale by current foliage. The factor is the ratio of
 * stored water to the daily need. Above 1.0 → clamped to 1.0 (extra water
 * doesn't help photosynthesis — Liebig).
 */
export function waterFactor(tree: TreeState, dailyWaterNeedL: number): number {
  if (dailyWaterNeedL <= 0) return 1;
  return Math.min(1, tree.water.stored / dailyWaterNeedL);
}

/**
 * The species' maximum possible foliage (leaves) — the canopy size at full
 * structural maturity. Used to scale water/nutrient demand per leaf rather
 * than per-sapling-capacity.
 *
 *   speciesMaxFoliage = initial.leafCapacity + maximumBranchDevelopment * LEAF_CAPACITY_PER_BRANCH
 *
 * For White Oak: 50 + 100 * 100 = 10050 leaves at full maturity.
 */
export function computeSpeciesMaxFoliage(species: TreeSpecies): number {
  return Math.floor(
    species.initial.leafCapacity +
      species.maximumBranchDevelopment * PROVISIONAL_BIOLOGY_LEAF_CAPACITY_PER_BRANCH,
  );
}

/**
 * CO2 factor in [0, 1]. Linear ramp to saturation; clamped above.
 * Real-world ambient is ~410 ppm; we treat 400 ppm as saturation so default
 * conditions are not CO2-limited.
 */
export function co2Factor(co2Ppm: number): number {
  return Math.max(0, Math.min(1, co2Ppm / PROVISIONAL_BIOLOGY_CO2_SATURATION_PPM));
}

/**
 * Nutrient factor in [0, 1] — Liebig: the scarcest of N, P, K relative to
 * the species' requirements limits photosynthesis. Excess of one nutrient
 * cannot compensate for deficiency of another (GDD §5.2, §8.2).
 */
export function nutrientFactor(
  nutrients: { nitrogen: number; phosphorus: number; potassium: number },
  requirement: { nitrogen: number; phosphorus: number; potassium: number },
): number {
  const n = requirement.nitrogen > 0 ? nutrients.nitrogen / requirement.nitrogen : 1;
  const p = requirement.phosphorus > 0 ? nutrients.phosphorus / requirement.phosphorus : 1;
  const k = requirement.potassium > 0 ? nutrients.potassium / requirement.potassium : 1;
  return Math.max(0, Math.min(n, p, k, 1));
}

/** Effective leaf health in [0, 1] — derived from accumulated stress. */
export function leafHealth(stress: number): number {
  return Math.max(0, 1 - stress);
}

/**
 * Effective leaf condition in [0, 1].
 *
 * Combines leaf health (driven by stress) with seasonal condition (deciduous
 * senescence). Both contribute so a stressed tree in summer still has some
 * effective leaf area, and a healthy tree in winter still has zero effective
 * leaves (for deciduous species).
 */
export function effectiveLeafCondition(stress: number, seasonalCondition: number): number {
  const lh = leafHealth(stress);
  return Math.max(
    0,
    Math.min(
      1,
      lh * PROVISIONAL_BIOLOGY_LEAF_HEALTH_WEIGHT +
        seasonalCondition * PROVISIONAL_BIOLOGY_SEASONAL_CONDITION_WEIGHT,
    ),
  );
}

/**
 * Active photosynthetic leaf area in m² (GDD §5.1 "activeLeafArea").
 *
 * Stored on the tree so P4's renderer can read it. The renderer never writes
 * here — BiologySystem is the only writer.
 */
export function computeActiveLeafArea(
  tree: TreeState,
  leafAreaPerLeaf: number,
): number {
  const cond = effectiveLeafCondition(tree.stress, tree.foliage.seasonalCondition);
  return tree.foliage.currentLeaves * leafAreaPerLeaf * cond;
}

/**
 * Daily water requirement (L/day) given the species' mature canopy size.
 *
 * `species.waterRequirement` is the daily demand at the species' maximum
 * foliage (a mature, full-canopy tree). For a sapling with only a few leaves
 * the demand scales by `currentLeaves / speciesMaxFoliage` — NOT by the
 * sapling's current `leafCapacity` (which would inflate a 5-leaf sapling's
 * demand by 200x).
 *
 * Pure: given (tree, species) returns a non-negative L/day value.
 */
export function dailyWaterNeed(
  tree: TreeState,
  species: TreeSpecies,
): number {
  const speciesMaxFoliage = computeSpeciesMaxFoliage(species);
  const cap = Math.max(1, speciesMaxFoliage);
  const foliageFraction = Math.min(1, tree.foliage.currentLeaves / cap);
  return species.waterRequirement * foliageFraction;
}

/**
 * Photosynthetic production for one step (eu).
 *
 * Pure: takes the tree + biology context, returns eu produced this step.
 * Caller updates `tree.energy.production` with this value.
 *
 * Production is zero for:
 *   - Dead trees.
 *   - Deciduous trees in winter (no foliage, dormant).
 *
 * The Liebig multiplier is the minimum of light, temperature, water, CO2,
 * nutrient, and leaf-health factors. Leaf health enters twice (intentionally):
 * once via effectiveLeafCondition (reducing active leaf area on stressed trees)
 * and once via the Liebig min (reducing per-leaf efficiency). The compounding
 * reflects that severe stress both yellows leaves and impairs their metabolism.
 */
export function photosynthesisForStep(tree: TreeState, ctx: BiologyContext): number {
  if (!tree.alive) return 0;
  if (ctx.species.deciduous && ctx.season === 'winter') return 0;

  const dailyWater = dailyWaterNeed(tree, ctx.species);
  const liebig = Math.min(
    lightFactor(ctx.timeOfDay),
    temperatureFactor(ctx.environment.globalTemperature, ctx.species.temperatureRange),
    waterFactor(tree, dailyWater),
    co2Factor(ctx.environment.atmosphere.co2Concentration),
    nutrientFactor(tree.nutrients, ctx.species.nutrientRequirement),
    leafHealth(tree.stress),
  );

  const effectiveLeaves =
    tree.foliage.currentLeaves *
    effectiveLeafCondition(tree.stress, tree.foliage.seasonalCondition);

  const perDay =
    PROVISIONAL_BIOLOGY_MAX_PHOTOSYNTHESIS_RATE *
    ctx.species.photosynthesisRate *
    effectiveLeaves *
    liebig;

  return perDay * ctx.stepDays;
}
