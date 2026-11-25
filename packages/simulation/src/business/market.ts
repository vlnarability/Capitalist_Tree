/**
 * Business market simulation helpers (P8c — TDD §11 Personal and Business
 * Accounting; GDD §8.4 Growth Pressure, §8.5 Market Simulation; resolves
 * P8b carry-forward #1: revenue recognized as authority issuance).
 *
 * Two pure helpers:
 *
 *   - `clearMarkets(state, dtSeconds)`: per-tick market clearing. Ensures
 *     all 8 GDD §8.5 commodity markets (water, fertilizer, seeds, equipment,
 *     food, energy, labor, land) have live `MarketState` entries — adds the
 *     three P3b-deferred markets (equipment, labor, land) with their
 *     `PROVISIONAL_MARKET_PRICE_*` baseline + a registered `market:<id>`
 *     account on first encounter. Then advances each market's clearing price
 *     toward the supply/demand equilibrium, bounded by
 *     `PROVISIONAL_BUSINESS_MARKET_PRICE_VOLATILITY` per tick (GDD §8.5:
 *     prices fluctuate but do not swing wildly). Emits one
 *     `market-price-changed` event per market whose price moved.
 *
 *   - `executeMarketTransaction(state, params)`: the canonical
 *     buyer→seller money movement at the clearing price. Transfers
 *     `quantity × price` from the buyer's account to the seller's account
 *     via the economy `transfer()` (pillar 1 — every movement a
 *     transaction). When the buyer is a market account with insufficient
 *     balance AND `PROVISIONAL_BUSINESS_MARKET_DEMAND_INJECTION_ENABLED` is
 *     `true`, the authority injects just enough liquidity (issuance →
 *     market account) to fund the purchase — representing external market
 *     demand (buyers from outside the simulation). This makes the market a
 *     REAL PARTICIPANT (the transfer is market → business, not authority →
 *     business issuance — resolving P8b carry-forward #1). Adjusts the
 *     market's supply/demand to reflect the transaction.
 *
 * ## Revenue routing (P8b carry-forward #1 resolution)
 *
 * P8b recognized business revenue as `authority → business` (issuance) —
 * the market was an IMPLICIT buyer. P8c routes revenue THROUGH the market:
 * the business sells output to the market at the clearing price via
 * `executeMarketTransaction(buyer=marketAccount, seller=business)`. The
 * market account is a real participant with a balance; when it lacks
 * liquidity, the authority injects just enough to cover the sale (external
 * demand). Conservation holds: the injection is an issuance (increments
 * `totalIssued`), the market→business transfer preserves money.
 *
 * ## The 8 GDD §8.5 markets
 *
 *   - water, fertilizer, seeds, food, energy — registered by P3b's initial
 *     state (`packages/simulation/src/initial-state.ts`).
 *   - equipment, labor, land — DEFERRED by P3b; P8c's `clearMarkets` adds
 *     them on first encounter with `PROVISIONAL_MARKET_PRICE_*` baselines.
 *
 * All functions are pure: they return a new state and never mutate input.
 * Deterministic given (state, params). Money is bigint minor units
 * serialized as string (TDD §10.1) — never floating point.
 *
 * @provisional (GDD §17: market simulation / price volatility / external
 * demand) — the linear supply/demand price drift + the demand-injection
 * liquidity backstop are starter mechanics; P5+ tuning will calibrate from
 * playtest data.
 *
 * R-P8-2 (carry-forward): the demand-injection liquidity backstop stands in
 * for external market demand so the market can always absorb output at game
 * start (when market accounts hold '0'). Real downstream→upstream payment
 * routing (the downstream business paying the upstream for the input it
 * consumed via vertical integration) is DEFERRED — the backstop is the
 * P8c placeholder. See docs/business.md §16 (R-P8-2).
 */
import type { GameState, MarketState, SimulationEvent } from '@capitalist-tree/shared';
import {
  PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
  PROVISIONAL_BUSINESS_MARKET_PRICE_VOLATILITY,
  PROVISIONAL_BUSINESS_MARKET_DEMAND_INJECTION_ENABLED,
  PROVISIONAL_BUSINESS_MARKET_DEMAND_INJECTION_MAX_PER_TICK_MINOR,
  PROVISIONAL_MARKET_PRICE_EQUIPMENT,
  PROVISIONAL_MARKET_PRICE_LABOR,
  PROVISIONAL_MARKET_PRICE_LAND,
} from '@capitalist-tree/shared';
import { transfer, getBalance, parseAmount, registerAccount } from '../economy/ledger.js';
import { deriveMarketAccountId, priceMoveIsSignificant } from '../economy/markets.js';

/** Transaction categories (free-form strings — NOT Zod enums). */
const CATEGORY_BUSINESS_MARKET_SALE = 'business-market-sale';
const CATEGORY_BUSINESS_MARKET_BUY = 'business-market-buy';
const CATEGORY_BUSINESS_MARKET_DEMAND = 'business-market-demand';

/**
 * The three GDD §8.5 commodity markets P3b deferred (equipment, labor, land).
 * P8c's `clearMarkets` adds them on first encounter with these baseline
 * prices + commodity ids. The other 5 markets (water, fertilizer, seeds,
 * food, energy) are registered by P3b's initial state.
 *
 * R-P8-8 (carry-forward): these 3 markets are referenced by id in content
 * (e.g. `business:equipment-factory.marketParticipation` includes
 * `'market:equipment'`) but have NO live `MarketState` entries pre-seeded in
 * the initial state — they are created on first encounter via `clearMarkets`.
 * A future phase may pre-seed them in `initial-state.ts` so the
 * EconomySystem's `updateMarkets` mean-reverts them from tick 0. See
 * docs/business.md §16 (R-P8-8).
 *
 * @provisional (GDD §17: market simulation / initial market prices).
 */
interface DeferredMarketSeed {
  /** Market id, e.g. `'market:equipment'`. */
  id: string;
  /** Commodity id (doubles as the inventory resourceId for the resource). */
  commodityId: string;
  /** Baseline price (bigint minor units as string). */
  basePrice: string;
}

const DEFERRED_MARKETS: readonly DeferredMarketSeed[] = [
  { id: 'market:equipment', commodityId: 'resource:equipment', basePrice: PROVISIONAL_MARKET_PRICE_EQUIPMENT },
  { id: 'market:labor', commodityId: 'resource:labor', basePrice: PROVISIONAL_MARKET_PRICE_LABOR },
  { id: 'market:land', commodityId: 'resource:land', basePrice: PROVISIONAL_MARKET_PRICE_LAND },
];

/** Clamp a number to [lo, hi]. */
function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/**
 * Ensure all 8 GDD §8.5 commodity markets have live `MarketState` entries.
 *
 * For each of the three P3b-deferred markets (equipment, labor, land) NOT
 * already in `state.economy.markets`, append a fresh `MarketState` (price =
 * `PROVISIONAL_MARKET_PRICE_*`, supply = 0, demand = 0) and register its
 * `market:<id>` account (balance '0'). The 5 P3b markets are left untouched.
 *
 * Returns the new state. Pure — does not mutate input. Idempotent — repeated
 * calls do not add duplicate markets.
 */
function ensureDeferredMarkets(state: GameState): GameState {
  let next = state;
  for (const seed of DEFERRED_MARKETS) {
    const exists = next.economy.markets.some((m) => m.id === seed.id);
    if (exists) continue;
    // Register the market account first (balance '0'). registerAccount throws
    // if an account with the same id already exists — defensive; the market
    // account id is derived deterministically from the market id.
    const accountId = deriveMarketAccountId(seed.id);
    const existingAccount = next.economy.accounts.some((a) => a.id === accountId);
    if (!existingAccount) {
      next = registerAccount(next, {
        id: accountId,
        type: 'external',
        label: `Market — ${seed.id.replace(/^market:/, '')}`,
        balance: '0',
      });
    }
    // Append the MarketState.
    const newMarket: MarketState = {
      id: seed.id,
      commodityId: seed.commodityId,
      price: seed.basePrice,
      supply: 0,
      demand: 0,
      lastPriceUpdate: 0,
      demandInjectedThisTick: '0',
    };
    next = {
      ...next,
      economy: {
        ...next.economy,
        markets: [...next.economy.markets, newMarket],
      },
    };
  }
  return next;
}

/**
 * Compute the volatility-bounded clearing-price drift for one market.
 *
 * The price moves toward the supply/demand equilibrium:
 *   - If `demand > supply`, price rises.
 *   - If `supply > demand`, price falls.
 *   - The magnitude is `(demand - supply) / max(supply + demand, MIN_SCALE) ×
 *     volatility`, clamped to `±volatility × anchorPrice` (the GDD §8.5
 *     bound: prices move at most ±volatility fraction per tick).
 *
 * `MIN_SCALE = 1` floors the denominator so a fresh market (supply = demand
 * = 0) has zero drift (no NaN, no spurious movement). Pure — deterministic.
 *
 * `anchorPrice` is the price the drift is applied to. For markets with a
 * content definition (the 5 P3b markets), the anchor is the CURRENT price
 * (the EconomySystem's `updateMarkets` mean-reverts them toward their base
 * via `basePriceById`, so they stay bounded). For the three P3b-deferred
 * markets (equipment, labor, land — no content definition), the anchor is
 * the PROVISIONAL base price: this mean-reverts the deferred price toward
 * its base each tick so the EconomySystem's `updateMarkets` (which uses the
 * CURRENT price as the base for markets lacking a `basePriceById` entry)
 * cannot compound it to Infinity over a long run. Without this anchor, a
 * 80000-tick biology simulation with harvest-leaves issuances grows the
 * deferred prices exponentially until `Number(price)` overflows to Infinity
 * and `BigInt(Infinity)` throws.
 */
function computePriceDrift(
  market: MarketState,
  volatility: number,
  anchorPrice: bigint,
): bigint {
  const supply = market.supply;
  const demand = market.demand;
  const denom = Math.max(supply + demand, 1);
  const imbalance = (demand - supply) / denom; // in [-1, +1]
  // Fractional price change, bounded by ±volatility.
  const fractionChange = clamp(imbalance * volatility, -volatility, volatility);
  // New price = anchor × (1 + fractionChange), floored to >= 1 minor unit.
  const newPriceFloat = Number(anchorPrice) * (1 + fractionChange);
  const newPrice = BigInt(Math.max(1, Math.floor(newPriceFloat)));
  return newPrice;
}

/** Result of `clearMarkets`. */
export interface ClearMarketsResult {
  state: GameState;
  events: SimulationEvent[];
}

/**
 * Per-tick market clearing (P8c — GDD §8.5 Market Simulation).
 *
 *   1. Ensure all 8 GDD §8.5 commodity markets have live `MarketState`
 *      entries (adds equipment/labor/land on first encounter).
 *   2. For each market, compute the volatility-bounded clearing-price drift
 *      from supply/demand (prices move toward equilibrium, bounded by
 *      `PROVISIONAL_BUSINESS_MARKET_PRICE_VOLATILITY` per tick).
 *   3. Update `lastPriceUpdate` to `now`.
 *   4. Emit one `market-price-changed` event per market whose price moved
 *      significantly (≥ `PROVISIONAL_ECONOMY_MARKET_PRICE_EMIT_REL_THRESHOLD`
 *      relative — H1 event-flood fix, mirroring `updateMarkets`'s W45 guard).
 *
 * This complements the EconomySystem's `updateMarkets` (slot #6, log-ratio
 * supply/demand factor × monetary conditions factor, supply/demand refill +
 * decay). The BusinessSystem calls `clearMarkets` once per tick (slot #8)
 * so the GDD §8.5 8-market basket is live + prices fluctuate with the
 * business-driven supply/demand imbalance.
 *
 * Pure: returns a new state + events; the input is NEVER mutated.
 * Deterministic given (state, now).
 *
 * @provisional (GDD §17: market simulation / price volatility) — the linear
 * drift model is a starter; P5+ tuning will calibrate from playtest data.
 */
export function clearMarkets(state: GameState, now: number): ClearMarketsResult {
  // 1. Ensure all 8 markets exist.
  const withMarkets = ensureDeferredMarkets(state);

  // 2. Build the deferred-market base-price map (the three P3b-deferred
  //    markets have no content `MarketDefinition`, so the EconomySystem's
  //    `updateMarkets` cannot mean-revert them via `basePriceById` — it uses
  //    the CURRENT price as the base, which compounds exponentially over a
  //    long run. clearMarkets anchors the deferred drift to the PROVISIONAL
  //    base price so the deferred prices stay bounded near their baseline
  //    (within ±volatility per tick), preventing `Number(price)` from
  //    overflowing to Infinity on a long simulation.
  const deferredBasePrice = new Map<string, bigint>();
  for (const seed of DEFERRED_MARKETS) {
    deferredBasePrice.set(seed.id, parseAmount(seed.basePrice, 'basePrice'));
  }

  // 3. Advance each market's clearing price.
  const events: SimulationEvent[] = [];
  const newMarkets: MarketState[] = withMarkets.economy.markets.map((m) => {
    const currentPrice = parseAmount(m.price, 'price');
    // Anchor: the deferred markets drift around their PROVISIONAL base price
    // (mean-reverting); the P3b markets drift around their current price
    // (the EconomySystem mean-reverts them via basePriceById).
    const anchor = deferredBasePrice.get(m.id) ?? currentPrice;
    const newPrice = computePriceDrift(m, PROVISIONAL_BUSINESS_MARKET_PRICE_VOLATILITY, anchor);
    // H1 (event-flood fix): apply the SAME significance guard as
    // `updateMarkets` (economy/markets.ts — W45). Pre-H1 `clearMarkets` emitted
    // on a bare `newPrice !== currentPrice`, so high-basePrice markets (land at
    // 100000) drifting ~1 minor unit per tick (0.001% relative) flooded the
    // event log with 41.5M events in a long sim — the exact flood W45 diagnosed
    // + suppressed one layer up in `updateMarkets`, but `clearMarkets` (added
    // later in P8c) inherited the bare `!==` guard. The price STATE is always
    // updated (the market panel sees the correct drifted price); the
    // `market-price-changed` event fires only on a ≥0.5% relative move
    // (`PROVISIONAL_ECONOMY_MARKET_PRICE_EMIT_REL_THRESHOLD`).
    if (priceMoveIsSignificant(currentPrice, newPrice)) {
      events.push({
        type: 'market-price-changed',
        at: now,
        payload: {
          marketId: m.id,
          commodityId: m.commodityId,
          oldPrice: currentPrice.toString(10),
          newPrice: newPrice.toString(10),
          supply: m.supply,
          demand: m.demand,
          inflationIndexAfter: withMarkets.economy.inflationIndex,
        },
      });
    }
    return {
      ...m,
      price: newPrice.toString(10),
      lastPriceUpdate: now,
      // P11 (W36): reset the per-tick demand-injection budget each tick.
      demandInjectedThisTick: '0',
    };
  });

  const newState: GameState = {
    ...withMarkets,
    economy: {
      ...withMarkets.economy,
      markets: newMarkets,
    },
  };

  return { state: newState, events };
}

/** Parameters for `executeMarketTransaction`. */
export interface ExecuteMarketTransactionParams {
  /** Market id (must exist in `state.economy.markets` after `clearMarkets`
   *  ensures the deferred markets). */
  marketId: string;
  /** Buyer account id (a business id, a market account id, or
   *  `PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID`). */
  buyer: string;
  /** Seller account id (a business id, a market account id, or
   *  `PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID`). */
  seller: string;
  /** Quantity transacted (>= 0; 0 is a no-op). */
  quantity: number;
  /** Unit price (bigint minor units as string). */
  price: string;
  /** Simulation second at which the transaction occurs. */
  timestamp: number;
  /** Transaction category (e.g. `'business-market-sale'`,
   *  `'business-market-buy'`). Free-form string. */
  category: string;
  /** Optional idempotency key — if set, the transfers are tagged with it AND
   *  the requestId is added to `processedRequestIds`. */
  requestId?: string;
  /** Optional human-readable description for the audit trail. */
  description?: string;
}

/** Result of `executeMarketTransaction`. */
export interface ExecuteMarketTransactionResult {
  state: GameState;
  /** The recorded transactions (1 if no injection, 2 if demand injection). */
  transactions: import('@capitalist-tree/shared').TransactionRecord[];
  /** Total amount moved (bigint minor units as string). */
  total: string;
  /** Whether a demand-injection issuance was applied (buyer was a market
   *  account with insufficient balance). */
  demandInjected: boolean;
  /** The amount injected from the authority (bigint string; '0' if none). */
  injectedAmount: string;
}

/**
 * Execute a buyer→seller market transaction at the clearing price.
 *
 *   1. Resolve the market by id. (The market MUST exist; `clearMarkets`
 *      ensures all 8 GDD §8.5 markets are present.)
 *   2. Compute `total = floor(quantity × price)` (bigint; floored to minor
 *      units — fractional currency is not supported, TDD §10.1).
 *   3. If `total === 0` (quantity or price zero), return state unchanged
 *      with no transactions (no-op).
 *   4. If the buyer is a market account AND its balance is insufficient AND
 *      `PROVISIONAL_BUSINESS_MARKET_DEMAND_INJECTION_ENABLED` is `true`:
 *      inject just enough liquidity from the authority (issuance → market
 *      account) to cover the shortfall. This represents external market
 *      demand — buyers from outside the simulation — and makes the market a
 *      REAL PARTICIPANT (the transfer is market → seller, not authority →
 *      seller issuance). The injection is capped at `total`; the market
 *      account never goes negative.
 *   5. Transfer `total` from the buyer to the seller via the economy
 *      `transfer()` (pillar 1 — every movement a transaction).
 *   6. Adjust the market's supply/demand:
 *      - If the buyer is the market account (market is buying): `supply +=
 *        quantity` (the market absorbs the output), `demand` unchanged.
 *      - If the seller is the market account (market is selling): `supply -=
 *        quantity` (the market's stock drawn down; floored at 0), `demand +=
 *        quantity` (active buyer signal).
 *      - Otherwise (business↔business via the market price): no supply/demand
 *        change (the market is just the price reference).
 *
 * Money NEVER silently created or destroyed (TDD §10.4): the injection is an
 * issuance (increments `totalIssued`), the buyer→seller transfer preserves
 * money. The conservation invariant holds:
 *   `sum(balances) + totalSinks === initialSupply + totalIssued`.
 *
 * Pure: returns a new state + the recorded transactions; the input is NEVER
 * mutated. Deterministic given (state, params).
 *
 * @provisional (GDD §17: market simulation / external demand liquidity) —
 * the demand-injection backstop is a starter mechanic ensuring the market can
 * always absorb output at game start (when market accounts hold '0'). As
 * players and businesses transact, market accounts accumulate balances and
 * the injection becomes less frequent.
 */
export function executeMarketTransaction(
  state: GameState,
  params: ExecuteMarketTransactionParams,
): ExecuteMarketTransactionResult {
  const { marketId, buyer, seller, quantity, price, timestamp, category, description } = params;

  const market = state.economy.markets.find((m) => m.id === marketId);
  if (!market) {
    throw new UnknownBusinessMarketError(marketId);
  }

  const unitPrice = parseAmount(price, 'price');
  let qty = BigInt(Math.floor(quantity));
  let total = unitPrice * qty;

  // No-op for zero total (fractional quantity floored to 0, or zero price).
  if (total <= 0n) {
    return { state, transactions: [], total: '0', demandInjected: false, injectedAmount: '0' };
  }

  const marketAccountId = deriveMarketAccountId(market.id);
  const buyerIsMarket = buyer === marketAccountId;
  const sellerIsMarket = seller === marketAccountId;

  let next = state;
  const txns: import('@capitalist-tree/shared').TransactionRecord[] = [];
  let demandInjected = false;
  let injectedAmount = 0n;

  // 1. Demand injection: if the buyer is the market account and has
  //    insufficient balance, the authority injects just enough to cover.
  //    P11 (W36 / RV3-4 follow-up): the injection is capped at a PER-TICK
  //    AGGREGATE — `PROVISIONAL_BUSINESS_MARKET_DEMAND_INJECTION_MAX_PER_TICK_MINOR`
  //    total per market per tick (tracked on `market.demandInjectedThisTick`,
  //    reset by `clearMarkets` each tick). Pre-W36 the cap was per-CALL, so N
  //    same-tick sales to one market each re-triggered it (N × cap total) — a
  //    bounded variant of the original scarcity-masking concern. Now each
  //    injection debits the remaining per-tick budget; if the needed injection
  //    exceeds the remaining budget, the quantity sold is reduced to what the
  //    buyer can afford after the capped injection (partial sale — scarcity
  //    enforced, no InsufficientFundsError thrown).
  if (
    buyerIsMarket &&
    PROVISIONAL_BUSINESS_MARKET_DEMAND_INJECTION_ENABLED
  ) {
    const buyerBalance = getBalance(state, buyer);
    if (buyerBalance < total) {
      const needed = total - buyerBalance;
      // Per-tick aggregate cap: debit the remaining budget for this market.
      // `market` is read from `state` (the input); the cumulative counter
      // persists across same-tick sales via the stamp below.
      const injectedSoFarThisTick = BigInt(market.demandInjectedThisTick ?? '0');
      const remainingThisTick =
        PROVISIONAL_BUSINESS_MARKET_DEMAND_INJECTION_MAX_PER_TICK_MINOR - injectedSoFarThisTick;
      // Cap the injection — enforce scarcity (clamped at ≥ 0; a tick whose
      // budget is already exhausted gets no injection).
      injectedAmount =
        needed > remainingThisTick ? (remainingThisTick > 0n ? remainingThisTick : 0n) : needed;
      if (injectedAmount > 0n) {
        const injectionRequestId = params.requestId
          ? `${params.requestId}:demand-injection`
          : undefined;
        next = transfer(next, {
          sourceAccount: PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
          destinationAccount: buyer,
          amount: injectedAmount.toString(10),
          category: CATEGORY_BUSINESS_MARKET_DEMAND,
          description: `External market demand injection for ${buyer} (sale of ${market.commodityId})`,
          timestamp,
          ...(injectionRequestId !== undefined ? { requestId: injectionRequestId } : {}),
        });
        txns.push(next.economy.transactions[next.economy.transactions.length - 1]!);
        demandInjected = true;
        // Debit the per-tick budget: stamp the cumulative injection on the
        // market so the next same-tick sale sees the reduced remaining budget.
        const newInjectedThisTick = (injectedSoFarThisTick + injectedAmount).toString(10);
        next = {
          ...next,
          economy: {
            ...next.economy,
            markets: next.economy.markets.map((m) =>
              m.id === market.id ? { ...m, demandInjectedThisTick: newInjectedThisTick } : m,
            ),
          },
        };
      }
      // If the injection was capped, reduce the effective quantity to what
      // the buyer can now afford. This enforces scarcity without throwing.
      const effectiveBalance = buyerBalance + injectedAmount;
      if (effectiveBalance < total) {
        const affordableQty = unitPrice > 0n ? effectiveBalance / unitPrice : 0n;
        if (affordableQty < qty) {
          // Reduce quantity + recompute total for the reduced sale.
          // The supply/demand adjustment below uses the reduced qty.
          qty = affordableQty;
          total = unitPrice * qty;
          if (total <= 0n) {
            // Buyer can't afford even 1 unit after the capped injection —
            // no sale occurs (full scarcity). Still record the injection txn.
            return {
              state: next,
              transactions: txns,
              total: '0',
              demandInjected,
              injectedAmount: injectedAmount.toString(10),
            };
          }
        }
      }
    }
  }

  // 2. Buyer → seller transfer (the market is a real participant).
  next = transfer(next, {
    sourceAccount: buyer,
    destinationAccount: seller,
    amount: total.toString(10),
    category,
    description: description ?? `Market transaction: ${buyer} → ${seller} (${qty} × ${market.commodityId} @ ${price})`,
    timestamp,
    ...(params.requestId !== undefined ? { requestId: params.requestId } : {}),
  });
  txns.push(next.economy.transactions[next.economy.transactions.length - 1]!);

  // 3. Adjust market supply/demand.
  let newSupply = market.supply;
  let newDemand = market.demand;
  if (buyerIsMarket) {
    // Market is buying (absorbing output): supply += quantity.
    newSupply = market.supply + quantity;
  } else if (sellerIsMarket) {
    // Market is selling (drawn down): supply -= quantity (floored at 0),
    // demand += quantity (active buyer signal).
    newSupply = Math.max(0, market.supply - quantity);
    newDemand = market.demand + quantity;
  }
  // else: business↔business via market price — no supply/demand change.

  next = {
    ...next,
    economy: {
      ...next.economy,
      markets: next.economy.markets.map((m) =>
        m.id === marketId
          ? {
              ...m,
              supply: newSupply,
              demand: newDemand,
            }
          : m,
      ),
    },
  };

  return {
    state: next,
    transactions: txns,
    total: total.toString(10),
    demandInjected,
    injectedAmount: injectedAmount.toString(10),
  };
}

/** Error thrown by `executeMarketTransaction` when the market id is unknown. */
export class UnknownBusinessMarketError extends Error {
  readonly marketId: string;
  constructor(marketId: string) {
    super(`Unknown market "${marketId}". Run clearMarkets first to register the deferred markets.`);
    this.name = 'UnknownBusinessMarketError';
    this.marketId = marketId;
  }
}

/** Re-exported transaction categories for tests / audit. */
export {
  CATEGORY_BUSINESS_MARKET_SALE,
  CATEGORY_BUSINESS_MARKET_BUY,
  CATEGORY_BUSINESS_MARKET_DEMAND,
};
