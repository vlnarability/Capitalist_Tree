/**
 * Business market simulation tests (P8c — TDD §11, GDD §8.5 Market Simulation;
 * resolves P8b carry-forward #1: revenue from a market sale, not authority
 * issuance).
 *
 * Asserts the invariants the GDD §8.5 market simulation requires:
 *   - clearMarkets: price drifts toward supply/demand equilibrium (high
 *     demand → price rises; high supply → price falls), bounded by
 *     PROVISIONAL_BUSINESS_MARKET_PRICE_VOLATILITY per tick.
 *   - clearMarkets: ensures all 8 GDD §8.5 commodity markets (water,
 *     fertilizer, seeds, equipment, food, energy, labor, land) are live.
 *   - executeMarketTransaction: buyer → seller money movement recorded as
 *     transactions; conservation invariant holds.
 *   - executeMarketTransaction: demand-injection backstop — when the market
 *     account is the buyer and lacks balance, the authority injects just
 *     enough liquidity (external demand) so the sale succeeds.
 *   - operateBusiness revenue: comes from a market → business sale (NOT an
 *     authority → business issuance). The sale transaction's sourceAccount
 *     is the market account, not the authority.
 *   - operateBusiness input costs: the business pays the market
 *     (business → market transfer), not the authority.
 */
import { describe, it, expect } from 'vitest';
import {
  engine,
  operateBusiness,
  clearMarkets,
  executeMarketTransaction,
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
import { WATER_EXTRACTION_PLANT, FARM } from '@capitalist-tree/content';
import {
  type GameState,
  type GameConfig,
  type BusinessState,
  type BusinessTypeDefinition,
  type SimulationEvent,
  PROVISIONAL_BUSINESS_MARKET_PRICE_VOLATILITY,
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

/**
 * Build a state with one business instantiated from a definition, its cash
 * account funded with `cash` via an authority issuance (conservation-safe).
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
  } else if (cashAmount < 0n) {
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

/** Override a market's supply/demand in the state (returns a new state). */
function withMarket(
  state: GameState,
  marketId: string,
  patch: { supply?: number; demand?: number; price?: string },
): GameState {
  return {
    ...state,
    economy: {
      ...state.economy,
      markets: state.economy.markets.map((m) =>
        m.id === marketId
          ? {
              ...m,
              ...(patch.supply !== undefined ? { supply: patch.supply } : {}),
              ...(patch.demand !== undefined ? { demand: patch.demand } : {}),
              ...(patch.price !== undefined ? { price: patch.price } : {}),
            }
          : m,
      ),
    },
  };
}

/** Find a market-price-changed event for a given market id. */
function priceChangedEvent(
  events: readonly SimulationEvent[],
  marketId: string,
) {
  return events.find(
    (e) => e.type === 'market-price-changed' && e.payload.marketId === marketId,
  );
}

// ---------------------------------------------------------------------------
// clearMarkets — price drift (GDD §8.5)
// ---------------------------------------------------------------------------

describe('clearMarkets — price drift toward supply/demand equilibrium', () => {
  it('raises the price when demand > supply (high demand)', () => {
    // Fertilizer market: base price 500. Set demand=1000, supply=100.
    // imbalance = (1000-100)/1100 ≈ 0.818; fractionChange = clamp(0.0818) =
    // 0.0818; newPrice = floor(500 × 1.0818) = floor(540.9) = 540.
    let state = freshState();
    state = withMarket(state, 'market:fertilizer', { supply: 100, demand: 1000 });
    const oldPrice = parseAmount(
      state.economy.markets.find((m) => m.id === 'market:fertilizer')!.price,
      'price',
    );
    const result = clearMarkets(state, 100);
    const newPrice = parseAmount(
      result.state.economy.markets.find((m) => m.id === 'market:fertilizer')!.price,
      'price',
    );
    expect(newPrice).toBeGreaterThan(oldPrice);
    expect(newPrice).toBe(540n);
    // A market-price-changed event was emitted.
    const ev = priceChangedEvent(result.events, 'market:fertilizer');
    expect(ev).toBeDefined();
    expect(ev!.payload.oldPrice).toBe(oldPrice.toString(10));
    expect(ev!.payload.newPrice).toBe(newPrice.toString(10));
  });

  it('lowers the price when supply > demand (high supply)', () => {
    // Fertilizer market: base price 500. Set demand=10, supply=1000.
    // imbalance = (10-1000)/1010 ≈ -0.9802; fractionChange = clamp(-0.09802) =
    // -0.09802; newPrice = floor(500 × 0.90198) = floor(450.99) = 450.
    let state = freshState();
    state = withMarket(state, 'market:fertilizer', { supply: 1000, demand: 10 });
    const oldPrice = parseAmount(
      state.economy.markets.find((m) => m.id === 'market:fertilizer')!.price,
      'price',
    );
    const result = clearMarkets(state, 100);
    const newPrice = parseAmount(
      result.state.economy.markets.find((m) => m.id === 'market:fertilizer')!.price,
      'price',
    );
    expect(newPrice).toBeLessThan(oldPrice);
    expect(newPrice).toBe(450n);
  });

  it('leaves the price unchanged when supply === demand (equilibrium)', () => {
    // Water market: supply=50, demand=50. imbalance = 0; fractionChange = 0;
    // newPrice = floor(10 × 1.0) = 10 (unchanged).
    let state = freshState();
    state = withMarket(state, 'market:water', { supply: 50, demand: 50 });
    const oldPrice = state.economy.markets.find((m) => m.id === 'market:water')!.price;
    const result = clearMarkets(state, 100);
    const newPrice = result.state.economy.markets.find(
      (m) => m.id === 'market:water',
    )!.price;
    expect(newPrice).toBe(oldPrice);
    // No market-price-changed event for water (price did not move).
    const ev = priceChangedEvent(result.events, 'market:water');
    expect(ev).toBeUndefined();
  });

  it('bounds the price change within ±volatility × currentPrice per tick', () => {
    // Extreme imbalance (demand >> supply) — the fractionChange is clamped to
    // ±volatility. newPrice must be within [old × (1-vol), old × (1+vol)].
    let state = freshState();
    state = withMarket(state, 'market:fertilizer', { supply: 1, demand: 1000000 });
    const oldPrice = parseAmount(
      state.economy.markets.find((m) => m.id === 'market:fertilizer')!.price,
      'price',
    );
    const result = clearMarkets(state, 100);
    const newPrice = parseAmount(
      result.state.economy.markets.find((m) => m.id === 'market:fertilizer')!.price,
      'price',
    );
    const upperBound = BigInt(
      Math.floor(Number(oldPrice) * (1 + PROVISIONAL_BUSINESS_MARKET_PRICE_VOLATILITY)),
    );
    const lowerBound = BigInt(
      Math.floor(Number(oldPrice) * (1 - PROVISIONAL_BUSINESS_MARKET_PRICE_VOLATILITY)),
    );
    expect(newPrice).toBeGreaterThanOrEqual(lowerBound);
    expect(newPrice).toBeLessThanOrEqual(upperBound);
    // The extreme imbalance clamps to +volatility: newPrice = floor(500 ×
    // 1.09999...) = floor(549.999) = 549 (just below the 550 upper bound due
    // to floating-point representation of the clamped fraction).
    expect(newPrice).toBe(549n);
  });

  it('ensures the three P3b-deferred markets (equipment, labor, land) are live', () => {
    // A fresh state has only the 5 P3b markets (water, fertilizer, seeds, food,
    // energy). clearMarkets adds equipment, labor, land on first encounter.
    const state = freshState();
    expect(state.economy.markets.find((m) => m.id === 'market:equipment')).toBeUndefined();
    const result = clearMarkets(state, 100);
    const ids = result.state.economy.markets.map((m) => m.id);
    expect(ids).toContain('market:equipment');
    expect(ids).toContain('market:labor');
    expect(ids).toContain('market:land');
    // Total 8 GDD §8.5 markets.
    expect(result.state.economy.markets.length).toBe(8);
    // The deferred market accounts were registered.
    expect(
      result.state.economy.accounts.find((a) => a.id === 'market:equipment'),
    ).toBeDefined();
  });

  it('is idempotent — repeated calls do not add duplicate markets', () => {
    const state = freshState();
    const r1 = clearMarkets(state, 100);
    const r2 = clearMarkets(r1.state, 200);
    // Still exactly 8 markets (no duplicates).
    expect(r2.state.economy.markets.length).toBe(8);
    // Still exactly one account per market (no duplicate accounts).
    const marketAccountIds = r2.state.economy.accounts
      .filter((a) => a.id.startsWith('market:'))
      .map((a) => a.id);
    expect(new Set(marketAccountIds).size).toBe(marketAccountIds.length);
  });
});

// ---------------------------------------------------------------------------
// executeMarketTransaction — money movement + conservation
// ---------------------------------------------------------------------------

describe('executeMarketTransaction — buyer → seller at the clearing price', () => {
  it('moves quantity × price from buyer to seller (money conservation)', () => {
    // Set up: a buyer business with cash, a seller business, and the water
    // market (price 10). Buyer buys 50 water @ 10 = 500 from the market.
    let state = freshState();
    const buyerId = 'business:buyer:0';
    const sellerId = 'market:water';
    state = registerAccount(state, {
      id: buyerId,
      type: 'business',
      label: 'Buyer',
      balance: '0',
    });
    // Fund the buyer with 1000 (authority issuance).
    state = transfer(state, {
      sourceAccount: PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
      destinationAccount: buyerId,
      amount: '1000',
      category: 'test-fund',
      description: 'Fund buyer',
      timestamp: 0,
      requestId: 'fund-buyer',
    });
    const txnsBefore = state.economy.transactions.length;
    const result = executeMarketTransaction(state, {
      marketId: 'market:water',
      buyer: buyerId,
      seller: sellerId,
      quantity: 50,
      price: '10',
      timestamp: 100,
      category: 'business-market-buy',
      description: 'Buyer buys 50 water',
    });
    // 1 transaction (no demand injection — the seller is the market account,
    // and the buyer has sufficient balance).
    expect(result.transactions.length).toBe(1);
    expect(result.total).toBe('500');
    expect(result.demandInjected).toBe(false);
    // Buyer debited 500; market:water credited 500.
    expect(getBalance(result.state, buyerId)).toBe(500n);
    expect(getBalance(result.state, 'market:water')).toBe(500n);
    // Transaction recorded.
    expect(result.state.economy.transactions.length).toBe(txnsBefore + 1);
    // Conservation holds.
    expect(conservationDiscrepancy(result.state, INITIAL_SUPPLY)).toBe(0n);
  });

  it('injects demand liquidity when the market account is the buyer and lacks balance', () => {
    // The market:water account starts at '0'. A business sells 100 water @ 10
    // = 1000 to the market. The market account (buyer) has 0 < 1000, so the
    // authority injects 1000 (external demand) → then market → business.
    let state = freshState();
    const sellerId = 'business:seller:0';
    state = registerAccount(state, {
      id: sellerId,
      type: 'business',
      label: 'Seller',
      balance: '0',
    });
    const marketBalanceBefore = getBalance(state, 'market:water');
    expect(marketBalanceBefore).toBe(0n);
    const result = executeMarketTransaction(state, {
      marketId: 'market:water',
      buyer: 'market:water',
      seller: sellerId,
      quantity: 100,
      price: '10',
      timestamp: 100,
      category: 'business-market-sale',
      description: 'Seller sells 100 water to market',
    });
    // 2 transactions: demand injection (authority → market) + sale (market → seller).
    expect(result.transactions.length).toBe(2);
    expect(result.demandInjected).toBe(true);
    expect(result.injectedAmount).toBe('1000');
    expect(result.total).toBe('1000');
    // Seller credited 1000.
    expect(getBalance(result.state, sellerId)).toBe(1000n);
    // Market account back to 0 (injected 1000, then paid 1000 to seller).
    expect(getBalance(result.state, 'market:water')).toBe(0n);
    // Conservation holds (injection is an issuance; sale is a transfer).
    expect(conservationDiscrepancy(result.state, INITIAL_SUPPLY)).toBe(0n);
  });

  it('is a no-op for zero quantity (no transactions, no state change)', () => {
    const state = freshState();
    const result = executeMarketTransaction(state, {
      marketId: 'market:water',
      buyer: 'market:water',
      seller: 'business:seller:0',
      quantity: 0,
      price: '10',
      timestamp: 100,
      category: 'business-market-sale',
    });
    expect(result.transactions).toEqual([]);
    expect(result.total).toBe('0');
    expect(result.demandInjected).toBe(false);
    // State unchanged (same reference — no copy for a no-op).
    expect(result.state).toBe(state);
  });
});

// ---------------------------------------------------------------------------
// operateBusiness — revenue comes from a market sale (P8c carry-forward #1)
// ---------------------------------------------------------------------------

describe('operateBusiness — revenue from a market sale (NOT authority issuance)', () => {
  it('sells output to the market: the sale transaction is market → business', () => {
    // WATER_EXTRACTION_PLANT: produces resource:water (market:water, price 10).
    // Full-day step → outputProduced = 180. actualRevenue = 180 × 10 = 1800.
    // The sale is executeMarketTransaction(buyer=market:water, seller=business).
    const { state, business } = stateWithBusiness(WATER_EXTRACTION_PLANT, '0');
    const txnsBefore = state.economy.transactions.length;
    const result = operateBusiness(state, business, WATER_EXTRACTION_PLANT, {
      now: SECONDS_PER_DAY,
      dtSeconds: SECONDS_PER_DAY,
    });
    // The revenue transactions: demand injection (authority → market:water)
    // + sale (market:water → business). NEITHER is authority → business
    // issuance for the revenue (the authority → market injection is the
    // external-demand backstop, not the revenue itself).
    const newTxns = result.state.economy.transactions.slice(txnsBefore);
    // There must be a market:water → business sale transaction.
    const saleTxn = newTxns.find(
      (t) => t.sourceAccount === 'market:water' && t.destinationAccount === business.id,
    );
    expect(saleTxn).toBeDefined();
    expect(saleTxn!.amount).toBe('1800');
    // There must be NO authority → business transaction (P8b's issuance model
    // is gone — revenue is NOT recognized as authority → business issuance).
    const authorityToBusiness = newTxns.find(
      (t) =>
        t.sourceAccount === PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID &&
        t.destinationAccount === business.id,
    );
    expect(authorityToBusiness).toBeUndefined();
    // Business cash: 0 + 1800 (sale) − 800 (wages) = 1000.
    expect(getBalance(result.state, business.id)).toBe(1000n);
    // Conservation holds.
    expect(conservationDiscrepancy(result.state, INITIAL_SUPPLY)).toBe(0n);
  });

  it('input costs pay the market (business → market transfer)', () => {
    // FARM: consumes fertilizer + seeds + water (all market-able), produces
    // food (market:food, price 300). Full-day step → outputProduced = 48.
    // Inputs: 48 each of fertilizer (500), seeds (200), water (10).
    // The business buys each input from its market (business → market).
    const { state, business } = stateWithBusiness(FARM, '100000');
    const txnsBefore = state.economy.transactions.length;
    const result = operateBusiness(state, business, FARM, {
      now: SECONDS_PER_DAY,
      dtSeconds: SECONDS_PER_DAY,
    });
    const newTxns = result.state.economy.transactions.slice(txnsBefore);
    // Input purchases: business → market:fertilizer, market:seeds, market:water.
    const fertBuy = newTxns.find(
      (t) => t.sourceAccount === business.id && t.destinationAccount === 'market:fertilizer',
    );
    const seedsBuy = newTxns.find(
      (t) => t.sourceAccount === business.id && t.destinationAccount === 'market:seeds',
    );
    const waterBuy = newTxns.find(
      (t) => t.sourceAccount === business.id && t.destinationAccount === 'market:water',
    );
    expect(fertBuy).toBeDefined();
    expect(seedsBuy).toBeDefined();
    expect(waterBuy).toBeDefined();
    // 48 fertilizer × 500 = 24000.
    expect(fertBuy!.amount).toBe('24000');
    // 48 seeds × 200 = 9600.
    expect(seedsBuy!.amount).toBe('9600');
    // 48 water × 10 = 480.
    expect(waterBuy!.amount).toBe('480');
    // Conservation holds.
    expect(conservationDiscrepancy(result.state, INITIAL_SUPPLY)).toBe(0n);
  });

  it('market transactions adjust the market supply/demand (sale absorbed by market)', () => {
    // When the market is the buyer (sale), supply += quantity (the market
    // absorbs the output). Verify the water market's supply grew.
    const { state, business } = stateWithBusiness(WATER_EXTRACTION_PLANT, '0');
    const supplyBefore = state.economy.markets.find(
      (m) => m.id === 'market:water',
    )!.supply;
    const result = executeMarketTransaction(state, {
      marketId: 'market:water',
      buyer: 'market:water',
      seller: business.id,
      quantity: 50,
      price: '10',
      timestamp: 100,
      category: 'business-market-sale',
    });
    const supplyAfter = result.state.economy.markets.find(
      (m) => m.id === 'market:water',
    )!.supply;
    // Market absorbed 50 units → supply += 50.
    expect(supplyAfter).toBe(supplyBefore + 50);
  });
});
