/**
 * W58 — wire `monetaryPolicy` (inflationTarget / moneySupplyGrowth) into the
 * authority's issuance policy + fee application.
 *
 * Asserts:
 *   - `deriveIssuancePolicy` reads `monetaryPolicy.inflationTarget` +
 *     `economy.inflationRate` (the authority now reads them — were display-only).
 *   - At defaults (inflation 0 ≤ target 0.02): fee = 0, caps null (preserves
 *     the prior permissive policy — no balance shift).
 *   - When actual inflation > target: fee = inflation − target (cooling).
 *   - `requestIssuance` applies the fee (seigniorage): destination receives the
 *     net (amount − fee), `monetarySupply`/`totalIssued` grow by the net.
 *     fee=0 → full amount (preserves prior behavior).
 *   - A fee that consumes the entire amount → `issuance-rejected`.
 */
import { describe, it, expect } from 'vitest';
import { engine } from '../src/index.js';
import { DEFAULT_GAME_CONFIG } from '../src/initial-state.js';
import {
  deriveIssuancePolicy,
  requestIssuance,
  getBalance,
  parseAmount,
} from '../src/economy/index.js';
import {
  type GameState,
  type CurrencyIssuanceRequest,
  PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
} from '@capitalist-tree/shared';

function freshState(): GameState {
  return engine.initialize({ ...DEFAULT_GAME_CONFIG, seed: 42 });
}
function issuanceReq(treeId: string, amount: string): CurrencyIssuanceRequest {
  return { treeId, amount, currencyId: 'currency:leaf-dollar', source: 'harvest-leaves' };
}
/** Shallow-merge a partial monetaryPolicy onto the state's global slice. */
function withMonetaryPolicy(
  s: GameState,
  mp: Partial<{ inflationTarget: number; moneySupplyGrowth: number; interestRate: number }>,
): GameState {
  return {
    ...s,
    eventState: {
      ...s.eventState,
      global: {
        ...s.eventState.global,
        monetaryPolicy: { ...s.eventState.global.monetaryPolicy, ...mp },
      },
    },
  };
}
function withInflation(s: GameState, rate: number): GameState {
  return { ...s, economy: { ...s.economy, inflationRate: rate } };
}

describe('W58 — deriveIssuancePolicy (monetaryPolicy → authority)', () => {
  it('at defaults (inflation 0 ≤ target 0.02): fee 0, caps null (preserves prior policy)', () => {
    const p = deriveIssuancePolicy(freshState());
    expect(p.issuanceFeeFraction).toBe(0);
    expect(p.maxPerRequest).toBeNull();
    expect(p.maxTotal).toBeNull();
  });

  it('fee = max(0, actualInflation − inflationTarget) — cooling when inflation runs hot', () => {
    // actual inflation 0.05 vs target 0.02 → fee 0.03.
    const p = deriveIssuancePolicy(withInflation(freshState(), 0.05));
    expect(p.issuanceFeeFraction).toBeCloseTo(0.03, 10);
    // caps still null (growable cap gated off — W58b).
    expect(p.maxTotal).toBeNull();
    expect(p.maxPerRequest).toBeNull();
  });

  it('fee stays 0 when inflation is at/below target (no cooling needed)', () => {
    const s = freshState();
    expect(deriveIssuancePolicy(withInflation(s, 0.02)).issuanceFeeFraction).toBe(0);
    expect(deriveIssuancePolicy(withInflation(s, 0)).issuanceFeeFraction).toBe(0);
    // deflation (negative) → still 0 (fee cannot be negative).
    expect(deriveIssuancePolicy(withInflation(s, -0.01)).issuanceFeeFraction).toBe(0);
  });

  it('reads inflationTarget from monetaryPolicy (a lower target raises the fee)', () => {
    // target lowered to 0.01, actual inflation 0.05 → fee 0.04.
    const p = deriveIssuancePolicy(
      withMonetaryPolicy(withInflation(freshState(), 0.05), { inflationTarget: 0.01 }),
    );
    expect(p.issuanceFeeFraction).toBeCloseTo(0.04, 10);
  });

  it('reads moneySupplyGrowth (functional — no longer display-only; cap gated to W58b)', () => {
    // The growable cap is gated off (null) at defaults, but moneySupplyGrowth
    // is read by growableMaxTotal. Assert it does not throw + returns null
    // regardless of the moneySupplyGrowth value (cap enforcement is W58b).
    const s = freshState();
    expect(
      deriveIssuancePolicy(withMonetaryPolicy(s, { moneySupplyGrowth: 0.5 })).maxTotal,
    ).toBeNull();
    expect(
      deriveIssuancePolicy(withMonetaryPolicy(s, { moneySupplyGrowth: 0 })).maxTotal,
    ).toBeNull();
  });

  it('wild/noisy inflation (outside the trust range) → fee 0 (preserves prior behavior)', () => {
    // The markets inflation annualization can swing to thousands of a percent.
    // The authority must not peg the fee to an untrusted signal (would consume
    // the entire issuance). Untrusted → fee 0.
    const s = freshState();
    expect(deriveIssuancePolicy(withInflation(s, 50000)).issuanceFeeFraction).toBe(0);
    expect(deriveIssuancePolicy(withInflation(s, -20413)).issuanceFeeFraction).toBe(0);
  });

  it('trusted hot inflation → fee capped at the max cooling fraction (10%)', () => {
    // Sane range but very hot (1.5 = 150% inflation) → raw fee would be ~1.48,
    // capped at 0.10 so the fee never approaches 100% of the issuance.
    const fee = deriveIssuancePolicy(withInflation(freshState(), 1.5)).issuanceFeeFraction;
    expect(fee).toBeCloseTo(0.10, 10);
  });
});

describe('W58 — requestIssuance fee application (seigniorage)', () => {
  it('fee=0 issues the full amount (preserves prior behavior)', () => {
    const s = freshState();
    const before = getBalance(s, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID);
    const beforeSupply = parseAmount(s.economy.monetarySupply);
    const result = requestIssuance(s, issuanceReq('original', '1000'), 'w58-fee0', 60, {
      policy: { maxPerRequest: null, maxTotal: null, issuanceFeeFraction: 0 },
    });
    expect(getBalance(result.state, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID) - before).toBe(1000n);
    expect(parseAmount(result.state.economy.monetarySupply) - beforeSupply).toBe(1000n);
    expect(result.events.some((e) => e.type === 'issuance-authorized')).toBe(true);
  });

  it('fee>0 withholds seigniorage — destination receives net, supply grows by net', () => {
    const s = freshState();
    const before = getBalance(s, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID);
    const beforeSupply = parseAmount(s.economy.monetarySupply);
    const beforeIssued = parseAmount(s.economy.totalIssued);
    // fee fraction 0.5 → half withheld.
    const result = requestIssuance(s, issuanceReq('original', '1000'), 'w58-fee', 60, {
      policy: { maxPerRequest: null, maxTotal: null, issuanceFeeFraction: 0.5 },
    });
    // destination receives net = 500.
    expect(getBalance(result.state, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID) - before).toBe(500n);
    // supply + totalIssued grow by the net (the fee is not created).
    expect(parseAmount(result.state.economy.monetarySupply) - beforeSupply).toBe(500n);
    expect(parseAmount(result.state.economy.totalIssued) - beforeIssued).toBe(500n);
    expect(result.events.some((e) => e.type === 'issuance-authorized')).toBe(true);
  });

  it('fee that consumes the entire amount → issuance-rejected (invalid-amount)', () => {
    const s = freshState();
    // amount 1, fee 1.0 → net 0 → rejected.
    const result = requestIssuance(s, issuanceReq('original', '1'), 'w58-fee-all', 60, {
      policy: { maxPerRequest: null, maxTotal: null, issuanceFeeFraction: 1.0 },
    });
    const rejected = result.events.find((e) => e.type === 'issuance-rejected');
    expect(rejected).toBeDefined();
    expect(
      rejected!.type === 'issuance-rejected' && rejected.payload.reason,
    ).toBe('invalid-amount');
    // state unchanged.
    expect(result.state).toBe(s);
  });
});
