/**
 * Nutrient balance (TDD §8.2, GDD §10.1).
 *
 * The nutrient model tracks N, P, K in TWO coupled pools:
 *
 *   SOIL NUTRIENT POOL (env.soil.nutrients):
 *     - Inputs: fertilizer (from `apply-fertilizer` action), background
 *       replenishment (mineral weathering + organic matter decomposition).
 *     - Outputs: leaching (when soil is saturated — GDD §10.3 environmental
 *       feedback), tree absorption (transferred to tree buffer).
 *
 *   TREE NUTRIENT BUFFER (originalTree.nutrients):
 *     - Inputs: absorption from soil (Liebig-capped by root capacity + soil
 *       nutrient availability).
 *     - Outputs: consumption (scales with foliage).
 *
 * Per-step balance per nutrient (N, P, K):
 *
 *   soilNutrient' = max(0, soilNutrient + replenished - leached - treeAbsorbed)
 *   treeNutrient' = max(0, treeNutrient - consumed + treeAbsorbed)
 *
 * Where:
 *   - replenished = REPLENISH_PER_DAY × SOIL_NUTRIENT_CAPACITY × stepDays
 *   - leached = soilNutrient × leachRate × stepDays
 *     leachRate = LEACHING_RATE × saturationFraction (saturation scaled by soil
 *     water content; below field capacity = 0 leaching).
 *   - consumed = species.nutrientRequirement.X × foliageFraction × stepDays
 *     (foliageFraction = currentLeaves / speciesMaxFoliage, matching the
 *     biology module's `dailyWaterNeed` scaling).
 *   - treeAbsorbed = min(rootCap.X × stepDays, soilNutrientAfterLeach)
 *     rootCap.X = species.nutrientRequirement.X × foliageFraction
 *                 × MAX_UPTAKE_FRACTION × rootAbsorptionCapacity
 *
 * Conservation (TDD §18.4 invariant):
 *   soilNutrient_after + treeNutrient_after + leached
 *     = soilNutrient_before + treeNutrient_before + replenished
 *
 * The `treeAbsorbed` term cancels — it moves nutrients from the soil pool to
 * the tree buffer (a transfer, not a loss).
 *
 * Pure functions: callers apply the deltas to both env.soil.nutrients and
 * originalTree.nutrients.
 */
import type {
  EnvironmentState,
  Fertilizer,
  FertilizerApplicationResult,
  NutrientState,
  TreeState,
  TreeSpecies,
} from '@capitalist-tree/shared';
import {
  PROVISIONAL_RESOURCE_CONTAMINATION_PER_EXCESS_NUTRIENT,
  PROVISIONAL_RESOURCE_LEACHING_RATE_PER_DAY,
  PROVISIONAL_RESOURCE_MAX_UPTAKE_FRACTION,
  PROVISIONAL_RESOURCE_NUTRIENT_REPLENISH_PER_DAY,
  PROVISIONAL_RESOURCE_SOIL_NUTRIENT_CAPACITY,
  PROVISIONAL_RESOURCE_SOIL_WATER_CAPACITY,
} from '@capitalist-tree/shared';

/** Per-nutrient breakdown of the soil + tree balance. */
export interface NutrientComponentBalance {
  /** Soil nutrient BEFORE balance. */
  soilBefore: number;
  /** Soil nutrient AFTER balance. */
  soilAfter: number;
  /** Tree nutrient BEFORE balance. */
  treeBefore: number;
  /** Tree nutrient AFTER balance. */
  treeAfter: number;
  /** Background replenishment added (units). */
  replenished: number;
  /** Leached to freshwater (units). */
  leached: number;
  /** Tree consumption (units). */
  consumed: number;
  /** Tree absorption from soil (units). */
  absorbed: number;
}

/** Nutrient balance result — applied to env.soil.nutrients + tree.nutrients. */
export interface NutrientBalance {
  /** Full balance for each of N, P, K. */
  nitrogen: NutrientComponentBalance;
  phosphorus: NutrientComponentBalance;
  potassium: NutrientComponentBalance;
  /** Nutrients BEFORE balance (soil). */
  nutrientsBefore: NutrientState;
  /** Nutrients AFTER balance (soil). */
  nutrientsAfter: NutrientState;
  /** Tree nutrients BEFORE balance. */
  treeNutrientsBefore: NutrientState;
  /** Tree nutrients AFTER balance. */
  treeNutrientsAfter: NutrientState;
}

/**
 * Compute the per-step nutrient balance for the coupled soil + tree nutrient
 * pools. The function is pure: it returns the balance; the caller applies the
 * deltas.
 *
 * The tree's consumption scales with foliage fraction (currentLeaves /
 * speciesMaxFoliage) — matching `dailyWaterNeed` in the biology module so
 * water and nutrient demand stay aligned.
 */
export function computeNutrientBalance(params: {
  soilNutrients: NutrientState;
  treeNutrients: NutrientState;
  speciesNutrientRequirement: TreeSpecies['nutrientRequirement'];
  speciesMaxFoliage: number;
  currentLeaves: number;
  rootAbsorptionCapacity: number;
  soilWater: number;
  stepDays: number;
}): NutrientBalance {
  const {
    soilNutrients,
    treeNutrients,
    speciesNutrientRequirement,
    speciesMaxFoliage,
    currentLeaves,
    rootAbsorptionCapacity,
    soilWater,
    stepDays,
  } = params;

  const foliageFraction = Math.min(
    1,
    currentLeaves / Math.max(1, speciesMaxFoliage),
  );

  // Leaching rate scales with soil saturation (0 at field capacity, max at
  // full saturation). GDD §10.3: nutrient runoff when soil is saturated.
  const fieldCapacity = PROVISIONAL_RESOURCE_SOIL_WATER_CAPACITY * 0.5;
  const saturationFraction =
    soilWater <= fieldCapacity
      ? 0
      : Math.min(
          1,
          (soilWater - fieldCapacity) /
            (PROVISIONAL_RESOURCE_SOIL_WATER_CAPACITY - fieldCapacity),
        );
  const leachRate = PROVISIONAL_RESOURCE_LEACHING_RATE_PER_DAY * saturationFraction;

  // Background replenishment (units per day, same for all nutrients).
  const replenishPerDay =
    PROVISIONAL_RESOURCE_NUTRIENT_REPLENISH_PER_DAY *
    PROVISIONAL_RESOURCE_SOIL_NUTRIENT_CAPACITY;

  const component = (
    soilBefore: number,
    treeBefore: number,
    requirement: number,
  ): NutrientComponentBalance => {
    const replenished = replenishPerDay * stepDays;
    const leached = soilBefore * leachRate * stepDays;
    const consumed = requirement * foliageFraction * stepDays;

    // Soil after leaching + replenishment (before tree absorption).
    const soilPostLeach = Math.max(0, soilBefore + replenished - leached);

    // Root absorption cap (units/day). Same Liebig-style headroom as water:
    //   rootCap = requirement × foliageFraction × MAX_UPTAKE_FRACTION × rootAbs
    // Decoupled from consumption so the tree can refill its (small) internal
    // nutrient buffer faster than it consumes.
    const rootCapPerDay =
      requirement *
      foliageFraction *
      PROVISIONAL_RESOURCE_MAX_UPTAKE_FRACTION *
      rootAbsorptionCapacity;
    const rootCap = rootCapPerDay * stepDays;
    // Tree absorption is Liebig: min(root cap, available in soil).
    const absorbed = Math.min(rootCap, soilPostLeach);

    const soilAfter = Math.max(0, soilPostLeach - absorbed);
    const treeAfter = Math.max(0, treeBefore - consumed + absorbed);

    return {
      soilBefore,
      soilAfter,
      treeBefore,
      treeAfter,
      replenished,
      leached,
      consumed,
      absorbed,
    };
  };

  const nitrogen = component(
    soilNutrients.nitrogen,
    treeNutrients.nitrogen,
    speciesNutrientRequirement.nitrogen,
  );
  const phosphorus = component(
    soilNutrients.phosphorus,
    treeNutrients.phosphorus,
    speciesNutrientRequirement.phosphorus,
  );
  const potassium = component(
    soilNutrients.potassium,
    treeNutrients.potassium,
    speciesNutrientRequirement.potassium,
  );

  return {
    nitrogen,
    phosphorus,
    potassium,
    nutrientsBefore: soilNutrients,
    nutrientsAfter: {
      nitrogen: nitrogen.soilAfter,
      phosphorus: phosphorus.soilAfter,
      potassium: potassium.soilAfter,
    },
    treeNutrientsBefore: treeNutrients,
    treeNutrientsAfter: {
      nitrogen: nitrogen.treeAfter,
      phosphorus: phosphorus.treeAfter,
      potassium: potassium.treeAfter,
    },
  };
}

/**
 * Apply the nutrient balance to an environment state + tree.
 *
 * Mutates `env.soil.nutrients` and `tree.nutrients`. The caller is expected
 * to deep-copy the state before calling.
 */
export function applyNutrientBalance(
  env: EnvironmentState,
  tree: TreeState,
  balance: NutrientBalance,
): void {
  env.soil.nutrients = { ...balance.nutrientsAfter };
  tree.nutrients = { ...balance.treeNutrientsAfter };
}

/**
 * Apply fertilizer to the soil nutrient pool.
 *
 * Each unit of fertilizer adds its full NPK composition to the soil. If the
 * soil is at nutrient capacity, the excess is converted to contamination
 * (over-application harm — GDD §8.3). The contamination scales linearly with
 * soil saturation: at zero capacity, all excess becomes contamination; at
 * full capacity, the contamination is the full `contaminationPerUnit`.
 *
 * Pure: takes the soil state + fertilizer + units, returns the application
 * result. The action handler applies the result to the state.
 */
export function applyFertilizer(
  env: EnvironmentState,
  fertilizer: Fertilizer,
  units: number,
  at: number,
): FertilizerApplicationResult {
  const nutrientsBefore = { ...env.soil.nutrients };
  const contaminationBefore = env.soil.contamination;
  const capacity = PROVISIONAL_RESOURCE_SOIL_NUTRIENT_CAPACITY;

  // Compute how much of each nutrient fits before hitting capacity.
  const npk = fertilizer.composition.npk;
  const totalAdded = {
    nitrogen: npk.nitrogen * units,
    phosphorus: npk.phosphorus * units,
    potassium: npk.potassium * units,
  };

  const nutrientsAfter: NutrientState = {
    nitrogen: Math.min(capacity, nutrientsBefore.nitrogen + totalAdded.nitrogen),
    phosphorus: Math.min(capacity, nutrientsBefore.phosphorus + totalAdded.phosphorus),
    potassium: Math.min(capacity, nutrientsBefore.potassium + totalAdded.potassium),
  };
  const nutrientsAdded: NutrientState = {
    nitrogen: nutrientsAfter.nitrogen - nutrientsBefore.nitrogen,
    phosphorus: nutrientsAfter.phosphorus - nutrientsBefore.phosphorus,
    potassium: nutrientsAfter.potassium - nutrientsBefore.potassium,
  };
  const nutrientsOverflowed: NutrientState = {
    nitrogen: Math.max(0, totalAdded.nitrogen - nutrientsAdded.nitrogen),
    phosphorus: Math.max(0, totalAdded.phosphorus - nutrientsAdded.phosphorus),
    potassium: Math.max(0, totalAdded.potassium - nutrientsAdded.potassium),
  };

  // Contamination: each unit of overflowed nutrient contributes a small amount.
  const totalOverflow =
    nutrientsOverflowed.nitrogen +
    nutrientsOverflowed.phosphorus +
    nutrientsOverflowed.potassium;
  // Scale by soil saturation: a saturated soil converts more overflow to
  // contamination than a dry one (runoff carries nutrients into freshwater).
  const soilSaturation = Math.min(1, env.soil.soilWater / 100); // 100 L reference
  const contaminationFromOverflow =
    totalOverflow * PROVISIONAL_RESOURCE_CONTAMINATION_PER_EXCESS_NUTRIENT * soilSaturation;
  // The fertilizer's intrinsic contamination per unit (synthetic fertilizers
  // carry salts / heavy metals; composts are nearly clean). Always added
  // (even when soil is below capacity) — captures the rule that "excessive or
  // inappropriate application can damage soil".
  const contaminationIntrinsic = fertilizer.composition.contaminationPerUnit * units;
  const contaminationAfter = contaminationBefore + contaminationIntrinsic + contaminationFromOverflow;

  const organicMatterAdded = fertilizer.composition.organicMatterPerUnit * units;

  return {
    fertilizerId: fertilizer.id,
    units,
    nutrientsBefore,
    nutrientsAfter,
    nutrientsAdded,
    nutrientsOverflowed,
    contaminationBefore,
    contaminationAfter,
    organicMatterAdded,
    at,
  };
}

/**
 * Apply irrigation (water) to the soil water pool.
 *
 * Pure: takes the soil state + litres, returns the application result. The
 * action handler applies the result to the state.
 *
 * Water above the soil water capacity becomes runoff (not absorbed). The
 * action handler does NOT touch env.freshwater.availability here — the
 * ResourceSystem tick will recompute it next step from the new soilWater.
 */
export function applyWaterToSoil(
  soilWaterBefore: number,
  litres: number,
  soilWaterCapacity: number,
  at: number,
): {
  litres: number;
  soilWaterBefore: number;
  soilWaterAfter: number;
  runoff: number;
  at: number;
} {
  const postAdd = soilWaterBefore + litres;
  const runoff = Math.max(0, postAdd - soilWaterCapacity);
  const soilWaterAfter = Math.max(0, postAdd - runoff);
  return {
    litres,
    soilWaterBefore,
    soilWaterAfter,
    runoff,
    at,
  };
}
