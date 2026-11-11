/**
 * Market pricing + inflation index (P3b — TDD §10.5, §10.6, GDD §8.5, §6.3).
 *
 * Pure functions for:
 *   - Pricing: each market's `price` is recomputed per tick from
 *     supply/demand + monetary conditions. The model is NOT a global
 *     multiplier (TDD §10.6) — each market's price responds to its own
 *     supply/demand, plus a shared "monetary conditions" factor that
 *     captures the money supply growth rate. The inflation index is
 *     *derived* from the basket of market prices vs their base prices
 *     (Laspeyres-style), and the inflation rate is derived from the index
 *     delta. The UI divides nominal currency amounts by the index to display
 *     "real" purchasing power (GDD §6.3).
 *
 *   - Purchase: player buys `quantity` units of a commodity. Money flows
 *     through P3a's `transfer()` (player:personal → market:<id>), inventory
 *     is credited, market supply/demand is adjusted, transaction recorded
 *     with category `'purchase'`.
 *
 *   - Per-tick update: EconomySystem calls `updateMarkets()` to advance
 *     supply/demand (refill, decay) and recompute prices.
 *
 * All functions are pure: they return a new state and never mutate input.
 * Deterministic: same (state, ctx) → same (new state, events). The pricing
 * model uses no randomness — only arithmetic on the current market state.
 *
 * PROVISIONAL: every constant is in
 * `packages/shared/src/constants/economy.ts` under the `PROVISIONAL_ECONOMY_*`
 * prefix. The model is intentionally simple (P3b ships a starter economy);
 * P5+ tuning will calibrate from playtest data.
 *
 * ## Pricing model
 *
 * Per market, per tick:
 *
 *   ```
 *   supplyDemandFactor = clamp(
 *     1 + ELASTICITY × ln( max(demand, MIN_SCALE) / max(supply, MIN_SCALE) ),
 *     MIN_FRACTION,
 *     MAX_MULTIPLIER
 *   )
 *
 *   monetaryConditionsFactor = clamp(
 *     1 + MONETARY_CONDITIONS_ELASTICITY × (monetarySupply / initialSupply - 1),
 *     MIN_FRACTION,
 *     MAX_MULTIPLIER
 *   )
 *
 *   targetPrice = basePrice × supplyDemandFactor × monetaryConditionsFactor
 *   price'      = price + (targetPrice - price) × SMOOTHING
 *   ```
 *
 * The supply/demand factor uses a **log-ratio** form rather than the
 * linear `(demand - supply) / (supply + demand)` difference. The log-ratio
 * has three properties the linear form lacks (TDD §10.6):
 *
 *   1. It is unbounded in the raw value — extreme imbalances (supply → 0
 *      with demand huge, or vice-versa) push the raw factor well past the
 *      `[MIN_FRACTION, MAX_MULTIPLIER]` clamps, so the clamps actually
 *      engage. The linear form saturates at `1 ± ELASTICITY` and never
 *      reaches the clamps with conservative elasticity.
 *   2. It is symmetric in ratios — a 2× demand-over-supply gives the same
 *      |factor - 1| as a 2× supply-over-demand (the linear form has the
 *      same symmetry on the difference, but the log form makes the
 *      symmetry explicit and bounded on both sides).
 *   3. It stays mild for moderate imbalances — at the game-start state
 *      (`supply = INITIAL_SUPPLY`, `demand = 0`) the factor is
 *      `1 + ELASTICITY × ln(MIN_SCALE / INITIAL_SUPPLY)` ≈
 *      `1 + 0.1 × ln(10/100)` ≈ 0.77 with the starter constants. So the
 *      initial deflationary bias is small enough that monetary growth
 *      (issuance) can push target prices above the base — the GDD §8.5
 *      "monetary conditions" price driver remains visible.
 *
 * `basePrice` is the market's content-defined reference price
 * (`MarketDefinition.basePrice`). The current `MarketState.price` lerps
 * toward `targetPrice` at `SMOOTHING` fraction per tick — sticky prices
 * that converge to equilibrium rather than swinging wildly.
 *
 * Supply/demand dynamics per tick:
 *
 *   ```
 *   supply' = max(0, supply × (1 - SUPPLY_DECAY) + SUPPLY_REFILL_RATE - purchased)
 *   demand' = max(0, demand × (1 - DEMAND_DECAY) + purchased)
 *   ```
 *
 * Purchases subtract from supply (drawn-down stock) and add to demand (the
 * signal that this market is "active"). Refill + decay return markets to
 * equilibrium when no activity occurs.
 *
 * ## Inflation index
 *
 *   ```
 *   inflationIndex = Σ(price_i / basePrice_i) / N
 *   ```
 *
 * At game start all `price_i == basePrice_i`, so `inflationIndex == 1.0`.
 * As prices rise (across all markets), the index rises. The `inflationRate`
 * field on `economy.inflationRate` is the annualized per-tick change of the
 * index — purely cosmetic for display (the index itself is what drives
 * real purchasing power).
 *
 * The basket is uniform-weighted (each market contributes equally). P5+ may
 * introduce weights reflecting the player's actual consumption basket (CPI
 * style) — for P3b, equal weighting keeps the model simple and the
 * invariant tests readable.
 */
import type {
  GameState,
  MarketState,
  SimulationEvent,
  TransactionRecord,
} from '@capitalist-tree/shared';
import {
  PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
  PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
  PROVISIONAL_ECONOMY_CATEGORY_PURCHASE,
  PROVISIONAL_ECONOMY_MARKET_ACCOUNT_PREFIX,
  PROVISIONAL_ECONOMY_MARKET_DEMAND_DECAY,
  PROVISIONAL_ECONOMY_MARKET_INITIAL_SUPPLY,
  PROVISIONAL_ECONOMY_MARKET_MIN_SCALE,
  PROVISIONAL_ECONOMY_MARKET_PRICE_ELASTICITY,
  PROVISIONAL_ECONOMY_MARKET_PRICE_MAX_MULTIPLIER,
  PROVISIONAL_ECONOMY_MARKET_PRICE_MIN_FRACTION,
  PROVISIONAL_ECONOMY_MARKET_PRICE_SMOOTHING,
  PROVISIONAL_ECONOMY_MARKET_SUPPLY_DECAY,
  PROVISIONAL_ECONOMY_MARKET_SUPPLY_REFILL_RATE,
  PROVISIONAL_ECONOMY_MONETARY_CONDITIONS_ELASTICITY,
  PROVISIONAL_ECONOMY_INFLATION_RATE_ANNUALIZATION,
} from '@capitalist-tree/shared';
import { findMarketById, type MarketDefinition } from '@capitalist-tree/content';
import { transfer, parseAmount } from './ledger.js';

/** Error thrown by `applyPurchase` when the market id is unknown. */
export class UnknownMarketError extends Error {
  readonly marketId: string;
  constructor(marketId: string) {
    super(`Unknown market "${marketId}". Register it in packages/content/src/markets/index.ts.`);
    this.name = 'UnknownMarketError';
    this.marketId = marketId;
  }
}

/** Clamp a number to [lo, hi]. */
function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/**
 * Compute the supply/demand factor for a single market.
 *
 * Uses the **log-ratio** form so extreme imbalances (supply → 0 or
 * demand → 0) push the raw factor past the `[MIN_FRACTION,
 * MAX_MULTIPLIER]` clamps, engaging them; moderate imbalances stay mild.
 *
 *   factor = clamp(
 *     1 + ELASTICITY × ln( max(demand, MIN_SCALE) / max(supply, MIN_SCALE) ),
 *     MIN_FRACTION,
 *     MAX_MULTIPLIER
 *   )
 *
 * At `demand == supply` the ratio is 1, `ln(1) == 0`, and the factor is 1.0
 * (no price pressure). When demand doubles relative to supply, the raw
 * factor moves by `ELASTICITY × ln(2) ≈ 0.069` (with ELASTICITY = 0.1) —
 * mild, but compounding over many ticks of sustained pressure. When the
 * ratio diverges by orders of magnitude (extreme cases), `ln(ratio)` grows
 * without bound and the clamps engage (TDD §10.6 — "Resource scarcity" and
 * "Supply" / "Demand" must be allowed to dominate price in extreme cases).
 *
 * `MIN_SCALE` floors both `demand` and `supply` so the ratio never divides
 * by (near-)zero; at `supply == demand == 0` the ratio is `MIN_SCALE /
 * MIN_SCALE = 1` and the factor is 1.0 (no pressure, no NaN).
 *
 * Pure: deterministic given the inputs.
 */
export function computeSupplyDemandFactor(supply: number, demand: number): number {
  const s = Math.max(supply, PROVISIONAL_ECONOMY_MARKET_MIN_SCALE);
  const d = Math.max(demand, PROVISIONAL_ECONOMY_MARKET_MIN_SCALE);
  const ratio = d / s;
  const raw = 1 + PROVISIONAL_ECONOMY_MARKET_PRICE_ELASTICITY * Math.log(ratio);
  return clamp(
    raw,
    PROVISIONAL_ECONOMY_MARKET_PRICE_MIN_FRACTION,
    PROVISIONAL_ECONOMY_MARKET_PRICE_MAX_MULTIPLIER,
  );
}

/**
 * Compute the monetary conditions factor — a shared multiplier across all
 * markets based on the money supply growth relative to the starting supply.
 *
 * `1 + MONETARY_CONDITIONS_ELASTICITY × (monetarySupply / initialSupply - 1)`,
 * clamped to `[MIN_FRACTION, MAX_MULTIPLIER]`.
 *
 * Captures GDD §8.5's "monetary conditions" price driver (TDD §10.6). When
 * the authority issues currency (money supply grows), prices tend to rise;
 * when currency is sunk (taxes, fees), prices tend to fall. The factor is
 * shared across all markets (it's not a per-market multiplier); the
 * per-market supply/demand factor is what differentiates individual prices.
 *
 * Pure: deterministic given the inputs.
 */
export function computeMonetaryConditionsFactor(
  monetarySupply: bigint,
  initialSupply: bigint,
): number {
  if (initialSupply <= 0n) {
    // Defensive: avoid division by zero. A fresh game has starting cash > 0;
    // if a test sets initialSupply = 0, treat the factor as 1.0 (no effect).
    return 1.0;
  }
  // Use Number for the ratio — both supplies are bigint but the ratio is a
  // small fraction that fits comfortably in a double. For very large
  // supplies (>2^53) this loses precision; P3b's economy doesn't reach those
  // magnitudes (a $500 start + harvests stays well under 2^53 minor units).
  const ratio = Number(monetarySupply) / Number(initialSupply);
  const raw =
    1 + PROVISIONAL_ECONOMY_MONETARY_CONDITIONS_ELASTICITY * (ratio - 1);
  return clamp(
    raw,
    PROVISIONAL_ECONOMY_MARKET_PRICE_MIN_FRACTION,
    PROVISIONAL_ECONOMY_MARKET_PRICE_MAX_MULTIPLIER,
  );
}

/**
 * Compute the target price for a market given the current state.
 *
 * `basePrice × supplyDemandFactor × monetaryConditionsFactor`, rounded to
 * the nearest minor unit (no fractional currency). Pure.
 */
export function computeTargetPrice(
  basePrice: bigint,
  supply: number,
  demand: number,
  monetaryConditionsFactor: number,
): bigint {
  const supplyDemandFactor = computeSupplyDemandFactor(supply, demand);
  // Multiply bigint by a float factor. The float factor is in
  // [MIN_FRACTION, MAX_MULTIPLIER] so the result is bounded. We convert via
  // Number for the multiplication, then back to bigint — safe for P3b's
  // magnitudes (<2^53 minor units ≈ $90 trillion).
  const target = Number(basePrice) * supplyDemandFactor * monetaryConditionsFactor;
  // Round to nearest integer (BigInt truncates). Use Math.round for
  // symmetric rounding; ensure >= 1 to avoid zero prices.
  const rounded = Math.max(1, Math.round(target));
  return BigInt(rounded);
}

/**
 * Compute the Laspeyres-style inflation index from the basket of market
 * prices vs their base prices.
 *
 * `Σ(price_i / basePrice_i) / N` — uniform-weighted. At game start all
 * prices == base prices, so the index == 1.0. Returns 1.0 if there are no
 * markets (defensive — should not happen in practice).
 *
 * Pure: deterministic given the state.
 */
export function computeInflationIndex(
  markets: readonly MarketState[],
  basePriceById: ReadonlyMap<string, bigint>,
): number {
  if (markets.length === 0) return 1.0;
  let sum = 0;
  let counted = 0;
  for (const m of markets) {
    const base = basePriceById.get(m.id);
    if (base === undefined || base === 0n) continue;
    const current = parseAmount(m.price, 'price');
    sum += Number(current) / Number(base);
    counted += 1;
  }
  if (counted === 0) return 1.0;
  return sum / counted;
}

/**
 * Per-tick market update (TDD §10.6 — pure function).
 *
 * For each market on `state.economy.markets`:
 *   1. Refill supply by `SUPPLY_REFILL_RATE` (background supplier activity).
 *   2. Decay supply by `SUPPLY_DECAY` (spoilage / rotation).
 *   3. Decay demand by `DEMAND_DECAY` (fading purchase pressure).
 *   4. Compute target price (supply/demand + monetary conditions).
 *   5. Lerp the current price toward target by `SMOOTHING`.
 *   6. Update `lastPriceUpdate` to `ctx.now`.
 *
 * Also recomputes `state.economy.inflationIndex` and `inflationRate`:
 *   - `inflationIndex` = `computeInflationIndex(markets, basePrices)`.
 *   - `inflationRate` = annualized per-tick change of the index.
 *
 * Pure: returns a new state + a list of `market-price-changed` events (one
 * per market whose price moved). Deterministic given (state, ctx.now,
 * initialSupply). The `initialSupply` is the player's starting cash —
 * passed in explicitly so the function is testable without requiring a
 * full game config.
 */
export interface UpdateMarketsResult {
  state: GameState;
  events: SimulationEvent[];
}

export function updateMarkets(
  state: GameState,
  ctx: { now: number; initialSupply: string },
): UpdateMarketsResult {
  const initialSupply = parseAmount(ctx.initialSupply, 'initialSupply');
  const monetarySupply = parseAmount(state.economy.monetarySupply, 'monetarySupply');
  const monetaryConditionsFactor = computeMonetaryConditionsFactor(
    monetarySupply,
    initialSupply,
  );

  // Build the basePrice lookup from content definitions.
  const basePriceById = new Map<string, bigint>();
  for (const m of state.economy.markets) {
    const def = findMarketById(m.id);
    if (def) {
      basePriceById.set(m.id, parseAmount(def.basePrice, 'basePrice'));
    }
  }

  const events: SimulationEvent[] = [];
  const previousIndex = state.economy.inflationIndex;

  const newMarkets: MarketState[] = state.economy.markets.map((m) => {
    // Refill + decay supply (background restock + spoilage).
    const decayedSupply = m.supply * (1 - PROVISIONAL_ECONOMY_MARKET_SUPPLY_DECAY);
    const refilledSupply = decayedSupply + PROVISIONAL_ECONOMY_MARKET_SUPPLY_REFILL_RATE;
    const newSupply = Math.max(0, refilledSupply);

    // Decay demand (fading purchase pressure).
    const newDemand = Math.max(0, m.demand * (1 - PROVISIONAL_ECONOMY_MARKET_DEMAND_DECAY));

    // Compute target price.
    const base = basePriceById.get(m.id) ?? parseAmount(m.price, 'price');
    const target = computeTargetPrice(base, newSupply, newDemand, monetaryConditionsFactor);

    // Lerp current price toward target.
    const currentPrice = parseAmount(m.price, 'price');
    const smoothed = lerpBigInt(currentPrice, target, PROVISIONAL_ECONOMY_MARKET_PRICE_SMOOTHING);

    if (smoothed !== currentPrice) {
      const def = findMarketById(m.id);
      events.push({
        type: 'market-price-changed',
        at: ctx.now,
        payload: {
          marketId: m.id,
          commodityId: def?.commodityId ?? m.commodityId,
          oldPrice: currentPrice.toString(10),
          newPrice: smoothed.toString(10),
          supply: newSupply,
          demand: newDemand,
          // inflationIndexAfter is filled in after we compute the new index
          // (we patch it in below to avoid recomputing twice).
          inflationIndexAfter: previousIndex,
        },
      });
    }

    return {
      ...m,
      price: smoothed.toString(10),
      supply: newSupply,
      demand: newDemand,
      lastPriceUpdate: ctx.now,
    };
  });

  // Compute the new inflation index.
  const newIndex = computeInflationIndex(newMarkets, basePriceById);

  // Derive the annualized inflation rate from the per-tick index change.
  // `(newIndex / previousIndex - 1) × ANNUALIZATION` — but we want a smooth
  // signal, not the per-tick noise. P3b uses the *cumulative* rate vs the
  // starting index (1.0): `(newIndex / 1.0 - 1) × ANNUALIZATION / ticksSinceStart`.
  // For simplicity, we report the per-tick delta annualized — the index
  // itself is what matters for purchasing power; the rate is cosmetic.
  let newInflationRate = state.economy.inflationRate;
  if (previousIndex > 0) {
    const tickRate = newIndex / previousIndex - 1;
    newInflationRate = tickRate * PROVISIONAL_ECONOMY_INFLATION_RATE_ANNUALIZATION;
  }

  // Patch the inflationIndexAfter on each emitted event now that we know it.
  const patchedEvents = events.map((e) =>
    e.type === 'market-price-changed'
      ? { ...e, payload: { ...e.payload, inflationIndexAfter: newIndex } }
      : e,
  );

  const newState: GameState = {
    ...state,
    economy: {
      ...state.economy,
      markets: newMarkets,
      inflationIndex: newIndex,
      inflationRate: newInflationRate,
    },
  };

  return { state: newState, events: patchedEvents };
}

/** Linear interpolation between two bigints by a fraction in [0, 1].
 *
 *  Special handling for small-price markets: if the float lerp rounds back
 *  to the source value (e.g. lerp(10, 11, 0.25) = 10.25 → 10 — no movement),
 *  nudge by 1 minor unit toward the target. This ensures the price always
 *  moves when there's a gap, preventing "stuck" prices for low-base-price
 *  markets like water (base 10) and energy (base 50). Without the nudge, a
 *  25% smoothing fraction on a 1-unit gap would round to 0 and the price
 *  would never move. */
function lerpBigInt(from: bigint, to: bigint, fraction: number): bigint {
  if (from === to) return from;
  // Number-based lerp for P3b magnitudes. For very large bigints this would
  // lose precision; P3b's economy stays well under 2^53 minor units.
  const a = Number(from);
  const b = Number(to);
  const result = a + (b - a) * fraction;
  const rounded = Math.max(1, Math.round(result));
  if (rounded === a && from !== to) {
    // Lerp didn't move the price (rounding swallowed the step). Nudge by
    // 1 minor unit toward the target so prices converge over multiple ticks.
    return from < to ? from + 1n : from - 1n;
  }
  return BigInt(rounded);
}

/**
 * Apply a purchase action (TDD §10.5, §10.6, GDD §8.5 — pure function).
 *
 * Steps:
 *   1. Resolve the market by id. Throw `UnknownMarketError` if unknown.
 *   2. Compute cost = `market.price × quantity` (bigint).
 *   3. Transfer `cost` from `player:personal` to `market:<id>` via P3a's
 *      `transfer()` (category `'purchase'`). Validates sufficient funds.
 *   4. Credit `inventory.items` with `{ resourceId: market.commodityId,
 *      quantity }` (incrementing if the resource is already in inventory).
 *   5. Adjust market supply/demand: `supply -= quantity`, `demand +=
 *      quantity`.
 *   6. Emit a `purchase-completed` event carrying the full result.
 *
 * Money NEVER silently created or destroyed (TDD §10.4): the transfer is a
 * real-account-to-real-account transfer; `monetarySupply`, `totalIssued`,
 * and `totalSinks` are unchanged. The conservation invariant holds:
 *
 *   sum(balances) + totalSinks === initialSupply + totalIssued
 *
 * Throws:
 *   - `UnknownMarketError` if the market id is unknown.
 *   - `InsufficientFundsError` if the player can't afford the purchase.
 *   - Re-throws any other ledger error (InvalidAmountError, etc.).
 *
 * Pure: returns a new state, never mutates input. Deterministic given
 * (state, action, timestamp).
 */
export interface PurchaseParams {
  /** Market id (must exist in `economy.markets`). */
  marketId: string;
  /** Units to buy (>= 1). */
  quantity: number;
  /** Simulation second at which the purchase occurs. */
  timestamp: number;
}

export interface PurchaseResult {
  state: GameState;
  events: SimulationEvent[];
  /** The recorded transaction (for tests + UI). */
  transaction: TransactionRecord;
  /** Total cost in bigint minor units as string. */
  totalCost: string;
  /** Unit price at the moment of purchase (bigint minor units as string). */
  unitPrice: string;
}

export function applyPurchase(state: GameState, params: PurchaseParams): PurchaseResult {
  const market = state.economy.markets.find((m) => m.id === params.marketId);
  if (!market) {
    throw new UnknownMarketError(params.marketId);
  }

  const unitPrice = parseAmount(market.price, 'price');
  const quantity = BigInt(params.quantity);
  const totalCost = unitPrice * quantity;

  // 1. Transfer cash from player:personal to the market's account.
  //    The market account id is derived from the market id (e.g.
  //    `market:water` for `market:water`). For a market registered with
  //    `id: 'market:water'`, the account id is also `'market:water'`
  //    (PROVISIONAL_ECONOMY_MARKET_ACCOUNT_PREFIX + 'water').
  const marketAccountId = deriveMarketAccountId(market.id);
  const afterTransfer = transfer(state, {
    sourceAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
    destinationAccount: marketAccountId,
    amount: totalCost.toString(10),
    category: PROVISIONAL_ECONOMY_CATEGORY_PURCHASE,
    description: `Purchase ${params.quantity} × ${market.commodityId} from ${market.id} @ ${market.price}`,
    timestamp: params.timestamp,
  });

  // The new transaction is the last entry appended by transfer().
  const transaction = afterTransfer.economy.transactions[
    afterTransfer.economy.transactions.length - 1
  ]!;

  // 2. Credit inventory: increment if exists, append otherwise.
  const items = afterTransfer.inventory.items;
  const existingIdx = items.findIndex((i) => i.resourceId === market.commodityId);
  let newItems: { resourceId: string; quantity: number }[];
  if (existingIdx >= 0) {
    newItems = items.map((item, idx) =>
      idx === existingIdx
        ? { ...item, quantity: item.quantity + params.quantity }
        : item,
    );
  } else {
    newItems = [...items, { resourceId: market.commodityId, quantity: params.quantity }];
  }

  // 3. Adjust market supply/demand: supply -= quantity (drawn-down stock),
  //    demand += quantity (active buyer signal). Floor supply at 0.
  const newMarkets = afterTransfer.economy.markets.map((m) =>
    m.id === market.id
      ? {
          ...m,
          supply: Math.max(0, m.supply - params.quantity),
          demand: m.demand + params.quantity,
        }
      : m,
  );

  // 4. Mirror the new player balance to player.personalCash (P3a's coupling —
  //    P3c's PersonalSystem may refactor this).
  const playerAccount = afterTransfer.economy.accounts.find(
    (a) => a.id === PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
  );
  const playerBalanceAfter = playerAccount?.balance ?? afterTransfer.player.personalCash;

  const newState: GameState = {
    ...afterTransfer,
    economy: {
      ...afterTransfer.economy,
      markets: newMarkets,
    },
    inventory: { items: newItems },
    player:
      playerBalanceAfter !== afterTransfer.player.personalCash
        ? { ...afterTransfer.player, personalCash: playerBalanceAfter }
        : afterTransfer.player,
  };

  // 5. Build the events.
  const marketAfter = newMarkets.find((m) => m.id === market.id)!;
  const events: SimulationEvent[] = [
    {
      type: 'transaction-recorded',
      at: params.timestamp,
      payload: { record: transaction },
    },
    {
      type: 'purchase-completed',
      at: params.timestamp,
      payload: {
        marketId: market.id,
        commodityId: market.commodityId,
        quantity: params.quantity,
        unitPrice: unitPrice.toString(10),
        totalCost: totalCost.toString(10),
        transactionId: transaction.id,
        playerBalanceAfter,
        marketAfter: {
          id: marketAfter.id,
          price: marketAfter.price,
          supply: marketAfter.supply,
          demand: marketAfter.demand,
        },
      },
    },
  ];

  return {
    state: newState,
    events,
    transaction,
    totalCost: totalCost.toString(10),
    unitPrice: unitPrice.toString(10),
  };
}

/**
 * Derive the market account id from the market id.
 *
 * `market:water` → `market:water` (the convention is that market ids and
 * their account ids coincide — both use the `market:` prefix). Strips the
 * `market:` prefix and re-prepends it to normalize (so `water` and
 * `market:water` both map to `market:water`).
 */
export function deriveMarketAccountId(marketId: string): string {
  const slug = marketId.replace(/^market:/, '');
  return `${PROVISIONAL_ECONOMY_MARKET_ACCOUNT_PREFIX}${slug}`;
}

/**
 * Verify the purchase→apply contract (TDD §10.5 — internal helper).
 *
 * The market's `commodityId` MUST match the inventory `resourceId` so a
 * purchase from the water market credits inventory with
 * `{ resourceId: 'resource:water' }` and the apply-water action can
 * later consume from the same key. P2's apply-water/apply-fertilizer
 * actions don't yet consume from inventory (P3c wires the deduction);
 * P3b only verifies the ids match for end-to-end consistency.
 *
 * Returns `true` if the market's commodityId matches the expected
 * resourceId. Used by tests; not invoked by the engine at runtime.
 */
export function verifyPurchaseApplyContract(
  market: Pick<MarketDefinition, 'commodityId'>,
  expectedResourceId: string,
): boolean {
  return market.commodityId === expectedResourceId;
}

// Reference the constant to avoid an unused-imports warning if the pricing
// model hasn't yet exercised INITIAL_SUPPLY in this file (it's used by the
// initial-state + the EconomySystem).
void PROVISIONAL_ECONOMY_MARKET_INITIAL_SUPPLY;
void PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID;
