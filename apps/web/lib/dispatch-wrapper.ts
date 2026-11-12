/**
 * Dispatch wrapper — typed-error → notification bridge (P5d — GDD §13.5).
 *
 * Wraps the store's `dispatch(action)` so typed engine errors are
 * auto-converted into `pushNotification` calls instead of propagating to
 * the console. The canonical use case (from the task brief):
 *
 *     "purchase with insufficient funds shows a notification instead of
 *      throwing to the console."
 *
 * The store's `dispatch` is deliberately low-level: it calls
 * `engine.executeAction(state, action)` and lets errors propagate (P5a's
 * design — the caller is expected to handle typed errors). That contract is
 * correct for the engine boundary, but ergonomic for UI code: a click
 * handler in `PurchaseControls` would otherwise have to `try`/`catch`
 * around every `dispatch(purchase(...))` call, and a missed catch would
 * log an unhandled rejection. This wrapper centralizes the catch + UI
 * surface at the boundary between UI components and the store.
 *
 * Mapping (typed error → notification code + severity):
 *
 *   - `InsufficientFundsError`  → code `'low-funds'`  severity `'warning'`
 *     (actionable — the player can sell / wait / harvest to recover funds).
 *   - `UnknownAccountError`     → code `'low-funds'`  severity `'critical'`
 *     (rare; routed under the same actionable bucket — a missing account
 *     is a "can't transact" failure mode and the player needs to know).
 *   - `UnknownMarketError`      → code `'unknown-market'` severity `'warning'`
 *     (filtered out by the panel — non-actionable; surfaced for debugging).
 *   - `InvalidAmountError`      → code `'invalid-amount'`  severity `'info'`
 *     (filtered out — bug in the UI factory layer).
 *   - `DuplicateRequestIdError` → code `'duplicate-request'` severity `'info'`
 *     (filtered out — idempotency replay).
 *   - `SelfTransferError`       → code `'self-transfer'`   severity `'info'`
 *     (filtered out — bug in the action factory).
 *   - `UnknownActionError`      → code `'unknown-action'`  severity `'critical'`
 *     (filtered out — bug; would indicate a stale action factory).
 *   - `SimulationInvariantError` → code `'invariant'` severity `'critical'`
 *     (filtered out — bug; the engine refuses to proceed).
 *   - `OriginalTreeNotTransferableError` → code `'original-tree-protected'`
 *     severity `'warning'` (filtered out — GDD §16.1/§16.2 guard; the
 *     `sell-tree` action handler raises this for the original tree).
 *   - `TreeSaleNotImplementedError` → code `'tree-sale-not-implemented'`
 *     severity `'info'` (filtered out — P3c stub).
 *   - `UnknownSchemaVersionError` / `SaveValidationError` → code `'save-corrupt'`
 *     severity `'critical'` (filtered out — surfaced at save/load time,
 *     not via dispatch).
 *   - `OfflineClockTamperedError` (P6a/P6d2) → code `'offline-clock-tampered'`
 *     severity `'critical'` — a clock rollback beyond the catch-up tolerance.
 *     Surfaced as a "your clock changed — refusing to catch up" toast by the
 *     catch-up-on-load trigger (`lib/persistence/offline-catch-up-trigger.ts`)
 *     rather than via `safeDispatch` (the error originates outside the engine's
 *     `executeAction` path), but the mapping lives here so all typed errors have
 *     one canonical notification bridge.
 *   - Any other `Error` (not in the typed-error union) — **re-thrown**.
 *     The wrapper does NOT swallow unknown errors; a programming bug should
 *     still surface as an unhandled rejection so it gets caught by tests +
 *     error-monitoring. The typed errors above are the engine's *expected*
 *     failure modes; everything else is unexpected.
 *
 * Actionable codes (the panel filters to this set — GDD §13.5 "prioritize
 * actionable events"):
 *
 *   - `'low-funds'`           — from InsufficientFundsError / UnknownAccountError.
 *   - `'expense-due'`         — (future) from `expense-due` SimulationEvent.
 *   - `'issuance-rejected'`   — (future) from `issuance-rejected` SimulationEvent.
 *   - `'tree-died'`           — (future) from `tree-died` SimulationEvent.
 *   - `'storm-damage'`        — (future) from `weather-damage` event w/ storm.
 *   - `'severe-weather'`      — (future) from `weather-damage` event (other types).
 *
 * The "(future)" codes are produced by event-bridging code that P5d does
 * NOT ship (the brief scopes the wrapper to typed errors only). The panel
 * filters to the actionable list as a defensive measure so when the
 * event-bridge lands, only the right codes show. See docs/ui.md §"Action
 * dispatch flow" + §"Gaps".
 *
 * Rule 6 (rendering / UI reads state, never writes): the wrapper does NOT
 * mutate `simState` directly. On a typed error, it calls
 * `pushNotification(...)` (a UI mutator that replaces the `ui` slice only
 * — `simState` reference is unchanged). The engine's `executeAction` threw
 * BEFORE publishing any state change, so `simState` is still the pre-call
 * snapshot.
 *
 * Rule 2 (purity): the wrapper is a thin side-effect layer over the store.
 * The error → notification mapping is pure (deterministic given the error
 * instance). The pushNotification side-effect is the spec-allowed single
 * mutation path for UI state (rule 6 symmetric counterpart).
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
import type { GameStoreState, UiNotification } from '../stores/game-store';
import { useGameStore } from '../stores/game-store';

// ----------------------------------------------------------------------------
// Public types.
// ----------------------------------------------------------------------------

/**
 * The store-like interface the wrapper depends on. Narrowed to make the
 * wrapper testable without dragging in the full Zustand store — tests can
 * pass a stub object that implements just these three methods.
 */
export interface DispatchWrapperStore {
  readonly simState: GameStoreState['simState'];
  dispatch: GameStoreState['dispatch'];
  pushNotification: GameStoreState['pushNotification'];
}

/**
 * Result of {@link safeDispatch}. Mirrors the bare `dispatch` return shape
 * so callers can treat the wrapped version as a drop-in replacement.
 *
 *   - `events` — the events the engine emitted (same as bare dispatch).
 *     Empty array `[]` on a typed error (the engine threw before publishing).
 *   - `ok` — `true` if the dispatch succeeded, `false` if a typed error was
 *     caught + converted to a notification. Lets callers branch on success
 *     without try/catch (e.g. `if (result.ok) advanceClock()`).
 */
export interface SafeDispatchResult {
  readonly events: readonly SimulationEvent[];
  readonly ok: boolean;
}

// ----------------------------------------------------------------------------
// Error → notification mapping (pure).
// ----------------------------------------------------------------------------

/**
 * Map a typed engine error to a UI notification payload (minus the
 * client-generated `id` + `createdAtMs` — those are added by
 * `pushNotification`). Returns `null` for unknown error classes so the
 * caller knows to re-throw.
 *
 * Pure: given an Error instance, returns a deterministic payload object
 * (or null). No side effects.
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

// ----------------------------------------------------------------------------
// Wrapper.
// ----------------------------------------------------------------------------

/**
 * Wrap `store.dispatch(action)` so typed engine errors are auto-converted
 * to `pushNotification` calls. Returns the events the engine emitted (same
 * shape as bare dispatch) plus an `ok` flag.
 *
 * On a typed error:
 *   1. Read the current `simState.clock.elapsedSeconds` (the `at` field for
 *      the notification). Defaults to 0 if the store hasn't booted.
 *   2. Map the error to a notification payload via {@link errorToNotification}.
 *   3. If the mapping returned a payload, call `store.pushNotification(...)`.
 *   4. If the mapping returned null (unknown error class), **re-throw**.
 *   5. Return `{ events: [], ok: false }` so the caller can branch.
 *
 * On success: return `{ events: <engine events>, ok: true }`.
 *
 * Pure callers can use the bare `store.dispatch` if they want errors to
 * propagate. The wrapper is for UI click handlers + action-bar shortcuts
 * where surfacing the error to the player is the desired behavior.
 *
 * @example
 *   const result = safeDispatch(useGameStore.getState(), purchase('market:water', 1));
 *   if (!result.ok) return; // notification already shown.
 */
export function safeDispatch(
  store: DispatchWrapperStore,
  action: GameAction,
): SafeDispatchResult {
  try {
    const events = store.dispatch(action);
    return { events, ok: true };
  } catch (err) {
    const at = store.simState?.clock.elapsedSeconds ?? 0;
    const payload = errorToNotification(err, at);
    if (payload === null) {
      // Unknown error — re-throw so it surfaces as an unhandled rejection.
      throw err;
    }
    store.pushNotification(payload);
    return { events: [], ok: false };
  }
}

// ----------------------------------------------------------------------------
// React hook (ergonomic wrapper for component use).
// ----------------------------------------------------------------------------

/**
 * React hook that returns a stable `safeDispatch` callback bound to the
 * live store. The callback closes over `useGameStore.getState()` (not the
 * reactive snapshot), so it never goes stale — but it also never causes a
 * re-render on its own. Consumers call it inside `onClick` / `onKeyDown`
 * handlers.
 *
 * @example
 *   const safeDispatch = useSafeDispatch();
 *   <Button onClick={() => safeDispatch(purchase('market:water', 1))}>Buy</Button>
 */
export function useSafeDispatch(): (action: GameAction) => SafeDispatchResult {
  // Subscribe narrowly to the three store methods the wrapper needs — but
  // since Zustand's getState() always returns the live store, we don't
  // actually need to subscribe to re-renders. We use the hook just to get
  // a stable reference to the live store API.
  //
  // Reading `useGameStore.getState()` inside the callback (rather than
  // destructuring at render time) guarantees we always see the latest
  // simState + mutators even across re-renders.
  useGameStore((s) => s.dispatch);
  return (action: GameAction): SafeDispatchResult =>
    safeDispatch(useGameStore.getState(), action);
}
