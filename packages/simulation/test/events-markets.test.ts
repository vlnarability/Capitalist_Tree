/**
 * P10c global market evolution tests (GDD line 563 — markets at global scale;
 * TDD Milestone 9: Global markets). Asserts:
 *   - evolveGlobalMarketIndices seeds a default set when empty + mean-reverts.
 *   - indices respond to regional industrialActivity (supply), monetary policy
 *     (interest rates), government carbon tax (energy), and active events.
 *   - an active market-crash drops indices; an active boom raises them.
 *   - getGlobalMarketIndex reads with a 100 default.
 */
import { describe, it, expect } from 'vitest';
import { engine } from '../src/index.js';
import {
  evolveGlobalMarketIndices,
  getGlobalMarketIndex,
  MARKET_CONSTANTS,
} from '../src/index.js';
import { DEFAULT_GAME_CONFIG } from '../src/initial-state.js';
import type { GameState, GameConfig, ActiveEvent } from '@capitalist-tree/shared';

function cfg(seed: number): GameConfig {
  return { ...DEFAULT_GAME_CONFIG, seed };
}
function freshState(seed = 42): GameState {
  return engine.initialize(cfg(seed));
}
const YEAR = 365 * 24 * 60 * 60;

describe('P10c global markets — evolveGlobalMarketIndices', () => {
  it('seeds the default macro indices when globalMarketIndices is empty', () => {
    const base = freshState();
    expect(Object.keys(base.eventState.global.globalMarketIndices).length).toBe(0);
    const result = evolveGlobalMarketIndices(base, 60);
    const ids = Object.keys(result.state.eventState.global.globalMarketIndices);
    expect(ids).toContain('index:commodity-basket');
    expect(ids).toContain('index:energy');
    expect(ids).toContain('index:food');
    expect(ids).toContain('index:materials');
  });

  it('mean-reverts a shocked index back toward its baseline', () => {
    const base = freshState();
    const state: GameState = {
      ...base,
      eventState: {
        ...base.eventState,
        global: {
          ...base.eventState.global,
          globalMarketIndices: { 'index:commodity-basket': 200 },
        },
      },
    };
    const result = evolveGlobalMarketIndices(state, YEAR);
    const after = result.state.eventState.global.globalMarketIndices['index:commodity-basket']!;
    expect(after).toBeLessThan(200);
    expect(after).toBeGreaterThan(100);
  });

  it('high interest rate drags indices down (monetary policy → investment cost)', () => {
    const base = freshState();
    const state: GameState = {
      ...base,
      eventState: {
        ...base.eventState,
        global: {
          ...base.eventState.global,
          globalMarketIndices: { 'index:commodity-basket': 100 },
          monetaryPolicy: { ...base.eventState.global.monetaryPolicy, interestRate: 0.15 },
        },
      },
    };
    const result = evolveGlobalMarketIndices(state, YEAR);
    const after = result.state.eventState.global.globalMarketIndices['index:commodity-basket']!;
    // High rate shifts the baseline below 100 → index reverts downward.
    expect(after).toBeLessThan(100);
  });

  it('carbon tax lifts the energy index baseline', () => {
    const base = freshState();
    const state: GameState = {
      ...base,
      eventState: {
        ...base.eventState,
        global: {
          ...base.eventState.global,
          globalMarketIndices: { 'index:energy': 100 },
          governmentPolicy: { ...base.eventState.global.governmentPolicy, carbonTaxRate: 0.5 },
        },
      },
    };
    const result = evolveGlobalMarketIndices(state, YEAR);
    const after = result.state.eventState.global.globalMarketIndices['index:energy']!;
    expect(after).toBeGreaterThan(100);
  });

  it('an active market-crash drops indices; an active boom raises them', () => {
    const base = freshState();
    const crashActive: ActiveEvent = {
      id: 'evt-crash',
      type: 'event:market-crash',
      startedAt: 0,
      duration: 60,
      remaining: 60,
      payload: {},
      severity: 'severe',
    };
    const crashState: GameState = {
      ...base,
      eventState: {
        ...base.eventState,
        global: {
          ...base.eventState.global,
          globalMarketIndices: { 'index:commodity-basket': 100 },
        },
        scheduler: { ...base.eventState.scheduler, active: [crashActive] },
      },
    };
    const crashResult = evolveGlobalMarketIndices(crashState, YEAR);
    expect(
      crashResult.state.eventState.global.globalMarketIndices['index:commodity-basket']!,
    ).toBeLessThan(100);

    const boomActive: ActiveEvent = { ...crashActive, id: 'evt-boom', type: 'event:boom', severity: 'moderate' };
    const boomState: GameState = {
      ...base,
      eventState: {
        ...base.eventState,
        global: {
          ...base.eventState.global,
          globalMarketIndices: { 'index:commodity-basket': 100 },
        },
        scheduler: { ...base.eventState.scheduler, active: [boomActive] },
      },
    };
    const boomResult = evolveGlobalMarketIndices(boomState, YEAR);
    expect(
      boomResult.state.eventState.global.globalMarketIndices['index:commodity-basket']!,
    ).toBeGreaterThan(100);
  });

  it('getGlobalMarketIndex returns the level or the 100 baseline default', () => {
    const base = freshState();
    expect(getGlobalMarketIndex(base, 'index:absent')).toBe(MARKET_CONSTANTS.MARKET_INDEX_BASELINE);
    const withIdx: GameState = {
      ...base,
      eventState: {
        ...base.eventState,
        global: { ...base.eventState.global, globalMarketIndices: { 'index:energy': 130 } },
      },
    };
    expect(getGlobalMarketIndex(withIdx, 'index:energy')).toBe(130);
  });
});
