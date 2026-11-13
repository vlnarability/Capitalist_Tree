/**
 * Full prestige-reset tests (P9c — TDD §18.1, §18.4; GDD §11.3 Prestige,
 * §11.2 Genetic Legacy). Resolves P9b deferred item #1.
 *
 * Asserts the FULL play-state reset:
 *   - player.personalCash reset to starting amount; player baseline reset.
 *   - businesses / automation / inventory cleared.
 *   - world.environment reset to baseline.
 *   - economy re-seeded (markets at base price, accounts at starting cash,
 *     monetarySupply/totalIssued/totalSinks reset).
 *   - originalTree replanted as a sapling (age 0, alive, id='original',
 *     isOriginal=true, biology reset to species.initial).
 *   - originalLineageId preserved.
 *   - geneticLegacyPoints credited.
 *   - generationHistory entries correct (old finalized + new ongoing).
 *   - research fraction preserved.
 *   - activeTraits carried over (re-stamped to new generation, magnitude
 *     mutated but bounded).
 *   - clock / metadata / rngState / rngStreams / scheduler preserved.
 *   - unknown species throws.
 *   - Purity (freeze test).
 */
import { describe, it, expect } from 'vitest';
import {
  engine,
  applyPrestigeReset,
  computePrestigeEarned,
  unlockResearchNode,
  getUnlockedResearch,
} from '../src/index.js';
import { DEFAULT_GAME_CONFIG } from '../src/initial-state.js';
import {
  type GameState,
  type GameConfig,
  PROVISIONAL_PRESTIGE_GENERATION_MIN_DURATION_DAYS,
} from '@capitalist-tree/shared';
import {
  IMPROVED_PHOTOSYNTHESIS,
  ADVANCED_IRRIGATION,
  RAPID_GROWTH,
} from '@capitalist-tree/content';

const SECONDS_PER_DAY = 24 * 60 * 60;

function cfg(seed: number): GameConfig {
  return { ...DEFAULT_GAME_CONFIG, seed };
}

function freshState(seed = 42): GameState {
  return engine.initialize(cfg(seed));
}

function minDurationSeconds(): number {
  return PROVISIONAL_PRESTIGE_GENERATION_MIN_DURATION_DAYS * SECONDS_PER_DAY;
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

/** State with cash, businesses, automation, inventory, and a mutated tree. */
function stateWithPlayProgress(): GameState {
  const state = freshState();
  return {
    ...state,
    player: {
      ...state.player,
      personalCash: '9999999',
      unpaidDays: 30,
      happiness: 0.1,
    },
    originalTree: {
      ...state.originalTree,
      ageDays: 500,
      structure: {
        ...state.originalTree.structure,
        height: 999,
        trunkDiameter: 5,
      },
    },
    businesses: [
      {
        id: 'business:test',
        typeId: 'businessType:test',
        name: 'Test',
        status: 'operating',
        ownerId: 'player:personal',
        supplyChainLevel: 0,
        cashBalance: '0',
        assets: '0',
        liabilities: '0',
        employees: 0,
        wageRate: '0',
        lastOperatedAt: 0,
        lastValuationTick: 0,
        upstreamSupplierIds: [],
        downstreamCustomerIds: [],
        environmentalImpact: {
          landDisturbance: 0,
          waterUsage: 0,
          emissions: 0,
          pollution: 0,
        },
        marketParticipation: [],
        acquiredAt: 0,
        acquiredPrice: '0',
      } as GameState['businesses'][number],
    ],
    inventory: { items: [{ resourceId: 'water', quantity: 50 }] },
    automation: [
      {
        id: 'automation:test',
        type: 'irrigation',
        equipmentId: 'equipment:irrigation-basic',
        status: 'active',
        policy: 'manual',
        installedAt: 0,
        energyConsumption: 0,
      } as GameState['automation'][number],
    ],
  };
}

describe('applyPrestigeReset — full play-state reset', () => {
  it('resets player.personalCash to the starting amount + resets player baseline', () => {
    const state = stateWithPlayProgress();
    const result = applyPrestigeReset(state, 'species:white-oak', minDurationSeconds());
    expect(result.state.player.personalCash).toBe(DEFAULT_GAME_CONFIG.startingPersonalCash);
    expect(result.state.player.unpaidDays).toBe(0);
    expect(result.state.player.happiness).toBeCloseTo(0.7, 5);
  });

  it('clears businesses', () => {
    const state = stateWithPlayProgress();
    const result = applyPrestigeReset(state, 'species:white-oak', minDurationSeconds());
    expect(result.state.businesses).toEqual([]);
  });

  it('clears automation', () => {
    const state = stateWithPlayProgress();
    const result = applyPrestigeReset(state, 'species:white-oak', minDurationSeconds());
    expect(result.state.automation).toEqual([]);
  });

  it('clears inventory', () => {
    const state = stateWithPlayProgress();
    const result = applyPrestigeReset(state, 'species:white-oak', minDurationSeconds());
    expect(result.state.inventory.items).toEqual([]);
  });

  it('resets world.environment to the baseline (matches a fresh init)', () => {
    const state = stateWithPlayProgress();
    const fresh = freshState();
    const result = applyPrestigeReset(state, 'species:white-oak', minDurationSeconds());
    expect(result.state.world.environment).toEqual(fresh.world.environment);
  });

  it('re-seeds the economy (markets at base price, accounts at starting cash)', () => {
    const state = stateWithPlayProgress();
    const fresh = freshState();
    const result = applyPrestigeReset(state, 'species:white-oak', minDurationSeconds());
    expect(result.state.economy).toEqual(fresh.economy);
  });

  it('replants originalTree as a sapling (age 0, alive, id=original, isOriginal=true)', () => {
    const state = stateWithPlayProgress();
    const fresh = freshState();
    const result = applyPrestigeReset(state, 'species:white-oak', minDurationSeconds());
    const tree = result.state.originalTree;
    expect(tree.id).toBe('original');
    expect(tree.isOriginal).toBe(true);
    expect(tree.alive).toBe(true);
    expect(tree.ageDays).toBe(0);
    // Biology reset to species.initial (height matches the fresh sapling).
    expect(tree.structure.height).toBe(fresh.originalTree.structure.height);
    expect(tree.damage).toEqual([]);
    expect(tree.pendingIssuances).toEqual([]);
  });

  it('replants originalTree as a sapling of the new species', () => {
    const state = stateWithPlayProgress();
    const result = applyPrestigeReset(state, 'species:white-oak', minDurationSeconds());
    expect(result.state.originalTree.speciesId).toBe('species:white-oak');
  });

  it('PRESERVES originalLineageId (GDD §11.2)', () => {
    const state = stateWithPlayProgress();
    const before = state.progression.genetics.originalLineageId;
    const result = applyPrestigeReset(state, 'species:white-oak', minDurationSeconds());
    expect(result.state.progression.genetics.originalLineageId).toBe(before);
  });

  it('credits geneticLegacyPoints (balance grows by the earned amount)', () => {
    const state = freshState();
    const earned = computePrestigeEarned(state);
    const result = applyPrestigeReset(state, 'species:white-oak', minDurationSeconds());
    expect(result.state.progression.prestige.geneticLegacyPoints).toBe(earned.toString(10));
  });

  it('records generationHistory: old finalized + new ongoing', () => {
    const state = freshState();
    const tick = minDurationSeconds();
    const result = applyPrestigeReset(state, 'species:white-oak', tick);
    const history = result.state.progression.generationHistory;
    expect(history).toHaveLength(2);
    expect(history[0]!.generationNumber).toBe(1);
    expect(history[0]!.outcome).toBe('completed');
    expect(history[0]!.endDate).toBe(tick);
    expect(history[1]!.generationNumber).toBe(2);
    expect(history[1]!.outcome).toBe('ongoing');
    expect(history[1]!.endDate).toBeNull();
    expect(history[1]!.treeSpeciesId).toBe('species:white-oak');
    expect(history[1]!.startDate).toBe(tick);
  });

  it('preserves the PROVISIONAL fraction of unlocked research', () => {
    let state = freshState();
    // Give the player legacy points so the unlocks succeed.
    state = {
      ...state,
      progression: {
        ...state.progression,
        prestige: { ...state.progression.prestige, geneticLegacyPoints: '1000' },
      },
    };
    state = unlockResearchNode(state, IMPROVED_PHOTOSYNTHESIS.id, 100).state;
    state = unlockResearchNode(state, ADVANCED_IRRIGATION.id, 200).state;
    expect(getUnlockedResearch(state)).toHaveLength(2);
    const result = applyPrestigeReset(state, 'species:white-oak', minDurationSeconds());
    // floor(2 * 0.5) = 1 preserved.
    expect(getUnlockedResearch(result.state)).toHaveLength(1);
    expect(result.state.progression.research.nodes).toHaveLength(2);
  });

  it('carries activeTraits into the new generation (re-stamped + magnitude bounded)', () => {
    const state = stateWithPlayProgress();
    const withTraits: GameState = {
      ...state,
      progression: {
        ...state.progression,
        genetics: {
          ...state.progression.genetics,
          activeTraits: [
            { traitId: RAPID_GROWTH.id, active: true, generation: 1, magnitude: 0.75 },
          ],
        },
      },
    };
    const result = applyPrestigeReset(withTraits, 'species:white-oak', minDurationSeconds());
    const carried = result.state.progression.genetics.activeTraits;
    expect(carried).toHaveLength(1);
    expect(carried[0]!.traitId).toBe(RAPID_GROWTH.id);
    expect(carried[0]!.generation).toBe(2); // re-stamped to the new generation
    expect(carried[0]!.active).toBe(true);
    expect(carried[0]!.magnitude).toBeGreaterThanOrEqual(0);
    expect(carried[0]!.magnitude).toBeLessThanOrEqual(1);
  });

  it('PRESERVES availableTraits across the reset', () => {
    const state = freshState();
    const withAvail: GameState = {
      ...state,
      progression: {
        ...state.progression,
        genetics: {
          ...state.progression.genetics,
          availableTraits: ['trait:rapid-growth'],
        },
      },
    };
    const result = applyPrestigeReset(withAvail, 'species:white-oak', minDurationSeconds());
    expect(result.state.progression.genetics.availableTraits).toEqual(['trait:rapid-growth']);
  });

  it('PRESERVES clock / metadata / rngState / rngStreams / scheduler', () => {
    const state = stateWithPlayProgress();
    const result = applyPrestigeReset(state, 'species:white-oak', minDurationSeconds());
    expect(result.state.clock).toEqual(state.clock);
    expect(result.state.metadata).toEqual(state.metadata);
    expect(result.state.rngState).toEqual(state.rngState);
    expect(result.state.rngStreams).toEqual(state.rngStreams);
    expect(result.state.scheduler).toEqual(state.scheduler);
    expect(result.state.history).toEqual(state.history);
  });

  it('throws on an unknown species id (cannot replant an unregistered sapling)', () => {
    const state = freshState();
    expect(() =>
      applyPrestigeReset(state, 'species:does-not-exist', minDurationSeconds()),
    ).toThrow();
  });

  it('does NOT mutate its input (freeze test)', () => {
    const state = deepFreeze(structuredClone(stateWithPlayProgress()));
    expect(() =>
      applyPrestigeReset(state, 'species:white-oak', minDurationSeconds()),
    ).not.toThrow();
  });

  it('is deterministic — same (state, species, tick) → same result', () => {
    const s1 = stateWithPlayProgress();
    const s2 = stateWithPlayProgress();
    const tick = minDurationSeconds();
    const r1 = applyPrestigeReset(s1, 'species:white-oak', tick);
    const r2 = applyPrestigeReset(s2, 'species:white-oak', tick);
    expect(r2.state).toEqual(r1.state);
    expect(r2.event).toEqual(r1.event);
  });
});
