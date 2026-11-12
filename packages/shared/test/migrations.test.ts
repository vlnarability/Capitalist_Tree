import { describe, it, expect } from 'vitest';
import {
  MigrationRegistry,
  UnknownSchemaVersionError,
  migrations,
  CURRENT_SCHEMA_VERSION,
  deserialize,
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
    // A v8 save already has all P6b1 fields — migration should leave them alone.
    const v8State = freshState();
    const out = migrations.migrate(v8State, 8, CURRENT_SCHEMA_VERSION);
    // Identity — from === target.
    expect(out).toBe(v8State);
  });

  it('v7 -> v8 migration is a no-op on an empty automation list', () => {
    // P0–P6a saves start with `automation: []` — nothing to backfill.
    const v7State = freshState();
    expect(v7State.automation).toEqual([]);
    const out = migrations.migrate(v7State, 7, CURRENT_SCHEMA_VERSION);
    expect(out.automation).toEqual([]);
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
