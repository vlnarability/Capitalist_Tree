import { z } from 'zod';

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
  transactions: z.array(transactionRecordSchema),
  /** P3a: explicit account ledger. Player + external participants. The
   *  central monetary authority is virtual (the "mint") — its net position
   *  is implied by `totalIssued - totalSinks`. Defaults to `[]` so older
   *  saves that pre-date P3a parse cleanly (the migration backfills real
   *  values from `player.personalCash`). */
  accounts: z.array(accountStateSchema).default([]),
  /** P3a: idempotency set. Every fulfilled or rejected CurrencyIssuanceRequest
   *  has its requestId recorded here so a re-processed request never
   *  double-issues money, even across save/load (TDD §10.3). */
  processedRequestIds: z.array(z.string()).default([]),
  /** P3a: cumulative currency ever issued by the authority (bigint as string).
   *  Monotonically non-decreasing. */
  totalIssued: z.string().default('0'),
  /** P3a: cumulative currency removed from circulation via explicit monetary
   *  operations (taxes, fees, central-bank interventions). Monotonically
   *  non-decreasing. Conservation invariant:
   *  `sum(accounts.balance) + totalSinks === initialSupply + totalIssued`. */
  totalSinks: z.string().default('0'),
});
export type EconomyState = z.infer<typeof economyStateSchema>;
