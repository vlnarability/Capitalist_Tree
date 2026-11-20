/**
 * Tests for the `plant-seed` action (GAP-19 / GDD §11.2 — Genetic Legacy: the
 * seed production → planting loop).
 *
 * The BiologySystem's seed production (`seed-dispersed`, fed by
 * `alloc.reproduction`, gated on the fruiting age) is tested in
 * `reproduction.test.ts`. These tests cover the planting half: consuming a seed
 * → crediting genetic-legacy points (the prestige currency that funds
 * `unlock-research`).
 *
 * Covers:
 *   - Consumes one seed + credits PROGRESSION_LEGACY_POINTS_PER_SEED + emits
 *     `seed-planted` with the right payload.
 *   - Stacks: planting multiple seeds accumulates the balance.
 *   - Throws `InsufficientSeedsError` when the tree has no seeds.
 *   - Throws on an unknown treeId.
 *   - Pure: the input state is not mutated.
 *   - A dead tree's stored seeds remain plantable (the genetic legacy persists).
 */
import { describe, it, expect } from 'vitest';
import { engine } from '../src/index.js';
import { DEFAULT_GAME_CONFIG } from '../src/initial-state.js';
import { PROVISIONAL_PROGRESSION_LEGACY_POINTS_PER_SEED } from '@capitalist-tree/shared';
import type { GameConfig, GameState } from '@capitalist-tree/shared';
import { InsufficientSeedsError } from '../src/progression/errors.js';

function cfg(seed: number): GameConfig {
  return { ...DEFAULT_GAME_CONFIG, seed, createdAt: 0 };
}

/** A state with a tree carrying `seeds` seeds + a starting genetic-legacy balance. */
function stateWithSeeds(seeds: number, legacyPoints = '0', seed = 42): GameState {
  const s = engine.initialize(cfg(seed));
  return {
    ...s,
    originalTree: { ...s.originalTree, seeds },
    progression: {
      ...s.progression,
      prestige: { ...s.progression.prestige, geneticLegacyPoints: legacyPoints },
    },
  };
}

const PLANT = (tick: number) => ({
  type: 'plant-seed' as const,
  payload: { treeId: 'original', tick },
});

describe('plant-seed action (GAP-19 / GDD §11.2 Genetic Legacy)', () => {
  it('consumes a seed + credits genetic-legacy points + emits seed-planted', () => {
    const s = stateWithSeeds(3, '0');
    const r = engine.executeAction(s, PLANT(100));
    expect(r.state.originalTree.seeds).toBe(2);
    expect(r.state.progression.prestige.geneticLegacyPoints).toBe(
      String(PROVISIONAL_PROGRESSION_LEGACY_POINTS_PER_SEED),
    );
    const ev = r.events.find((e) => e.type === 'seed-planted');
    expect(ev).toBeDefined();
    if (ev?.type === 'seed-planted') {
      expect(ev.payload.treeId).toBe('original');
      expect(ev.at).toBe(100);
      expect(ev.payload.seedsConsumed).toBe(1);
      expect(ev.payload.seedsRemaining).toBe(2);
      expect(ev.payload.legacyPointsGained).toBe(PROVISIONAL_PROGRESSION_LEGACY_POINTS_PER_SEED);
      expect(ev.payload.geneticLegacyPointsAfter).toBe(
        String(PROVISIONAL_PROGRESSION_LEGACY_POINTS_PER_SEED),
      );
    }
  });

  it('stacks: planting multiple seeds accumulates the genetic-legacy balance', () => {
    let s = stateWithSeeds(3, '5');
    s = engine.executeAction(s, PLANT(100)).state;
    expect(s.originalTree.seeds).toBe(2);
    expect(s.progression.prestige.geneticLegacyPoints).toBe('6');
    s = engine.executeAction(s, PLANT(200)).state;
    expect(s.originalTree.seeds).toBe(1);
    expect(s.progression.prestige.geneticLegacyPoints).toBe('7');
  });

  it('throws InsufficientSeedsError when the tree has no seeds', () => {
    const s = stateWithSeeds(0, '0');
    expect(() => engine.executeAction(s, PLANT(100))).toThrow(InsufficientSeedsError);
    // The error carries the tree id + the (zero) seeds available.
    try {
      engine.executeAction(s, PLANT(100));
    } catch (e) {
      expect(e).toBeInstanceOf(InsufficientSeedsError);
      expect((e as InsufficientSeedsError).treeId).toBe('original');
      expect((e as InsufficientSeedsError).seedsAvailable).toBe(0);
    }
  });

  it('throws on an unknown treeId (P1: only the original tree)', () => {
    const s = stateWithSeeds(3, '0');
    expect(() =>
      engine.executeAction(s, { type: 'plant-seed', payload: { treeId: 'wrong', tick: 100 } }),
    ).toThrow(/plant-seed: unknown treeId/);
  });

  it('does not mutate the input state (pure)', () => {
    const s = stateWithSeeds(3, '0');
    engine.executeAction(s, PLANT(100));
    expect(s.originalTree.seeds).toBe(3); // unchanged
    expect(s.progression.prestige.geneticLegacyPoints).toBe('0'); // unchanged
  });

  it("a dead tree's stored seeds remain plantable (the genetic legacy persists after death)", () => {
    const s = stateWithSeeds(2, '0');
    const dead: GameState = { ...s, originalTree: { ...s.originalTree, alive: false } };
    const r = engine.executeAction(dead, PLANT(100));
    expect(r.state.originalTree.seeds).toBe(1);
    expect(r.state.progression.prestige.geneticLegacyPoints).toBe(
      String(PROVISIONAL_PROGRESSION_LEGACY_POINTS_PER_SEED),
    );
    expect(r.events.some((e) => e.type === 'seed-planted')).toBe(true);
  });

  it('drains all seeds: planting repeatedly down to 0, then the next throws', () => {
    let s = stateWithSeeds(2, '0');
    s = engine.executeAction(s, PLANT(100)).state;
    expect(s.originalTree.seeds).toBe(1);
    s = engine.executeAction(s, PLANT(200)).state;
    expect(s.originalTree.seeds).toBe(0);
    expect(s.progression.prestige.geneticLegacyPoints).toBe(
      String(PROVISIONAL_PROGRESSION_LEGACY_POINTS_PER_SEED * 2),
    );
    // The tree is now out of seeds — the next plant throws.
    expect(() => engine.executeAction(s, PLANT(300))).toThrow(InsufficientSeedsError);
  });
});
