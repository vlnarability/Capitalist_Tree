/**
 * Genetics inheritance + trait-effect query tests (P9c — TDD §18.1, §18.4;
 * GDD §11.2 Genetic Legacy).
 *
 * Asserts:
 *   - mutateTraitMagnitude: bounded [0,1]; deterministic given (magnitude, rng);
 *     a magnitude of 0 only drifts up; a magnitude of 1 only drifts down.
 *   - inheritTraits: active traits carry over with generation=newGeneration;
 *     magnitude mutated but bounded; deactivated traits also carry (genetic
 *     material preserved); originalLineageId + availableTraits preserved.
 *   - getActiveTraitEffects: returns map of traitId → {benefit, tradeOff,
 *     magnitude} for active traits; deactivated traits excluded; unknown ids
 *     skipped defensively.
 *   - Purity (freeze test).
 */
import { describe, it, expect } from 'vitest';
import {
  engine,
  mutateTraitMagnitude,
  inheritTraits,
  getActiveTraitEffects,
} from '../src/index.js';
import { Rng } from '../src/rng.js';
import { DEFAULT_GAME_CONFIG } from '../src/initial-state.js';
import {
  type GameState,
  type GameConfig,
  PROVISIONAL_TRAIT_MAGNITUDE_DEFAULT,
} from '@capitalist-tree/shared';
import {
  RAPID_GROWTH,
  LARGE_FOLIAGE,
  DEEP_ROOTS,
} from '@capitalist-tree/content';

function cfg(seed: number): GameConfig {
  return { ...DEFAULT_GAME_CONFIG, seed };
}

function freshState(seed = 42): GameState {
  return engine.initialize(cfg(seed));
}

function deepFreeze<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v;
  Object.freeze(v);
  if (Array.isArray(v)) {
    for (const item of v) deepFreeze(item);
  } else {
    for (const key of Object.keys(v as Record<string, unknown>)) {
      deepFreeze((v as Record<string, unknown>)[key]);
    }
  }
  return v;
}

/** State with one active + one deactivated acquired trait. */
function stateWithTraits(): GameState {
  const state = freshState();
  return {
    ...state,
    progression: {
      ...state.progression,
      genetics: {
        ...state.progression.genetics,
        activeTraits: [
          { traitId: RAPID_GROWTH.id, active: true, generation: 1, magnitude: 0.75 },
          { traitId: LARGE_FOLIAGE.id, active: true, generation: 1, magnitude: 0.5 },
          // Deactivated — still acquired (genetic material preserved).
          { traitId: DEEP_ROOTS.id, active: false, generation: 1, magnitude: 0.6 },
        ],
        availableTraits: ['trait:pest-resistance'],
      },
    },
  };
}

// ---------------------------------------------------------------------------
// mutateTraitMagnitude
// ---------------------------------------------------------------------------

describe('mutateTraitMagnitude', () => {
  it('returns a value bounded to [0, 1]', () => {
    const rng = Rng.fromSeed(42);
    for (let i = 0; i < 100; i++) {
      const m = mutateTraitMagnitude(0.5, rng);
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic given (magnitude, rng state)', () => {
    const r1 = Rng.fromSeed(7);
    const r2 = Rng.fromSeed(7);
    expect(mutateTraitMagnitude(0.5, r1)).toBe(mutateTraitMagnitude(0.5, r2));
  });

  it('a magnitude of 0 only drifts up (cannot go negative)', () => {
    const rng = Rng.fromSeed(99);
    for (let i = 0; i < 50; i++) {
      expect(mutateTraitMagnitude(0, rng)).toBeGreaterThanOrEqual(0);
    }
  });

  it('a magnitude of 1 only drifts down (cannot exceed 1)', () => {
    const rng = Rng.fromSeed(99);
    for (let i = 0; i < 50; i++) {
      expect(mutateTraitMagnitude(1, rng)).toBeLessThanOrEqual(1);
    }
  });

  it('the perturbation is small (within ±0.05 of the input when not clamped)', () => {
    // magnitude 0.5 is far from the [0,1] bounds so no clamping occurs.
    const rng = Rng.fromSeed(1);
    const mutated = mutateTraitMagnitude(0.5, rng);
    expect(Math.abs(mutated - 0.5)).toBeLessThanOrEqual(0.05);
  });
});

// ---------------------------------------------------------------------------
// inheritTraits
// ---------------------------------------------------------------------------

describe('inheritTraits', () => {
  it('carries active traits into the new generation with generation=newGeneration', () => {
    const state = stateWithTraits();
    const result = inheritTraits(state, 5);
    expect(result.activeTraits).toHaveLength(3);
    for (const trait of result.activeTraits) {
      expect(trait.generation).toBe(5);
    }
    // traitId + active flag preserved.
    const rapid = result.activeTraits.find((t) => t.traitId === RAPID_GROWTH.id)!;
    expect(rapid.active).toBe(true);
    const deep = result.activeTraits.find((t) => t.traitId === DEEP_ROOTS.id)!;
    expect(deep.active).toBe(false); // deactivated trait stays deactivated
  });

  it('mutates each carried trait magnitude but keeps it bounded [0,1]', () => {
    const state = stateWithTraits();
    const result = inheritTraits(state, 2);
    for (const trait of result.activeTraits) {
      expect(trait.magnitude).toBeGreaterThanOrEqual(0);
      expect(trait.magnitude).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic given (state, newGeneration) — same inputs → same output', () => {
    const s1 = stateWithTraits();
    const s2 = stateWithTraits();
    expect(inheritTraits(s1, 3)).toEqual(inheritTraits(s2, 3));
  });

  it('different generations produce different mutations (seeded by generation)', () => {
    const state = stateWithTraits();
    const gen2 = inheritTraits(state, 2);
    const gen3 = inheritTraits(state, 3);
    // At least one trait's magnitude differs between generations (the seed
    // includes the generation number).
    const rapid2 = gen2.activeTraits.find((t) => t.traitId === RAPID_GROWTH.id)!;
    const rapid3 = gen3.activeTraits.find((t) => t.traitId === RAPID_GROWTH.id)!;
    expect(rapid2.magnitude).not.toBe(rapid3.magnitude);
  });

  it('PRESERVES originalLineageId verbatim (GDD §11.2)', () => {
    const state = stateWithTraits();
    const before = state.progression.genetics.originalLineageId;
    const result = inheritTraits(state, 4);
    expect(result.originalLineageId).toBe(before);
  });

  it('PRESERVES availableTraits verbatim', () => {
    const state = stateWithTraits();
    const result = inheritTraits(state, 4);
    expect(result.availableTraits).toEqual(
      state.progression.genetics.availableTraits,
    );
  });

  it('returns an empty activeTraits array when the lineage has none', () => {
    const state = freshState();
    const result = inheritTraits(state, 2);
    expect(result.activeTraits).toEqual([]);
    expect(result.originalLineageId).toBe(
      state.progression.genetics.originalLineageId,
    );
  });

  it('does NOT mutate its input (freeze test)', () => {
    const state = deepFreeze(structuredClone(stateWithTraits()));
    expect(() => inheritTraits(state, 2)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// getActiveTraitEffects
// ---------------------------------------------------------------------------

describe('getActiveTraitEffects', () => {
  it('returns a map of traitId → {benefit, tradeOff, magnitude} for active traits', () => {
    const state = stateWithTraits();
    const map = getActiveTraitEffects(state);
    // rapid-growth + large-foliage are active; deep-roots is deactivated.
    expect(Object.keys(map).sort()).toEqual(
      [RAPID_GROWTH.id, LARGE_FOLIAGE.id].sort(),
    );
    const rapid = map[RAPID_GROWTH.id]!;
    expect(rapid.benefit).toBe(RAPID_GROWTH.benefit);
    expect(rapid.tradeOff).toBe(RAPID_GROWTH.tradeOff);
    expect(rapid.magnitude).toBe(0.75);
  });

  it('excludes deactivated traits', () => {
    const state = stateWithTraits();
    const map = getActiveTraitEffects(state);
    expect(map[DEEP_ROOTS.id]).toBeUndefined();
  });

  it('returns an empty map when no traits are active', () => {
    const state = freshState();
    expect(getActiveTraitEffects(state)).toEqual({});
  });

  it('skips unknown trait ids defensively', () => {
    const state = freshState();
    const withUnknown: GameState = {
      ...state,
      progression: {
        ...state.progression,
        genetics: {
          ...state.progression.genetics,
          activeTraits: [
            { traitId: 'trait:does-not-exist', active: true, generation: 1, magnitude: 0.5 },
          ],
        },
      },
    };
    expect(getActiveTraitEffects(withUnknown)).toEqual({});
  });

  it('does NOT mutate its input (freeze test)', () => {
    const state = deepFreeze(structuredClone(stateWithTraits()));
    expect(() => getActiveTraitEffects(state)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// PROVISIONAL_TRAIT_MAGNITUDE_DEFAULT sanity (used by activate-trait)
// ---------------------------------------------------------------------------

describe('PROVISIONAL_TRAIT_MAGNITUDE_DEFAULT', () => {
  it('is in [0,1] (sanity — the activate-trait default magnitude)', () => {
    expect(PROVISIONAL_TRAIT_MAGNITUDE_DEFAULT).toBeGreaterThanOrEqual(0);
    expect(PROVISIONAL_TRAIT_MAGNITUDE_DEFAULT).toBeLessThanOrEqual(1);
  });
});
