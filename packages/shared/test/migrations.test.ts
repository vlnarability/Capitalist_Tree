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
