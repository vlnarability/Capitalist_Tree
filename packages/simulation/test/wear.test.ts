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

const DAY = 86400;

describe('P12-C redesign — wear mortality path', () => {
  it('a tree with wear at the threshold dies via the wear path (cause: "wear")', () => {
    // Wear well above the threshold (20.0 >> 6.0) → wearOverage capped at 1.0 →
    // probability = DEATH_DAILY_PROBABILITY (0.05/day). The tree should die
    // within ~30 days, + the tree-died event must record the wear cause (not
    // reserves/stress/defoliation).
    //
    // W78 (2026-11-25): wear is set to 20.0 (not 6.0) because the W78 hybrid
    // wear recovery (max(flat 0.04, wear×0.05) per day) now saves a cared-for
    // tree from wear=6.0 within ~15 days — correct behavior (a cared-for tree
    // shouldn't die from wear). At wear=20.0 the hybrid recovery (~1.0/day)
    // cannot bring wear below the onset (3.0) within 30 days (20×0.95^30 ≈ 4.3),
    // so the mortality path reliably fires. Reserves kept high so path 2
    // (reserves+stress) stays blocked + the death cause is "wear".
    const s = engine.initialize({ ...DEFAULT_GAME_CONFIG, seed: 42, createdAt: 0 });
    const state = {
      ...s,
      originalTree: {
        ...s.originalTree,
        wear: 20.0,
        energy: { ...s.originalTree.energy, reserves: 1000 },
      },
    };
    const r: any = engine.advance(state, DAY * 30);
    expect(r.state.originalTree.alive).toBe(false);
    const diedEvent = r.events.find((e: any) => e.type === 'tree-died');
    expect(diedEvent).toBeDefined();
    expect(diedEvent.payload.cause).toBe('wear');
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
