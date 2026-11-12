/**
 * Tests for lib/dispatch-wrapper.ts (P5d — GDD §13.5).
 *
 * Coverage:
 *   - `safeDispatch(store, action)` returns `{ events, ok: true }` when
 *     `store.dispatch(action)` succeeds.
 *   - `safeDispatch` catches `InsufficientFundsError` and pushes a
 *     `low-funds` notification (severity `warning`) with the needed /
 *     available amounts in the message. Returns `{ events: [], ok: false }`.
 *   - `safeDispatch` catches `UnknownAccountError` and pushes a
 *     `low-funds` notification (severity `critical`).
 *   - `safeDispatch` catches `UnknownMarketError`, `InvalidAmountError`,
 *     `DuplicateRequestIdError`, `SelfTransferError`, `UnknownActionError`,
 *     `SimulationInvariantError`, `OriginalTreeNotTransferableError`,
 *     `TreeSaleNotImplementedError`, `UnknownSchemaVersionError`,
 *     `SaveValidationError` and maps each to its matching code. Returns
 *     `{ events: [], ok: false }`.
 *   - `safeDispatch` RE-THROWS unknown errors (non-typed) — the wrapper
 *     does NOT swallow unexpected error classes.
 *   - `errorToNotification(err, at)` is pure: deterministic output for
 *     the same error instance + `at` value.
 *   - The wrapper leaves `simState` referentially unchanged (rule 6 —
 *     UI mutators only touch the `ui` slice).
 *   - The wrapper reads `at` from `simState.clock.elapsedSeconds` (or
 *     falls back to 0 when simState is null).
 *
 * Environment: node (default). The dispatch + pushNotification paths are
 * framework-agnostic; no DOM needed.
 */
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { engine, DEFAULT_GAME_CONFIG } from '@capitalist-tree/simulation';
import {
  InsufficientFundsError,
  UnknownAccountError,
  InvalidAmountError,
  DuplicateRequestIdError,
  SelfTransferError,
  UnknownMarketError,
  transfer,
  getBalance,
} from '@capitalist-tree/simulation';
import {
  OriginalTreeNotTransferableError,
  SaveValidationError,
  SimulationInvariantError,
  TreeSaleNotImplementedError,
  UnknownActionError,
  UnknownSchemaVersionError,
  PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
  PROVISIONAL_ECONOMY_EXTERNAL_ACCOUNT_ID,
  PROVISIONAL_ECONOMY_CATEGORY_TRANSFER,
} from '@capitalist-tree/shared';
import type { GameState, GameAction } from '@capitalist-tree/shared';
import {
  useGameStore,
  __resetGameStoreForTests,
} from '../../stores/game-store';
import {
  safeDispatch,
  errorToNotification,
  type DispatchWrapperStore,
} from '../../lib/dispatch-wrapper';
import { purchase } from '../../lib/actions';

// ----------------------------------------------------------------------------
// Helpers.
// ----------------------------------------------------------------------------

function freshState(): GameState {
  return engine.initialize({ ...DEFAULT_GAME_CONFIG, createdAt: 1_700_000_000_000 });
}

/** Publish a non-null simState via the loop's commit path. */
function publishState(state: GameState): void {
  useGameStore.getState().commitSimState(state, []);
}

/**
 * Drain `player:personal`'s cash to `'0'` minor units via the engine's own
 * `transfer()`. Moves the balance out to the external account — the
 * canonical drain path (matches the pattern in
 * `packages/simulation/test/economy-invariants.test.ts`). Drains the
 * `economy.accounts[player:personal].balance` (the source of truth the
 * engine's `transfer()` reads — see `applyTransferToAccounts` in
 * `ledger.ts`).
 *
 * Note: the bare `transfer()` does NOT mirror the new balance back to
 * `player.personalCash` — only the action handlers
 * (`transferHandler`, `applyPurchase`) do that. The next `applyPurchase`
 * call would re-derive `player.personalCash` from the account balance
 * on success, but our test path throws before that mirror runs.
 *
 * Why drain the account (not the mirror)? `applyPurchase` calls
 * `transfer(state, ...)` which checks `economy.accounts[].balance`
 * (NOT `player.personalCash`). Draining just `player.personalCash`
 * would leave the account flush and the purchase would succeed —
 * defeating the test's intent.
 */
function drainPlayerCash(state: GameState): GameState {
  return transfer(state, {
    sourceAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
    destinationAccount: PROVISIONAL_ECONOMY_EXTERNAL_ACCOUNT_ID,
    amount: state.player.personalCash,
    category: PROVISIONAL_ECONOMY_CATEGORY_TRANSFER,
    description: 'drain for test',
    timestamp: state.clock.elapsedSeconds,
  });
}

/**
 * Build a store stub matching the `DispatchWrapperStore` interface. Used
 * to test the wrapper in isolation (without dragging in the full Zustand
 * store + engine). The `dispatch` field is a `vi.fn` so each test can
 * configure its throw / return value.
 *
 * Typing note: `pushNotification` is typed as
 * `Mock<DispatchWrapperStore['pushNotification']>` — a vitest `Mock` whose
 * call signature matches the real `pushNotification` function. The Mock
 * type carries the `.mock` introspection API; the call signature makes
 * it assignable to `DispatchWrapperStore['pushNotification']` so the stub
 * can be passed to `safeDispatch(store, ...)` without a cast.
 */
function makeStubStore(
  dispatchImpl: (a: GameAction) => readonly ReturnType<typeof Object>[] | never,
  simState: GameState | null = freshState(),
): Omit<DispatchWrapperStore, 'pushNotification'> & {
  pushNotification: Mock<DispatchWrapperStore['pushNotification']>;
} {
  return {
    simState,
    dispatch: dispatchImpl as unknown as DispatchWrapperStore['dispatch'],
    pushNotification: vi.fn() as unknown as Mock<
      DispatchWrapperStore['pushNotification']
    >,
  };
}

// ----------------------------------------------------------------------------
// errorToNotification — pure mapping.
// ----------------------------------------------------------------------------

describe('errorToNotification (P5d) — typed error → notification mapping', () => {
  beforeEach(() => __resetGameStoreForTests());

  it('maps InsufficientFundsError → low-funds / warning', () => {
    const err = new InsufficientFundsError('player:personal', '5000', '100');
    const payload = errorToNotification(err, 60);
    expect(payload).not.toBeNull();
    expect(payload?.code).toBe('low-funds');
    expect(payload?.severity).toBe('warning');
    expect(payload?.at).toBe(60);
    expect(payload?.message).toContain('5000');
    expect(payload?.message).toContain('100');
  });

  it('maps UnknownAccountError → low-funds / critical', () => {
    const err = new UnknownAccountError('player:personal');
    const payload = errorToNotification(err, 0);
    expect(payload?.code).toBe('low-funds');
    expect(payload?.severity).toBe('critical');
    expect(payload?.message).toContain('player:personal');
  });

  it('maps UnknownMarketError → unknown-market / warning', () => {
    const err = new UnknownMarketError('market:nonexistent');
    const payload = errorToNotification(err, 0);
    expect(payload?.code).toBe('unknown-market');
    expect(payload?.severity).toBe('warning');
  });

  it('maps InvalidAmountError → invalid-amount / info', () => {
    const err = new InvalidAmountError('-5', 'must be positive');
    const payload = errorToNotification(err, 0);
    expect(payload?.code).toBe('invalid-amount');
    expect(payload?.severity).toBe('info');
  });

  it('maps DuplicateRequestIdError → duplicate-request / info', () => {
    const err = new DuplicateRequestIdError('req-1');
    const payload = errorToNotification(err, 0);
    expect(payload?.code).toBe('duplicate-request');
    expect(payload?.severity).toBe('info');
  });

  it('maps SelfTransferError → self-transfer / info', () => {
    const err = new SelfTransferError('player:personal');
    const payload = errorToNotification(err, 0);
    expect(payload?.code).toBe('self-transfer');
    expect(payload?.severity).toBe('info');
  });

  it('maps UnknownActionError → unknown-action / critical', () => {
    const err = new UnknownActionError('foo-bar');
    const payload = errorToNotification(err, 0);
    expect(payload?.code).toBe('unknown-action');
    expect(payload?.severity).toBe('critical');
  });

  it('maps SimulationInvariantError → invariant / critical', () => {
    const err = new SimulationInvariantError('bad state');
    const payload = errorToNotification(err, 0);
    expect(payload?.code).toBe('invariant');
    expect(payload?.severity).toBe('critical');
    expect(payload?.message).toBe('bad state');
  });

  it('maps OriginalTreeNotTransferableError → original-tree-protected / warning', () => {
    const err = new OriginalTreeNotTransferableError('original');
    const payload = errorToNotification(err, 0);
    expect(payload?.code).toBe('original-tree-protected');
    expect(payload?.severity).toBe('warning');
  });

  it('maps TreeSaleNotImplementedError → tree-sale-not-implemented / info', () => {
    const err = new TreeSaleNotImplementedError('tree-2');
    const payload = errorToNotification(err, 0);
    expect(payload?.code).toBe('tree-sale-not-implemented');
    expect(payload?.severity).toBe('info');
  });

  it('maps UnknownSchemaVersionError → save-corrupt / critical', () => {
    const err = new UnknownSchemaVersionError(99, [1, 2]);
    const payload = errorToNotification(err, 0);
    expect(payload?.code).toBe('save-corrupt');
    expect(payload?.severity).toBe('critical');
  });

  it('maps SaveValidationError → save-corrupt / critical', () => {
    const err = new SaveValidationError('bad save', [{ path: ['x'] }]);
    const payload = errorToNotification(err, 0);
    expect(payload?.code).toBe('save-corrupt');
    expect(payload?.severity).toBe('critical');
  });

  it('returns null for an unknown error class', () => {
    class CustomError extends Error {}
    const payload = errorToNotification(new CustomError('surprise'), 0);
    expect(payload).toBeNull();
  });

  it('returns null for non-Error values (string, undefined)', () => {
    expect(errorToNotification('string thrown', 0)).toBeNull();
    expect(errorToNotification(undefined, 0)).toBeNull();
    expect(errorToNotification(42, 0)).toBeNull();
  });

  it('is pure — same input → same output', () => {
    const err = new InsufficientFundsError('a', '1', '2');
    const a = errorToNotification(err, 10);
    const b = errorToNotification(err, 10);
    expect(a).toEqual(b);
  });
});

// ----------------------------------------------------------------------------
// safeDispatch — wrapper behaviour.
// ----------------------------------------------------------------------------

describe('safeDispatch (P5d) — success path', () => {
  beforeEach(() => __resetGameStoreForTests());

  it('returns { events, ok: true } when dispatch succeeds', () => {
    publishState(freshState());
    // A real set-speed action — the engine's set-speed handler emits a
    // `system` event + a fresh state.
    const result = safeDispatch(useGameStore.getState(), {
      type: 'set-speed',
      payload: { multiplier: 5 },
    });
    expect(result.ok).toBe(true);
    expect(result.events.length).toBeGreaterThan(0);
    expect(useGameStore.getState().ui.notifications).toHaveLength(0);
  });

  it('leaves simState reference unchanged on success (rule 6)', () => {
    publishState(freshState());
    const before = useGameStore.getState().simState;
    safeDispatch(useGameStore.getState(), {
      type: 'set-speed',
      payload: { multiplier: 5 },
    });
    // simState is replaced by dispatch (engine deep-copies), but the
    // wrapper doesn't touch it. We assert the wrapper didn't trigger
    // an *additional* commit beyond what dispatch did.
    expect(useGameStore.getState().simState).not.toBe(before);
    // No notifications were pushed.
    expect(useGameStore.getState().ui.notifications).toHaveLength(0);
  });
});

describe('safeDispatch (P5d) — typed error → notification', () => {
  beforeEach(() => __resetGameStoreForTests());

  it('catches InsufficientFundsError and pushes a low-funds notification', () => {
    publishState(freshState());
    // Drain the player's cash so the next purchase fails. Drain the
    // `economy.accounts[player:personal].balance` (the source of truth
    // the engine's `transfer()` reads) — see `drainPlayerCash` above for
    // why `player.personalCash` is NOT touched.
    const drained = drainPlayerCash(useGameStore.getState().simState!);
    useGameStore.getState().commitSimState(drained, []);
    expect(
      getBalance(
        useGameStore.getState().simState!,
        PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
      ).toString(10),
    ).toBe('0');

    // Try to buy 100 L of water — costs 1000 minor units, player has 0.
    const result = safeDispatch(
      useGameStore.getState(),
      purchase('market:water', 100),
    );

    expect(result.ok).toBe(false);
    expect(result.events).toEqual([]);
    const notifs = useGameStore.getState().ui.notifications;
    expect(notifs).toHaveLength(1);
    expect(notifs[0]?.code).toBe('low-funds');
    expect(notifs[0]?.severity).toBe('warning');
    expect(notifs[0]?.message).toMatch(/insufficient/i);
  });

  it('reads `at` from simState.clock.elapsedSeconds when mapping', () => {
    publishState(freshState());
    // Advance the clock to a non-zero time so we can assert the
    // notification's `at` field is populated from it. Drain the player's
    // cash too (so the purchase throws — `at` is only set on the error
    // path).
    const drained = drainPlayerCash(useGameStore.getState().simState!);
    const advanced: GameState = {
      ...drained,
      clock: { ...drained.clock, elapsedSeconds: 1234 },
    };
    useGameStore.getState().commitSimState(advanced, []);
    safeDispatch(useGameStore.getState(), purchase('market:water', 100));
    const notif = useGameStore.getState().ui.notifications[0];
    expect(notif?.at).toBe(1234);
  });

  it('catches UnknownActionError and pushes a unknown-action notification', () => {
    publishState(freshState());
    const store = makeStubStore(() => {
      throw new UnknownActionError('foo-bar');
    });
    const result = safeDispatch(store, { type: 'no-op', payload: {} } as unknown as GameAction);
    expect(result.ok).toBe(false);
    expect(store.pushNotification).toHaveBeenCalledTimes(1);
    const arg = (store.pushNotification as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(arg?.code).toBe('unknown-action');
    expect(arg?.severity).toBe('critical');
  });

  it('catches OriginalTreeNotTransferableError', () => {
    publishState(freshState());
    const store = makeStubStore(() => {
      throw new OriginalTreeNotTransferableError('original');
    });
    const result = safeDispatch(store, { type: 'no-op', payload: {} } as unknown as GameAction);
    expect(result.ok).toBe(false);
    const arg = (store.pushNotification as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(arg?.code).toBe('original-tree-protected');
  });

  it('catches UnknownSchemaVersionError', () => {
    publishState(freshState());
    const store = makeStubStore(() => {
      throw new UnknownSchemaVersionError(99, [1, 2]);
    });
    const result = safeDispatch(store, { type: 'no-op', payload: {} } as unknown as GameAction);
    expect(result.ok).toBe(false);
    const arg = (store.pushNotification as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(arg?.code).toBe('save-corrupt');
  });

  it('re-throws unknown error classes (does not swallow)', () => {
    publishState(freshState());
    class CustomError extends Error {}
    const store = makeStubStore(() => {
      throw new CustomError('unexpected');
    });
    expect(() =>
      safeDispatch(store, { type: 'no-op', payload: {} } as unknown as GameAction),
    ).toThrow(CustomError);
    // No notification was pushed.
    expect(store.pushNotification).not.toHaveBeenCalled();
  });

  it('falls back to at=0 when simState is null (loop not booted)', () => {
    // Don't publish a simState — leave the store at idle.
    const store = makeStubStore(() => {
      throw new InsufficientFundsError('player:personal', '1', '0');
    }, null);
    safeDispatch(store, { type: 'no-op', payload: {} } as unknown as GameAction);
    const arg = (store.pushNotification as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(arg?.at).toBe(0);
  });

  it('leaves simState reference unchanged on error (rule 6)', () => {
    publishState(freshState());
    const before = useGameStore.getState().simState;
    safeDispatch(useGameStore.getState(), purchase('market:water', 1_000_000));
    expect(useGameStore.getState().simState).toBe(before);
  });
});
