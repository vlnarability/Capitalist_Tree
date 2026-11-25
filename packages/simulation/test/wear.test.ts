/**
 * P12-C redesign — cumulative "wear" mortality path (chronic neglect).
 *
 * The wear counter (tree.wear) monotonically accumulates non-weather damage
 * severity (pest/disease/severe-defoliation × WEAR_PER_DAMAGE). When it crosses
 * PROVISIONAL_BIOLOGY_WEAR_MORTALITY_ONSET, the mortality probability ramps
 * linearly to DEATH_DAILY_PROBABILITY at WEAR_DEATH_THRESHOLD. This is the
 * chronic-neglect death — robust against the activeDamage prune-window
 * fluctuation + Poisson variance that made the stress-based neglect death
 * fragile near the recovery threshold.
 */
import { describe, it, expect } from 'vitest';
import { engine, DEFAULT_GAME_CONFIG } from '../src/index.js';
import { checkMortality } from '../src/biology/death.js';
import { Rng } from '../src/rng.js';
import { testTree, testContext } from './_biology-helpers.js';
import type { BiologyContext } from '../src/biology/types.js';

const DAY = 86400;

describe('P12-C redesign — wear mortality path', () => {
  it('a tree with wear above the onset dies via the wear path (cause: "wear")', () => {
    // Wear above the mortality onset (3.0) → wearOverage ramps the daily
    // probability toward DEATH_DAILY_PROBABILITY (0.05/day) at the threshold
    // (6.0). The tree-died event must record the wear cause (not reserves/
    // stress/defoliation).
    //
    // W80 (2026-11-25): call checkMortality DIRECTLY with stepDays=30 (one
    // 30-day step) instead of engine.advance (which runs 1-day steps). With the
    // W78 hybrid wear recovery, a 1-day-step integration test is unreliable:
    // the fast recovery (max(flat 0.04, wear×0.10) per day) brings wear below
    // the onset before the probabilistic death (max 0.05/day → P=0.79 over 30
    // days) reliably fires — correct behavior (a cared-for tree shouldn't die
    // from wear). Calling checkMortality directly with stepDays=30 makes the
    // probability 0.05×30 = 1.5 > 1 → death is CERTAIN — isolating the mortality
    // PATH test from the recovery. The tree has high reserves + low stress + no
    // defoliations so only the wear path (path 4) can fire.
    const tree = testTree({
      wear: 6.0, // at the threshold → wearOverage = 1.0 → max probability
      water: { stored: 50, capacity: 50 },
      energy: { reserves: 800, production: 0, consumption: 0 },
      stress: 0,
      damage: [],
    });
    const ctx = testContext({ stepSeconds: DAY * 30 }) as BiologyContext; // stepDays=30
    const rng = Rng.fromSeed(42);
    const r = checkMortality(tree, ctx, rng);
    expect(r.died).toBe(true);
    expect(r.cause).toBe('wear');
  });

  it('a tree with wear below the onset does NOT die via the wear path', () => {
    // Wear below the onset (3.0) → wearOverage = 0 → no wear mortality. Advance
    // 10 days; the tree should still be alive (reserves high, no deficits at
    // day 0+10) + no wear-cause death event.
    const s = engine.initialize({ ...DEFAULT_GAME_CONFIG, seed: 42, createdAt: 0 });
    const state = { ...s, originalTree: { ...s.originalTree, wear: 1.0 } };
    const r: any = engine.advance(state, DAY * 10);
    expect(r.state.originalTree.alive).toBe(true);
    const wearDied = r.events.some(
      (e: any) => e.type === 'tree-died' && e.payload?.cause === 'wear',
    );
    expect(wearDied).toBe(false);
  });

  it('the wear counter is initialized to 0 + increments from infestation damage', () => {
    // Fresh tree: wear = 0.
    const s = engine.initialize({ ...DEFAULT_GAME_CONFIG, seed: 42, createdAt: 0 });
    expect(s.originalTree.wear).toBe(0);
    // After 60 idle days, infestations fire (~0.035/day × 60 ≈ 2.1 expected) +
    // each increments wear by severity × WEAR_PER_DAMAGE. wear > 0.
    const r: any = engine.advance(s, 60 * DAY);
    expect(r.state.originalTree.wear).toBeGreaterThan(0);
  });
});
