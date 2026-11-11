import { z } from 'zod';
import { transactionRecordSchema } from './economy.js';
import { LIVING_EXPENSE_CATEGORIES } from './player.js';

/**
 * Economy-related SimulationEvent variants (P3a/P3b/P3c — TDD §10.3, §10.4, §10.5,
 * GDD §6.2, §7.1, §8.5).
 *
 * Added to the `SimulationEvent` discriminated union via
 * `packages/shared/src/schemas/events.ts`. P3a introduced:
 *
 *   - `transaction-recorded`: emitted by EconomySystem (or any system that
 *     moves money) whenever a TransactionRecord is appended to the ledger.
 *     Carries the full record so UI / audit consumers can display it without
 *     reaching into state.
 *   - `issuance-authorized`: emitted when a CurrencyIssuanceRequest is
 *     fulfilled by the monetary authority. Carries the requestId, amount, and
 *     destination account. P1's `harvest-completed` event carries the request;
 *     P3a's `issuance-authorized` confirms the fulfilment.
 *   - `issuance-rejected`: emitted when the authority refuses to issue
 *     (duplicate requestId, policy limit, invalid amount, etc.). Carries the
 *     requestId and a short machine-readable `reason` code.
 *
 * P3b added `purchase-completed` and `market-price-changed`.
 *
 * P3c adds:
 *   - `expense-due`: emitted by the PersonalSystem when a recurring bill comes
 *     due (auto-paid or unpaid), and by the `pay-expense` action handler
 *     (manual pay). Carries the category, amount, paid flag, unpaid-day
 *     counter after, and the player's resulting balance.
 *   - `transfer-completed`: emitted by the `transfer` action handler. Carries
 *     the source/destination accounts, amount, transaction id, and the
 *     source's resulting balance.
 *
 * HOW TO EXTEND: add a new variant with a unique `type` literal. Do NOT
 * loosen the union with a catch-all.
 */

/**
 * `transaction-recorded` event — emitted whenever a TransactionRecord is
 * appended to `economy.transactions`. Carries the full record.
 */
export const transactionRecordedEventSchema = z.object({
  type: z.literal('transaction-recorded'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    record: transactionRecordSchema,
  }),
});
export type TransactionRecordedEvent = z.infer<typeof transactionRecordedEventSchema>;

/**
 * `issuance-authorized` event — emitted by EconomySystem when a
 * CurrencyIssuanceRequest is fulfilled. Pairs with P1's `harvest-completed`
 * event: the harvest produced the request, the issuance fulfils it.
 */
export const issuanceAuthorizedEventSchema = z.object({
  type: z.literal('issuance-authorized'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    /** Deterministic requestId (derived from saveId + simSecond + queue index). */
    requestId: z.string().min(1),
    /** Tree whose harvested leaves produced this issuance. */
    treeId: z.string().min(1),
    /** Account credited (usually `player:personal`). */
    destinationAccount: z.string().min(1),
    /** Amount issued, in bigint minor units as string. */
    amount: z.string(),
    /** Currency id (matches `economy.markets[*].commodityId`). */
    currencyId: z.string().min(1),
    /** Reason for issuance (e.g. `'harvest-leaves'`). */
    source: z.string().min(1),
  }),
});
export type IssuanceAuthorizedEvent = z.infer<typeof issuanceAuthorizedEventSchema>;

/**
 * `issuance-rejected` event — emitted by EconomySystem when the monetary
 * authority refuses to fulfil a CurrencyIssuanceRequest. The reason code is
 * machine-readable; the message is human-readable for UI display.
 *
 * Reason codes (P3a):
 *   - `duplicate-request`: requestId already in `processedRequestIds`
 *     (defensive idempotency — the same pendingIssuance was processed before
 *     a save/load and is being re-processed).
 *   - `invalid-amount`: amount is not a valid positive bigint string.
 *   - `per-request-limit-exceeded`: amount exceeds the policy's `maxPerRequest`.
 *   - `cumulative-limit-exceeded`: total issued would exceed the policy's
 *     `maxTotal`.
 */
export const issuanceRejectedEventSchema = z.object({
  type: z.literal('issuance-rejected'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    requestId: z.string().min(1),
    treeId: z.string().min(1),
    amount: z.string(),
    currencyId: z.string().min(1),
    source: z.string().min(1),
    /** Short machine code: `'duplicate-request' | 'invalid-amount' | ...` */
    reason: z.string().min(1),
    /** Human-readable message for the UI. */
    message: z.string().min(1),
  }),
});
export type IssuanceRejectedEvent = z.infer<typeof issuanceRejectedEventSchema>;

/**
 * `purchase-completed` event — emitted by the `purchase` action handler
 * (P3b — TDD §10.5, §10.6, GDD §8.5). Carries the full result: marketId,
 * commodityId, quantity, unit price (minor currency units), total cost,
 * the resulting transaction id, the player's resulting cash balance, and
 * the market's post-purchase supply/demand snapshot.
 *
 * Pure data — the handler in `packages/simulation/src/actions/handlers.ts`
 * builds this from the new state + the action params.
 */
export const purchaseCompletedEventSchema = z.object({
  type: z.literal('purchase-completed'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    /** Market the purchase was made at. */
    marketId: z.string().min(1),
    /** Commodity id (= inventory `resourceId` credited). */
    commodityId: z.string().min(1),
    /** Units purchased (>= 1). */
    quantity: z.number().int().positive(),
    /** Unit price at the moment of purchase (bigint minor units as string). */
    unitPrice: z.string(),
    /** Total cost = unitPrice * quantity (bigint minor units as string). */
    totalCost: z.string(),
    /** Transaction id (deterministic — derived from timestamp + ledger length). */
    transactionId: z.string().min(1),
    /** Player's resulting cash balance (after debit). Mirrored to
     *  `player.personalCash` by the handler. */
    playerBalanceAfter: z.string(),
    /** Market snapshot after the purchase (supply, demand, new price if shifted). */
    marketAfter: z.object({
      id: z.string().min(1),
      price: z.string(),
      supply: z.number(),
      demand: z.number(),
    }),
  }),
});
export type PurchaseCompletedEvent = z.infer<typeof purchaseCompletedEventSchema>;

/**
 * `market-price-changed` event — emitted by the EconomySystem when a
 * market's price moves between ticks (P3b — TDD §10.6). Carries the old and
 * new price + the supply/demand snapshot used to compute the new price.
 *
 * Only emitted when `newPrice !== oldPrice` (no event for unchanged
 * markets). The `inflationIndexAfter` field lets the UI display the
 * derived basket index alongside the per-market move.
 */
export const marketPriceChangedEventSchema = z.object({
  type: z.literal('market-price-changed'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    marketId: z.string().min(1),
    commodityId: z.string().min(1),
    /** Price before this tick's update (bigint minor units as string). */
    oldPrice: z.string(),
    /** Price after this tick's update. */
    newPrice: z.string(),
    /** Supply at the time of the price update. */
    supply: z.number(),
    /** Demand at the time of the price update. */
    demand: z.number(),
    /** Derived inflation index after this tick's price updates (basket index). */
    inflationIndexAfter: z.number(),
  }),
});
export type MarketPriceChangedEvent = z.infer<typeof marketPriceChangedEventSchema>;

/**
 * `expense-due` event — emitted by the PersonalSystem (when a recurring bill
 * fires, auto-paid or unpaid) and by the `pay-expense` action handler
 * (manual pay). Carries the category, the attempted amount, whether the bill
 * was actually paid, the unpaid-day counter after, and the player's resulting
 * balance.
 *
 * The PersonalSystem emits one `expense-due` event per category at each bill
 * cycle. When `paid === true`, the event is paired with a
 * `transaction-recorded` event carrying the corresponding `expense` sink
 * transaction (player:personal → authority). When `paid === false`, no
 * transaction is recorded (no money moved); the `unpaidDaysAfter` counter on
 * the event reflects the increment applied to `player.unpaidDays`. The
 * PersonalSystem's per-tick well-being derivation translates that counter
 * into a physical-health penalty (GDD §7.2, §7.3).
 *
 * The `source` field discriminates whether the bill was auto-paid (the
 * PersonalSystem's scheduled `bill-due` event fired) or manually paid (the
 * `pay-expense` action handler). Both produce the same shape; the source is
 * for audit/UI.
 *
 * P3c addition (TDD §18.1, GDD §7.1, §7.2).
 */
export const expenseDueEventSchema = z.object({
  type: z.literal('expense-due'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    /** Living-expense category (GDD §7.1). */
    category: z.enum(LIVING_EXPENSE_CATEGORIES),
    /** Amount that was due (bigint minor units as string). */
    amount: z.string(),
    /** Whether the bill was actually paid (true) or recorded as unpaid
     *  (false — insufficient funds). */
    paid: z.boolean(),
    /** `'auto-bill'` when the PersonalSystem's scheduled bill fired;
     *  `'pay-expense'` when the player manually paid via the action. */
    source: z.enum(['auto-bill', 'pay-expense']),
    /** Player's cash balance after the operation. If `paid` is false, this
     *  equals the pre-event balance (no money moved). */
    playerBalanceAfter: z.string(),
    /** `player.unpaidDays` after the operation. Mirrors the state field so
     *  consumers can read the counter from the event without reaching into
     *  state. */
    unpaidDaysAfter: z.number().int().nonnegative(),
    /** When `paid === true`, the transaction id of the corresponding
     *  `expense` sink transaction. Absent when `paid === false`. */
    transactionId: z.string().min(1).optional(),
  }),
});
export type ExpenseDueEvent = z.infer<typeof expenseDueEventSchema>;

/**
 * `transfer-completed` event — emitted by the `transfer` action handler
 * (P3c — TDD §10.5, GDD §8.1). Carries the source/destination accounts, the
 * amount moved, the resulting transaction id, and the source's resulting
 * balance. Pairs with the `transaction-recorded` event emitted by the
 * underlying `transfer()` call.
 *
 * Pure data — the handler builds this from the new state + the action params.
 * No state mutation beyond what `transfer()` already did.
 */
export const transferCompletedEventSchema = z.object({
  type: z.literal('transfer-completed'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    /** Source account id (debited). */
    sourceAccount: z.string().min(1),
    /** Destination account id (credited). */
    destinationAccount: z.string().min(1),
    /** Amount moved (bigint minor units as string). */
    amount: z.string(),
    /** Transaction id (deterministic — derived from timestamp + ledger length). */
    transactionId: z.string().min(1),
    /** Source's resulting cash balance (after debit). Mirrored to
     *  `player.personalCash` when the source was `player:personal`. */
    sourceBalanceAfter: z.string(),
  }),
});
export type TransferCompletedEvent = z.infer<typeof transferCompletedEventSchema>;
