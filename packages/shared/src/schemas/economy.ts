import { z } from 'zod';
import {
  PROVISIONAL_ECONOMY_MAX_TRANSACTIONS,
  PROVISIONAL_ECONOMY_MAX_PROCESSED_REQUEST_IDS,
} from '../constants/economy.js';

/**
 * Transaction record (TDD §10.4).
 *
 * Every currency movement is recorded with source and destination accounts
 * (TDD §10.4). `amount` is bigint minor units serialized as string (TDD §10.1).
 *
 * `sourceAccount` / `destinationAccount` are account-id strings (e.g.
 * `'player:personal'`, `'external:default'`). The virtual authority account
 * (`PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID = 'authority'`) is also a valid
 * value: it represents the central bank as the source (issuance) or sink
 * (destruction). The authority has NO entry in `economy.accounts` — its net
 * position is implied by `totalIssued - totalSinks`.
 *
 * P3a adds an optional `requestId` field tying the transaction to the
 * idempotency set on `economy.processedRequestIds`. Older saves (pre-P3a)
 * don't have this field; the schema accepts its absence.
 */
export const transactionRecordSchema = z.object({
  id: z.string().min(1),
  timestamp: z.number().int().nonnegative(),
  sourceAccount: z.string(),
  destinationAccount: z.string(),
  amount: z.string(),
  category: z.string(),
  description: z.string(),
  // P3a: optional requestId tying this transaction to the idempotency set.
  // Older saves (pre-P3a) won't have this field; the schema accepts its
  // absence. Issuance and sink transactions populate it so the audit trail
  // links the on-disk transaction back to the CurrencyIssuanceRequest that
  // produced it.
  requestId: z.string().min(1).optional(),
});
export type TransactionRecord = z.infer<typeof transactionRecordSchema>;

/**
 * Account type — distinguishes player-held, external-participant, and (in P3c)
 * business accounts. The central monetary authority is NOT in `accounts` —
 * it is the virtual "mint" tracked by `totalIssued` and `totalSinks`.
 *
 * `business` is reserved for P3c (BusinessSystem). P3a only uses `player`
 * and `external`.
 */
export const accountTypeSchema = z.enum(['player', 'external', 'business']);
export type AccountType = z.infer<typeof accountTypeSchema>;

/**
 * Account state (TDD §10.5).
 *
 * A single economic participant's cash balance. Every entry in
 * `economy.accounts` represents a real holder of currency (as opposed to the
 * virtual authority). The conservation invariant
 * (TDD §10.4 — "money never silently created or destroyed") requires:
 *
 *   sum(account.balance for account in economy.accounts) + totalSinks
 *     === initialSupply + totalIssued
 *
 * where `initialSupply` is the starting `economy.monetarySupply` (set at game
 * initialization) and `totalIssued` / `totalSinks` are cumulative counters
 * incremented by the authority on issuance / sink.
 *
 * `balance` is bigint minor units serialized as string (TDD §10.1).
 */
export const accountStateSchema = z.object({
  /** Unique account id, e.g. `'player:personal'`, `'external:default'`. */
  id: z.string().min(1),
  type: accountTypeSchema,
  /** Human-readable label for UI display. */
  label: z.string(),
  /** Balance in bigint minor units (TDD §10.1), serialized as string. */
  balance: z.string(),
});
export type AccountState = z.infer<typeof accountStateSchema>;

export const monetaryAuthorityStateSchema = z.object({
  monetarySupply: z.string(),
  interestRate: z.number(),
  inflationTarget: z.number(),
});
export type MonetaryAuthorityState = z.infer<typeof monetaryAuthorityStateSchema>;

/**
 * Market state (TDD §10.6, GDD §8.5 — Market Simulation).
 *
 * A single commodity market tracked on `economy.markets`. Each market's
 * `price` is a bigint-as-string in minor currency units (TDD §10.1). The
 * pricing model lives in `packages/simulation/src/economy/markets.ts` —
 * supply/demand + monetary conditions drive per-tick price updates, and the
 * inflation index is *derived* from the basket of market prices rather
 * than applied as a global multiplier (TDD §10.6 — "Inflation should be
 * calculated from an appropriate price index rather than applied as a
 * universal multiplier to every item").
 *
 * P3b additions over P0/P3a:
 *   - `lastPriceUpdate`: simulation second at which `price` was last
 *     recomputed by the EconomySystem. Lets the UI show "stale" prices
 *     during paused periods and lets the migration backfill `0` for
 *     legacy saves (P3b v5 → v6).
 *
 * The market's `commodityId` doubles as the inventory `resourceId` when the
 * player purchases from it — the purchase action credits
 * `{ resourceId: market.commodityId, quantity }` to `inventory.items`. The
 * P2 `apply-water` / `apply-fertilizer` actions consume from this inventory
 * (P3c wires the deduction). P3b only verifies the ids match so the
 * purchase→apply chain is consistent end-to-end (TDD §10.5).
 */
export const marketStateSchema = z.object({
  /** Unique market id, e.g. `'market:water'`, `'market:fertilizer'`. */
  id: z.string().min(1),
  /** Commodity id. Doubles as the inventory `resourceId` for purchase→apply. */
  commodityId: z.string().min(1),
  /** Current price in bigint minor units (TDD §10.1), serialized as string. */
  price: z.string(),
  /** Current supply (abstract units — number, not money). */
  supply: z.number(),
  /** Current demand (abstract units — number, not money). */
  demand: z.number(),
  /** Simulation second at which `price` was last recomputed. P3b. */
  lastPriceUpdate: z.number().int().nonnegative().default(0),
  /**
   * P11 (W36 / RV3-4 follow-up): cumulative external demand-injection this
   * tick, in bigint minor units (string). Reset to `'0'` by `clearMarkets`
   * once per tick. The per-tick aggregate cap
   * (`PROVISIONAL_BUSINESS_MARKET_DEMAND_INJECTION_MAX_PER_TICK_MINOR`) limits
   * the TOTAL injection across all same-tick sales to one market — closing
   * the per-call-cap hole where N sales in one tick each re-triggered the cap
   * (N × cap total). Pre-W36 the cap was per-call (`MAX_PER_CALL_MINOR`).
   */
  demandInjectedThisTick: z.string().default('0'),
});
export type MarketState = z.infer<typeof marketStateSchema>;

/**
 * Economy state (TDD §5.7 / §10).
 *
 * All monetary amounts are bigint minor units serialized as string (TDD §10.1).
 *
 * P0 initialized an empty transaction log and a single starting market for the
 * default currency; later phases populate markets and authority policy.
 *
 * P3a additions (TDD §10.3, §10.4):
 *   - `accounts`: explicit account ledger (player:personal + external:default
 *     initially; markets and business accounts added in later phases). The
 *     central monetary authority is virtual — its net position is implied by
 *     `totalIssued - totalSinks`.
 *   - `processedRequestIds`: idempotency set. Every fulfilled or rejected
 *     CurrencyIssuanceRequest has its requestId recorded here so a re-processed
 *     request never double-issues money, even across save/load.
 *   - `totalIssued`: cumulative currency ever issued by the authority
 *     (monotonically non-decreasing).
 *   - `totalSinks`: cumulative currency removed from circulation via explicit
 *     monetary operations (taxes, fees, central-bank interventions) — also
 *     monotonically non-decreasing.
 *
 * Conservation invariant (TDD §10.4 — "money never silently created or
 * destroyed"):
 *
 *   sum(accounts[*].balance) + totalSinks === initialSupply + totalIssued
 *
 * The ledger functions in `packages/simulation/src/economy/ledger.ts` preserve
 * this invariant by construction: issuance credits a destination account
 * without debiting a real one (the authority is virtual), sinks debit a
 * source without crediting a real one, transfers debit + credit real accounts.
 */
export const economyStateSchema = z.object({
  /** Money currently in circulation (sum of all account balances). Stored for
   *  convenience — derived invariant: `monetarySupply === sum(accounts.balance)`.
   *  P3a: bigint minor units as string. */
  monetarySupply: z.string(),
  /**
   * Inflation rate (annualized fraction) — derived from the price index
   * (TDD §10.6). P3b's EconomySystem recomputes this each tick from the
   * basket of market prices vs their base prices. P0–P3a left this at 0;
   * P3b populates it from real price data.
   *
   * The rate is exposed for the UI / future PersonalSystem so the player
   * experiences nominal income growth vs actual purchasing power (GDD §6.3).
   */
  inflationRate: z.number(),
  /**
   * Inflation index — Laspeyres-style basket index of current market prices
   * vs their base prices (TDD §10.6). `1.0` at game start (all prices ==
   * base prices); rises when prices rise. P5's UI divides nominal currency
   * amounts by this index to display "real" purchasing power.
   *
   * P3b addition; backfilled to `1.0` for legacy saves (v5 → v6 migration).
   */
  inflationIndex: z.number().positive().default(1.0),
  interestRate: z.number(),
  monetaryAuthority: monetaryAuthorityStateSchema,
  markets: z.array(marketStateSchema),
  /** P11 (W39 / RV5-F2 follow-up): the transaction log is bounded at parse
   *  time to `PROVISIONAL_ECONOMY_MAX_TRANSACTIONS` (most-recent N kept, via
   *  `slice(-CAP)` — matches the sim's per-tick `capTail` semantics). The sim
   *  already trims on every add, so a legitimate save never exceeds the cap;
   *  this is a defense-in-depth against hand-crafted/corrupt saves that would
   *  otherwise load a multi-thousand-entry array into memory before the next
   *  tick's trim. TRUNCATE (not reject) so legacy pre-W12 saves with >cap
   *  transactions still load (no migration trims them — see v3→v4/v5→v6). */
  transactions: z
    .array(transactionRecordSchema)
    .transform((arr) =>
      arr.length > PROVISIONAL_ECONOMY_MAX_TRANSACTIONS
        ? arr.slice(-PROVISIONAL_ECONOMY_MAX_TRANSACTIONS)
        : arr,
    ),
  /** P3a: explicit account ledger. Player + external participants. The
   *  central monetary authority is virtual (the "mint") — its net position
   *  is implied by `totalIssued - totalSinks`. Defaults to `[]` so older
   *  saves that pre-date P3a parse cleanly (the migration backfills real
   *  values from `player.personalCash`). */
  accounts: z.array(accountStateSchema).default([]),
  /** P3a: idempotency set. Every fulfilled or rejected CurrencyIssuanceRequest
   *  has its requestId recorded here so a re-processed request never
   *  double-issues money, even across save/load (TDD §10.3).
   *  P11 (W39 / RV5-F2 follow-up): bounded at parse time to
   *  `PROVISIONAL_ECONOMY_MAX_PROCESSED_REQUEST_IDS` (most-recent N kept) —
   *  defense-in-depth against corrupt saves. TRUNCATE (not reject) for
   *  backward compat with pre-W12 saves (no migration trims this set). */
  processedRequestIds: z
    .array(z.string())
    .transform((arr) =>
      arr.length > PROVISIONAL_ECONOMY_MAX_PROCESSED_REQUEST_IDS
        ? arr.slice(-PROVISIONAL_ECONOMY_MAX_PROCESSED_REQUEST_IDS)
        : arr,
    )
    .default([]),
  /** P3a: cumulative currency ever issued by the authority (bigint as string).
   *  Monotonically non-decreasing. */
  totalIssued: z.string().default('0'),
  /** P3a: cumulative currency removed from circulation via explicit monetary
   *  operations (taxes, fees, central-bank interventions). Monotonically
   *  non-decreasing. Conservation invariant:
   *  `sum(accounts.balance) + totalSinks === initialSupply + totalIssued`. */
  totalSinks: z.string().default('0'),
  /**
   * P11 (W14 / RV3-3): the money supply at game start — the starting
   * `monetarySupply` set from `config.startingPersonalCash` at initialization.
   * Persisted so `conservationDiscrepancy()` is computable on a LOADED save
   * (the caller no longer needs the original config) and so non-default starts
   * compute correct monetary-conditions (the market `monetaryConditionsFactor`
   * divides `monetarySupply / initialSupply`).
   *
   * Pre-v14 saves did not persist this; the v13→v14 migration backfills it
   * from the conservation invariant
   * `initialSupply = sum(accounts.balance) + totalSinks - totalIssued` (exact
   * for any conservation-correct save) and falls back to the default
   * `'50000'` when the ledger is absent/empty. Defaults to `'50000'` so
   * hand-built/legacy states parse cleanly.
   */
  initialSupply: z.string().default('50000'),
});
export type EconomyState = z.infer<typeof economyStateSchema>;
