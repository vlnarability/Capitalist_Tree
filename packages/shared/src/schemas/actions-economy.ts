import { z } from 'zod';
import { LIVING_EXPENSE_CATEGORIES } from './player.js';
import { PROVISIONAL_LABOR_MAX_HOURS_PER_SHIFT } from '../constants/economy.js';

/**
 * Economy-related GameAction variants (P3b/P3c — TDD §10.5, §10.6, GDD §8.5).
 *
 * P3a shipped NO player actions (issuance was system-internal). P3b added the
 * first one: `purchase`. P3c adds three more:
 *
 *   - `pay-expense`: manually pay a due living-expense bill (debits
 *     `player:personal`, sinks to the authority, records an `expense`
 *     transaction). Insufficient funds handled gracefully (increments the
 *     player's `unpaidDays` counter and emits `expense-due` with `paid:
 *     false`) — the action does NOT throw.
 *   - `transfer`: transfer money between two accounts (player ↔ external,
 *     future player ↔ business). Uses P3a's `transfer()` (category
 *     `'transfer'`).
 *   - `sell-tree`: ALWAYS rejects the original tree with a typed error
 *     `OriginalTreeNotTransferableError` (GDD §16.1/16.2 — invariant). For
 *     non-original trees (future P8), raises `TreeSaleNotImplementedError`
 *     instead of silently no-op'ing.
 *
 * HOW TO EXTEND: add a new variant with a unique `type` literal. Register a
 * handler in `packages/simulation/src/actions/handlers.ts`. The handler
 * signature is `(state, action) => { state, events }`. Keep actions pure —
 * never mutate input state. Reject unknown action types with
 * `UnknownActionError` (handled centrally by `executeAction`).
 *
 * Re-exported from `packages/shared/src/schemas/actions.ts` so consumers can
 * `import { PurchaseAction } from '@capitalist-tree/shared'`.
 */

/**
 * `purchase` action — player buys `quantity` units of a commodity from a
 * market (P3b — TDD §10.5, §10.6, GDD §8.5).
 *
 * Steps performed by the handler:
 *   1. Resolve the market by id; reject with `UnknownMarketError` if unknown.
 *   2. Compute cost = `market.price * quantity` (bigint).
 *   3. Transfer `cost` from `player:personal` to `market:<id>` via P3a's
 *      `transfer()` (category `'purchase'`). Validates sufficient funds.
 *   4. Credit `inventory.items` with `{ resourceId: market.commodityId,
 *      quantity }` (incrementing if the resource is already in inventory).
 *   5. Adjust market supply/demand: `supply -= quantity`, `demand +=
 *      quantity` (the purchase raises demand for the next tick and draws
 *      down the available stock).
 *   6. Emit a `purchase-completed` event carrying the full result.
 *
 * The `marketId` MUST match an entry in `economy.markets` (or content
 * `ALL_MARKETS`). `quantity` is a positive integer.
 */
export const purchaseActionSchema = z.object({
  type: z.literal('purchase'),
  payload: z.object({
    /** Market id, e.g. `'market:water'`, `'market:fertilizer'`. */
    marketId: z.string().min(1),
    /** Units to buy (>= 1). Each unit is priced at the market's current
     *  `price` (minor currency units per unit). */
    quantity: z.number().int().positive(),
  }),
});
export type PurchaseAction = z.infer<typeof purchaseActionSchema>;

/**
 * `buy-tool` action (W-axe — player purchases a hand tool, e.g. an axe). The
 * handler resolves the tool via `getToolById(toolId)`, debits `cost` from
 * `player:personal` to the authority (a **sink** — money leaves circulation;
 * conservation-safe via `transfer()`), mirrors the new balance to
 * `player.personalCash`, then credits `state.inventory.items` with
 * `{ resourceId: toolId, quantity: 1 }` (incrementing if already present —
 * the player can own multiple). Emits `transaction-recorded` + a
 * `notification` (code `tool-purchased`). The axe is reusable + gates the
 * `cut-down-tree` action on ownership.
 *
 * PROVISIONAL per GDD §17 (tool cost/economy balance).
 */
export const buyToolActionSchema = z.object({
  type: z.literal('buy-tool'),
  payload: z.object({
    /** Tool id to buy, e.g. `'tool:axe'`. MUST match a `ToolDefinition.id`. */
    toolId: z.string().min(1),
  }),
});
export type BuyToolAction = z.infer<typeof buyToolActionSchema>;

/**
 * `pay-expense` action — manually pay a living-expense bill (P3c — GDD §7.1).
 *
 * The handler debits `player:personal` and sinks the amount to the central
 * monetary authority (the virtual sink — GDD §6.2). The transaction is
 * recorded with category `'expense'`. The `category` field selects which
 * living-expense bucket the payment counts toward (food, housing, utilities,
 * healthcare, transportation — GDD §7.1).
 *
 * **Insufficient funds are handled gracefully** (GDD §16.3 — tree death does
 * not end the game; analogously, an unpaid expense must not crash the
 * engine): if `player:personal` cannot cover the amount, the handler does
 * NOT throw. Instead it increments `player.unpaidDays` by
 * `PROVISIONAL_PERSONAL_BILLING_INTERVAL_DAYS` (one full billing cycle of
 * unpaid living costs), emits an `expense-due` event with `paid: false`, and
 * emits a `low-funds` `notification` (severity `'warning'`). The PersonalSystem's
 * per-tick well-being derivation translates the unpaid counter into a health
 * penalty (GDD §7.2, §7.3).
 *
 * The `amount` is the player's chosen payment (defaults to the configured
 * monthly amount for `category` if the caller omits it — but the schema
 * requires the caller to be explicit; the handler resolves the default).
 */
export const payExpenseActionSchema = z.object({
  type: z.literal('pay-expense'),
  payload: z.object({
    /** Living-expense bucket to pay (GDD §7.1). */
    category: z.enum(LIVING_EXPENSE_CATEGORIES),
    /** Amount to pay (bigint minor units as string). If omitted, the handler
     *  uses the player's configured monthly amount for `category`
     *  (`player.livingExpenses[category]`). The schema requires the caller to
     *  pass an explicit amount so the action is fully reproducible from the
     *  action payload alone (determinism — TDD §18.3). */
    amount: z.string().min(1),
  }),
});
export type PayExpenseAction = z.infer<typeof payExpenseActionSchema>;

/**
 * `transfer` action — move money between two accounts (P3c — TDD §10.5,
 * GDD §8.1).
 *
 * The handler delegates to P3a's `transfer()` (category `'transfer'`). It
 * validates:
 *   - Both `sourceAccount` and `destinationAccount` exist in
 *     `economy.accounts` (or are the virtual authority — for future
 *     business-to-authority tax flows).
 *   - `amount` is a positive bigint string.
 *   - Source has sufficient funds (`transfer()` throws
 *     `InsufficientFundsError` otherwise — the handler lets it propagate;
 *     the engine surfaces it to the UI).
 *   - Source != destination (`SelfTransferError`).
 *
 * The conservation invariant holds: `monetarySupply`, `totalIssued`, and
 * `totalSinks` are all unchanged for a real→real transfer. Authority-as-source
 * (issuance) and authority-as-destination (sink) are NOT exposed via this
 * action — those are system-internal operations reserved for the
 * EconomySystem. The `transfer` action is for player-controlled money
 * movement between accounts the player owns or transacts with.
 *
 * P3c only supports transfers FROM `player:personal` (the player can move
 * their own cash out to a market, an external account, or — in future
 * phases — a business account). Transfers FROM other accounts require
 * ownership checks (P7 business ledger); the handler rejects those with
 * `UnknownAccountError` for now. This restriction may be relaxed in P7+.
 */
export const transferActionSchema = z.object({
  type: z.literal('transfer'),
  payload: z.object({
    /** Source account id. MUST exist in `economy.accounts`. P3c only allows
     *  `player:personal` (the player can only move their own cash); future
     *  phases may relax this for owned business accounts. */
    sourceAccount: z.string().min(1),
    /** Destination account id. MUST exist in `economy.accounts` or be the
     *  virtual authority (the latter is reserved for system-internal sinks
     *  and is rejected here for player-initiated transfers). */
    destinationAccount: z.string().min(1),
    /** Amount in bigint minor units as string. Must be > 0. */
    amount: z.string().min(1),
    /** Optional human-readable description for the transaction record. The
     *  handler defaults to a generic `"Transfer from X to Y"` if omitted. */
    description: z.string().optional(),
  }),
});
export type TransferAction = z.infer<typeof transferActionSchema>;

/**
 * `sell-tree` action — invariant guard (P3c — GDD §16.1, §16.2, TDD §18.4,
 * TDD §21.12).
 *
 * GDD §16.1 / §16.2 / TDD §21.12 / TDD §18.4 ("No accidental sale or transfer
 * of the original tree"): the original tree cannot be sold or transferred.
 * This action ALWAYS rejects the original tree with a typed
 * `OriginalTreeNotTransferableError`. The schema-layer `superRefine` on
 * `gameStateSchema` catches *persisted* corruption; this action-layer guard
 * catches *runtime attempts* (e.g. a buggy UI dispatching a "sell" action
 * against the original tree).
 *
 * For non-original trees (future P8 — additional trees, business-owned
 * orchards), the handler raises `TreeSaleNotImplementedError` rather than
 * silently no-op'ing. P8 will replace that throw with a real sale flow.
 *
 * The action's payload carries the tree id the player attempted to sell.
 * P3c only knows about the original tree; `target === 'original'` (or
 * `target === state.originalTree.id`, which is `'original'` by the schema
 * invariant) triggers the invariant error. Any other `target` triggers the
 * NotImplemented error.
 *
 * Invariant test (TDD §18.4): `executeAction({ type: 'sell-tree', payload:
 * { target: 'original' } })` MUST throw `OriginalTreeNotTransferableError`.
 */
export const sellTreeActionSchema = z.object({
  type: z.literal('sell-tree'),
  payload: z.object({
    /** Id of the tree the player attempted to sell. The original tree's id
     *  is `'original'` (enforced by the GameState schema superRefine). */
    target: z.string().min(1),
  }),
});
export type SellTreeAction = z.infer<typeof sellTreeActionSchema>;

/**
 * `perform-labor` action (P12-D follow-up — a second income path that costs
 * the player's health).
 *
 * The player works `hours` of wage labor. The handler issues wage cash from
 * the monetary authority to `player:personal` (issuance — money enters
 * circulation, like harvest issuance) and accrues exhaustion on
 * `player.laborExhaustion` (`hours × PROVISIONAL_LABOR_EXHAUSTION_PER_HOUR`).
 * The PersonalSystem then decays that exhaustion each tick (rest) and the
 * well-being derivation turns it into a physical-health penalty, so
 * overworking makes the player sick.
 *
 * This is deliberately distinct from `harvest-leaves`: labor income doesn't
 * touch the tree at all (no defoliation, no stress, no wear) — the cost is
 * borne by the player's body instead. The tradeoff is reliable labor income
 * vs. the passive-but-finite income from a cared-for tree.
 *
 * The handler gracefully rejects (no cash, no exhaustion gain) when the
 * player is too worn out to work (`player.health` below
 * `PROVISIONAL_LABOR_MIN_HEALTH_TO_WORK`) or when the shift would push
 * `laborExhaustion` past its cap — emitting a `notification` rather than
 * throwing, matching the graceful-rejection pattern of `pay-expense`.
 *
 * `hours` is bounded `[1, PROVISIONAL_LABOR_MAX_HOURS_PER_SHIFT]`.
 */
export const performLaborActionSchema = z.object({
  type: z.literal('perform-labor'),
  payload: z.object({
    /** Hours worked in this shift (1..PROVISIONAL_LABOR_MAX_HOURS_PER_SHIFT).
     *  Wage = hours × PROVISIONAL_LABOR_WAGE_MINOR_PER_HOUR; exhaustion gain
     *  = hours × PROVISIONAL_LABOR_EXHAUSTION_PER_HOUR. */
    hours: z.number().int().min(1).max(PROVISIONAL_LABOR_MAX_HOURS_PER_SHIFT),
  }),
});
export type PerformLaborAction = z.infer<typeof performLaborActionSchema>;
