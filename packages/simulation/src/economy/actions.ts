/**
 * Economy action handlers (P3c — TDD §10.5, §10.6, GDD §8.1, §8.5, §16).
 *
 * Three player-facing actions live here:
 *
 *   - `pay-expense`: manually pay a living-expense bill (debits
 *     `player:personal`, sinks to the authority, records an `expense`
 *     transaction). Insufficient funds handled gracefully (increments
 *     `player.unpaidDays` and emits `expense-due` with `paid: false`) —
 *     the action does NOT throw for low funds.
 *   - `transfer`: move money between two accounts (player ↔ external;
 *     future player ↔ business). Uses P3a's `transfer()`.
 *   - `sell-tree`: ALWAYS rejects the original tree with a typed
 *     `OriginalTreeNotTransferableError` (GDD §16.1/16.2 — invariant).
 *     Non-original trees raise `TreeSaleNotImplementedError` (P8+ will
 *     replace this with a real sale flow).
 *
 * All handlers are pure: they return a new state + events without mutating
 * the input. They're registered in `packages/simulation/src/actions/handlers.ts`
 * and dispatched by `executeAction` via the `actionHandlers` map.
 *
 * Determinism: same (state, action) → same (new state, events). The
 * transaction id is derived deterministically from (timestamp, ledger
 * length) via P3a's `transactionId()` helper.
 *
 * Money NEVER silently created or destroyed (TDD §10.4): paid expenses are
 * `transfer()` calls with `destinationAccount = authority` (a sink);
 * transfers are real-to-real `transfer()` calls. The conservation
 * invariant holds for both by construction.
 */
import type {
  GameState,
  GameAction,
  PayExpenseAction,
  TransferAction,
  SellTreeAction,
  PerformLaborAction,
  BuyToolAction,
  SimulationEvent,
  TransactionRecord,
} from '@capitalist-tree/shared';
import {
  OriginalTreeNotTransferableError,
  TreeSaleNotImplementedError,
  PROVISIONAL_ECONOMY_CATEGORY_TRANSFER,
  PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
  PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
  PROVISIONAL_ECONOMY_CATEGORY_LABOR,
  PROVISIONAL_LABOR_WAGE_MINOR_PER_HOUR,
  PROVISIONAL_LABOR_EXHAUSTION_PER_HOUR,
  PROVISIONAL_LABOR_EXHAUSTION_MAX,
  PROVISIONAL_LABOR_HEALTH_PENALTY_MAX,
  PROVISIONAL_LABOR_MIN_HEALTH_TO_WORK,
} from '@capitalist-tree/shared';
import type { SystemResult } from '../systems/system.js';
import { transfer, getBalance, findAccount, parseAmount } from './ledger.js';
import { UnknownAccountError } from './errors.js';
import { processExpensePayment } from '../personal/expenses.js';
import { getToolById } from '@capitalist-tree/content';

/**
 * Listener signature for an action handler. Mirrors the `ActionListener`
 * type in `packages/simulation/src/actions/handlers.ts` — kept local to
 * avoid a duplicate-export collision when `economy/index.ts` re-exports
 * this module. The two types are structurally identical (a handler is just
 * `(state, action) => SystemResult`).
 */
type ActionListener<A extends GameAction = GameAction> = (
  state: GameState,
  action: A,
) => SystemResult;

/**
 * `pay-expense` action handler (P3c — GDD §7.1).
 *
 * Delegates to the pure `processExpensePayment()` helper (the same one the
 * PersonalSystem uses for auto-bill flow), with `source: 'pay-expense'` so
 * the event audit trail distinguishes manual payments from auto-payments.
 *
 * **Insufficient funds are handled gracefully** (GDD §16.3, TDD §11): the
 * handler does NOT throw for low funds. Instead it increments
 * `player.unpaidDays`, emits an `expense-due` event with `paid: false`, and
 * emits a `low-funds` `notification`. Other errors (invalid amount,
 * unknown account) propagate as typed errors from the underlying
 * `transfer()`.
 *
 * Pure: returns a new state, never mutates input. Deterministic given
 * (state, action, timestamp).
 */
export const payExpenseHandler: ActionListener<PayExpenseAction> = (state, action) => {
  const result = processExpensePayment(state, {
    category: action.payload.category,
    amount: action.payload.amount,
    timestamp: state.clock.elapsedSeconds,
    source: 'pay-expense',
  });
  return { state: result.state, events: result.events };
};

/**
 * `transfer` action handler (P3c — TDD §10.5, GDD §8.1).
 *
 * Delegates to P3a's `transfer()` (category `'transfer'`). Validates:
 *   - Both accounts exist in `economy.accounts` (or the destination is the
 *     virtual authority — but that path is reserved for system-internal
 *     sinks and is rejected here).
 *   - `amount` is a positive bigint string (`transfer()` validates this).
 *   - Source has sufficient funds (`transfer()` throws
 *     `InsufficientFundsError` — the handler lets it propagate).
 *   - Source != destination (`SelfTransferError`).
 *
 * The handler also enforces a P3c ownership restriction: only
 * `player:personal` may be the source of a player-initiated transfer
 * (the player can only move their own cash out). Future phases (P7+) will
 * relax this for owned business accounts.
 *
 * Emits `transaction-recorded` (carried from `transfer()`) plus a
 * `transfer-completed` event carrying the full result (source/destination
 * accounts, amount, transaction id, source balance after).
 *
 * Pure: returns a new state, never mutates input. Deterministic given
 * (state, action, timestamp).
 */
export const transferHandler: ActionListener<TransferAction> = (state, action) => {
  const {
    sourceAccount,
    destinationAccount,
    amount,
    description,
  } = action.payload;
  const timestamp = state.clock.elapsedSeconds;

  // P3c ownership restriction: only player:personal can be the source of a
  // player-initiated transfer. Future phases (P7+) will relax this for
  // owned business accounts.
  // (The check is in the handler rather than `transfer()` so the ledger
  // stays policy-agnostic — the EconomySystem + future BusinessSystem can
  // still call `transfer()` directly for system-internal flows.)
  const playerAccount = findAccount(state, sourceAccount);
  if (playerAccount === undefined || playerAccount.type !== 'player') {
    throw new UnknownAccountError(sourceAccount);
  }

  // Reject authority as destination — that's reserved for system-internal
  // sinks (e.g. `processExpensePayment`). Player-initiated transfers go to
  // real accounts (markets, externals, future businesses).
  if (destinationAccount === PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID) {
    throw new UnknownAccountError(destinationAccount);
  }

  const desc =
    description ??
    `Transfer from ${sourceAccount} to ${destinationAccount}`;

  const afterTransfer = transfer(state, {
    sourceAccount,
    destinationAccount,
    amount,
    category: PROVISIONAL_ECONOMY_CATEGORY_TRANSFER,
    description: desc,
    timestamp,
  });

  // The new transaction is the last entry appended by transfer().
  const transaction: TransactionRecord =
    afterTransfer.economy.transactions[
      afterTransfer.economy.transactions.length - 1
    ]!;

  // Mirror the new source balance to player.personalCash if the source was
  // player:personal. (Same coupling as P3a's requestIssuance + P3b's
  // applyPurchase.)
  let next: GameState = afterTransfer;
  const sourceBalanceAfter = getBalance(next, sourceAccount);
  if (
    sourceAccount === 'player:personal' &&
    sourceBalanceAfter.toString(10) !== next.player.personalCash
  ) {
    next = {
      ...next,
      player: { ...next.player, personalCash: sourceBalanceAfter.toString(10) },
    };
  }

  const events: SimulationEvent[] = [
    {
      type: 'transaction-recorded',
      at: timestamp,
      payload: { record: transaction },
    },
    {
      type: 'transfer-completed',
      at: timestamp,
      payload: {
        sourceAccount,
        destinationAccount,
        amount,
        transactionId: transaction.id,
        sourceBalanceAfter: sourceBalanceAfter.toString(10),
      },
    },
  ];

  return { state: next, events };
};

/**
 * `sell-tree` action handler (P3c — GDD §16.1, §16.2, TDD §18.4, §21.12).
 *
 * Invariant guard. ALWAYS rejects the original tree with a typed
 * `OriginalTreeNotTransferableError`. Non-original trees raise
 * `TreeSaleNotImplementedError` (P8+ will replace this with a real sale
 * flow).
 *
 * The schema-layer `superRefine` on `gameStateSchema` catches *persisted*
 * corruption (a save where `originalTree.isOriginal === false`); this
 * runtime error catches *action attempts* (e.g. a buggy UI dispatching a
 * "sell" action against the original tree). Together they enforce the
 * GDD §16.1/§16.2 constraint at both layers.
 *
 * Invariant test (TDD §18.4): `executeAction({ type: 'sell-tree', payload:
 * { target: 'original' } })` MUST throw `OriginalTreeNotTransferableError`.
 *
 * The handler does NOT mutate state — it always throws before any state
 * change. Returns nothing (the throw propagates to the engine, which
 * surfaces it to the caller).
 */
export const sellTreeHandler: ActionListener<SellTreeAction> = (state, action) => {
  const { target } = action.payload;
  // The original tree's id is `'original'` (enforced by the GameState
  // schema superRefine). Match either the literal `'original'` or the
  // state's `originalTree.id` (defensive — in case a future schema change
  // makes the id configurable, though GDD §16.2 forbids that).
  if (target === 'original' || target === state.originalTree.id) {
    throw new OriginalTreeNotTransferableError(target);
  }
  // Non-original tree — P8+ will implement the sale flow. For P3c, throw a
  // typed NotImplemented error so the caller gets a clear signal.
  throw new TreeSaleNotImplementedError(target);
};

/**
 * `perform-labor` action handler (P12-D follow-up — a second income path
 * that costs the player's health).
 *
 * The player works `action.payload.hours` of wage labor. The handler:
 *   1. Computes the wage (`hours × PROVISIONAL_LABOR_WAGE_MINOR_PER_HOUR`)
 *      and the exhaustion gain (`hours ×
 *      PROVISIONAL_LABOR_EXHAUSTION_PER_HOUR`).
 *   2. Gracefully rejects (a `notification`, no state change) when the player
 *      is too unhealthy to work (`health` below
 *      `PROVISIONAL_LABOR_MIN_HEALTH_TO_WORK`) or when the shift would push
 *      `laborExhaustion` past its cap. This mirrors `pay-expense`'s
 *      graceful-rejection pattern — no throw.
 *   3. Issues the wage from the monetary authority to `player:personal` via
 *      `transfer()` (issuance — `monetarySupply` + `totalIssued` rise, like
 *      harvest issuance). The deterministic `requestId` makes it replay-safe.
 *   4. Accrues the exhaustion onto `player.laborExhaustion` + mirrors the new
 *      balance to `player.personalCash`.
 *   5. Emits `transaction-recorded` (the `labor` issuance transaction) +
 *      `labor-completed` (hours, wage, exhaustion before/after, marginal
 *      health cost, balance after, transaction id).
 *
 * The PersonalSystem then decays `laborExhaustion` each tick (rest) and the
 * well-being derivation turns it into a physical-health penalty, so
 * overworking makes the player sick — the deliberate tradeoff against
 * harvesting leaves (which costs the tree, not the player).
 *
 * Pure + deterministic: same (state, action) → same (new state, events).
 */
export const performLaborHandler: ActionListener<PerformLaborAction> = (
  state,
  action,
) => {
  const hours = action.payload.hours;
  const timestamp = state.clock.elapsedSeconds;
  const exhaustionBefore = state.player.laborExhaustion;

  // Wage (bigint minor) + exhaustion gain (float in [0,1]).
  const wagePerHour = parseAmount(
    PROVISIONAL_LABOR_WAGE_MINOR_PER_HOUR,
    'laborWage',
  );
  const wageMinor = BigInt(hours) * wagePerHour;
  const exhaustionGain = hours * PROVISIONAL_LABOR_EXHAUSTION_PER_HOUR;

  // Guard 1: too unhealthy to work — the player is too worn out to labor.
  // Graceful rejection (matches pay-expense's no-throw pattern).
  if (state.player.health < PROVISIONAL_LABOR_MIN_HEALTH_TO_WORK) {
    return {
      state,
      events: [
        {
          type: 'notification',
          at: timestamp,
          payload: {
            severity: 'warning',
            code: 'too-unhealthy-to-labor',
            message: `Player health (${state.player.health.toFixed(2)}) is below the labor minimum (${PROVISIONAL_LABOR_MIN_HEALTH_TO_WORK}). Rest (advance time) to recover before working.`,
          },
        },
      ],
    };
  }

  // Guard 2: the shift would push exhaustion past its cap. The player should
  // choose fewer hours or rest first. Graceful rejection.
  if (exhaustionBefore + exhaustionGain > PROVISIONAL_LABOR_EXHAUSTION_MAX) {
    return {
      state,
      events: [
        {
          type: 'notification',
          at: timestamp,
          payload: {
            severity: 'warning',
            code: 'too-exhausted-to-labor',
            message: `Working ${hours}h would push exhaustion past the cap (${PROVISIONAL_LABOR_EXHAUSTION_MAX}); current exhaustion ${exhaustionBefore.toFixed(2)}. Choose fewer hours or rest first.`,
          },
        },
      ],
    };
  }

  const exhaustionAfter = Math.min(
    PROVISIONAL_LABOR_EXHAUSTION_MAX,
    exhaustionBefore + exhaustionGain,
  );

  // Issue the wage: authority → player:personal (issuance — money enters
  // circulation, mirroring harvest issuance). The requestId is deterministic
  // in (saveId, timestamp, hours, pre-shift transaction count) so a replayed
  // shift is a no-op (transfer()'s idempotency pre-check).
  const requestId = `labor:${state.metadata.saveId}:${timestamp}:${hours}:${state.economy.transactions.length}`;
  let next = transfer(state, {
    sourceAccount: PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
    destinationAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
    amount: wageMinor.toString(10),
    category: PROVISIONAL_ECONOMY_CATEGORY_LABOR,
    description: `Wage for ${hours}h of labor`,
    timestamp,
    requestId,
  });

  // The new transaction is the last entry appended by transfer().
  const transaction: TransactionRecord =
    next.economy.transactions[next.economy.transactions.length - 1]!;

  // Mirror the new player balance + accrue exhaustion.
  const playerBalanceAfter = getBalance(
    next,
    PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
  );
  next = {
    ...next,
    player: {
      ...next.player,
      personalCash: playerBalanceAfter.toString(10),
      laborExhaustion: exhaustionAfter,
    },
  };

  // Marginal health cost the new exhaustion level will impose once the
  // PersonalSystem re-derives well-being next tick:
  // (exhaustionAfter - exhaustionBefore) × LABOR_HEALTH_PENALTY_MAX.
  const healthCost =
    (exhaustionAfter - exhaustionBefore) * PROVISIONAL_LABOR_HEALTH_PENALTY_MAX;

  const events: SimulationEvent[] = [
    {
      type: 'transaction-recorded',
      at: timestamp,
      payload: { record: transaction },
    },
    {
      type: 'labor-completed',
      at: timestamp,
      payload: {
        hours,
        amountMinor: wageMinor.toString(10),
        exhaustionBefore,
        exhaustionAfter,
        healthCost,
        playerBalanceAfter: playerBalanceAfter.toString(10),
        transactionId: transaction.id,
      },
    },
  ];

  return { state: next, events };
};

/**
 * `buy-tool` handler (W-axe — player purchases a hand tool, e.g. an axe).
 *
 * Mirrors `purchaseEquipmentHandler`'s money flow (sink transfer + balance
 * mirror) but credits `state.inventory.items` instead of spawning an
 * AutomationState — a hand tool is not scheduled automation. The tool is
 * reusable (not consumed); gating the `cut-down-tree` action on ownership is
 * the only read.
 *
 * Throws `UnknownToolError` (from `getToolById`) if `toolId` is unknown, and
 * `InsufficientFundsError` (from `transfer()`) if the player can't afford the
 * cost — matching `purchase`'s contract (a failed purchase is a hard error,
 * not a graceful notification).
 */
export const buyToolHandler: ActionListener<BuyToolAction> = (state, action) => {
  const { toolId } = action.payload;
  const tool = getToolById(toolId); // throws UnknownToolError if unknown.
  const timestamp = state.clock.elapsedSeconds;
  const costMinor = parseAmount(tool.cost, 'toolCost');

  // Debit the cost: player:personal → authority (a SINK — money leaves
  // circulation; conservation-safe via transfer()'s invariant).
  const requestId = `tool:${state.metadata.saveId}:${timestamp}:${toolId}:${state.economy.transactions.length}`;
  let next = transfer(state, {
    sourceAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
    destinationAccount: PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
    amount: costMinor.toString(10),
    category: 'tool',
    description: `Purchase ${tool.name} (${toolId})`,
    timestamp,
    requestId,
  });

  const transaction: TransactionRecord =
    next.economy.transactions[next.economy.transactions.length - 1]!;

  // Mirror the new player balance (player.personalCash is a denormalized view
  // of the player:personal account — every handler that moves money mirrors it).
  const playerBalanceAfter = getBalance(next, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID);
  next = {
    ...next,
    player: { ...next.player, personalCash: playerBalanceAfter.toString(10) },
  };

  // Credit the inventory: { resourceId: toolId, quantity: 1 } (increment if the
  // player already owns one — they can buy multiples, though tools are reusable).
  const items = [...next.inventory.items];
  const existingIdx = items.findIndex((i) => i.resourceId === toolId);
  if (existingIdx >= 0) {
    const existing = items[existingIdx]!;
    items[existingIdx] = { ...existing, quantity: existing.quantity + 1 };
  } else {
    items.push({ resourceId: toolId, quantity: 1 });
  }
  next = { ...next, inventory: { ...next.inventory, items } };

  const events: SimulationEvent[] = [
    {
      type: 'transaction-recorded',
      at: timestamp,
      payload: { record: transaction },
    },
    {
      type: 'notification',
      at: timestamp,
      payload: {
        severity: 'info',
        code: 'tool-purchased',
        message: `Bought ${tool.name} for ${(Number(tool.cost) / 100).toFixed(2)} currency. Use cut-down-tree to fell the tree for timber.`,
      },
    },
  ];

  return { state: next, events };
};
