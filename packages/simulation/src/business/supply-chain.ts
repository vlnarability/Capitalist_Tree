/**
 * Business supply-chain resolution (P8b — TDD §5.7 / §11; GDD §8.2 Supply
 * Chains, §8.5 Market Simulation).
 *
 * Pure helpers that resolve where a business's inputs come from and where its
 * outputs go, given the current GameState. The BusinessSystem + the
 * operate-business action handler use these to decide:
 *
 *   - **Inputs**: for each required input resource, can the business source
 *     it? Three sources, in priority order (GDD §8.2 vertical integration —
 *     own your suppliers before buying externally):
 *       1. A player-owned **upstream supplier** whose `outputResourceId`
 *          matches the input. Vertical integration — the input is available
 *          within the consolidated group (the upstream already produced it
 *          into the shared `inventory` pool, or will this tick). No external
 *          market purchase; the integration bonus applies to production
 *          efficiency (GDD §8.2: "Vertical integration provides greater
 *          control over costs and supply").
 *       2. The shared **`state.inventory`** — if the input resource is
 *          stocked (produced by an earlier business this tick, or bought by
 *          the player), consume it. No external cost (already paid for when
 *          it entered inventory).
 *       3. The **commodity market** — buy the input at the market price,
 *          debiting the business's cash to the market's account. Only
 *          available for resources with a live `MarketState` (or a
 *          `PROVISIONAL_MARKET_PRICE_*` anchor + a market account). Resources
 *          with neither (e.g. `resource:minerals`, `resource:chemicals` —
 *          intermediates with no GDD §8.5 market) cannot be bought and must
 *          come from inventory / an upstream supplier.
 *     If none of the three can satisfy an input → `satisfied: false` with
 *     reason `'insufficient-inputs'` (the operate step is skipped).
 *
 *   - **Outputs**: where does the produced output go?
 *       1. A player-owned **downstream customer** whose `production.
 *          inputResourceIds` includes the business's `outputResourceId`.
 *          Vertical integration — the output is pushed to the downstream
 *          (into the shared `inventory` pool, where the downstream will
 *          consume it). Revenue is still recognized (the business sold its
 *          output; @provisional the downstream-to-upstream payment routing
 *          lands with P8c market simulation).
 *       2. The **commodity market** — sell the output at the market price.
 *          Only available for resources with a market price anchor. Resources
 *          without a market (intermediates like `resource:minerals`) cannot
 *          be sold directly — they must flow to a downstream customer (else
 *          revenue = 0, the output is still produced into inventory for a
 *          future downstream).
 *
 * All functions are pure: they read the state and return a decision
 * descriptor; they do NOT mutate state. The BusinessSystem applies the
 * decision (transfers + inventory adjustments) via the economy ledger +
 * accounting helpers.
 *
 * @provisional (GDD §17: supply chain integration / market simulation) — P8c
 * adds per-business `inventory` (resolves P8b carry-forward #2: production
 * consumes from `business.inventory`, not the shared `state.inventory` pool)
 * and routes revenue through `executeMarketTransaction` (resolves P8b
 * carry-forward #1: revenue comes from a market sale, not an authority
 * issuance). The upstream supplier's own inventory is not inspected —
 * vertical integration is treated as a virtual provision; a future phase may
 * model cross-business inventory transfers explicitly.
 */
import type { BusinessState, GameState } from '@capitalist-tree/shared';
import {
  PROVISIONAL_MARKET_PRICE_WATER,
  PROVISIONAL_MARKET_PRICE_FERTILIZER,
  PROVISIONAL_MARKET_PRICE_SEEDS,
  PROVISIONAL_MARKET_PRICE_EQUIPMENT,
  PROVISIONAL_MARKET_PRICE_FOOD,
  PROVISIONAL_MARKET_PRICE_ENERGY,
} from '@capitalist-tree/shared';
import { deriveMarketAccountId } from '../economy/markets.js';

/** SECONDS_PER_DAY — used to pro-rate per-day quantities to per-step. */
const SECONDS_PER_DAY = 24 * 60 * 60;

/**
 * Provisional market-price anchors for the GDD §8.5 commodity resources, by
 * resource id. These mirror the P3b `MarketDefinition.basePrice` values where
 * they overlap (water, fertilizer, seeds, food, energy) and supply anchors
 * for resources P3b deferred (equipment). Intermediates
 * (`resource:minerals`, `resource:chemicals`, `resource:timber`,
 * `resource:lumber`, `resource:steel`) have NO market price — they are B2B
 * only (sourced from upstream suppliers / pushed to downstream customers).
 *
 * @provisional (GDD §17: market simulation / initial market prices).
 */
const PROVISIONAL_RESOURCE_PRICE: ReadonlyMap<string, string> = new Map([
  ['resource:water', PROVISIONAL_MARKET_PRICE_WATER],
  ['fertilizer:balanced-10-10-10', PROVISIONAL_MARKET_PRICE_FERTILIZER],
  ['resource:seeds', PROVISIONAL_MARKET_PRICE_SEEDS],
  ['resource:equipment', PROVISIONAL_MARKET_PRICE_EQUIPMENT],
  ['resource:food', PROVISIONAL_MARKET_PRICE_FOOD],
  ['resource:energy', PROVISIONAL_MARKET_PRICE_ENERGY],
]);

/** A market price lookup entry for a resource id. */
export interface MarketPriceEntry {
  /** Resource id (e.g. `resource:water`). */
  resourceId: string;
  /** Unit price in bigint minor units (string — TDD §10.1). */
  price: string;
  /** The economy account id to pay into / draw from for this resource's
   *  market. `undefined` when there is no live market account (the resource
   *  has a provisional price anchor but no `MarketState` — it can be valued
   *  but not bought/sold via a real account). */
  marketAccountId?: string;
  /** The market id (`'market:water'`, etc.) for `executeMarketTransaction`.
   *  Set when a live `MarketState` exists; `undefined` for provisional
   *  anchors. P8c: operateBusiness routes the sale/purchase through
   *  `executeMarketTransaction(marketId, ...)`. */
  marketId?: string;
}

/**
 * Build the market-price lookup map from the current state.
 *
 * Merges:
 *   - The provisional resource-price anchors (`PROVISIONAL_RESOURCE_PRICE`).
 *   - The live `state.economy.markets` (their `commodityId` → `price`, with
 *     the market account id derived from the market id).
 *
 * Live markets override the provisional anchor (the live price reflects
 * supply/demand; the anchor is only the fallback). Entries from live markets
 * carry `marketAccountId`; entries from the provisional anchors (with no live
 * market) carry `marketAccountId: undefined`.
 *
 * Pure: returns a fresh Map; does not mutate state.
 */
export function buildMarketPriceMap(
  state: GameState,
): Map<string, MarketPriceEntry> {
  const map = new Map<string, MarketPriceEntry>();

  // 1. Seed with provisional anchors (no live market account).
  for (const [resourceId, price] of PROVISIONAL_RESOURCE_PRICE) {
    map.set(resourceId, { resourceId, price });
  }

  // 2. Overlay live markets (with market account ids). A live market's
  //    `commodityId` is the resource id it trades (e.g. `resource:water`).
  for (const m of state.economy.markets) {
    map.set(m.commodityId, {
      resourceId: m.commodityId,
      price: m.price,
      marketAccountId: deriveMarketAccountId(m.id),
      marketId: m.id,
    });
  }

  return map;
}

/**
 * Look up the market price (bigint) for a resource id. Returns `undefined`
 * if the resource has no market price anchor and no live market. Pure.
 */
export function getMarketPrice(
  marketPrices: ReadonlyMap<string, MarketPriceEntry>,
  resourceId: string,
): bigint | undefined {
  const entry = marketPrices.get(resourceId);
  if (!entry) return undefined;
  return BigInt(entry.price);
}

/**
 * Does `state.businesses` contain a player-owned business with the given id?
 * "Player-owned" = `ownership.ownerId === player:personal` (the player owns
 * the business; GDD §8.1 consolidated group). Pure.
 */
export function isPlayerOwnedBusiness(
  state: GameState,
  businessId: string,
): boolean {
  const b = state.businesses.find((x) => x.id === businessId);
  if (!b) return false;
  return b.ownership.ownerId === 'player:personal';
}

/**
 * Does the business have at least one player-owned upstream supplier whose
 * `outputResourceId` matches `inputResourceId`? Vertical integration check
 * (GDD §8.2). Pure.
 */
export function hasUpstreamSupplierFor(
  state: GameState,
  business: BusinessState,
  inputResourceId: string,
): boolean {
  for (const supplierId of business.upstreamSupplierIds) {
    const supplier = state.businesses.find((b) => b.id === supplierId);
    if (!supplier) continue;
    if (supplier.ownership.ownerId !== 'player:personal') continue;
    if (supplier.production.outputResourceId === inputResourceId) return true;
  }
  return false;
}

/**
 * Does the business have at least one player-owned downstream customer whose
 * `production.inputResourceIds` includes `outputResourceId`? Pure.
 */
export function hasDownstreamCustomerFor(
  state: GameState,
  business: BusinessState,
  outputResourceId: string,
): boolean {
  for (const customerId of business.downstreamCustomerIds) {
    const customer = state.businesses.find((b) => b.id === customerId);
    if (!customer) continue;
    if (customer.ownership.ownerId !== 'player:personal') continue;
    if (customer.production.inputResourceIds.includes(outputResourceId)) {
      return true;
    }
  }
  return false;
}

/**
 * Whether the business has ANY player-owned upstream supplier (used to gate
 * the vertical-integration efficiency bonus — GDD §8.2 /
 * PROVISIONAL_BUSINESS_SUPPLY_CHAIN_INTEGRATION_BONUS). Pure.
 */
export function hasPlayerOwnedUpstream(
  state: GameState,
  business: BusinessState,
): boolean {
  for (const supplierId of business.upstreamSupplierIds) {
    const supplier = state.businesses.find((b) => b.id === supplierId);
    if (supplier && supplier.ownership.ownerId === 'player:personal') {
      return true;
    }
  }
  return false;
}

/** Where a single required input was sourced from. */
export type InputSource =
  | { kind: 'upstream'; resourceId: string; quantity: number }
  | { kind: 'business-inventory'; resourceId: string; quantity: number }
  | { kind: 'inventory'; resourceId: string; quantity: number }
  | { kind: 'market'; resourceId: string; quantity: number; unitPrice: string; marketAccountId: string; marketId: string }
  | { kind: 'unsatisfied'; resourceId: string; quantity: number };

/** Result of resolving a business's required inputs. */
export interface ResolveInputsResult {
  /** Were ALL required inputs satisfiable? When `false`, `unsatisfiedResource`
   *  names the first input that could not be sourced. */
  satisfied: boolean;
  /** The per-input source decisions (in input order). */
  sources: InputSource[];
  /** The total market purchase cost (bigint string) for inputs bought from a
   *  market. Inputs sourced from inventory / upstream contribute 0. */
  marketCost: string;
  /** When `satisfied === false`, the first input that could not be sourced. */
  unsatisfiedResource?: string;
}

/**
 * Resolve where each required input comes from (GDD §8.2 supply chains).
 *
 * For each `{ resourceId, quantity }` in `requiredInputs`:
 *   1. If the **per-business inventory** (`business.inventory`, P8c field)
 *      stocks `>= quantity` → `kind: 'business-inventory'` (consume from the
 *      business's own stock; no market cost). P8c carry-forward #2:
 *      production consumes from `business.inventory`, NOT the shared
 *      `state.inventory` pool.
 *   2. Else if a player-owned upstream supplier produces this resource →
 *      `kind: 'upstream'` (vertical integration; no market cost).
 *   3. Else if the shared `state.inventory` stocks `>= quantity` →
 *      `kind: 'inventory'` (consume from the shared pool; no market cost —
 *      backward-compat for player-bought resources).
 *   4. Else if a live market account exists for the resource →
 *      `kind: 'market'` (buy at market price; cost += quantity × price).
 *   5. Else → `kind: 'unsatisfied'` (the operate step is skipped with
 *      reason `'insufficient-inputs'`).
 *
 * Returns the decision descriptor. Pure — does not mutate state. The caller
 * (BusinessSystem / operate-business handler) applies the inventory deductions
 * + market transfers (via `executeMarketTransaction` for market-sourced
 * inputs, which credits `business.inventory` so the input enters stock before
 * being consumed — P8c carry-forward #2).
 *
 * @provisional Inventory availability is checked against the per-business
 * `business.inventory` first (P8c), then the shared `state.inventory` pool as
 * a backward-compat fallback. The upstream supplier's own inventory is not
 * inspected — vertical integration is treated as a virtual provision (the
 * downstream assumes the upstream will supply); a future phase may model
 * cross-business inventory transfers explicitly.
 */
export function resolveInputs(
  state: GameState,
  business: BusinessState,
  requiredInputs: readonly { resourceId: string; quantity: number }[],
  marketPrices: ReadonlyMap<string, MarketPriceEntry>,
): ResolveInputsResult {
  const sources: InputSource[] = [];
  let marketCost = 0n;
  let unsatisfiedResource: string | undefined;

  for (const req of requiredInputs) {
    if (req.quantity <= 0) {
      sources.push({ kind: 'business-inventory', resourceId: req.resourceId, quantity: 0 });
      continue;
    }
    // 1. Per-business inventory (P8c carry-forward #2).
    const bizInvItem = business.inventory.find((i) => i.resourceId === req.resourceId);
    if (bizInvItem && bizInvItem.quantity >= req.quantity) {
      sources.push({ kind: 'business-inventory', resourceId: req.resourceId, quantity: req.quantity });
      continue;
    }
    // 2. Upstream player-owned supplier.
    if (hasUpstreamSupplierFor(state, business, req.resourceId)) {
      sources.push({ kind: 'upstream', resourceId: req.resourceId, quantity: req.quantity });
      continue;
    }
    // 3. Shared inventory (backward-compat for player-bought resources).
    const invItem = state.inventory.items.find((i) => i.resourceId === req.resourceId);
    if (invItem && invItem.quantity >= req.quantity) {
      sources.push({ kind: 'inventory', resourceId: req.resourceId, quantity: req.quantity });
      continue;
    }
    // 4. Live market.
    const entry = marketPrices.get(req.resourceId);
    if (entry && entry.marketAccountId && entry.marketId) {
      const unit = BigInt(entry.price);
      const cost = unit * BigInt(Math.floor(req.quantity));
      marketCost += cost;
      sources.push({
        kind: 'market',
        resourceId: req.resourceId,
        quantity: req.quantity,
        unitPrice: entry.price,
        marketAccountId: entry.marketAccountId,
        marketId: entry.marketId,
      });
      continue;
    }
    // 5. Unsatisfied.
    sources.push({ kind: 'unsatisfied', resourceId: req.resourceId, quantity: req.quantity });
    if (unsatisfiedResource === undefined) {
      unsatisfiedResource = req.resourceId;
    }
  }

  const result: ResolveInputsResult = {
    satisfied: unsatisfiedResource === undefined,
    sources,
    marketCost: marketCost.toString(10),
  };
  if (unsatisfiedResource !== undefined) {
    result.unsatisfiedResource = unsatisfiedResource;
  }
  return result;
}

/** Where a produced output goes. */
export interface ResolveOutputsResult {
  /** `'downstream'` if a player-owned downstream customer exists for the
   *  output resource; `'market'` if the output has a market price anchor;
   *  `'stockpile'` if neither (the output is produced into the business's
   *  inventory but generates no revenue this tick — @provisional). */
  destination: 'downstream' | 'market' | 'stockpile';
  /** The downstream customer business id, when `destination === 'downstream'`. */
  downstreamCustomerId?: string;
  /** Unit price for the output (bigint string), when a market price exists.
   *  `undefined` when `destination === 'stockpile'`. */
  unitPrice?: string;
  /** The market account id to credit for a market sale, when
   *  `destination === 'market'` (or `'downstream'` with a market). */
  marketAccountId?: string;
  /** The market id for `executeMarketTransaction`, when a live market exists
   *  for the output. P8c: operateBusiness routes the sale through
   *  `executeMarketTransaction(marketId, buyer=marketAccount, seller=business)`.
   *  `undefined` when the output has no live market (intermediate stockpile). */
  marketId?: string;
}

/**
 * Resolve where a business's produced output goes (GDD §8.2 supply chains).
 *
 *   1. If a player-owned downstream customer consumes this output →
 *      `destination: 'downstream'` (the output is sold at the market price if
 *      one exists — P8c routes the downstream sale through the market account
 *      so revenue comes from a real participant, not an authority issuance).
 *   2. Else if a market price anchor exists for the output →
 *      `destination: 'market'` (sell to the market at the clearing price).
 *   3. Else → `destination: 'stockpile'` (the output is produced into the
 *      business's per-business inventory but generates no revenue this tick —
 *      the business is producing an intermediate with no direct market and no
 *      downstream customer yet; @provisional, a future phase may flag this as
 *      wasted output).
 *
 * Pure — does not mutate state. The caller applies the inventory credit +
 * revenue transfer (via `executeMarketTransaction`).
 */
export function resolveOutputs(
  state: GameState,
  business: BusinessState,
  marketPrices: ReadonlyMap<string, MarketPriceEntry>,
): ResolveOutputsResult {
  const outputResourceId = business.production.outputResourceId;

  // 1. Downstream player-owned customer.
  for (const customerId of business.downstreamCustomerIds) {
    const customer = state.businesses.find((b) => b.id === customerId);
    if (!customer) continue;
    if (customer.ownership.ownerId !== 'player:personal') continue;
    if (customer.production.inputResourceIds.includes(outputResourceId)) {
      // P8c: if the output has a live market, the downstream sale routes
      // through the market account (the market absorbs the output at the
      // clearing price; the downstream will buy from the market when it
      // operates). Revenue comes from a real participant (the market), not
      // an authority issuance. If the output has no market (intermediate),
      // the output stockpiles in the upstream's business.inventory and the
      // downstream resolves it via 'upstream'.
      const entry = marketPrices.get(outputResourceId);
      const downstream: ResolveOutputsResult = {
        destination: 'downstream',
        downstreamCustomerId: customerId,
      };
      if (entry?.price !== undefined) downstream.unitPrice = entry.price;
      if (entry?.marketAccountId !== undefined) {
        downstream.marketAccountId = entry.marketAccountId;
      }
      if (entry?.marketId !== undefined) {
        downstream.marketId = entry.marketId;
      }
      return downstream;
    }
  }

  // 2. Market.
  const entry = marketPrices.get(outputResourceId);
  if (entry) {
    const market: ResolveOutputsResult = {
      destination: 'market',
      unitPrice: entry.price,
    };
    if (entry.marketAccountId !== undefined) {
      market.marketAccountId = entry.marketAccountId;
    }
    if (entry.marketId !== undefined) {
      market.marketId = entry.marketId;
    }
    return market;
  }

  // 3. Stockpile.
  return { destination: 'stockpile' };
}

/** Re-exported for tests / the BusinessSystem. */
export { SECONDS_PER_DAY };
