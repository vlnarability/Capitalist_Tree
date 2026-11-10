import { describe, it, expect } from 'vitest';
import { engine, InMemoryStorage } from '../src/index.js';
import { DEFAULT_GAME_CONFIG } from '../src/initial-state.js';
import {
  type GameState,
  type SaveEnvelope,
  SaveValidationError,
  UnknownSchemaVersionError,
  CURRENT_SCHEMA_VERSION,
} from '@capitalist-tree/shared';
import { serialize, deserialize } from '@capitalist-tree/shared';

function freshState(): GameState {
  return engine.initialize({ ...DEFAULT_GAME_CONFIG, seed: 1, createdAt: 0 });
}

describe('InMemoryStorage round-trip', () => {
  it('save -> load is a deep-equal round-trip', async () => {
    const storage = new InMemoryStorage();
    const s = freshState();
    await storage.save(s);
    const loaded = await storage.load();
    expect(loaded).not.toBeNull();
    expect(loaded).toEqual(s);
  });

  it('listSaves returns all stored save ids', async () => {
    const storage = new InMemoryStorage();
    const s1 = freshState();
    const s2: GameState = {
      ...s1,
      metadata: { ...s1.metadata, saveId: 'save-2' },
    };
    await storage.save(s1);
    await storage.save(s2);
    const ids = await storage.listSaves();
    expect(ids.sort()).toEqual(['save-2', 'save-default']);
  });

  it('deleteSave removes a save', async () => {
    const storage = new InMemoryStorage();
    const s = freshState();
    await storage.save(s);
    const had = await storage.deleteSave('save-default');
    expect(had).toBe(true);
    const loaded = await storage.load();
    expect(loaded).toBeNull();
  });
});

describe('Zod validation rejects corrupt saves', () => {
  it('rejects missing required field (state.clock)', () => {
    const env: SaveEnvelope = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      state: { ...freshState(), clock: undefined } as unknown as GameState,
    };
    expect(() => deserialize(env)).toThrow(SaveValidationError);
  });

  it('rejects wrong type for elapsedSeconds (string instead of number)', () => {
    const valid = freshState();
    const bad: SaveEnvelope = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      state: {
        ...valid,
        clock: { ...valid.clock, elapsedSeconds: 'oops' as unknown as number },
      },
    };
    expect(() => deserialize(bad)).toThrow(SaveValidationError);
  });

  it('rejects unknown schemaVersion with UnknownSchemaVersionError (not silent discard)', () => {
    const valid = freshState();
    // Inject a future schemaVersion we can't migrate from.
    const env = { schemaVersion: 999, state: valid } as unknown as SaveEnvelope;
    expect(() => deserialize(env)).toThrow(UnknownSchemaVersionError);
  });
});

describe('serialize/deserialize', () => {
  it('serialize produces an envelope at CURRENT_SCHEMA_VERSION', () => {
    const env = serialize(freshState());
    expect(env.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('serialize -> deserialize round-trips equal', () => {
    const s = freshState();
    const env = serialize(s);
    const back = deserialize(env);
    expect(back).toEqual(s);
  });
});
