/**
 * BiologySystem integration tests (TDD §18.2).
 *
 * Tests the full BiologySystem pipeline: engine.advance drives the system
 * through multiple steps, asserting the integration scenarios from GDD §5:
 *
 *   - Mature tree survives one near-total defoliation but suffers on repeats.
 *   - Reserves decline when maintenance > production.
 *   - Tree death persists (alive:false stays).
 *   - Repeated defoliation raises mortality.
 *   - Tree responds to seasons (deciduous budding/senescence).
 *   - Harvesting reduces foliage and production.
 *   - Currency issuance is queued (P3 will drain).
 */
import { describe, it, expect } from 'vitest';
import { engine } from '../src/index.js';
import { DEFAULT_GAME_CONFIG } from '../src/initial-state.js';
import type { GameState, GameConfig } from '@capitalist-tree/shared';
import { PROVISIONAL_SIMULATION_STEP_SECONDS as STEP } from '@capitalist-tree/shared';
import { WHITE_OAK } from '@capitalist-tree/content';
import { SECONDS_PER_DAY } from '../src/systems/time-system.js';

function cfg(seed: number): GameConfig {
  return { ...DEFAULT_GAME_CONFIG, seed, createdAt: 0 };
}

/** Set the tree to a mature state for testing (high biomass, full canopy). */
function makeMature(state: GameState): GameState {
  const next = structuredClone(state);
  const tree = next.originalTree;
  tree.ageDays = WHITE_OAK.matureAgeDays + 1000; // well past maturity
  tree.structure.height = WHITE_OAK.maximumHeight * 0.95;
  tree.structure.trunkDiameter = WHITE_OAK.maximumTrunkDiameter * 0.95;
  tree.structure.branchDevelopment = WHITE_OAK.maximumBranchDevelopment * 0.95;
  tree.foliage.leafCapacity = 5000; // mature capacity
  tree.foliage.currentLeaves = 5000;
  tree.foliage.seasonalCondition = 1;
  tree.energy.reserves = 10000; // ample reserves
  tree.water.stored = 200;
  tree.water.capacity = 500;
  tree.nutrients = { nitrogen: 50, phosphorus: 20, potassium: 40 };
  tree.roots.development = 0.9;
  tree.roots.absorptionCapacity = 0.9;
  tree.stress = 0;
  tree.damage = [];
  tree.alive = true;
  // Move clock to midsummer for full canopy.
  next.clock.day = 60; // mid-summer (PROVISIONAL_DAYS_PER_SEASON=30 → day 60 is summer)
  next.clock.season = 'summer';
  next.clock.timeOfDay = 0.5;
  next.clock.elapsedSeconds = next.clock.day * SECONDS_PER_DAY;
  return next;
}

/** Helper to set the tree's clock to a specific day/season. */
function setDay(state: GameState, day: number): GameState {
  const next = structuredClone(state);
  next.clock.day = day;
  next.clock.elapsedSeconds = day * SECONDS_PER_DAY;
  // season derived the same way TimeSystem does
  const dayOfYear = day % 120;
  const idx = Math.min(Math.floor(dayOfYear / 30), 3);
  const seasons = ['spring', 'summer', 'autumn', 'winter'] as const;
  next.clock.season = seasons[idx] ?? 'spring';
  next.clock.timeOfDay = 0.5;
  return next;
}

describe('BiologySystem — basic integration', () => {
  it('runs without errors on a fresh sapling', () => {
    const s = engine.initialize(cfg(42));
    const r = engine.advance(s, 10 * STEP);
    expect(r.state.originalTree.alive).toBe(true);
  });

  it('recomputes health each tick (derived, not stored)', () => {
    // P0 left health at 1.0 placeholder. P1's BiologySystem recomputes it from
    // underlying factors. After one step, health should be < 1.0 (sapling has
    // limited reserves, no foliage yet).
    const s = engine.initialize(cfg(42));
    const r = engine.advance(s, STEP);
    expect(r.state.originalTree.health).toBeLessThan(1);
    expect(r.state.originalTree.health).toBeGreaterThan(0);
  });

  it('sapling survives spring budding (foliage grows)', () => {
    const s = engine.initialize(cfg(42));
    // Advance ~10 spring days. Sapling should produce some leaves.
    const r = engine.advance(s, 10 * SECONDS_PER_DAY);
    expect(r.state.originalTree.foliage.currentLeaves).toBeGreaterThan(0);
    expect(r.state.originalTree.alive).toBe(true);
  });
});

describe('BiologySystem — deciduous seasonal behavior', () => {
  it('deciduous tree loses leaves in autumn and regrows in spring', () => {
    let s = engine.initialize(cfg(42));
    // Skip ahead to mid-summer (full canopy) by jumping the clock first.
    s = makeMature(s);
    // Verify summer has foliage.
    s = engine.advance(s, STEP).state;
    expect(s.originalTree.foliage.currentLeaves).toBeGreaterThan(1000);

    // Advance to winter (day 90 = start of winter in 120-day year).
    s = setDay(s, 90);
    s = engine.advance(s, 30 * SECONDS_PER_DAY).state;
    // Winter: deciduous trees drop leaves. seasonalCondition approaches 0.
    expect(s.originalTree.foliage.seasonalCondition).toBeLessThan(0.5);
    expect(s.originalTree.foliage.currentLeaves).toBeLessThan(1000);

    // Advance to spring (day 120 wraps to day 0 of next year).
    s = setDay(s, 120);
    s = engine.advance(s, 30 * SECONDS_PER_DAY).state;
    expect(s.originalTree.foliage.seasonalCondition).toBeGreaterThan(0.3);
  });
});

describe('BiologySystem — reserves and maintenance', () => {
  it('reserves decline when maintenance exceeds production', () => {
    // Set up a big-biomass tree with very few leaves → maintenance > production.
    const s0 = engine.initialize(cfg(42));
    const s = makeMature(s0);
    // Strip almost all leaves — production collapses, maintenance stays high.
    s.originalTree.foliage.currentLeaves = 10;
    const initialReserves = s.originalTree.energy.reserves;
    const r = engine.advance(s, 5 * SECONDS_PER_DAY);
    expect(r.state.originalTree.energy.reserves).toBeLessThan(initialReserves);
  });

  it('reserves recover when production exceeds maintenance', () => {
    const s0 = engine.initialize(cfg(42));
    const s = makeMature(s0);
    s.originalTree.energy.reserves = 100; // low starting reserves
    const r = engine.advance(s, 5 * SECONDS_PER_DAY);
    expect(r.state.originalTree.energy.reserves).toBeGreaterThan(100);
  });
});

describe('BiologySystem — harvest action integration', () => {
  it('harvest-leaves reduces foliage and queues currency issuance', () => {
    const s = engine.initialize(cfg(42));
    const mature = makeMature(s);
    const r = engine.executeAction(mature, {
      type: 'harvest-leaves',
      payload: { treeId: 'original', requestedLeaves: 500 },
    });
    const tree = r.state.originalTree;
    expect(tree.foliage.currentLeaves).toBeLessThan(mature.originalTree.foliage.currentLeaves);
    // Currency issuance is queued (P3 drains it later).
    expect(tree.pendingIssuances.length).toBe(1);
    const issuance = tree.pendingIssuances[0]!;
    expect(BigInt(issuance.amount)).toBe(BigInt(500) * BigInt(WHITE_OAK.leafDenominationMinor));

    // A harvest-completed event was emitted carrying the HarvestResult.
    const harvestEvent = r.events.find((e) => e.type === 'harvest-completed');
    expect(harvestEvent).toBeDefined();
    if (harvestEvent && harvestEvent.type === 'harvest-completed') {
      expect(harvestEvent.payload.result.leavesHarvested).toBe(500);
      expect(harvestEvent.payload.result.currencyIssuance.amount).toBe(issuance.amount);
    }
  });

  it('harvest cannot exceed species.maximumHarvestFraction', () => {
    const s = engine.initialize(cfg(42));
    const mature = makeMature(s);
    const before = mature.originalTree.foliage.currentLeaves;
    const r = engine.executeAction(mature, {
      type: 'harvest-leaves',
      payload: { treeId: 'original', requestedLeaves: 100000 },
    });
    const after = r.state.originalTree.foliage.currentLeaves;
    const harvested = before - after;
    const maxAllowed = Math.floor(before * WHITE_OAK.maximumHarvestFraction);
    expect(harvested).toBeLessThanOrEqual(maxAllowed);
  });

  it('harvesting induces stress', () => {
    const s = engine.initialize(cfg(42));
    const mature = makeMature(s);
    const stressBefore = mature.originalTree.stress;
    const r = engine.executeAction(mature, {
      type: 'harvest-leaves',
      payload: { treeId: 'original', requestedLeaves: 2500 },
    });
    expect(r.state.originalTree.stress).toBeGreaterThan(stressBefore);
  });

  it('severe defoliation (>=50%) records a damage entry', () => {
    const s = engine.initialize(cfg(42));
    const mature = makeMature(s);
    const before = mature.originalTree.foliage.currentLeaves;
    const r = engine.executeAction(mature, {
      type: 'harvest-leaves',
      payload: { treeId: 'original', requestedLeaves: Math.floor(before * 0.5) },
    });
    expect(r.state.originalTree.damage.length).toBeGreaterThan(0);
    const severe = r.state.originalTree.damage.find((d) => d.type === 'severe-defoliation');
    expect(severe).toBeDefined();
  });

  it('harvest-completed + defoliation events are both emitted for severe harvests', () => {
    const s = engine.initialize(cfg(42));
    const mature = makeMature(s);
    const before = mature.originalTree.foliage.currentLeaves;
    const r = engine.executeAction(mature, {
      type: 'harvest-leaves',
      payload: { treeId: 'original', requestedLeaves: Math.floor(before * 0.5) },
    });
    const types = r.events.map((e) => e.type);
    expect(types).toContain('harvest-completed');
    expect(types).toContain('defoliation');
  });
});

describe('BiologySystem — tree death persists (GDD §5.6)', () => {
  it('once alive=false, the tree stays dead across ticks', () => {
    const s0 = engine.initialize(cfg(42));
    const s = makeMature(s0);
    s.originalTree.alive = false;
    s.originalTree.health = 0;
    s.originalTree.stress = 1;
    const r = engine.advance(s, 10 * SECONDS_PER_DAY);
    expect(r.state.originalTree.alive).toBe(false);
    expect(r.state.originalTree.health).toBe(0);
  });

  it('a dead tree does not photosynthesize or grow', () => {
    const s0 = engine.initialize(cfg(42));
    const s = makeMature(s0);
    s.originalTree.alive = false;
    s.originalTree.foliage.currentLeaves = 0;
    s.originalTree.structure.height = 5;
    const r = engine.advance(s, 5 * SECONDS_PER_DAY);
    expect(r.state.originalTree.foliage.currentLeaves).toBe(0);
    // Structure unchanged (no growth for dead trees).
    expect(r.state.originalTree.structure.height).toBe(5);
  });
});

describe('BiologySystem — mature tree survives one near-total defoliation', () => {
  it('mature tree survives a single 50% harvest (reserves cushion it)', () => {
    const s0 = engine.initialize(cfg(42));
    let s = makeMature(s0);
    // Harvest 50% of leaves.
    const r = engine.executeAction(s, {
      type: 'harvest-leaves',
      payload: { treeId: 'original', requestedLeaves: 2500 },
    });
    s = r.state;
    expect(s.originalTree.alive).toBe(true);
    // Advance 30 days — tree should recover some foliage via spring budding.
    s = engine.advance(s, 30 * SECONDS_PER_DAY).state;
    // Tree should still be alive (reserves cushioned the defoliation).
    expect(s.originalTree.alive).toBe(true);
    // Some recovery of foliage (spring/summer budding).
    expect(s.originalTree.foliage.currentLeaves).toBeGreaterThan(0);
  });

  it('repeated severe defoliation eventually kills the tree', () => {
    const s0 = engine.initialize(cfg(42));
    let s = makeMature(s0);
    // Harvest 50% repeatedly, advancing time between harvests.
    let aliveTicks = 0;
    for (let i = 0; i < 8; i++) {
      if (!s.originalTree.alive) break;
      const r = engine.executeAction(s, {
        type: 'harvest-leaves',
        payload: { treeId: 'original', requestedLeaves: 100000 }, // capped by fraction
      });
      s = r.state;
      if (!s.originalTree.alive) break;
      // Advance ~7 days between harvests.
      s = engine.advance(s, 7 * SECONDS_PER_DAY).state;
      aliveTicks++;
    }
    // The tree should have died after several severe defoliations.
    expect(s.originalTree.alive).toBe(false);
    // We should have survived at least one harvest (mature tree survives one).
    expect(aliveTicks).toBeGreaterThanOrEqual(1);
  });
});

describe('BiologySystem — determinism', () => {
  it('same seed + same actions → same final state', () => {
    const a0 = engine.initialize(cfg(7));
    const a1 = engine.advance(a0, 100 * STEP);
    const a2 = engine.executeAction(a1.state, {
      type: 'harvest-leaves',
      payload: { treeId: 'original', requestedLeaves: 5 },
    });

    const b0 = engine.initialize(cfg(7));
    const b1 = engine.advance(b0, 100 * STEP);
    const b2 = engine.executeAction(b1.state, {
      type: 'harvest-leaves',
      payload: { treeId: 'original', requestedLeaves: 5 },
    });

    expect(a2.state).toEqual(b2.state);
    expect(a2.events.map((e) => e.type)).toEqual(b2.events.map((e) => e.type));
  });
});

describe('BiologySystem — pure non-mutation (TDD §4.1)', () => {
  it('engine.advance does not mutate the input state', () => {
    const s = engine.initialize(cfg(13));
    const snapshot = structuredClone(s);
    engine.advance(s, 100 * STEP);
    expect(s).toEqual(snapshot);
  });

  it('executeAction harvest-leaves does not mutate the input state', () => {
    const s0 = engine.initialize(cfg(13));
    const s = makeMature(s0);
    const snapshot = structuredClone(s);
    engine.executeAction(s, {
      type: 'harvest-leaves',
      payload: { treeId: 'original', requestedLeaves: 100 },
    });
    expect(s).toEqual(snapshot);
  });
});

describe('BiologySystem — invariants across long runs', () => {
  it('no negative leaf counts over 1000 steps', () => {
    const s = engine.initialize(cfg(99));
    const r = engine.advance(s, 1000 * STEP);
    expect(r.state.originalTree.foliage.currentLeaves).toBeGreaterThanOrEqual(0);
  });

  it('no negative reserves over 1000 steps', () => {
    const s = engine.initialize(cfg(99));
    const r = engine.advance(s, 1000 * STEP);
    expect(r.state.originalTree.energy.reserves).toBeGreaterThanOrEqual(0);
  });

  it('health stays in [0, 1] over 1000 steps', () => {
    const s = engine.initialize(cfg(99));
    const r = engine.advance(s, 1000 * STEP);
    const h = r.state.originalTree.health;
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(1);
  });

  it('stress stays in [0, 1] over 1000 steps', () => {
    const s = engine.initialize(cfg(99));
    const r = engine.advance(s, 1000 * STEP);
    const stress = r.state.originalTree.stress;
    expect(stress).toBeGreaterThanOrEqual(0);
    expect(stress).toBeLessThanOrEqual(1);
  });

  it('structure never exceeds species maxima over 1000 steps', () => {
    const s = engine.initialize(cfg(99));
    const r = engine.advance(s, 1000 * STEP);
    const t = r.state.originalTree;
    expect(t.structure.height).toBeLessThanOrEqual(WHITE_OAK.maximumHeight);
    expect(t.structure.trunkDiameter).toBeLessThanOrEqual(WHITE_OAK.maximumTrunkDiameter);
    expect(t.structure.branchDevelopment).toBeLessThanOrEqual(WHITE_OAK.maximumBranchDevelopment);
  });
});
