/**
 * Biodiversity rebalance regression tests (W43 — Finding 2 + Finding 5).
 *
 * Pre-W43 the auto-seeded default regions' industrialActivity (0.2-0.5) drove
 * pollution stress ~20× stronger than the 0.01 recovery term, collapsing
 * biodiversity 0.80→0.00 in 21 sim days with NO player action (the destruction
 * objective became trivially reachable + restoration impossible). W43:
 *   - lowers default IA to a pre-industrial baseline (0.01-0.02);
 *   - raises PROVISIONAL_EVENT_RECOVERY_RATE 0.01 → 0.03;
 *   - wires the biodiversity-enhancement + soil-restoration research nodes
 *     (previously description-only no-ops) into the EventSystem recovery term;
 *   - lowers the last-tree extraction threshold 0.6 → 0.4 (made unreachable
 *     by the lower background IA — the player can still clear it by driving
 *     the home region to IA ~0.8).
 *
 * These tests pin the corrected behaviour so a future tuning change can't
 * silently reintroduce the auto-collapse.
 */
import { describe, it, expect } from 'vitest';
import {
  engine,
  seedDefaultRegions,
  evolveRegions,
  aggregateGlobalIndicators,
} from '../src/index.js';
import type { GameState } from '../src/index.js';
import { DEFAULT_GAME_CONFIG } from '../src/initial-state.js';
import { aggregateResearchEffects } from '../src/progression/research-effects.js';
import { PROVISIONAL_SPECIES_EXTINCTION_THRESHOLD } from '@capitalist-tree/shared';
import type { GameConfig } from '@capitalist-tree/shared';

const SECONDS_PER_DAY = 24 * 60 * 60;
const DAY = SECONDS_PER_DAY;
const HOME_REGION = 'region:temperate-lowlands';

function cfg(seed: number): GameConfig {
  return { ...DEFAULT_GAME_CONFIG, seed };
}

/** Fresh GameState from a seed. */
function freshState(seed = 42): GameState {
  return engine.initialize(cfg(seed));
}

/** Region lookup by id (throws if missing — tests assume seeded regions). */
function regionById(state: GameState, id: string) {
  const r = state.eventState.global.regions.find((r) => r.id === id);
  if (!r) throw new Error(`region ${id} not found`);
  return r;
}

/** Population-weighted aggregate biodiversity (the objective-relevant value). */
function avgBiodiversity(state: GameState): number {
  return aggregateGlobalIndicators(state).state.eventState.global.aggregatedIndicators
    .avgBiodiversity;
}

/** A research-node unlock record matching ResearchNodeState (progression.ts). */
function unlockedNode(
  id: string,
  categoryId: 'environment' = 'environment',
): {
  id: string;
  categoryId: 'environment';
  unlocked: boolean;
  unlockedAt: number;
  prerequisites: string[];
  cost: string;
} {
  return {
    id,
    categoryId,
    unlocked: true,
    unlockedAt: 0,
    prerequisites: [],
    cost: '0',
  };
}

/** Inject an unlocked research node into a state (returns a new state). */
function withUnlockedResearch(state: GameState, nodeId: string): GameState {
  const nodes = state.progression.research.nodes;
  const exists = nodes.some((n) => n.id === nodeId);
  const nextNodes = exists
    ? nodes.map((n) => (n.id === nodeId ? { ...n, unlocked: true } : n))
    : [...nodes, unlockedNode(nodeId)];
  return {
    ...state,
    progression: {
      ...state.progression,
      research: { ...state.progression.research, nodes: nextNodes },
    },
  };
}

describe('W43 biodiversity rebalance', () => {
  it('does NOT auto-collapse biodiversity over 30 sim days with zero player action (Finding 2)', () => {
    // The core regression: pre-W43 biodiversity hit 0.00 within 21 days with
    // no player action. Post-W43 it must stabilise above the extinction
    // threshold. Run the FULL engine (all 12 systems, EventSystem seeds the
    // default regions on the first tick + evolves them every tick).
    let state = freshState(42);
    state = engine.advance(state, 30 * DAY).state;
    const bio = avgBiodiversity(state);
    // Above the extinction threshold (0.2) — no collapse.
    expect(bio).toBeGreaterThan(PROVISIONAL_SPECIES_EXTINCTION_THRESHOLD);
    // And not collapsed to near-zero.
    expect(bio).toBeGreaterThan(0.3);
  });

  it('aggregateResearchEffects returns the typed bonuses for an unlocked biodiversity-enhancement node (Finding 5)', () => {
    // Pre-W43 the node's effects were a description-only string no code read.
    // Post-W43 the aggregator resolves the node's typed bonuses.
    const state = withUnlockedResearch(seedDefaultRegions(freshState(42)), 'research:biodiversity-enhancement');
    const bonuses = aggregateResearchEffects(state);
    expect(bonuses.biodiversityRecoveryBonus).toBeCloseTo(0.1, 6);
    expect(bonuses.ecosystemResilienceBonus).toBeCloseTo(0.1, 6);
    expect(bonuses.soilHealthRecoveryBonus).toBe(0);
  });

  it('aggregateResearchEffects returns zero bonuses when no nodes are unlocked', () => {
    const state = seedDefaultRegions(freshState(42));
    const bonuses = aggregateResearchEffects(state);
    expect(bonuses.biodiversityRecoveryBonus).toBe(0);
    expect(bonuses.ecosystemResilienceBonus).toBe(0);
    expect(bonuses.soilHealthRecoveryBonus).toBe(0);
  });

  it('biodiversity-enhancement research actually boosts recovery (Finding 5 — the node is no longer a no-op)', () => {
    // Two identical states: one with biodiversity-enhancement unlocked, one
    // without. Advance both 30 days via evolveRegions. The with-research
    // state must end with HIGHER biodiversity (the +0.1 recovery bonus
    // applies). Pre-W43 both would be equal (the node did nothing).
    const base = seedDefaultRegions(freshState(42));
    const control = base;
    const withResearch = withUnlockedResearch(base, 'research:biodiversity-enhancement');

    const controlAfter = aggregateGlobalIndicators(
      evolveRegions(control, 30 * DAY).state,
    ).state.eventState.global.aggregatedIndicators.avgBiodiversity;
    const researchAfter = aggregateGlobalIndicators(
      evolveRegions(withResearch, 30 * DAY).state,
    ).state.eventState.global.aggregatedIndicators.avgBiodiversity;

    expect(researchAfter).toBeGreaterThan(controlAfter);
  });

  it('the destruction path still works — high player-driven IA collapses biodiversity (Finding 2 does not break the destruction objective)', () => {
    // The rebalance makes the world stable against BACKGROUND IA, but
    // player-driven extraction (businesses / automation raising the home
    // region's IA) must still be able to collapse biodiversity. Inject a
    // high-IA home region (simulating heavy player industrial activity) +
    // advance 30 days.
    const state = seedDefaultRegions(freshState(42));
    const heavy: GameState = {
      ...state,
      eventState: {
        ...state.eventState,
        global: {
          ...state.eventState.global,
          regions: state.eventState.global.regions.map((r) =>
            r.id === HOME_REGION
              ? {
                  ...r,
                  industrialActivity: 0.8,
                  pollution: { air: 80, water: 40, soil: 24 },
                }
              : r,
          ),
        },
      },
    };
    const result = evolveRegions(heavy, 30 * DAY);
    const homeBio = regionById(result.state, HOME_REGION).biodiversity;
    // High IA (0.8) + high pollution → biodiversity collapses below the
    // extinction threshold (the destruction path opens).
    expect(homeBio).toBeLessThan(PROVISIONAL_SPECIES_EXTINCTION_THRESHOLD);
  });

  it('soil-restoration research boosts soilHealth recovery (Finding 5 — sibling node wired)', () => {
    // The soil-restoration node's +0.1 soilHealth recovery bonus is wired
    // (same mechanism as biodiversity-enhancement). Two identical states:
    // one with soil-restoration unlocked, one without. Advance + compare
    // soilHealth.
    const base = seedDefaultRegions(freshState(42));
    const control = base;
    const withResearch = withUnlockedResearch(base, 'research:soil-restoration');

    const controlSoil = regionById(
      evolveRegions(control, 30 * DAY).state,
      HOME_REGION,
    ).soilHealth;
    const researchSoil = regionById(
      evolveRegions(withResearch, 30 * DAY).state,
      HOME_REGION,
    ).soilHealth;

    expect(researchSoil).toBeGreaterThan(controlSoil);
  });
});
