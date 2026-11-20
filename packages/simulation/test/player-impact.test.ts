/**
 * P11 W6/W5 regression tests — player→regional bridge + last-tree objective.
 *
 * W6 (RV4-F-H3): player actions (operate-business, harvest-leaves) bridge to
 *   the P10 regional model via `applyPlayerEnvironmentalImpact`. The home
 *   region's industrialActivity/pollution/forestCoverage/biodiversity move
 *   visibly in response to player extraction.
 * W5 (RV4-F-H1): a player running extraction-heavy strategy can raise the
 *   population-weighted `aggregateActivity ≥ 0.6` without stochastic events,
 *   making the `last-tree` objective reachable.
 */
import { describe, it, expect } from 'vitest';
import { engine } from '../src/index.js';
import { DEFAULT_GAME_CONFIG } from '../src/initial-state.js';
import { seedDefaultRegions } from '../src/events/regional.js';
import { evaluateObjectives } from '../src/events/objectives.js';
import { applyPlayerEnvironmentalImpact } from '../src/environment/player-impact.js';
import { PLAYER_HOME_REGION_ID, PROVISIONAL_SIMULATION_STEP_SECONDS as STEP } from '@capitalist-tree/shared';
import { createBusinessFromDefinition } from '../src/business/actions.js';
import { WATER_EXTRACTION_PLANT, FARM } from '@capitalist-tree/content';
import type { GameState, GameConfig } from '@capitalist-tree/shared';
import { registerAccount } from '../src/economy/ledger.js';

function cfg(seed: number): GameConfig {
  return { ...DEFAULT_GAME_CONFIG, seed };
}
function freshState(seed = 42): GameState {
  return seedDefaultRegions(engine.initialize(cfg(seed)));
}

/** Population-weighted aggregate industrialActivity (matches evaluateLastTree). */
function weightedAggregateActivity(state: GameState): number {
  const regions = state.eventState.global.regions;
  let weightSum = 0;
  let acc = 0;
  for (const r of regions) {
    const w = Math.max(1, r.population);
    acc += r.industrialActivity * w;
    weightSum += w;
  }
  return weightSum > 0 ? acc / weightSum : 0;
}

/** Build a state with a purchased, cash-funded business + seeded regions. */
function stateWithBusinessAndRegions(
  def: typeof WATER_EXTRACTION_PLANT,
  cash = '1000000',
): { state: GameState; businessId: string } {
  let state = freshState(42);
  const businessId = 'business:test:0';
  const business = {
    ...createBusinessFromDefinition(def, businessId, def.name),
    id: businessId,
    cash,
    status: 'operating' as const,
  };
  state = registerAccount(state, { id: businessId, type: 'business', label: 'Test', balance: '0' });
  state = {
    ...state,
    businesses: [...state.businesses, business],
  };
  return { state, businessId };
}

describe('P11 W6 — player→regional bridge (RV4-F-H3)', () => {
  it('applyPlayerEnvironmentalImpact moves the home region indicators', () => {
    const state = freshState();
    const home = state.eventState.global.regions.find((r) => r.id === PLAYER_HOME_REGION_ID)!;
    const before = {
      industrialActivity: home.industrialActivity,
      pollutionAir: home.pollution.air,
      forestCoverage: home.forestCoverage,
      biodiversity: home.biodiversity,
    };
    // Apply a manufacturing-like impact.
    const next = applyPlayerEnvironmentalImpact(state, {
      carbonEmissions: 1.0,
      waterConsumption: 10,
      soilDegradation: 0.1,
      pollution: 0.3,
      landDisturbance: 0.1,
      biodiversityImpact: 0.05,
    });
    const after = next.eventState.global.regions.find((r) => r.id === PLAYER_HOME_REGION_ID)!;
    expect(after.industrialActivity).toBeGreaterThan(before.industrialActivity);
    expect(after.pollution.air).toBeGreaterThan(before.pollutionAir);
    expect(after.forestCoverage).toBeLessThan(before.forestCoverage);
    expect(after.biodiversity).toBeLessThan(before.biodiversity);
  });

  it('is a no-op when the home region is not seeded (regions absent)', () => {
    // Pre-EventSystem state has no regions — impact is silently dropped.
    const state = engine.initialize(cfg(42));
    expect(state.eventState.global.regions).toHaveLength(0);
    const next = applyPlayerEnvironmentalImpact(state, {
      carbonEmissions: 1,
      waterConsumption: 0,
      soilDegradation: 0,
      pollution: 0.3,
      landDisturbance: 0.1,
      biodiversityImpact: 0.05,
    });
    expect(next).toBe(state); // unchanged
  });

  it('operating a business raises the home region industrialActivity (W6 bridge)', () => {
    const { state, businessId } = stateWithBusinessAndRegions(WATER_EXTRACTION_PLANT);
    const homeBefore = state.eventState.global.regions.find(
      (r) => r.id === PLAYER_HOME_REGION_ID,
    )!.industrialActivity;

    // Dispatch operate-business via the engine.
    const result = engine.executeAction(state, {
      type: 'operate-business',
      payload: { businessId },
    });
    const homeAfter = result.state.eventState.global.regions.find(
      (r) => r.id === PLAYER_HOME_REGION_ID,
    )!.industrialActivity;
    expect(homeAfter).toBeGreaterThan(homeBefore);
  });
});

describe('P11 W5 — last-tree objective reachable (RV4-F-H1)', () => {
  it('sustained extraction raises the population-weighted aggregate ≥ 0.6', () => {
    const { state, businessId } = stateWithBusinessAndRegions(WATER_EXTRACTION_PLANT);
    const baseline = weightedAggregateActivity(state);
    expect(baseline).toBeLessThan(0.6); // not yet at the threshold

    // Operate the extraction business many times. Each operation nudges the
    // home region's industrialActivity up (clamped at 1.0). The home region
    // carries 50% of the population weight, so raising it to 1.0 pushes the
    // weighted aggregate past 0.6.
    let s = state;
    for (let i = 0; i < 40; i++) {
      const r = engine.executeAction(s, { type: 'operate-business', payload: { businessId } });
      s = r.state;
    }
    const aggregate = weightedAggregateActivity(s);
    expect(aggregate).toBeGreaterThanOrEqual(0.6);
  });

  it('the population-weighted aggregate (W5 fix) crosses 0.6 where unweighted would not', () => {
    const { state, businessId } = stateWithBusinessAndRegions(WATER_EXTRACTION_PLANT);
    // Operate extraction to raise the home region's industrialActivity.
    let s = state;
    for (let i = 0; i < 40; i++) {
      const r = engine.executeAction(s, { type: 'operate-business', payload: { businessId } });
      s = r.state;
    }
    // The home region should now be at/near 1.0 (clamped).
    const home = s.eventState.global.regions.find((r) => r.id === PLAYER_HOME_REGION_ID)!;
    expect(home.industrialActivity).toBeGreaterThanOrEqual(0.99);

    // Population-weighted aggregate (the W5 fix — matches evaluateLastTree).
    const weighted = weightedAggregateActivity(s);
    expect(weighted).toBeGreaterThanOrEqual(0.6);

    // The OLD unweighted average (pre-W5 fix) would NOT cross 0.6 with just
    // one region raised — (1.0 + 0.3 + 0.4 + 0.2) / 4 = 0.475. This documents
    // why the population-weighted fix was necessary to make the last-tree
    // objective reachable.
    const regions = s.eventState.global.regions;
    const unweighted =
      regions.length > 0
        ? regions.reduce((a, r) => a + r.industrialActivity, 0) / regions.length
        : 0;
    expect(unweighted).toBeLessThan(0.6);
  });
});
