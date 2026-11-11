/**
 * Economy provisional constants (P3 — TDD §10, GDD §6).
 *
 * Every value here corresponds to (or stands in for) an unresolved design
 * decision listed in GDD §17 (currency issuance mechanics, monetary policy,
 * inflation model). They live in a dedicated file so economy tuning is
 * localized to one place. The simulation engine imports these via
 * `@capitalist-tree/shared` — never use magic numbers inside the EconomySystem.
 *
 * CONVENTION: `PROVISIONAL_ECONOMY_*` prefix and a `// PROVISIONAL (GDD §17:
 * <item>)` comment pointing at the GDD entry the value resolves. When a
 * value is promoted from "provisional" to "decided" via playtesting, move it
 * to a sibling `decided.ts` and remove the prefix.
 */

// PROVISIONAL (GDD §6.2 / §17: currency issuance mechanics and monetary policy)
//
// Account id of the central monetary authority. The authority is the virtual
// "mint" — it is the source of newly issued currency and the sink for currency
// removed from circulation (taxes, fees, central-bank interventions).
//
// The authority does NOT have an entry in `economy.accounts` — its net
// position is implied by `totalIssued - totalSinks`. Transactions involving
// the authority use this string as `sourceAccount` (issuance) or
// `destinationAccount` (sink).
export const PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID = 'authority';

// PROVISIONAL (GDD §8.1 / §17: personal vs business finances)
//
// Account id of the player's personal cash account. Personal and business
// finances MUST remain separate (GDD §8.1) — this is the personal-cash
// account only. P3c may add business accounts (e.g. `business:<id>:cash`).
export const PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID = 'player:personal';

// PROVISIONAL (GDD §17: currency issuance mechanics)
//
// Default external-participants account. Markets and external suppliers
// transact through this account. P3b will populate per-market accounts.
export const PROVISIONAL_ECONOMY_EXTERNAL_ACCOUNT_ID = 'external:default';

// PROVISIONAL (GDD §17: currency issuance mechanics and monetary policy)
//
// Human-readable labels for the default accounts. The UI may override these
// with localized strings; these are the canonical fallbacks.
export const PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_LABEL = 'Player Personal';
export const PROVISIONAL_ECONOMY_EXTERNAL_ACCOUNT_LABEL = 'External Participants';

// PROVISIONAL (GDD §17: currency issuance mechanics and monetary policy)
//
// Maximum currency (minor units, bigint-as-string) that may be issued per
// single CurrencyIssuanceRequest. `null` means no per-request cap. P3a
// defaults to uncapped so we can validate the ledger plumbing end-to-end;
// P3c+ may set a cap as a monetary-policy lever.
export const PROVISIONAL_ECONOMY_ISSUANCE_MAX_PER_REQUEST_MINOR: string | null = null;

// PROVISIONAL (GDD §17: currency issuance mechanics and monetary policy)
//
// Maximum cumulative currency issuance across all requests. `null` means no
// cumulative cap. P3a defaults to uncapped.
export const PROVISIONAL_ECONOMY_ISSUANCE_MAX_TOTAL_MINOR: string | null = null;

// PROVISIONAL (GDD §17: currency issuance mechanics and monetary policy)
//
// Fraction of each issued amount that is immediately sunk (removed from
// circulation) as an issuance fee, in [0, 1]. 0 = no fee (P3a default). A
// non-zero value would record a separate `fee` transaction sinking the fee
// portion back to the authority — keeping the conservation invariant intact.
// P3a does NOT honour this field yet (no fee transactions); the hook exists
// so P3c can wire it without changing the schema.
export const PROVISIONAL_ECONOMY_ISSUANCE_FEE_FRACTION = 0;

// Transaction category constants — short machine codes used in the
// `category` field of TransactionRecord. These are NOT Zod enums (yet) so
// P3b/c can add new categories without a schema migration. They are the
// canonical strings the engine emits; consumers may switch on them.
export const PROVISIONAL_ECONOMY_CATEGORY_ISSUANCE = 'issuance';
export const PROVISIONAL_ECONOMY_CATEGORY_SINK = 'sink';
export const PROVISIONAL_ECONOMY_CATEGORY_TRANSFER = 'transfer';
export const PROVISIONAL_ECONOMY_CATEGORY_PURCHASE = 'purchase';
export const PROVISIONAL_ECONOMY_CATEGORY_EXPENSE = 'expense';
export const PROVISIONAL_ECONOMY_CATEGORY_TAX = 'tax';
export const PROVISIONAL_ECONOMY_CATEGORY_FEE = 'fee';

// ============================================================================
// P3b — Market pricing + inflation index (TDD §10.6, GDD §8.5, §6.3).
//
// All values here are @provisional per GDD §17 ("Exact inflation model" +
// "currency issuance mechanics and monetary policy"). They parameterize the
// pricing model in packages/simulation/src/economy/markets.ts — the engine
// never hardcodes tuning numbers, only imports from here.
// ============================================================================

// PROVISIONAL (GDD §17: Exact inflation model)
//
// Per-market price elasticity — how strongly a market's price responds to
// the demand/supply ratio. The target price is computed as:
//
//   targetPrice = basePrice × supplyDemandFactor × monetaryConditionsFactor
//   supplyDemandFactor = clamp(
//     1 + ELASTICITY × ln( max(demand, MIN_SCALE) / max(supply, MIN_SCALE) ),
//     MIN_FRACTION, MAX_MULTIPLIER
//   )
//
// 0.1 = a 2× demand-over-supply moves the price by ln(2) × 0.1 ≈ 6.9%.
// Conservative for a starter economy; P5+ tuning will calibrate from
// playtest data. The log form (rather than the linear difference) ensures
// extreme imbalances (supply → 0 with demand huge, or vice-versa) push
// the raw factor past the clamps, so the clamps actually engage — see
// `packages/simulation/src/economy/markets.ts` for the full derivation.
export const PROVISIONAL_ECONOMY_MARKET_PRICE_ELASTICITY = 0.1;

// PROVISIONAL (GDD §17: Exact inflation model)
//
// Floor on the supply/demand ratio components. Prevents the elasticity
// formula from producing NaN / ±Infinity when a market has no recent
// activity (supply and demand both 0). Both `demand` and `supply` are
// floored at `MIN_SCALE` before the ratio is taken: with MIN_SCALE = 10,
// a market with `demand=5, supply=0` gets `ratio = max(5, 10) / max(0, 10)
// = 10 / 10 = 1.0` → `factor = 1.0` (no pressure). A market with
// `demand=100, supply=0` gets `ratio = 100 / 10 = 10` → `factor = 1 +
// ELASTICITY × ln(10) ≈ 1.23`.
export const PROVISIONAL_ECONOMY_MARKET_MIN_SCALE = 10;

// PROVISIONAL (GDD §17: Exact inflation model)
//
// Floor on the supply/demand pricing factor. `supplyDemandFactor` is clamped
// to `[MIN_FACTOR, MAX_MULTIPLIER]` before multiplying into the target price.
// 0.5 = price can fall to half its base (oversupply crash). Tuned for a
// forgiving starter economy.
export const PROVISIONAL_ECONOMY_MARKET_PRICE_MIN_FRACTION = 0.5;

// PROVISIONAL (GDD §17: Exact inflation model)
//
// Ceiling on the supply/demand pricing factor. 2.0 = price can rise to
// double its base (acute scarcity). Tuned so a sapling-era player can
// still afford water during a drought.
export const PROVISIONAL_ECONOMY_MARKET_PRICE_MAX_MULTIPLIER = 2.0;

// PROVISIONAL (GDD §17: Exact inflation model)
//
// Monetary conditions elasticity — how strongly market prices respond to a
// change in the money supply relative to the starting supply. The target
// price multiplier is:
//
//   monetaryConditionsFactor = 1 + MONETARY_CONDITIONS_ELASTICITY
//                                      × (monetarySupply / initialSupply - 1)
//
// 0.5 = a 100% growth in money supply (vs the starting supply) raises all
// prices by 50% (capped to MAX_MULTIPLIER per-market). Captures the GDD §8.5
// rule that "monetary conditions" feed into prices (TDD §10.6 lists
// "monetary conditions" as a price driver).
export const PROVISIONAL_ECONOMY_MONETARY_CONDITIONS_ELASTICITY = 0.5;

// PROVISIONAL (GDD §17: Exact inflation model)
//
// Price smoothing factor in [0, 1]. Each tick the market's `price` lerps
// toward the `targetPrice`:
//
//   price' = price + (targetPrice - price) × SMOOTHING
//
// 0.25 = 25% of the gap closes per tick. With SIMULATION_STEP_SECONDS = 60,
// prices converge to ~95% of target within ~8 ticks (~8 sim-minutes). Slower
// smoothing makes the economy feel sticky; faster smoothing makes prices
// swing wildly on each purchase. 0.25 is a starter value.
export const PROVISIONAL_ECONOMY_MARKET_PRICE_SMOOTHING = 0.25;

// PROVISIONAL (GDD §17: Exact inflation model)
//
// Per-tick supply refill rate (units per tick). Markets passively restock
// each tick, representing background supplier activity. Combined with the
// demand decay (below), this gives markets a natural equilibrium supply of
// `SUPPLY_REFILL_RATE / SUPPLY_DECAY = 1 / 0.05 = 20` units when no
// purchases occur. This is intentionally lower than INITIAL_SUPPLY (100) so
// a fresh game's markets slowly drain toward equilibrium as the player
// starts purchasing, providing visible supply dynamics without the market
// immediately bouncing back to full stock after a purchase spike (which
// would erase the demand signal before prices can respond).
export const PROVISIONAL_ECONOMY_MARKET_SUPPLY_REFILL_RATE = 1;

// PROVISIONAL (GDD §17: Exact inflation model)
//
// Per-tick demand decay (fraction in [0, 1]). Each tick the market's demand
// is multiplied by `(1 - DECAY)`. A purchase adds to demand; the decay
// gradually returns it to 0 when no further purchases occur. 0.01 = 1% of
// the demand evaporates each tick — slow enough that a single purchase
// spike keeps the demand signal (and elevated prices) for ~50–100 ticks,
// giving the pricing model time to actually move the price in response.
// A faster decay (e.g. 0.1) would erase the spike before the smoothed
// price could respond, leaving the demand signal invisible to players.
export const PROVISIONAL_ECONOMY_MARKET_DEMAND_DECAY = 0.01;

// PROVISIONAL (GDD §17: Exact inflation model)
//
// Per-tick supply decay (fraction in [0, 1]). Symmetric to demand decay —
// markets with no demand slowly spoil / rotate stock. 0.05 = 5% of supply
// evaporates each tick. Lower than demand decay so markets don't drain
// themselves when nothing happens.
export const PROVISIONAL_ECONOMY_MARKET_SUPPLY_DECAY = 0.05;

// PROVISIONAL (GDD §17: Exact inflation model)
//
// Annualization factor for the derived inflation rate. Each tick, the
// EconomySystem computes `inflationIndex` (Laspeyres basket of current
// prices / base prices) and derives `inflationRate` as:
//
//   inflationRate = (indexNow / indexPrev - 1) × ANNUALIZATION
//
// With SIMULATION_STEP_SECONDS = 60 (1 sim-minute) and
// PROVISIONAL_REAL_TO_SIM_SECONDS = 60, one real second = one sim second;
// one real minute = one sim minute. So one tick = 1 real minute = 1/525600
// of a year. ANNUALIZATION = 525600 expresses the per-tick index change
// as an annualized rate for display purposes (the UI may show "2.4%/yr").
//
// This is purely cosmetic — the per-tick index change is what drives real
// purchasing power (the basket index itself, not the annualized rate).
export const PROVISIONAL_ECONOMY_INFLATION_RATE_ANNUALIZATION = 525_600;

// PROVISIONAL (GDD §17: Exact inflation model)
//
// Initial equilibrium supply for a freshly seeded market. Markets start
// with `supply = INITIAL_SUPPLY, demand = 0`, so the supply/demand factor
// is `1 + ELASTICITY × ln(MIN_SCALE / INITIAL_SUPPLY) = 1 + 0.1 × ln(0.1)
// ≈ 0.77` — a mild deflationary bias that's quickly overtaken by the
// player's purchases or by monetary-conditions growth (issuance).
export const PROVISIONAL_ECONOMY_MARKET_INITIAL_SUPPLY = 100;

// PROVISIONAL (GDD §8.1 / §17: personal vs business finances)
//
// Account id prefix for per-market external accounts. Each market has a
// dedicated external account (`market:water`, `market:fertilizer`, ...).
// Purchases transfer cash from `player:personal` to the market's account —
// the market "holds" the revenue. P3c+ may drain these to the authority
// (supplier taxes) or route to player-owned business accounts (TDD §10.5).
export const PROVISIONAL_ECONOMY_MARKET_ACCOUNT_PREFIX = 'market:';
