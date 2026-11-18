/**
 * Reproduction / seeding tests (GAP-19 / GDD §5.2, §11.2).
 *
 * The reproduction energy bucket (`alloc.reproduction`, weight 0.05 of surplus)
 * fills `tree.seedGrowthProgress` each biology tick. When it reaches 1.0 AND
 * the tree is past its fruiting age (`ageDays >= matureAgeDays ×
 * PROVISIONAL_BIOLOGY_REPRODUCTION_FRUITING_AGE_FRACTION`), the BiologySystem
 * emits `seed-dispersed`, increments `tree.seeds`, + resets the accumulator.
 *
 * Uses 1-day steps (STEP = 86_400, matching the design-promise bot) so the
 * per-step surplus is large enough to fill the accumulator in a tractable
 * number of advances. A full-canopy mature tree produces ~0.95 eu/step of
 * reproduction energy → ~0.003 progress/tick → ~300 ticks to a seed from 0,
 * ~3 from 0.99.
 */
import { describe, it, expect } from 'vitest';
import { engine } from '../src/index.js';
import { DEFAULT_GAME_CONFIG } from '../src/initial-state.js';
import {
  type GameState,
  type GameConfig,
  type TreeState,
  type SimulationEvent,
  PROVISIONAL_BIOLOGY_REPRODUCTION_FRUITING_AGE_FRACTION,
} from '@capitalist-tree/shared';
import { WHITE_OAK } from '@capitalist-tree/content';

const DAY = 86_400; // 1-day steps.

function cfg(seed: number): GameConfig {
  return { ...DEFAULT_GAME_CONFIG, seed, createdAt: 0 };
}

/** A mature, full-canopy, well-resourced tree past its fruiting gate, in sunny
 *  weather. Tree-field `overrides` applied last (e.g. ageDays, seedGrowthProgress). */
function matureTreeState(
  seed = 42,
  overrides: Partial<TreeState> = {},
): GameState {
  const s = engine.initialize(cfg(seed));
  const fruitingGate =
    WHITE_OAK.matureAgeDays * PROVISIONAL_BIOLOGY_REPRODUCTION_FRUITING_AGE_FRACTION;
  return {
    ...s,
    originalTree: {
      ...s.originalTree,
      ageDays: fruitingGate + 100, // past the gate
      foliage: { ...s.originalTree.foliage, currentLeaves: 5000, leafCapacity: 5000 },
      water: { ...s.originalTree.water, stored: 200, capacity: 200 },
      nutrients: { nitrogen: 50, phosphorus: 50, potassium: 50 },
      energy: { ...s.originalTree.energy, reserves: 500, production: 0, consumption: 0 },
      ...overrides,
    },
    world: {
      ...s.world,
      weather: { ...s.world.weather, condition: 'sunny', temperature: 22, intensity: 1 },
    },
  };
}

describe('reproduction / seeding (GAP-19)', () => {
  it('alloc.reproduction flows into seedGrowthProgress each tick (mature tree)', () => {
    const s = matureTreeState();
    expect(s.originalTree.seedGrowthProgress).toBe(0);
    expect(s.originalTree.seeds).toBe(0);

    const r = engine.advance(s, DAY);
    // The reproduction bucket filled the accumulator (the tree has surplus).
    expect(r.state.originalTree.seedGrowthProgress).toBeGreaterThan(0);
    // One tick's progress is far short of a full seed.
    expect(r.state.originalTree.seeds).toBe(0);
    expect(r.events.some((e) => e.type === 'seed-dispersed')).toBe(false);
  });

  it('a mature tree disperses a seed when seedGrowthProgress crosses 1.0', () => {
    // Start just below the threshold; a few ticks push it over.
    const s = matureTreeState(42, { seedGrowthProgress: 0.99, seeds: 0 });
    let state = s;
    let fired: SimulationEvent | undefined;
    for (let i = 0; i < 20 && !fired; i++) {
      const r = engine.advance(state, DAY);
      const ev = r.events.find((e) => e.type === 'seed-dispersed');
      if (ev) { fired = ev; }
      state = r.state;
    }
    expect(fired).toBeDefined();
    expect(state.originalTree.seeds).toBeGreaterThanOrEqual(1);
    if (fired?.type === 'seed-dispersed') {
      expect(fired.payload.treeId).toBe('original');
      expect(fired.payload.seedsProduced).toBeGreaterThanOrEqual(1);
      expect(fired.payload.seedsTotal).toBe(state.originalTree.seeds);
      // The accumulator reset to 0 on dispersal.
      expect(fired.payload.seedGrowthProgressAfter).toBe(0);
    }
  });

  it('a sapling (below the fruiting gate) accumulates progress but does NOT fruit', () => {
    // Same productive tree but ageDays = 0 (below the 2400-day gate), with
    // progress already at 0.99 so it WOULD fruit if not for the age gate.
    const s = matureTreeState(42, { ageDays: 0, seedGrowthProgress: 0.99, seeds: 0 });
    let state = s;
    for (let i = 0; i < 20; i++) {
      const r = engine.advance(state, DAY);
      expect(r.events.some((e) => e.type === 'seed-dispersed')).toBe(false);
      state = r.state;
    }
    expect(state.originalTree.seeds).toBe(0);
    // Progress accumulated + capped at 1.0 (waiting for maturity — the gate
    // blocks the reset, so it sits at the cap).
    expect(state.originalTree.seedGrowthProgress).toBeGreaterThanOrEqual(0.99);
    expect(state.originalTree.seedGrowthProgress).toBeLessThanOrEqual(1);
  });

  it('a dead tree does not reproduce', () => {
    const s = matureTreeState(42, { alive: false, seedGrowthProgress: 0.99, seeds: 0 });
    const r = engine.advance(s, DAY);
    expect(r.events.some((e) => e.type === 'seed-dispersed')).toBe(false);
    expect(r.state.originalTree.seeds).toBe(0);
  });

  it('deterministic: same state + advances → same seed count + progress', () => {
    const s = matureTreeState(7, { seedGrowthProgress: 0.95, seeds: 0 });
    function run(): { seeds: number; progress: number } {
      let st = s;
      for (let i = 0; i < 30; i++) st = engine.advance(st, DAY).state;
      return { seeds: st.originalTree.seeds, progress: st.originalTree.seedGrowthProgress };
    }
    const a = run();
    const b = run();
    expect(a.seeds).toBe(b.seeds);
    expect(a.progress).toBeCloseTo(b.progress, 10);
  });
});
