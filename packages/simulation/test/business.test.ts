/**
 * Business module unit + integration tests (P8b — TDD §18.1, §18.4; TDD §5.7
 * Business State, §11 Personal and Business Accounting; GDD §8 Business and
 * Economic Simulation).
 *
 * Asserts the invariants the GDD and TDD require:
 *
 *   - Production: inputs consumed, output produced at
 *     rate × efficiency × dt; vertical-integration bonus; insufficient
 *     inputs → reduced/zero output.
 *   - Accounting: revenue increases cash, expenses decrease cash (both via
 *     transactions); bankruptcy triggers below threshold; valuation NOT
 *     added to cash.
 *   - Valuation: recomputed periodically (not every tick); assets +
 *     profitability − liabilities; valuation ≠ cash.
 *   - Supply chain: upstream suppliers provide inputs; downstream customers
 *     receive outputs; market fallback.
 *   - Actions: purchase deducts cash + creates business; sell credits
 *     valuation × (1 − haircut); take-loan creates liability + credits cash;
 *     repay-loan reduces liability + debits cash; hire/layoff adjust
 *     employees; set-status changes status.
 *   - Environmental impact: business-operated event carries the impact;
 *     env accumulators move (feeds EnvironmentSystem at slot #10).
 *   - Conservation: every revenue/expense/loan/sale is a transaction;
 *     liabilities + cash balance after loan/repay.
 *   - originalTree never touched by any business action.
 *   - Determinism: same (state, ctx) → same (new state, events).
 *   - Purity: input not mutated (freeze test).
 *   - RNG fork deferred (R-P8-N): zero root draws; downstream
 *     AutomationSystem/EnvironmentSystem RNG sequences unaffected.
 */
import { describe, it, expect } from 'vitest';
import {
  engine,
  businessSystem,
  defaultRegistry,
  runProduction,
  operateBusiness,
  applyRevenue,
  applyExpenses,
  checkBankruptcy,
  accrueInterest,
  recomputeValuation,
  shouldRecomputeValuation,
  resolveInputs,
  resolveOutputs,
  buildMarketPriceMap,
  createBusinessFromDefinition,
  sumLiabilities,
  UnknownBusinessError,
  UnknownBusinessTypeError,
  UnknownLiabilityError,
  InvalidBusinessStatusError,
} from '../src/index.js';
import type { SystemContext } from '../src/systems/system.js';
import { Rng } from '../src/rng.js';
import {
  conservationDiscrepancy,
  getBalance,
  registerAccount,
  parseAmount,
  transfer,
} from '../src/economy/index.js';
import { DEFAULT_GAME_CONFIG } from '../src/initial-state.js';
import {
  WATER_EXTRACTION_PLANT,
  FERTILIZER_FACTORY,
  MINERAL_MINE,
} from '@capitalist-tree/content';
import {
  type GameState,
  type GameConfig,
  type BusinessState,
  type BusinessTypeDefinition,
  type SimulationEvent,
  PROVISIONAL_BUSINESS_BANKRUPTCY_THRESHOLD,
  PROVISIONAL_BUSINESS_VALUATION_HAIRCUT,
  PROVISIONAL_BUSINESS_SUPPLY_CHAIN_INTEGRATION_BONUS,
  PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
  PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
  PROVISIONAL_SIMULATION_STEP_SECONDS,
} from '@capitalist-tree/shared';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const STEP = PROVISIONAL_SIMULATION_STEP_SECONDS;
const SECONDS_PER_DAY = 24 * 60 * 60;
const INITIAL_SUPPLY = DEFAULT_GAME_CONFIG.startingPersonalCash; // '50000'

function cfg(seed: number): GameConfig {
  return { ...DEFAULT_GAME_CONFIG, seed };
}

/** Fresh GameState from a seed. */
function freshState(seed = 42): GameState {
  return engine.initialize(cfg(seed));
}

/**
 * Build a state with one business instantiated from a definition, its cash
 * account registered with `cash`, and the business appended to
 * `state.businesses`. Used for unit tests of operateBusiness / runProduction /
 * resolveInputs that need a business + its account in place.
 *
 * For `cash > 0`, the business account is funded via an authority issuance
 * (authority → business) so the conservation invariant holds (the issuance
 * increments `totalIssued` alongside the balance). For `cash <= 0`, the
 * account is registered directly with that balance (negative balances model
 * an overdraft for bankruptcy tests; those tests do not assert conservation).
 */
function stateWithBusiness(
  def: BusinessTypeDefinition,
  cash = '0',
  overrides: Partial<BusinessState> = {},
): { state: GameState; business: BusinessState; businessId: string } {
  let state = freshState(42);
  const businessId = 'business:test:0';
  const business: BusinessState = {
    ...createBusinessFromDefinition(def, businessId, def.name),
    ...overrides,
    id: businessId,
    cash,
  };
  // Register the account with balance '0' first.
  state = registerAccount(state, {
    id: businessId,
    type: 'business',
    label: `Business — ${def.name}`,
    balance: '0',
  });
  // Fund positive cash via an authority issuance (conservation-safe).
  const cashAmount = parseAmount(cash, 'cash');
  if (cashAmount > 0n) {
    state = transfer(state, {
      sourceAccount: PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
      destinationAccount: businessId,
      amount: cashAmount.toString(10),
      category: 'business-test-fund',
      description: `Test fund for ${businessId}`,
      timestamp: 0,
      requestId: `test-fund:${businessId}`,
    });
  } else if (cashAmount < 0n) {
    // Negative balance: overwrite the registered balance directly (overdraft
    // for bankruptcy tests; not conservation-relevant there).
    state = {
      ...state,
      economy: {
        ...state.economy,
        accounts: state.economy.accounts.map((a) =>
          a.id === businessId ? { ...a, balance: cash } : a,
        ),
      },
    };
  }
  state = { ...state, businesses: [...state.businesses, business] };
  return { state, business, businessId };
}

/** Build a marketPrices map (resourceId → price string) for runProduction. */
function marketPrices(entries: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(entries));
}

/** Deep-freeze an object so any mutation throws (purity test). */
function deepFreeze<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v;
  Object.freeze(v);
  for (const k of Object.keys(v as Record<string, unknown>)) {
    deepFreeze((v as Record<string, unknown>)[k]);
  }
  return v;
}

/** Find a business-operated event in a list. */
function operatedEvent(events: readonly SimulationEvent[]) {
  return events.find((e) => e.type === 'business-operated');
}

// ---------------------------------------------------------------------------
// Production (TDD §5.7, GDD §8.2 / §8.4 / §8.5)
// ---------------------------------------------------------------------------

describe('production — runProduction (pure calc)', () => {
  it('produces output at rate × efficiency × employeeScale × dtFraction', () => {
    const { business } = stateWithBusiness(WATER_EXTRACTION_PLANT, '0');
    // WATER_EXTRACTION_PLANT: rate=100, efficiency=0.9, baseEmployees=2,
    // wageRate=400, outputResourceId='resource:water', no inputs.
    const plan = runProduction(
      business,
      WATER_EXTRACTION_PLANT,
      SECONDS_PER_DAY, // dtFraction = 1.0
      marketPrices({ 'resource:water': '10' }),
    );
    // outputProduced = 100 × 0.9 × (2 × 1.0) × 1.0 = 180
    expect(plan.outputProduced).toBe(180);
    expect(plan.effectiveEfficiency).toBe(0.9);
    // revenue = floor(180 × 10) = 1800
    expect(plan.revenue).toBe(1800n);
    // wages = floor(2 × 400 × 1.0) = 800
    expect(plan.wages).toBe(800n);
    expect(plan.expenses).toBe(800n);
    // No inputs → empty inputsConsumed.
    expect(plan.inputsConsumed).toEqual([]);
  });

  it('scales output by dtSeconds (half a day → half the output)', () => {
    const { business } = stateWithBusiness(WATER_EXTRACTION_PLANT, '0');
    const plan = runProduction(
      business,
      WATER_EXTRACTION_PLANT,
      SECONDS_PER_DAY / 2, // dtFraction = 0.5
      marketPrices({ 'resource:water': '10' }),
    );
    // outputProduced = 100 × 0.9 × 2 × 0.5 = 90
    expect(plan.outputProduced).toBe(90);
    expect(plan.revenue).toBe(900n);
  });

  it('applies the vertical-integration bonus when hasPlayerOwnedUpstream', () => {
    const { business } = stateWithBusiness(WATER_EXTRACTION_PLANT, '0');
    const planNoBonus = runProduction(
      business,
      WATER_EXTRACTION_PLANT,
      SECONDS_PER_DAY,
      marketPrices({ 'resource:water': '10' }),
      { hasPlayerOwnedUpstream: false },
    );
    const planWithBonus = runProduction(
      business,
      WATER_EXTRACTION_PLANT,
      SECONDS_PER_DAY,
      marketPrices({ 'resource:water': '10' }),
      { hasPlayerOwnedUpstream: true },
    );
    // effectiveEfficiency = min(1, 0.9 + 0.05) = 0.95
    expect(planWithBonus.effectiveEfficiency).toBe(
      0.9 + PROVISIONAL_BUSINESS_SUPPLY_CHAIN_INTEGRATION_BONUS,
    );
    // output: 100 × 0.95 × 2 × 1.0 = 190 (vs 180 without bonus)
    expect(planWithBonus.outputProduced).toBe(190);
    expect(planNoBonus.outputProduced).toBe(180);
    expect(planWithBonus.outputProduced).toBeGreaterThan(planNoBonus.outputProduced);
  });

  it('consumes inputs 1:1 with output (fertilizer factory)', () => {
    const { business } = stateWithBusiness(FERTILIZER_FACTORY, '0');
    // FERTILIZER_FACTORY: rate=25, efficiency=0.9, baseEmployees=10,
    // inputResourceIds=['resource:chemicals'], outputResourceId='fertilizer:balanced-10-10-10'.
    const plan = runProduction(
      business,
      FERTILIZER_FACTORY,
      SECONDS_PER_DAY,
      marketPrices({ 'fertilizer:balanced-10-10-10': '500' }),
    );
    // outputProduced = 25 × 0.9 × (10 × 1.0) × 1.0 = 225
    expect(plan.outputProduced).toBe(225);
    // inputsConsumed: 1 unit chemicals per unit output → 225
    expect(plan.inputsConsumed).toEqual([
      { resourceId: 'resource:chemicals', quantity: 225 },
    ]);
    // revenue = floor(225 × 500) = 112500
    expect(plan.revenue).toBe(112500n);
    // wages = floor(10 × 750 × 1.0) = 7500
    expect(plan.wages).toBe(7500n);
  });

  it('revenue is 0 when the output has no market price', () => {
    const { business } = stateWithBusiness(MINERAL_MINE, '0');
    // MINERAL_MINE: outputResourceId='resource:minerals' (no market).
    const plan = runProduction(
      business,
      MINERAL_MINE,
      SECONDS_PER_DAY,
      marketPrices({ 'resource:water': '10' }), // no minerals price
    );
    // outputProduced = 50 × 0.8 × (5 × 1.0) × 1.0 = 200
    expect(plan.outputProduced).toBe(200);
    // No market for minerals → revenue 0.
    expect(plan.revenue).toBe(0n);
  });
});

describe('production — operateBusiness (orchestration)', () => {
  it('runs production, moves money via transfers, emits business-operated', () => {
    const { state, business, businessId } = stateWithBusiness(WATER_EXTRACTION_PLANT, '0');
    const ctx = { now: SECONDS_PER_DAY, dtSeconds: SECONDS_PER_DAY };
    const result = operateBusiness(state, business, WATER_EXTRACTION_PLANT, ctx);
    // Event emitted.
    const ev = operatedEvent(result.events);
    expect(ev).toBeDefined();
    expect(ev!.type).toBe('business-operated');
    expect(ev!.payload).toMatchObject({
      businessId,
      operated: true,
      outputResourceId: 'resource:water',
      outputQuantity: 180,
      revenue: '1800',
      expenses: '800',
    });
    // Cash after: 0 + 1800 (revenue issuance) − 800 (wages sink) = 1000.
    expect(ev!.payload.businessCashAfter).toBe('1000');
    const updated = result.state.businesses.find((b) => b.id === businessId)!;
    expect(updated.cash).toBe('1000');
    expect(updated.revenue).toBe('1800');
    expect(updated.expenses).toBe('800');
    expect(updated.lastOperatedAt).toBe(SECONDS_PER_DAY);
    // Conservation: revenue issuance + wages sink net out in supply, but
    // totalIssued += 1800 and totalSinks += 800. The invariant holds.
    expect(conservationDiscrepancy(result.state, INITIAL_SUPPLY)).toBe(0n);
  });

  it('skips with reason "no-employees" when employees === 0', () => {
    const { state, business } = stateWithBusiness(WATER_EXTRACTION_PLANT, '1000', {
      employees: 0,
    });
    const result = operateBusiness(state, business, WATER_EXTRACTION_PLANT, {
      now: STEP,
      dtSeconds: STEP,
    });
    const ev = operatedEvent(result.events);
    expect(ev!.payload).toMatchObject({ operated: false, reason: 'no-employees' });
    // No money moved.
    expect(conservationDiscrepancy(result.state, INITIAL_SUPPLY)).toBe(0n);
  });

  it('skips with reason "idle" when status !== "operating"', () => {
    const { state, business } = stateWithBusiness(WATER_EXTRACTION_PLANT, '1000', {
      status: 'idle',
    });
    const result = operateBusiness(state, business, WATER_EXTRACTION_PLANT, {
      now: STEP,
      dtSeconds: STEP,
    });
    expect(operatedEvent(result.events)!.payload).toMatchObject({
      operated: false,
      reason: 'idle',
    });
  });

  it('skips with reason "insufficient-inputs" when an input cannot be sourced', () => {
    // Fertilizer factory needs 'resource:chemicals' — no upstream, no
    // inventory, no market for chemicals.
    const { state, business } = stateWithBusiness(FERTILIZER_FACTORY, '100000');
    const result = operateBusiness(state, business, FERTILIZER_FACTORY, {
      now: SECONDS_PER_DAY,
      dtSeconds: SECONDS_PER_DAY,
    });
    expect(operatedEvent(result.events)!.payload).toMatchObject({
      operated: false,
      reason: 'insufficient-inputs',
    });
  });

  it('skips with reason "insufficient-funds" when wages + inputs exceed cash + revenue', () => {
    // MINERAL_MINE: output 'resource:minerals' (no market → revenue=0),
    // baseEmployees=5, wageRate=600. dtFraction=1.0 → wages=floor(5×600×1)=3000.
    // cash=0, revenue=0 → 0+0 < 3000 → insufficient-funds. No inputs (level 0)
    // so resolveInputs is satisfied; the funds gate is what skips.
    const { state, business } = stateWithBusiness(MINERAL_MINE, '0');
    const result = operateBusiness(state, business, MINERAL_MINE, {
      now: SECONDS_PER_DAY,
      dtSeconds: SECONDS_PER_DAY,
    });
    expect(operatedEvent(result.events)!.payload).toMatchObject({
      operated: false,
      reason: 'insufficient-funds',
    });
    // No money moved.
    expect(conservationDiscrepancy(result.state, INITIAL_SUPPLY)).toBe(0n);
  });

  it('valuation is NOT added to cash (TDD §11 — valuation ≠ liquidity)', () => {
    const { state, business } = stateWithBusiness(WATER_EXTRACTION_PLANT, '0');
    const valuationBefore = business.valuation; // '75000'
    const result = operateBusiness(state, business, WATER_EXTRACTION_PLANT, {
      now: SECONDS_PER_DAY,
      dtSeconds: SECONDS_PER_DAY,
    });
    const updated = result.state.businesses.find((b) => b.id === business.id)!;
    // Cash reflects only revenue − expenses (1000), NOT the valuation.
    expect(updated.cash).toBe('1000');
    expect(updated.valuation).toBe(valuationBefore); // valuation unchanged by operate
    // 75000 (valuation) ≠ 1000 (cash).
    expect(updated.valuation).not.toBe(updated.cash);
  });

  it('applies environmental impact onto state.world.environment (feeds EnvironmentSystem)', () => {
    const { state, business } = stateWithBusiness(WATER_EXTRACTION_PLANT, '0');
    const emissionsBefore = state.world.environment.atmosphere.emissions;
    const waterBefore = state.world.environment.freshwater.availability;
    const result = operateBusiness(state, business, WATER_EXTRACTION_PLANT, {
      now: SECONDS_PER_DAY,
      dtSeconds: SECONDS_PER_DAY,
    });
    // The business's baseEnvironmentalImpact (carbonEmissions=0.2,
    // waterConsumption=50) is pro-rated by dtFraction=1.0 → full day's
    // impact applied to the env accumulators.
    expect(result.state.world.environment.atmosphere.emissions).toBeGreaterThan(
      emissionsBefore,
    );
    expect(result.state.world.environment.freshwater.availability).toBeLessThan(
      waterBefore,
    );
    // The event carries the business's environmentalImpact profile.
    expect(operatedEvent(result.events)!.payload.environmentalImpact).toEqual(
      business.environmentalImpact,
    );
  });
});

// ---------------------------------------------------------------------------
// Accounting (TDD §11, GDD §8.1 / §8.4)
// ---------------------------------------------------------------------------

describe('accounting — applyRevenue / applyExpenses', () => {
  it('applyRevenue increases cash + revenue accumulator', () => {
    const { business } = stateWithBusiness(WATER_EXTRACTION_PLANT, '1000');
    const after = applyRevenue(business, 500n);
    expect(after.cash).toBe('1500');
    expect(after.revenue).toBe('500');
  });

  it('applyExpenses decreases cash + increases expenses accumulator', () => {
    const { business } = stateWithBusiness(WATER_EXTRACTION_PLANT, '1000');
    const after = applyExpenses(business, 300n);
    expect(after.cash).toBe('700');
    expect(after.expenses).toBe('300');
  });

  it('revenue/expense movements are transactions (recorded in the ledger)', () => {
    // operateBusiness calls transfer() directly (not via an action handler),
    // so the transactions are recorded in state.economy.transactions (the
    // audit trail) rather than emitted as transaction-recorded events.
    const { state, business } = stateWithBusiness(WATER_EXTRACTION_PLANT, '0');
    const txnsBefore = state.economy.transactions.length;
    const result = operateBusiness(state, business, WATER_EXTRACTION_PLANT, {
      now: SECONDS_PER_DAY,
      dtSeconds: SECONDS_PER_DAY,
    });
    // 2 transactions recorded: revenue (issuance authority→business) + wages
    // (sink business→authority).
    expect(result.state.economy.transactions.length).toBe(txnsBefore + 2);
    expect(conservationDiscrepancy(result.state, INITIAL_SUPPLY)).toBe(0n);
  });
});

describe('accounting — checkBankruptcy', () => {
  it('flips to bankrupt when cash < threshold', () => {
    const { business } = stateWithBusiness(WATER_EXTRACTION_PLANT, '-2000', {
      status: 'operating',
    });
    const result = checkBankruptcy(business);
    expect(result.bankrupt).toBe(true);
    expect(result.business.status).toBe('bankrupt');
  });

  it('does NOT flip when cash >= threshold', () => {
    const { business } = stateWithBusiness(WATER_EXTRACTION_PLANT, '-500', {
      status: 'operating',
    });
    // -500 >= -1000 (threshold) → not bankrupt.
    expect(checkBankruptcy(business).bankrupt).toBe(false);
  });

  it('does not flip a liquidating business (sale owns that status)', () => {
    const { business } = stateWithBusiness(WATER_EXTRACTION_PLANT, '-2000', {
      status: 'liquidating',
    });
    expect(checkBankruptcy(business).bankrupt).toBe(false);
  });
});

describe('accounting — accrueInterest', () => {
  it('grows liability principal by the annualized rate × dtFraction', () => {
    const liabilities = [
      {
        id: 'liability:1',
        type: 'loan',
        principal: '100000',
        interestRate: 0.05, // 5%/year
        dueAt: 0,
      },
    ];
    const after = accrueInterest(liabilities, SECONDS_PER_DAY);
    // dtFraction = 86400 / (365×86400) = 1/365. Accrual = floor(100000 × 0.05/365)
    // = floor(13.698) = 13. New principal = 100013.
    expect(after[0]!.principal).toBe('100013');
  });

  it('leaves zero-rate liabilities unchanged', () => {
    const liabilities = [
      { id: 'l1', type: 'loan', principal: '100000', interestRate: 0, dueAt: 0 },
    ];
    expect(accrueInterest(liabilities, SECONDS_PER_DAY)[0]!.principal).toBe('100000');
  });
});

// ---------------------------------------------------------------------------
// Valuation (TDD §11 — valuation ≠ liquidity)
// ---------------------------------------------------------------------------

describe('valuation — recomputeValuation', () => {
  it('computes assets + profitability − liabilities', () => {
    const { business } = stateWithBusiness(WATER_EXTRACTION_PLANT, '5000', {
      assets: [{ id: 'a1', type: 'equipment', value: '10000' }],
      revenue: '5000',
      expenses: '1000',
      liabilities: [
        { id: 'l1', type: 'loan', principal: '2000', interestRate: 0, dueAt: 0 },
      ],
    });
    const revalued = recomputeValuation(business, SECONDS_PER_DAY);
    // assetsTotal=10000, liabilitiesTotal=2000, profit=4000,
    // profitabilityTerm = floor(4000 × 0.10) = 400.
    // valuation = 10000 + 400 − 2000 = 8400.
    expect(revalued.valuation).toBe('8400');
    expect(revalued.lastValuationTick).toBe(SECONDS_PER_DAY);
  });

  it('floors valuation at 0 (never negative)', () => {
    const { business } = stateWithBusiness(WATER_EXTRACTION_PLANT, '0', {
      assets: [],
      revenue: '0',
      expenses: '5000',
      liabilities: [
        { id: 'l1', type: 'loan', principal: '10000', interestRate: 0, dueAt: 0 },
      ],
    });
    // profit = -5000, profitabilityTerm = floor(-5000 × 0.10) = -500.
    // valuation = 0 + (-500) − 10000 = -10500 → floored at 0.
    expect(recomputeValuation(business, 0).valuation).toBe('0');
  });

  it('valuation ≠ cash (valuation is not spendable)', () => {
    const { business } = stateWithBusiness(WATER_EXTRACTION_PLANT, '500', {
      assets: [{ id: 'a1', type: 'land', value: '50000' }],
      revenue: '0',
      expenses: '0',
    });
    const revalued = recomputeValuation(business, 0);
    expect(revalued.valuation).toBe('50000');
    expect(revalued.cash).toBe('500'); // cash unchanged by revaluation
    expect(revalued.valuation).not.toBe(revalued.cash);
  });

  it('shouldRecomputeValuation gates on the interval (not every tick)', () => {
    const { business } = stateWithBusiness(WATER_EXTRACTION_PLANT, '0', {
      lastValuationTick: 0,
    });
    // 60s tick < 1 day interval → no recompute.
    expect(shouldRecomputeValuation(business, STEP)).toBe(false);
    // Exactly 1 day → recompute.
    expect(shouldRecomputeValuation(business, SECONDS_PER_DAY)).toBe(true);
    // After a day → recompute.
    expect(shouldRecomputeValuation(business, SECONDS_PER_DAY + 1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Supply chain (GDD §8.2)
// ---------------------------------------------------------------------------

describe('supply chain — resolveInputs', () => {
  it('sources from a player-owned upstream supplier (vertical integration)', () => {
    // Upstream water plant + downstream business that consumes water.
    const upstream = createBusinessFromDefinition(
      WATER_EXTRACTION_PLANT,
      'business:water:0',
      'Water Plant',
    );
    const downstream: BusinessState = {
      ...createBusinessFromDefinition(FERTILIZER_FACTORY, 'business:fert:0', 'Fert Factory'),
      production: {
        inputResourceIds: ['resource:water'],
        outputResourceId: 'fertilizer:balanced-10-10-10',
        rate: 25,
        efficiency: 0.9,
      },
      upstreamSupplierIds: ['business:water:0'],
    };
    let state = freshState();
    state = registerAccount(state, { id: upstream.id, type: 'business', label: 'U', balance: '0' });
    state = registerAccount(state, { id: downstream.id, type: 'business', label: 'D', balance: '0' });
    state = { ...state, businesses: [upstream, downstream] };
    const prices = buildMarketPriceMap(state);
    const result = resolveInputs(state, downstream, [{ resourceId: 'resource:water', quantity: 50 }], prices);
    expect(result.satisfied).toBe(true);
    expect(result.sources[0]!.kind).toBe('upstream');
    expect(result.marketCost).toBe('0'); // no market purchase
  });

  it('sources from the shared inventory when stocked', () => {
    const { state, business } = stateWithBusiness(FERTILIZER_FACTORY, '100000');
    // Put chemicals in inventory.
    const withInv: GameState = {
      ...state,
      inventory: { items: [{ resourceId: 'resource:chemicals', quantity: 500 }] },
    };
    const prices = buildMarketPriceMap(withInv);
    const result = resolveInputs(withInv, business, [{ resourceId: 'resource:chemicals', quantity: 225 }], prices);
    expect(result.satisfied).toBe(true);
    expect(result.sources[0]!.kind).toBe('inventory');
    expect(result.marketCost).toBe('0');
  });

  it('falls back to the market when no upstream + no inventory', () => {
    // A business consuming 'resource:water' (which has a live market) with no
    // inventory + no upstream → buys from market.
    const { state } = stateWithBusiness(WATER_EXTRACTION_PLANT, '100000');
    const consumer: BusinessState = {
      ...createBusinessFromDefinition(WATER_EXTRACTION_PLANT, 'business:consumer:0', 'C'),
      production: {
        inputResourceIds: ['resource:water'],
        outputResourceId: 'resource:food',
        rate: 10,
        efficiency: 0.9,
      },
    };
    let s = state;
    s = registerAccount(s, { id: consumer.id, type: 'business', label: 'C', balance: '100000' });
    s = { ...s, businesses: [...s.businesses, consumer] };
    const prices = buildMarketPriceMap(s);
    const result = resolveInputs(s, consumer, [{ resourceId: 'resource:water', quantity: 10 }], prices);
    expect(result.satisfied).toBe(true);
    expect(result.sources[0]!.kind).toBe('market');
    // marketCost = 10 × 10 (water price) = 100.
    expect(parseAmount(result.marketCost, 'marketCost')).toBe(100n);
  });

  it('reports unsatisfied when no source exists for an intermediate', () => {
    // Fertilizer factory needs chemicals — no upstream, no inventory, no
    // market for chemicals.
    const { state, business } = stateWithBusiness(FERTILIZER_FACTORY, '100000');
    const prices = buildMarketPriceMap(state);
    const result = resolveInputs(state, business, [{ resourceId: 'resource:chemicals', quantity: 225 }], prices);
    expect(result.satisfied).toBe(false);
    expect(result.unsatisfiedResource).toBe('resource:chemicals');
    expect(result.sources[0]!.kind).toBe('unsatisfied');
  });
});

describe('supply chain — resolveOutputs', () => {
  it('routes to a player-owned downstream customer', () => {
    const upstream = createBusinessFromDefinition(WATER_EXTRACTION_PLANT, 'business:water:0', 'W');
    const downstream: BusinessState = {
      ...createBusinessFromDefinition(FERTILIZER_FACTORY, 'business:fert:0', 'F'),
      production: {
        inputResourceIds: ['resource:water'],
        outputResourceId: 'fertilizer:balanced-10-10-10',
        rate: 25,
        efficiency: 0.9,
      },
      downstreamCustomerIds: [],
    };
    const upstreamWithCustomer: BusinessState = {
      ...upstream,
      downstreamCustomerIds: ['business:fert:0'],
    };
    let state = freshState();
    state = registerAccount(state, { id: upstreamWithCustomer.id, type: 'business', label: 'U', balance: '0' });
    state = registerAccount(state, { id: downstream.id, type: 'business', label: 'D', balance: '0' });
    state = { ...state, businesses: [upstreamWithCustomer, downstream] };
    const prices = buildMarketPriceMap(state);
    const result = resolveOutputs(state, upstreamWithCustomer, prices);
    expect(result.destination).toBe('downstream');
    expect(result.downstreamCustomerId).toBe('business:fert:0');
  });

  it('routes to the market when no downstream (output has a market price)', () => {
    const { state, business } = stateWithBusiness(WATER_EXTRACTION_PLANT, '0');
    const prices = buildMarketPriceMap(state);
    const result = resolveOutputs(state, business, prices);
    expect(result.destination).toBe('market');
    expect(result.unitPrice).toBe('10'); // water market price
  });

  it('stockpiles when no downstream + no market (intermediate output)', () => {
    const { state, business } = stateWithBusiness(MINERAL_MINE, '0');
    const prices = buildMarketPriceMap(state);
    const result = resolveOutputs(state, business, prices);
    expect(result.destination).toBe('stockpile');
  });
});

// ---------------------------------------------------------------------------
// Actions (TDD §5.7 / §11, GDD §8.1 / §8.4)
// ---------------------------------------------------------------------------

describe('actions — purchase-business', () => {
  it('deducts player cash, creates the business + account, emits business-purchased', () => {
    const state = freshState();
    const result = engine.executeAction(state, {
      type: 'purchase-business',
      payload: { businessTypeId: WATER_EXTRACTION_PLANT.id },
    });
    const ev = result.events.find((e) => e.type === 'business-purchased');
    expect(ev).toBeDefined();
    expect(ev!.payload.businessTypeId).toBe(WATER_EXTRACTION_PLANT.id);
    expect(ev!.payload.cost).toBe(WATER_EXTRACTION_PLANT.baseCost); // '50000'
    // Player cash: 50000 − 50000 = 0.
    expect(ev!.payload.playerBalanceAfter).toBe('0');
    expect(getBalance(result.state, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID)).toBe(0n);
    // Business appended + account registered (balance 0).
    expect(result.state.businesses).toHaveLength(1);
    const business = result.state.businesses[0]!;
    expect(business.type).toBe(WATER_EXTRACTION_PLANT.id);
    expect(business.cash).toBe('0');
    expect(business.valuation).toBe(WATER_EXTRACTION_PLANT.baseValuation);
    expect(business.employees).toBe(WATER_EXTRACTION_PLANT.baseEmployees);
    expect(business.status).toBe('operating');
    expect(getBalance(result.state, business.id)).toBe(0n);
    expect(conservationDiscrepancy(result.state, INITIAL_SUPPLY)).toBe(0n);
  });

  it('rejects an unknown business type id', () => {
    const state = freshState();
    expect(() =>
      engine.executeAction(state, {
        type: 'purchase-business',
        payload: { businessTypeId: 'business:does-not-exist' },
      }),
    ).toThrow(UnknownBusinessTypeError);
  });
});

describe('actions — operate-business', () => {
  it('runs one production cycle + emits business-operated', () => {
    let state = freshState();
    state = engine.executeAction(state, {
      type: 'purchase-business',
      payload: { businessTypeId: WATER_EXTRACTION_PLANT.id },
    }).state;
    const businessId = state.businesses[0]!.id;
    const result = engine.executeAction(state, {
      type: 'operate-business',
      payload: { businessId, tick: STEP },
    });
    const ev = operatedEvent(result.events);
    expect(ev).toBeDefined();
    expect(ev!.payload).toMatchObject({ businessId, operated: true });
    // One tick (60s): revenue = floor(0.125 × 10) = 1; wages = floor(0.555) = 0.
    expect(ev!.payload.revenue).toBe('1');
    expect(ev!.payload.expenses).toBe('0');
    expect(ev!.payload.businessCashAfter).toBe('1');
    expect(conservationDiscrepancy(result.state, INITIAL_SUPPLY)).toBe(0n);
  });

  it('rejects an unknown business id', () => {
    const state = freshState();
    expect(() =>
      engine.executeAction(state, {
        type: 'operate-business',
        payload: { businessId: 'business:nope:0', tick: STEP },
      }),
    ).toThrow(UnknownBusinessError);
  });
});

describe('actions — sell-business', () => {
  it('credits valuation × (1 − haircut) to the player + removes the business', () => {
    let state = freshState();
    state = engine.executeAction(state, {
      type: 'purchase-business',
      payload: { businessTypeId: WATER_EXTRACTION_PLANT.id },
    }).state;
    const businessId = state.businesses[0]!.id;
    const result = engine.executeAction(state, {
      type: 'sell-business',
      payload: { businessId, tick: STEP },
    });
    const ev = result.events.find((e) => e.type === 'business-sold');
    expect(ev).toBeDefined();
    // proceeds = floor(75000 × (1 − 0.15)) = floor(63750) = 63750.
    const expectedProceeds = BigInt(Math.floor(75000 * (1 - PROVISIONAL_BUSINESS_VALUATION_HAIRCUT)));
    expect(ev!.payload.valuation).toBe('75000');
    expect(ev!.payload.haircut).toBe(PROVISIONAL_BUSINESS_VALUATION_HAIRCUT);
    expect(ev!.payload.settledLiabilities).toBe('0'); // no liabilities
    expect(ev!.payload.proceeds).toBe(expectedProceeds.toString(10));
    // Player: 0 (after purchase) + 63750 = 63750.
    expect(ev!.payload.playerBalanceAfter).toBe(expectedProceeds.toString(10));
    // Business + account removed.
    expect(result.state.businesses).toHaveLength(0);
    expect(result.state.economy.accounts.find((a) => a.id === businessId)).toBeUndefined();
    expect(conservationDiscrepancy(result.state, INITIAL_SUPPLY)).toBe(0n);
  });
});

describe('actions — take-loan', () => {
  it('creates a liability + credits the principal to business cash', () => {
    let state = freshState();
    state = engine.executeAction(state, {
      type: 'purchase-business',
      payload: { businessTypeId: WATER_EXTRACTION_PLANT.id },
    }).state;
    const businessId = state.businesses[0]!.id;
    const result = engine.executeAction(state, {
      type: 'take-loan',
      payload: { businessId, principal: '20000', interestRate: 0.05, dueAt: 100000 },
    });
    const ev = result.events.find((e) => e.type === 'loan-taken');
    expect(ev).toBeDefined();
    expect(ev!.payload.principal).toBe('20000');
    expect(ev!.payload.businessCashAfter).toBe('20000'); // 0 + 20000 issuance
    const business = result.state.businesses.find((b) => b.id === businessId)!;
    expect(business.cash).toBe('20000');
    expect(business.liabilities).toHaveLength(1);
    expect(business.liabilities[0]!.principal).toBe('20000');
    expect(business.liabilities[0]!.interestRate).toBe(0.05);
    // Conservation: issuance +20000, totalIssued +20000. Liability offsets on
    // the balance sheet (assets − liabilities unchanged by issuance).
    expect(conservationDiscrepancy(result.state, INITIAL_SUPPLY)).toBe(0n);
    // Liabilities + cash balance: cash(20000) − liabilities(20000) = 0 net
    // (the loan is new money offset by the debt).
    expect(parseAmount(business.cash, 'cash') - sumLiabilities(business)).toBe(0n);
  });
});

describe('actions — repay-loan', () => {
  it('reduces the liability principal + debits business cash', () => {
    let state = freshState();
    state = engine.executeAction(state, {
      type: 'purchase-business',
      payload: { businessTypeId: WATER_EXTRACTION_PLANT.id },
    }).state;
    const businessId = state.businesses[0]!.id;
    state = engine.executeAction(state, {
      type: 'take-loan',
      payload: { businessId, principal: '20000', interestRate: 0.05, dueAt: 100000 },
    }).state;
    const liabilityId = state.businesses[0]!.liabilities[0]!.id;
    const result = engine.executeAction(state, {
      type: 'repay-loan',
      payload: { businessId, liabilityId, amount: '8000', tick: STEP },
    });
    const ev = result.events.find((e) => e.type === 'loan-repaid');
    expect(ev).toBeDefined();
    expect(ev!.payload.principalPaid).toBe('8000');
    expect(ev!.payload.remainingPrincipal).toBe('12000'); // 20000 − 8000
    expect(ev!.payload.businessCashAfter).toBe('12000'); // 20000 − 8000
    const business = result.state.businesses.find((b) => b.id === businessId)!;
    expect(business.cash).toBe('12000');
    expect(business.liabilities[0]!.principal).toBe('12000');
    expect(conservationDiscrepancy(result.state, INITIAL_SUPPLY)).toBe(0n);
  });

  it('removes the liability when fully repaid', () => {
    let state = freshState();
    state = engine.executeAction(state, {
      type: 'purchase-business',
      payload: { businessTypeId: WATER_EXTRACTION_PLANT.id },
    }).state;
    const businessId = state.businesses[0]!.id;
    state = engine.executeAction(state, {
      type: 'take-loan',
      payload: { businessId, principal: '5000', interestRate: 0.05, dueAt: 100000 },
    }).state;
    const liabilityId = state.businesses[0]!.liabilities[0]!.id;
    const result = engine.executeAction(state, {
      type: 'repay-loan',
      payload: { businessId, liabilityId, amount: '5000', tick: STEP },
    });
    const business = result.state.businesses.find((b) => b.id === businessId)!;
    expect(business.liabilities).toHaveLength(0);
    expect(business.cash).toBe('0');
  });

  it('caps the repayment at the outstanding principal', () => {
    let state = freshState();
    state = engine.executeAction(state, {
      type: 'purchase-business',
      payload: { businessTypeId: WATER_EXTRACTION_PLANT.id },
    }).state;
    const businessId = state.businesses[0]!.id;
    state = engine.executeAction(state, {
      type: 'take-loan',
      payload: { businessId, principal: '3000', interestRate: 0.05, dueAt: 100000 },
    }).state;
    const liabilityId = state.businesses[0]!.liabilities[0]!.id;
    // Request 9999 against a 3000 principal → capped at 3000.
    const result = engine.executeAction(state, {
      type: 'repay-loan',
      payload: { businessId, liabilityId, amount: '9999', tick: STEP },
    });
    const ev = result.events.find((e) => e.type === 'loan-repaid');
    expect(ev!.payload.principalPaid).toBe('3000');
    expect(ev!.payload.remainingPrincipal).toBe('0');
  });

  it('rejects an unknown liability id', () => {
    let state = freshState();
    state = engine.executeAction(state, {
      type: 'purchase-business',
      payload: { businessTypeId: WATER_EXTRACTION_PLANT.id },
    }).state;
    const businessId = state.businesses[0]!.id;
    expect(() =>
      engine.executeAction(state, {
        type: 'repay-loan',
        payload: { businessId, liabilityId: 'liability:nope', amount: '100', tick: STEP },
      }),
    ).toThrow(UnknownLiabilityError);
  });
});

describe('actions — hire / lay-off employees', () => {
  it('hire-employees increments the count + emits employees-hired', () => {
    let state = freshState();
    state = engine.executeAction(state, {
      type: 'purchase-business',
      payload: { businessTypeId: WATER_EXTRACTION_PLANT.id },
    }).state;
    const businessId = state.businesses[0]!.id;
    const result = engine.executeAction(state, {
      type: 'hire-employees',
      payload: { businessId, count: 3 },
    });
    const ev = result.events.find((e) => e.type === 'employees-hired');
    expect(ev!.payload.count).toBe(3);
    expect(ev!.payload.employeesAfter).toBe(2 + 3); // baseEmployees=2
    expect(result.state.businesses[0]!.employees).toBe(5);
  });

  it('lay-off-employees decrements the count (clamped at 0) + emits employees-laid-off', () => {
    let state = freshState();
    state = engine.executeAction(state, {
      type: 'purchase-business',
      payload: { businessTypeId: WATER_EXTRACTION_PLANT.id },
    }).state;
    const businessId = state.businesses[0]!.id;
    // Lay off 1 of 2.
    const result = engine.executeAction(state, {
      type: 'lay-off-employees',
      payload: { businessId, count: 1 },
    });
    const ev = result.events.find((e) => e.type === 'employees-laid-off');
    expect(ev!.payload.count).toBe(1);
    expect(ev!.payload.employeesAfter).toBe(1);
    // Lay off more than remain → clamped.
    const result2 = engine.executeAction(result.state, {
      type: 'lay-off-employees',
      payload: { businessId, count: 99 },
    });
    const ev2 = result2.events.find((e) => e.type === 'employees-laid-off');
    expect(ev2!.payload.count).toBe(1); // only 1 remained
    expect(ev2!.payload.employeesAfter).toBe(0);
  });
});

describe('actions — set-business-status', () => {
  it('sets the status between operating and idle', () => {
    let state = freshState();
    state = engine.executeAction(state, {
      type: 'purchase-business',
      payload: { businessTypeId: WATER_EXTRACTION_PLANT.id },
    }).state;
    const businessId = state.businesses[0]!.id;
    const idle = engine.executeAction(state, {
      type: 'set-business-status',
      payload: { businessId, status: 'idle' },
    });
    expect(idle.state.businesses[0]!.status).toBe('idle');
    const operating = engine.executeAction(idle.state, {
      type: 'set-business-status',
      payload: { businessId, status: 'operating' },
    });
    expect(operating.state.businesses[0]!.status).toBe('operating');
  });

  it('is idempotent (no event when status unchanged)', () => {
    let state = freshState();
    state = engine.executeAction(state, {
      type: 'purchase-business',
      payload: { businessTypeId: WATER_EXTRACTION_PLANT.id },
    }).state;
    const businessId = state.businesses[0]!.id;
    const result = engine.executeAction(state, {
      type: 'set-business-status',
      payload: { businessId, status: 'operating' }, // already operating
    });
    expect(result.events).toHaveLength(0);
  });

  it('rejects bankrupt / liquidating (system-internal transitions)', () => {
    let state = freshState();
    state = engine.executeAction(state, {
      type: 'purchase-business',
      payload: { businessTypeId: WATER_EXTRACTION_PLANT.id },
    }).state;
    const businessId = state.businesses[0]!.id;
    expect(() =>
      engine.executeAction(state, {
        type: 'set-business-status',
        payload: { businessId, status: 'bankrupt' },
      }),
    ).toThrow(InvalidBusinessStatusError);
    expect(() =>
      engine.executeAction(state, {
        type: 'set-business-status',
        payload: { businessId, status: 'liquidating' },
      }),
    ).toThrow(InvalidBusinessStatusError);
  });
});

// ---------------------------------------------------------------------------
// originalTree guard (GDD §16.1 / §16.2)
// ---------------------------------------------------------------------------

describe('originalTree guard — business actions never touch the original tree', () => {
  it('purchase/operate/sell/loan/repay/hire/layoff/status leave originalTree intact', () => {
    let state = freshState();
    const originalId = state.originalTree.id;
    const originalIsOriginal = state.originalTree.isOriginal;
    state = engine.executeAction(state, {
      type: 'purchase-business',
      payload: { businessTypeId: WATER_EXTRACTION_PLANT.id },
    }).state;
    const businessId = state.businesses[0]!.id;
    state = engine.executeAction(state, {
      type: 'take-loan',
      payload: { businessId, principal: '1000', interestRate: 0.05, dueAt: 1000 },
    }).state;
    state = engine.executeAction(state, {
      type: 'operate-business',
      payload: { businessId, tick: STEP },
    }).state;
    state = engine.executeAction(state, {
      type: 'hire-employees',
      payload: { businessId, count: 1 },
    }).state;
    state = engine.executeAction(state, {
      type: 'set-business-status',
      payload: { businessId, status: 'idle' },
    }).state;
    state = engine.executeAction(state, {
      type: 'set-business-status',
      payload: { businessId, status: 'operating' },
    }).state;
    state = engine.executeAction(state, {
      type: 'sell-business',
      payload: { businessId, tick: STEP },
    }).state;
    // The original tree is sacred + untouched throughout.
    expect(state.originalTree.id).toBe(originalId);
    expect(state.originalTree.id).toBe('original');
    expect(state.originalTree.isOriginal).toBe(originalIsOriginal);
    expect(state.originalTree.isOriginal).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BusinessSystem integration (registry slot #8)
// ---------------------------------------------------------------------------

describe('BusinessSystem — registry slot #8', () => {
  it('is registered at slot #8 in the default registry', () => {
    const ids = defaultRegistry.ids();
    expect(ids[7]).toBe('BusinessSystem'); // 0-indexed slot #8
  });

  it('runs production each tick for operating businesses + emits business-operated', () => {
    let state = freshState();
    state = engine.executeAction(state, {
      type: 'purchase-business',
      payload: { businessTypeId: WATER_EXTRACTION_PLANT.id },
    }).state;
    // Advance one tick (60s). The BusinessSystem runs production.
    const result = engine.advance(state, STEP);
    const ev = operatedEvent(result.events);
    expect(ev).toBeDefined();
    expect(ev!.payload.operated).toBe(true);
    expect(conservationDiscrepancy(result.state, INITIAL_SUPPLY)).toBe(0n);
  });

  it('emits business-bankrupt when a business crosses the threshold', () => {
    // Construct a business already below the bankruptcy threshold.
    const { state, businessId } = stateWithBusiness(WATER_EXTRACTION_PLANT, '-2000', {
      status: 'operating',
    });
    const ctx: SystemContext = {
      now: state.clock.elapsedSeconds + STEP,
      stepSeconds: STEP,
      dayOfYear: state.clock.day,
      rng: Rng.fromState(state.rngState),
    };
    const result = businessSystem.execute(state, ctx);
    const ev = result.events.find((e) => e.type === 'business-bankrupt');
    expect(ev).toBeDefined();
    expect(ev!.payload.businessId).toBe(businessId);
    expect(ev!.payload.status).toBe('bankrupt');
    expect(ev!.payload.threshold).toBe(PROVISIONAL_BUSINESS_BANKRUPTCY_THRESHOLD);
    const business = result.state.businesses.find((b) => b.id === businessId)!;
    expect(business.status).toBe('bankrupt');
  });

  it('periodically recomputes valuation (after a sim day)', () => {
    const { state, businessId } = stateWithBusiness(WATER_EXTRACTION_PLANT, '0', {
      assets: [{ id: 'a1', type: 'equipment', value: '50000' }],
    });
    // lastValuationTick=0; after 1 sim day the system recomputes.
    const ctx: SystemContext = {
      now: SECONDS_PER_DAY,
      stepSeconds: SECONDS_PER_DAY,
      dayOfYear: 1,
      rng: Rng.fromState(state.rngState),
    };
    const result = businessSystem.execute(state, ctx);
    const business = result.state.businesses.find((b) => b.id === businessId)!;
    expect(business.lastValuationTick).toBe(SECONDS_PER_DAY);
    // valuation recomputed from assets + profitability − liabilities.
    expect(business.valuation).not.toBe(WATER_EXTRACTION_PLANT.baseValuation);
  });
});

// ---------------------------------------------------------------------------
// Determinism + purity (TDD §18.3, §4.1)
// ---------------------------------------------------------------------------

describe('determinism + purity', () => {
  it('same (state, ctx) → same BusinessSystem result', () => {
    let state = freshState(7);
    state = engine.executeAction(state, {
      type: 'purchase-business',
      payload: { businessTypeId: WATER_EXTRACTION_PLANT.id },
    }).state;
    const ctx: SystemContext = {
      now: state.clock.elapsedSeconds + STEP,
      stepSeconds: STEP,
      dayOfYear: state.clock.day,
      rng: Rng.fromState(state.rngState),
    };
    const r1 = businessSystem.execute(state, ctx);
    const r2 = businessSystem.execute(state, ctx);
    expect(r2.state).toEqual(r1.state);
    expect(r2.events).toEqual(r1.events);
  });

  it('engine.advance determinism: same seed → same business state after N steps', () => {
    const make = (seed: number) => {
      let s = engine.initialize(cfg(seed));
      s = engine.executeAction(s, {
        type: 'purchase-business',
        payload: { businessTypeId: WATER_EXTRACTION_PLANT.id },
      }).state;
      return engine.advance(s, STEP * 3).state;
    };
    expect(make(99)).toEqual(make(99));
  });

  it('BusinessSystem.execute does NOT mutate its input (freeze test)', () => {
    let state = freshState(13);
    state = engine.executeAction(state, {
      type: 'purchase-business',
      payload: { businessTypeId: WATER_EXTRACTION_PLANT.id },
    }).state;
    const frozen = deepFreeze(structuredClone(state));
    const ctx: SystemContext = {
      now: state.clock.elapsedSeconds + STEP,
      stepSeconds: STEP,
      dayOfYear: state.clock.day,
      rng: Rng.fromState(state.rngState),
    };
    // Should not throw — the system deep-copies on entry.
    expect(() => businessSystem.execute(frozen, ctx)).not.toThrow();
  });

  it('executeAction(purchase-business) does NOT mutate its input (freeze test)', () => {
    const state = deepFreeze(structuredClone(freshState(13)));
    expect(() =>
      engine.executeAction(state, {
        type: 'purchase-business',
        payload: { businessTypeId: WATER_EXTRACTION_PLANT.id },
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// RNG fork deferred (R-P8-N — matches R-P7-1 precedent)
// ---------------------------------------------------------------------------

describe('BusinessSystem — RNG fork deferred (R-P8-N: zero root draws)', () => {
  it('execute() consumes ZERO root RNG draws (rng state unchanged)', () => {
    const initial = freshState(42);
    const rng = Rng.fromState(initial.rngState);
    const before = rng.getState();
    const ctx: SystemContext = {
      now: initial.clock.elapsedSeconds + STEP,
      stepSeconds: STEP,
      dayOfYear: initial.clock.day,
      rng,
    };
    businessSystem.execute(initial, ctx);
    // The BusinessSystem drew nothing (no fork). If a future change adds
    // ctx.rng.fork('BusinessSystem'), fork() advances the root by one draw
    // (rng.ts) and this assertion fails.
    expect(rng.getState()).toEqual(before);
  });

  it('a full engine.advance persists the SAME root RNG whether or not the BusinessSystem runs', () => {
    const initial = freshState(42);
    const full = engine.advance(initial, STEP);
    // Manually replay one step WITHOUT the BusinessSystem to isolate its
    // root-RNG contribution (mirrors runOneStep's RNG threading).
    const rng = Rng.fromState(initial.rngState);
    const ctx: SystemContext = {
      now: initial.clock.elapsedSeconds + STEP,
      stepSeconds: STEP,
      dayOfYear: initial.clock.day,
      rng,
    };
    let next: GameState = initial;
    for (const system of defaultRegistry.all()) {
      if (system.id === 'BusinessSystem') continue;
      const result = system.execute(next, ctx);
      next = result.state;
    }
    // The persisted root RNG position is IDENTICAL whether or not the
    // BusinessSystem ran — it contributes zero root draws, so the downstream
    // AutomationSystem + EnvironmentSystem RNG sequences are unaffected.
    expect(rng.getState()).toEqual(full.state.rngState);
  });

  it('does not shift the AutomationSystem / EnvironmentSystem RNG sequences (a business present still adds zero root draws)', () => {
    let withBusiness = freshState(42);
    withBusiness = engine.executeAction(withBusiness, {
      type: 'purchase-business',
      payload: { businessTypeId: WATER_EXTRACTION_PLANT.id },
    }).state;
    const rng = Rng.fromState(withBusiness.rngState);
    const ctx: SystemContext = {
      now: withBusiness.clock.elapsedSeconds + STEP,
      stepSeconds: STEP,
      dayOfYear: withBusiness.clock.day,
      rng,
    };
    const before = rng.getState();
    // Run every system EXCEPT BusinessSystem, then run BusinessSystem alone;
    // the BusinessSystem pass must not advance the root RNG.
    let next: GameState = withBusiness;
    for (const system of defaultRegistry.all()) {
      if (system.id === 'BusinessSystem') continue;
      next = system.execute(next, ctx).state;
    }
    const beforeBusinessPass = rng.getState();
    businessSystem.execute(next, ctx);
    expect(rng.getState()).toEqual(beforeBusinessPass);
    // And the BusinessSystem pass draws nothing relative to before the whole
    // step (the other systems' forks already advanced the root — that's
    // expected; the BusinessSystem adds nothing on top).
    void before;
  });
});

// ---------------------------------------------------------------------------
// Conservation invariant (TDD §10.4, §18.4)
// ---------------------------------------------------------------------------

describe('conservation — every money movement is a transaction', () => {
  it('holds across a full purchase → loan → operate → repay → sell cycle', () => {
    let state = freshState();
    state = engine.executeAction(state, {
      type: 'purchase-business',
      payload: { businessTypeId: WATER_EXTRACTION_PLANT.id },
    }).state;
    expect(conservationDiscrepancy(state, INITIAL_SUPPLY)).toBe(0n);
    const businessId = state.businesses[0]!.id;

    state = engine.executeAction(state, {
      type: 'take-loan',
      payload: { businessId, principal: '10000', interestRate: 0.05, dueAt: 100000 },
    }).state;
    expect(conservationDiscrepancy(state, INITIAL_SUPPLY)).toBe(0n);

    state = engine.advance(state, STEP).state; // one operate tick
    expect(conservationDiscrepancy(state, INITIAL_SUPPLY)).toBe(0n);

    const liabilityId = state.businesses[0]!.liabilities[0]!.id;
    state = engine.executeAction(state, {
      type: 'repay-loan',
      payload: { businessId, liabilityId, amount: '5000', tick: STEP },
    }).state;
    expect(conservationDiscrepancy(state, INITIAL_SUPPLY)).toBe(0n);

    state = engine.executeAction(state, {
      type: 'sell-business',
      payload: { businessId, tick: STEP },
    }).state;
    expect(conservationDiscrepancy(state, INITIAL_SUPPLY)).toBe(0n);
    expect(state.businesses).toHaveLength(0);
  });

  it('liabilities + cash balance after loan/repay (balance-sheet conservation)', () => {
    let state = freshState();
    state = engine.executeAction(state, {
      type: 'purchase-business',
      payload: { businessTypeId: WATER_EXTRACTION_PLANT.id },
    }).state;
    const businessId = state.businesses[0]!.id;
    // Take a 10000 loan: cash += 10000, liabilities += 10000 → net 0.
    state = engine.executeAction(state, {
      type: 'take-loan',
      payload: { businessId, principal: '10000', interestRate: 0.05, dueAt: 100000 },
    }).state;
    let b = state.businesses[0]!;
    expect(parseAmount(b.cash, 'cash') - sumLiabilities(b)).toBe(0n);
    // Repay 4000: cash -= 4000, liabilities -= 4000 → net still 0.
    const liabilityId = b.liabilities[0]!.id;
    state = engine.executeAction(state, {
      type: 'repay-loan',
      payload: { businessId, liabilityId, amount: '4000', tick: STEP },
    }).state;
    b = state.businesses[0]!;
    expect(parseAmount(b.cash, 'cash') - sumLiabilities(b)).toBe(0n);
  });
});

// ---------------------------------------------------------------------------
// Content gate (UnsupportedBusinessActionError)
// ---------------------------------------------------------------------------

describe('content gate — supportedActions', () => {
  it('all 9 business types support all 8 actions', () => {
    // P8a content lists all 8 actions on every business type. Verify the
    // handlers' content gate passes for each type × action.
    const allTypes = [
      WATER_EXTRACTION_PLANT,
      MINERAL_MINE,
      FERTILIZER_FACTORY,
    ];
    const actions = [
      'purchase-business',
      'operate-business',
      'sell-business',
      'take-loan',
      'repay-loan',
      'hire-employees',
      'lay-off-employees',
      'set-business-status',
    ] as const;
    for (const type of allTypes) {
      for (const action of actions) {
        expect(type.supportedActions).toContain(action);
      }
    }
  });
});
