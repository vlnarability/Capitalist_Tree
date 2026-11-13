import { describe, it, expect } from 'vitest';
import {
  MigrationRegistry,
  UnknownSchemaVersionError,
  migrations,
  CURRENT_SCHEMA_VERSION,
  deserialize,
  PROVISIONAL_ENERGY_BATTERY_CAPACITY_DEFAULT,
  type GameState,
  type SaveEnvelope,
} from '../src/index.js';
import { baseState } from './_helpers.js';

function freshState(): GameState {
  return baseState();
}

describe('MigrationRegistry', () => {
  it('runs a no-op migration when from === target', () => {
    const reg = new MigrationRegistry();
    const s = freshState();
    const out = reg.migrate(s, 1, 1);
    expect(out).toBe(s); // identity — no copy
  });

  it('runs a sample v0 -> v1 migration correctly', () => {
    // Use the default registry which has v0 -> v1 registered (defaults.ts).
    const s = freshState();
    // Hypothetical v0 save: pretend the scheduler was missing.
    const v0State = { ...s, scheduler: undefined } as unknown as GameState;
    const out = migrations.migrate(v0State, 0, CURRENT_SCHEMA_VERSION);
    expect(out.scheduler).toBeDefined();
    expect(out.scheduler.events).toEqual([]);
  });

  it('v1 -> v2 migration backfills originalTree.pendingIssuances (P1)', () => {
    // A v1 save predates the pendingIssuances field (P1 addition).
    const v1State = freshState();
    const withoutIssuances = {
      ...v1State,
      originalTree: { ...v1State.originalTree, pendingIssuances: undefined },
    } as unknown as GameState;
    const out = migrations.migrate(withoutIssuances, 1, CURRENT_SCHEMA_VERSION);
    expect(Array.isArray(out.originalTree.pendingIssuances)).toBe(true);
    expect(out.originalTree.pendingIssuances).toEqual([]);
  });

  it('v2 -> v3 migration backfills foliage.leafGrowthProgress (P1)', () => {
    // A v2 save predates the leafGrowthProgress field (P1 addition).
    const v2State = freshState();
    const withoutProgress = {
      ...v2State,
      originalTree: {
        ...v2State.originalTree,
        foliage: { ...v2State.originalTree.foliage, leafGrowthProgress: undefined },
      },
    } as unknown as GameState;
    const out = migrations.migrate(withoutProgress, 2, CURRENT_SCHEMA_VERSION);
    expect(out.originalTree.foliage.leafGrowthProgress).toBe(0);
  });

  it('v3 -> v4 migration backfills world.weather, rngStreams.weather, soil.soilWater/ph/compaction/microbialActivity (P2)', () => {
    // A v3 save predates the P2 weather + resource additions.
    const v3State = freshState();
    const { weather: _w, ...worldWithoutWeather } = v3State.world as typeof v3State.world & {
      weather?: unknown;
    };
    const { soilWater: _sw, ph: _ph, compaction: _c, microbialActivity: _ma, ...soilWithoutP2 } =
      v3State.world.environment.soil as typeof v3State.world.environment.soil & {
        soilWater?: unknown;
        ph?: unknown;
        compaction?: unknown;
        microbialActivity?: unknown;
      };
    void _w;
    void _sw;
    void _ph;
    void _c;
    void _ma;
    const withoutP2 = {
      ...v3State,
      world: {
        ...worldWithoutWeather,
        environment: {
          ...v3State.world.environment,
          soil: soilWithoutP2,
        },
      },
      rngStreams: undefined,
    } as unknown as GameState;
    const out = migrations.migrate(withoutP2, 3, CURRENT_SCHEMA_VERSION);
    // World weather backfilled with neutral default.
    expect(out.world.weather).toBeDefined();
    expect(out.world.weather.condition).toBe('sunny');
    expect(out.world.weather.temperature).toBe(18);
    expect(out.world.weather.intensity).toBe(0.5);
    // rngStreams.weather backfilled (zero state — WeatherSystem initializes on first tick).
    expect(Array.isArray(out.rngStreams.weather)).toBe(true);
    expect(out.rngStreams.weather.length).toBe(4);
    // Soil water + pH/compaction/microbialActivity backfilled with neutral defaults.
    expect(out.world.environment.soil.soilWater).toBeGreaterThan(0);
    expect(out.world.environment.soil.ph).toBeCloseTo(6.5, 5);
    expect(out.world.environment.soil.compaction).toBe(0);
    expect(out.world.environment.soil.microbialActivity).toBeCloseTo(1.0, 5);
  });

  it('v3 -> v4 migration is idempotent on a v4 save (no field changes)', () => {
    // A v4 save already has all P2 fields — migration should leave them alone.
    const v4State = freshState();
    const out = migrations.migrate(v4State, 4, CURRENT_SCHEMA_VERSION);
    expect(out.world.weather).toEqual(v4State.world.weather);
    expect(out.rngStreams.weather).toEqual(v4State.rngStreams.weather);
    expect(out.world.environment.soil.soilWater).toBe(v4State.world.environment.soil.soilWater);
    expect(out.world.environment.soil.ph).toBe(v4State.world.environment.soil.ph);
  });

  it('v7 -> v8 migration backfills automation[*].lastRunAt + cooldownSeconds (P6b1)', () => {
    // A v7 save predates the P6b1 automation policy/cooldown fields. It has
    // an automation entry written by P0–P6a (interval-only, no policy).
    const v7State = freshState();
    const v7Automation = [
      {
        id: 'automation:test-sprinkler',
        type: 'irrigation',
        enabled: true,
        targetId: 'original',
        schedule: { kind: 'interval', value: 3600 },
        resourceConsumption: [{ resourceId: 'resource:water', amount: 5 }],
        energyConsumption: 0.5,
        maintenanceCost: '5',
        environmentalImpact: {
          carbonEmissions: 0.05,
          waterConsumption: 1.2,
          soilDegradation: 0,
          pollution: 0,
          landDisturbance: 0,
          biodiversityImpact: 0,
        },
        // No policy / lastRunAt / cooldownSeconds — these are the P6b1 fields.
      },
    ];
    const withoutP6b1 = {
      ...v7State,
      automation: v7Automation,
    } as unknown as GameState;
    const out = migrations.migrate(withoutP6b1, 7, CURRENT_SCHEMA_VERSION);
    expect(out.automation).toHaveLength(1);
    // lastRunAt + cooldownSeconds backfilled explicitly.
    expect(out.automation[0].lastRunAt).toBe(0);
    expect(out.automation[0].cooldownSeconds).toBe(0);
    // policy left absent — no natural default for a discriminated union.
    expect(out.automation[0].policy).toBeUndefined();
    // Existing fields are preserved (backward compatible).
    expect(out.automation[0].id).toBe('automation:test-sprinkler');
    expect(out.automation[0].schedule).toEqual({ kind: 'interval', value: 3600 });
    expect(out.automation[0].maintenanceCost).toBe('5');
  });

  it('v7 -> v8 migration preserves an existing policy (hand-patched save)', () => {
    // A v7 save that someone hand-patched with a policy must keep it — the
    // migration only backfills missing fields, it never overwrites.
    const v7State = freshState();
    const thresholdPolicy = {
      kind: 'threshold',
      condition: { field: 'world.environment.soil.soilWater', op: '<', value: 30 },
      action: 'apply-water',
      actionParams: { litres: 10 },
    };
    const withPolicy = {
      ...v7State,
      automation: [
        {
          id: 'automation:test-sprinkler',
          type: 'irrigation',
          enabled: true,
          targetId: 'original',
          schedule: { kind: 'interval', value: 3600 },
          resourceConsumption: [{ resourceId: 'resource:water', amount: 5 }],
          energyConsumption: 0.5,
          maintenanceCost: '5',
          environmentalImpact: {
            carbonEmissions: 0.05,
            waterConsumption: 1.2,
            soilDegradation: 0,
            pollution: 0,
            landDisturbance: 0,
            biodiversityImpact: 0,
          },
          policy: thresholdPolicy,
          lastRunAt: 12345,
          cooldownSeconds: 600,
        },
      ],
    } as unknown as GameState;
    const out = migrations.migrate(withPolicy, 7, CURRENT_SCHEMA_VERSION);
    expect(out.automation[0].policy).toEqual(thresholdPolicy);
    expect(out.automation[0].lastRunAt).toBe(12345);
    expect(out.automation[0].cooldownSeconds).toBe(600);
  });

  it('v7 -> v8 migration is idempotent on a v8 save (no field changes)', () => {
    // A v8 save already has all P6b1 fields. Migrating to the current version
    // (v9+) runs later migrations but must not touch the v8 fields. With
    // CURRENT_SCHEMA_VERSION = 9 this runs the v8 -> v9 step, which shallow-
    // copies but applies no patches to a current-shape state, so the result
    // is deep-equal to the input (not reference-equal — the migration copies).
    const v8State = freshState();
    const out = migrations.migrate(v8State, 8, CURRENT_SCHEMA_VERSION);
    expect(out).toEqual(v8State);
  });

  it('v7 -> v8 migration is a no-op on an empty automation list', () => {
    // P0–P6a saves start with `automation: []` — nothing to backfill.
    const v7State = freshState();
    expect(v7State.automation).toEqual([]);
    const out = migrations.migrate(v7State, 7, CURRENT_SCHEMA_VERSION);
    expect(out.automation).toEqual([]);
  });

  it('v8 -> v9 migration backfills environment energy/landUse/climate fields (P7a)', () => {
    // A v8 save predates the P7a EnvironmentState additions: atmosphere is
    // missing methane/nitrousOxide/aerosols, and environment is missing
    // climateForcing/seaLevelRise/energy/landUse. Simulate that by stripping
    // the v9 fields from a current-shape fixture.
    const v8State = freshState();
    const {
      methaneConcentration: _m,
      nitrousOxideConcentration: _n,
      aerosols: _a,
      ...atmosphereWithoutV9
    } = v8State.world.environment.atmosphere;
    void _m;
    void _n;
    void _a;
    const {
      climateForcing: _cf,
      seaLevelRise: _slr,
      energy: _e,
      landUse: _lu,
      ...environmentWithoutV9
    } = v8State.world.environment;
    void _cf;
    void _slr;
    void _e;
    void _lu;
    const withoutP7a = {
      ...v8State,
      world: {
        ...v8State.world,
        environment: {
          ...environmentWithoutV9,
          atmosphere: atmosphereWithoutV9,
        },
      },
    } as unknown as GameState;
    const out = migrations.migrate(withoutP7a, 8, CURRENT_SCHEMA_VERSION);
    // Atmosphere GHG/aerosol fields backfilled with real-world-ish baselines.
    expect(out.world.environment.atmosphere.methaneConcentration).toBeCloseTo(1.9, 5);
    expect(out.world.environment.atmosphere.nitrousOxideConcentration).toBeCloseTo(0.33, 5);
    expect(out.world.environment.atmosphere.aerosols).toBe(0);
    // Derived climate + long-term consequence fields backfilled to neutral.
    expect(out.world.environment.climateForcing).toBe(0);
    expect(out.world.environment.seaLevelRise).toBe(0);
    // Energy pool (resolves R-P6-3): stored 0 (no free energy), capacity the
    // battery default, rates 0.
    expect(out.world.environment.energy).toEqual({
      stored: 0,
      capacity: PROVISIONAL_ENERGY_BATTERY_CAPACITY_DEFAULT,
      generationRate: 0,
      consumptionRate: 0,
    });
    // Land-use accumulators (resolves R-P6-4): all zero.
    expect(out.world.environment.landUse).toEqual({
      developed: 0,
      degraded: 0,
      protected: 0,
    });
    // Existing fields are preserved (backward compatible).
    expect(out.world.environment.atmosphere.co2Concentration).toBe(410);
    expect(out.world.environment.atmosphere.emissions).toBe(0);
    expect(out.world.environment.globalTemperature).toBe(14);
    expect(out.world.environment.soil.soilWater).toBe(100);
  });

  it('v8 -> v9 migration preserves hand-patched energy/climate/landUse values', () => {
    // A v8 save someone hand-patched with non-default energy/climate/landUse
    // values must keep them — the migration only backfills missing fields, it
    // never overwrites.
    const v8State = freshState();
    const handPatched = {
      ...v8State,
      world: {
        ...v8State.world,
        environment: {
          ...v8State.world.environment,
          atmosphere: {
            ...v8State.world.environment.atmosphere,
            methaneConcentration: 2.5,
            nitrousOxideConcentration: 0.5,
            aerosols: -0.1,
          },
          climateForcing: 1.2,
          seaLevelRise: 50,
          energy: { stored: 30, capacity: 200, generationRate: 5, consumptionRate: 8 },
          landUse: { developed: 0.3, degraded: 0.1, protected: 0.2 },
        },
      },
    } as unknown as GameState;
    const out = migrations.migrate(handPatched, 8, CURRENT_SCHEMA_VERSION);
    expect(out.world.environment.atmosphere.methaneConcentration).toBeCloseTo(2.5, 5);
    expect(out.world.environment.atmosphere.nitrousOxideConcentration).toBeCloseTo(0.5, 5);
    expect(out.world.environment.atmosphere.aerosols).toBe(-0.1);
    expect(out.world.environment.climateForcing).toBe(1.2);
    expect(out.world.environment.seaLevelRise).toBe(50);
    expect(out.world.environment.energy).toEqual({
      stored: 30,
      capacity: 200,
      generationRate: 5,
      consumptionRate: 8,
    });
    expect(out.world.environment.landUse).toEqual({
      developed: 0.3,
      degraded: 0.1,
      protected: 0.2,
    });
  });

  it('v8 -> v9 migration is idempotent on a v9 save (no field changes)', () => {
    // A v9 save already has all P7a fields. Migrating from 8 to current (9)
    // runs the v8 -> v9 step, which shallow-copies but applies no patches to a
    // current-shape state, so the result is deep-equal to the input.
    const v9State = freshState();
    const out = migrations.migrate(v9State, 8, CURRENT_SCHEMA_VERSION);
    expect(out).toEqual(v9State);
  });

  it('v8 -> v9 migration is a no-op when world.environment is missing', () => {
    // Defensive: a malformed save lacking world.environment must not crash the
    // migration — it returns the state unchanged and lets strict validation
    // report the malformation downstream.
    const v8State = freshState();
    const { environment: _env, ...worldWithoutEnv } = v8State.world as typeof v8State.world & {
      environment?: unknown;
    };
    void _env;
    const withoutEnv = {
      ...v8State,
      world: worldWithoutEnv,
    } as unknown as GameState;
    const out = migrations.migrate(withoutEnv, 8, CURRENT_SCHEMA_VERSION);
    // No throw, and world is still without environment (migration didn't add it).
    expect(out.world).toEqual(worldWithoutEnv);
    expect((out.world as { environment?: unknown }).environment).toBeUndefined();
  });

  it('v9 -> v10 migration backfills businesses[*] P8 operational fields (P8a)', () => {
    // A v9 save predates the P8a BusinessState operational additions. It has
    // a business entry written by P0–P7 (no status / lastOperatedAt /
    // supplyChainLevel / upstreamSupplierIds / downstreamCustomerIds /
    // environmentalImpact / wageRate / marketParticipation / lastValuationTick).
    const v9State = freshState();
    const v9Business = {
      id: 'business:test-farm',
      name: 'Test Farm',
      type: 'business:farm',
      ownership: {
        ownerId: 'player:personal',
        structure: 'sole-proprietorship',
        share: 1,
      },
      cash: '0',
      assets: [],
      liabilities: [],
      revenue: '0',
      expenses: '0',
      valuation: '130000',
      employees: 4,
      production: {
        inputResourceIds: ['fertilizer:balanced-10-10-10'],
        outputResourceId: 'resource:food',
        rate: 15,
        efficiency: 0.8,
      },
      // No P8a operational fields — these are what the migration backfills.
    };
    const withoutP8a = {
      ...v9State,
      businesses: [v9Business],
    } as unknown as GameState;
    const out = migrations.migrate(withoutP8a, 9, CURRENT_SCHEMA_VERSION);
    expect(out.businesses).toHaveLength(1);
    // All nine P8a operational fields backfilled explicitly.
    expect(out.businesses[0].status).toBe('operating');
    expect(out.businesses[0].lastOperatedAt).toBe(0);
    expect(out.businesses[0].supplyChainLevel).toBe(0);
    expect(out.businesses[0].upstreamSupplierIds).toEqual([]);
    expect(out.businesses[0].downstreamCustomerIds).toEqual([]);
    expect(out.businesses[0].environmentalImpact).toEqual({
      carbonEmissions: 0,
      waterConsumption: 0,
      soilDegradation: 0,
      pollution: 0,
      landDisturbance: 0,
      biodiversityImpact: 0,
    });
    expect(out.businesses[0].wageRate).toBe('0');
    expect(out.businesses[0].marketParticipation).toEqual([]);
    expect(out.businesses[0].lastValuationTick).toBe(0);
    // Existing P0 fields are preserved (backward compatible).
    expect(out.businesses[0].id).toBe('business:test-farm');
    expect(out.businesses[0].cash).toBe('0');
    expect(out.businesses[0].valuation).toBe('130000');
    expect(out.businesses[0].employees).toBe(4);
    expect(out.businesses[0].production.outputResourceId).toBe('resource:food');
    expect(out.businesses[0].ownership.structure).toBe('sole-proprietorship');
  });

  it('v9 -> v10 migration preserves hand-patched operational values', () => {
    // A v9 save someone hand-patched with non-default operational values must
    // keep them — the migration only backfills missing fields, it never
    // overwrites.
    const v9State = freshState();
    const handPatched = {
      ...v9State,
      businesses: [
        {
          id: 'business:test-mine',
          name: 'Test Mine',
          type: 'business:mineral-mine',
          ownership: {
            ownerId: 'player:personal',
            structure: 'sustainable-enterprise',
            share: 1,
          },
          cash: '5000',
          assets: [],
          liabilities: [],
          revenue: '1000',
          expenses: '800',
          valuation: '180000',
          employees: 5,
          production: {
            inputResourceIds: [],
            outputResourceId: 'resource:minerals',
            rate: 50,
            efficiency: 0.8,
          },
          // Hand-patched P8a values — must survive the migration.
          status: 'idle',
          lastOperatedAt: 9999,
          supplyChainLevel: 0,
          upstreamSupplierIds: ['business:other-mine'],
          downstreamCustomerIds: ['business:chemical-plant'],
          environmentalImpact: {
            carbonEmissions: 0.8,
            waterConsumption: 5,
            soilDegradation: 0.3,
            pollution: 0.2,
            landDisturbance: 0.5,
            biodiversityImpact: 0.4,
          },
          wageRate: '600',
          marketParticipation: ['market:energy'],
          lastValuationTick: 12345,
        },
      ],
    } as unknown as GameState;
    const out = migrations.migrate(handPatched, 9, CURRENT_SCHEMA_VERSION);
    expect(out.businesses[0].status).toBe('idle');
    expect(out.businesses[0].lastOperatedAt).toBe(9999);
    expect(out.businesses[0].supplyChainLevel).toBe(0);
    expect(out.businesses[0].upstreamSupplierIds).toEqual(['business:other-mine']);
    expect(out.businesses[0].downstreamCustomerIds).toEqual(['business:chemical-plant']);
    expect(out.businesses[0].environmentalImpact).toEqual({
      carbonEmissions: 0.8,
      waterConsumption: 5,
      soilDegradation: 0.3,
      pollution: 0.2,
      landDisturbance: 0.5,
      biodiversityImpact: 0.4,
    });
    expect(out.businesses[0].wageRate).toBe('600');
    expect(out.businesses[0].marketParticipation).toEqual(['market:energy']);
    expect(out.businesses[0].lastValuationTick).toBe(12345);
    // The widened 'sustainable-enterprise' ownership enum value survives.
    expect(out.businesses[0].ownership.structure).toBe('sustainable-enterprise');
  });

  it('v9 -> v10 migration is idempotent on a v10 save (no field changes)', () => {
    // A v10 save already has all P8a fields. Migrating from 9 to current (10)
    // runs the v9 -> v10 step, which shallow-copies but applies no patches to
    // a current-shape state, so the result is deep-equal to the input.
    const v10State = freshState();
    const out = migrations.migrate(v10State, 9, CURRENT_SCHEMA_VERSION);
    expect(out).toEqual(v10State);
  });

  it('v9 -> v10 migration is a no-op on an empty businesses list', () => {
    // P0–P7 saves start with `businesses: []` — nothing to backfill.
    const v9State = freshState();
    expect(v9State.businesses).toEqual([]);
    const out = migrations.migrate(v9State, 9, CURRENT_SCHEMA_VERSION);
    expect(out.businesses).toEqual([]);
  });

  it('v8 -> v10 multi-hop migration backfills both P7a environment + P8a business fields', () => {
    // A v8 save predates BOTH the P7a EnvironmentState additions AND the P8a
    // BusinessState additions. It has a business entry written by P0–P6 (no
    // P8a fields) and an environment written by P0–P6 (no P7a fields). The
    // runner walks v8 -> v9 -> v10, applying both migrations in sequence.
    const v8State = freshState();
    // Strip the P7a environment fields (simulate a v8 save).
    const {
      methaneConcentration: _m,
      nitrousOxideConcentration: _n,
      aerosols: _a,
      ...atmosphereWithoutV9
    } = v8State.world.environment.atmosphere;
    void _m;
    void _n;
    void _a;
    const {
      climateForcing: _cf,
      seaLevelRise: _slr,
      energy: _e,
      landUse: _lu,
      ...environmentWithoutV9
    } = v8State.world.environment;
    void _cf;
    void _slr;
    void _e;
    void _lu;
    // Add a v8-era business (no P8a fields).
    const v8Business = {
      id: 'business:test-store',
      name: 'Test Store',
      type: 'business:general-store',
      ownership: {
        ownerId: 'player:personal',
        structure: 'sole-proprietorship',
        share: 1,
      },
      cash: '1000',
      assets: [],
      liabilities: [],
      revenue: '0',
      expenses: '0',
      valuation: '90000',
      employees: 3,
      production: {
        inputResourceIds: ['fertilizer:balanced-10-10-10'],
        outputResourceId: 'fertilizer:balanced-10-10-10',
        rate: 20,
        efficiency: 0.98,
      },
    };
    const withoutP7aP8a = {
      ...v8State,
      world: {
        ...v8State.world,
        environment: {
          ...environmentWithoutV9,
          atmosphere: atmosphereWithoutV9,
        },
      },
      businesses: [v8Business],
    } as unknown as GameState;
    const out = migrations.migrate(withoutP7aP8a, 8, CURRENT_SCHEMA_VERSION);
    // P7a environment fields backfilled by the v8 -> v9 hop.
    expect(out.world.environment.atmosphere.methaneConcentration).toBeCloseTo(1.9, 5);
    expect(out.world.environment.atmosphere.nitrousOxideConcentration).toBeCloseTo(0.33, 5);
    expect(out.world.environment.atmosphere.aerosols).toBe(0);
    expect(out.world.environment.climateForcing).toBe(0);
    expect(out.world.environment.seaLevelRise).toBe(0);
    expect(out.world.environment.energy).toBeDefined();
    expect(out.world.environment.landUse).toBeDefined();
    // P8a business fields backfilled by the v9 -> v10 hop.
    expect(out.businesses).toHaveLength(1);
    expect(out.businesses[0].status).toBe('operating');
    expect(out.businesses[0].lastOperatedAt).toBe(0);
    expect(out.businesses[0].supplyChainLevel).toBe(0);
    expect(out.businesses[0].upstreamSupplierIds).toEqual([]);
    expect(out.businesses[0].downstreamCustomerIds).toEqual([]);
    expect(out.businesses[0].environmentalImpact).toEqual({
      carbonEmissions: 0,
      waterConsumption: 0,
      soilDegradation: 0,
      pollution: 0,
      landDisturbance: 0,
      biodiversityImpact: 0,
    });
    expect(out.businesses[0].wageRate).toBe('0');
    expect(out.businesses[0].marketParticipation).toEqual([]);
    expect(out.businesses[0].lastValuationTick).toBe(0);
    // Existing P0 business fields preserved across both hops.
    expect(out.businesses[0].id).toBe('business:test-store');
    expect(out.businesses[0].valuation).toBe('90000');
    expect(out.businesses[0].employees).toBe(3);
  });

  it('v10 -> v11 migration backfills businesses[*].inventory + liabilities[*].accruedInterest (P8c)', () => {
    // A v10 save predates the P8c BusinessState additions. It has a business
    // entry written by P8a/P8b (all P8a operational fields present, but NO
    // `inventory` field and NO `accruedInterest` on its liabilities).
    const v10State = freshState();
    const v10Business = {
      id: 'business:test-farm',
      name: 'Test Farm',
      type: 'business:farm',
      ownership: {
        ownerId: 'player:personal',
        structure: 'sole-proprietorship',
        share: 1,
      },
      cash: '5000',
      assets: [],
      liabilities: [
        {
          id: 'liability:1',
          type: 'loan',
          principal: '100000',
          interestRate: 0.05,
          dueAt: 100000,
          // No accruedInterest — P8c backfills this.
        },
      ],
      revenue: '1000',
      expenses: '800',
      valuation: '130000',
      employees: 4,
      production: {
        inputResourceIds: ['fertilizer:balanced-10-10-10'],
        outputResourceId: 'resource:food',
        rate: 15,
        efficiency: 0.8,
      },
      status: 'operating',
      lastOperatedAt: 9999,
      supplyChainLevel: 5,
      upstreamSupplierIds: [],
      downstreamCustomerIds: [],
      environmentalImpact: {
        carbonEmissions: 0.3,
        waterConsumption: 30,
        soilDegradation: 0.05,
        pollution: 0.1,
        landDisturbance: 0.15,
        biodiversityImpact: 0.2,
      },
      wageRate: '450',
      marketParticipation: ['market:food'],
      lastValuationTick: 12345,
      // No inventory — P8c backfills this.
    };
    const withoutP8c = {
      ...v10State,
      businesses: [v10Business],
    } as unknown as GameState;
    const out = migrations.migrate(withoutP8c, 10, CURRENT_SCHEMA_VERSION);
    expect(out.businesses).toHaveLength(1);
    // P8c inventory field backfilled explicitly.
    expect(Array.isArray(out.businesses[0].inventory)).toBe(true);
    expect(out.businesses[0].inventory).toEqual([]);
    // P8c accruedInterest backfilled on each liability.
    expect(out.businesses[0].liabilities[0].accruedInterest).toBe('0');
    // Existing P8a fields are preserved (backward compatible).
    expect(out.businesses[0].id).toBe('business:test-farm');
    expect(out.businesses[0].cash).toBe('5000');
    expect(out.businesses[0].valuation).toBe('130000');
    expect(out.businesses[0].employees).toBe(4);
    expect(out.businesses[0].status).toBe('operating');
    expect(out.businesses[0].lastOperatedAt).toBe(9999);
    expect(out.businesses[0].wageRate).toBe('450');
    expect(out.businesses[0].lastValuationTick).toBe(12345);
    // Existing liability fields preserved.
    expect(out.businesses[0].liabilities[0].principal).toBe('100000');
    expect(out.businesses[0].liabilities[0].interestRate).toBe(0.05);
  });

  it('v10 -> v11 migration preserves hand-patched inventory + accruedInterest values', () => {
    // A v10 save someone hand-patched with non-default inventory +
    // accruedInterest values must keep them — the migration only backfills
    // missing fields, it never overwrites.
    const v10State = freshState();
    const handPatched = {
      ...v10State,
      businesses: [
        {
          id: 'business:test-mine',
          name: 'Test Mine',
          type: 'business:mineral-mine',
          ownership: {
            ownerId: 'player:personal',
            structure: 'corporation',
            share: 1,
          },
          cash: '20000',
          assets: [],
          liabilities: [
            {
              id: 'liability:1',
              type: 'loan',
              principal: '50000',
              interestRate: 0.07,
              dueAt: 200000,
              accruedInterest: '1234', // hand-patched — must survive.
            },
          ],
          revenue: '5000',
          expenses: '3000',
          valuation: '180000',
          employees: 5,
          production: {
            inputResourceIds: [],
            outputResourceId: 'resource:minerals',
            rate: 50,
            efficiency: 0.8,
          },
          status: 'operating',
          lastOperatedAt: 5000,
          supplyChainLevel: 0,
          upstreamSupplierIds: [],
          downstreamCustomerIds: [],
          environmentalImpact: {
            carbonEmissions: 0,
            waterConsumption: 0,
            soilDegradation: 0,
            pollution: 0,
            landDisturbance: 0,
            biodiversityImpact: 0,
          },
          wageRate: '600',
          marketParticipation: [],
          lastValuationTick: 5000,
          inventory: [
            // hand-patched — must survive.
            { resourceId: 'resource:minerals', quantity: 250 },
          ],
        },
      ],
    } as unknown as GameState;
    const out = migrations.migrate(handPatched, 10, CURRENT_SCHEMA_VERSION);
    // Hand-patched inventory preserved (not overwritten with []).
    expect(out.businesses[0].inventory).toEqual([
      { resourceId: 'resource:minerals', quantity: 250 },
    ]);
    // Hand-patched accruedInterest preserved (not overwritten with '0').
    expect(out.businesses[0].liabilities[0].accruedInterest).toBe('1234');
    // Other liability fields preserved.
    expect(out.businesses[0].liabilities[0].principal).toBe('50000');
    expect(out.businesses[0].liabilities[0].interestRate).toBe(0.07);
  });

  it('v10 -> v11 migration is idempotent on a v11 save (no field changes)', () => {
    // A v11 save already has the P8c fields. Migrating from 10 to current
    // (11) runs the v10 -> v11 step, which shallow-copies but applies no
    // patches to a current-shape state, so the result is deep-equal to the
    // input.
    const v11State = freshState();
    const out = migrations.migrate(v11State, 10, CURRENT_SCHEMA_VERSION);
    expect(out).toEqual(v11State);
  });

  it('v10 -> v11 migration is a no-op on an empty businesses list', () => {
    // A v10 save with `businesses: []` — nothing to backfill.
    const v10State = freshState();
    expect(v10State.businesses).toEqual([]);
    const out = migrations.migrate(v10State, 10, CURRENT_SCHEMA_VERSION);
    expect(out.businesses).toEqual([]);
  });

  it('v10 -> v11 migration backfills accruedInterest on every liability (multiple liabilities)', () => {
    // A v10 business with multiple liabilities, all missing accruedInterest.
    const v10State = freshState();
    const v10Business = {
      id: 'business:test-multi-loan',
      name: 'Multi Loan Co',
      type: 'business:equipment-factory',
      ownership: {
        ownerId: 'player:personal',
        structure: 'corporation',
        share: 1,
      },
      cash: '100000',
      assets: [],
      liabilities: [
        { id: 'l1', type: 'loan', principal: '10000', interestRate: 0.05, dueAt: 1000 },
        { id: 'l2', type: 'loan', principal: '20000', interestRate: 0.03, dueAt: 2000 },
        { id: 'l3', type: 'bond', principal: '50000', interestRate: 0.08, dueAt: 5000 },
      ],
      revenue: '0',
      expenses: '0',
      valuation: '200000',
      employees: 12,
      production: {
        inputResourceIds: ['resource:lumber', 'resource:steel'],
        outputResourceId: 'resource:equipment',
        rate: 8,
        efficiency: 0.82,
      },
      status: 'operating',
      lastOperatedAt: 0,
      supplyChainLevel: 2,
      upstreamSupplierIds: [],
      downstreamCustomerIds: [],
      environmentalImpact: {
        carbonEmissions: 0,
        waterConsumption: 0,
        soilDegradation: 0,
        pollution: 0,
        landDisturbance: 0,
        biodiversityImpact: 0,
      },
      wageRate: '800',
      marketParticipation: ['market:equipment'],
      lastValuationTick: 0,
    };
    const withoutP8c = {
      ...v10State,
      businesses: [v10Business],
    } as unknown as GameState;
    const out = migrations.migrate(withoutP8c, 10, CURRENT_SCHEMA_VERSION);
    // Every liability got accruedInterest backfilled.
    expect(out.businesses[0].liabilities).toHaveLength(3);
    expect(out.businesses[0].liabilities[0].accruedInterest).toBe('0');
    expect(out.businesses[0].liabilities[1].accruedInterest).toBe('0');
    expect(out.businesses[0].liabilities[2].accruedInterest).toBe('0');
    // Inventory backfilled.
    expect(out.businesses[0].inventory).toEqual([]);
  });

  it('v11 -> v12 migration restructures the P0 progression stub into the full ProgressionState (P9a)', () => {
    // A v11 save carries the P0 progression stub shape:
    //   { research: [{id, completedAt}], achievements: [{id, completedAt}],
    //     geneticLegacy: number }
    // v12 replaces it with the nested-object ProgressionState (GDD §11/§12).
    const v11State = freshState();
    const withoutP9a = {
      ...v11State,
      progression: {
        research: [{ id: 'research:stub', completedAt: 100 }],
        achievements: [{ id: 'achievement:stub', completedAt: 200 }],
        geneticLegacy: 5,
      },
    } as unknown as GameState;
    const out = migrations.migrate(withoutP9a, 11, CURRENT_SCHEMA_VERSION);
    // research restructured to {nodes, totalSpent} (old array discarded).
    expect(Array.isArray(out.progression.research.nodes)).toBe(true);
    expect(out.progression.research.nodes).toEqual([]);
    expect(out.progression.research.totalSpent).toBe('0');
    // genetics backfilled (v11 had none); originalLineageId defaults to 'original'.
    expect(Array.isArray(out.progression.genetics.activeTraits)).toBe(true);
    expect(out.progression.genetics.activeTraits).toEqual([]);
    expect(out.progression.genetics.availableTraits).toEqual([]);
    expect(out.progression.genetics.originalLineageId).toBe('original');
    // achievements restructured to {tracked} (old array discarded).
    expect(Array.isArray(out.progression.achievements.tracked)).toBe(true);
    expect(out.progression.achievements.tracked).toEqual([]);
    // prestige backfilled (v11 geneticLegacy number is NOT carried over —
    // different units; it was always 0 on real v11 saves).
    expect(out.progression.prestige.geneticLegacyPoints).toBe('0');
    expect(out.progression.prestige.totalGenerations).toBe(0);
    expect(out.progression.prestige.currentGeneration).toBe(1);
    expect(out.progression.prestige.prestigeMultiplier).toBeCloseTo(1.0, 5);
    expect(out.progression.prestige.historicalRecords).toEqual([]);
    // generationHistory backfilled (v11 had none).
    expect(Array.isArray(out.progression.generationHistory)).toBe(true);
    expect(out.progression.generationHistory).toEqual([]);
  });

  it('v11 -> v12 migration preserves hand-patched v12 progression values', () => {
    // A v11 save someone hand-patched with a partial/full v12 progression must
    // keep the v12 values — the migration only backfills missing sub-fields,
    // it never overwrites.
    const v11State = freshState();
    const handPatchedProgression = {
      research: { nodes: [{ id: 'research:x', categoryId: 'biology', unlocked: true, unlockedAt: 55, prerequisites: [], cost: '10' }], totalSpent: '10' },
      genetics: {
        activeTraits: [{ traitId: 'trait:rapid-growth', active: true, generation: 1, magnitude: 0.8 }],
        availableTraits: ['trait:deep-roots'],
        originalLineageId: 'lineage:custom',
      },
      achievements: { tracked: [{ id: 'achievement:first-million', unlocked: true, unlockedAt: 99, progress: 1 }] },
      prestige: { geneticLegacyPoints: '42', totalGenerations: 2, currentGeneration: 3, prestigeMultiplier: 1.5, historicalRecords: ['history:x'] },
      generationHistory: [{ generationNumber: 1, treeSpeciesId: 'species:white-oak', startDate: 0, endDate: 1000, outcome: 'completed', prestigeEarned: '10' }],
    };
    const withP9a = {
      ...v11State,
      progression: handPatchedProgression,
    } as unknown as GameState;
    const out = migrations.migrate(withP9a, 11, CURRENT_SCHEMA_VERSION);
    // Every hand-patched value preserved.
    expect(out.progression.research.nodes).toHaveLength(1);
    expect(out.progression.research.nodes[0].id).toBe('research:x');
    expect(out.progression.research.nodes[0].unlocked).toBe(true);
    expect(out.progression.research.totalSpent).toBe('10');
    expect(out.progression.genetics.activeTraits).toHaveLength(1);
    expect(out.progression.genetics.activeTraits[0].traitId).toBe('trait:rapid-growth');
    expect(out.progression.genetics.availableTraits).toEqual(['trait:deep-roots']);
    expect(out.progression.genetics.originalLineageId).toBe('lineage:custom');
    expect(out.progression.achievements.tracked).toHaveLength(1);
    expect(out.progression.achievements.tracked[0].id).toBe('achievement:first-million');
    expect(out.progression.prestige.geneticLegacyPoints).toBe('42');
    expect(out.progression.prestige.totalGenerations).toBe(2);
    expect(out.progression.prestige.currentGeneration).toBe(3);
    expect(out.progression.prestige.prestigeMultiplier).toBeCloseTo(1.5, 5);
    expect(out.progression.prestige.historicalRecords).toEqual(['history:x']);
    expect(out.progression.generationHistory).toHaveLength(1);
    expect(out.progression.generationHistory[0].generationNumber).toBe(1);
  });

  it('v11 -> v12 migration is idempotent on a v12 save (no field changes)', () => {
    // A v12 save already has the full progression shape. Migrating from 11 to
    // current (12) runs the v11 -> v12 step, which rebuilds the progression
    // with the same nested values, so the result is deep-equal to the input.
    const v12State = freshState();
    const out = migrations.migrate(v12State, 11, CURRENT_SCHEMA_VERSION);
    expect(out).toEqual(v12State);
  });

  it('v11 -> v12 migration is a no-op when progression is missing or non-object', () => {
    // Defensive: a malformed save lacking progression (or with a non-object)
    // must not crash the migration — it returns the state unchanged and lets
    // strict validation report the malformation downstream.
    const v11State = freshState();
    const withoutProgression = {
      ...v11State,
      progression: undefined,
    } as unknown as GameState;
    expect(() => migrations.migrate(withoutProgression, 11, CURRENT_SCHEMA_VERSION)).not.toThrow();
    const out = migrations.migrate(withoutProgression, 11, CURRENT_SCHEMA_VERSION);
    // progression still absent — migration did not add it.
    expect((out as { progression?: unknown }).progression).toBeUndefined();

    // Non-object progression (e.g. a stray string) also short-circuits.
    const withString = { ...v11State, progression: 'oops' } as unknown as GameState;
    expect(() => migrations.migrate(withString, 11, CURRENT_SCHEMA_VERSION)).not.toThrow();
  });

  it('v10 -> v12 multi-hop migration backfills both P8c business fields + P9a progression', () => {
    // A v10 save predates BOTH the P8c BusinessState additions AND the P9a
    // ProgressionState restructure. It has a business entry written by P8a/P8b
    // (no `inventory` / `accruedInterest`) and the P0 progression stub. The
    // runner walks v10 -> v11 -> v12, applying both migrations in sequence.
    const v10State = freshState();
    // Restore the P0 progression stub (freshState is now v12-shaped).
    const v10Progression = {
      research: [{ id: 'research:stub', completedAt: 0 }],
      achievements: [],
      geneticLegacy: 0,
    };
    const v10Business = {
      id: 'business:test-farm',
      name: 'Test Farm',
      type: 'business:farm',
      ownership: { ownerId: 'player:personal', structure: 'sole-proprietorship', share: 1 },
      cash: '5000',
      assets: [],
      liabilities: [{ id: 'liability:1', type: 'loan', principal: '100000', interestRate: 0.05, dueAt: 100000 }],
      revenue: '1000',
      expenses: '800',
      valuation: '130000',
      employees: 4,
      production: { inputResourceIds: ['fertilizer:balanced-10-10-10'], outputResourceId: 'resource:food', rate: 15, efficiency: 0.8 },
      status: 'operating',
      lastOperatedAt: 9999,
      supplyChainLevel: 5,
      upstreamSupplierIds: [],
      downstreamCustomerIds: [],
      environmentalImpact: { carbonEmissions: 0.3, waterConsumption: 30, soilDegradation: 0.05, pollution: 0.1, landDisturbance: 0.15, biodiversityImpact: 0.2 },
      wageRate: '450',
      marketParticipation: ['market:food'],
      lastValuationTick: 12345,
      // No inventory — P8c backfills this.
    };
    const withoutP8cP9a = {
      ...v10State,
      businesses: [v10Business],
      progression: v10Progression,
    } as unknown as GameState;
    const out = migrations.migrate(withoutP8cP9a, 10, CURRENT_SCHEMA_VERSION);
    // P8c business fields backfilled by the v10 -> v11 hop.
    expect(out.businesses).toHaveLength(1);
    expect(out.businesses[0].inventory).toEqual([]);
    expect(out.businesses[0].liabilities[0].accruedInterest).toBe('0');
    // P9a progression restructured by the v11 -> v12 hop.
    expect(out.progression.research.nodes).toEqual([]);
    expect(out.progression.research.totalSpent).toBe('0');
    expect(out.progression.genetics.originalLineageId).toBe('original');
    expect(out.progression.achievements.tracked).toEqual([]);
    expect(out.progression.prestige.geneticLegacyPoints).toBe('0');
    expect(out.progression.prestige.currentGeneration).toBe(1);
    expect(out.progression.generationHistory).toEqual([]);
    // Existing business fields preserved across both hops.
    expect(out.businesses[0].id).toBe('business:test-farm');
    expect(out.businesses[0].valuation).toBe('130000');
  });

  it('current-version saves pass through migrations unchanged (identity)', () => {
    const s = freshState();
    const out = migrations.migrate(s, CURRENT_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION);
    // Identity — no copy when from === target.
    expect(out).toBe(s);
  });

  it('raises UnknownSchemaVersionError for an unknown source version', () => {
    const reg = new MigrationRegistry();
    const s = freshState();
    expect(() => reg.migrate(s, 99, 1)).toThrow(UnknownSchemaVersionError);
  });

  it('raises UnknownSchemaVersionError for a future source version (downgrade)', () => {
    const reg = new MigrationRegistry();
    const s = freshState();
    // `CURRENT_SCHEMA_VERSION + 1` is a hypothetical future save whose
    // migration the running code doesn't know about yet.
    expect(() => reg.migrate(s, CURRENT_SCHEMA_VERSION + 1, 1)).toThrow(
      UnknownSchemaVersionError,
    );
  });

  it('raises UnknownSchemaVersionError when an intermediate migration is missing', () => {
    const reg = new MigrationRegistry();
    reg.register(0, (s) => s);
    // No migration from 1 -> 2 registered.
    const s = freshState();
    expect(() => reg.migrate(s, 0, 2)).toThrow(UnknownSchemaVersionError);
  });

  it('UnknownSchemaVersionError exposes the actual version and known versions', () => {
    const reg = new MigrationRegistry();
    const s = freshState();
    try {
      reg.migrate(s, 99, 1);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownSchemaVersionError);
      const e = err as UnknownSchemaVersionError;
      expect(e.actual).toBe(99);
      expect(Array.isArray(e.known)).toBe(true);
    }
  });
});

describe('deserialize() runs migrations before strict validation (TDD §14.3)', () => {
  // Regression: previously `deserialize()` parsed the envelope with the
  // *current* gameStateSchema, which rejected any older save before the
  // migration could fix it. This proves the v0 -> v1 migration actually
  // runs end-to-end via the public deserialize() entry point.
  it('migrates a v0 envelope (missing scheduler) to a valid v1 GameState', () => {
    const v1State = freshState();
    const { scheduler: _scheduler, ...v0State } = v1State;
    void _scheduler;
    const env: SaveEnvelope = {
      schemaVersion: 0,
      state: v0State as unknown as GameState,
    };
    const out = deserialize(env);
    expect(out.scheduler).toBeDefined();
    expect(out.scheduler.events).toEqual([]);
  });

  it('still rejects an unknown schemaVersion (no silent discard)', () => {
    const env = {
      schemaVersion: 999,
      state: freshState(),
    } as unknown as SaveEnvelope;
    expect(() => deserialize(env)).toThrow(UnknownSchemaVersionError);
  });

  it('still rejects a v1 save whose state fails the strict schema', () => {
    const valid = freshState();
    const bad = {
      ...valid,
      originalTree: { ...valid.originalTree, isOriginal: false },
    };
    const env: SaveEnvelope = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      state: bad,
    };
    // The strict post-migration validation must catch the superRefine
    // violation even though the envelope shape itself is fine.
    expect(() => deserialize(env)).toThrow();
  });
});
