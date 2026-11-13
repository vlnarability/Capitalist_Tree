/**
 * Trait-effect application tests (P9c — TDD §18.1, §18.4; GDD §11.2 — genetic
 * modifications have meaningful trade-offs).
 *
 * Asserts:
 *   - defaultBiologyParameters: all multipliers 1.0.
 *   - Each of the 7 traits applies its benefit + trade-off to the correct
 *     multipliers at magnitude 1.
 *   - Magnitude scales the effect (magnitude 0.5 → half the effect).
 *   - Multiple active traits stack MULTIPLICATIVELY.
 *   - Deactivated traits are NOT applied.
 *   - Unknown trait ids skipped defensively.
 *   - Purity (freeze test).
 */
import { describe, it, expect } from 'vitest';
import {
  applyTraitEffects,
  defaultBiologyParameters,
} from '../src/index.js';
import type { GeneticTraitState } from '@capitalist-tree/shared';
import {
  RAPID_GROWTH,
  LARGE_FOLIAGE,
  DEEP_ROOTS,
  THICK_TRUNK,
  PEST_RESISTANCE,
  COLD_RESISTANCE,
  EFFICIENT_PHOTOSYNTHESIS,
} from '@capitalist-tree/content';

/** A single active trait at the given magnitude. */
function activeTrait(traitId: string, magnitude: number): GeneticTraitState {
  return { traitId, active: true, generation: 1, magnitude };
}

describe('defaultBiologyParameters', () => {
  it('returns every multiplier as 1.0 (neutral)', () => {
    const p = defaultBiologyParameters();
    expect(p.growthRateMultiplier).toBe(1);
    expect(p.earlyGrowthMultiplier).toBe(1);
    expect(p.structuralGrowthMultiplier).toBe(1);
    expect(p.maxGrowthMultiplier).toBe(1);
    expect(p.productionCapacityMultiplier).toBe(1);
    expect(p.energyProductionMultiplier).toBe(1);
    expect(p.waterDemandMultiplier).toBe(1);
    expect(p.droughtResistanceMultiplier).toBe(1);
    expect(p.reservesCapacityMultiplier).toBe(1);
    expect(p.pestVulnerabilityMultiplier).toBe(1);
    expect(p.frostSurvivalMultiplier).toBe(1);
    expect(p.warmClimatePerformanceMultiplier).toBe(1);
  });
});

describe('applyTraitEffects — per-trait benefit + trade-off (magnitude 1)', () => {
  it('rapid-growth: +growth rate, +water demand', () => {
    const p = applyTraitEffects(defaultBiologyParameters(), [
      activeTrait(RAPID_GROWTH.id, 1),
    ]);
    expect(p.growthRateMultiplier).toBeCloseTo(1.2, 10);
    expect(p.waterDemandMultiplier).toBeCloseTo(1.3, 10);
  });

  it('large-foliage: +production capacity, +water requirement', () => {
    const p = applyTraitEffects(defaultBiologyParameters(), [
      activeTrait(LARGE_FOLIAGE.id, 1),
    ]);
    expect(p.productionCapacityMultiplier).toBeCloseTo(1.25, 10);
    expect(p.waterDemandMultiplier).toBeCloseTo(1.3, 10);
  });

  it('deep-roots: +drought resistance, -early growth speed', () => {
    const p = applyTraitEffects(defaultBiologyParameters(), [
      activeTrait(DEEP_ROOTS.id, 1),
    ]);
    expect(p.droughtResistanceMultiplier).toBeCloseTo(1.4, 10);
    expect(p.earlyGrowthMultiplier).toBeCloseTo(0.85, 10);
  });

  it('thick-trunk: +reserves capacity, -structural growth speed', () => {
    const p = applyTraitEffects(defaultBiologyParameters(), [
      activeTrait(THICK_TRUNK.id, 1),
    ]);
    expect(p.reservesCapacityMultiplier).toBeCloseTo(1.3, 10);
    expect(p.structuralGrowthMultiplier).toBeCloseTo(0.8, 10);
  });

  it('pest-resistance: -pest vulnerability, -growth rate', () => {
    const p = applyTraitEffects(defaultBiologyParameters(), [
      activeTrait(PEST_RESISTANCE.id, 1),
    ]);
    expect(p.pestVulnerabilityMultiplier).toBeCloseTo(0.5, 10);
    expect(p.growthRateMultiplier).toBeCloseTo(0.9, 10);
  });

  it('cold-resistance: +frost survival, -warm-climate performance', () => {
    const p = applyTraitEffects(defaultBiologyParameters(), [
      activeTrait(COLD_RESISTANCE.id, 1),
    ]);
    expect(p.frostSurvivalMultiplier).toBeCloseTo(1.5, 10);
    expect(p.warmClimatePerformanceMultiplier).toBeCloseTo(0.85, 10);
  });

  it('efficient-photosynthesis: +energy production, -max growth ceiling', () => {
    const p = applyTraitEffects(defaultBiologyParameters(), [
      activeTrait(EFFICIENT_PHOTOSYNTHESIS.id, 1),
    ]);
    expect(p.energyProductionMultiplier).toBeCloseTo(1.25, 10);
    expect(p.maxGrowthMultiplier).toBeCloseTo(0.9, 10);
  });
});

describe('applyTraitEffects — magnitude scales the effect', () => {
  it('magnitude 0.5 yields half the effect (rapid-growth growth rate)', () => {
    const p = applyTraitEffects(defaultBiologyParameters(), [
      activeTrait(RAPID_GROWTH.id, 0.5),
    ]);
    // 1 + 0.5 * 0.2 = 1.1 (half of the +0.2 full effect).
    expect(p.growthRateMultiplier).toBeCloseTo(1.1, 10);
    // 1 + 0.5 * 0.3 = 1.15 (half of the +0.3 full effect).
    expect(p.waterDemandMultiplier).toBeCloseTo(1.15, 10);
  });

  it('magnitude 0 yields no effect (neutral multipliers)', () => {
    const p = applyTraitEffects(defaultBiologyParameters(), [
      activeTrait(RAPID_GROWTH.id, 0),
    ]);
    expect(p).toEqual(defaultBiologyParameters());
  });
});

describe('applyTraitEffects — stacking', () => {
  it('multiple active traits stack MULTIPLICATIVELY (rapid-growth + pest-resistance both touch growth rate)', () => {
    const p = applyTraitEffects(defaultBiologyParameters(), [
      activeTrait(RAPID_GROWTH.id, 1), // growthRate × 1.2
      activeTrait(PEST_RESISTANCE.id, 1), // growthRate × 0.9
    ]);
    // 1.2 * 0.9 = 1.08 (multiplicative, not additive 1.2 + 0.9 - 1 = 1.1).
    expect(p.growthRateMultiplier).toBeCloseTo(1.08, 10);
    // water demand only touched by rapid-growth → 1.3.
    expect(p.waterDemandMultiplier).toBeCloseTo(1.3, 10);
    // pest vulnerability only touched by pest-resistance → 0.5.
    expect(p.pestVulnerabilityMultiplier).toBeCloseTo(0.5, 10);
  });

  it('rapid-growth + large-foliage both touch water demand multiplicatively', () => {
    const p = applyTraitEffects(defaultBiologyParameters(), [
      activeTrait(RAPID_GROWTH.id, 1), // water × 1.3
      activeTrait(LARGE_FOLIAGE.id, 1), // water × 1.3
    ]);
    expect(p.waterDemandMultiplier).toBeCloseTo(1.3 * 1.3, 10);
  });
});

describe('applyTraitEffects — edge cases', () => {
  it('deactivated traits are NOT applied', () => {
    const traits: GeneticTraitState[] = [
      { traitId: RAPID_GROWTH.id, active: false, generation: 1, magnitude: 1 },
    ];
    const p = applyTraitEffects(defaultBiologyParameters(), traits);
    expect(p).toEqual(defaultBiologyParameters());
  });

  it('unknown trait ids are skipped defensively', () => {
    const p = applyTraitEffects(defaultBiologyParameters(), [
      activeTrait('trait:does-not-exist', 1),
    ]);
    expect(p).toEqual(defaultBiologyParameters());
  });

  it('an empty activeTraits array returns the input multipliers unchanged', () => {
    const base = defaultBiologyParameters();
    const p = applyTraitEffects(base, []);
    expect(p).toEqual(base);
  });

  it('does NOT mutate its input (freeze test)', () => {
    const base = Object.freeze({ ...defaultBiologyParameters() });
    expect(() =>
      applyTraitEffects(base, [activeTrait(RAPID_GROWTH.id, 1)]),
    ).not.toThrow();
  });
});
