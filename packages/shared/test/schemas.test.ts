import { describe, it, expect } from 'vitest';
import {
  gameStateSchema,
  simulationClockSchema,
  seasonSchema,
  type GameState,
  PROVISIONAL_DAYS_PER_SEASON,
  CURRENT_SCHEMA_VERSION,
} from '../src/index.js';
import { baseState } from './_helpers.js';

describe('gameStateSchema superRefine (GDD §16.1/16.2, TDD §18.4)', () => {
  it('accepts a valid original tree', () => {
    const s = baseState();
    expect(() => gameStateSchema.parse(s)).not.toThrow();
  });

  it('rejects originalTree.isOriginal === false (path: originalTree.isOriginal)', () => {
    const s = baseState({
      originalTree: { ...baseState().originalTree, isOriginal: false },
    });
    const result = gameStateSchema.safeParse(s);
    expect(result.success).toBe(false);
    if (!result.success) {
      const isOriginalIssue = result.error.issues.find(
        (i) => i.path.join('.') === 'originalTree.isOriginal',
      );
      expect(isOriginalIssue).toBeDefined();
    }
  });

  it("rejects originalTree.id !== 'original' (path: originalTree.id)", () => {
    const s = baseState({
      originalTree: { ...baseState().originalTree, id: 'something-else' },
    });
    const result = gameStateSchema.safeParse(s);
    expect(result.success).toBe(false);
    if (!result.success) {
      const idIssue = result.error.issues.find(
        (i) => i.path.join('.') === 'originalTree.id',
      );
      expect(idIssue).toBeDefined();
    }
  });

  it('rejects negative ageDays', () => {
    const s = baseState({
      originalTree: { ...baseState().originalTree, ageDays: -1 },
    });
    const result = gameStateSchema.safeParse(s);
    expect(result.success).toBe(false);
  });

  it('rejects missing rngState', () => {
    const s = baseState();
    const { rngState: _rngState, ...rest } = s;
    void _rngState;
    const result = gameStateSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects wrong type for elapsedSeconds (string instead of number)', () => {
    const s = baseState();
    const bad = {
      ...s,
      clock: { ...s.clock, elapsedSeconds: 'oops' as unknown as number },
    };
    const result = gameStateSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});

describe('simulationClockSchema', () => {
  it('accepts a valid clock', () => {
    expect(() =>
      simulationClockSchema.parse({
        elapsedSeconds: 0,
        day: 0,
        season: 'spring',
        timeOfDay: 0,
        speedMultiplier: 1,
        paused: false,
      }),
    ).not.toThrow();
  });

  it('rejects negative elapsedSeconds', () => {
    expect(
      simulationClockSchema.safeParse({
        elapsedSeconds: -1,
        day: 0,
        season: 'spring',
        timeOfDay: 0,
        speedMultiplier: 1,
        paused: false,
      }).success,
    ).toBe(false);
  });
});

describe('seasonSchema', () => {
  it('accepts all four seasons', () => {
    for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) {
      expect(seasonSchema.safeParse(season).success).toBe(true);
    }
  });

  it('rejects unknown season', () => {
    expect(seasonSchema.safeParse('monsoon').success).toBe(false);
  });
});

describe('constants', () => {
  it('PROVISIONAL_DAYS_PER_SEASON is positive', () => {
    expect(PROVISIONAL_DAYS_PER_SEASON).toBeGreaterThan(0);
  });

  it('CURRENT_SCHEMA_VERSION is positive', () => {
    expect(CURRENT_SCHEMA_VERSION).toBeGreaterThan(0);
  });
});

// Ensure the GameState type is referenced for the import side-effect.
void (null as unknown as GameState);
