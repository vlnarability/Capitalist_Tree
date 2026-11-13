/**
 * Research→trait wiring tests (P9c — TDD §18.1, §18.4; GDD §11.2 — genetic
 * legacy unlocks genetic modifications). Resolves P9b deferred item #6.
 *
 * Asserts that `unlockResearchNode` auto-populates
 * `genetics.availableTraits` from the node's `effects.unlocks` trait ids,
 * while non-trait unlocks (equipment / ownership ids) are NOT routed there
 * (future task R-P9-3).
 */
import { describe, it, expect } from 'vitest';
import {
  engine,
  unlockResearchNode,
  extractTraitUnlocks,
  mergeTraitUnlocks,
} from '../src/index.js';
import { DEFAULT_GAME_CONFIG } from '../src/initial-state.js';
import {
  type GameState,
  type GameConfig,
} from '@capitalist-tree/shared';
import {
  IMPROVED_PHOTOSYNTHESIS,
  DROUGHT_RESISTANCE_BREEDING,
  PEST_RESISTANCE_BREEDING,
  CORPORATE_STRUCTURE,
  CARBON_CAPTURE,
} from '@capitalist-tree/content';

function cfg(seed: number): GameConfig {
  return { ...DEFAULT_GAME_CONFIG, seed };
}

function freshState(seed = 42): GameState {
  return engine.initialize(cfg(seed));
}

function stateWithLegacy(points: string, seed = 42): GameState {
  const state = freshState(seed);
  return {
    ...state,
    progression: {
      ...state.progression,
      prestige: {
        ...state.progression.prestige,
        geneticLegacyPoints: points,
      },
    },
  };
}

describe('extractTraitUnlocks + mergeTraitUnlocks', () => {
  it('extractTraitUnlocks returns the trait: ids from a node effects.unlocks', () => {
    expect(extractTraitUnlocks(IMPROVED_PHOTOSYNTHESIS).sort()).toEqual(
      [
        'trait:rapid-growth',
        'trait:large-foliage',
        'trait:thick-trunk',
        'trait:efficient-photosynthesis',
      ].sort(),
    );
  });

  it('extractTraitUnlocks returns [] for a node with no trait unlocks', () => {
    expect(extractTraitUnlocks(CORPORATE_STRUCTURE)).toEqual([]);
    expect(extractTraitUnlocks(CARBON_CAPTURE)).toEqual([]);
  });

  it('mergeTraitUnlocks is idempotent (no duplicates)', () => {
    const merged = mergeTraitUnlocks(
      ['trait:rapid-growth'],
      ['trait:rapid-growth', 'trait:large-foliage'],
    );
    expect(merged).toEqual(['trait:rapid-growth', 'trait:large-foliage']);
  });
});

describe('unlockResearchNode — auto-populates availableTraits from effects.unlocks.traits', () => {
  it('IMPROVED_PHOTOSYNTHESIS adds its 4 trait ids to availableTraits', () => {
    const state = stateWithLegacy('1000');
    const result = unlockResearchNode(state, IMPROVED_PHOTOSYNTHESIS.id, 100);
    expect(result.state.progression.genetics.availableTraits.sort()).toEqual(
      [
        'trait:rapid-growth',
        'trait:large-foliage',
        'trait:thick-trunk',
        'trait:efficient-photosynthesis',
      ].sort(),
    );
  });

  it('DROUGHT_RESISTANCE_BREEDING adds deep-roots to availableTraits (after prereq)', () => {
    let state = stateWithLegacy('1000');
    state = unlockResearchNode(state, IMPROVED_PHOTOSYNTHESIS.id, 100).state;
    state = unlockResearchNode(state, DROUGHT_RESISTANCE_BREEDING.id, 200).state;
    expect(
      state.progression.genetics.availableTraits,
    ).toContain('trait:deep-roots');
  });

  it('PEST_RESISTANCE_BREEDING adds pest-resistance + cold-resistance', () => {
    let state = stateWithLegacy('1000');
    state = unlockResearchNode(state, IMPROVED_PHOTOSYNTHESIS.id, 100).state;
    state = unlockResearchNode(state, PEST_RESISTANCE_BREEDING.id, 200).state;
    expect(state.progression.genetics.availableTraits).toContain('trait:pest-resistance');
    expect(state.progression.genetics.availableTraits).toContain('trait:cold-resistance');
  });

  it('does NOT add non-trait unlocks (equipment / ownership ids) to availableTraits', () => {
    // CARBON_CAPTURE unlocks 'equipment:carbon-capture-unit' — not a trait.
    let state = stateWithLegacy('1000');
    state = unlockResearchNode(state, CARBON_CAPTURE.id, 100).state;
    expect(state.progression.genetics.availableTraits).toEqual([]);
    // CORPORATE_STRUCTURE unlocks ownership:* ids — not traits. Requires a
    // prereq chain (supply-chain → market-analysis → corporate-structure).
    state = stateWithLegacy('10000');
    state = unlockResearchNode(
      state,
      'research:supply-chain-optimization',
      100,
    ).state;
    state = unlockResearchNode(state, 'research:market-analysis', 200).state;
    state = unlockResearchNode(state, CORPORATE_STRUCTURE.id, 300).state;
    expect(state.progression.genetics.availableTraits).toEqual([]);
  });

  it('is idempotent — re-unlocking does not duplicate availableTraits', () => {
    let state = stateWithLegacy('1000');
    state = unlockResearchNode(state, IMPROVED_PHOTOSYNTHESIS.id, 100).state;
    const before = state.progression.genetics.availableTraits.length;
    state = unlockResearchNode(state, IMPROVED_PHOTOSYNTHESIS.id, 200).state;
    expect(state.progression.genetics.availableTraits.length).toBe(before);
  });

  it('preserves originalLineageId (NEVER modified)', () => {
    const state = stateWithLegacy('1000');
    const before = state.progression.genetics.originalLineageId;
    const result = unlockResearchNode(state, IMPROVED_PHOTOSYNTHESIS.id, 100);
    expect(result.state.progression.genetics.originalLineageId).toBe(before);
  });
});

describe('unlock-research action — availableTraits auto-populated via executeAction', () => {
  it('the action handler routes through unlockResearchNode (traits appear)', () => {
    const state = stateWithLegacy('1000');
    const result = engine.executeAction(state, {
      type: 'unlock-research',
      payload: { researchNodeId: IMPROVED_PHOTOSYNTHESIS.id, tick: 100 },
    });
    expect(
      result.state.progression.genetics.availableTraits,
    ).toContain('trait:rapid-growth');
  });
});
