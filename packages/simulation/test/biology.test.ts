/**
 * Biology unit tests (TDD §18.1).
 *
 * Pure-function tests asserting the biological invariants the GDD and TDD
 * require:
 *
 *   - Water deficiency reduces photosynthesis.
 *   - Reduced foliage reduces energy production.
 *   - Liebig: excess fertilizer doesn't help when water is limiting.
 *   - Energy reserves decline when maintenance exceeds production.
 *   - Mature trees approach structural growth limits.
 *   - Repeated defoliation raises mortality risk.
 *   - Mature tree survives one near-total defoliation but suffers on repeats.
 *   - No negative leaf counts.
 *   - Deterministic output under identical seed.
 *   - Health is derived, not stored independently.
 */
import { describe, it, expect } from 'vitest';
import {
  photosynthesisForStep,
  temperatureFactor,
  waterFactor,
  nutrientFactor,
  co2Factor,
  leafHealth,
  effectiveLeafCondition,
  dailyWaterNeed,
  computeSpeciesMaxFoliage,
  allocateEnergy,
  applyGrowth,
  computeReserveCapacity,
  computeLeafCapacity,
  computeHealth,
  advanceSeasonalCondition,
  maxSupportedLeaves,
  updateStress,
  checkMortality,
  recentSevereDefoliations,
  harvestLeaves,
  estimateSustainableHarvest,
  maturityMultiplier,
  biomassScore,
  growthFactor,
  SEVERE_DEFOLIATION_FRACTION,
} from '../src/biology/index.js';
import { Rng } from '../src/rng.js';
import {
  testTree,
  testContext,
  neutralEnvironment,
  SPECIES,
  SECONDS_PER_DAY,
} from './_biology-helpers.js';

describe('photosynthesis — Liebig limiting factors (TDD §7.2)', () => {
  it('water deficiency reduces photosynthesis (TDD §18.1)', () => {
    const ctx = testContext();
    // Full water: production baseline.
    const full = testTree({ water: { stored: 50, capacity: 50 } });
    const fullProduction = photosynthesisForStep(full, ctx);

    // Deficient water (10% of need): production should drop substantially.
    const deficient = testTree({ water: { stored: 1, capacity: 50 } });
    const deficientProduction = photosynthesisForStep(deficient, ctx);

    expect(deficientProduction).toBeGreaterThan(0);
    expect(deficientProduction).toBeLessThan(fullProduction);
    // Liebig: water at 10% caps production at ~10% of full.
    expect(deficientProduction).toBeLessThan(fullProduction * 0.25);
  });

  it('reduced foliage reduces production (TDD §18.1)', () => {
    const ctx = testContext();
    const fullCanopy = testTree({ foliage: { currentLeaves: 1000 } });
    const halfCanopy = testTree({ foliage: { currentLeaves: 500 } });
    const fullProd = photosynthesisForStep(fullCanopy, ctx);
    const halfProd = photosynthesisForStep(halfCanopy, ctx);
    expect(halfProd).toBeGreaterThan(0);
    expect(halfProd).toBeLessThan(fullProd);
    // Half the leaves → roughly half the production.
    expect(halfProd).toBeCloseTo(fullProd / 2, -1);
  });

  it('zero foliage → zero production', () => {
    const ctx = testContext();
    const noLeaves = testTree({ foliage: { currentLeaves: 0 } });
    expect(photosynthesisForStep(noLeaves, ctx)).toBe(0);
  });

  it('dead trees do not photosynthesize', () => {
    const ctx = testContext();
    const dead = testTree({ alive: false });
    expect(photosynthesisForStep(dead, ctx)).toBe(0);
  });

  it('deciduous trees in winter produce nothing (dormancy)', () => {
    const ctx = testContext({ season: 'winter' });
    const tree = testTree({ foliage: { currentLeaves: 1000, seasonalCondition: 0 } });
    expect(photosynthesisForStep(tree, ctx)).toBe(0);
  });

  it('Liebig: excess fertilizer cannot buy growth when water is limiting', () => {
    const ctx = testContext();
    // Low water + abundant nutrients.
    const lowWater = testTree({
      water: { stored: 1, capacity: 50 },
      nutrients: { nitrogen: 1000, phosphorus: 1000, potassium: 1000 },
    });
    // Low water + minimal nutrients (still non-zero).
    const lowWaterLowNut = testTree({
      water: { stored: 1, capacity: 50 },
      nutrients: { nitrogen: 5, phosphorus: 2, potassium: 4 },
    });
    // Adding fertilizer didn't help — water is the limiting factor.
    expect(photosynthesisForStep(lowWater, ctx)).toBeCloseTo(
      photosynthesisForStep(lowWaterLowNut, ctx),
      5,
    );
  });

  it('Liebig: temperature caps production below the optimum', () => {
    const coldCtx = testContext({
      environment: neutralEnvironment({ globalTemperature: 10 }),
    });
    const warmCtx = testContext({
      environment: neutralEnvironment({ globalTemperature: 22 }),
    });
    const tree = testTree();
    const cold = photosynthesisForStep(tree, coldCtx);
    const warm = photosynthesisForStep(tree, warmCtx);
    expect(cold).toBeGreaterThan(0);
    expect(cold).toBeLessThan(warm);
  });
});

describe('temperature factor', () => {
  it('is 0 at and below minimum', () => {
    const r = { minimum: 5, optimum: 22, maximum: 38 };
    expect(temperatureFactor(5, r)).toBe(0);
    expect(temperatureFactor(0, r)).toBe(0);
    expect(temperatureFactor(-5, r)).toBe(0);
  });
  it('is 0 at and above maximum', () => {
    const r = { minimum: 5, optimum: 22, maximum: 38 };
    expect(temperatureFactor(38, r)).toBe(0);
    expect(temperatureFactor(50, r)).toBe(0);
  });
  it('is 1 at optimum', () => {
    const r = { minimum: 5, optimum: 22, maximum: 38 };
    expect(temperatureFactor(22, r)).toBeCloseTo(1, 5);
  });
  it('ramps linearly between min and optimum', () => {
    const r = { minimum: 5, optimum: 22, maximum: 38 };
    // halfway between min and opt → 0.5
    expect(temperatureFactor(13.5, r)).toBeCloseTo(0.5, 5);
  });
});

describe('water / co2 / nutrient factors', () => {
  it('waterFactor clamps at 1.0 (excess water does not help)', () => {
    const tree = testTree({ water: { stored: 1000, capacity: 1000 } });
    const need = dailyWaterNeed(tree, SPECIES);
    expect(waterFactor(tree, need)).toBe(1);
  });
  it('dailyWaterNeed scales by species max foliage, not sapling leafCapacity', () => {
    // A sapling with 25 leaves shouldn't demand 50L * (25/200) = 6.25 L/day —
    // it should demand 50L * (25 / speciesMaxFoliage) ≈ 0.12 L/day.
    const sapling = testTree({ foliage: { currentLeaves: 25, leafCapacity: 200 } });
    const max = computeSpeciesMaxFoliage(SPECIES); // 200 + 100*100 = 10200
    expect(max).toBe(10200);
    const need = dailyWaterNeed(sapling, SPECIES);
    expect(need).toBeCloseTo((25 / 10200) * SPECIES.waterRequirement, 5);
  });
  it('co2Factor saturates above PROVISIONAL_BIOLOGY_CO2_SATURATION_PPM', () => {
    expect(co2Factor(400)).toBe(1);
    expect(co2Factor(1000)).toBe(1);
    expect(co2Factor(200)).toBeCloseTo(0.5, 5);
  });
  it('nutrientFactor: Liebig min of N, P, K', () => {
    const req = { nitrogen: 5, phosphorus: 2, potassium: 4 };
    // All sufficient → 1.0
    expect(nutrientFactor({ nitrogen: 10, phosphorus: 4, potassium: 8 }, req)).toBe(1);
    // N deficient (50% of req) → 0.1 (since 2.5/5 = 0.5, clamped to min(0.5, 1, 1, 1) = 0.5; wait, min(n/req, p/req, k/req, 1) = min(0.5, 2, 2, 1) = 0.5)
    expect(nutrientFactor({ nitrogen: 2.5, phosphorus: 4, potassium: 8 }, req)).toBeCloseTo(0.5, 5);
    // P deficient
    expect(nutrientFactor({ nitrogen: 10, phosphorus: 1, potassium: 8 }, req)).toBeCloseTo(0.5, 5);
  });
});

describe('effectiveLeafCondition — stress yellows leaves', () => {
  it('leafHealth = 1 - stress', () => {
    expect(leafHealth(0)).toBe(1);
    expect(leafHealth(0.5)).toBe(0.5);
    expect(leafHealth(1)).toBe(0);
  });
  it('effectiveLeafCondition is in [0, 1] for any inputs', () => {
    for (const stress of [0, 0.3, 0.7, 1]) {
      for (const seasonal of [0, 0.5, 1]) {
        const v = effectiveLeafCondition(stress, seasonal);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('energy allocation (TDD §7.3) — survival-first', () => {
  it('reserves decline when maintenance exceeds production', () => {
    const ctx = testContext();
    // Mature-ish tree with low production (few leaves) but big biomass → high maintenance.
    const tree = testTree({
      structure: { height: 5, trunkDiameter: 0.5, branchDevelopment: 50, structuralIntegrity: 1 },
      foliage: { currentLeaves: 10, leafCapacity: 100 },
      energy: { reserves: 100, production: 0, consumption: 0 },
    });
    const production = photosynthesisForStep(tree, ctx);
    const alloc = allocateEnergy(tree, production, ctx);
    expect(alloc.reserveDraw).toBeGreaterThan(0);
    expect(alloc.surplus).toBe(0);
    expect(alloc.reserveStorage).toBe(0);
  });

  it('surplus is allocated to growth + reserves when production > maintenance', () => {
    const ctx = testContext();
    const tree = testTree({
      foliage: { currentLeaves: 1000, leafCapacity: 2000 },
      energy: { reserves: 100, production: 0, consumption: 0 },
    });
    const production = photosynthesisForStep(tree, ctx);
    const alloc = allocateEnergy(tree, production, ctx);
    expect(alloc.maintenance).toBeGreaterThan(0);
    expect(alloc.surplus).toBeGreaterThan(0);
    expect(alloc.rootGrowth + alloc.trunkGrowth + alloc.branchGrowth + alloc.leafGrowth + alloc.reserveStorage)
      .toBeCloseTo(alloc.surplus, 5);
    // Reproduction is a stub.
    expect(alloc.reproduction).toBe(0);
  });

  it('winter dormancy for deciduous: zero leaf growth', () => {
    const ctx = testContext({ season: 'winter' });
    const tree = testTree();
    const production = 100; // forced
    const alloc = allocateEnergy(tree, production, ctx);
    expect(alloc.leafGrowth).toBe(0);
  });

  it('maturityMultiplier reduces structural growth as tree ages', () => {
    const matureAgeDays = SPECIES.matureAgeDays;
    expect(maturityMultiplier(0, matureAgeDays)).toBe(1);
    expect(maturityMultiplier(matureAgeDays, matureAgeDays)).toBeCloseTo(0.05, 2);
    expect(maturityMultiplier(matureAgeDays * 2, matureAgeDays)).toBeCloseTo(0.05, 2);
    // Half-way to maturity → between 1 and mature.
    const half = maturityMultiplier(matureAgeDays / 2, matureAgeDays);
    expect(half).toBeGreaterThan(0.05);
    expect(half).toBeLessThan(1);
  });
});

describe('growth (TDD §7.6) — asymptotic toward species ceiling', () => {
  it('mature trees approach structural growth limits', () => {
    // Tree near its maximum height — growth factor near 0.
    const nearMax = testTree({
      structure: {
        height: SPECIES.maximumHeight * 0.99,
        trunkDiameter: SPECIES.maximumTrunkDiameter * 0.99,
        branchDevelopment: SPECIES.maximumBranchDevelopment * 0.99,
        structuralIntegrity: 1,
      },
    });
    const frac = nearMax.structure.height / SPECIES.maximumHeight;
    expect(growthFactor(frac)).toBeLessThan(0.001);
  });

  it('growth never exceeds the species maximum', () => {
    const ctx = testContext();
    const tree = testTree({
      structure: {
        height: SPECIES.maximumHeight - 0.001,
        trunkDiameter: SPECIES.maximumTrunkDiameter - 0.001,
        branchDevelopment: SPECIES.maximumBranchDevelopment - 0.001,
        structuralIntegrity: 1,
      },
    });
    const alloc = allocateEnergy(tree, 1000, ctx);
    const growth = applyGrowth(tree, ctx, alloc, maxSupportedLeaves(tree));
    expect(growth.height).toBeLessThanOrEqual(SPECIES.maximumHeight);
    expect(growth.trunkDiameter).toBeLessThanOrEqual(SPECIES.maximumTrunkDiameter);
    expect(growth.branchDevelopment).toBeLessThanOrEqual(SPECIES.maximumBranchDevelopment);
  });

  it('leafCapacity grows with branch development', () => {
    const initial = SPECIES.initial.leafCapacity;
    expect(computeLeafCapacity(0, initial)).toBe(initial);
    expect(computeLeafCapacity(100, initial)).toBe(initial + 100 * 100);
  });
});

describe('reserves (TDD §7.4)', () => {
  it('reserve capacity scales with biomass', () => {
    const sapling = testTree({
      structure: { height: 0.3, trunkDiameter: 0.005, branchDevelopment: 0, structuralIntegrity: 1 },
      roots: { development: 0.1, absorptionCapacity: 0.1 },
    });
    const mature = testTree({
      structure: {
        height: SPECIES.maximumHeight,
        trunkDiameter: SPECIES.maximumTrunkDiameter,
        branchDevelopment: SPECIES.maximumBranchDevelopment,
        structuralIntegrity: 1,
      },
      roots: { development: 1, absorptionCapacity: 1 },
    });
    const saplingCap = computeReserveCapacity(sapling, SPECIES);
    const matureCap = computeReserveCapacity(mature, SPECIES);
    expect(matureCap).toBeGreaterThan(saplingCap);
    expect(matureCap / saplingCap).toBeGreaterThan(3); // mature has 4x biomass
  });

  it('biomassScore is in [0, 4]', () => {
    const sapling = testTree({
      structure: { height: 0.3, trunkDiameter: 0.005, branchDevelopment: 0, structuralIntegrity: 1 },
      roots: { development: 0, absorptionCapacity: 0 },
    });
    const mature = testTree({
      structure: {
        height: SPECIES.maximumHeight,
        trunkDiameter: SPECIES.maximumTrunkDiameter,
        branchDevelopment: SPECIES.maximumBranchDevelopment,
        structuralIntegrity: 1,
      },
      roots: { development: 1, absorptionCapacity: 1 },
    });
    expect(biomassScore(sapling, SPECIES)).toBeGreaterThanOrEqual(0);
    expect(biomassScore(sapling, SPECIES)).toBeLessThan(0.5);
    expect(biomassScore(mature, SPECIES)).toBeCloseTo(4, 1);
  });
});

describe('seasons (GDD §4.4) — deciduous behavior', () => {
  it('seasonal target depends on species + season', () => {
    const winterCtx = testContext({ season: 'winter' });
    const summerCtx = testContext({ season: 'summer' });
    // Deciduous in winter → 0 condition.
    const dormantTree = testTree({ foliage: { currentLeaves: 0, seasonalCondition: 0 } });
    const cond1 = advanceSeasonalCondition(dormantTree, winterCtx);
    expect(cond1).toBeLessThan(0.1); // stays near 0
    // Deciduous in summer → moves toward 1.0.
    const cond2 = advanceSeasonalCondition(dormantTree, summerCtx);
    expect(cond2).toBeGreaterThan(0);
  });

  it('maxSupportedLeaves = leafCapacity * seasonalCondition', () => {
    const tree = testTree({
      foliage: { leafCapacity: 1000, seasonalCondition: 0.5 },
    });
    expect(maxSupportedLeaves(tree)).toBe(500);
  });
});

describe('health — derived, not stored (GDD §5.1)', () => {
  it('dead tree has health 0', () => {
    const ctx = testContext();
    const dead = testTree({ alive: false });
    expect(computeHealth(dead, ctx)).toBe(0);
  });

  it('healthy tree has high health', () => {
    const ctx = testContext();
    const healthy = testTree({
      stress: 0,
      energy: { reserves: 2000, production: 0, consumption: 0 },
      foliage: { currentLeaves: 1000, leafCapacity: 1000 },
    });
    // Reserves near capacity + full foliage + no stress → health close to 1.
    expect(computeHealth(healthy, ctx)).toBeGreaterThan(0.85);
  });

  it('stressed tree has reduced health', () => {
    const ctx = testContext();
    const stressed = testTree({
      stress: 0.8,
      energy: { reserves: 10, production: 0, consumption: 0 },
      foliage: { currentLeaves: 100, leafCapacity: 1000 },
    });
    expect(computeHealth(stressed, ctx)).toBeLessThan(0.3);
  });
});

describe('stress accumulation and recovery (GDD §5.1, §5.6)', () => {
  it('water deficiency adds stress', () => {
    const ctx = testContext();
    const tree = testTree({ water: { stored: 0, capacity: 50 }, stress: 0 });
    const update = updateStress(tree, ctx);
    expect(update.stress).toBeGreaterThan(0);
  });

  it('nutrient deficiency adds stress', () => {
    const ctx = testContext();
    const tree = testTree({
      nutrients: { nitrogen: 0, phosphorus: 0, potassium: 0 },
      stress: 0,
    });
    const update = updateStress(tree, ctx);
    expect(update.stress).toBeGreaterThan(0);
  });

  it('low reserves add stress', () => {
    const ctx = testContext();
    const tree = testTree({
      energy: { reserves: 0.1, production: 0, consumption: 0 },
      stress: 0,
    });
    const update = updateStress(tree, ctx);
    expect(update.stress).toBeGreaterThan(0);
  });

  it('favourable conditions allow stress recovery (with energy cost)', () => {
    const ctx = testContext();
    const tree = testTree({ stress: 0.5 });
    const update = updateStress(tree, ctx);
    expect(update.stress).toBeLessThan(0.5);
    expect(update.recoveryCost).toBeGreaterThan(0);
  });
});

describe('mortality (GDD §5.6) — repeated defoliation', () => {
  it('recentSevereDefoliations counts within the window', () => {
    const now = 100 * SECONDS_PER_DAY;
    const tree = testTree({
      damage: [
        { type: 'severe-defoliation', severity: 0.6, appliedAt: now - 5 * SECONDS_PER_DAY }, // recent
        { type: 'severe-defoliation', severity: 0.7, appliedAt: now - 10 * SECONDS_PER_DAY }, // recent
        { type: 'severe-defoliation', severity: 0.5, appliedAt: now - 100 * SECONDS_PER_DAY }, // pruned
      ],
    });
    expect(recentSevereDefoliations(tree, now)).toBe(2);
  });

  it('repeated severe defoliation raises mortality risk', () => {
    // Use a full-day step so the per-day death probability is meaningful.
    // stepDays = 1.0 → DEATH_DAILY_PROBABILITY applies at full strength.
    const ctx = testContext({ stepSeconds: SECONDS_PER_DAY });
    const now = 100 * SECONDS_PER_DAY;
    const tree = testTree({
      damage: [
        { type: 'severe-defoliation', severity: 0.7, appliedAt: now - 5 * SECONDS_PER_DAY },
        { type: 'severe-defoliation', severity: 0.7, appliedAt: now - 10 * SECONDS_PER_DAY },
      ],
      stress: 0.95,
      energy: { reserves: 5, production: 0, consumption: 0 },
    });
    // The mortality check is RNG-driven; over many trials the death rate should be high.
    let died = 0;
    const N = 200;
    for (let i = 0; i < N; i++) {
      const rng = Rng.fromSeed(i + 1);
      const r = checkMortality(tree, ctx, rng);
      if (r.died) died++;
    }
    // With 2 recent defoliations + critical stress + critical reserves, a
    // full-day step should kill a substantial fraction.
    expect(died).toBeGreaterThan(N * 0.05);
  });

  it('a healthy tree with no defoliation does not die in one step', () => {
    const ctx = testContext();
    const tree = testTree({ stress: 0, energy: { reserves: 500, production: 0, consumption: 0 } });
    const rng = Rng.fromSeed(42);
    const r = checkMortality(tree, ctx, rng);
    expect(r.died).toBe(false);
  });
});

describe('harvest (TDD §7.5, GDD §5.4)', () => {
  it('harvest reduces leaf count', () => {
    const ctx = testContext();
    const tree = testTree({ foliage: { currentLeaves: 1000, leafCapacity: 2000 } });
    const result = harvestLeaves(tree, ctx, 100, 0, 'currency:leaf-dollar');
    expect(result.leavesHarvested).toBe(100);
    expect(result.foliageAfter).toBe(900);
    expect(result.foliageBefore).toBe(1000);
  });

  it('cannot exceed available foliage (no negative leaf counts)', () => {
    const ctx = testContext();
    const tree = testTree({ foliage: { currentLeaves: 50, leafCapacity: 2000 } });
    const result = harvestLeaves(tree, ctx, 1000, 0, 'currency:leaf-dollar');
    expect(result.leavesHarvested).toBeLessThanOrEqual(50);
    expect(result.foliageAfter).toBeGreaterThanOrEqual(0);
    expect(result.foliageAfter).toBe(50 - result.leavesHarvested);
  });

  it('cannot exceed species.maximumHarvestFraction per action', () => {
    const ctx = testContext();
    const tree = testTree({ foliage: { currentLeaves: 1000, leafCapacity: 2000 } });
    const maxAllowed = Math.floor(1000 * SPECIES.maximumHarvestFraction);
    // Request way more than allowed.
    const result = harvestLeaves(tree, ctx, 100000, 0, 'currency:leaf-dollar');
    expect(result.leavesHarvested).toBeLessThanOrEqual(maxAllowed);
    expect(result.leavesHarvested).toBe(maxAllowed);
  });

  it('currency issuance is exactly leavesHarvested * species.leafDenominationMinor', () => {
    const ctx = testContext();
    const tree = testTree({ foliage: { currentLeaves: 1000, leafCapacity: 2000 } });
    const result = harvestLeaves(tree, ctx, 100, 0, 'currency:leaf-dollar');
    const expected = BigInt(result.leavesHarvested) * BigInt(SPECIES.leafDenominationMinor);
    expect(result.currencyIssuance.amount).toBe(String(expected));
    expect(result.currencyIssuance.currencyId).toBe('currency:leaf-dollar');
    expect(result.currencyIssuance.source).toBe('harvest-leaves');
    expect(result.currencyIssuance.treeId).toBe(tree.id);
  });

  it('harvesting induces stress proportional to fraction removed', () => {
    const ctx = testContext();
    const tree = testTree({ foliage: { currentLeaves: 1000, leafCapacity: 2000 } });
    const small = harvestLeaves(tree, ctx, 50, 0, 'currency:leaf-dollar');
    const large = harvestLeaves(tree, ctx, 500, 0, 'currency:leaf-dollar');
    expect(large.stressInduced).toBeGreaterThan(small.stressInduced);
  });

  it('photosynthetic capacity drops after harvest', () => {
    const ctx = testContext();
    const tree = testTree({ foliage: { currentLeaves: 1000, leafCapacity: 2000 } });
    const result = harvestLeaves(tree, ctx, 200, 0, 'currency:leaf-dollar');
    expect(result.photosyntheticCapacityAfter).toBeLessThan(result.photosyntheticCapacityBefore);
  });

  it('dead tree yields zero leaves', () => {
    const ctx = testContext();
    const dead = testTree({ alive: false, foliage: { currentLeaves: 1000, leafCapacity: 2000 } });
    const result = harvestLeaves(dead, ctx, 100, 0, 'currency:leaf-dollar');
    expect(result.leavesHarvested).toBe(0);
    expect(result.foliageAfter).toBe(result.foliageBefore);
  });

  it('SEVERE_DEFOLIATION_FRACTION is 0.5', () => {
    expect(SEVERE_DEFOLIATION_FRACTION).toBe(0.5);
  });

  it('sustainable harvest estimate is non-negative and <= foliage', () => {
    const ctx = testContext();
    const tree = testTree({ foliage: { currentLeaves: 1000, leafCapacity: 2000 } });
    const est = estimateSustainableHarvest(tree, ctx);
    expect(est.leavesPerDay).toBeGreaterThanOrEqual(0);
    expect(est.fractionOfFoliage).toBeGreaterThanOrEqual(0);
    expect(est.fractionOfFoliage).toBeLessThanOrEqual(1);
    expect(est.productionPerDay).toBeGreaterThan(0);
    expect(est.maintenancePerDay).toBeGreaterThan(0);
  });

  it('sustainable harvest drops to 0 when maintenance exceeds production', () => {
    const ctx = testContext();
    // Big biomass, few leaves → maintenance > production.
    const tree = testTree({
      structure: { height: 20, trunkDiameter: 1.0, branchDevelopment: 80, structuralIntegrity: 1 },
      foliage: { currentLeaves: 5, leafCapacity: 2000 },
      energy: { reserves: 100, production: 0, consumption: 0 },
    });
    const est = estimateSustainableHarvest(tree, ctx);
    expect(est.leavesPerDay).toBe(0);
  });
});

describe('determinism (TDD §18.3)', () => {
  it('same tree + context → same photosynthesis output', () => {
    const ctx = testContext();
    const tree = testTree();
    const a = photosynthesisForStep(tree, ctx);
    const b = photosynthesisForStep(tree, ctx);
    expect(a).toBe(b);
  });

  it('same tree + context → same allocation output', () => {
    const ctx = testContext();
    const tree = testTree();
    const production = photosynthesisForStep(tree, ctx);
    const a = allocateEnergy(tree, production, ctx);
    const b = allocateEnergy(tree, production, ctx);
    expect(a).toEqual(b);
  });

  it('mortality check is deterministic given the same RNG state', () => {
    const ctx = testContext();
    const tree = testTree({
      stress: 0.95,
      energy: { reserves: 1, production: 0, consumption: 0 },
      damage: [
        { type: 'severe-defoliation', severity: 0.7, appliedAt: 0 },
        { type: 'severe-defoliation', severity: 0.7, appliedAt: 100 },
      ],
    });
    const r1 = checkMortality(tree, ctx, Rng.fromSeed(42));
    const r2 = checkMortality(tree, ctx, Rng.fromSeed(42));
    expect(r1.died).toBe(r2.died);
  });
});

describe('invariants (TDD §18.4)', () => {
  it('leaf counts never go negative through harvest', () => {
    const ctx = testContext();
    const tree = testTree({ foliage: { currentLeaves: 0, leafCapacity: 100 } });
    const result = harvestLeaves(tree, ctx, 100, 0, 'currency:leaf-dollar');
    expect(result.foliageAfter).toBeGreaterThanOrEqual(0);
    expect(result.leavesHarvested).toBe(0);
  });

  it('biomass score is bounded in [0, 4]', () => {
    const sapling = testTree({
      structure: { height: 0, trunkDiameter: 0, branchDevelopment: 0, structuralIntegrity: 1 },
      roots: { development: 0, absorptionCapacity: 0 },
    });
    const mature = testTree({
      structure: {
        height: SPECIES.maximumHeight * 2, // exceed max — should still clamp
        trunkDiameter: SPECIES.maximumTrunkDiameter * 2,
        branchDevelopment: SPECIES.maximumBranchDevelopment * 2,
        structuralIntegrity: 1,
      },
      roots: { development: 5, absorptionCapacity: 5 },
    });
    expect(biomassScore(sapling, SPECIES)).toBeGreaterThanOrEqual(0);
    expect(biomassScore(mature, SPECIES)).toBeLessThanOrEqual(4);
  });
});
