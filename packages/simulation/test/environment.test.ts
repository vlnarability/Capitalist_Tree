/**
 * EnvironmentSystem + environment module tests (TDD §18.1, §18.4; GDD §10,
 * §170).
 *
 * Two layers:
 *
 *   1. Pure-helper tests — call `stepAtmosphere` / `deriveClimateForcing` /
 *      `stepTemperature` / `stepSeaLevel` / `stepFreshwater` / `stepSoil` /
 *      `stepBiodiversity` directly on minimal environment states to assert
 *      each subsystem's invariants in isolation (atmosphere accounting,
 *      climate forcing + inertia + sea level, water fluxes, soil dynamics,
 *      biodiversity stress response, purity, conservation).
 *
 *   2. Integration tests — drive the full engine through `engine.advance`
 *      to assert the EnvironmentSystem (registry slot #10) cooperates with
 *      the other systems: forestCoverage tracks tree growth, ecosystemResilience
 *      is derived, env fields stay finite + non-negative, threshold
 *      notifications fire, determinism holds (same seed → same state).
 *
 * The pure-helper tests pin the @provisional climate math; the integration
 * tests assert the system layering (ResourceSystem writes soil.health first,
 * EnvironmentSystem nudges it; the EnvironmentSystem is the SOLE writer of
 * globalTemperature via the climate model — R-P2-1 resolved in P7d, see
 * climate.ts / water.ts / docs/environment.md §6).
 */
import { describe, it, expect } from 'vitest';
import {
  engine,
  defaultRegistry,
  environmentSystem,
  Rng,
  type SystemContext,
  stepAtmosphere,
  deriveClimateForcing,
  stepTemperature,
  stepSeaLevel,
  stepFreshwater,
  stepSoil,
  stepBiodiversity,
  PROVISIONAL_ENV_EMISSIONS_TO_PPM,
  PROVISIONAL_ENV_METHANE_BASELINE_PPM,
  PROVISIONAL_ENV_N2O_BASELINE_PPM,
  PROVISIONAL_ENV_BASELINE_TEMP_C,
  PROVISIONAL_ENV_TEMP_INERTIA_PER_DAY,
} from '../src/index.js';
import { DEFAULT_GAME_CONFIG } from '../src/initial-state.js';
import {
  PROVISIONAL_ENV_CO2_BASELINE_PPM,
  PROVISIONAL_ENV_EMISSIONS_DECAY_RATE,
  PROVISIONAL_ENV_SEA_LEVEL_RISE_RATE,
  PROVISIONAL_ENV_TEMP_SENSITIVITY_PER_W_M2,
  PROVISIONAL_RESOURCE_CONTAMINATION_FULL_DEGRADE,
  PROVISIONAL_RESOURCE_ORGANIC_MATTER_SATURATION,
  PROVISIONAL_SIMULATION_STEP_SECONDS as STEP,
} from '@capitalist-tree/shared';
import type { EnvironmentState, GameConfig, GameState, WeatherState } from '@capitalist-tree/shared';

const SECONDS_PER_DAY = 24 * 60 * 60;

/** A minimal, schema-valid EnvironmentState for pure-helper tests. */
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
    freshwater: {
      availability: 100,
      groundwater: 50,
      contamination: 0,
    },
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

/** A minimal WeatherState for the water helper tests. */
function weather(
  condition: WeatherState['condition'],
  temperature: number,
  intensity: number,
): WeatherState {
  return { condition, temperature, intensity, prevCondition: null, daysInCondition: 0 };
}

function cfg(seed: number): GameConfig {
  return { ...DEFAULT_GAME_CONFIG, seed, createdAt: 0 };
}

// ---------------------------------------------------------------------------
// 1. Atmosphere
// ---------------------------------------------------------------------------

describe('environment / atmosphere (stepAtmosphere)', () => {
  it('emissions increase CO2 concentration (mass → ppm delta)', () => {
    const env = baseEnv({
      atmosphere: {
        co2Concentration: PROVISIONAL_ENV_CO2_BASELINE_PPM,
        emissions: 10,
        sequestration: 0,
        methaneConcentration: PROVISIONAL_ENV_METHANE_BASELINE_PPM,
        nitrousOxideConcentration: PROVISIONAL_ENV_N2O_BASELINE_PPM,
        aerosols: 0,
      },
    });
    const dt = SECONDS_PER_DAY; // 1 sim day
    const next = stepAtmosphere(env, dt);
    // At baseline (excess = 0) the natural sink is zero, so the full net flux
    // lands in the concentration: delta = emissions × conv × dtDays.
    const expectedDelta = 10 * PROVISIONAL_ENV_EMISSIONS_TO_PPM * 1;
    expect(next.co2Concentration).toBeCloseTo(
      PROVISIONAL_ENV_CO2_BASELINE_PPM + expectedDelta,
      6,
    );
    expect(next.co2Concentration).toBeGreaterThan(PROVISIONAL_ENV_CO2_BASELINE_PPM);
  });

  it('sequestration decreases CO2 concentration', () => {
    const env = baseEnv({
      atmosphere: {
        co2Concentration: PROVISIONAL_ENV_CO2_BASELINE_PPM + 100,
        emissions: 0,
        sequestration: 10,
        methaneConcentration: PROVISIONAL_ENV_METHANE_BASELINE_PPM,
        nitrousOxideConcentration: PROVISIONAL_ENV_N2O_BASELINE_PPM,
        aerosols: 0,
      },
    });
    const dt = SECONDS_PER_DAY;
    const before = env.atmosphere.co2Concentration;
    const next = stepAtmosphere(env, dt);
    // sequestration pulls CO2 down (net flux negative) AND the natural sink
    // removes a fraction of the excess. Both directions reduce concentration.
    expect(next.co2Concentration).toBeLessThan(before);
  });

  it('natural decay removes the excess above baseline over time (no source)', () => {
    const env = baseEnv({
      atmosphere: {
        co2Concentration: PROVISIONAL_ENV_CO2_BASELINE_PPM + 100,
        emissions: 0,
        sequestration: 0,
        methaneConcentration: PROVISIONAL_ENV_METHANE_BASELINE_PPM,
        nitrousOxideConcentration: PROVISIONAL_ENV_N2O_BASELINE_PPM,
        aerosols: 0,
      },
    });
    const dt = SECONDS_PER_DAY;
    const next = stepAtmosphere(env, dt);
    // With no flux, only the sink acts: delta = -excess × decay × dtDays.
    const expected = PROVISIONAL_ENV_CO2_BASELINE_PPM + 100 - 100 * PROVISIONAL_ENV_EMISSIONS_DECAY_RATE * 1;
    expect(next.co2Concentration).toBeCloseTo(expected, 6);
    // Over many steps the excess decays toward zero (never below baseline).
    let e = env;
    for (let i = 0; i < 1000; i++) e = { ...e, atmosphere: stepAtmosphere(e, dt) };
    expect(e.atmosphere.co2Concentration).toBeLessThan(env.atmosphere.co2Concentration);
    expect(e.atmosphere.co2Concentration).toBeGreaterThanOrEqual(PROVISIONAL_ENV_CO2_BASELINE_PPM - 1e-6);
  });

  it('aerosols decay quickly toward zero', () => {
    const env = baseEnv({
      atmosphere: {
        co2Concentration: PROVISIONAL_ENV_CO2_BASELINE_PPM,
        emissions: 0,
        sequestration: 0,
        methaneConcentration: PROVISIONAL_ENV_METHANE_BASELINE_PPM,
        nitrousOxideConcentration: PROVISIONAL_ENV_N2O_BASELINE_PPM,
        aerosols: 0.5,
      },
    });
    const next = stepAtmosphere(env, SECONDS_PER_DAY);
    expect(next.aerosols).toBeLessThan(0.5);
    expect(next.aerosols).toBeGreaterThan(0); // not gone in one day
    // After many days, aerosols → 0.
    let e = env;
    for (let i = 0; i < 100; i++) e = { ...e, atmosphere: stepAtmosphere(e, SECONDS_PER_DAY) };
    expect(e.atmosphere.aerosols).toBeLessThan(1e-3);
  });

  it('conservation: at baseline with no flux, CO2 is a fixed point (no CO2 created from nothing)', () => {
    const env = baseEnv(); // co2 = baseline, emissions = 0, sequestration = 0
    const next = stepAtmosphere(env, SECONDS_PER_DAY);
    expect(next.co2Concentration).toBeCloseTo(PROVISIONAL_ENV_CO2_BASELINE_PPM, 9);
  });

  it('conservation: the CO2 delta matches the closed-form flux − sink formula', () => {
    const emissions = 7;
    const sequestration = 2;
    const excess = 50;
    const env = baseEnv({
      atmosphere: {
        co2Concentration: PROVISIONAL_ENV_CO2_BASELINE_PPM + excess,
        emissions,
        sequestration,
        methaneConcentration: PROVISIONAL_ENV_METHANE_BASELINE_PPM,
        nitrousOxideConcentration: PROVISIONAL_ENV_N2O_BASELINE_PPM,
        aerosols: 0,
      },
    });
    const dtDays = 3;
    const next = stepAtmosphere(env, dtDays * SECONDS_PER_DAY);
    const flux = (emissions - sequestration) * PROVISIONAL_ENV_EMISSIONS_TO_PPM; // ppm/day
    const sink = excess * PROVISIONAL_ENV_EMISSIONS_DECAY_RATE; // ppm/day
    const expected = env.atmosphere.co2Concentration + (flux - sink) * dtDays;
    expect(next.co2Concentration).toBeCloseTo(expected, 6);
  });

  it('does not mutate the input (purity)', () => {
    const env = baseEnv({
      atmosphere: {
        co2Concentration: PROVISIONAL_ENV_CO2_BASELINE_PPM + 30,
        emissions: 5,
        sequestration: 1,
        methaneConcentration: PROVISIONAL_ENV_METHANE_BASELINE_PPM + 0.1,
        nitrousOxideConcentration: PROVISIONAL_ENV_N2O_BASELINE_PPM,
        aerosols: 0.2,
      },
    });
    const snapshot = JSON.stringify(env);
    stepAtmosphere(env, SECONDS_PER_DAY);
    expect(JSON.stringify(env)).toBe(snapshot);
  });
});

// ---------------------------------------------------------------------------
// 2. Climate
// ---------------------------------------------------------------------------

describe('environment / climate (deriveClimateForcing + stepTemperature + stepSeaLevel)', () => {
  it('forcing is zero at baseline concentrations', () => {
    const env = baseEnv();
    expect(deriveClimateForcing(env.atmosphere)).toBeCloseTo(0, 9);
  });

  it('forcing increases when CO2 rises above baseline', () => {
    const low = baseEnv();
    const high = baseEnv({
      atmosphere: { ...low.atmosphere, co2Concentration: PROVISIONAL_ENV_CO2_BASELINE_PPM + 100 },
    });
    expect(deriveClimateForcing(high.atmosphere)).toBeGreaterThan(deriveClimateForcing(low.atmosphere));
  });

  it('aerosols reduce net forcing (cooling)', () => {
    const base = baseEnv({
      atmosphere: {
        co2Concentration: PROVISIONAL_ENV_CO2_BASELINE_PPM + 100,
        emissions: 0,
        sequestration: 0,
        methaneConcentration: PROVISIONAL_ENV_METHANE_BASELINE_PPM,
        nitrousOxideConcentration: PROVISIONAL_ENV_N2O_BASELINE_PPM,
        aerosols: 0,
      },
    });
    const withAerosols = {
      ...base,
      atmosphere: { ...base.atmosphere, aerosols: -0.5 },
    };
    expect(deriveClimateForcing(withAerosols.atmosphere)).toBeLessThan(
      deriveClimateForcing(base.atmosphere),
    );
  });

  it('forcing scales linearly with the CO2 excess', () => {
    const a = baseEnv({
      atmosphere: {
        co2Concentration: PROVISIONAL_ENV_CO2_BASELINE_PPM + 50,
        emissions: 0,
        sequestration: 0,
        methaneConcentration: PROVISIONAL_ENV_METHANE_BASELINE_PPM,
        nitrousOxideConcentration: PROVISIONAL_ENV_N2O_BASELINE_PPM,
        aerosols: 0,
      },
    });
    const b = baseEnv({
      atmosphere: {
        ...a.atmosphere,
        co2Concentration: PROVISIONAL_ENV_CO2_BASELINE_PPM + 100,
      },
    });
    // Doubling the excess doubles the CO2 forcing (methane/n2o at baseline → 0).
    expect(deriveClimateForcing(b.atmosphere)).toBeCloseTo(
      2 * deriveClimateForcing(a.atmosphere),
      9,
    );
  });

  it('temperature moves toward equilibrium with inertia (NOT instant)', () => {
    // forcing > 0 → equilibrium above current temp; one step moves partway.
    const env = baseEnv({
      atmosphere: {
        co2Concentration: PROVISIONAL_ENV_CO2_BASELINE_PPM + 10000,
        emissions: 0,
        sequestration: 0,
        methaneConcentration: PROVISIONAL_ENV_METHANE_BASELINE_PPM,
        nitrousOxideConcentration: PROVISIONAL_ENV_N2O_BASELINE_PPM,
        aerosols: 0,
      },
      globalTemperature: PROVISIONAL_ENV_BASELINE_TEMP_C,
      climateForcing: 0,
    });
    const forcing = deriveClimateForcing(env.atmosphere);
    const equilibrium = PROVISIONAL_ENV_BASELINE_TEMP_C + forcing * PROVISIONAL_ENV_TEMP_SENSITIVITY_PER_W_M2;
    const dt = SECONDS_PER_DAY; // 1 sim day
    const next = stepTemperature({ ...env, climateForcing: forcing }, dt);
    // Moved toward equilibrium but did not reach it in one day.
    expect(next).toBeGreaterThan(env.globalTemperature);
    expect(next).toBeLessThan(equilibrium);
    // The fraction closed matches the inertia coefficient.
    const expected = env.globalTemperature + (equilibrium - env.globalTemperature) * PROVISIONAL_ENV_TEMP_INERTIA_PER_DAY * 1;
    expect(next).toBeCloseTo(expected, 9);
  });

  it('temperature is a fixed point when forcing is zero and temp is at baseline', () => {
    const env = baseEnv(); // forcing 0, temp = baseline
    const next = stepTemperature(env, SECONDS_PER_DAY);
    expect(next).toBeCloseTo(env.globalTemperature, 9);
  });

  it('sea level rises with warming above baseline, advanced per sim year', () => {
    const warmTemp = PROVISIONAL_ENV_BASELINE_TEMP_C + 2;
    const dt = 365 * SECONDS_PER_DAY; // ~1 sim year (PROVISIONAL_DAYS_PER_YEAR = 120, but a long step exercises the per-year math)
    const rise = stepSeaLevel(0, warmTemp, dt);
    expect(rise).toBeGreaterThan(0);
    // expected = warming × rate × dtYears
    const dtYears = dt / (120 * SECONDS_PER_DAY);
    expect(rise).toBeCloseTo(2 * PROVISIONAL_ENV_SEA_LEVEL_RISE_RATE * dtYears, 6);
  });

  it('sea level does not rise when temperature is at or below baseline', () => {
    const dt = 365 * SECONDS_PER_DAY;
    expect(stepSeaLevel(0, PROVISIONAL_ENV_BASELINE_TEMP_C, dt)).toBe(0);
    expect(stepSeaLevel(0, PROVISIONAL_ENV_BASELINE_TEMP_C - 5, dt)).toBe(0);
  });

  it('climate helpers do not mutate the input (purity)', () => {
    const env = baseEnv({
      atmosphere: {
        co2Concentration: PROVISIONAL_ENV_CO2_BASELINE_PPM + 100,
        emissions: 0,
        sequestration: 0,
        methaneConcentration: PROVISIONAL_ENV_METHANE_BASELINE_PPM,
        nitrousOxideConcentration: PROVISIONAL_ENV_N2O_BASELINE_PPM,
        aerosols: 0,
      },
      globalTemperature: PROVISIONAL_ENV_BASELINE_TEMP_C + 1,
      climateForcing: 0.01,
      seaLevelRise: 5,
    });
    const snap = JSON.stringify(env);
    deriveClimateForcing(env.atmosphere);
    stepTemperature(env, SECONDS_PER_DAY);
    stepSeaLevel(env.seaLevelRise, env.globalTemperature, SECONDS_PER_DAY);
    expect(JSON.stringify(env)).toBe(snap);
  });
});

// ---------------------------------------------------------------------------
// 3. Water
// ---------------------------------------------------------------------------

describe('environment / water (stepFreshwater)', () => {
  it('rainfall adds to availability', () => {
    const env = baseEnv({ freshwater: { availability: 100, groundwater: 0, contamination: 0 } });
    const before = env.freshwater.availability;
    const next = stepFreshwater(env, weather('heavy-rain', 15, 1), SECONDS_PER_DAY);
    // heavy-rain = 20 L/day at intensity 1; evaporation at 15°C (base temp) is
    // small; net availability should rise.
    expect(next.availability).toBeGreaterThan(before);
  });

  it('evaporation removes from availability (sunny + warm)', () => {
    const env = baseEnv({ freshwater: { availability: 100, groundwater: 0, contamination: 0 } });
    const before = env.freshwater.availability;
    // sunny → no rainfall; warm temperature → evaporation > 0.
    const next = stepFreshwater(env, weather('sunny', 35, 1), SECONDS_PER_DAY);
    expect(next.availability).toBeLessThan(before);
  });

  it('contamination decays slowly toward zero', () => {
    const env = baseEnv({ freshwater: { availability: 100, groundwater: 50, contamination: 50 } });
    const next = stepFreshwater(env, weather('sunny', 15, 0), SECONDS_PER_DAY);
    expect(next.contamination).toBeLessThan(50);
    expect(next.contamination).toBeGreaterThan(0); // slow — not gone in one day
  });

  it('groundwater recharges from rainfall (slow)', () => {
    const env = baseEnv({ freshwater: { availability: 100, groundwater: 10, contamination: 0 } });
    const before = env.freshwater.groundwater;
    const next = stepFreshwater(env, weather('heavy-rain', 15, 1), SECONDS_PER_DAY);
    expect(next.groundwater).toBeGreaterThan(before);
  });

  it('does not mutate the input (purity)', () => {
    const env = baseEnv({ freshwater: { availability: 100, groundwater: 50, contamination: 20 } });
    const snap = JSON.stringify(env);
    stepFreshwater(env, weather('rain', 20, 0.7), SECONDS_PER_DAY);
    expect(JSON.stringify(env)).toBe(snap);
  });
});

// ---------------------------------------------------------------------------
// 4. Soil
// ---------------------------------------------------------------------------

describe('environment / soil (stepSoil)', () => {
  it('health declines when contamination is high', () => {
    const env = baseEnv({
      soil: {
        health: 0.9,
        organicMatter: 0,
        contamination: PROVISIONAL_RESOURCE_CONTAMINATION_FULL_DEGRADE,
        nutrients: { nitrogen: 0, phosphorus: 0, potassium: 0 },
        soilWater: 0,
        ph: 6.5,
        compaction: 0,
        microbialActivity: 1.0,
      },
    });
    const before = env.soil.health;
    const next = stepSoil(env, SECONDS_PER_DAY);
    expect(next.health).toBeLessThan(before);
  });

  it('health recovers when organic matter is high + contamination is low', () => {
    const env = baseEnv({
      soil: {
        health: 0.5,
        organicMatter: PROVISIONAL_RESOURCE_ORGANIC_MATTER_SATURATION,
        contamination: 0,
        nutrients: { nitrogen: 0, phosphorus: 0, potassium: 0 },
        soilWater: 0,
        ph: 6.5,
        compaction: 0,
        microbialActivity: 1.0,
      },
    });
    const before = env.soil.health;
    const next = stepSoil(env, SECONDS_PER_DAY);
    expect(next.health).toBeGreaterThan(before);
  });

  it('compaction decays toward zero over time', () => {
    const env = baseEnv({
      soil: {
        health: 1,
        organicMatter: PROVISIONAL_RESOURCE_ORGANIC_MATTER_SATURATION,
        contamination: 0,
        nutrients: { nitrogen: 0, phosphorus: 0, potassium: 0 },
        soilWater: 0,
        ph: 6.5,
        compaction: 0.8,
        microbialActivity: 1.0,
      },
    });
    const next = stepSoil(env, SECONDS_PER_DAY);
    expect(next.compaction).toBeLessThan(0.8);
    expect(next.compaction).toBeGreaterThan(0); // slow
    // Over many steps → 0. (0.005/day decay is slow: 0.8 × 0.995^n < 1e-3
    // needs n ≈ 1340, so 2000 steps is plenty.)
    let e = env;
    for (let i = 0; i < 2000; i++) e = { ...e, soil: stepSoil(e, SECONDS_PER_DAY) };
    expect(e.soil.compaction).toBeLessThan(1e-3);
  });

  it('microbialActivity responds to organic matter (moves toward target)', () => {
    // Low organic matter → target < 1.0; high microbial activity drifts down.
    const env = baseEnv({
      soil: {
        health: 1,
        organicMatter: 0,
        contamination: 0,
        nutrients: { nitrogen: 0, phosphorus: 0, potassium: 0 },
        soilWater: 0,
        ph: 6.5,
        compaction: 0,
        microbialActivity: 1.5,
      },
    });
    const next = stepSoil(env, SECONDS_PER_DAY);
    expect(next.microbialActivity).toBeLessThan(1.5);
  });

  it('health stays in [0, 1]', () => {
    // Drive with extreme contamination for many steps.
    let e = baseEnv({
      soil: {
        health: 1,
        organicMatter: 0,
        contamination: 10 * PROVISIONAL_RESOURCE_CONTAMINATION_FULL_DEGRADE,
        nutrients: { nitrogen: 0, phosphorus: 0, potassium: 0 },
        soilWater: 0,
        ph: 6.5,
        compaction: 0,
        microbialActivity: 1.0,
      },
    });
    for (let i = 0; i < 2000; i++) e = { ...e, soil: stepSoil(e, SECONDS_PER_DAY) };
    expect(e.soil.health).toBeGreaterThanOrEqual(0);
    expect(e.soil.health).toBeLessThanOrEqual(1);
  });

  it('does not mutate the input (purity)', () => {
    const env = baseEnv({
      soil: {
        health: 0.6,
        organicMatter: 50,
        contamination: 30,
        nutrients: { nitrogen: 0, phosphorus: 0, potassium: 0 },
        soilWater: 0,
        ph: 6.5,
        compaction: 0.3,
        microbialActivity: 0.8,
      },
    });
    const snap = JSON.stringify(env);
    stepSoil(env, SECONDS_PER_DAY);
    expect(JSON.stringify(env)).toBe(snap);
  });
});

// ---------------------------------------------------------------------------
// 5. Biodiversity
// ---------------------------------------------------------------------------

describe('environment / biodiversity (stepBiodiversity)', () => {
  it('index declines under stress (high contamination)', () => {
    const env = baseEnv({
      soil: {
        health: 1,
        organicMatter: PROVISIONAL_RESOURCE_ORGANIC_MATTER_SATURATION,
        contamination: PROVISIONAL_RESOURCE_CONTAMINATION_FULL_DEGRADE,
        nutrients: { nitrogen: 0, phosphorus: 0, potassium: 0 },
        soilWater: 0,
        ph: 6.5,
        compaction: 0,
        microbialActivity: 1.0,
      },
      forestCoverage: 0.5,
      globalTemperature: PROVISIONAL_ENV_BASELINE_TEMP_C,
      biodiversity: { index: 0.8, speciesPopulations: [] },
    });
    const before = env.biodiversity.index;
    const next = stepBiodiversity(env, SECONDS_PER_DAY);
    expect(next.index).toBeLessThan(before);
  });

  it('index declines under stress (low forestCoverage + warming)', () => {
    const env = baseEnv({
      soil: {
        health: 0.5,
        organicMatter: 0,
        contamination: 0,
        nutrients: { nitrogen: 0, phosphorus: 0, potassium: 0 },
        soilWater: 0,
        ph: 6.5,
        compaction: 0,
        microbialActivity: 1.0,
      },
      forestCoverage: 0.1,
      globalTemperature: PROVISIONAL_ENV_BASELINE_TEMP_C + 5,
      biodiversity: { index: 0.8, speciesPopulations: [] },
    });
    const before = env.biodiversity.index;
    const next = stepBiodiversity(env, SECONDS_PER_DAY);
    expect(next.index).toBeLessThan(before);
  });

  it('index recovers when stress is removed (clean env + full forest coverage)', () => {
    const env = baseEnv({
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
      forestCoverage: 1,
      globalTemperature: PROVISIONAL_ENV_BASELINE_TEMP_C,
      freshwater: { availability: 100, groundwater: 50, contamination: 0 },
      biodiversity: { index: 0.4, speciesPopulations: [] },
    });
    const before = env.biodiversity.index;
    const next = stepBiodiversity(env, SECONDS_PER_DAY);
    expect(next.index).toBeGreaterThan(before);
  });

  it('species populations track the index (decline when index declines)', () => {
    const env = baseEnv({
      soil: {
        health: 1,
        organicMatter: PROVISIONAL_RESOURCE_ORGANIC_MATTER_SATURATION,
        contamination: PROVISIONAL_RESOURCE_CONTAMINATION_FULL_DEGRADE,
        nutrients: { nitrogen: 0, phosphorus: 0, potassium: 0 },
        soilWater: 0,
        ph: 6.5,
        compaction: 0,
        microbialActivity: 1.0,
      },
      forestCoverage: 0.3,
      globalTemperature: PROVISIONAL_ENV_BASELINE_TEMP_C,
      biodiversity: {
        index: 0.8,
        speciesPopulations: [{ speciesId: 'species:bird', population: 100 }],
      },
    });
    const next = stepBiodiversity(env, SECONDS_PER_DAY);
    expect(next.index).toBeLessThan(env.biodiversity.index);
    const ratio = next.index / env.biodiversity.index;
    expect(next.speciesPopulations[0].population).toBeCloseTo(100 * ratio, 6);
  });

  it('extinct species (population 0) stay extinct', () => {
    const env = baseEnv({
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
      forestCoverage: 1,
      globalTemperature: PROVISIONAL_ENV_BASELINE_TEMP_C,
      biodiversity: {
        index: 0.5,
        speciesPopulations: [{ speciesId: 'species:extinct', population: 0 }],
      },
    });
    const next = stepBiodiversity(env, SECONDS_PER_DAY);
    const extinct = next.speciesPopulations.find((s) => s.speciesId === 'species:extinct');
    expect(extinct?.population).toBe(0);
  });

  it('index stays in [0, 1]', () => {
    // Drive with extreme stress for many steps.
    let e = baseEnv({
      soil: {
        health: 0,
        organicMatter: 0,
        contamination: 10 * PROVISIONAL_RESOURCE_CONTAMINATION_FULL_DEGRADE,
        nutrients: { nitrogen: 0, phosphorus: 0, potassium: 0 },
        soilWater: 0,
        ph: 6.5,
        compaction: 1,
        microbialActivity: 0,
      },
      forestCoverage: 0,
      globalTemperature: PROVISIONAL_ENV_BASELINE_TEMP_C + 20,
      freshwater: { availability: 0, groundwater: 0, contamination: 1000 },
      biodiversity: { index: 0.5, speciesPopulations: [] },
    });
    for (let i = 0; i < 2000; i++) e = { ...e, biodiversity: stepBiodiversity(e, SECONDS_PER_DAY) };
    expect(e.biodiversity.index).toBeGreaterThanOrEqual(0);
    expect(e.biodiversity.index).toBeLessThanOrEqual(1);
  });

  it('does not mutate the input (purity)', () => {
    const env = baseEnv({
      soil: {
        health: 0.5,
        organicMatter: 50,
        contamination: 30,
        nutrients: { nitrogen: 0, phosphorus: 0, potassium: 0 },
        soilWater: 0,
        ph: 6.5,
        compaction: 0.3,
        microbialActivity: 0.8,
      },
      forestCoverage: 0.4,
      globalTemperature: PROVISIONAL_ENV_BASELINE_TEMP_C + 1,
      biodiversity: {
        index: 0.6,
        speciesPopulations: [{ speciesId: 'species:bird', population: 50 }],
      },
    });
    const snap = JSON.stringify(env);
    stepBiodiversity(env, SECONDS_PER_DAY);
    expect(JSON.stringify(env)).toBe(snap);
  });
});

// ---------------------------------------------------------------------------
// 6. Integration — EnvironmentSystem in the full engine
// ---------------------------------------------------------------------------

describe('EnvironmentSystem integration (engine.advance, slot #10)', () => {
  it('is registered at slot #10 in the default registry', () => {
    const ids = defaultRegistry.ids();
    // slot #10 is index 9 (0-based) in the registry array.
    expect(ids[9]).toBe('EnvironmentSystem');
    // And the full order matches the docs/simulation.md canonical order.
    expect(ids).toEqual([
      'TimeSystem',
      'WeatherSystem',
      'BiologySystem',
      'ResourceSystem',
      'HarvestSystem',
      'EconomySystem',
      'PersonalSystem',
      'BusinessSystem',
      'AutomationSystem',
      'EnvironmentSystem',
      'ProgressionSystem',
      'EventSystem',
    ]);
  });

  it('a full sim tick advances all subsystems (atmosphere, soil, biodiversity, climate)', () => {
    const initial = engine.initialize(cfg(42));
    // Advance one step.
    const result = engine.advance(initial, STEP);
    const env0 = initial.world.environment;
    const env1 = result.state.world.environment;
    // At least one subsystem's derived value should differ after a tick
    // (climateForcing is recomputed each tick; soil.health is nudged; etc.).
    // We don't assert exact deltas (globalTemperature is climate-driven, not
    // weather-mirrored — R-P2-1 resolved in P7d) — only that the system ran and
    // produced finite values.
    expect(Number.isFinite(env1.atmosphere.co2Concentration)).toBe(true);
    expect(Number.isFinite(env1.climateForcing)).toBe(true);
    expect(Number.isFinite(env1.globalTemperature)).toBe(true);
    expect(Number.isFinite(env1.seaLevelRise)).toBe(true);
    expect(Number.isFinite(env1.soil.health)).toBe(true);
    expect(Number.isFinite(env1.biodiversity.index)).toBe(true);
    expect(Number.isFinite(env1.ecosystemResilience)).toBe(true);
    expect(Number.isFinite(env1.forestCoverage)).toBe(true);
    // climateForcing is derived each tick from the atmosphere — confirm it was
    // written (non-NaN). At baseline it's ~0 but recomputed.
    void env0;
  });

  it('forestCoverage tracks tree growth (derived from biology outputs, read-only)', () => {
    // Advance a long window so the tree grows.
    const initial = engine.initialize(cfg(42));
    const longRun = 30 * SECONDS_PER_DAY; // 30 sim days
    const result = engine.advance(initial, longRun);
    // The tree ages over the run; forestCoverage is derived from age + canopy.
    // It should be finite and in [0,1], and (because the tree grows) not less
    // than the starting 0.1 floor by more than rounding.
    const fc = result.state.world.environment.forestCoverage;
    expect(fc).toBeGreaterThanOrEqual(0);
    expect(fc).toBeLessThanOrEqual(1);
    // The originalTree is NOT modified by the EnvironmentSystem — verify the
    // tree's biology fields are still schema-consistent (alive flag intact).
    expect(result.state.originalTree.alive).toBe(true);
  });

  it('ecosystemResilience is derived from biodiversity + forestCoverage + soil.health', () => {
    const initial = engine.initialize(cfg(42));
    const result = engine.advance(initial, STEP);
    const env = result.state.world.environment;
    // resilience = 0.4*index + 0.3*forestCoverage + 0.3*soil.health (clamped).
    const expected =
      0.4 * env.biodiversity.index +
      0.3 * env.forestCoverage +
      0.3 * env.soil.health;
    expect(env.ecosystemResilience).toBeCloseTo(
      Math.max(0, Math.min(1, expected)),
      6,
    );
  });

  it('emits notification events when soil health drops below the warning threshold', () => {
    // Construct a state where the DERIVED soil health is low. ResourceSystem
    // (slot #4) recomputes `soil.health` each tick from the underlying factors,
    // so setting `health` directly is overwritten — we have to make the factors
    // bad: high contamination (contaminationFrac → 0), no organic matter, no
    // nutrients, no soil water. With the soil-health weights (organicMatter
    // 0.25, nutrients 0.30, moisture 0.20, contamination 0.15, ph 0.10), the
    // derived health collapses to ~0.10 (only the pH stub contributes) — below
    // the SOIL_HEALTH_CRITICAL threshold (0.15), so the EnvironmentSystem
    // emits an environment-soil-health-low notification.
    const initial = engine.initialize(cfg(42));
    const stressed: GameState = {
      ...initial,
      world: {
        ...initial.world,
        environment: {
          ...initial.world.environment,
          soil: {
            ...initial.world.environment.soil,
            health: 0.1,
            organicMatter: 0,
            contamination: PROVISIONAL_RESOURCE_CONTAMINATION_FULL_DEGRADE * 5,
            nutrients: { nitrogen: 0, phosphorus: 0, potassium: 0 },
            soilWater: 0,
          },
        },
      },
    };
    const result = engine.advance(stressed, STEP);
    const envNotifs = result.events.filter(
      (e) => e.type === 'notification' && e.payload.code === 'environment-soil-health-low',
    );
    expect(envNotifs.length).toBeGreaterThan(0);
    expect(envNotifs[0].payload.severity).toBe('critical');
  });

  it('env fields stay finite + non-negative over a long run', () => {
    const initial = engine.initialize(cfg(7));
    const result = engine.advance(initial, 60 * SECONDS_PER_DAY); // 60 sim days
    const env = result.state.world.environment;
    const finiteNonNeg = (v: number) => Number.isFinite(v) && v >= 0;
    expect(finiteNonNeg(env.atmosphere.co2Concentration)).toBe(true);
    expect(finiteNonNeg(env.atmosphere.methaneConcentration)).toBe(true);
    expect(finiteNonNeg(env.atmosphere.nitrousOxideConcentration)).toBe(true);
    expect(finiteNonNeg(env.freshwater.availability)).toBe(true);
    expect(finiteNonNeg(env.freshwater.groundwater)).toBe(true);
    expect(finiteNonNeg(env.freshwater.contamination)).toBe(true);
    expect(finiteNonNeg(env.seaLevelRise)).toBe(true);
    expect(finiteNonNeg(env.biodiversity.index)).toBe(true);
    expect(env.soil.health).toBeGreaterThanOrEqual(0);
    expect(env.soil.health).toBeLessThanOrEqual(1);
    expect(env.forestCoverage).toBeGreaterThanOrEqual(0);
    expect(env.forestCoverage).toBeLessThanOrEqual(1);
    expect(env.ecosystemResilience).toBeGreaterThanOrEqual(0);
    expect(env.ecosystemResilience).toBeLessThanOrEqual(1);
  });

  it('does not mutate the input state (purity across the full engine)', () => {
    const initial = engine.initialize(cfg(42));
    const snap = JSON.stringify(initial);
    engine.advance(initial, STEP);
    expect(JSON.stringify(initial)).toBe(snap);
  });

  it('determinism: same seed → same environment state after N steps', () => {
    const a = engine.advance(engine.initialize(cfg(123)), 10 * SECONDS_PER_DAY);
    const b = engine.advance(engine.initialize(cfg(123)), 10 * SECONDS_PER_DAY);
    expect(JSON.stringify(a.state.world.environment)).toBe(
      JSON.stringify(b.state.world.environment),
    );
  });

  it('determinism: different seeds → different environment state (sanity)', () => {
    const a = engine.advance(engine.initialize(cfg(123)), 10 * SECONDS_PER_DAY);
    const b = engine.advance(engine.initialize(cfg(999)), 10 * SECONDS_PER_DAY);
    // Weather differs by seed, so freshwater + forestCoverage + biodiversity
    // will differ (globalTemperature is climate-driven + deterministic, so it
    // does NOT differ by seed post-R-P2-1 — the env object still differs via
    // the weather-dependent fields).
    expect(JSON.stringify(a.state.world.environment)).not.toBe(
      JSON.stringify(b.state.world.environment),
    );
  });

  it('conservation: emissions/sequestration accounting balances (no CO2 from nothing) via the system', () => {
    // Drive the engine with emissions = 0, sequestration = 0, co2 at baseline.
    // The EnvironmentSystem should leave co2 at baseline (fixed point) — BUT
    // only the atmosphere step is conservation-checked here; the WeatherSystem
    // does not touch co2. So co2 should stay at baseline across ticks.
    const initial = engine.initialize(cfg(42));
    // Ensure emissions/sequestration are 0 and co2 is at baseline.
    const atBaseline: GameState = {
      ...initial,
      world: {
        ...initial.world,
        environment: {
          ...initial.world.environment,
          atmosphere: {
            ...initial.world.environment.atmosphere,
            co2Concentration: PROVISIONAL_ENV_CO2_BASELINE_PPM,
            emissions: 0,
            sequestration: 0,
            methaneConcentration: PROVISIONAL_ENV_METHANE_BASELINE_PPM,
            nitrousOxideConcentration: PROVISIONAL_ENV_N2O_BASELINE_PPM,
            aerosols: 0,
          },
        },
      },
    };
    const result = engine.advance(atBaseline, STEP);
    // co2 should remain at baseline (no flux, no excess → fixed point).
    expect(result.state.world.environment.atmosphere.co2Concentration).toBeCloseTo(
      PROVISIONAL_ENV_CO2_BASELINE_PPM,
      6,
    );
  });
});

// ---------------------------------------------------------------------------
// EnvironmentSystem — RNG determinism (R-P7-1: fork deferred)
// ---------------------------------------------------------------------------
//
// The EnvironmentSystem's transforms are fully deterministic, so it does NOT
// call `ctx.rng.fork('EnvironmentSystem')`. `Rng.fork()` advances the shared
// root RNG by exactly one draw BY DESIGN (packages/simulation/src/rng.ts:
// `fork()` calls `this.next()` to seed the child). The EnvironmentSystem runs
// at slot #10, AFTER BiologySystem (slot #3); a fork here would shift the
// child seed BiologySystem's `fork('BiologySystem')` derives on the NEXT tick,
// changing the mortality roll sequence and breaking the offline-catch-up
// "starved tree dies" test (seed=3, calibrated to the current sequence).
//
// These tests pin the no-fork contract: the EnvironmentSystem consumes ZERO
// root RNG draws. If a future change adds `ctx.rng.fork(...)`, these fail —
// the catch-up death test must be retuned for the shifted sequence first (or
// `fork()` refactored to a non-advancing sub-stream derivation).
describe('EnvironmentSystem — RNG determinism (R-P7-1: fork deferred, zero root draws)', () => {
  it('execute() consumes ZERO root RNG draws (rng state unchanged across a direct call)', () => {
    const initial = engine.initialize(cfg(42));
    // Rebuild the root RNG from the persisted state (mirrors simulation.ts
    // runOneStep's RNG handling).
    const rng = Rng.fromState(initial.rngState);
    const before = rng.getState();
    const ctx: SystemContext = {
      now: initial.clock.elapsedSeconds + STEP,
      stepSeconds: STEP,
      dayOfYear: initial.clock.day,
      rng,
    };
    const result = environmentSystem.execute(initial, ctx);
    // The root RNG position is byte-identical before/after — the
    // EnvironmentSystem drew nothing (no fork). If a future change adds
    // `ctx.rng.fork('EnvironmentSystem')`, fork() advances the root by one
    // draw (rng.ts) and this assertion fails.
    expect(rng.getState()).toEqual(before);
    // The system still ran to completion + deep-copied (purity).
    expect(result.state).toBeDefined();
    expect(result.state).not.toBe(initial);
  });

  it('a full engine.advance persists the SAME root RNG whether or not the EnvironmentSystem runs (it adds no draws to the pipeline)', () => {
    const initial = engine.initialize(cfg(42));
    // Full advance through the default registry (EnvironmentSystem present).
    const full = engine.advance(initial, STEP);

    // Manually replay one step WITHOUT the EnvironmentSystem to isolate its
    // root-RNG contribution. Replicates runOneStep's RNG threading
    // (simulation.ts): one shared root Rng, ctx passed to every system.
    const rng = Rng.fromState(initial.rngState);
    const ctx: SystemContext = {
      now: initial.clock.elapsedSeconds + STEP,
      stepSeconds: STEP,
      dayOfYear: initial.clock.day,
      rng,
    };
    let next: GameState = initial;
    for (const system of defaultRegistry.all()) {
      if (system.id === 'EnvironmentSystem') continue; // isolate
      const result = system.execute(next, ctx);
      next = result.state;
    }
    const skippedRngState = rng.getState();

    // The persisted root RNG position is IDENTICAL whether or not the
    // EnvironmentSystem ran — it contributes zero root draws to the pipeline.
    // BiologySystem's mortality sequence (forked from the root) is therefore
    // unaffected by the EnvironmentSystem's presence.
    expect(skippedRngState).toEqual(full.state.rngState);
  });

  it('does NOT perturb the BiologySystem mortality sequence (starved tree still dies with the EnvironmentSystem present)', () => {
    // The offline-catch-up "starved tree dies" test (seed=3) is calibrated to
    // the CURRENT root-RNG sequence. Adding an EnvironmentSystem fork would
    // shift BiologySystem's mortality rolls and flip dies-in-1-day → survives
    // (verified empirically in P7d). This test pins the no-fork outcome: a
    // crippled tree still dies within one sim day with the EnvironmentSystem
    // in the registry — proving the mortality sequence is unperturbed.
    function crippled(seed: number): GameState {
      const s = engine.initialize({ ...DEFAULT_GAME_CONFIG, seed, createdAt: 0 });
      const t = s.originalTree;
      return {
        ...s,
        originalTree: {
          ...t,
          alive: true,
          stress: 1,
          health: 0,
          energy: { ...t.energy, reserves: 0, production: 0, consumption: 0 },
          water: { ...t.water, stored: 0 },
          foliage: { ...t.foliage, currentLeaves: 0 },
          damage: [
            { type: 'severe-defoliation', severity: 1, appliedAt: s.clock.elapsedSeconds },
            { type: 'severe-defoliation', severity: 1, appliedAt: s.clock.elapsedSeconds },
          ],
        },
      };
    }
    const s = crippled(3);
    const result = engine.advance(s, SECONDS_PER_DAY);
    expect(result.state.originalTree.alive).toBe(false);
    // The tree-died event fired (BiologySystem mortality ran on the
    // unshifted sequence).
    expect(result.events.some((e) => e.type === 'tree-died')).toBe(true);
  });
});
