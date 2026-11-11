/**
 * Typed errors for the economy module (TDD §10.4).
 *
 * Each error is a real `class` so callers can use `instanceof` for routing
 * (e.g. surface "insufficient funds" to the player without crashing the
 * engine). The EconomySystem and action handlers (P3c) catch these and emit
 * `issuance-rejected` or `notification` events instead of propagating.
 *
 * The errors are NOT part of the saved GameState — they are runtime-only
 * signals. The EconomySystem's per-tick drain never throws: rejections are
 * converted into `issuance-rejected` events so the simulation continues.
 * Direct callers of the ledger (P3c actions, future markets) MAY propagate
 * these to the action layer.
 */

/** Source account balance is less than the transfer amount. */
export class InsufficientFundsError extends Error {
  readonly accountId: string;
  readonly needed: string;
  readonly available: string;

  constructor(accountId: string, needed: string, available: string) {
    super(
      `Insufficient funds on account "${accountId}": needed ${needed}, available ${available}.`,
    );
    this.name = 'InsufficientFundsError';
    this.accountId = accountId;
    this.needed = needed;
    this.available = available;
  }
}

/** Referenced account id does not exist in `economy.accounts`.
 *  The virtual authority account (`PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID`)
 *  is NOT subject to this error — it is always allowed as a source
 *  (issuance) or destination (sink). */
export class UnknownAccountError extends Error {
  readonly accountId: string;

  constructor(accountId: string) {
    super(
      `Unknown account "${accountId}". Register the account in economy.accounts before transacting.`,
    );
    this.name = 'UnknownAccountError';
    this.accountId = accountId;
  }
}

/** Transfer amount failed validation: not a bigint string, <= 0, or malformed. */
export class InvalidAmountError extends Error {
  readonly amount: string;
  readonly reason: string;

  constructor(amount: string, reason: string) {
    super(`Invalid amount "${amount}": ${reason}.`);
    this.name = 'InvalidAmountError';
    this.amount = amount;
    this.reason = reason;
  }
}

/** A requestId was already processed (idempotency violation).
 *  Thrown when a caller explicitly tries to re-process a requestId via the
 *  ledger API. The EconomySystem's per-tick drain does NOT throw this — it
 *  emits `issuance-rejected` instead. */
export class DuplicateRequestIdError extends Error {
  readonly requestId: string;

  constructor(requestId: string) {
    super(`Duplicate requestId "${requestId}" — already processed.`);
    this.name = 'DuplicateRequestIdError';
    this.requestId = requestId;
  }
}

/** Source and destination accounts must differ for a real transfer. */
export class SelfTransferError extends Error {
  readonly accountId: string;

  constructor(accountId: string) {
    super(
      `Self-transfer rejected for account "${accountId}": source and destination must differ. (Use recordTransaction for no-op audit entries.)`,
    );
    this.name = 'SelfTransferError';
    this.accountId = accountId;
  }
}
