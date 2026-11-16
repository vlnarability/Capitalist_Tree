/**
 * P10c end-game objectives tests (GDD §12 Player Objectives and Endings, lines
 * 723-747; TDD Milestone 9: Global objectives). Asserts:
 *   - All 6 objectives are evaluated (present in the map).
 *   - Each objective evaluates achieved=true under its GDD §12 condition:
 *     Wealthiest-Being (cash + influence), Great-Restoration (bio/forest/
 *     resilience > 0.8), Last-Tree (destruction < 0.2 + high extraction),
 *     Natural-Balance (financial security + resilience), Industrial-Empire
 *     (all 6 supply-chain levels), Generational-Legacy (>= 3 generations).
 *   - Objectives are tracked INDEPENDENTLY (achieving one does not force
 *     another).
 *   - Progress is in [0, 1].
 *   - diffObjectives surfaces false→true flips (emit-on-first-achievement).
 */
import { describe, it, expect } from 'vitest';
import { engine } from '../src/index.js';
import {
  evaluateObjectives,
  diffObjectives,
  OBJECTIVE_IDS,
  OBJECTIVE_CONSTANTS,
  seedDefaultRegions,
  type ObjectiveMap,
} from '../src/index.js';
import { DEFAULT_GAME_CONFIG } from '../src/initial-state.js';
import type { GameState, GameConfig } from '@capitalist-tree/shared';

function cfg(seed: number): GameConfig {
  return { ...DEFAULT_GAME_CONFIG, seed };
}
function freshState(seed = 42): GameState {
  return seedDefaultRegions(engine.initialize(cfg(seed)));
}

/** Overwrite the aggregated indicators (shallow helper for tests). */
function withIndicators(state: GameState, patch: Partial<GameState['eventState']['global']['aggregatedIndicators']>): GameState {
  return {
    ...state,
    eventState: {
      ...state.eventState,
      global: {
        ...state.eventState.global,
        aggregatedIndicators: { ...state.eventState.global.aggregatedIndicators, ...patch },
      },
    },
  };
}

describe('P10c objectives — surface + shape', () => {
  it('evaluates all 6 GDD §12 objectives (present in the map)', () => {
    const map = evaluateObjectives(freshState());
    for (const id of OBJECTIVE_IDS) {
      expect(map[id]).toBeDefined();
      expect(typeof map[id].achieved).toBe('boolean');
      expect(map[id].progress).toBeGreaterThanOrEqual(0);
      expect(map[id].progress).toBeLessThanOrEqual(1);
      expect(map[id].description.length).toBeGreaterThan(0);
    }
    expect(OBJECTIVE_IDS.length).toBe(6);
  });

  it('is read-only — does not mutate the input state', () => {
    const base = freshState();
    const snapshot = JSON.stringify(base);
    evaluateObjectives(base);
    expect(JSON.stringify(base)).toBe(snapshot);
  });
});

describe('P10c objectives — per-objective achievement (GDD §12)', () => {
  it('Wealthiest-Being: cash >= threshold + market-index influence', () => {
    const base = freshState();
    const cash = String(OBJECTIVE_CONSTANTS.PROVISIONAL_WEALTHIEST_BEING_CASH_MINOR);
    const influenced: GameState = {
      ...base,
      player: { ...base.player, personalCash: cash },
      eventState: {
        ...base.eventState,
        global: {
          ...base.eventState.global,
          globalMarketIndices: { 'index:commodity-basket': 130 },
        },
      },
    };
    const map = evaluateObjectives(influenced);
    expect(map['wealthiest-being'].achieved).toBe(true);
  });

  it('Great-Restoration: biodiversity + forestCoverage + resilience > 0.8', () => {
    const base = freshState();
    // Restore every region + the global indicators.
    const regions = base.eventState.global.regions.map((r) => ({
      ...r,
      biodiversity: 0.85,
      forestCoverage: 0.85,
      climate: { ...r.climate },
      pollution: { ...r.pollution },
    }));
    const restored: GameState = withIndicators(
      {
        ...base,
        eventState: { ...base.eventState, global: { ...base.eventState.global, regions } },
      },
      { avgBiodiversity: 0.85, avgForestCoverage: 0.85, ecosystemResilience: 0.85 },
    );
    const map = evaluateObjectives(restored);
    expect(map['great-restoration'].achieved).toBe(true);
  });

  it('Last-Tree: biodiversity + forestCoverage < 0.2 + high extraction', () => {
    const base = freshState();
    const destroyed: GameState = withIndicators(
      { ...base },
      { avgBiodiversity: 0.1, avgForestCoverage: 0.1 },
    );
    // High extraction — aggregate industrialActivity >= 0.6.
    const regions = destroyed.eventState.global.regions.map((r) => ({
      ...r,
      industrialActivity: 0.7,
      climate: { ...r.climate },
      pollution: { ...r.pollution },
    }));
    const state: GameState = {
      ...destroyed,
      eventState: { ...destroyed.eventState, global: { ...destroyed.eventState.global, regions } },
    };
    const map = evaluateObjectives(state);
    expect(map['last-tree'].achieved).toBe(true);
  });

  it('Natural-Balance: financial security + ecosystem resilience > 0.8', () => {
    const base = freshState();
    const balanced: GameState = withIndicators(
      { ...base, player: { ...base.player, financialSecurity: 0.85 } },
      { ecosystemResilience: 0.85 },
    );
    const map = evaluateObjectives(balanced);
    expect(map['natural-balance'].achieved).toBe(true);
  });

  it('Industrial-Empire: own businesses across all 6 supply-chain levels', () => {
    const base = freshState();
    // Six stub businesses, one per level (0-5).
    const businesses = [0, 1, 2, 3, 4, 5].map((level) => ({
      ...base.businesses[0]!,
      id: `biz-l${level}`,
      supplyChainLevel: level,
    }));
    const state: GameState = { ...base, businesses };
    const map = evaluateObjectives(state);
    expect(map['industrial-empire'].achieved).toBe(true);
  });

  it('Generational-Legacy: totalGenerations >= 3', () => {
    const base = freshState();
    const state: GameState = {
      ...base,
      progression: {
        ...base.progression,
        prestige: { ...base.progression.prestige, totalGenerations: 3 },
      },
    };
    const map = evaluateObjectives(state);
    expect(map['generational-legacy'].achieved).toBe(true);
  });
});

describe('P10c objectives — independence + emit-on-first-achievement', () => {
  it('objectives are tracked independently (achieving one does not force another)', () => {
    // Generational-Legacy achieved alone — should not imply Wealthiest-Being.
    const base = freshState();
    const state: GameState = {
      ...base,
      progression: {
        ...base.progression,
        prestige: { ...base.progression.prestige, totalGenerations: 3 },
      },
    };
    const map = evaluateObjectives(state);
    expect(map['generational-legacy'].achieved).toBe(true);
    expect(map['wealthiest-being'].achieved).toBe(false);
  });

  it('diffObjectives surfaces only false→true flips (emit-on-first-achievement)', () => {
    const before: ObjectiveMap = evaluateObjectives(freshState());
    // Achieve generational-legacy after.
    const base = freshState();
    const afterState: GameState = {
      ...base,
      progression: {
        ...base.progression,
        prestige: { ...base.progression.prestige, totalGenerations: 3 },
      },
    };
    const after = evaluateObjectives(afterState);
    const flipped = diffObjectives(before, after);
    expect(flipped).toContain('generational-legacy');
    // Only the newly-achieved ones.
    for (const id of flipped) {
      expect(before[id].achieved).toBe(false);
      expect(after[id].achieved).toBe(true);
    }
  });
});
