/**
 * Error → notification mapping (P5d — GDD §13.5; extracted W44 / Finding 1).
 *
 * Pure function mapping a typed engine error to a UI notification payload
 * (minus the client-generated `id` + `createdAtMs` — those are added by
 * `pushNotification`). Returns `null` for unknown error classes so the caller
 * knows to re-throw.
 *
 * W44 (Finding 1): this mapping was previously defined inline in
 * `lib/dispatch-wrapper.ts` + consumed only by the unwired `safeDispatch`
 * wrapper (dead code — no production caller). W44 wires the mapping into the
 * store's `dispatch` mutator itself (`stores/game-store.ts`) so ALL action
 * paths surface typed errors as notifications. The mapping was extracted to
 * this file so `game-store.ts` can import it without a circular dependency
 * (`dispatch-wrapper.ts` imports `useGameStore` from the store; importing the
 * mapping back into the store would cycle). This file has NO runtime store
 * dependency — only a type-only import of `UiNotification`.
 *
 * Mapping (typed error → notification code + severity):
 *
 *   - `InsufficientFundsError`  → `'low-funds'`         `'warning'`
 *   - `UnknownAccountError`     → `'low-funds'`         `'critical'`
 *   - `UnknownMarketError`      → `'unknown-market'`    `'warning'`
 *   - `InvalidAmountError`      → `'invalid-amount'`    `'info'`
 *   - `DuplicateRequestIdError` → `'duplicate-request'` `'info'`
 *   - `SelfTransferError`       → `'self-transfer'`     `'info'`
 *   - `UnknownActionError`      → `'unknown-action'`    `'critical'`
 *   - `SimulationInvariantError`→ `'invariant'`         `'critical'`
 *   - `OriginalTreeNotTransferableError` → `'original-tree-protected'` `'warning'`
 *   - `TreeSaleNotImplementedError` → `'tree-sale-not-implemented'` `'info'`
 *   - `UnknownSchemaVersionError` / `SaveValidationError` → `'save-corrupt'` `'critical'`
 *   - `OfflineClockTamperedError` → `'offline-clock-tampered'` `'critical'`
 *
 * Any other `Error` (not in the typed-error union) — returns `null` so the
 * caller re-throws. The engine's typed errors are its *expected* failure
 * modes; everything else is a programming bug + must surface as an unhandled
 * rejection (caught by tests + error-monitoring), NOT be swallowed.
 */
import type { GameAction, SimulationEvent } from '@capitalist-tree/shared';
import {
  OfflineClockTamperedError,
  OriginalTreeNotTransferableError,
  SaveValidationError,
  SimulationInvariantError,
  TreeSaleNotImplementedError,
  UnknownActionError,
  UnknownSchemaVersionError,
} from '@capitalist-tree/shared';
import {
  DuplicateRequestIdError,
  InsufficientFundsError,
  InvalidAmountError,
  SelfTransferError,
  UnknownAccountError,
  UnknownMarketError,
} from '@capitalist-tree/simulation';
import type { UiNotification } from '../../stores/game-store';

// `GameAction` + `SimulationEvent` are re-exported from this module's type
// surface so `dispatch-wrapper.ts` (which re-exports `errorToNotification`)
// can trim its own imports — but they are not used by the mapping itself.
// Kept here only to keep the type re-export stable for downstream callers.
export type { GameAction, SimulationEvent };

/**
 * Map a typed engine error to a UI notification payload (minus the
 * client-generated `id` + `createdAtMs` — those are added by
 * `pushNotification`). Returns `null` for unknown error classes so the
 * caller knows to re-throw.
 *
 * Pure: given an Error instance + `at` (sim-clock seconds), returns a
 * deterministic payload object (or null). No side effects.
 *
 * The `at` field is read from the current `simState.clock.elapsedSeconds`
 * by the caller (this function doesn't reach into the store — it stays
 * pure). When the caller doesn't have a simState (e.g. the store hasn't
 * booted), `at` defaults to 0.
 */
export function errorToNotification(
  err: unknown,
  at: number,
): Omit<UiNotification, 'id' | 'createdAtMs'> | null {
  if (err instanceof InsufficientFundsError) {
    return {
      severity: 'warning',
      code: 'low-funds',
      message: `Insufficient funds: needed ${err.needed}, available ${err.available}.`,
      at,
    };
  }
  if (err instanceof UnknownAccountError) {
    return {
      severity: 'critical',
      code: 'low-funds',
      message: `Unknown account "${err.accountId}" — the funds target is missing.`,
      at,
    };
  }
  if (err instanceof UnknownMarketError) {
    return {
      severity: 'warning',
      code: 'unknown-market',
      message: `Unknown market "${err.marketId}".`,
      at,
    };
  }
  if (err instanceof InvalidAmountError) {
    return {
      severity: 'info',
      code: 'invalid-amount',
      message: `Invalid amount "${err.amount}": ${err.reason}.`,
      at,
    };
  }
  if (err instanceof DuplicateRequestIdError) {
    return {
      severity: 'info',
      code: 'duplicate-request',
      message: `Duplicate request "${err.requestId}" — already processed.`,
      at,
    };
  }
  if (err instanceof SelfTransferError) {
    return {
      severity: 'info',
      code: 'self-transfer',
      message: `Self-transfer rejected for account "${err.accountId}".`,
      at,
    };
  }
  if (err instanceof UnknownActionError) {
    return {
      severity: 'critical',
      code: 'unknown-action',
      message: `Unknown action type "${err.actionType}".`,
      at,
    };
  }
  if (err instanceof SimulationInvariantError) {
    return {
      severity: 'critical',
      code: 'invariant',
      message: err.message,
      at,
    };
  }
  if (err instanceof OriginalTreeNotTransferableError) {
    return {
      severity: 'warning',
      code: 'original-tree-protected',
      message: `The original tree ("${err.treeId}") cannot be sold or transferred.`,
      at,
    };
  }
  if (err instanceof TreeSaleNotImplementedError) {
    return {
      severity: 'info',
      code: 'tree-sale-not-implemented',
      message: `Selling tree "${err.treeId}" is not implemented yet (P3c).`,
      at,
    };
  }
  if (err instanceof UnknownSchemaVersionError || err instanceof SaveValidationError) {
    return {
      severity: 'critical',
      code: 'save-corrupt',
      message: err.message,
      at,
    };
  }
  if (err instanceof OfflineClockTamperedError) {
    return {
      severity: 'critical',
      code: 'offline-clock-tampered',
      message:
        `Your system clock moved backwards by ${err.backwardsMs} ms while you ` +
        `were away. Offline catch-up was refused to avoid corrupting your ` +
        `game — your save is intact. (GDD §4.2, TDD §14.4)`,
      at,
    };
  }
  // Unknown error class — return null so the caller re-throws. The wrapper
  // does NOT swallow unexpected errors; a programming bug should still
  // surface as an unhandled rejection.
  return null;
}
