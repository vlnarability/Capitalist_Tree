/**
 * Business per-business inventory tests (P8c — TDD §5.7, GDD §8.2 Supply
 * Chains; resolves P8b carry-forward #2: production consumes from
 * `business.inventory`, not the shared `state.inventory` pool).
 *
 * Asserts the per-business inventory invariants:
 *   - `business.inventory` holds inputs/outputs (the P8c field).
 *   - Production consumes inputs from `business.inventory` (the per-business
 *     stock), not the shared `state.inventory`.
 *   - Outputs sold to the market drain `business.inventory` (the sold
 *     quantity is debited); stockpiled outputs (no market) remain.
 *   - Buying inputs from the market credits `business.inventory` (replenish)
 *     before consumption debits it.
 *   - Insufficient inventory (with no market / upstream fallback) → the
 *     operate step skips with `insufficient-inputs` (zero output).
 */
import { describe, it, expect } from 'vitest';
import {
  engine,
  operateBusiness,
  resolveInputs,
  resolveOutputs,
  buildMarketPriceMap,
  createBusinessFromDefinition,
} from '../src/index.js';
import {
  conservationDiscrepancy,
  getBalance,
  registerAccount,
  parseAmount,
  transfer,
} from '../src/economy/index.js';
import { DEFAULT_GAME_CONFIG } from '../src/initial-state.js';
import { WATER_EXTRACTION_PLANT, FARM, FERTILIZER_FACTORY, MINERAL_MINE } from '@capitalist-tree/content';
import {
  type GameState,
  type GameConfig,
  type BusinessState,
  type BusinessTypeDefinition,
  PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
} from '@capitalist-tree/shared';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const SECONDS_PER_DAY = 24 * 60 * 60;
const INITIAL_SUPPLY = DEFAULT_GAME_CONFIG.startingPersonalCash; // '50000'

function cfg(seed: number): GameConfig {
  return { ...DEFAULT_GAME_CONFIG, seed };
}

function freshState(seed = 42): GameState {
  return engine.initialize(cfg(seed));
}

/** Build a state with one business, its account funded with `cash`. */
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
  state = registerAccount(state, {
    id: businessId,
    type: 'business',
    label: `Business — ${def.name}`,
    balance: '0',
  });
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
  }
  state = { ...state, businesses: [...state.businesses, business] };
  return { state, business, businessId };
}

/** Read a business's inventory quantity for a resource (0 if absent). */
function invQty(business: BusinessState, resourceId: string): number {
  const item = business.inventory.find((i) => i.resourceId === resourceId);
  return item ? item.quantity : 0;
}

/** Find a business-operated event. */
function operatedEvent(events: readonly { type: string }[]) {
  return events.find((e) => e.type === 'business-operated') as
    | { type: string; payload: Record<string, unknown> }
    | undefined;
}

// ---------------------------------------------------------------------------
// Per-business inventory field (P8c carry-forward #2)
// ---------------------------------------------------------------------------

describe('per-business inventory — holds inputs/outputs', () => {
  it('a freshly-created business starts with an empty inventory', () => {
    const business = createBusinessFromDefinition(
      WATER_EXTRACTION_PLANT,
      'business:test:0',
      'Test',
    );
    expect(business.inventory).toEqual([]);
  });

  it('a business constructed with pre-stocked inventory retains it', () => {
    const { business } = stateWithBusiness(WATER_EXTRACTION_PLANT, '0', {
      inventory: [
        { resourceId: 'resource:water', quantity: 100 },
        { resourceId: 'resource:food', quantity: 50 },
      ],
    });
    expect(invQty(business, 'resource:water')).toBe(100);
    expect(invQty(business, 'resource:food')).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Production consumes inputs from business.inventory
// ---------------------------------------------------------------------------

describe('production — consumes inputs from business.inventory', () => {
  it('resolveInputs sources from business.inventory when stocked (kind: business-inventory)', () => {
    // FARM consumes fertilizer + seeds + water. Pre-stock all three in the
    // business inventory → resolveInputs returns kind 'business-inventory'
    // for each (no market purchase).
    const { state, business } = stateWithBusiness(FARM, '100000', {
      inventory: [
        { resourceId: 'fertilizer:balanced-10-10-10', quantity: 100 },
        { resourceId: 'resource:seeds', quantity: 100 },
        { resourceId: 'resource:water', quantity: 100 },
      ],
    });
    const prices = buildMarketPriceMap(state);
    const result = resolveInputs(
      state,
      business,
      [
        { resourceId: 'fertilizer:balanced-10-10-10', quantity: 48 },
        { resourceId: 'resource:seeds', quantity: 48 },
        { resourceId: 'resource:water', quantity: 48 },
      ],
      prices,
    );
    expect(result.satisfied).toBe(true);
    expect(result.sources.every((s) => s.kind === 'business-inventory')).toBe(true);
    expect(result.marketCost).toBe('0'); // no market purchase
  });

  it('operateBusiness debits consumed inputs from business.inventory', () => {
    // FARM, full-day step → outputProduced = 48 food; consumes 48 each of
    // fertilizer, seeds, water. Pre-stock 100 of each → after operate, 52
    // of each remain (100 − 48). Food output is sold (drained) — see the
    // next describe block.
    const { state, business, businessId } = stateWithBusiness(FARM, '100000', {
      inventory: [
        { resourceId: 'fertilizer:balanced-10-10-10', quantity: 100 },
        { resourceId: 'resource:seeds', quantity: 100 },
        { resourceId: 'resource:water', quantity: 100 },
      ],
    });
    const result = operateBusiness(state, business, FARM, {
      now: SECONDS_PER_DAY,
      dtSeconds: SECONDS_PER_DAY,
    });
    expect(operatedEvent(result.events)!.payload.operated).toBe(true);
    const updated = result.state.businesses.find((b) => b.id === businessId)!;
    // Each input consumed 48 from the pre-stocked 100 → 52 remain.
    expect(invQty(updated, 'fertilizer:balanced-10-10-10')).toBe(52);
    expect(invQty(updated, 'resource:seeds')).toBe(52);
    expect(invQty(updated, 'resource:water')).toBe(52);
    // Conservation holds.
    expect(conservationDiscrepancy(result.state, INITIAL_SUPPLY)).toBe(0n);
  });

  it('does NOT debit the shared state.inventory for business-inventory sources', () => {
    // Same FARM scenario — the shared state.inventory is untouched (the
    // inputs came from business.inventory, not the shared pool).
    const { state, business } = stateWithBusiness(FARM, '100000', {
      inventory: [
        { resourceId: 'fertilizer:balanced-10-10-10', quantity: 100 },
        { resourceId: 'resource:seeds', quantity: 100 },
        { resourceId: 'resource:water', quantity: 100 },
      ],
    });
    // Put some fertilizer in the SHARED inventory too — it must remain.
    const withShared: GameState = {
      ...state,
      inventory: {
        items: [{ resourceId: 'fertilizer:balanced-10-10-10', quantity: 999 }],
      },
    };
    const result = operateBusiness(withShared, business, FARM, {
      now: SECONDS_PER_DAY,
      dtSeconds: SECONDS_PER_DAY,
    });
    // Shared inventory fertilizer untouched (the business used its own stock).
    const sharedFert = result.state.inventory.items.find(
      (i) => i.resourceId === 'fertilizer:balanced-10-10-10',
    );
    expect(sharedFert!.quantity).toBe(999);
  });
});

// ---------------------------------------------------------------------------
// Outputs sold to market drain inventory; stockpiled outputs remain
// ---------------------------------------------------------------------------

describe('outputs — sold to market drain inventory; stockpiled outputs remain', () => {
  it('a sold output is drained from business.inventory (credited then debited)', () => {
    // WATER_EXTRACTION_PLANT produces resource:water (market:water). Full-day
    // step → outputProduced = 180. The output is credited to business.inventory
    // (180) then sold (180 debited) → net 0 (the entry is dropped, since the
    // quantity fell to 0). Pre-stock 50 water → after, 50 + 180 − 180 = 50
    // (the pre-stock is untouched; the produced output was sold).
    const { state, business, businessId } = stateWithBusiness(
      WATER_EXTRACTION_PLANT,
      '0',
      { inventory: [{ resourceId: 'resource:water', quantity: 50 }] },
    );
    const result = operateBusiness(state, business, WATER_EXTRACTION_PLANT, {
      now: SECONDS_PER_DAY,
      dtSeconds: SECONDS_PER_DAY,
    });
    const updated = result.state.businesses.find((b) => b.id === businessId)!;
    // The produced 180 was sold (drained) — only the pre-stock 50 remains.
    expect(invQty(updated, 'resource:water')).toBe(50);
  });

  it('a stockpiled output (no market) remains in business.inventory', () => {
    // MINERAL_MINE produces resource:minerals (no market → destination
    // 'stockpile'). Full-day step → outputProduced = 200. The output is
    // credited to business.inventory (200) and NOT debited (no sale).
    // cash 100000 covers wages (3000).
    const { state, business, businessId } = stateWithBusiness(MINERAL_MINE, '100000');
    const result = operateBusiness(state, business, MINERAL_MINE, {
      now: SECONDS_PER_DAY,
      dtSeconds: SECONDS_PER_DAY,
    });
    expect(operatedEvent(result.events)!.payload.operated).toBe(true);
    const updated = result.state.businesses.find((b) => b.id === businessId)!;
    // The 200 minerals were stockpiled (no market to drain them).
    expect(invQty(updated, 'resource:minerals')).toBe(200);
  });

  it('contrast: sold output drained vs stockpiled output retained', () => {
    // Two businesses: water plant (output sold) + mineral mine (output
    // stockpiled). After a full-day operate, water inventory = 0 (sold),
    // minerals inventory = 200 (stockpiled). This proves the sale drains
    // inventory while the stockpile does not.
    const water = stateWithBusiness(WATER_EXTRACTION_PLANT, '0');
    const waterResult = operateBusiness(water.state, water.business, WATER_EXTRACTION_PLANT, {
      now: SECONDS_PER_DAY,
      dtSeconds: SECONDS_PER_DAY,
    });
    const mine = stateWithBusiness(MINERAL_MINE, '100000');
    const mineResult = operateBusiness(mine.state, mine.business, MINERAL_MINE, {
      now: SECONDS_PER_DAY,
      dtSeconds: SECONDS_PER_DAY,
    });
    const waterAfter = waterResult.state.businesses[0]!;
    const mineAfter = mineResult.state.businesses[0]!;
    expect(invQty(waterAfter, 'resource:water')).toBe(0); // sold → drained
    expect(invQty(mineAfter, 'resource:minerals')).toBe(200); // stockpiled
  });
});

// ---------------------------------------------------------------------------
// Buying inputs from market adds to inventory
// ---------------------------------------------------------------------------

describe('buying inputs from market — credits business.inventory', () => {
  it('resolveInputs sources from the market when business.inventory lacks the input', () => {
    // FARM with no inventory → all three inputs bought from the market.
    const { state, business } = stateWithBusiness(FARM, '100000');
    const prices = buildMarketPriceMap(state);
    const result = resolveInputs(
      state,
      business,
      [
        { resourceId: 'fertilizer:balanced-10-10-10', quantity: 48 },
        { resourceId: 'resource:seeds', quantity: 48 },
        { resourceId: 'resource:water', quantity: 48 },
      ],
      prices,
    );
    expect(result.satisfied).toBe(true);
    expect(result.sources.every((s) => s.kind === 'market')).toBe(true);
    // marketCost = 48×500 + 48×200 + 48×10 = 24000 + 9600 + 480 = 34080.
    expect(parseAmount(result.marketCost, 'marketCost')).toBe(34080n);
  });

  it('operateBusiness credits the purchased inputs to business.inventory (then debits)', () => {
    // FARM with no inventory, cash 100000. Full-day step → buys 48 each of
    // fertilizer, seeds, water from the market. The purchase credits each to
    // business.inventory (replenish), then consumption debits 48 each → net
    // 0 (the entries are dropped). The food output is sold (drained).
    // Verify: the business.inventory does NOT contain negative quantities
    // (the credit offset the debit — the input was replenished before being
    // consumed) AND the market-buy transactions were recorded.
    const { state, business, businessId } = stateWithBusiness(FARM, '100000');
    const txnsBefore = state.economy.transactions.length;
    const result = operateBusiness(state, business, FARM, {
      now: SECONDS_PER_DAY,
      dtSeconds: SECONDS_PER_DAY,
    });
    expect(operatedEvent(result.events)!.payload.operated).toBe(true);
    const updated = result.state.businesses.find((b) => b.id === businessId)!;
    // No negative inventory quantities (the credit offset the debit).
    expect(updated.inventory.every((i) => i.quantity >= 0)).toBe(true);
    // The market-buy transactions were recorded (business → market for each
    // input).
    const newTxns = result.state.economy.transactions.slice(txnsBefore);
    const fertBuy = newTxns.find(
      (t) => t.destinationAccount === 'market:fertilizer' && t.sourceAccount === businessId,
    );
    expect(fertBuy).toBeDefined();
    expect(fertBuy!.amount).toBe('24000'); // 48 × 500
    // Conservation holds.
    expect(conservationDiscrepancy(result.state, INITIAL_SUPPLY)).toBe(0n);
  });

  it('partial inventory falls through to the market (all-or-nothing per input)', () => {
    // FARM with 10 fertilizer (less than the 48 needed). resolveInputs sees
    // business.inventory has 10 < 48 → falls through to the market (buys all
    // 48 from the market). The 10 in inventory is NOT partially consumed
    // (the model is all-or-nothing per input).
    const { state, business } = stateWithBusiness(FARM, '100000', {
      inventory: [{ resourceId: 'fertilizer:balanced-10-10-10', quantity: 10 }],
    });
    const prices = buildMarketPriceMap(state);
    const result = resolveInputs(
      state,
      business,
      [{ resourceId: 'fertilizer:balanced-10-10-10', quantity: 48 }],
      prices,
    );
    expect(result.satisfied).toBe(true);
    // The input is sourced from the market (inventory had < 48).
    expect(result.sources[0]!.kind).toBe('market');
  });
});

// ---------------------------------------------------------------------------
// Insufficient inventory → reduced/zero output
// ---------------------------------------------------------------------------

describe('insufficient inventory → zero output (skip)', () => {
  it('skips with insufficient-inputs when an input has no inventory + no market', () => {
    // FERTILIZER_FACTORY consumes resource:chemicals (no market, no upstream).
    // No inventory of chemicals → unsatisfied → skip 'insufficient-inputs'.
    const { state, business } = stateWithBusiness(FERTILIZER_FACTORY, '100000');
    const result = operateBusiness(state, business, FERTILIZER_FACTORY, {
      now: SECONDS_PER_DAY,
      dtSeconds: SECONDS_PER_DAY,
    });
    const ev = operatedEvent(result.events)!;
    expect(ev.payload.operated).toBe(false);
    expect(ev.payload.reason).toBe('insufficient-inputs');
    expect(ev.payload.outputQuantity).toBe(0);
    // No money moved, no inventory change.
    expect(conservationDiscrepancy(result.state, INITIAL_SUPPLY)).toBe(0n);
  });

  it('insufficient inventory quantity (< required) falls through to unsatisfied when no market', () => {
    // FERTILIZER_FACTORY with 10 chemicals in inventory (< 225 needed).
    // resolveInputs: business-inventory has 10 < 225 → fall through → no
    // upstream → no shared inventory → no market for chemicals → unsatisfied.
    const { state, business } = stateWithBusiness(FERTILIZER_FACTORY, '100000', {
      inventory: [{ resourceId: 'resource:chemicals', quantity: 10 }],
    });
    const prices = buildMarketPriceMap(state);
    const result = resolveInputs(
      state,
      business,
      [{ resourceId: 'resource:chemicals', quantity: 225 }],
      prices,
    );
    expect(result.satisfied).toBe(false);
    expect(result.unsatisfiedResource).toBe('resource:chemicals');
    expect(result.sources[0]!.kind).toBe('unsatisfied');
  });

  it('a fully-stocked inventory lets the business operate with zero cash (no market purchases)', () => {
    // FARM with all inputs in inventory (no market purchases needed). Even
    // with cash 0, the business can operate IF wages are 0 (sub-day step) OR
    // revenue covers wages. Full-day: wages = 1800, revenue = 48 × 300 =
    // 14400. cash 0 + revenue 14400 >= 1800 → proceeds. Verify the operate
    // succeeds with no market purchases (all inputs from business.inventory).
    const { state, business, businessId } = stateWithBusiness(FARM, '0', {
      inventory: [
        { resourceId: 'fertilizer:balanced-10-10-10', quantity: 100 },
        { resourceId: 'resource:seeds', quantity: 100 },
        { resourceId: 'resource:water', quantity: 100 },
      ],
    });
    const result = operateBusiness(state, business, FARM, {
      now: SECONDS_PER_DAY,
      dtSeconds: SECONDS_PER_DAY,
    });
    expect(operatedEvent(result.events)!.payload.operated).toBe(true);
    const updated = result.state.businesses.find((b) => b.id === businessId)!;
    // Inputs consumed from business.inventory (100 − 48 = 52 each).
    expect(invQty(updated, 'fertilizer:balanced-10-10-10')).toBe(52);
    expect(invQty(updated, 'resource:seeds')).toBe(52);
    expect(invQty(updated, 'resource:water')).toBe(52);
    // Food output sold (drained) — not in inventory.
    expect(invQty(updated, 'resource:food')).toBe(0);
    // Conservation holds.
    expect(conservationDiscrepancy(result.state, INITIAL_SUPPLY)).toBe(0n);
  });
});
