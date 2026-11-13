# Business & Economic Organizations (P8 — final)

**Status:** Source-of-truth contract for the P8 Business (P8a–P8d)
implementation. Built on `docs/GDD.txt` §8 (Business and Economic
Simulation) — §8.1 (Financial Separation), §8.2 (Supply Chains), §8.3
(Economic Organizations), §8.4 (Growth Pressure), §8.5 (Market Simulation);
and `docs/TDD.txt` §5.7 (Business State), §11 (Personal and Business
Accounting), §10 (Economic Engine — money movements reuse P3a's ledger),
§18 (Testing Strategy).

P8 is the last sub-task of Phase 8. It supersedes the P0 stub in
`packages/simulation/src/systems/stubs.ts` — the `BusinessSystem` is now a
real, pure, deterministic system (P8b) at registry slot #8. P8a added the
`BusinessState` schema fields (status, lastOperatedAt, supplyChainLevel,
upstream/downstream ids, environmentalImpact, wageRate, marketParticipation,
lastValuationTick) + 8 business actions + 8 business events + 9
`BusinessTypeDefinition`s across 6 supply chain levels + the
`PROVISIONAL_BUSINESS_*` / `PROVISIONAL_MARKET_PRICE_*` constants + the
v9→v10 migration; P8b built the BusinessSystem + the pure helpers
(accounting, valuation, supply-chain, production, actions) + the 8 action
handlers + the `errors.ts` typed-error surface; P8c wired the market
revenue path (`clearMarkets` + `executeMarketTransaction` with the
demand-injection liquidity backstop — resolves P8b carry-forward #1),
per-business inventory (resolves P8b carry-forward #2), the
interest/principal split in `repay-loan` (resolves P8b carry-forward #3),
and the four GDD §8.4 growth-pressure helpers (inflation, debt interest,
shareholder expectations, competition); P8d wrote this document + verified
the carry-forward list + ran the full suite. The remaining stubbed systems
(Progression, Event) stay stubbed until P9+.

This document is paired with `docs/GDD.txt` and `docs/TDD.txt`. Where this
document and the GDD/TDD disagree, the GDD/TDD win and a fix must be filed
against this document.

> **Scope flag.** Every `@provisional` constant in this document corresponds
> to (or stands in for) an unresolved design decision listed in `GDD §17`.
> They live in `packages/shared/src/constants/business.ts` under the
> `PROVISIONAL_BUSINESS_*` / `PROVISIONAL_MARKET_PRICE_*` prefixes, plus one
> local `@provisional` constant inside `packages/simulation/src/business/`
> (`BUSINESS_VALUATION_INTERVAL_SECONDS` in `valuation.ts`, R-P8-5). P9+
> playtesting will calibrate them; until then the engine NEVER hardcodes
> tuning numbers, only imports.

---

## 1. Public interfaces at a glance

| Surface                                        | Location                                                        | P8 phase |
|------------------------------------------------|-----------------------------------------------------------------|----------|
| `BusinessState` schema (state, ownership, cash, assets, liabilities, production, inventory, env impact) | `packages/shared/src/schemas/business.ts` | P0 base + P8a/P8c |
| Business action schemas (8 variants)           | `packages/shared/src/schemas/actions-business.ts`              | P8a      |
| Business event schemas (8 variants)            | `packages/shared/src/schemas/events-business.ts`               | P8a      |
| Business constants (`PROVISIONAL_BUSINESS_*`, `PROVISIONAL_MARKET_PRICE_*`) | `packages/shared/src/constants/business.ts` | P8a/P8c |
| Migration v9→v10 (9 BusinessState operational fields) | `packages/shared/src/migrations/defaults.ts` (`v9ToV10`) | P8a |
| Migration v10→v11 (per-business `inventory` + `accruedInterest`) | `packages/shared/src/migrations/defaults.ts` (`v10ToV11`) | P8c |
| Business content — 9 defs across 6 supply-chain levels | `packages/content/src/businesses/`                      | P8a      |
| `accounting.ts` — bigint arithmetic + revenue/expenses + `accrueInterest` + `checkBankruptcy` | `packages/simulation/src/business/accounting.ts` | P8b/P8c |
| `valuation.ts` — `recomputeValuation` + cadence | `packages/simulation/src/business/valuation.ts`                | P8b      |
| `supply-chain.ts` — input/output resolution + vertical integration | `packages/simulation/src/business/supply-chain.ts` | P8b/P8c |
| `production.ts` — `runProduction` + `operateBusiness` orchestration | `packages/simulation/src/business/production.ts` | P8b/P8c |
| `market.ts` — `clearMarkets` + `executeMarketTransaction` (demand injection) | `packages/simulation/src/business/market.ts` | P8c |
| `growth-pressure.ts` — inflation / debt interest / shareholder / competition | `packages/simulation/src/business/growth-pressure.ts` | P8c |
| `actions.ts` — 8 action handlers + `createBusinessFromDefinition` | `packages/simulation/src/business/actions.ts` | P8b/P8c |
| `errors.ts` — 5 typed errors                    | `packages/simulation/src/business/errors.ts`                   | P8b      |
| `systems/business.ts` — `BusinessSystem` (registry slot #8) | `packages/simulation/src/systems/business.ts`       | P8b/P8c |

The `engine.executeAction` dispatch table
(`packages/simulation/src/actions/handlers.ts`) registers these P8b
actions:

| Action                | Handler                    | P8 phase | Notes                                             |
|-----------------------|----------------------------|---------|---------------------------------------------------|
| `purchase-business`   | `purchaseBusinessHandler`  | P8b     | Debits `baseCost` from `player:personal` (sink to authority); registers a `business`-type cash account; appends a `BusinessState`. Idempotent on `requestId`. |
| `operate-business`    | `operateBusinessHandler`   | P8b     | Delegates to the shared `operateBusiness` orchestration (one production cycle). Content-gated by `supportedActions`. |
| `sell-business`       | `sellBusinessHandler`      | P8b     | Liquidation: flips to `liquidating`, issues `valuation×(1−haircut)` proceeds, settles liabilities, credits residue to player, removes business + account. |
| `take-loan`           | `takeLoanHandler`          | P8b     | Appends a `Liability`; credits principal via authority issuance. Idempotent on `requestId`. |
| `repay-loan`          | `repayLoanHandler`         | P8c     | Pays `accruedInterest` FIRST, then reduces `principal` (P8c carry-forward #3 split). Sinks the total to the authority. |
| `hire-employees`      | `hireEmployeesHandler`     | P8b     | Increments `employees` by `count`. No solvency pre-check (the BusinessSystem flips to bankrupt if wages push cash below threshold). |
| `lay-off-employees`   | `layOffEmployeesHandler`   | P8b     | Decrements `employees` by `count`, clamped at 0. No severance (R-P8 — `@provisional`). |
| `set-business-status` | `setBusinessStatusHandler` | P8b     | Flips between `operating` and `idle`. Rejects `bankrupt`/`liquidating` (system-internal). Idempotent. |

---

## 2. Business state (TDD §5.7, §11)

`BusinessState` (`packages/shared/src/schemas/business.ts`) is the per-
business record. P0 shipped the base shape (id, name, type, ownership,
cash, assets, liabilities, revenue, expenses, valuation, employees,
production); P8a extended it with the operational fields needed for the
BusinessSystem + supply chains + markets + growth pressure; P8c added the
per-business `inventory` field. The full shape:

```typescript
interface BusinessState {
  id: string;                       // 'business:<typeSlug>:<index>' — P0
  name: string;                     // human-readable label — P0
  type: string;                     // BusinessTypeDefinition id — P0
  ownership: {                      // P0
    ownerId: string;               //   'player:personal' for owned
    structure: 'sole-proprietorship'|'corporation'|'cooperative'
             |'sustainable-enterprise'|'non-profit'|'state-owned'; // P8a widened
    share: number;                  //   [0,1]
  };
  cash: string;                     // bigint minor units — P0 (mirror of the business account balance)
  assets: BusinessAsset[];          // { id, type, value: bigint-string } — P0
  liabilities: Liability[];         // { id, type, principal, interestRate, dueAt, accruedInterest } — P0 + P8c
  revenue: string;                  // cumulative recognized revenue — P0
  expenses: string;                 // cumulative incurred expenses — P0
  valuation: string;                // bigint minor units — P0 (TDD §11: ≠ liquidity)
  employees: number;                // headcount — P0
  production: {                     // P0
    inputResourceIds: string[];
    outputResourceId: string;
    rate: number;                   //   output per operate step
    efficiency: number;             //   [0,1]
  };
  status: 'operating'|'idle'|'bankrupt'|'liquidating'; // P8a — default 'operating'
  lastOperatedAt: number;           // P8a — sim seconds of last operate step
  supplyChainLevel: number;         // P8a — 0=extraction … 5=application (GDD §8.2)
  upstreamSupplierIds: string[];    // P8a — business ids this one buys inputs from
  downstreamCustomerIds: string[];  // P8a — business ids this one sells outputs to
  environmentalImpact: EnvironmentalImpact; // P8a — 6 channels (reuses P6 schema, pillar 4)
  wageRate: string;                 // P8a — bigint minor units per employee per pay period
  marketParticipation: string[];    // P8a — which GDD §8.5 markets this business buys/sells in
  lastValuationTick: number;        // P8a — sim seconds of last valuation recompute
  inventory: { resourceId: string; quantity: number }[]; // P8c — per-business resource stocks
}
```

### P0 base vs P8a/P8c additions

| Field | Origin | Owner / status |
|---|---|---|
| `id`, `name`, `type`, `ownership` | P0 | The `purchase-business` handler derives `id` = `business:<typeSlug>:<index>`; `ownership.structure` defaults to `'sole-proprietorship'` (player owns 100%). |
| `cash`, `assets`, `liabilities`, `revenue`, `expenses` | P0 | The economy ledger (`economy.accounts[<businessId>]`) is the source of truth for the cash balance; `business.cash` is a denormalized mirror (same coupling as `player.personalCash`). `revenue`/`expenses` are cumulative accumulators the BusinessSystem bumps via `applyRevenue`/`applyExpenses` after each transfer. |
| `valuation`, `employees`, `production` | P0 | `valuation` is recomputed on a slower cadence (TDD §11 — ≠ liquidity, §11). `employees` adjusted by hire/lay-off actions. `production` copied from the definition at purchase. |
| `ownership.structure` enum | P0 + **P8a** | P0 had five values; P8a added `'sustainable-enterprise'` (GDD §8.3 lists six economic organizations). Zod enum widening is backward-compatible — no data migration. |
| `liabilities[*].accruedInterest` | **P8c** | Tracked SEPARATELY from `principal` (resolves P8b carry-forward #3). `accrueDebtInterest` grows it each tick; `repay-loan` pays it FIRST. Zod `.default('0')` so v10 saves parse under v11; the v10→v11 migration backfills it. |
| `status`, `lastOperatedAt`, `supplyChainLevel`, `upstreamSupplierIds`, `downstreamCustomerIds`, `environmentalImpact`, `wageRate`, `marketParticipation`, `lastValuationTick` | **P8a** | Nine operational fields. All have Zod `.default(...)` so v9 saves parse under v10; the v9→v10 migration backfills them. Populated from the `BusinessTypeDefinition` at purchase. |
| `inventory` | **P8c** | Per-business resource stocks (resolves P8b carry-forward #2). Production consumes from this; outputs are credited here then drained when sold. Zod `.default([])` so v10 saves parse under v11; the v10→v11 migration backfills it. |

`CURRENT_SCHEMA_VERSION = 11` (P8c). All P8 fields survive save/load
because every new field has a Zod `.default(...)` AND an explicit migration
backfill.

### The valuation ≠ liquidity rule (TDD §11)

TDD §11 is explicit: "Valuation must not be confused with liquidity. A
business can have substantial assets and valuation while having very little
available cash. The player should not be able to spend business valuation
directly without selling assets, borrowing, or raising capital." The
BusinessSystem upholds this by construction:

- `revenue` increases `cash` (the transfer credits the business account);
  it does NOT touch `valuation`.
- `valuation` is recomputed on a slower cadence (one sim day,
  `BUSINESS_VALUATION_INTERVAL_SECONDS`) from assets + profitability −
  liabilities — see §11.
- `sell-business` converts `valuation` to spendable cash with a haircut
  (`PROVISIONAL_BUSINESS_VALUATION_HAIRCUT`) — you get a fraction of the
  valuation in real money because the sale is forced / not at arm's length.

---

## 3. Business types — 9 defs across 6 supply chain levels (P8a — GDD §8.2)

`packages/content/src/businesses/` defines 9 `BusinessTypeDefinition`s,
split one file per supply chain level (rule 5: content is data, never
hardcoded in engine logic — the same pattern as `equipment/` and
`markets/`). Each definition is a pure data object the
`purchase-business` handler reads to instantiate a `BusinessState`.

| Level | Category      | Business id                       | Output                  | Inputs                          | marketParticipation                       | File            |
|-------|---------------|-----------------------------------|-------------------------|---------------------------------|-------------------------------------------|-----------------|
| 0     | extraction    | `business:water-extraction-plant` | `resource:water`        | `[]`                            | `['market:water']`                        | `extraction.ts` |
| 0     | extraction    | `business:mineral-mine`           | `resource:minerals`     | `[]`                            | `[]` (R-P8-6 — B2B vertical integration)  | `extraction.ts` |
| 1     | processing    | `business:chemical-plant`         | `resource:chemicals`    | `['resource:minerals']`         | `['market:energy']` (buys energy; sells B2B) | `processing.ts` |
| 1     | processing    | `business:sawmill`                | `resource:lumber`       | `['resource:timber']`           | `['market:energy']`                       | `processing.ts` |
| 2     | manufacturing | `business:fertilizer-factory`     | `fertilizer:balanced-10-10-10` | `['resource:chemicals']` | `['market:fertilizer','market:energy']`   | `manufacturing.ts` |
| 2     | manufacturing | `business:equipment-factory`      | `resource:equipment`    | `['resource:lumber','resource:steel']` | `['market:equipment','market:energy']` (R-P8-8 — equipment market deferred) | `manufacturing.ts` |
| 3     | distribution  | `business:distribution-company`   | `fertilizer:balanced-10-10-10` (pass-through) | `['fertilizer:balanced-10-10-10']` | `['market:fertilizer','market:energy']` | `distribution.ts` |
| 4     | retail        | `business:general-store`          | `fertilizer:balanced-10-10-10` (pass-through) | `['fertilizer:balanced-10-10-10']` | `['market:fertilizer','market:food','market:energy']` (R-P8-7 — retail markup) | `retail.ts` |
| 5     | application   | `business:farm`                   | `resource:food`         | `['fertilizer:balanced-10-10-10','resource:seeds','resource:water']` | `['market:fertilizer','market:seeds','market:water','market:food','market:energy']` | `application.ts` |

The 6 levels mirror GDD §8.2's fertilizer supply chain example (raw
extraction → chemical production → fertilizer manufacturing → distribution
→ retail → agricultural application). Each definition carries: `baseCost`
(one-time purchase price, bigint minor), `baseEmployees`, `baseWageRate`,
`baseEnvironmentalImpact` (6 channels per GDD §9.1 / pillar 4),
`baseValuation` (starting valuation, > `baseCost` so the operating margin
is positive), `marketParticipation`, and `supportedActions` (the 8 business
action types — every definition supports all 8 in P8a; the content gate
exists so a future definition can restrict them). Higher tiers trade
throughput / capability against higher cost + environmental impact (the
pillar-4 efficiency-vs-sustainability tension).

`getBusinessTypeById` (`packages/content/src/businesses/index.ts`) is the
canonical lookup; the `purchase-business` handler resolves
`businessTypeId` through it (unknown id → `UnknownBusinessTypeError`).

---

## 4. Production model (P8b — GDD §8.2, §8.4, §8.5)

**File:** `packages/simulation/src/business/production.ts`.

The pure production calculation (`runProduction`) computes how much output
a business produces in `dtSeconds`, the inputs consumed, the revenue, and
the expenses. The full operate orchestration (`operateBusiness`) resolves
supply-chain inputs → runs the plan → resolves outputs → moves money →
applies environmental impact → updates accounting fields.

```
dtFraction          = dtSeconds / SECONDS_PER_DAY                       (fraction of a sim day)
employeeScale       = employees × PROVISIONAL_BUSINESS_EMPLOYEE_PRODUCTIVITY
effectiveEfficiency = hasPlayerOwnedUpstream
                       ? min(1, efficiency + INTEGRATION_BONUS)
                       : efficiency                                  (vertical integration bonus)
outputProduced      = rate × effectiveEfficiency × employeeScale × dtFraction
inputsConsumed      = [{ resourceId, quantity: outputProduced }] per input  (R-P8-3: 1:1 ratio)
revenue             = floor(outputProduced × outputMarketPrice)         (R-P8-4: floors to 0 for small amounts)
wages               = floor(employees × wageRate × dtFraction)          (R-P8-4: floors to 0)
inputCosts          = Σ floor(inputQuantity × inputMarketPrice)         (R-P8-4: floors to 0)
expenses            = wages + inputCosts
```

- **Employee productivity** (`PROVISIONAL_BUSINESS_EMPLOYEE_PRODUCTIVITY =
  1.0`): output scales with headcount — hiring raises output but also the
  wage bill (GDD §8.4 labor costs).
- **Vertical-integration bonus** (`PROVISIONAL_BUSINESS_SUPPLY_CHAIN_
  INTEGRATION_BONUS = 0.05`): when the business has at least one player-
  owned upstream supplier (`hasPlayerOwnedUpstream`), the effective
  efficiency gains +5% (capped at 1.0). Reflects reduced transaction costs
  and guaranteed input supply (GDD §8.2: "Vertical integration provides
  greater control over costs and supply").
- **1:1 input→output consumption** (R-P8-3): every required input is
  consumed at `quantity = outputProduced` (no per-input transformation
  efficiency modeling beyond the production rate). A future phase derives
  per-input consumption ratios from the business type.
- **Floored money amounts** (R-P8-4): per-tick wages/input costs/revenue
  are floored to bigint minor units; small per-tick amounts (e.g. a 60s
  tick of a low-rate business) floor to 0. Mirrors the automation
  maintenance cost flooring in `automation/execute.ts` — a fractional
  accumulator would smooth this but no schema field exists yet.

`runProduction` returns a `ProductionPlan` descriptor (no state mutation).
`operateBusiness` applies the plan: see §5 (inputs), §6 (accounting), §7
(market), §12 (environmental impact).

---

## 5. Supply chains (P8b/P8c — GDD §8.2)

**File:** `packages/simulation/src/business/supply-chain.ts`.

Pure helpers that resolve where a business's inputs come from and where its
outputs go, given the current `GameState`. The BusinessSystem + the
`operate-business` action handler use these to decide the money movements +
inventory adjustments.

### Input resolution (priority order — GDD §8.2 vertical integration)

For each required input `{ resourceId, quantity }`:

1. **Per-business inventory** (`business.inventory`, P8c field) stocks
   `>= quantity` → `kind: 'business-inventory'` (consume from the
   business's own stock; no market cost). Resolves P8b carry-forward #2.
2. **Player-owned upstream supplier** whose `outputResourceId` matches the
   input → `kind: 'upstream'` (vertical integration; no market cost — the
   input is available within the consolidated group).
3. **Shared `state.inventory`** stocks `>= quantity` → `kind: 'inventory'`
   (consume from the shared pool; no market cost — backward-compat for
   player-bought resources).
4. **Live commodity market** for the resource → `kind: 'market'` (buy at
   the market price; `marketCost += quantity × price`). Only for resources
   with a live `MarketState` (or a `PROVISIONAL_MARKET_PRICE_*` anchor + a
   registered market account). Intermediates (`resource:minerals`,
   `resource:chemicals`, `resource:timber`, `resource:lumber`,
   `resource:steel`) have NO market price — they are B2B only.
5. **Unsatisfied** → `kind: 'unsatisfied'`; the operate step is skipped
   with reason `'insufficient-inputs'` (graceful, no state change).

### Output resolution

1. **Player-owned downstream customer** whose `production.inputResourceIds`
   includes the business's `outputResourceId` → `destination: 'downstream'`
   (vertical integration). If the output has a live market, the downstream
   sale routes through the market account (the market absorbs the output at
   the clearing price; the downstream will buy from the market when it
   operates). If the output has no market (intermediate), the output
   stockpiles in the upstream's `business.inventory`.
2. **Commodity market** price anchor exists → `destination: 'market'`
   (sell to the market at the clearing price via
   `executeMarketTransaction`).
3. **Stockpile** → `destination: 'stockpile'` (the output is produced into
   `business.inventory` but generates no revenue this tick — an
   intermediate with no direct market and no downstream customer yet).

### The market price map

`buildMarketPriceMap(state)` merges the `PROVISIONAL_RESOURCE_PRICE`
anchors (water, fertilizer, seeds, equipment, food, energy) with the live
`state.economy.markets`. Live markets override the anchor (the live price
reflects supply/demand); entries from live markets carry `marketAccountId`
+ `marketId` so `executeMarketTransaction` can route the transfer. Entries
from provisional anchors (no live market) carry `marketAccountId:
undefined` — they can be valued but not bought/sold via a real account.

The upstream supplier's own inventory is NOT inspected (R-P8-2 family):
vertical integration is treated as a virtual provision (the downstream
assumes the upstream will supply). A future phase may model cross-business
inventory transfers explicitly.

---

## 6. Accounting (P8b/P8c — TDD §10, §11; GDD §8.1)

**File:** `packages/simulation/src/business/accounting.ts` + the money
movements in `production.ts`.

Every money movement is a `transfer()` call (pillar 1 — spending moves
money, it doesn't vanish; TDD §10.4 conservation). The business cash
account lives in `economy.accounts` with `id = business.id` (registered at
purchase by `purchase-business`); `business.cash` is a denormalized mirror
synced after each transfer (same coupling as `player.personalCash`).

### The four money movements in an operate step

| Movement | Direction | Category | Effect on counters |
|---|---|---|---|
| Revenue (P8c — resolves P8b carry-forward #1) | market account → business | `'business-market-sale'` | transfer (counters unchanged); market may receive a demand-injection issuance first (see §7) |
| Wages | business → authority (sink) | `'business-wages'` | `monetarySupply −= amount`, `totalSinks += amount` |
| Market input purchase | business → market account | `'business-market-buy'` | transfer (counters unchanged) |
| Inputs from inventory / upstream | (none) | — | already paid for when they entered inventory / were produced by the upstream |

Every transfer carries a deterministic `requestId` derived from
`(saveId, now, businessId, kind)` so a re-processed step (save/load) does
NOT double-apply (idempotency, TDD §10.3 — mirrors the P3a issuance
requestId pattern).

### Revenue recognition (P8c — R-P8-2)

P8b recognized revenue as `authority → business` (issuance) — the market
was an implicit buyer. P8c routes revenue THROUGH the market: the business
sells output to the market at the clearing price via
`executeMarketTransaction(buyer=marketAccount, seller=business)`. The
market is a REAL PARTICIPANT with a balance; when it lacks liquidity, the
authority injects just enough to cover the sale (external demand — see §7).
The `loan-repaid` event carries the actual market-sale total (NOT the
theoretical `plan.revenue`); for fractional sub-day output (e.g. 0.125
units/tick) the sale is a no-op (total = 0) and the output accumulates in
`business.inventory` until it reaches a whole unit.

Real downstream→upstream payment routing (the downstream business paying
the upstream business for the input it consumed) is deferred (R-P8-2): the
demand-injection liquidity backstop stands in for external market demand
so the market can always absorb output at game start.

### `applyRevenue` / `applyExpenses`

Pure helpers that bump `business.cash` + `business.revenue` /
`business.expenses` accumulators after a transfer landed. They return a
NEW `BusinessState`; the actual money movement (the ledger `transfer()`)
is the caller's job. They do NOT touch `valuation` (TDD §11).

### Conservation invariant

`sum(account.balance for account in economy.accounts) + totalSinks ===
initialSupply + totalIssued` holds by construction: revenue is a market →
business transfer (counters unchanged, modulo the demand-injection
issuance which increments `totalIssued`); wages + repayments + purchases
are sinks/transfers. Verified in `business.test.ts` (freeze + conservation)
+ `business-market.test.ts` (conservation across market transactions).

---

## 7. Market simulation (P8c — GDD §8.5; resolves P8b carry-forward #1)

**File:** `packages/simulation/src/business/market.ts`.

GDD §8.5 lists eight commodity markets: water, fertilizer, seeds,
equipment, food, energy, labor, land. P3b registered five (water,
fertilizer, seeds, food, energy) in the initial state; P8c's `clearMarkets`
adds the three P3b-deferred markets (equipment, labor, land) on first
encounter (R-P8-8 — they are referenced by id in content but have no live
`MarketState` pre-seeded; `clearMarkets` creates them lazily).

### `clearMarkets(state, now)`

Per-tick market clearing, run by the BusinessSystem at slot #8 BEFORE the
per-business production loop so businesses see current clearing prices:

1. **Ensure all 8 markets exist** — for each deferred market
   (equipment/labor/land) not already in `state.economy.markets`, append a
   fresh `MarketState` (price = `PROVISIONAL_MARKET_PRICE_*`, supply = 0,
   demand = 0) + register its `market:<id>` account (balance '0').
   Idempotent — repeated calls do not add duplicates.
2. **Advance each market's clearing price** toward the supply/demand
   equilibrium, bounded by `PROVISIONAL_BUSINESS_MARKET_PRICE_VOLATILITY`
   (0.10 = ±10% per tick) per tick (GDD §8.5: prices fluctuate but do not
   swing wildly). The drift: `imbalance = (demand − supply) /
   max(supply + demand, 1)` ∈ [−1, +1]; `fractionChange = clamp(imbalance ×
   volatility, ±volatility)`; `newPrice = anchor × (1 + fractionChange)`,
   floored at 1 minor unit.
3. **Anchor selection** (R-P8-8 family): the three deferred markets
   (equipment/labor/land — no content `MarketDefinition`) mean-revert
   toward their `PROVISIONAL_MARKET_PRICE_*` baseline each tick so the
   EconomySystem's `updateMarkets` (slot #6, which uses the CURRENT price
   as the base for markets lacking a `basePriceById` entry) cannot compound
   them exponentially over a long run. Without this anchor, an 80000-tick
   biology simulation grows the deferred prices until `Number(price)`
   overflows to Infinity and `BigInt(Infinity)` throws. The five P3b
   markets anchor on their current price (the EconomySystem mean-reverts
   them via `basePriceById`).
4. **Emit** one `market-price-changed` event per market whose price moved.

This complements the EconomySystem's `updateMarkets` (slot #6, log-ratio
supply/demand factor × monetary conditions factor, supply/demand refill +
decay). The BusinessSystem calls `clearMarkets` once per tick so the
8-market basket is live + prices fluctuate with the business-driven
supply/demand imbalance.

### `executeMarketTransaction(state, params)`

The canonical buyer→seller money movement at the clearing price:

1. Resolve the market by id (`UnknownBusinessMarketError` if unknown).
2. `total = floor(quantity × price)` (bigint). No-op for zero total
   (fractional quantity floored to 0).
3. **Demand-injection liquidity backstop** (R-P8-2): if the buyer is a
   market account AND its balance is insufficient AND
   `PROVISIONAL_BUSINESS_MARKET_DEMAND_INJECTION_ENABLED` is `true`, the
   authority injects just enough liquidity (issuance → market account) to
   cover the shortfall. This represents external market demand — buyers
   from outside the simulation — and makes the market a REAL PARTICIPANT
   (the transfer is market → seller, NOT authority → seller issuance). The
   injection is capped at `total`; the market account never goes negative.
4. Transfer `total` from buyer to seller via the economy `transfer()`
   (pillar 1).
5. Adjust the market's supply/demand: market buying → `supply +=
   quantity`; market selling → `supply −= quantity` (floored at 0),
   `demand += quantity`; business↔business via market price → no change.

Conservation holds: the injection is an issuance (increments
`totalIssued`), the buyer→seller transfer preserves money. The flag
defaults to `true` so the market can always absorb output at game start
(when market accounts hold '0'); tests can disable it to assert the
market-pays-business transfer alone.

---

## 8. Growth pressure (P8c — GDD §8.4)

**File:** `packages/simulation/src/business/growth-pressure.ts`.

GDD §8.4 lists eight growth-pressure sources: inflation, debt and interest,
shareholder expectations, competition, corporate valuation, market demand,
labor costs, investment requirements. P8c implements four pure helpers,
each driving one axis. The BusinessSystem applies them AFTER the
per-business production loop so they reflect this tick's activity (debt
interest accrual runs per-business BEFORE production so the bankruptcy
check sees the grown `accruedInterest`).

### `applyInflationPressure(businesses, inflationIndex, dtSeconds, now)`

Operating costs (the `wageRate`) rise with the economy's `inflationIndex`
(GDD §8.4 inflation + labor costs). For each operating business:

```
increase = floor(wageRate × (inflationIndex − 1)
                 × PROVISIONAL_BUSINESS_INFLATION_WAGE_PASS_THROUGH × dtFraction)
newWageRate = wageRate + increase
```

The `inflationIndex` is READ-ONLY by business (TDD §10.6 — the
EconomySystem derives it from the basket of market prices; business NEVER
mutates it). When `inflationIndex <= 1.0`, no change. Emits one `system`
event per business whose wageRate changed (audit trail). Only `status ===
'operating'` businesses are affected.

### `accrueDebtInterest(businesses, dtSeconds)`

Liabilities accrue interest each tick into the `accruedInterest` field
(NOT compounded into `principal` — the P8c resolution of P8b carry-forward
#3). Delegates to `accrueInterest` (`accounting.ts`) per business:

```
accrualFraction = interestRate × dtSeconds / SECONDS_PER_YEAR
accruedThisTick = floor(principal × accrualFraction)
newAccruedInterest = accruedInterest + accruedThisTick
```

Simple-interest accrual into a separate field. No events (interest accrual
is a silent balance-sheet update; the `loan-repaid` event carries the split
when repayment happens). Liabilities with `interestRate === 0` are
unchanged; a liability whose per-tick accrual floors to 0 accrues nothing
this tick.

### `applyShareholderExpectations(businesses, dtSeconds, now)`

For corporations (`ownership.structure === 'corporation'`), if the per-tick
revenue growth proxy falls below
`PROVISIONAL_BUSINESS_SHAREHOLDER_EXPECTED_GROWTH_RATE`, emit a
`shareholder-pressure` notification + reduce the valuation by the shortfall
scaled by the penalty factor (TDD §11 — valuation reflects expected future
performance; GDD §8.4 shareholder expectations):

```
growthProxy = revenue / max(revenue + expenses, 1)         (profitability proxy)
shortfall   = max(0, PROVISIONAL_BUSINESS_SHAREHOLDER_EXPECTED_GROWTH_RATE − growthProxy)
penalty     = floor(valuation × shortfall × PROVISIONAL_BUSINESS_SHAREHOLDER_VALUATION_PENALTY
                         × PROVISIONAL_BUSINESS_OPERATING_MARGIN)
newValuation = max(0, valuation − penalty)
```

Emits one `notification` (severity `'warning'`, code
`'shareholder-pressure'`) per underperforming corporation. Non-corporation
ownership structures (sole-proprietorship, cooperative,
sustainable-enterprise, non-profit, state-owned) are unaffected — only
corporations face shareholder pressure.

### `applyCompetitionPressure(businesses, dtSeconds, now)`

When multiple operating businesses sell to the same market (same
`production.outputResourceId`), market share erodes for less-efficient
ones. For each business whose efficiency is below the average efficiency of
businesses sharing its output resource, the `production.rate` is reduced:

```
gap      = avgEfficiency − businessEfficiency
erosion  = floor(rate × PROVISIONAL_BUSINESS_COMPETITION_EROSION_RATE × gap)
newRate  = max(0, rate − erosion)
```

A small drift; floored at 0 (a business never goes negative rate). Emits
one `system` event per business whose rate eroded (audit trail). No
competition if only one business shares the output resource.

All four helpers are pure: they return new arrays + events; the input is
NEVER mutated.

---

## 9. Debt & loans (P8b/P8c — GDD §8.4)

### `take-loan` (P8b)

1. Content gate: `supportedActions` must include `'take-loan'`.
2. Append a `Liability` `{ id, type: 'loan', principal, interestRate,
   dueAt, accruedInterest: '0' }` to `business.liabilities`.
3. Credit the principal to the business's cash via an authority issuance
   (`authority → business`, category `'business-loan'`). The loan is new
   money — the conservation invariant holds because the Liability offsets
   it on the balance sheet (`assets − liabilities` is unchanged by the
   issuance).
4. Idempotent via `requestId = business-loan:<saveId>:<ts>:<bizId>:<liabId>`.
5. Emit `loan-taken`.

### `repay-loan` (P8c — resolves P8b carry-forward #3)

The P8c interest/principal split — the payment FIRST covers the accrued
interest (since the last payment), then reduces the principal:

```
interestPaid = min(amount, accruedInterest)
remainder    = amount − interestPaid
principalPaid = min(remainder, principal)
totalRepaid   = interestPaid + principalPaid
remainingAccruedInterest = accruedInterest − interestPaid
remainingPrincipal       = principal − principalPaid
```

1. Find the business + the liability (`UnknownLiabilityError` if the id is
   not on the business). Content gate: `'repay-loan'`.
2. Compute the split above.
3. Debit the business (business → authority sink) for `totalRepaid`. The
   loan principal was issued money; repaying destroys it. The accrued
   interest was never issued (it accrued in-place), so paying it also
   destroys money (sink) — the interest is recognized as revenue for the
   lender (the authority, in P8c's sole-proprietorship model).
4. Reduce the liability's `accruedInterest` and `principal`; remove the
   liability if BOTH are zero (a fully-repaid loan with no pending
   interest).
5. Emit `loan-repaid` with the `interestPaid` / `principalPaid` /
   `totalRepaid` / `remainingPrincipal` split.

The `loan-repaid` event carries the split so consumers can audit the
interest vs. principal portions without reaching into state.

---

## 10. Bankruptcy (P8b — TDD §5.7 / GDD §8.4)

**File:** `packages/simulation/src/business/accounting.ts` (`checkBankruptcy`).

```
bankrupt iff business.cash < PROVISIONAL_BUSINESS_BANKRUPTCY_THRESHOLD   (−1000 minor = −$10 overdraft tolerance)
```

The threshold is NEGATIVE so a business can run a small overdraft (accrued
wages not yet paid) before flipping to bankrupt — mirrors real-world
short-term solvency vs. insolvency. The BusinessSystem checks
`checkBankruptcy` after each operate step; on a fresh transition (pre-
status !== `'bankrupt'`) it flips `status` to `'bankrupt'` and emits
`business-bankrupt`. A bankrupt business stops producing (the operate
gate returns `operated: false` with reason `'bankrupt'`); the player can
either inject capital (a future `transfer` to the business account) or
liquidate via `sell-business`. A `liquidating` business is never flipped
to bankrupt here (the sale flow owns that status).

GDD §16.3: financial ruin does not end the simulation (analogous to tree
death) — a bankrupt business is a recoverable state, not a game-over.

---

## 11. Valuation (P8b — TDD §11; GDD §8.1, §8.4)

**File:** `packages/simulation/src/business/valuation.ts`.

Per TDD §11, valuation considers assets, liabilities, profitability, cash
flow, expected future performance, and market conditions. P8b's provisional
model folds these into:

```
valuation = max(0, assetsTotal + profitabilityTerm − liabilitiesTotal)

assetsTotal       = Σ business.assets[].value
profitabilityTerm = floor((revenue − expenses) × PROVISIONAL_BUSINESS_OPERATING_MARGIN)
liabilitiesTotal  = Σ business.liabilities[].principal
```

- A profitable business is worth more than its net assets; an unprofitable
  one is worth less (the profitability term is signed by cumulative
  profit).
- Valuation is floored at 0 (a business cannot be worth negative money —
  its owners would simply walk away / liquidate; the bankruptcy path
  handles insolvency).
- Cash is NOT added to valuation directly — cash is already spendable
  (TDD §11: valuation ≠ liquidity). Cash IS part of the consolidated net
  worth but it is tracked separately on `business.cash` (and the economy
  account) so the two never blur.

### Cadence

Valuation is recomputed on a SLOWER cadence than per-tick cash moves (TDD
§11 — recomputing it every tick would make it flicker with every wage
payment). The BusinessSystem recomputes when
`(now − lastValuationTick) >= BUSINESS_VALUATION_INTERVAL_SECONDS` (one
sim day, 86_400 s — R-P8-5: a LOCAL `@provisional` const in `valuation.ts`,
NOT promoted to a shared `PROVISIONAL_` constant). `recomputeValuation` is
a pure helper; the cadence decision is the system's. `lastValuationTick`
records when the last recompute ran.

The `marketConditions` parameter on `recomputeValuation` is a future hook
(TDD §11 lists "market conditions" as a valuation input) — P8b passes 0;
reserved for a future phase that adds a market-scarcity multiplier.

---

## 12. Environmental impact routing (P8a/P8b — TDD §13; GDD §9.1, §8.3)

Each business's `environmentalImpact` (the 6-channel P6
`environmentalImpactSchema`: carbonEmissions, waterConsumption,
soilDegradation, pollution, landDisturbance, biodiversityImpact) is copied
from the `BusinessTypeDefinition.baseEnvironmentalImpact` at purchase. The
`operate-business` orchestration applies it each operate step via the
centralized `applyEnvironmentalImpact` helper (pro-rated by the step
fraction — the SAME helper the AutomationSystem uses, see
`docs/environment.md` §8), so the EnvironmentSystem at slot #10 consumes
the mutated env state. The `business-operated` event carries the impact in
its payload so consumers can audit the operate step without reaching into
state.

This mirrors the AutomationSystem's impact routing pattern: the
BusinessSystem (slot #8) applies each business's impact on operate (BEFORE
the EnvironmentSystem at slot #10); the EnvironmentSystem does NOT re-apply
(would double-count). The 9 content definitions carry pillar-4 impact
profiles — extraction (mineral-mine: high land disturbance + biodiversity)
and processing (chemical-plant: high pollution + carbon) have the heaviest
footprints; retail (general-store) is lightest.

---

## 13. The eight action handlers (P8b/P8c — TDD §5.7 / §11)

**File:** `packages/simulation/src/business/actions.ts` (registered in
`packages/simulation/src/actions/handlers.ts`).

| Handler | Action | Effect |
|---|---|---|
| `purchaseBusinessHandler` | `purchase-business` | Resolve type via `getBusinessTypeById` (content gate). Debit `baseCost` from `player:personal` → authority (sink). Register a `business`-type cash account (id = new business id, balance '0'). Derive a `BusinessState` via `createBusinessFromDefinition` (copies supplyChainLevel/production/wageRate/env impact/marketParticipation/employees/valuation from the def). Append to `state.businesses`. Emit `business-purchased` + `transaction-recorded`. Idempotent on `requestId`. |
| `operateBusinessHandler` | `operate-business` | Delegates to the shared `operateBusiness` orchestration (one production cycle at `payload.tick`, `dtSeconds = PROVISIONAL_SIMULATION_STEP_SECONDS`). Content-gated. Emits `business-operated`. |
| `sellBusinessHandler` | `sell-business` | Flip to `liquidating`. Issue `floor(valuation × (1 − HAIRCUT))` proceeds to the business account (authority → business issuance). Settle outstanding liabilities from the business's pool (capped at available — limited liability: only the business's assets settle its debts). Credit the residue to `player:personal`. Remove the business + its cash account. Emit `business-sold` with the proceeds/haircut/settled total. |
| `takeLoanHandler` | `take-loan` | Append a `Liability`; credit principal via authority issuance. Idempotent on `requestId`. Emit `loan-taken` + `transaction-recorded`. |
| `repayLoanHandler` | `repay-loan` (P8c) | Interest/principal split (§9): pay `accruedInterest` FIRST, then reduce `principal`. Debit business → authority sink for the total. Remove the liability if both are zero. Emit `loan-repaid` with the split + `transaction-recorded`. |
| `hireEmployeesHandler` | `hire-employees` | Increment `employees` by `count`. No solvency pre-check (the BusinessSystem flips to bankrupt if wages push cash below threshold — GDD §16.3 graceful failure). Emit `employees-hired`. |
| `layOffEmployeesHandler` | `lay-off-employees` | Decrement `employees` by `count`, clamped at 0. No severance (`@provisional` — GDD §17 labor model). Emit `employees-laid-off`. |
| `setBusinessStatusHandler` | `set-business-status` | Flip between `operating` and `idle`. Rejects `bankrupt`/`liquidating` (`InvalidBusinessStatusError` — system-internal transitions). Idempotent (no event if already in the requested status). Emit a `system` event. |

All handlers are pure: they return a new state + events without mutating
the input. Deterministic given `(state, action)`. The `originalTree` is
NEVER touched by any business action (GDD §16.1/§16.2 — the schema-layer
superRefine + the `sell-tree` action guard already enforce this).

---

## 14. BusinessSystem per-tick contract (TDD §4.2, §5.7, §11)

`BusinessSystem` (`packages/simulation/src/systems/business.ts`) replaces
the P0 stub at **registry slot #8**. It runs once per simulation step
AFTER EconomySystem (slot #6) and PersonalSystem (slot #7), and BEFORE
AutomationSystem (slot #9) and EnvironmentSystem (slot #10), so it sees
the up-to-date economy + player state and its environmental impacts are
visible to the EnvironmentSystem.

```text
execute(state, ctx):
  1. clearMarkets(state, ctx.now) — ensure all 8 GDD §8.5 markets live +
     advance each market's clearing price toward the supply/demand
     equilibrium (bounded by PROVISIONAL_BUSINESS_MARKET_PRICE_VOLATILITY).
     Emits one `market-price-changed` per market whose price moved.
  2. (RNG fork DEFERRED — R-P8-1, see §15. The transforms are deterministic;
     no ctx.rng.fork call. A determinism test pins zero root draws.)
  3. Fast path — if no businesses, return (clearMarkets above still ran so
     the market basket stays live + the no-fork contract is pinned).
  4. For each business (in array order, over a snapshot):
     a. accrueDebtInterest — liabilities accrue into `accruedInterest`
        (P8c carry-forward #3). Applied BEFORE production so this tick's
        bankruptcy check sees the grown accruedInterest.
     b. Resolve the business type (content gate — an unregistered type
        skips production with a system event, degrading gracefully).
     c. operateBusiness — the shared orchestration (resolve inputs → run
        production → resolve outputs → move money via
        executeMarketTransaction → apply environmental impact → emit
        business-operated). Skipped businesses emit operated: false +
        a reason (idle/bankrupt/liquidating/insufficient-inputs/
        insufficient-funds/no-employees).
     d. checkBankruptcy — flip to `bankrupt` + emit business-bankrupt on
        the fresh transition (cash < PROVISIONAL_BUSINESS_BANKRUPTCY_
        THRESHOLD).
     e. recomputeValuation — when (now − lastValuationTick) >=
        BUSINESS_VALUATION_INTERVAL_SECONDS (one sim day).
  5. applyInflationPressure — wageRate grows with economy inflationIndex.
  6. applyShareholderExpectations — corporations underperforming →
     notification + valuation reduction.
  7. applyCompetitionPressure — less-efficient businesses lose production
     rate when multiple share an output market.
```

The system is pure: it deep-copies the input state, mutates the copy, and
returns the new state. The input is NEVER mutated (TDD §4.1, §18.4).
Rendering reads only — the rendering layer MUST NOT execute business
operations independently (TDD §12, GDD §6.1). This system is the single
engine-side driver; the UI dispatches business actions to configure
businesses, but never runs them.

---

## 15. Determinism contract (TDD §18.3)

Given the same initial state, seed, player actions, and duration, the
BusinessSystem produces the same final state + events. The module upholds
this by construction:

- All transforms are pure arithmetic on the current business + economy
  state (no randomness — the RNG fork is deferred, R-P8-1).
- Every money movement carries a deterministic `requestId` derived from
  `(saveId, simSecond, businessId, kind)` so a replayed step does not
  double-apply (idempotency, TDD §10.3).
- `clearMarkets`' price drift is deterministic given `(state, now)` — the
  drift is `imbalance × volatility`, clamped; no randomness.
- Valuation / interest / growth-pressure helpers are pure arithmetic.

Save/load preserves all business fields via the v9→v10 + v10→v11
migrations + Zod defaults. Verified in `business.test.ts` (determinism:
same `(state, ctx)` → same `(new state, events)`; purity: input not
mutated) + `business-market.test.ts` + `business-inventory.test.ts` +
`business-growth-pressure.test.ts`.

### The RNG fork deferral (R-P8-1 — carry-forward, see §16)

The BusinessSystem does NOT call `ctx.rng.fork('BusinessSystem')`.
`Rng.fork()` advances the shared root RNG by exactly one draw **by design**
(`packages/simulation/src/rng.ts`: `fork()` calls `this.next()` to seed the
child — "the parent advances by exactly one draw to seed the fork"). The
BusinessSystem runs at slot #8, BEFORE AutomationSystem (slot #9) and
EnvironmentSystem (slot #10), both of which fork per-step — adding a fork
here would advance the root at slot #8, shifting the child seeds those
downstream systems derive on the NEXT tick → the AutomationSystem's
failure rolls + the EnvironmentSystem's stochastic events would change →
the calibrated mortality / catch-up death sequences pinned by the P7d
determinism tests would flip (verified empirically for the analogous
slot #10 case in P7d — adding the fork broke the seed=3 catch-up death
test; reverting restored it). A determinism test in `business.test.ts`
pins the no-fork contract: the root RNG state is unchanged across a
`BusinessSystem.execute` when no businesses are present, and the
AutomationSystem/EnvironmentSystem RNG sequences are unaffected.

**Status: deferred.** The fork lands when (a) stochastic business events
arrive (equipment breakdown rolls, market shocks, bankruptcy noise) AND
(b) the downstream RNG sequences are retuned, OR `fork()` is refactored to
support a non-advancing sub-stream derivation (a deeper change that
retunes every system's sequence — out of P8d scope).

---

## 16. Carry-forward / known gaps (R-P8 items)

P8 surfaced eight carry-forward items. The frozen-schema constraint (P8a
froze `packages/shared`) shapes several of them; each is flagged in the
source with a `// R-P8-N:` comment at the relevant file:line (doc comments
only — no logic changes).

### R-P8-1: RNG fork deferred (carry-forward)

The BusinessSystem does NOT call `ctx.rng.fork('BusinessSystem')`.
Same root cause as R-P7-1 (the EnvironmentSystem no-fork decision):
`fork()` advances the root RNG by one draw by design
(`packages/simulation/src/rng.ts`); adding a fork at slot #8 would shift
the AutomationSystem (slot #9) + EnvironmentSystem (slot #10) child seeds
and break the calibrated mortality / catch-up death sequences pinned by
the P7d determinism tests. A determinism test in `business.test.ts` pins
the no-fork contract (zero root draws when no businesses are present;
AutomationSystem/EnvironmentSystem sequences unaffected). **Status:
deferred** — lands when stochastic business events arrive AND the
downstream sequences are retuned, OR `fork()` is refactored to a
non-advancing sub-stream derivation.

### R-P8-2: Revenue recognition uses the demand-injection liquidity backstop

P8c routes revenue through the market (`executeMarketTransaction(buyer=
marketAccount, seller=business)`), resolving P8b carry-forward #1 (P8b
recognized revenue as `authority → business` issuance). When the market
account lacks balance, the authority injects just enough liquidity
(`PROVISIONAL_BUSINESS_MARKET_DEMAND_INJECTION_ENABLED`) so the sale
always succeeds — representing external market demand (buyers from outside
the simulation). The market account can go negative backed by the
authority. **Real downstream→upstream payment routing is deferred**: the
downstream business does NOT pay the upstream business for the input it
consumed via vertical integration; the demand-injection backstop stands in
for external demand so the market can always absorb output at game start.
A future phase models cross-business payment routing explicitly (would
need a consolidated-group transfer + an inter-business payable/receivable
ledger).

### R-P8-3: 1:1 input→output consumption ratio

`runProduction` consumes each input at `quantity = outputProduced` (the
same quantity for every input, regardless of the input's stoichiometric
role). There is no per-input transformation efficiency modeling beyond the
production rate (a chemical-plant producing 40 units of chemicals consumes
40 units of minerals; a fertilizer-factory producing 25 units of
fertilizer consumes 25 units of chemicals). A future phase derives
per-input consumption ratios from the `BusinessTypeDefinition` (e.g. a
`consumptionRatios: Map<resourceId, fraction>` field). Flagged in
`production.ts` at the `inputsConsumed` line.

### R-P8-4: Per-tick wages/input costs floor to 0 for small amounts

Per-tick wages, input costs, and revenue are floored to bigint minor
units: `floor(employees × wageRate × dtFraction)`,
`floor(inputQuantity × inputMarketPrice)`,
`floor(outputProduced × outputMarketPrice)`. Small per-tick amounts (e.g.
a 60s tick of a low-rate business with few employees) floor to 0 — the
expense/revenue accrues only when it crosses a whole minor unit. Mirrors
the automation maintenance cost flooring in `automation/execute.ts` (§6.5
of `docs/offline-automation.md`). A fractional accumulator would smooth
this but no schema field exists yet. Flagged in `production.ts` at the
wages / inputCosts / revenue lines.

### R-P8-5: `BUSINESS_VALUATION_INTERVAL_SECONDS` is a local const

The valuation recompute cadence (86_400 sim seconds = one sim day) lives
as a LOCAL `@provisional` const in `packages/simulation/src/business/
valuation.ts`, NOT promoted to a shared `PROVISIONAL_BUSINESS_*` constant
in `packages/shared/src/constants/business.ts`. P8a froze `packages/shared`
before the cadence was tuned; promoting it would need a constants-file
addition (backward-compatible, no migration). Flagged in `valuation.ts`
at the `BUSINESS_VALUATION_INTERVAL_SECONDS` declaration with a
`@provisional — tunable; promote to a shared PROVISIONAL_ constant once
playtesting calibrates it` comment.

### R-P8-6: Mineral-mine has `marketParticipation: []` (B2B vertical integration)

The `business:mineral-mine` definition sells B2B via vertical integration
(to a downstream `business:chemical-plant`) rather than into a commodity
market — minerals are NOT in the GDD §8.5 initial market list (water,
fertilizer, seeds, equipment, food, energy, labor, land). Its
`marketParticipation: []` means `resolveOutputs` returns
`destination: 'stockpile'` unless a player-owned downstream customer
exists; the output accumulates in `business.inventory` until the
downstream consumes it. Flagged in `extraction.ts` at the MINERAL_MINE
`marketParticipation` line. A future phase may add a `market:minerals`
intermediates market.

### R-P8-7: Retail markup via `PROVISIONAL_BUSINESS_OPERATING_MARGIN`

The `business:general-store` (retail tier) takes its markup through the
valuation profitability term (`PROVISIONAL_BUSINESS_OPERATING_MARGIN`,
§11), NOT through `production.efficiency > 1`. The `productionStateSchema`
caps efficiency at [0,1] (a P0 constraint P8a must not break); the retail
markup is a BusinessSystem pricing concern, not a production-efficiency
value. The general-store's `efficiency: 0.98` models the fraction of
stocked inventory that sells without spoilage/shrinkage, not the retail
margin. Flagged in `retail.ts` at the GENERAL_STORE description + the
`PROVISIONAL_BUSINESS_OPERATING_MARGIN` reference.

### R-P8-8: 3 GDD §8.5 markets referenced by id but no live MarketState pre-seeded

The equipment, labor, and land markets (GDD §8.5) are referenced by id in
content (`business:equipment-factory.marketParticipation` includes
`'market:equipment'`) but have no live `MarketState` entries in the initial
state — P3b deferred them. They are created on first encounter via
`clearMarkets` (`ensureDeferredMarkets` in `market.ts`) with their
`PROVISIONAL_MARKET_PRICE_*` baselines + a registered `market:<id>`
account. Until a business transacts in them (or `clearMarkets` runs), they
do not exist in `state.economy.markets`. Flagged in `market.ts` at the
`DEFERRED_MARKETS` declaration. A future phase may pre-seed them in
`initial-state.ts` so the EconomySystem's `updateMarkets` mean-reverts
them from tick 0.

---

## 17. @provisional constants (GDD §17 pointers)

All business tuning constants live in
`packages/shared/src/constants/business.ts` (the shared
`PROVISIONAL_BUSINESS_*` / `PROVISIONAL_MARKET_PRICE_*`) plus one local
`@provisional` constant in `packages/simulation/src/business/valuation.ts`.
Each shared constant is marked with a `// PROVISIONAL (GDD §17: <item>)`
comment.

### Shared constants (`packages/shared/src/constants/business.ts`)

| Constant                                              | Value        | Resolves (GDD §17) |
|-------------------------------------------------------|--------------|--------------------|
| `PROVISIONAL_BUSINESS_VALUATION_HAIRCUT`              | 0.15         | corporate valuation / business valuation model |
| `PROVISIONAL_BUSINESS_BANKRUPTCY_THRESHOLD`           | `'-1000'`    | corporate valuation / bankruptcy mechanics |
| `PROVISIONAL_BUSINESS_OPERATING_MARGIN`               | 0.10         | corporate valuation / operating margin |
| `PROVISIONAL_BUSINESS_LOAN_DEFAULT_RATE`              | 0.05         | debt and interest model |
| `PROVISIONAL_BUSINESS_WAGE_DEFAULT`                   | `'500'`      | labor model / wage mechanics |
| `PROVISIONAL_BUSINESS_EMPLOYEE_PRODUCTIVITY`          | 1.0          | labor model / productivity |
| `PROVISIONAL_BUSINESS_SUPPLY_CHAIN_INTEGRATION_BONUS` | 0.05         | supply chain integration / vertical integration bonus |
| `PROVISIONAL_BUSINESS_MARKET_PRICE_VOLATILITY`        | 0.10         | market simulation / price volatility |
| `PROVISIONAL_MARKET_PRICE_WATER`                      | `'10'`       | market simulation / initial market prices |
| `PROVISIONAL_MARKET_PRICE_FERTILIZER`                 | `'500'`      | market simulation / initial market prices |
| `PROVISIONAL_MARKET_PRICE_SEEDS`                      | `'200'`      | market simulation / initial market prices |
| `PROVISIONAL_MARKET_PRICE_EQUIPMENT`                  | `'20000'`    | market simulation / initial market prices |
| `PROVISIONAL_MARKET_PRICE_FOOD`                       | `'300'`      | market simulation / initial market prices |
| `PROVISIONAL_MARKET_PRICE_ENERGY`                     | `'50'`       | market simulation / initial market prices |
| `PROVISIONAL_MARKET_PRICE_LABOR`                      | `'500'`      | market simulation / initial market prices |
| `PROVISIONAL_MARKET_PRICE_LAND`                       | `'100000'`   | market simulation / initial market prices |
| `PROVISIONAL_BUSINESS_MARKET_DEMAND_INJECTION_ENABLED`| `true`       | market simulation / external demand liquidity |
| `PROVISIONAL_BUSINESS_SHAREHOLDER_EXPECTED_GROWTH_RATE` | 0.001      | shareholder expectations / corporate governance |
| `PROVISIONAL_BUSINESS_SHAREHOLDER_VALUATION_PENALTY`  | 0.5          | shareholder expectations / valuation haircut |
| `PROVISIONAL_BUSINESS_COMPETITION_EROSION_RATE`       | 0.10         | competition / market share erosion |
| `PROVISIONAL_BUSINESS_INFLATION_WAGE_PASS_THROUGH`    | 1.0          | inflation / operating cost scaling |

### Local @provisional constants (helper modules)

| Constant | Value | Location | Resolves |
|---|---|---|---|
| `BUSINESS_VALUATION_INTERVAL_SECONDS` (R-P8-5) | 86_400 (1 sim day) | `valuation.ts` | corporate valuation / business valuation model |

When a value is promoted from "provisional" to "decided" via playtesting,
move it to a sibling `decided.ts` and drop the `PROVISIONAL_` prefix
(matching the convention in `packages/shared/src/constants/`).

---

## 18. Public interfaces (signatures)

### 18.1 BusinessSystem

```typescript
// packages/simulation/src/systems/business.ts
export const businessSystem: System;  // registry slot #8
```

### 18.2 Business pure helpers

```typescript
// packages/simulation/src/business/accounting.ts
export function parseBusinessAmount(amount: string, field?: string): bigint;
export function addAmount(a: string, b: string): string;
export function subAmount(a: string, b: string): string;
export function sumLiabilities(business: BusinessState): bigint;
export function sumAssets(business: BusinessState): bigint;
export function applyRevenue(business: BusinessState, amount: bigint): BusinessState;
export function applyExpenses(business: BusinessState, amount: bigint): BusinessState;
export function accrueInterest(liabilities: readonly Liability[], dtSeconds: number): Liability[];
export function checkBankruptcy(business: BusinessState): { bankrupt: boolean; business: BusinessState };

// packages/simulation/src/business/valuation.ts
export const BUSINESS_VALUATION_INTERVAL_SECONDS: number;  // R-P8-5 — local @provisional
export function recomputeValuation(business: BusinessState, now: number, marketConditions?: number): BusinessState;
export function shouldRecomputeValuation(business: BusinessState, now: number): boolean;

// packages/simulation/src/business/supply-chain.ts
export function buildMarketPriceMap(state: GameState): Map<string, MarketPriceEntry>;
export function getMarketPrice(marketPrices: ReadonlyMap<string, MarketPriceEntry>, resourceId: string): bigint | undefined;
export function isPlayerOwnedBusiness(state: GameState, businessId: string): boolean;
export function hasUpstreamSupplierFor(state: GameState, business: BusinessState, inputResourceId: string): boolean;
export function hasDownstreamCustomerFor(state: GameState, business: BusinessState, outputResourceId: string): boolean;
export function hasPlayerOwnedUpstream(state: GameState, business: BusinessState): boolean;
export function resolveInputs(state: GameState, business: BusinessState, requiredInputs: readonly { resourceId: string; quantity: number }[], marketPrices: ReadonlyMap<string, MarketPriceEntry>): ResolveInputsResult;
export function resolveOutputs(state: GameState, business: BusinessState, marketPrices: ReadonlyMap<string, MarketPriceEntry>): ResolveOutputsResult;

// packages/simulation/src/business/production.ts
export function runProduction(business: BusinessState, businessType: BusinessTypeDefinition, dtSeconds: number, marketPrices?: ReadonlyMap<string, string>, opts?: RunProductionOptions): ProductionPlan;
export function operateBusiness(state: GameState, business: BusinessState, businessType: BusinessTypeDefinition, ctx: OperateBusinessContext): OperateBusinessResult;

// packages/simulation/src/business/market.ts (P8c)
export function clearMarkets(state: GameState, now: number): ClearMarketsResult;
export function executeMarketTransaction(state: GameState, params: ExecuteMarketTransactionParams): ExecuteMarketTransactionResult;
export class UnknownBusinessMarketError extends Error;

// packages/simulation/src/business/growth-pressure.ts (P8c)
export function applyInflationPressure(businesses: readonly BusinessState[], inflationIndex: number, dtSeconds: number, now: number): ApplyGrowthPressureResult;
export function accrueDebtInterest(businesses: readonly BusinessState[], dtSeconds: number): BusinessState[];
export function applyShareholderExpectations(businesses: readonly BusinessState[], dtSeconds: number, now: number): ApplyGrowthPressureResult;
export function applyCompetitionPressure(businesses: readonly BusinessState[], dtSeconds: number, now: number): ApplyGrowthPressureResult;

// packages/simulation/src/business/actions.ts
export function createBusinessFromDefinition(definition: BusinessTypeDefinition, businessId: string, name: string): BusinessState;
export const purchaseBusinessHandler: ActionListener<PurchaseBusinessAction>;
export const operateBusinessHandler: ActionListener<OperateBusinessAction>;
export const sellBusinessHandler: ActionListener<SellBusinessAction>;
export const takeLoanHandler: ActionListener<TakeLoanAction>;
export const repayLoanHandler: ActionListener<RepayLoanAction>;
export const hireEmployeesHandler: ActionListener<HireEmployeesAction>;
export const layOffEmployeesHandler: ActionListener<LayOffEmployeesAction>;
export const setBusinessStatusHandler: ActionListener<SetBusinessStatusAction>;

// packages/simulation/src/business/errors.ts
export class UnknownBusinessTypeError extends Error;
export class UnknownBusinessError extends Error;
export class UnsupportedBusinessActionError extends Error;
export class UnknownLiabilityError extends Error;
export class InvalidBusinessStatusError extends Error;

// packages/content/src/businesses/index.ts
export const BUSINESS_TYPES: readonly BusinessTypeDefinition[];
export function getBusinessTypeById(businessTypeId: string): BusinessTypeDefinition | undefined;
```

---

## 19. Test inventory (post-P8d)

109 business tests across 4 files.

| File                                                            | Phase | Scope                                  |
|-----------------------------------------------------------------|-------|----------------------------------------|
| `packages/simulation/test/business.test.ts`                     | P8b/P8c | 62 tests: production (`runProduction` — rate × efficiency × dt, vertical-integration bonus, 1:1 input consumption, floored money amounts); accounting (`applyRevenue`/`applyExpenses`, `accrueInterest`, `checkBankruptcy`); valuation (`recomputeValuation` assets + profitability − liabilities, floored at 0, cadence); supply-chain (`resolveInputs`/`resolveOutputs` — upstream/inventory/market/unsatisfied, downstream/market/stockpile, vertical-integration bonus gating); the 8 action handlers (purchase deducts + creates, operate delegates, sell haircut + settle + residue, take-loan issuance + liability, repay-loan interest/principal split, hire/layoff, set-status idempotent + rejects bankrupt/liquidating); environmental impact (business-operated carries it, env accumulators move, feeds EnvironmentSystem at slot #10); conservation (every revenue/expense/loan/sale is a transaction); originalTree never touched; determinism (same `(state, ctx)` → same `(new state, events)`, RNG zero root draws when no businesses); purity (input not mutated). |
| `packages/simulation/test/business-market.test.ts`              | P8c   | 12 tests: `clearMarkets` — price drifts toward supply/demand equilibrium (high demand → rises; high supply → falls), bounded by `PROVISIONAL_BUSINESS_MARKET_PRICE_VOLATILITY`; ensures all 8 GDD §8.5 markets are live (adds equipment/labor/land on first encounter); `executeMarketTransaction` — buyer→seller transfer recorded as transactions, conservation holds, demand-injection backstop (market account buyer with insufficient balance → authority injects just enough); `operateBusiness` revenue comes from a market→business sale (NOT authority→business issuance — sourceAccount is the market account); input costs are business→market transfers. |
| `packages/simulation/test/business-inventory.test.ts`           | P8c   | 14 tests: `business.inventory` holds inputs/outputs (the P8c field); production consumes inputs from `business.inventory` (the per-business stock, NOT the shared `state.inventory`); outputs sold to the market drain `business.inventory`; stockpiled outputs (no market) remain; buying inputs from the market credits `business.inventory` (replenish) before consumption debits it; insufficient inventory (with no market/upstream fallback) → operate skips with `insufficient-inputs` (zero output). |
| `packages/simulation/test/business-growth-pressure.test.ts`     | P8c   | 21 tests: `applyInflationPressure` — wageRate rises with `inflationIndex` (read-only by business), no change when index ≤ 1.0, only operating businesses affected; `accrueDebtInterest` — interest accrues into `accruedInterest` (NOT principal) over multiple ticks, `interestRate === 0` unchanged, per-tick floor; `applyShareholderExpectations` — corporations underperforming → `shareholder-pressure` notification + valuation reduced, non-corporation structures unaffected; `applyCompetitionPressure` — less-efficient businesses lose production rate when multiple share an output market, no erosion with a single business, floored at 0. |

The determinism tests in `business.test.ts` pin the R-P8-1 carry-forward:
the BusinessSystem consumes zero root RNG draws (no fork), and the
AutomationSystem/EnvironmentSystem RNG sequences are unaffected by the
BusinessSystem running.

---

## 20. File map

```
packages/
├── shared/src/
│   ├── constants/
│   │   └── business.ts                # NEW (P8a/P8c) — PROVISIONAL_BUSINESS_* + PROVISIONAL_MARKET_PRICE_*
│   ├── schemas/
│   │   ├── business.ts                # P0 base + P8a/P8c — BusinessState, OwnershipState, Liability, ProductionState,
│   │   │                              #   BusinessTypeDefinition, businessStatusSchema, businessCategorySchema
│   │   ├── actions-business.ts        # NEW (P8a) — 8 business action variants
│   │   └── events-business.ts         # NEW (P8a) — 8 business event variants
│   └── migrations/
│       └── defaults.ts                # MODIFIED (P8a/P8c) — v9→v10 (9 operational fields) + v10→v11 (inventory + accruedInterest)
└── simulation/src/
    ├── business/                      # NEW (P8b/P8c) — pure business helpers
    │   ├── errors.ts                  #   5 typed errors
    │   ├── accounting.ts              #   bigint arithmetic + revenue/expenses + accrueInterest + checkBankruptcy
    │   ├── valuation.ts               #   recomputeValuation + cadence (R-P8-5 local const)
    │   ├── supply-chain.ts            #   resolveInputs/resolveOutputs + vertical integration + market price map
    │   ├── production.ts              #   runProduction + operateBusiness orchestration
    │   ├── market.ts                  #   clearMarkets + executeMarketTransaction (P8c, demand injection)
    │   ├── growth-pressure.ts         #   inflation / debt interest / shareholder / competition (P8c)
    │   ├── actions.ts                 #   8 action handlers + createBusinessFromDefinition
    │   └── index.ts                   #   public surface
    ├── systems/
    │   ├── business.ts                # REPLACES STUB (P8b/P8c) — registry slot #8
    │   └── index.ts                   # MODIFIED — imports businessSystem
    ├── actions/
    │   └── handlers.ts                # MODIFIED (P8b) — registers the 8 business action handlers
    └── test/
        ├── business.test.ts           # NEW (P8b) — 62 tests
        ├── business-market.test.ts    # NEW (P8c) — 12 tests
        ├── business-inventory.test.ts # NEW (P8c) — 14 tests
        └── business-growth-pressure.test.ts # NEW (P8c) — 21 tests
```

`docs/business.md` (this file) is the human-readable model documentation;
the source-of-truth for invariants is the test suite. The paired carry-
forward records are the R-P8 items in §16 (flagged in source with
`// R-P8-N:` comments).
