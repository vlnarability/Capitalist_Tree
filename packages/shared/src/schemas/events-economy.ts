import { z } from 'zod';
import { transactionRecordSchema } from './economy.js';

/**
 * Economy-related SimulationEvent variants (P3a — TDD §10.3, §10.4, GDD §6.2).
 *
 * Added to the `SimulationEvent` discriminated union via
 * `packages/shared/src/schemas/events.ts`. P3a introduces:
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
