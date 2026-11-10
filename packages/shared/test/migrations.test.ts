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

  it('v3 (current) saves pass through migrations unchanged', () => {
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
    expect(() => reg.migrate(s, 5, 1)).toThrow(UnknownSchemaVersionError);
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
