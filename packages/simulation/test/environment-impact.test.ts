/**
 * Environmental impact routing tests (P7c — TDD §18.1, §18.4; GDD §9.1, §28;
 * resolves R-P6-4 from docs/offline-automation.md §6.4).
 *
 * Pins the centralized pure helper `applyEnvironmentalImpact`
 * (`packages/simulation/src/environment/impact.ts`) that routes an
 * `EnvironmentalImpact` payload (the six GDD §9.1 channels emitted by
 * `executeAutomation`) onto the `EnvironmentState` accumulators, pro-rated by
 * the step fraction of a sim day.
 *
 * Asserts:
 *   - Each of the six channels routes to its correct field (incl.
 *     `landDisturbance → landUse.degraded`, the R-P6-4 gap P6b2 left
 *     payload-only).
 *   - Pro-rating: a full-day step applies the full amount; a sub-day step
 *     applies the fraction.
 *   - Conservation / fixed point: a zero/neutral impact leaves the env
 *     unchanged (no environmental quantity created from nothing — TDD §18.4).
 *   - Clamping: `soil.health` / `biodiversity.index` / `landUse.degraded` stay
 *     in [0,1]; `freshwater.availability` / `soil.contamination` stay ≥ 0.
 *   - Purity: the input env is never mutated (TDD §4.1).
 */
import { describe, it, expect } from 'vitest';
import { applyEnvironmentalImpact } from '../src/index.js';
import {
  PROVISIONAL_ENV_CO2_BASELINE_PPM,
  PROVISIONAL_ENV_METHANE_BASELINE_PPM,
  PROVISIONAL_ENV_N2O_BASELINE_PPM,
  PROVISIONAL_ENV_BASELINE_TEMP_C,
  PROVISIONAL_RESOURCE_ORGANIC_MATTER_SATURATION,
} from '@capitalist-tree/shared';
import type { EnvironmentState, EnvironmentalImpact } from '@capitalist-tree/shared';

const SECONDS_PER_DAY = 24 * 60 * 60;

/** A minimal, schema-valid EnvironmentState for the routing tests. */
function baseEnv(overrides: Partial<EnvironmentState> = {}): EnvironmentState {
  const base: EnvironmentState = {
    atmosphere: {
      co2Concentration: PROVISIONAL_ENV_CO2_BASELINE_PPM,
      emissions: 0,
      sequestration: 0,
      methaneConcentration: PROVISIONAL_ENV_METHANE_BASELINE_PPM,
      nitrousOxideConcentration: PROVISIONAL_ENV_N2O_BASELINE_PPM,
      aerosols: 0,
    },
    soil: {
      health: 1,
      organicMatter: PROVISIONAL_RESOURCE_ORGANIC_MATTER_SATURATION,
      contamination: 0,
      nutrients: { nitrogen: 0, phosphorus: 0, potassium: 0 },
      soilWater: 0,
      ph: 6.5,
      compaction: 0,
      microbialActivity: 1.0,
    },
    freshwater: { availability: 100, groundwater: 50, contamination: 0 },
    biodiversity: {
      index: 0.8,
      speciesPopulations: [
        { speciesId: 'species:bird', population: 100 },
        { speciesId: 'species:insect', population: 1000 },
      ],
    },
    forestCoverage: 0.5,
    ecosystemResilience: 0.8,
    globalTemperature: PROVISIONAL_ENV_BASELINE_TEMP_C,
    climateForcing: 0,
    seaLevelRise: 0,
    energy: { stored: 0, capacity: 100, generationRate: 0, consumptionRate: 0 },
    landUse: { developed: 0, degraded: 0, protected: 0 },
  };
  return { ...base, ...overrides };
}

/** A neutral (all-zero) impact — the fixed point. */
const NO_IMPACT: EnvironmentalImpact = {
  carbonEmissions: 0,
  waterConsumption: 0,
  soilDegradation: 0,
  pollution: 0,
  landDisturbance: 0,
  biodiversityImpact: 0,
};

describe('applyEnvironmentalImpact — channel routing (R-P6-4)', () => {
  it('carbonEmissions → atmosphere.emissions (accumulate)', () => {
    const env = baseEnv();
    const impact: EnvironmentalImpact = { ...NO_IMPACT, carbonEmissions: 2.0 };
    const next = applyEnvironmentalImpact(env, impact, SECONDS_PER_DAY);
    // Full day → full amount accumulated.
    expect(next.atmosphere.emissions).toBe(2.0);
    // Other channels untouched.
    expect(next.freshwater.availability).toBe(100);
    expect(next.soil.health).toBe(1);
    expect(next.landUse.degraded).toBe(0);
  });

  it('waterConsumption → freshwater.availability (debit)', () => {
    const env = baseEnv();
    const impact: EnvironmentalImpact = { ...NO_IMPACT, waterConsumption: 30 };
    const next = applyEnvironmentalImpact(env, impact, SECONDS_PER_DAY);
    expect(next.freshwater.availability).toBe(70);
    expect(next.atmosphere.emissions).toBe(0);
  });

  it('soilDegradation → soil.health (decline, clamped [0,1])', () => {
    const env = baseEnv();
    const impact: EnvironmentalImpact = { ...NO_IMPACT, soilDegradation: 0.4 };
    const next = applyEnvironmentalImpact(env, impact, SECONDS_PER_DAY);
    expect(next.soil.health).toBeCloseTo(0.6, 10);
  });

  it('pollution → soil.contamination (accumulate, ≥ 0)', () => {
    const env = baseEnv();
    const impact: EnvironmentalImpact = { ...NO_IMPACT, pollution: 1.5 };
    const next = applyEnvironmentalImpact(env, impact, SECONDS_PER_DAY);
    expect(next.soil.contamination).toBe(1.5);
  });

  it('landDisturbance → landUse.degraded (accumulate, clamped [0,1]) — R-P6-4', () => {
    // The channel P6b2 left payload-only now has a target.
    const env = baseEnv();
    const impact: EnvironmentalImpact = { ...NO_IMPACT, landDisturbance: 0.25 };
    const next = applyEnvironmentalImpact(env, impact, SECONDS_PER_DAY);
    expect(next.landUse.degraded).toBeCloseTo(0.25, 10);
    // The other landUse fractions are untouched.
    expect(next.landUse.developed).toBe(0);
    expect(next.landUse.protected).toBe(0);
  });

  it('biodiversityImpact → biodiversity.index (decline, clamped [0,1])', () => {
    const env = baseEnv();
    const impact: EnvironmentalImpact = { ...NO_IMPACT, biodiversityImpact: 0.3 };
    const next = applyEnvironmentalImpact(env, impact, SECONDS_PER_DAY);
    expect(next.biodiversity.index).toBeCloseTo(0.5, 10); // 0.8 - 0.3
  });

  it('all six channels route together in one call', () => {
    const env = baseEnv();
    const impact: EnvironmentalImpact = {
      carbonEmissions: 1.0,
      waterConsumption: 20,
      soilDegradation: 0.1,
      pollution: 0.5,
      landDisturbance: 0.05,
      biodiversityImpact: 0.1,
    };
    const next = applyEnvironmentalImpact(env, impact, SECONDS_PER_DAY);
    expect(next.atmosphere.emissions).toBe(1.0);
    expect(next.freshwater.availability).toBe(80);
    expect(next.soil.health).toBeCloseTo(0.9, 10);
    expect(next.soil.contamination).toBe(0.5);
    expect(next.landUse.degraded).toBeCloseTo(0.05, 10);
    expect(next.biodiversity.index).toBeCloseTo(0.7, 10); // 0.8 - 0.1
  });
});

describe('applyEnvironmentalImpact — pro-rating', () => {
  it('a full-day step applies the full amount', () => {
    const env = baseEnv();
    const impact: EnvironmentalImpact = { ...NO_IMPACT, carbonEmissions: 5.0 };
    const next = applyEnvironmentalImpact(env, impact, SECONDS_PER_DAY);
    expect(next.atmosphere.emissions).toBe(5.0);
  });

  it('a sub-day step applies the fraction (60s of a 86400s day)', () => {
    const env = baseEnv();
    const impact: EnvironmentalImpact = { ...NO_IMPACT, carbonEmissions: 5.0 };
    const stepSeconds = 60;
    const fraction = stepSeconds / SECONDS_PER_DAY;
    const next = applyEnvironmentalImpact(env, impact, stepSeconds);
    expect(next.atmosphere.emissions).toBeCloseTo(5.0 * fraction, 10);
  });

  it('landDisturbance is pro-rated the same fraction (R-P6-4)', () => {
    const env = baseEnv();
    const impact: EnvironmentalImpact = { ...NO_IMPACT, landDisturbance: 0.4 };
    const stepSeconds = 60;
    const fraction = stepSeconds / SECONDS_PER_DAY;
    const next = applyEnvironmentalImpact(env, impact, stepSeconds);
    expect(next.landUse.degraded).toBeCloseTo(0.4 * fraction, 10);
  });
});

describe('applyEnvironmentalImpact — conservation + clamping', () => {
  it('a zero/neutral impact is a fixed point (no quantity created from nothing)', () => {
    const env = baseEnv();
    const next = applyEnvironmentalImpact(env, NO_IMPACT, SECONDS_PER_DAY);
    // Deep-equal — nothing moved.
    expect(next).toEqual(env);
  });

  it('freshwater.availability clamps at 0 (cannot go negative)', () => {
    const env = baseEnv({ freshwater: { availability: 10, groundwater: 50, contamination: 0 } });
    const impact: EnvironmentalImpact = { ...NO_IMPACT, waterConsumption: 100 };
    const next = applyEnvironmentalImpact(env, impact, SECONDS_PER_DAY);
    expect(next.freshwater.availability).toBe(0);
  });

  it('soil.health clamps at 0 (cannot go below 0)', () => {
    const env = baseEnv({ soil: { ...baseEnv().soil, health: 0.1 } });
    const impact: EnvironmentalImpact = { ...NO_IMPACT, soilDegradation: 5.0 };
    const next = applyEnvironmentalImpact(env, impact, SECONDS_PER_DAY);
    expect(next.soil.health).toBe(0);
  });

  it('biodiversity.index clamps at 0 (cannot go below 0)', () => {
    const env = baseEnv({ biodiversity: { ...baseEnv().biodiversity, index: 0.05 } });
    const impact: EnvironmentalImpact = { ...NO_IMPACT, biodiversityImpact: 2.0 };
    const next = applyEnvironmentalImpact(env, impact, SECONDS_PER_DAY);
    expect(next.biodiversity.index).toBe(0);
  });

  it('landUse.degraded clamps at 1 (cannot exceed fully degraded)', () => {
    const env = baseEnv({ landUse: { developed: 0, degraded: 0.9, protected: 0 } });
    const impact: EnvironmentalImpact = { ...NO_IMPACT, landDisturbance: 5.0 };
    const next = applyEnvironmentalImpact(env, impact, SECONDS_PER_DAY);
    expect(next.landUse.degraded).toBe(1);
  });

  it('soil.contamination stays ≥ 0', () => {
    const env = baseEnv();
    const impact: EnvironmentalImpact = { ...NO_IMPACT, pollution: 0 };
    const next = applyEnvironmentalImpact(env, impact, SECONDS_PER_DAY);
    expect(next.soil.contamination).toBeGreaterThanOrEqual(0);
  });
});

describe('applyEnvironmentalImpact — purity', () => {
  it('never mutates the input env (TDD §4.1)', () => {
    const env = baseEnv();
    const snapshot = structuredClone(env);
    const impact: EnvironmentalImpact = {
      carbonEmissions: 1.0,
      waterConsumption: 20,
      soilDegradation: 0.1,
      pollution: 0.5,
      landDisturbance: 0.05,
      biodiversityImpact: 0.1,
    };
    applyEnvironmentalImpact(env, impact, SECONDS_PER_DAY);
    expect(env).toEqual(snapshot);
  });

  it('returns a new object (not the same reference)', () => {
    const env = baseEnv();
    const next = applyEnvironmentalImpact(env, NO_IMPACT, SECONDS_PER_DAY);
    expect(next).not.toBe(env);
    expect(next.atmosphere).not.toBe(env.atmosphere);
    expect(next.landUse).not.toBe(env.landUse);
  });
});
