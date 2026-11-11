# Economy & Personal Simulation (P3 — final)

**Status:** Source-of-truth contract for the P3 Economy (P3a–P3d) implementation. Built on
`docs/GDD.txt` §6 (Money and Currency), §7 (Personal Economy and Well-Being), §8.1/§8.5
(Financial Separation, Market Simulation), §16 (Design Constraints) and `docs/TDD.txt`
§10 (Economic Engine), §11 (Personal and Business Accounting), §18 (Testing Strategy).

P3 is the last sub-task of Phase 3. It supersedes the
P0 stubs in `packages/simulation/src/systems/stubs.ts` — `EconomySystem` and
`PersonalSystem` are now real, pure, deterministic systems. The remaining six systems
(Business, Automation, Environment, Progression, Event) stay stubbed until P5+.

This document is paired with `docs/GDD.txt` and `docs/TDD.txt`. Where this document and
the GDD/TDD disagree, the GDD/TDD win and a fix must be filed against this document.

> **Scope flag.** Every `@provisional` constant in this document corresponds to (or stands
> in for) an unresolved design decision listed in `GDD §17`. They live in
> `packages/shared/src/constants/economy.ts` under the `PROVISIONAL_ECONOMY_*` /
> `PROVISIONAL_PERSONAL_*` / `PROVISIONAL_WELL_BEING_*` prefixes. P5+ playtesting will
> calibrate them; until then the engine NEVER hardcodes tuning numbers, only imports.

---

## 1. Public interfaces at a glance

| Surface                                     | Location                                                            | P3 phase |
|---------------------------------------------|---------------------------------------------------------------------|----------|
| `ledger.ts` — transfers + conservation      | `packages/simulation/src/economy/ledger.ts`                         | P3a      |
| `authority.ts` — issuance + idempotency     | `packages/simulation/src/economy/authority.ts`                      | P3a      |
| `markets.ts` — pricing + inflation + buy    | `packages/simulation/src/economy/markets.ts`                        | P3b      |
| `actions.ts` — pay-expense / transfer / sell-tree | `packages/simulation/src/economy/actions.ts`                  | P3c      |
| `expenses.ts` — recurring bills             | `packages/simulation/src/personal/expenses.ts`                      | P3c      |
| `well-being.ts` — financial security + health + happiness | `packages/simulation/src/personal/well-being.ts`      | P3c      |
| `errors.ts` — typed runtime errors          | `packages/simulation/src/economy/errors.ts` + `packages/shared/src/errors.ts` | P3a–P3c |
| `systems/economy.ts` — per-tick drain + market update | `packages/simulation/src/systems/economy.ts`            | P3a/P3b  |
| `systems/personal.ts` — per-tick bills + well-being | `packages/simulation/src/systems/personal.ts`               | P3c      |
| Schemas (`AccountState`, `TransactionRecord`, `EconomyState`, `MarketState`, `PlayerState`, actions) | `packages/shared/src/schemas/` | P3a–P3c |
| Constants (`PROVISIONAL_ECONOMY_*`, `PROVISIONAL_PERSONAL_*`, `PROVISIONAL_WELL_BEING_*`) | `packages/shared/src/constants/economy.ts` | P3a–P3c |
| Migration v4→v5 (accounts)                  | `packages/shared/src/migrations/registry.ts`                       | P3a      |
| Migration v5→v6 (inflationIndex)             | `packages/shared/src/migrations/registry.ts`                       | P3b      |
| Migration v6→v7 (`player.unpaidDays`)       | `packages/shared/src/migrations/registry.ts`                       | P3c      |

The `engine.executeAction` dispatch table (`packages/simulation/src/actions/handlers.ts`)
registers these P3 actions:

| Action        | Handler                     | P3 phase | Notes                                             |
|---------------|-----------------------------|---------|---------------------------------------------------|
| `purchase`    | `purchaseHandler`           | P3b     | Money → market account; inventory credited.      |
| `pay-expense` | `payExpenseHandler`         | P3c     | Money → authority (sink); does NOT throw on low funds. |
| `transfer`    | `transferHandler`           | P3c     | Real→real transfer; only `player:personal` may be the source (P3c ownership restriction). |
| `sell-tree`   | `sellTreeHandler`           | P3c     | **Invariant guard** — ALWAYS throws (see §6 below). |

---

## 2. Ledger + account model (TDD §10.4)

### 2.1 Accounts

Every real holder of currency is an `AccountState` entry on
`economy.accounts`. P3 seeds 7 at game start (one player, one placeholder external, five
per-market externals):

```typescript
interface AccountState {
  /** Unique account id, e.g. `'player:personal'`, `'external:default'`, `'market:water'`. */
  id: string;
  /** Discriminant: `'player' | 'external' | 'business'` (the last reserved for P7). */
  type: AccountType;
  /** Human-readable label for UI display. */
  label: string;
  /** Balance in bigint minor units (TDD §10.1), serialized as string. */
  balance: string;
}
```

The **central monetary authority is virtual** — it has no entry in `accounts`. Its net
position is implied by `totalIssued - totalSinks`. The authority's id is
`PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID = 'authority'` and is recognised by the ledger
functions (see §2.3 below).

### 2.2 TransactionRecord shape (TDD §10.4)

Every money movement is recorded as a `TransactionRecord`:

```typescript
interface TransactionRecord {
  id: string;                  // deterministic: `txn:<timestamp>:<counter>` (TDD §18.3)
  timestamp: number;          // simulation second at which the transfer occurred
  sourceAccount: string;      // 'authority' for issuance; an account id otherwise
  destinationAccount: string; // 'authority' for sink; an account id otherwise
  amount: string;             // bigint minor units, as string (TDD §10.1)
  category: string;           // 'issuance' | 'sink' | 'transfer' | 'purchase' | 'expense' | 'tax' | 'fee'
  description: string;        // human-readable audit trail
  requestId?: string;         // P3a: optional idempotency key tying this transaction
                              // to `economy.processedRequestIds` (issuance/sink only).
}
```

The `requestId` field is **optional** so v4 (pre-P3a) saves parse cleanly under v5+.
For issuance and sink transactions the field is always populated; the same `requestId`
is added to `economy.processedRequestIds` so the request can never be re-processed.

### 2.3 The three money-movement operations

The ledger exposes one primitive — `transfer(state, params)` — that handles all three
movements based on which side is the virtual authority:

| Operation | `sourceAccount`  | `destinationAccount` | Effect on counters |
|-----------|------------------|----------------------|---------------------|
| **Issuance** | `'authority'` (virtual)  | a real account      | `monetarySupply += amount`, `totalIssued += amount` |
| **Sink**      | a real account | `'authority'` (virtual) | `monetarySupply -= amount`, `totalSinks += amount` |
| **Transfer**  | a real account | a different real account | counters unchanged |

Validations enforced by `transfer()`:

1. `amount` parses as a positive bigint string (`> 0`). Negative / zero / non-bigint →
   `InvalidAmountError`.
2. `sourceAccount !== destinationAccount` (`SelfTransferError` otherwise — use
   `recordTransaction()` for a no-op audit entry).
3. Both accounts exist in `economy.accounts` (or are the virtual authority — the authority
   is exempt because it has no entry). `UnknownAccountError` otherwise.
4. Source has sufficient funds (`balance >= amount`). `InsufficientFundsError` otherwise.
5. The transfer is **atomic** — either both updates apply or neither does. A rejection
   leaves the input state byte-identical (TDD §10.4 — "state is unchanged after a
   rejected transfer").

If `params.requestId` is set, the resulting `TransactionRecord.requestId` is populated AND
the requestId is appended to `economy.processedRequestIds` (idempotency — see §3).

### 2.4 Conservation invariant (TDD §10.4 — "money never silently created or destroyed")

```
sum(account.balance for account in economy.accounts) + totalSinks
  === initialSupply + totalIssued
```

where `initialSupply` is the player's starting cash (set at game start by
`PROVISIONAL_STARTING_PERSONAL_CASH_MINOR` and treated as a constant for a given save —
it is NOT persisted as a separate field, but the invariant treats it as a constant for
the save).

The ledger functions preserve this invariant by construction. The verifier
`conservationDiscrepancy(state, initialSupply)` returns `0n` iff it holds; non-zero
indicates a bug. Tests call this after every money-movement operation
(`economy.test.ts`, `markets.test.ts`, `personal.test.ts`, and the P3d
`economy-invariants.test.ts`).

> **Why the authority is virtual.** Treating the central bank as a virtual account with
> no balance entry keeps the conservation invariant tidy: issuance grows the supply
> (because a real account is credited without debiting another), and sinks shrink it
> (because a real account is debited without crediting another). The authority's net
> position is implicit and never needs to be reconciled against an explicit balance.

---

## 3. Currency issuance flow (TDD §10.2, §10.3)

The full harvest → currency pipeline spans P1, P3a, and P3c:

```text
P1  harvest-leaves action
      └──► harvestLeaves(tree, ctx, requestedLeaves, ts, currencyId)
            └──► CurrencyIssuanceRequest { treeId, amount, currencyId, source: 'harvest-leaves' }
      └──► queued on tree.pendingIssuances

P3a EconomySystem.execute (each tick)
      └──► drainPendingIssuances(state, tree, saveId, ctx.now, { policy })
            for each req in tree.pendingIssuances (by index):
                requestId = `issuance:${saveId}:${ctx.now}:${index}`   ← deterministic
                └──► requestIssuance(state, req, requestId, ctx.now, options)
                      1. idempotency: is requestId in processedRequestIds?
                          YES → emit issuance-rejected { reason: 'duplicate-request' }; no money moved.
                          NO  → continue.
                      2. validate amount: must be positive bigint string.
                          INVALID → emit issuance-rejected { reason: 'invalid-amount' }.
                      3. apply policy (DEFAULT_ISSUANCE_POLICY from content):
                          - maxPerRequest exceeded → reason 'per-request-limit-exceeded'.
                          - maxTotal exceeded     → reason 'cumulative-limit-exceeded'.
                      4. authorised → transfer(state, {
                            sourceAccount: 'authority',
                            destinationAccount: 'player:personal',     // or custom
                            amount, category: 'issuance', timestamp, requestId
                         })
                         monetarySupply += amount, totalIssued += amount.
                         Mirror new balance to player.personalCash (P3a coupling).
                         Emit issuance-authorized + transaction-recorded.
            └──► clear tree.pendingIssuances (whether authorised or rejected)

P3c PersonalSystem.execute (later in the same tick)
      └──► deriveWellBeing(state)  ← reads player:personal balance + inflationIndex
```

### 3.1 The idempotency key (TDD §10.3 — "Currency production must be accounted for exactly once")

```typescript
function issuanceRequestId(saveId: string, simSecond: number, index: number): string {
  return `issuance:${saveId}:${simSecond}:${index}`;
}
```

The requestId is **deterministic** given the same `(saveId, simSecond, index)` triple. This
is the linchpin of the save/load idempotency contract:

- A pending issuance queued at sim second `T` on save `S`, at queue position `i`,
  always produces requestId `issuance:S:T:i`.
- After the EconomySystem drains the queue, that requestId is added to
  `economy.processedRequestIds` and the queue is cleared.
- If the same `(saveId, simSecond, index)` triple is re-processed (e.g. a buggy
  re-simulation after a partial save), the idempotency check catches the duplicate and
  emits `issuance-rejected { reason: 'duplicate-request' }` with **no money movement**.

### 3.2 Idempotency contract across save/load (TDD §18.3, §18.4)

```text
[Step 1] harvest → queue [req₁] on tree.pendingIssuances.
[Step 2] advance one tick at ctx.now = T → EconomySystem drains the queue:
         - requestId₁ = `issuance:save:T:0`
         - processIssuance credits player:personal + records txn + marks requestId₁.
         - queue cleared.
[Step 3] save() → envelope { schemaVersion: 7, state: { ... economy.processedRequestIds:
         [requestId₁], economy.transactions: [txn₁], economy.totalIssued: 'amount₁' } }
[Step 4] load() → state round-trips through Zod + migrations; processedRequestIds intact.
[Step 5] A buggy re-queue of req₁ at the same simSecond + index would produce the SAME
         requestId → the idempotency check at step 1 of requestIssuance catches it →
         issuance-rejected { reason: 'duplicate-request' } → no double-issuance.
```

This is verified end-to-end in `packages/simulation/test/economy-integration.test.ts`
("save → load → re-drain at same simSecond: no double-issuance").

### 3.3 Issuance policy (TDD §10.3, GDD §6.2)

`DEFAULT_ISSUANCE_POLICY` (in `packages/content/src/monetary-policy/index.ts`) is
permissive for P3a: no per-request cap, no cumulative cap, no issuance fee. P5+ may
introduce:

- `maxPerRequest: string | null` — a per-harvest cap (a single harvest can't mint a
  trillion dollars).
- `maxTotal: string | null` — a cumulative supply cap.
- `issuanceFeeFraction: number` — fraction sunk to the authority as a "minting fee"
  (the hook exists in the schema; P3c does NOT honour it yet).

The `authorizeIssuance()` pure function in `content/monetary-policy/index.ts` exists
for testability — the EconomySystem uses the same logic via `requestIssuance()`'s
policy branch. All caps are bigint-as-string for safe JSON round-trip (TDD §10.1).

### 3.4 Five-way distinction (TDD §10.2 — "the implementation must distinguish")

| Concept                              | Field                                       | Owner system |
|--------------------------------------|---------------------------------------------|--------------|
| Physical leaves currently on the tree | `tree.foliage.currentLeaves`              | BiologySystem / HarvestSystem |
| Currency generated by harvesting     | `tree.pendingIssuances` (the queue)         | HarvestSystem queues; EconomySystem drains |
| Currency currently in circulation    | `economy.monetarySupply`                    | EconomySystem |
| Currency held by the player          | `economy.accounts[player:personal].balance` (mirrored on `player.personalCash`) | EconomySystem |
| Currency held by other participants  | `economy.accounts[external:*]` / `market:*` | EconomySystem + actions |

`player.personalCash` is a **mirror** of `accounts[player:personal].balance`. The
EconomySystem and the action handlers keep them in sync so legacy code (P0/P1/P2 tests,
the future P4 renderer) reading `player.personalCash` keeps working. P3c left this coupling
in place; a future refactor may collapse them.

---

## 4. Market pricing + inflation index (TDD §10.6, GDD §8.5, §6.3)

### 4.1 Markets

P3 ships 5 commodity markets (`packages/content/src/markets/index.ts`):

| Market id          | commodityId                  | basePrice (minor) | unit    |
|--------------------|------------------------------|-------------------|---------|
| `market:water`     | `resource:water`             | `10` ($0.10)      | litre   |
| `market:fertilizer`| `fertilizer:balanced-10-10-10` | `500` ($5.00)   | unit    |
| `market:seeds`     | `resource:seeds`             | (see content)     | unit    |
| `market:food`      | `resource:food`              | (see content)     | unit    |
| `market:energy`    | `resource:energy`            | (see content)     | kWh     |

The market's `commodityId` doubles as the inventory `resourceId` — purchases credit
`{ resourceId: market.commodityId, quantity }` to `inventory.items` so the P2
`apply-water` / `apply-fertilizer` actions can consume from the same key (TDD §10.5).
P3b verifies the contract; P3c is where the deduction would be wired (still TODO — see
§9 Gaps).

### 4.2 Pricing model

Per market, per tick (all constants are `@provisional`, see
`packages/shared/src/constants/economy.ts`):

```
supplyDemandFactor = clamp(
  1 + ELASTICITY × ln( max(demand, MIN_SCALE) / max(supply, MIN_SCALE) ),
  MIN_FRACTION, MAX_MULTIPLIER
)

monetaryConditionsFactor = clamp(
  1 + MONETARY_CONDITIONS_ELASTICITY × (monetarySupply / initialSupply - 1),
  MIN_FRACTION, MAX_MULTIPLIER
)

targetPrice = basePrice × supplyDemandFactor × monetaryConditionsFactor   (bigint, rounded)

price' = price + (targetPrice - price) × SMOOTHING                          (sticky prices)
```

Supply/demand dynamics per tick:

```
supply' = max(0, supply × (1 - SUPPLY_DECAY) + SUPPLY_REFILL_RATE - purchased)
demand' = max(0, demand × (1 - DEMAND_DECAY) + purchased)
```

Purchases subtract from supply (drawn-down stock) and add to demand (the signal that
this market is "active"). Refill + decay return markets to equilibrium when no activity
occurs.

### 4.3 Why log-ratio, not linear difference

The log-ratio form has three properties the linear `(demand - supply) / (supply + demand)`
form lacks (TDD §10.6):

1. **Unbounded raw value.** Extreme imbalances (supply → 0 with demand huge, or
   vice-versa) push the raw factor well past the `[MIN_FRACTION, MAX_MULTIPLIER]` clamps,
   so the clamps actually engage. The linear form saturates at `1 ± ELASTICITY` and never
   reaches the clamps with conservative elasticity.
2. **Symmetric in ratios.** A 2× demand-over-supply gives the same `|factor - 1|` as a
   2× supply-over-demand.
3. **Mild for moderate imbalances.** At the game-start state (`supply = 100, demand = 0`)
   the factor is `1 + ELASTICITY × ln(MIN_SCALE / INITIAL_SUPPLY) ≈ 0.77` with the starter
   constants — small enough that monetary growth (issuance) can push target prices above
   the base.

### 4.4 Inflation price index (Laspeyres-style, NOT a global multiplier)

```typescript
inflationIndex = Σ(price_i / basePrice_i) / N    // uniform-weighted basket
```

At game start all `price_i == basePrice_i`, so `inflationIndex == 1.0`. As prices rise
across markets, the index rises. The derived `inflationRate` (annualised per-tick change)
is **cosmetic** — it's the index itself that drives real purchasing power (§5 below).

GDD §6.3 requires that the player experiences the difference between nominal income
growth and actual purchasing power. The P3c PersonalSystem divides the player's nominal
cash balance by the inflation index before applying the wealth → security curve (§5).
A doubling of prices (index = 2.0) without a corresponding doubling of the player's cash
halves their real wealth — exposing the GDD §6.3 "increasing the number of banknotes
does not necessarily increase real wealth" rule.

### 4.5 Per-tick market update (EconomySystem)

The EconomySystem calls `updateMarkets(state, { now, initialSupply })` each tick. For
each market on `economy.markets`:

1. Refill supply by `SUPPLY_REFILL_RATE` (background supplier activity).
2. Decay supply by `SUPPLY_DECAY` (spoilage / rotation).
3. Decay demand by `DEMAND_DECAY` (fading purchase pressure).
4. Compute target price (supply/demand + monetary conditions).
5. Lerp the current price toward target by `SMOOTHING` (a 1-minor-unit nudge handles
   small-price markets where the float lerp would round to 0).
6. Update `lastPriceUpdate` to `ctx.now`.

Then recompute `economy.inflationIndex` and `economy.inflationRate` from the basket.

Pure: returns a new state + a list of `market-price-changed` events (one per market
whose price moved). Deterministic given `(state, ctx.now, initialSupply)`.

### 4.6 Purchase action

```typescript
applyPurchase(state, { marketId, quantity, timestamp })
```

Steps:

1. Resolve the market by id; throw `UnknownMarketError` if unknown.
2. Compute `cost = market.price × quantity` (bigint).
3. Transfer `cost` from `player:personal` to `market:<id>` via P3a's `transfer()`
   (category `'purchase'`). Validates sufficient funds.
4. Credit `inventory.items` with `{ resourceId: market.commodityId, quantity }`
   (incrementing if the resource is already in inventory).
5. Adjust market supply/demand: `supply -= quantity`, `demand += quantity` (floor at 0).
6. Emit `purchase-completed` event carrying the full result.

Money NEVER silently created or destroyed: the transfer is real-to-real;
`monetarySupply`, `totalIssued`, and `totalSinks` are unchanged. The conservation
invariant holds (verified in `markets.test.ts` and the P3d
`economy-invariants.test.ts`).

---

## 5. PersonalSystem — scheduled expenses + well-being (TDD §11, GDD §7)

### 5.1 Recurring living expenses (GDD §7.1)

Five categories: `food`, `housing`, `utilities`, `healthcare`, `transportation`
(GDD §7.1). Every `PROVISIONAL_PERSONAL_BILLING_INTERVAL_DAYS = 30` sim days (≈1 sim
month at 120 days/year), the PersonalSystem schedules a `bill-due` scheduled event. When
the event fires, the system attempts to pay each of the 5 categories out of
`player:personal` (sinking the cash to the authority, category `'expense'`).

If the player can't afford a category, the system **does not throw** — instead it:

- Increments `player.unpaidDays` by `PROVISIONAL_PERSONAL_BILLING_INTERVAL_DAYS` (one
  full billing cycle of unpaid living costs).
- Emits `expense-due { paid: false, category, amount, source: 'auto-bill' }`.
- Emits a `notification { severity: 'warning', code: 'low-funds' }`.

Paid bills emit `expense-due { paid: true, ... }` and record a real `expense`
transaction.

### 5.2 Scheduled-event idempotency

The `bill-due` scheduled-event id is derived deterministically from
`(saveId, cycle)` where `cycle = floor(simSecond / BILLING_INTERVAL_SECONDS)`. The
PersonalSystem uses this id when scheduling: if a future `bill-due` event already exists
in the scheduler, it does nothing. This keeps bill scheduling idempotent across
save/load — re-running the same tick never double-schedules a bill.

### 5.3 The `pay-expense` action (manual)

A player can pre-pay a due bill manually:

```typescript
engine.executeAction(state, {
  type: 'pay-expense',
  payload: { category: 'food', amount: '500' },
});
```

The handler delegates to the pure `processExpensePayment(state, { category, amount,
timestamp, source: 'pay-expense' })` — the same one the auto-bill flow uses, with the
`source` field discriminating manual vs auto payments. Insufficient funds are handled
gracefully (same path as auto-bill: increment `unpaidDays`, emit `expense-due { paid:
false }` + `low-funds` notification, no throw). Other errors (invalid amount, unknown
account) propagate as typed errors from `transfer()`.

### 5.4 Well-being derivation (GDD §7.2, §7.3)

The PersonalSystem recomputes `player.health`, `player.happiness`, and
`player.financialSecurity` each tick via the pure `deriveWellBeing(state)` helper.

#### 5.4.1 Financial security — saturating hyperbola on REAL wealth (GDD §7.3)

```text
realWealth = nominalCash / inflationIndex          (floored to whole minor units)
security   = realWealth / (realWealth + SCALE)
```

where `SCALE = PROVISIONAL_WELL_BEING_WEALTH_SCALE_MINOR = 100_000` ($1_000 — the
poverty-to-security threshold). Properties (GDD §7.3):

- At `realWealth === 0`, security = 0 (destitute).
- At `realWealth === SCALE`, security = 0.5 (the half-saturation point).
- As `realWealth → ∞`, security → 1.0 (extraordinarily wealthy).
- Marginal gain per dollar = `SCALE / (wealth + SCALE)²` — monotonically decreasing in
  wealth (diminishing returns).

The GDD §7.3 "difference between wealthy and extraordinarily wealthy should be
considerably smaller" requirement falls out of the function form:

- `$100 → $1_000` (×10): security gain ≈ +0.41 (escapes poverty — substantial)
- `$1_000 → $10_000` (×10): ≈ +0.41 again (log-scale invariance)
- `$10_000 → $100_000` (×10): ≈ +0.08 (diminishing — the curve is saturating)
- `$100_000 → $1_000_000` (×10): ≈ +0.009 (considerably smaller)

The hyperbola uses **REAL** wealth (deflated by the inflation index), so an
inflationary economy that doubles prices without doubling the player's cash halves their
real purchasing power — exposing GDD §6.3's "nominal vs real" distinction.

#### 5.4.2 Physical health — `unpaidDays` penalty, capped at 0.5

```text
penalty = clamp(unpaidDays × PENALTY_PER_DAY, 0, MAX_PENALTY)
health  = clamp(1 - penalty, 0, 1)
```

`PENALTY_PER_DAY = 0.005` (0.5%/day), `MAX_PENALTY = 0.5`. Unpaid bills can drop health
from 1.0 to 0.5 but no further — a perpetually broke player stays at 0.5 rather than
spiralling to 0 (GDD §16.3: tree death does not end the game; analogously, financial
ruin does not end the simulation). Other health drivers (nutrition, housing,
environmental exposure, pollution, stress — GDD §7.2) will add their own penalties in
later phases (P6 EnvironmentSystem, future social systems).

`unpaidDays` decays asymptotically when bills are paid on time: each tick with no new
unpaid bills, the counter is multiplied by `(1 - PROVISIONAL_WELL_BEING_UNPAID_RECOVERY_PER_TICK)`
(0.01 = 1%/tick). The `Math.max(0, Math.floor(...))` form keeps the counter integer
and non-negative across many ticks of decay.

#### 5.4.3 Happiness — weighted blend (GDD §7.2)

```text
happiness = W_SECURITY × security + W_HEALTH × health + W_BASELINE
```

Weights (`@provisional`, GDD §7.2):

| Constant                                              | Value | Meaning                                     |
|-------------------------------------------------------|-------|---------------------------------------------|
| `PROVISIONAL_WELL_BEING_HAPPINESS_WEIGHT_SECURITY`    | 0.5   | financial security contributes half         |
| `PROVISIONAL_WELL_BEING_HAPPINESS_WEIGHT_HEALTH`      | 0.3   | physical health contributes 30%             |
| `PROVISIONAL_WELL_BEING_HAPPINESS_BASELINE`           | 0.2   | baseline (leisure/relationships/environment) — never below 0.2 |

Satisfies GDD §7.3 ("a player can become extremely rich while remaining unhappy or
unhealthy"): no single driver can push happiness above `1 - (sum of the other weights)`
— a rich player with poor health caps at `0.5 + 0 + 0.2 = 0.7`, NOT 1.0.

The baseline term is a constant for P3c; later phases will replace it with real
derivations (leisure from automation, relationships from social systems, environment
from P6 EnvironmentSystem, accumulated stress from P5+ AutomationSystem).

### 5.5 Low-funds notification

When `player:personal` balance drops below
`PROVISIONAL_PERSONAL_LOW_FUNDS_THRESHOLD_MINOR = '24000'` ($240, one billing cycle's
worth of expenses), the PersonalSystem emits a `notification` event with severity
`'warning'` and code `'low-funds'`. Emitted once per tick the balance is low (the UI can
debounce).

### 5.6 P3c constants summary

All values are `@provisional` per GDD §17 (see `packages/shared/src/constants/economy.ts`
for the full comments + tuning rationale):

| Constant                                                  | Value              | Purpose                              |
|-----------------------------------------------------------|--------------------|--------------------------------------|
| `PROVISIONAL_PERSONAL_BILLING_INTERVAL_DAYS`               | 30                 | One bill per ~1 sim month            |
| `PROVISIONAL_PERSONAL_EXPENSE_FOOD_MINOR`                 | `'3000'` ($30)     | Monthly food cost                    |
| `PROVISIONAL_PERSONAL_EXPENSE_HOUSING_MINOR`               | `'12000'` ($120)   | Monthly housing cost                 |
| `PROVISIONAL_PERSONAL_EXPENSE_UTILITIES_MINOR`             | `'4000'` ($40)     | Monthly utilities cost               |
| `PROVISIONAL_PERSONAL_EXPENSE_HEALTHCARE_MINOR`            | `'2000'` ($20)     | Monthly healthcare cost              |
| `PROVISIONAL_PERSONAL_EXPENSE_TRANSPORTATION_MINOR`        | `'3000'` ($30)     | Monthly transportation cost          |
| `PROVISIONAL_PERSONAL_LOW_FUNDS_THRESHOLD_MINOR`           | `'24000'` ($240)   | Low-funds notification threshold     |
| `PROVISIONAL_WELL_BEING_WEALTH_SCALE_MINOR`                | `'100000'` ($1000) | Half-saturation wealth for security  |
| `PROVISIONAL_WELL_BEING_UNPAID_HEALTH_PENALTY_PER_DAY`     | 0.005              | Per-day physical health penalty      |
| `PROVISIONAL_WELL_BEING_UNPAID_HEALTH_PENALTY_MAX`         | 0.5                | Cap on unpaid-bill health penalty    |
| `PROVISIONAL_WELL_BEING_UNPAID_RECOVERY_PER_TICK`          | 0.01               | Per-tick decay of unpaidDays counter |
| `PROVISIONAL_WELL_BEING_HAPPINESS_WEIGHT_SECURITY`         | 0.5                | Weight of financial security in happiness |
| `PROVISIONAL_WELL_BEING_HAPPINESS_WEIGHT_HEALTH`           | 0.3                | Weight of physical health in happiness   |
| `PROVISIONAL_WELL_BEING_HAPPINESS_BASELINE`                | 0.2                | Baseline happiness (leisure/relationships/env placeholder) |

A fresh player ($500 = 50_000 minor) can survive ~6 billing cycles (~half a sim year)
before going broke — enough ramp to learn the harvest → currency loop (the P3d
integration test exercises this end-to-end).

---

## 6. Sell-tree guard (GDD §16.1/§16.2, TDD §18.4, §21.12)

The original tree is **sacred**. Two layers enforce GDD §16.1 ("cannot be sold") +
§16.2 ("cannot be replaced"):

1. **Schema layer (`packages/shared/src/schemas/game-state.ts` superRefine):** rejects
   any save where `originalTree.isOriginal !== true` or `originalTree.id !== 'original'`.
2. **Action layer (`sellTreeHandler` in `packages/simulation/src/economy/actions.ts`):**
   the `sell-tree` action ALWAYS throws:
   - `OriginalTreeNotTransferableError` if `target === 'original'` (or
     `target === state.originalTree.id`, which is `'original'` by the schema invariant).
     The handler does NOT mutate state — it throws before any state change.
   - `TreeSaleNotImplementedError` for any other target (P3c only knows about the
     original tree; selling additional trees arrives in P8).

The typed-error contract lets the UI catch them via `instanceof` and surface a
"You can't sell the original tree" toast instead of crashing the engine. The error
carries `treeId` for routing.

P3d's `economy-invariants.test.ts` exercises both branches (target='original' and
target='non-original'), asserts the typed errors propagate, and asserts state is left
byte-identical after the throw.

---

## 7. EconomySystem + PersonalSystem per-tick contract

System execution order (see `docs/simulation.md` §3, fixed for determinism):

```text
1. TimeSystem        — advance the clock; everyone reads new ctx.now.
2. WeatherSystem     — produces weather; biology + resources react.
3. BiologySystem     — photosynthesis/growth; reads weather.
4. ResourceSystem    — water/nutrients/soil; reads weather + biology.
5. HarvestSystem     — leaf removal; reads biology.
6. EconomySystem     — drains pendingIssuances, updates markets + inflationIndex.
7. PersonalSystem    — schedules/fires bills, derives well-being, low-funds notification.
8–12. (stubs)
   Scheduler       — fires due scheduled events AFTER all systems run (not a system itself).
```

### 7.1 EconomySystem per-tick

```typescript
execute(state, ctx) {
  // 1. Drain pending issuances (P3a).
  if (state.originalTree.pendingIssuances.length > 0) {
    drainPendingIssuances(state, state.originalTree, state.metadata.saveId, ctx.now,
                          { policy: DEFAULT_ISSUANCE_POLICY });
  }

  // 2. Update market prices + inflation index (P3b).
  updateMarkets(state, { now: ctx.now, initialSupply: PROVISIONAL_STARTING_PERSONAL_CASH_MINOR });
}
```

The EconomySystem is pure: it returns a new state, never mutates input. Determinism:
same `(state, ctx)` → same `(new state, events)`. The requestId is derived from
`state.metadata.saveId + ctx.now + queue index`, all deterministic given the state. The
pricing model uses no randomness — only arithmetic on the current market state.

### 7.2 PersonalSystem per-tick

```typescript
execute(state, ctx) {
  // 1. Ensure the next bill is scheduled (no-op if one is already queued for a future sim second).
  ensureNextBillScheduled(state, ctx.now);

  // 2. Process due bills (auto-pay or record unpaid). Cancels each fired event from the scheduler.
  for (const bill of dueBills(state, ctx.now)) {
    processFiredBill(state, bill, ctx.now);
  }

  // 3. Decay unpaidDays counter (recovery) when no new unpaid bills accumulated this tick.
  if (!hadUnpaidThisTick && state.player.unpaidDays > 0) {
    state.player.unpaidDays = max(0, floor(unpaidDays × (1 - RECOVERY_PER_TICK)));
  }

  // 4. Derive well-being indicators (financial security, physical health, happiness).
  deriveWellBeing(state);  // writes to state.player.{health, happiness, financialSecurity}

  // 5. Low-funds notification if player:personal balance < threshold.
  if (balance < LOW_FUNDS_THRESHOLD) {
    emit notification { severity: 'warning', code: 'low-funds' };
  }
}
```

The system **does NOT fork the RNG** (it draws no random values). This is intentional —
forking would advance the root RNG by one draw, shifting the sequences of downstream
systems (BusinessSystem is the next non-stub; P7+). Skipping the fork keeps
PersonalSystem pure arithmetic.

---

## 8. Determinism contract (TDD §18.3)

Given:

- The same initial game state.
- The same random seed.
- The same player actions (in the same order).
- The same simulation duration.

The simulation produces:

- The same final state.
- The same transaction log (same ids, same amounts, same timestamps, same `requestId`s).
- The same events.

The economy module upholds this by construction:

- `transactionId(timestamp, counter)` is deterministic — `txn:<ts>:<n>` where `n` is the
  position in the transactions array.
- `issuanceRequestId(saveId, simSecond, index)` is deterministic — same `(saveId, sec, i)`
  always produces the same idempotency key.
- `billDueEventId(saveId, atSimSecond)` is deterministic — same `(saveId, cycle)` always
  produces the same scheduler-event id.
- The pricing model uses no randomness (only arithmetic on market state).

Save/load preserves all of these: `economy.processedRequestIds`,
`economy.transactions`, `economy.accounts[*].balance`, `economy.markets[*].price`,
`economy.inflationIndex`, `player.unpaidDays`, `scheduler.events`, `rngState`,
`rngStreams.weather` all survive the round-trip. Verified in `engine.test.ts` (P0),
`economy.test.ts` (P3a), `markets.test.ts` (P3b), `personal.test.ts` (P3c), and the
P3d `economy-integration.test.ts`.

---

## 9. Invariants continuously verified (TDD §18.4)

| Invariant                                                | Verified by                                   |
|----------------------------------------------------------|-----------------------------------------------|
| No negative leaf counts                                  | `biology.test.ts`, `biology-system.test.ts`   |
| No negative resource balances                            | `resources.test.ts`, `resources-system.test.ts` |
| No unauthorized currency creation (conservation)         | `economy.test.ts`, `markets.test.ts`, `personal.test.ts`, `economy-invariants.test.ts` |
| No duplicate transaction processing (idempotency)        | `economy.test.ts`, `economy-invariants.test.ts` |
| No invalid ownership transfers (sell-tree guard)         | `personal.test.ts`, `economy-invariants.test.ts` |
| No impossible tree state transitions                     | `biology.test.ts` (mortality + death)         |
| No accidental sale of the original tree                  | `personal.test.ts`, `economy-invariants.test.ts` |
| No direct modification of state by rendering components  | `import-boundary.test.ts`                     |
| No negative cash balances                                | `economy-invariants.test.ts`                  |

The P3d `economy-invariants.test.ts` adds explicit, named-invariant tests for the
conservation + idempotency + sell-tree rules across all money-movement operations
(issuance, sink, transfer, purchase, pay-expense, auto-bill).

---

## 10. Gaps + future work (R items)

These are explicitly **not** in P3d scope (P3d is "build docs + tests, no new systems").
They're tracked here so future agents pick them up.

- **R-1 (P3c).** `apply-water` / `apply-fertilizer` actions still do NOT consume from
  `inventory.items`. P3b verified the `market.commodityId === inventory.resourceId`
  contract; the deduction is the next wiring step. **Status:** deferred from P3c.
- **R-2 (P3a).** `initialSupply` is currently passed to `updateMarkets` as the constant
  `PROVISIONAL_STARTING_PERSONAL_CASH_MINOR` rather than persisted on `EconomyState`.
  A future refactor will add an `initialSupply` field to `EconomyState` so saves with
  a different starting cash compute the monetary-conditions factor correctly.
- **R-3 (P3a).** `issuanceFeeFraction` exists in the schema but is NOT honoured by
  `requestIssuance`. The hook exists so a future phase can wire fee-sinking without a
  schema migration.
- **R-4 (P3c).** The `player.personalCash ↔ accounts[player:personal].balance` coupling
  is duplicated across `requestIssuance`, `applyPurchase`, `transferHandler`, and
  `processExpensePayment`. A refactor that centralises this in a single helper would
  reduce drift risk.
- **R-5 (P3b).** The inflation index uses uniform weights. P5+ may introduce
  CPI-style weights reflecting the player's actual consumption basket.
- **R-6 (P3b).** Markets are global — `economy.markets` is a flat array. P7+ will need
  regional markets with their own price/supply/demand state.
- **R-7 (P3c).** PersonalSystem does not fork the RNG (intentional — see §7.2). If a
  future system that runs after PersonalSystem needs randomness and depends on the RNG
  position being stable, this decision may need revisiting.
- **R-8 (P5+).** Offline progression (TDD §14.4) is NOT implemented — `engine.advance`
  runs ticks synchronously; the consumer's accumulator (apps/web) tracks wall-clock
  delta. P5 will add offline catch-up.

---

## 11. Test inventory (post-P3d)

P3d adds two new test files. Total test count grows from 426 (post-P3c) to 426+new
(see the commit messages for exact counts).

| File                                                            | Phase | Scope                                  |
|-----------------------------------------------------------------|-------|----------------------------------------|
| `packages/simulation/test/economy-integration.test.ts`          | P3d   | Cross-phase: harvest → issuance → buy → apply → pay → conservation; save/load mid-sequence; determinism; inflation erodes real purchasing power. |
| `packages/simulation/test/economy-invariants.test.ts`           | P3d   | Sell-tree guard (both branches); conservation across all money-movement ops; idempotency (no double-issuance); no negative balances. |

Pre-existing P3 tests these complement (NOT modified in P3d):

| File                                            | Phase | Scope                                  |
|-------------------------------------------------|-------|----------------------------------------|
| `packages/simulation/test/economy.test.ts`      | P3a   | Ledger + transactions + idempotency + authority + migrations v4→v5. |
| `packages/simulation/test/markets.test.ts`      | P3b   | Pricing pure functions + applyPurchase + inflation index + migration v5→v6. |
| `packages/simulation/test/personal.test.ts`     | P3c   | Pure helpers (well-being, expenses) + PersonalSystem + actions + migration v6→v7. |

---

## 12. Quick links

- Ledger: `packages/simulation/src/economy/ledger.ts`
- Authority (issuance + idempotency): `packages/simulation/src/economy/authority.ts`
- Markets (pricing + inflation + purchase): `packages/simulation/src/economy/markets.ts`
- Economy actions (pay-expense / transfer / sell-tree): `packages/simulation/src/economy/actions.ts`
- Personal expenses: `packages/simulation/src/personal/expenses.ts`
- Well-being derivation: `packages/simulation/src/personal/well-being.ts`
- EconomySystem: `packages/simulation/src/systems/economy.ts`
- PersonalSystem: `packages/simulation/src/systems/personal.ts`
- EconomyState schema: `packages/shared/src/schemas/economy.ts`
- PlayerState schema: `packages/shared/src/schemas/player.ts`
- TransactionRecord schema: `packages/shared/src/schemas/economy.ts`
- AccountState schema: `packages/shared/src/schemas/economy.ts`
- CurrencyIssuanceRequest schema: `packages/shared/src/schemas/harvest.ts`
- Economy actions schema: `packages/shared/src/schemas/actions-economy.ts`
- Economy constants (`PROVISIONAL_ECONOMY_*`): `packages/shared/src/constants/economy.ts`
- Personal + well-being constants (`PROVISIONAL_PERSONAL_*`, `PROVISIONAL_WELL_BEING_*`): `packages/shared/src/constants/economy.ts`
- Monetary policy (DEFAULT_ISSUANCE_POLICY + authorizeIssuance): `packages/content/src/monetary-policy/index.ts`
- Market definitions (5 markets): `packages/content/src/markets/index.ts`
- Typed errors (OriginalTree, TreeSale, ledger): `packages/shared/src/errors.ts` + `packages/simulation/src/economy/errors.ts`
- Migration registry (v4→v5, v5→v6, v6→v7): `packages/shared/src/migrations/registry.ts`
