/**
 * Ledger + transaction system (TDD §10.4).
 *
 * Pure functions for:
 *   - Looking up accounts and balances (by id, including the virtual
 *     authority).
 *   - Validating amounts (positive bigint-as-string).
 *   - Transferring money between accounts atomically — validating source
 *     balance, destination existence, amount > 0, bigint. Either both
 *     updates apply or neither.
 *   - Recording transactions in the ledger.
 *   - Idempotency: tracking processed requestIds so the same issuance never
 *     double-processes, even across save/load.
 *
 * Money NEVER silently created or destroyed (TDD §10.4 — "money never
 * silently created or destroyed"). The three money-movement operations are:
 *
 *   - **Issuance**: `sourceAccount = PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID`
 *     (virtual; no balance touched). Credits a real destination, increments
 *     `monetarySupply` and `totalIssued`. The authority is the "mint".
 *   - **Sink**: `destinationAccount = authority`. Debits a real source,
 *     decrements `monetarySupply`, increments `totalSinks`. Used for taxes,
 *     fees, central-bank interventions (TDD §10.4 — "explicit monetary
 *     operations").
 *   - **Transfer**: both accounts real. Debits source, credits destination.
 *     `monetarySupply` unchanged.
 *
 * Conservation invariant (TDD §10.4): for a state with `initialSupply` set
 * at game start (the player's starting cash, treated as pre-existing money),
 * `totalIssued` (cumulative authority issuance), and `totalSinks` (cumulative
 * explicit destruction):
 *
 *   sum(account.balance for account in accounts) + totalSinks
 *     === initialSupply + totalIssued
 *
 * i.e. all money currently held by some account + all money explicitly
 * destroyed === money that was originally there + money the authority has
 * issued. The ledger functions below preserve this invariant by
 * construction — see `conservationDiscrepancy()` for the verifier.
 */
import type {
  AccountState,
  GameState,
  TransactionRecord,
} from '@capitalist-tree/shared';
import { PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID } from '@capitalist-tree/shared';
import {
  InsufficientFundsError,
  InvalidAmountError,
  SelfTransferError,
  UnknownAccountError,
} from './errors.js';

/**
 * Parse a bigint-as-string field safely. Throws InvalidAmountError if the
 * string is empty or not a valid bigint literal. Negative values are
 * permitted (the conservation invariant allows negative balances in theory,
 * though the ledger functions never produce them on real accounts).
 */
export function parseAmount(amount: string, field = 'amount'): bigint {
  if (typeof amount !== 'string' || amount.length === 0) {
    throw new InvalidAmountError(
      String(amount),
      `${field} must be a non-empty bigint string`,
    );
  }
  try {
    return BigInt(amount);
  } catch {
    throw new InvalidAmountError(
      String(amount),
      `${field} is not a valid bigint string`,
    );
  }
}

/** Is `accountId` the virtual authority? */
export function isAuthorityAccount(accountId: string): boolean {
  return accountId === PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID;
}

/** Find an account by id in `state.economy.accounts`. Returns undefined if
 *  not found. The virtual authority is NOT in the array — use
 *  `isAuthorityAccount()` to check. */
export function findAccount(
  state: GameState,
  accountId: string,
): AccountState | undefined {
  return state.economy.accounts.find((a) => a.id === accountId);
}

/** Get an account by id. Throws UnknownAccountError if not found.
 *  The virtual authority account id always throws (it has no balance
 *  entry — use `getBalance()` which returns 0n for the authority, or
 *  `isAuthorityAccount()` to short-circuit before calling this). */
export function getAccount(state: GameState, accountId: string): AccountState {
  if (isAuthorityAccount(accountId)) {
    throw new UnknownAccountError(accountId);
  }
  const acc = findAccount(state, accountId);
  if (!acc) {
    throw new UnknownAccountError(accountId);
  }
  return acc;
}

/** Read an account's balance as bigint. The virtual authority returns 0n
 *  (it has no balance entry — its net position is implied by
 *  `totalIssued - totalSinks`). Real accounts return their stored balance. */
export function getBalance(state: GameState, accountId: string): bigint {
  if (isAuthorityAccount(accountId)) {
    return 0n;
  }
  const acc = findAccount(state, accountId);
  if (!acc) {
    throw new UnknownAccountError(accountId);
  }
  return parseAmount(acc.balance, 'balance');
}

/** Sum of all account balances (excludes the virtual authority). */
export function sumBalances(state: GameState): bigint {
  return state.economy.accounts.reduce(
    (sum, a) => sum + parseAmount(a.balance, 'balance'),
    0n,
  );
}

/**
 * Compute the conservation invariant discrepancy.
 *
 * Returns `0n` if the invariant holds:
 *
 *   sum(account.balance) + totalSinks === initialSupply + totalIssued
 *
 * A non-zero return indicates a bug — money was created or destroyed
 * silently. The ledger functions preserve this by construction; this
 * verifier is for tests + assertions.
 *
 * `initialSupply` is the player's starting cash — set at game start in
 * `initializeState()` and carried in tests. It is NOT persisted on the state
 * (the conservation invariant treats it as a constant for a given save).
 */
export function conservationDiscrepancy(
  state: GameState,
  initialSupply: string,
): bigint {
  const balances = sumBalances(state);
  const sinks = parseAmount(state.economy.totalSinks, 'totalSinks');
  const issued = parseAmount(state.economy.totalIssued, 'totalIssued');
  const initial = parseAmount(initialSupply, 'initialSupply');
  return balances + sinks - initial - issued;
}

/** Has a requestId been processed already (idempotency check)? */
export function isRequestProcessed(state: GameState, requestId: string): boolean {
  return state.economy.processedRequestIds.includes(requestId);
}

/** Return a new state with `requestId` added to `processedRequestIds`
 *  (idempotency set). If already present, returns state unchanged. */
export function markRequestProcessed(
  state: GameState,
  requestId: string,
): GameState {
  if (isRequestProcessed(state, requestId)) {
    return state;
  }
  return {
    ...state,
    economy: {
      ...state.economy,
      processedRequestIds: [...state.economy.processedRequestIds, requestId],
    },
  };
}

/** Validate a transaction's amount: must be a valid bigint > 0.
 *  Returns the parsed bigint on success. */
export function validateAmount(amount: string): bigint {
  const v = parseAmount(amount);
  if (v <= 0n) {
    throw new InvalidAmountError(amount, 'amount must be > 0');
  }
  return v;
}

/** Allocate a deterministic transaction id. Given (timestamp, counter)
 *  the id is stable across runs (TDD §18.3 — determinism). */
export function transactionId(timestamp: number, counter: number): string {
  return `txn:${timestamp}:${counter}`;
}

export interface TransferParams {
  /** Source account id. `PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID` is the
   *  virtual "mint" (issuance). */
  sourceAccount: string;
  /** Destination account id. `authority` is the virtual sink. */
  destinationAccount: string;
  /** Amount in bigint minor units (TDD §10.1), as string. */
  amount: string;
  /** Short machine code: 'issuance' | 'sink' | 'transfer' | 'purchase' | ... */
  category: string;
  /** Human-readable description for the audit trail / UI. */
  description: string;
  /** Simulation second at which the transfer occurs. */
  timestamp: number;
  /** Optional idempotency key — if set, the transaction is tagged with it
   *  AND the requestId is added to `processedRequestIds`. */
  requestId?: string;
  /** Transaction id. If omitted, derived from timestamp + the new
   *  transactions array length (deterministic). */
  id?: string;
}

/** Internal: apply a transfer to the accounts array (debit source,
 *  credit destination). The virtual authority is never in `accounts`, so
 *  no entry is touched for it. Validates sufficient funds on real sources.
 *  Does NOT record the transaction — the caller does that. */
function applyTransferToAccounts(
  accounts: readonly AccountState[],
  sourceAccount: string,
  destinationAccount: string,
  amount: bigint,
): AccountState[] {
  const sourceIsAuthority = isAuthorityAccount(sourceAccount);
  const destIsAuthority = isAuthorityAccount(destinationAccount);
  return accounts.map((a) => {
    if (a.id === sourceAccount) {
      // Source debits. Authority is virtual — this branch is never hit
      // when source === authority (the account doesn't exist in `accounts`).
      if (sourceIsAuthority) {
        // Defensive: should be unreachable because the authority has no
        // entry. Skip.
        return a;
      }
      const current = parseAmount(a.balance, 'balance');
      const newBalance = current - amount;
      if (newBalance < 0n) {
        throw new InsufficientFundsError(a.id, amount.toString(10), a.balance);
      }
      return { ...a, balance: newBalance.toString(10) };
    }
    if (a.id === destinationAccount) {
      if (destIsAuthority) {
        // Defensive: should be unreachable.
        return a;
      }
      const current = parseAmount(a.balance, 'balance');
      const newBalance = current + amount;
      return { ...a, balance: newBalance.toString(10) };
    }
    return a;
  });
}

/**
 * Apply a transfer between two accounts, recording a TransactionRecord.
 *
 * For issuance: `sourceAccount = PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID`
 * (virtual; balance not touched). For sinks: `destinationAccount = authority`.
 * For regular transfers: both accounts must exist in `economy.accounts`.
 *
 * Validates: amount > 0 (bigint), source has sufficient balance (if real),
 * destination exists (if real), source != destination. Atomic — either both
 * updates apply or neither (throws on validation failure, state untouched).
 *
 * If `params.requestId` is set, the transaction is tagged with it AND the
 * requestId is added to `processedRequestIds` (idempotency).
 *
 * Returns the new state. Throws on validation failure.
 */
export function transfer(state: GameState, params: TransferParams): GameState {
  const amount = validateAmount(params.amount);

  if (params.sourceAccount === params.destinationAccount) {
    throw new SelfTransferError(params.sourceAccount);
  }

  const sourceIsAuthority = isAuthorityAccount(params.sourceAccount);
  const destIsAuthority = isAuthorityAccount(params.destinationAccount);

  // Validate account existence (authority is virtual — exempt).
  if (!sourceIsAuthority) {
    getAccount(state, params.sourceAccount); // throws if not found
  }
  if (!destIsAuthority) {
    getAccount(state, params.destinationAccount); // throws if not found
  }

  // Apply the transfer to the accounts array.
  const newAccounts = applyTransferToAccounts(
    state.economy.accounts,
    params.sourceAccount,
    params.destinationAccount,
    amount,
  );

  // Update money supply + cumulative counters:
  //  - issuance (source = authority, dest = real): supply += amount, totalIssued += amount
  //  - sink (source = real, dest = authority): supply -= amount, totalSinks += amount
  //  - transfer (both real): supply unchanged, counters unchanged
  let newSupply = parseAmount(state.economy.monetarySupply, 'monetarySupply');
  let newTotalIssued = parseAmount(state.economy.totalIssued, 'totalIssued');
  let newTotalSinks = parseAmount(state.economy.totalSinks, 'totalSinks');

  if (sourceIsAuthority && !destIsAuthority) {
    newSupply += amount;
    newTotalIssued += amount;
  } else if (!sourceIsAuthority && destIsAuthority) {
    newSupply -= amount;
    newTotalSinks += amount;
  }

  // Build the TransactionRecord.
  const id =
    params.id ?? transactionId(params.timestamp, state.economy.transactions.length);
  const record: TransactionRecord = {
    id,
    timestamp: params.timestamp,
    sourceAccount: params.sourceAccount,
    destinationAccount: params.destinationAccount,
    amount: amount.toString(10),
    category: params.category,
    description: params.description,
  };
  if (params.requestId !== undefined) {
    record.requestId = params.requestId;
  }

  let next: GameState = {
    ...state,
    economy: {
      ...state.economy,
      accounts: newAccounts,
      transactions: [...state.economy.transactions, record],
      monetarySupply: newSupply.toString(10),
      totalIssued: newTotalIssued.toString(10),
      totalSinks: newTotalSinks.toString(10),
    },
  };

  if (params.requestId !== undefined) {
    next = markRequestProcessed(next, params.requestId);
  }

  return next;
}

/**
 * Record a TransactionRecord WITHOUT moving money. Used by callers that
 * have already adjusted balances via a different path and just need the
 * audit entry. Rarely needed — prefer `transfer()`.
 */
export function recordTransaction(
  state: GameState,
  record: TransactionRecord,
): GameState {
  return {
    ...state,
    economy: {
      ...state.economy,
      transactions: [...state.economy.transactions, record],
    },
  };
}

/**
 * Add an account to the ledger. Returns a new state with the account
 * appended. Throws if an account with the same id already exists.
 * P3b/P3c will use this to register market + business accounts.
 */
export function registerAccount(
  state: GameState,
  account: AccountState,
): GameState {
  if (findAccount(state, account.id)) {
    throw new UnknownAccountError(account.id); // already exists
  }
  // Validate the balance parses — defensive; the schema enforces string.
  parseAmount(account.balance, 'balance');
  return {
    ...state,
    economy: {
      ...state.economy,
      accounts: [...state.economy.accounts, account],
    },
  };
}
