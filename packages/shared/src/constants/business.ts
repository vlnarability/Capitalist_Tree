/**
 * Business provisional constants (P8a — TDD §5.7 Business State, §11 Personal
 * and Business Accounting; GDD §8 Business and Economic Simulation,
 * §8.4 Growth Pressure, §8.5 Market Simulation).
 *
 * Every value here corresponds to (or stands in for) an unresolved design
 * decision listed in GDD §17. They live in a dedicated file so tuning is
 * localized to one place. The BusinessSystem (P8b) imports these via
 * `@capitalist-tree/shared` — never use magic numbers inside the system.
 *
 * CONVENTION: `PROVISIONAL_BUSINESS_*` / `PROVISIONAL_MARKET_PRICE_*` prefix
 * and a `// PROVISIONAL (GDD §17: <item>)` comment pointing at the GDD entry
 * the value resolves. When a value is promoted from "provisional" to
 * "decided" via playtesting, move it to a sibling `decided.ts` and drop the
 * prefix.
 *
 * All money amounts are bigint minor currency units serialized as string
 * (TDD §10.1) — money is bigint, never floating point.
 */

// ---------------------------------------------------------------------------
// VALUATION & LIQUIDITY (TDD §11 — valuation ≠ liquidity; GDD §8.1 financial
// separation, §8.4 corporate valuation growth pressure)
// ---------------------------------------------------------------------------

// PROVISIONAL (GDD §17: corporate valuation / business valuation model)
//
// Fraction of a business's `valuation` that is LOST when the business is
// liquidated via `sell-business`. The player receives
// `valuation * (1 - PROVISIONAL_BUSINESS_VALUATION_HAIRCUT)` in spendable
// cash. 0.15 means the player gets 85% of the valuation — the haircut
// reflects the illiquidity discount (TDD §11: "Valuation must not be
// confused with liquidity. A business can have substantial assets and
// valuation while having very little available cash."). Liquidating
// converts the valuation to cash at a loss because the sale is forced /
// not at arm's length.
export const PROVISIONAL_BUSINESS_VALUATION_HAIRCUT = 0.15; // fraction lost

// PROVISIONAL (GDD §17: corporate valuation / bankruptcy mechanics)
//
// Cash threshold (bigint minor units as string) below which a business is
// declared bankrupt. Negative so a business can run a small overdraft
// (accrued wages not yet paid) before flipping to bankrupt — mirrors real-
// world short-term solvency vs. insolvency. The BusinessSystem (P8b) flips
// `status` to `'bankrupt'` when `business.cash` drops below this value and
// emits a `business-bankrupt` event. A bankrupt business stops producing
// until the player injects capital or liquidates it.
//
// '-1000' minor units = -$10.00 overdraft tolerance (PROVISIONAL).
export const PROVISIONAL_BUSINESS_BANKRUPTCY_THRESHOLD = '-1000';

// PROVISIONAL (GDD §17: corporate valuation / operating margin)
//
// Default profit margin (fraction of revenue) used as a fallback when the
// BusinessSystem (P8b) recomputes `business.valuation` from cash flow. The
// full valuation considers assets, liabilities, profitability, cash flow,
// expected future performance, and market conditions (TDD §11); this margin
// is the provisional profitability input. 0.10 = 10% margin (PROVISIONAL).
export const PROVISIONAL_BUSINESS_OPERATING_MARGIN = 0.10;

// ---------------------------------------------------------------------------
// DEBT & INTEREST (GDD §8.4 — debt and interest growth pressure)
// ---------------------------------------------------------------------------

// PROVISIONAL (GDD §17: debt and interest model)
//
// Base annualized interest rate (fraction) for loans created via the
// `take-loan` action when the caller does not specify one. The action schema
// requires an explicit `interestRate` (determinism — TDD §18.3), so this
// constant is the *reference* default content authors and the UI use when
// constructing the action payload. 0.05 = 5% / year (PROVISIONAL).
export const PROVISIONAL_BUSINESS_LOAN_DEFAULT_RATE = 0.05;

// ---------------------------------------------------------------------------
// LABOR (GDD §8.4 — labor costs growth pressure)
// ---------------------------------------------------------------------------

// PROVISIONAL (GDD §17: labor model / wage mechanics)
//
// Default wage per employee per pay period (bigint minor units as string),
// used as the `baseWageRate` fallback for business types that don't specify
// one. '500' minor units = $5.00 / employee / pay period (PROVISIONAL). The
// BusinessSystem debits `wageRate * employees` from `business.cash` each pay
// period and sinks it to the authority (external labor) or credits
// `player:personal` (owner-employed labor).
export const PROVISIONAL_BUSINESS_WAGE_DEFAULT = '500';

// PROVISIONAL (GDD §17: labor model / productivity)
//
// Production output per employee per operate step (in units of the
// business's `production.outputResourceId`). The BusinessSystem scales
// `production.rate` by `PROVISIONAL_BUSINESS_EMPLOYEE_PRODUCTIVITY *
// employees` so hiring raises output but also the wage bill (GDD §8.4 labor
// costs). 1.0 = 1 unit of output per employee per operate step (PROVISIONAL).
export const PROVISIONAL_BUSINESS_EMPLOYEE_PRODUCTIVITY = 1.0;

// ---------------------------------------------------------------------------
// SUPPLY CHAIN (GDD §8.2 — vertical integration)
// ---------------------------------------------------------------------------

// PROVISIONAL (GDD §17: supply chain integration / vertical integration bonus)
//
// Efficiency bonus (fraction) applied to a business's `production.efficiency`
// when it is vertically integrated with its upstream supplier (i.e. the
// `upstreamSupplierIds` entry is also player-owned). 0.05 = +5% efficiency
// (PROVISIONAL) — reflects reduced transaction costs and guaranteed input
// supply (GDD §8.2: "Vertical integration provides greater control over
// costs and supply but requires capital, management, infrastructure, and
// resources.").
export const PROVISIONAL_BUSINESS_SUPPLY_CHAIN_INTEGRATION_BONUS = 0.05;

// ---------------------------------------------------------------------------
// MARKET SIMULATION (GDD §8.5 — Market Simulation)
// ---------------------------------------------------------------------------

// PROVISIONAL (GDD §17: market simulation / price volatility)
//
// Fractional price fluctuation range applied by the BusinessSystem (P8b) /
// EconomySystem when a business transacts in a market. A value of 0.10 means
// prices can move ±10% per tick from supply/demand + scarcity + production
// cost + monetary conditions (GDD §8.5). Tuned so markets are lively but not
// chaotic over a play session (PROVISIONAL).
export const PROVISIONAL_BUSINESS_MARKET_PRICE_VOLATILITY = 0.10;

// PROVISIONAL (GDD §17: market simulation / initial market prices)
//
// Baseline prices for the GDD §8.5 commodity markets, in bigint minor
// currency units as string (TDD §10.1). These mirror the P3b
// `MarketDefinition.basePrice` values where they overlap (water, fertilizer,
// seeds, food, energy) and supply provisional anchors for the three GDD §8.5
// markets P3b deferred (equipment, labor, land). The BusinessSystem uses
// these as reference points when a business buys/sells in a market that
// doesn't yet have a live `MarketState` entry (defensive — P8a does not add
// the equipment/labor/land markets to initial state; P8c+ may).
//
// Values:
//   WATER       = '10'      ($0.10 / litre — matches P3b water market)
//   FERTILIZER  = '500'     ($5.00 / unit — matches P3b fertilizer market)
//   SEEDS       = '200'     ($2.00 / unit — matches P3b seeds market)
//   EQUIPMENT   = '20000'   ($200.00 / unit — PROVISIONAL, no P3b market yet)
//   FOOD        = '300'     ($3.00 / unit — matches P3b food market)
//   ENERGY      = '50'      ($0.50 / kWh — matches P3b energy market)
//   LABOR       = '500'     ($5.00 / person-day — PROVISIONAL, no P3b market)
//   LAND        = '100000'  ($1000.00 / unit — PROVISIONAL, no P3b market)
export const PROVISIONAL_MARKET_PRICE_WATER = '10';
export const PROVISIONAL_MARKET_PRICE_FERTILIZER = '500';
export const PROVISIONAL_MARKET_PRICE_SEEDS = '200';
export const PROVISIONAL_MARKET_PRICE_EQUIPMENT = '20000';
export const PROVISIONAL_MARKET_PRICE_FOOD = '300';
export const PROVISIONAL_MARKET_PRICE_ENERGY = '50';
export const PROVISIONAL_MARKET_PRICE_LABOR = '500';
export const PROVISIONAL_MARKET_PRICE_LAND = '100000';

// ---------------------------------------------------------------------------
// MARKET DEMAND LIQUIDITY (P8c — GDD §8.5 Market Simulation; resolves P8b
// carry-forward #1: revenue recognized as authority issuance)
// ---------------------------------------------------------------------------

// PROVISIONAL (GDD §17: market simulation / external demand liquidity)
//
// When a business sells output to a commodity market and the market's account
// balance is insufficient to cover the sale, the authority injects just enough
// liquidity (issuance → market account) to fund the purchase. This represents
// external market demand — buyers from outside the simulation (other cities,
// export markets) — and ensures the market is a REAL PARTICIPANT (the
// transfer is market → business, not authority → business issuance). The
// injection is capped at the sale amount; the market account never goes
// negative. P3b's `applyPurchase` (player buys from market) credits the market
// account; over time, as players and businesses transact, the injection
// becomes less frequent. The flag toggles the behavior on (default) so tests
// can disable it to assert the market-pays-business transfer alone.
//
// `true` = inject liquidity when the market account is the buyer and has
// insufficient balance (default — keeps the simulation running without
// grace-skipping every market sale at game start when market accounts hold
// '0'). `false` = the sale fails with InsufficientFundsError (graceful skip
// in operateBusiness). Production code leaves this `true`.
export const PROVISIONAL_BUSINESS_MARKET_DEMAND_INJECTION_ENABLED = true;

// ---------------------------------------------------------------------------
// GROWTH PRESSURE (P8c — GDD §8.4 Growth Pressure)
// ---------------------------------------------------------------------------

// PROVISIONAL (GDD §17: shareholder expectations / corporate governance)
//
// Expected per-tick revenue growth rate (fraction) for corporations
// (`ownership.structure === 'corporation'`). When a corporation's per-tick
// revenue growth falls below this rate, the BusinessSystem's
// `applyShareholderExpectations` helper emits a `shareholder-pressure`
// notification and reduces the corporation's valuation by the shortfall
// scaled by the operating margin factor (TDD §11 — valuation reflects
// expected future performance). 0.001 = 0.1% per tick (PROVISIONAL — tuned
// for a 60s tick; annualized ≈ 0.001 × 525600 ticks ≈ 525x which is too
// aggressive; in practice revenue is lumpy per tick so the rate acts as a
// smoothing threshold, not a compound growth target).
export const PROVISIONAL_BUSINESS_SHAREHOLDER_EXPECTED_GROWTH_RATE = 0.001;

// PROVISIONAL (GDD §17: shareholder expectations / valuation haircut)
//
// Fraction of the valuation shortfall applied as a penalty when a corporation
// underperforms shareholder expectations. The shortfall is
// `(expectedRevenue - actualRevenue)` for the tick; the valuation is reduced
// by `floor(shortfall × penaltyFactor × operatingMarginFactor)`. 0.5 = 50% of
// the shortfall hits valuation (PROVISIONAL — calibrated so a single bad tick
// doesn't crater the valuation, but sustained underperformance compounds).
export const PROVISIONAL_BUSINESS_SHAREHOLDER_VALUATION_PENALTY = 0.5;

// PROVISIONAL (GDD §17: competition / market share erosion)
//
// Per-tick market-share erosion rate (fraction) applied to a business whose
// efficiency is below the average of businesses selling to the same market.
// The less-efficient business loses `PROVISIONAL_BUSINESS_COMPETITION_EROSION_RATE
// × (avgEfficiency - businessEfficiency)` of its output share each tick
// (modeled as a reduction in effective production rate). 0.10 = 10% per tick
// of the efficiency gap (PROVISIONAL — keeps inefficient businesses declining
// visibly but not collapsing instantly).
export const PROVISIONAL_BUSINESS_COMPETITION_EROSION_RATE = 0.10;

// PROVISIONAL (GDD §17: inflation / operating cost scaling)
//
// Fraction of the economy's `inflationIndex - 1.0` applied to a business's
// `wageRate` each tick (GDD §8.4 inflation growth pressure). The wageRate
// grows by `floor(wageRate × (inflationIndex - 1) × scalingFactor ×
// dtFraction)` per tick — a small drift that mirrors real-world wage-price
// spirals. 1.0 = full pass-through of the inflation delta (PROVISIONAL; a
// future phase may add a wage-stickiness dampener).
export const PROVISIONAL_BUSINESS_INFLATION_WAGE_PASS_THROUGH = 1.0;
