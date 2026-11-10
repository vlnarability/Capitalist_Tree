/**
 * Resources module unit tests (TDD §18.1, §18.4).
 *
 * Pure-function tests asserting the resource invariants the GDD and TDD
 * require:
 *
 *   - Water balance conserves water (input = output + delta stored).
 *   - Nutrient balance conserves nutrients (input = output + delta stored).
 *   - Fertilizer application changes soil nutrients.
 *   - Excess fertilizer (over soil capacity) increases contamination.
 *   - Compost adds organic matter; synthetic fertilizers do not.
 *   - Soil health is derived from underlying factors (not stored).
 *   - Soil water capacity cap enforces runoff.
 *   - Tree uptake is Liebig-capped by root capacity + soil water + buffer room.
 *   - Leaching scales with soil saturation (zero below field capacity).
 */
import { describe, it, expect } from 'vitest';
import {
  computeWaterBalance,
  applyWaterBalance,
  computeFreshwaterAvailability,
  computeSoilEvaporationRate,
} from '../src/resources/water.js';
import {
  computeNutrientBalance,
  applyNutrientBalance,
  applyFertilizer,
  applyWaterToSoil,
} from '../src/resources/nutrients.js';
import {
  computeSoilHealth,
  organicMatterFraction,
  nutrientFraction,
  moistureFraction,
  contaminationFraction,
} from '../src/resources/soil.js';
import {
  PROVISIONAL_RESOURCE_CONTAMINATION_FULL_DEGRADE,
  PROVISIONAL_RESOURCE_MAX_UPTAKE_FRACTION,
  PROVISIONAL_RESOURCE_ORGANIC_MATTER_SATURATION,
  PROVISIONAL_RESOURCE_SOIL_NUTRIENT_CAPACITY,
  PROVISIONAL_RESOURCE_SOIL_WATER_CAPACITY,
  PROVISIONAL_RESOURCE_IDEAL_SOIL_WATER_FRACTION,
} from '@capitalist-tree/shared';
import { WEATHER_EVENT_MAP, BALANCED_10_10_10, UREA_46_0_0, COMPOST, WHITE_OAK } from '@capitalist-tree/content';
import type { EnvironmentState, TreeState, NutrientState } from '@capitalist-tree/shared';

const SECONDS_PER_DAY = 24 * 60 * 60;
const STEP_SECONDS = 60;
const STEP_DAYS = STEP_SECONDS / SECONDS_PER_DAY;

/** Build a neutral environment for testing — full soil, no stressors. */
function neutralEnv(overrides: Partial<EnvironmentState> = {}): EnvironmentState {
  const base: EnvironmentState = {
    atmosphere: { co2Concentration: 410, emissions: 0, sequestration: 0 },
    soil: {
      health: 1,
      organicMatter: 50,
      contamination: 0,
      nutrients: { nitrogen: 50, phosphorus: 50, potassium: 50 },
      soilWater: 100,
      ph: 6.5,
      compaction: 0,
      microbialActivity: 1.0,
    },
    freshwater: { availability: 1000, groundwater: 500, contamination: 0 },
    biodiversity: { index: 0.8, speciesPopulations: [] },
    forestCoverage: 0.3,
    ecosystemResilience: 0.8,
    globalTemperature: 22,
  };
  return { ...base, ...overrides, soil: { ...base.soil, ...overrides.soil } };
}

/** Build a neutral tree for testing. */
function neutralTree(overrides: Partial<TreeState> = {}): TreeState {
  const base: TreeState = {
    id: 'original',
    speciesId: WHITE_OAK.id,
    isOriginal: true,
    ageDays: 100,
    alive: true,
    structure: {
      height: 5,
      trunkDiameter: 0.2,
      branchDevelopment: 20,
      structuralIntegrity: 1,
    },
    foliage: {
      currentLeaves: 1000,
      leafCapacity: 2050,
      activeLeafArea: 5,
      seasonalCondition: 1,
      leafGrowthProgress: 0,
    },
    roots: { development: 0.5, absorptionCapacity: 0.5 },
    energy: { reserves: 500, production: 0, consumption: 0 },
    water: { stored: 25, capacity: 50 },
    nutrients: { nitrogen: 5, phosphorus: 2, potassium: 4 },
    health: 1,
    stress: 0,
    damage: [],
    pendingIssuances: [],
  };
  return { ...base, ...overrides, water: { ...base.water, ...overrides.water }, nutrients: { ...base.nutrients, ...overrides.nutrients } };
}

describe('water balance — conservation (TDD §18.4 invariant)', () => {
  it('soilWater_after + treeWater_after + outputs = soilWater_before + treeWater_before + inputs', () => {
    // Use a non-trivial setup: medium soil water, some rainfall, warm temp.
    const rainfall = 5; // L this step
    const env = neutralEnv({ soil: { soilWater: 80, organicMatter: 50, contamination: 0, nutrients: { nitrogen: 50, phosphorus: 50, potassium: 50 }, health: 1, ph: 6.5, compaction: 0, microbialActivity: 1.0 } });
    const tree = neutralTree({ water: { stored: 30, capacity: 50 }, roots: { development: 0.5, absorptionCapacity: 0.5 } });
    const dailyWater = 10; // L/day
    const evapRatePerDay = computeSoilEvaporationRate(WEATHER_EVENT_MAP.sunny, 22);
    expect(evapRatePerDay).toBeGreaterThan(0);

    const balance = computeWaterBalance({
      soilWater: env.soil.soilWater,
      treeWater: tree.water.stored,
      treeWaterCapacity: tree.water.capacity,
      dailyWaterNeedL: dailyWater,
      rainfall,
      evaporationRatePerDay: evapRatePerDay,
      rootAbsorptionCapacity: tree.roots.absorptionCapacity,
      stepDays: STEP_DAYS,
    });

    // Conservation:
    //   soilWater_after + treeWater_after + (evap + drainage + runoff + transpiration)
    //     = soilWater_before + treeWater_before + rainfall
    // (treeUptake cancels — it's a transfer from soil to tree)
    const inputs = env.soil.soilWater + tree.water.stored + rainfall;
    const outputs = balance.soilWaterAfter + balance.treeWaterAfter +
      balance.evaporation + balance.drainage + balance.runoff + balance.transpiration;
    expect(outputs).toBeCloseTo(inputs, 5);
  });

  it('conservation holds even with zero rainfall (no external input)', () => {
    const env = neutralEnv();
    const tree = neutralTree();
    const evapRatePerDay = computeSoilEvaporationRate(WEATHER_EVENT_MAP.sunny, 22);
    const balance = computeWaterBalance({
      soilWater: env.soil.soilWater,
      treeWater: tree.water.stored,
      treeWaterCapacity: tree.water.capacity,
      dailyWaterNeedL: 10,
      rainfall: 0,
      evaporationRatePerDay: evapRatePerDay,
      rootAbsorptionCapacity: tree.roots.absorptionCapacity,
      stepDays: STEP_DAYS,
    });
    const inputs = env.soil.soilWater + tree.water.stored + 0;
    const outputs = balance.soilWaterAfter + balance.treeWaterAfter +
      balance.evaporation + balance.drainage + balance.runoff + balance.transpiration;
    expect(outputs).toBeCloseTo(inputs, 5);
  });

  it('conservation holds with heavy rain causing runoff', () => {
    const env = neutralEnv({ soil: { soilWater: 140, organicMatter: 50, contamination: 0, nutrients: { nitrogen: 50, phosphorus: 50, potassium: 50 }, health: 1, ph: 6.5, compaction: 0, microbialActivity: 1.0 } });
    const tree = neutralTree();
    const heavyRainfall = 50; // L this step — exceeds soil capacity
    const evapRatePerDay = computeSoilEvaporationRate(WEATHER_EVENT_MAP['heavy-rain'], 15);
    const balance = computeWaterBalance({
      soilWater: env.soil.soilWater,
      treeWater: tree.water.stored,
      treeWaterCapacity: tree.water.capacity,
      dailyWaterNeedL: 10,
      rainfall: heavyRainfall,
      evaporationRatePerDay: evapRatePerDay,
      rootAbsorptionCapacity: tree.roots.absorptionCapacity,
      stepDays: STEP_DAYS,
    });
    expect(balance.runoff).toBeGreaterThan(0); // runoff occurred
    expect(balance.soilWaterAfter).toBeLessThanOrEqual(PROVISIONAL_RESOURCE_SOIL_WATER_CAPACITY);
    const inputs = env.soil.soilWater + tree.water.stored + heavyRainfall;
    const outputs = balance.soilWaterAfter + balance.treeWaterAfter +
      balance.evaporation + balance.drainage + balance.runoff + balance.transpiration;
    expect(outputs).toBeCloseTo(inputs, 5);
  });

  it('conservation holds when tree buffer is full (no uptake)', () => {
    // Tree water buffer at capacity AND zero transpiration → no room for uptake.
    const env = neutralEnv();
    const tree = neutralTree({ water: { stored: 50, capacity: 50 } });
    const evapRatePerDay = computeSoilEvaporationRate(WEATHER_EVENT_MAP.sunny, 22);
    const balance = computeWaterBalance({
      soilWater: env.soil.soilWater,
      treeWater: tree.water.stored,
      treeWaterCapacity: tree.water.capacity,
      dailyWaterNeedL: 0, // zero transpiration → buffer stays full → no uptake
      rainfall: 0,
      evaporationRatePerDay: evapRatePerDay,
      rootAbsorptionCapacity: tree.roots.absorptionCapacity,
      stepDays: STEP_DAYS,
    });
    expect(balance.treeUptake).toBe(0); // no room to absorb
    const inputs = env.soil.soilWater + tree.water.stored + 0;
    const outputs = balance.soilWaterAfter + balance.treeWaterAfter +
      balance.evaporation + balance.drainage + balance.runoff + balance.transpiration;
    expect(outputs).toBeCloseTo(inputs, 5);
  });

  it('tree uptake is Liebig-capped by root absorption capacity', () => {
    // Saturate soil + low root absorption → uptake limited by root, not soil.
    const env = neutralEnv({ soil: { soilWater: 150, organicMatter: 50, contamination: 0, nutrients: { nitrogen: 50, phosphorus: 50, potassium: 50 }, health: 1, ph: 6.5, compaction: 0, microbialActivity: 1.0 } });
    const tree = neutralTree({
      water: { stored: 10, capacity: 50 },
      roots: { development: 0.5, absorptionCapacity: 0.1 }, // weak root
      foliage: { currentLeaves: 1000, leafCapacity: 2050, activeLeafArea: 5, seasonalCondition: 1, leafGrowthProgress: 0 },
    });
    const dailyWater = 10;
    const evapRatePerDay = 0.01; // tiny so evap doesn't deplete soil
    const balance = computeWaterBalance({
      soilWater: env.soil.soilWater,
      treeWater: tree.water.stored,
      treeWaterCapacity: tree.water.capacity,
      dailyWaterNeedL: dailyWater,
      rainfall: 0,
      evaporationRatePerDay: evapRatePerDay,
      rootAbsorptionCapacity: tree.roots.absorptionCapacity,
      stepDays: STEP_DAYS,
    });
    // rootCap = dailyWater * MAX_UPTAKE_FRACTION * rootAbs * stepDays
    const expectedRootCap = dailyWater * PROVISIONAL_RESOURCE_MAX_UPTAKE_FRACTION * 0.1 * STEP_DAYS;
    expect(balance.treeUptake).toBeCloseTo(expectedRootCap, 5);
    expect(balance.treeUptake).toBeLessThan(env.soil.soilWater); // not soil-limited
  });

  it('tree uptake is Liebig-capped by soil water (drought)', () => {
    // Dry soil + strong root → uptake limited by soil, not root.
    const env = neutralEnv({ soil: { soilWater: 0.5, organicMatter: 50, contamination: 0, nutrients: { nitrogen: 50, phosphorus: 50, potassium: 50 }, health: 1, ph: 6.5, compaction: 0, microbialActivity: 1.0 } });
    const tree = neutralTree({
      water: { stored: 5, capacity: 50 },
      roots: { development: 1.0, absorptionCapacity: 1.0 }, // strong root
      foliage: { currentLeaves: 5000, leafCapacity: 5000, activeLeafArea: 5, seasonalCondition: 1, leafGrowthProgress: 0 },
    });
    const dailyWater = 50;
    const evapRatePerDay = 0.001;
    const balance = computeWaterBalance({
      soilWater: env.soil.soilWater,
      treeWater: tree.water.stored,
      treeWaterCapacity: tree.water.capacity,
      dailyWaterNeedL: dailyWater,
      rainfall: 0,
      evaporationRatePerDay: evapRatePerDay,
      rootAbsorptionCapacity: tree.roots.absorptionCapacity,
      stepDays: STEP_DAYS,
    });
    // availableForUptake = 0.5 - tiny evap - drainage ≈ 0.5 (small)
    expect(balance.treeUptake).toBeLessThanOrEqual(0.5);
    expect(balance.treeUptake).toBeGreaterThan(0);
  });

  it('soilWaterAfter never exceeds SOIL_WATER_CAPACITY (runoff handles excess)', () => {
    const env = neutralEnv({ soil: { soilWater: 140, organicMatter: 50, contamination: 0, nutrients: { nitrogen: 50, phosphorus: 50, potassium: 50 }, health: 1, ph: 6.5, compaction: 0, microbialActivity: 1.0 } });
    const tree = neutralTree();
    const evapRatePerDay = 0.01;
    const balance = computeWaterBalance({
      soilWater: env.soil.soilWater,
      treeWater: tree.water.stored,
      treeWaterCapacity: tree.water.capacity,
      dailyWaterNeedL: 1,
      rainfall: 50, // massive rainfall
      evaporationRatePerDay: evapRatePerDay,
      rootAbsorptionCapacity: tree.roots.absorptionCapacity,
      stepDays: STEP_DAYS,
    });
    expect(balance.soilWaterAfter).toBeLessThanOrEqual(PROVISIONAL_RESOURCE_SOIL_WATER_CAPACITY);
    expect(balance.runoff).toBeGreaterThan(0);
  });

  it('transpiration is removed from tree.water.stored (not soil)', () => {
    // Zero rainfall + low evap so soil water barely changes; transpiration
    // drains the tree buffer.
    const env = neutralEnv();
    const tree = neutralTree({ water: { stored: 30, capacity: 50 } });
    const evapRatePerDay = 0.001;
    const balance = computeWaterBalance({
      soilWater: env.soil.soilWater,
      treeWater: tree.water.stored,
      treeWaterCapacity: tree.water.capacity,
      dailyWaterNeedL: 10, // 10 L/day transpiration
      rainfall: 0,
      evaporationRatePerDay: evapRatePerDay,
      rootAbsorptionCapacity: 0.1, // weak root so uptake is small
      stepDays: STEP_DAYS,
    });
    expect(balance.transpiration).toBeCloseTo(10 * STEP_DAYS, 5);
    expect(balance.treeWaterAfter).toBeLessThan(tree.water.stored); // buffer drained
  });
});

describe('water balance — applyWaterBalance', () => {
  it('writes soilWater, tree.water.stored, freshwater.groundwater, freshwater.availability', () => {
    const env = neutralEnv({ soil: { soilWater: 80, organicMatter: 50, contamination: 0, nutrients: { nitrogen: 50, phosphorus: 50, potassium: 50 }, health: 1, ph: 6.5, compaction: 0, microbialActivity: 1.0 } });
    const tree = neutralTree({ water: { stored: 30, capacity: 50 } });
    const evapRatePerDay = computeSoilEvaporationRate(WEATHER_EVENT_MAP.sunny, 22);
    const balance = computeWaterBalance({
      soilWater: env.soil.soilWater,
      treeWater: tree.water.stored,
      treeWaterCapacity: tree.water.capacity,
      dailyWaterNeedL: 5,
      rainfall: 3,
      evaporationRatePerDay: evapRatePerDay,
      rootAbsorptionCapacity: 0.5,
      stepDays: STEP_DAYS,
    });
    const initialGroundwater = env.freshwater.groundwater;
    applyWaterBalance(env, tree, balance);
    expect(env.soil.soilWater).toBe(balance.soilWaterAfter);
    expect(tree.water.stored).toBe(balance.treeWaterAfter);
    expect(env.freshwater.groundwater).toBe(initialGroundwater + balance.drainage);
    expect(env.freshwater.availability).toBe(
      computeFreshwaterAvailability(balance.soilWaterAfter, env.freshwater.groundwater),
    );
  });
});

describe('water balance — evaporation', () => {
  it('evaporation is zero at or below base temperature', () => {
    const rate = computeSoilEvaporationRate(WEATHER_EVENT_MAP.frost, 5);
    expect(rate).toBe(0);
  });

  it('evaporation scales with temperature', () => {
    const coldRate = computeSoilEvaporationRate(WEATHER_EVENT_MAP.sunny, 20);
    const hotRate = computeSoilEvaporationRate(WEATHER_EVENT_MAP.sunny, 30);
    expect(hotRate).toBeGreaterThan(coldRate);
  });

  it('drought increases evaporation vs sunny at the same temperature', () => {
    const sunny = computeSoilEvaporationRate(WEATHER_EVENT_MAP.sunny, 25);
    const drought = computeSoilEvaporationRate(WEATHER_EVENT_MAP.drought, 25);
    expect(drought).toBeGreaterThan(sunny);
  });
});

describe('nutrient balance — conservation (TDD §18.4 invariant)', () => {
  it('soilNutrient_after + treeNutrient_after + leached + consumed = soilNutrient_before + treeNutrient_before + replenished', () => {
    const soilNutrients: NutrientState = { nitrogen: 80, phosphorus: 70, potassium: 60 };
    const treeNutrients: NutrientState = { nitrogen: 5, phosphorus: 2, potassium: 4 };
    const balance = computeNutrientBalance({
      soilNutrients,
      treeNutrients,
      speciesNutrientRequirement: WHITE_OAK.nutrientRequirement,
      speciesMaxFoliage: 10050,
      currentLeaves: 5000,
      rootAbsorptionCapacity: 0.5,
      soilWater: 100, // below field capacity → no leaching
      stepDays: STEP_DAYS,
    });
    // For each nutrient:
    //   soilAfter + treeAfter + leached + consumed = soilBefore + treeBefore + replenished
    // (absorbed cancels — it's a transfer from soil to tree; consumed is a
    //  loss to atmosphere as the tree metabolises nutrients for growth)
    for (const nutrient of ['nitrogen', 'phosphorus', 'potassium'] as const) {
      const component = balance[nutrient];
      const inputs = component.soilBefore + component.treeBefore + component.replenished;
      const outputs = component.soilAfter + component.treeAfter +
        component.leached + component.consumed;
      expect(outputs).toBeCloseTo(inputs, 5);
    }
  });

  it('leaching occurs when soil is saturated (above field capacity)', () => {
    const balance = computeNutrientBalance({
      soilNutrients: { nitrogen: 80, phosphorus: 70, potassium: 60 },
      treeNutrients: { nitrogen: 5, phosphorus: 2, potassium: 4 },
      speciesNutrientRequirement: WHITE_OAK.nutrientRequirement,
      speciesMaxFoliage: 10050,
      currentLeaves: 5000,
      rootAbsorptionCapacity: 0.5,
      soilWater: 150, // saturated (above SOIL_WATER_CAPACITY = 150? no, just at capacity)
      stepDays: 1, // a full day for visible leaching
    });
    // At soilWater=150 (= capacity), saturationFraction = 1.0
    expect(balance.nitrogen.leached).toBeGreaterThan(0);
    expect(balance.phosphorus.leached).toBeGreaterThan(0);
    expect(balance.potassium.leached).toBeGreaterThan(0);
  });

  it('no leaching below field capacity', () => {
    const balance = computeNutrientBalance({
      soilNutrients: { nitrogen: 80, phosphorus: 70, potassium: 60 },
      treeNutrients: { nitrogen: 5, phosphorus: 2, potassium: 4 },
      speciesNutrientRequirement: WHITE_OAK.nutrientRequirement,
      speciesMaxFoliage: 10050,
      currentLeaves: 5000,
      rootAbsorptionCapacity: 0.5,
      soilWater: 50, // below field capacity (75)
      stepDays: 1,
    });
    expect(balance.nitrogen.leached).toBe(0);
    expect(balance.phosphorus.leached).toBe(0);
    expect(balance.potassium.leached).toBe(0);
  });

  it('tree absorption is Liebig-capped by root absorption capacity', () => {
    // Saturate soil nutrients + low root absorption → absorption limited by root.
    const balance = computeNutrientBalance({
      soilNutrients: { nitrogen: 200, phosphorus: 200, potassium: 200 },
      treeNutrients: { nitrogen: 1, phosphorus: 1, potassium: 1 },
      speciesNutrientRequirement: WHITE_OAK.nutrientRequirement,
      speciesMaxFoliage: 10050,
      currentLeaves: 5000,
      rootAbsorptionCapacity: 0.1, // weak root
      soilWater: 50, // below field capacity → no leaching
      stepDays: STEP_DAYS,
    });
    // rootCap.N = req.N × foliageFrac × MAX_UPTAKE_FRACTION × rootAbs × stepDays
    const foliageFraction = 5000 / 10050;
    const expectedRootCapN =
      WHITE_OAK.nutrientRequirement.nitrogen * foliageFraction *
      PROVISIONAL_RESOURCE_MAX_UPTAKE_FRACTION * 0.1 * STEP_DAYS;
    expect(balance.nitrogen.absorbed).toBeCloseTo(expectedRootCapN, 5);
  });

  it('tree absorption is Liebig-capped by soil nutrient availability', () => {
    // Dry soil + tiny soil nutrients → absorption limited by soil.
    const balance = computeNutrientBalance({
      soilNutrients: { nitrogen: 0.1, phosphorus: 0.1, potassium: 0.1 },
      treeNutrients: { nitrogen: 5, phosphorus: 2, potassium: 4 },
      speciesNutrientRequirement: WHITE_OAK.nutrientRequirement,
      speciesMaxFoliage: 10050,
      currentLeaves: 5000,
      rootAbsorptionCapacity: 1.0, // strong root
      soilWater: 50,
      stepDays: STEP_DAYS,
    });
    expect(balance.nitrogen.absorbed).toBeLessThanOrEqual(0.1);
    expect(balance.nitrogen.absorbed).toBeGreaterThan(0);
  });

  it('tree consumption scales with foliage (more leaves → more consumption)', () => {
    const fewLeaves = computeNutrientBalance({
      soilNutrients: { nitrogen: 100, phosphorus: 100, potassium: 100 },
      treeNutrients: { nitrogen: 5, phosphorus: 2, potassium: 4 },
      speciesNutrientRequirement: WHITE_OAK.nutrientRequirement,
      speciesMaxFoliage: 10050,
      currentLeaves: 100, // few leaves
      rootAbsorptionCapacity: 0.5,
      soilWater: 50,
      stepDays: 1,
    });
    const manyLeaves = computeNutrientBalance({
      soilNutrients: { nitrogen: 100, phosphorus: 100, potassium: 100 },
      treeNutrients: { nitrogen: 5, phosphorus: 2, potassium: 4 },
      speciesNutrientRequirement: WHITE_OAK.nutrientRequirement,
      speciesMaxFoliage: 10050,
      currentLeaves: 5000, // many leaves
      rootAbsorptionCapacity: 0.5,
      soilWater: 50,
      stepDays: 1,
    });
    expect(manyLeaves.nitrogen.consumed).toBeGreaterThan(fewLeaves.nitrogen.consumed);
  });

  it('applyNutrientBalance writes soil + tree nutrients', () => {
    const env = neutralEnv();
    const tree = neutralTree();
    const balance = computeNutrientBalance({
      soilNutrients: env.soil.nutrients,
      treeNutrients: tree.nutrients,
      speciesNutrientRequirement: WHITE_OAK.nutrientRequirement,
      speciesMaxFoliage: 10050,
      currentLeaves: 5000,
      rootAbsorptionCapacity: 0.5,
      soilWater: env.soil.soilWater,
      stepDays: STEP_DAYS,
    });
    applyNutrientBalance(env, tree, balance);
    expect(env.soil.nutrients).toEqual(balance.nutrientsAfter);
    expect(tree.nutrients).toEqual(balance.treeNutrientsAfter);
  });
});

describe('fertilizer application (TDD §18.1: fertilizer changes nutrients)', () => {
  it('balanced 10-10-10 adds 10/10/10 per unit to soil', () => {
    const env = neutralEnv({ soil: { soilWater: 50, organicMatter: 50, contamination: 0, nutrients: { nitrogen: 30, phosphorus: 30, potassium: 30 }, health: 1, ph: 6.5, compaction: 0, microbialActivity: 1.0 } });
    const before = { ...env.soil.nutrients };
    const result = applyFertilizer(env, BALANCED_10_10_10, 1, 0);
    expect(result.nutrientsAdded.nitrogen).toBe(10);
    expect(result.nutrientsAdded.phosphorus).toBe(10);
    expect(result.nutrientsAdded.potassium).toBe(10);
    expect(result.nutrientsAfter.nitrogen).toBe(before.nitrogen + 10);
    expect(result.nutrientsAfter.phosphorus).toBe(before.phosphorus + 10);
    expect(result.nutrientsAfter.potassium).toBe(before.potassium + 10);
    expect(result.nutrientsOverflowed.nitrogen).toBe(0); // within capacity
  });

  it('multiple units scale linearly', () => {
    const env = neutralEnv({ soil: { soilWater: 50, organicMatter: 50, contamination: 0, nutrients: { nitrogen: 30, phosphorus: 30, potassium: 30 }, health: 1, ph: 6.5, compaction: 0, microbialActivity: 1.0 } });
    const result = applyFertilizer(env, BALANCED_10_10_10, 3, 0);
    expect(result.nutrientsAdded.nitrogen).toBe(30);
    expect(result.nutrientsAdded.phosphorus).toBe(30);
    expect(result.nutrientsAdded.potassium).toBe(30);
  });

  it('soil nutrient capacity caps added nutrients (overflow tracked)', () => {
    // Soil at 195/200 capacity; applying 1 unit of balanced (10/10/10) → only 5/5/5 fits.
    const env = neutralEnv({ soil: { soilWater: 50, organicMatter: 50, contamination: 0, nutrients: { nitrogen: 195, phosphorus: 195, potassium: 195 }, health: 1, ph: 6.5, compaction: 0, microbialActivity: 1.0 } });
    const result = applyFertilizer(env, BALANCED_10_10_10, 1, 0);
    expect(result.nutrientsAfter.nitrogen).toBe(PROVISIONAL_RESOURCE_SOIL_NUTRIENT_CAPACITY);
    expect(result.nutrientsAdded.nitrogen).toBe(5);
    expect(result.nutrientsOverflowed.nitrogen).toBe(5);
  });

  it('urea 46-0-0 adds only nitrogen', () => {
    const env = neutralEnv({ soil: { soilWater: 50, organicMatter: 50, contamination: 0, nutrients: { nitrogen: 30, phosphorus: 30, potassium: 30 }, health: 1, ph: 6.5, compaction: 0, microbialActivity: 1.0 } });
    const result = applyFertilizer(env, UREA_46_0_0, 1, 0);
    expect(result.nutrientsAdded.nitrogen).toBe(46);
    expect(result.nutrientsAdded.phosphorus).toBe(0);
    expect(result.nutrientsAdded.potassium).toBe(0);
  });

  it('compost adds organic matter (synthetic fertilizers do not)', () => {
    const env = neutralEnv();
    const compostResult = applyFertilizer(env, COMPOST, 1, 0);
    const balancedResult = applyFertilizer(env, BALANCED_10_10_10, 1, 0);
    expect(compostResult.organicMatterAdded).toBeGreaterThan(0);
    expect(balancedResult.organicMatterAdded).toBe(0);
  });
});

describe('excess fertilizer increases contamination (TDD §18.1, GDD §8.3)', () => {
  it('over-application (above capacity) adds contamination from overflow', () => {
    // Soil at capacity — applying more adds contamination.
    const env = neutralEnv({ soil: { soilWater: 100, organicMatter: 50, contamination: 0, nutrients: { nitrogen: 200, phosphorus: 200, potassium: 200 }, health: 1, ph: 6.5, compaction: 0, microbialActivity: 1.0 } });
    const contaminationBefore = env.soil.contamination;
    const result = applyFertilizer(env, BALANCED_10_10_10, 5, 0);
    expect(result.contaminationAfter).toBeGreaterThan(contaminationBefore);
    expect(result.nutrientsOverflowed.nitrogen).toBe(50); // 5 units × 10, all overflowed
    expect(result.nutrientsOverflowed.phosphorus).toBe(50);
    expect(result.nutrientsOverflowed.potassium).toBe(50);
  });

  it('within-capacity application has zero overflow contamination', () => {
    const env = neutralEnv({ soil: { soilWater: 50, organicMatter: 50, contamination: 0, nutrients: { nitrogen: 30, phosphorus: 30, potassium: 30 }, health: 1, ph: 6.5, compaction: 0, microbialActivity: 1.0 } });
    const result = applyFertilizer(env, BALANCED_10_10_10, 1, 0);
    expect(result.nutrientsOverflowed.nitrogen).toBe(0);
    expect(result.nutrientsOverflowed.phosphorus).toBe(0);
    expect(result.nutrientsOverflowed.potassium).toBe(0);
  });

  it('synthetic fertilizer contamination scales with units', () => {
    const env = neutralEnv({ soil: { soilWater: 50, organicMatter: 50, contamination: 0, nutrients: { nitrogen: 30, phosphorus: 30, potassium: 30 }, health: 1, ph: 6.5, compaction: 0, microbialActivity: 1.0 } });
    const oneUnit = applyFertilizer(env, UREA_46_0_0, 1, 0);
    const fiveUnits = applyFertilizer(env, UREA_46_0_0, 5, 0);
    expect(fiveUnits.contaminationAfter - fiveUnits.contaminationBefore).toBeGreaterThan(
      oneUnit.contaminationAfter - oneUnit.contaminationBefore,
    );
  });

  it('compost has very low contamination vs synthetic', () => {
    const env = neutralEnv({ soil: { soilWater: 50, organicMatter: 50, contamination: 0, nutrients: { nitrogen: 30, phosphorus: 30, potassium: 30 }, health: 1, ph: 6.5, compaction: 0, microbialActivity: 1.0 } });
    const compostResult = applyFertilizer(env, COMPOST, 1, 0);
    const ureaResult = applyFertilizer(env, UREA_46_0_0, 1, 0);
    const compostAdded = compostResult.contaminationAfter - compostResult.contaminationBefore;
    const ureaAdded = ureaResult.contaminationAfter - ureaResult.contaminationBefore;
    expect(compostAdded).toBeLessThan(ureaAdded);
  });
});

describe('apply-water action handler pure function (TDD §18.1)', () => {
  it('applyWaterToSoil adds water to soil (within capacity)', () => {
    const result = applyWaterToSoil(50, 30, PROVISIONAL_RESOURCE_SOIL_WATER_CAPACITY, 0);
    expect(result.soilWaterAfter).toBe(80);
    expect(result.runoff).toBe(0);
  });

  it('applyWaterToSoil over-capacity becomes runoff', () => {
    const result = applyWaterToSoil(140, 50, PROVISIONAL_RESOURCE_SOIL_WATER_CAPACITY, 0);
    expect(result.soilWaterAfter).toBe(PROVISIONAL_RESOURCE_SOIL_WATER_CAPACITY);
    expect(result.runoff).toBe(40);
  });

  it('applyWaterToSoil zero litres is a no-op', () => {
    const result = applyWaterToSoil(50, 0, PROVISIONAL_RESOURCE_SOIL_WATER_CAPACITY, 0);
    expect(result.soilWaterAfter).toBe(50);
    expect(result.runoff).toBe(0);
  });
});

describe('soil health derivation (TDD §8.3, GDD §10.1)', () => {
  it('organic matter fraction saturates at ORGANIC_MATTER_SATURATION', () => {
    expect(organicMatterFraction(0)).toBe(0);
    expect(organicMatterFraction(PROVISIONAL_RESOURCE_ORGANIC_MATTER_SATURATION / 2)).toBeCloseTo(0.5, 5);
    expect(organicMatterFraction(PROVISIONAL_RESOURCE_ORGANIC_MATTER_SATURATION)).toBe(1);
    expect(organicMatterFraction(PROVISIONAL_RESOURCE_ORGANIC_MATTER_SATURATION * 2)).toBe(1);
  });

  it('nutrient fraction is Liebig min of N, P, K vs capacity', () => {
    // All nutrients at 50% of capacity → factor 0.5.
    const halfCap = PROVISIONAL_RESOURCE_SOIL_NUTRIENT_CAPACITY / 2;
    expect(nutrientFraction({ nitrogen: halfCap, phosphorus: halfCap, potassium: halfCap })).toBeCloseTo(0.5, 5);
    // Nitrogen is the limiting factor.
    expect(nutrientFraction({ nitrogen: 10, phosphorus: halfCap, potassium: halfCap })).toBeCloseTo(0.05, 5);
  });

  it('moisture fraction peaks at IDEAL_SOIL_WATER_FRACTION', () => {
    const idealWater = PROVISIONAL_RESOURCE_SOIL_WATER_CAPACITY * PROVISIONAL_RESOURCE_IDEAL_SOIL_WATER_FRACTION;
    expect(moistureFraction(0)).toBe(0); // bone dry
    expect(moistureFraction(idealWater)).toBeCloseTo(1, 5); // ideal
    expect(moistureFraction(PROVISIONAL_RESOURCE_SOIL_WATER_CAPACITY)).toBe(0); // waterlogged
  });

  it('contamination fraction is 1 at zero contamination, 0 at full degrade', () => {
    expect(contaminationFraction(0)).toBe(1);
    expect(contaminationFraction(PROVISIONAL_RESOURCE_CONTAMINATION_FULL_DEGRADE)).toBe(0);
    expect(contaminationFraction(PROVISIONAL_RESOURCE_CONTAMINATION_FULL_DEGRADE * 2)).toBe(0);
  });

  it('soil health = weighted sum of factors (GDD §8.3 derived indicator)', () => {
    // Full-ideal soil → health = 1.0.
    const fullEnv = neutralEnv({
      soil: {
        health: 0, // ignored — recomputed
        organicMatter: PROVISIONAL_RESOURCE_ORGANIC_MATTER_SATURATION,
        contamination: 0,
        nutrients: {
          nitrogen: PROVISIONAL_RESOURCE_SOIL_NUTRIENT_CAPACITY,
          phosphorus: PROVISIONAL_RESOURCE_SOIL_NUTRIENT_CAPACITY,
          potassium: PROVISIONAL_RESOURCE_SOIL_NUTRIENT_CAPACITY,
        },
        soilWater: PROVISIONAL_RESOURCE_SOIL_WATER_CAPACITY * PROVISIONAL_RESOURCE_IDEAL_SOIL_WATER_FRACTION,
        ph: 6.5,
        compaction: 0,
        microbialActivity: 1.0,
      },
    });
    expect(computeSoilHealth(fullEnv)).toBeCloseTo(1, 5);

    // Fully degraded soil (in non-stub factors). The pH extension-point stub
    // contributes its full weight (0.10) by design — the stubs always return
    // 1.0 until P6+ models real pH/compaction/microbial dynamics. So the
    // floor of soil health in P2 is `w.ph * 1.0 = 0.10`.
    const degraded = neutralEnv({
      soil: {
        health: 1, // ignored — recomputed
        organicMatter: 0,
        contamination: PROVISIONAL_RESOURCE_CONTAMINATION_FULL_DEGRADE,
        nutrients: { nitrogen: 0, phosphorus: 0, potassium: 0 },
        soilWater: 0,
        ph: 6.5,
        compaction: 0,
        microbialActivity: 1.0,
      },
    });
    // The non-stub factors contribute 0; the ph stub contributes its 0.10 weight.
    expect(computeSoilHealth(degraded)).toBeCloseTo(0.10, 5);
  });

  it('soil health is in [0, 1] for arbitrary inputs', () => {
    const values = [0, 0.1, 0.5, 1, 2, 10, 1000];
    for (const om of values) {
      for (const sw of values) {
        for (const cont of values) {
          const env = neutralEnv({
            soil: {
              health: 1, organicMatter: om, contamination: cont,
              nutrients: { nitrogen: 50, phosphorus: 50, potassium: 50 },
              soilWater: sw, ph: 6.5, compaction: 0, microbialActivity: 1.0,
            },
          });
          const h = computeSoilHealth(env);
          expect(h).toBeGreaterThanOrEqual(0);
          expect(h).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('higher contamination reduces soil health', () => {
    const clean = neutralEnv({ soil: { soilWater: 100, organicMatter: 50, contamination: 0, nutrients: { nitrogen: 50, phosphorus: 50, potassium: 50 }, health: 1, ph: 6.5, compaction: 0, microbialActivity: 1.0 } });
    const contaminated = neutralEnv({ soil: { soilWater: 100, organicMatter: 50, contamination: 50, nutrients: { nitrogen: 50, phosphorus: 50, potassium: 50 }, health: 1, ph: 6.5, compaction: 0, microbialActivity: 1.0 } });
    expect(computeSoilHealth(contaminated)).toBeLessThan(computeSoilHealth(clean));
  });
});
