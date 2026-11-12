/**
 * Action factories (P5a — TDD §16 State Management).
 *
 * Pure functions that build immutable `GameAction` objects ready for
 * `useGameStore.getState().dispatch(action)`. Each factory validates its
 * inputs at the boundary and returns a plain object; it performs NO state
 * mutation and does NOT dispatch on its own. The store's `dispatch` routes
 * the action through `engine.executeAction(state, action)` (TDD §4.1) and
 * replaces `simState` with the engine's returned snapshot.
 *
 * Why factories (and not raw object literals)?
 *   - **Input validation at the boundary.** A typo like
 *     `{ type: 'set-speed', payload: { multiplier: 3 } }` would silently
 *     throw deep inside `engine.executeAction` (the speed-multiplier schema
 *     rejects `3`). Factories surface a readable error at the call site.
 *   - **Type narrowing.** Each factory's return type is the specific action
 *     variant, so `dispatch(setSpeed(1))` carries the right `SetSpeedAction`
 *     type through the call chain (no manual cast needed).
 *   - **Single source of truth for action shapes.** P5b/P5c panels call
 *     these factories; if the schema ever adds a required field, only the
 *     factory needs updating — every call site picks up the new shape.
 *
 * Convention (rule 1, GDD §16.10): the original tree cannot be sold. There
 * is no `sellOriginalTree()` factory here — the `sell-tree` action is
 * intentionally omitted because it ALWAYS throws (P3c guard). When P5b/P5c
 * adds a "sell additional tree" feature, the factory for non-original trees
 * can be added; the original-tree guard stays in the engine.
 *
 * `setCurrencyCosmetic` is the ONE non-`GameAction` factory in this file. It
 * returns a UI-only action that the store handles internally (mutating
 * `ui.selectedCurrencyId`) — it does NOT route through the engine, because
 * currency cosmetics are pure visual data (rule 6 + TDD §15.4: cosmetics
 * must NOT modify the underlying monetary value).
 */
import type {
  ApplyFertilizerAction,
  ApplyWaterAction,
  HarvestLeavesAction,
  LivingExpenseCategory,
  PayExpenseAction,
  PurchaseAction,
  SetSpeedAction,
} from '@capitalist-tree/shared';
import { PROVISIONAL_SPEED_MULTIPLIERS, PROVISIONAL_SPEED_PAUSED } from '@capitalist-tree/shared';
import { PROVISIONAL_UI_DEFAULT_SPEED } from './constants';

// ----------------------------------------------------------------------------
// Speed / pause factories (P0 — `set-speed` GameAction).
// ----------------------------------------------------------------------------

/**
 * Build a `set-speed` action. `multiplier` MUST be one of
 * `PROVISIONAL_SPEED_MULTIPLIERS = [0, 1, 5, 15, 60]`.
 *
 * Use {@link pause} for `multiplier = 0` and {@link resume} for un-pausing
 * — those factories are documented intent, this one is the raw builder.
 */
export function setSpeed(multiplier: number): SetSpeedAction {
  if (!(PROVISIONAL_SPEED_MULTIPLIERS as readonly number[]).includes(multiplier)) {
    throw new Error(
      `setSpeed: invalid multiplier ${multiplier}. ` +
        `Must be one of PROVISIONAL_SPEED_MULTIPLIERS = [${PROVISIONAL_SPEED_MULTIPLIERS.join(', ')}].`,
    );
  }
  return { type: 'set-speed', payload: { multiplier } };
}

/**
 * Build a `set-speed` action with `multiplier = PROVISIONAL_SPEED_PAUSED` (0).
 * The engine's set-speed handler updates `clock.speedMultiplier` to 0; the
 * simulation-loop hook observes this and cancels its rAF.
 */
export function pause(): SetSpeedAction {
  return setSpeed(PROVISIONAL_SPEED_PAUSED);
}

/**
 * Build a `set-speed` action resuming to `multiplier` (defaults to
 * `PROVISIONAL_UI_DEFAULT_SPEED = 1`). The hook restarts its rAF when it
 * observes the new (non-zero) multiplier.
 *
 * Note: `resume()` is not a true "toggle" — it sets the multiplier to a
 * specific value. If the player was previously at 5x, calling `resume()`
 * drops them to 1x. P5b's speed-control panel may want to remember the last
 * non-zero multiplier and pass it here; this factory is the pure builder.
 */
export function resume(multiplier: number = PROVISIONAL_UI_DEFAULT_SPEED): SetSpeedAction {
  return setSpeed(multiplier);
}

// ----------------------------------------------------------------------------
// Biology / resource factories (P1/P2 — `harvest-leaves`, `apply-water`,
// `apply-fertilizer` GameActions).
// ----------------------------------------------------------------------------

/**
 * Build a `harvest-leaves` action (P1 — TDD §7.5). `treeId` MUST match the
 * original tree's id (`'original'`) in P1 — additional trees arrive in P8.
 * The handler caps `requestedLeaves` to the species' `maximumHarvestFraction`
 * and the tree's current foliage.
 */
export function harvest(treeId: string, requestedLeaves: number): HarvestLeavesAction {
  if (!treeId) {
    throw new Error('harvest: treeId must be a non-empty string.');
  }
  if (!Number.isInteger(requestedLeaves) || requestedLeaves < 0) {
    throw new Error(
      `harvest: requestedLeaves must be a non-negative integer (got ${requestedLeaves}).`,
    );
  }
  return {
    type: 'harvest-leaves',
    payload: { treeId, requestedLeaves },
  };
}

/**
 * Build an `apply-water` action (P2 — TDD §8.2). Adds `litres` to the soil
 * water pool (capped at soil water capacity; excess becomes runoff). `treeId`
 * is optional — P2 uses it only for the event payload (water is applied to
 * the shared soil pool, not directly to a tree).
 */
export function applyWater(litres: number, treeId?: string): ApplyWaterAction {
  if (!Number.isFinite(litres) || litres < 0) {
    throw new Error(`applyWater: litres must be a non-negative finite number (got ${litres}).`);
  }
  if (treeId !== undefined && treeId.length === 0) {
    throw new Error('applyWater: treeId, when provided, must be a non-empty string.');
  }
  // exactOptionalPropertyTypes: only include `treeId` when defined.
  const payload: ApplyWaterAction['payload'] =
    treeId === undefined ? { litres } : { litres, treeId };
  return { type: 'apply-water', payload };
}

/**
 * Build an `apply-fertilizer` action (P2 — TDD §8.3). Applies `units` of the
 * fertilizer with id `fertilizerId` (must be registered in
 * `packages/content/src/fertilizers/`) to the soil nutrient pool. Excess
 * becomes contamination per GDD §8.3. `treeId` is optional (event payload
 * only — P2 applies fertilizer to the shared soil pool).
 */
export function applyFertilizer(
  fertilizerId: string,
  units: number,
  treeId?: string,
): ApplyFertilizerAction {
  if (!fertilizerId) {
    throw new Error('applyFertilizer: fertilizerId must be a non-empty string.');
  }
  if (!Number.isInteger(units) || units < 1) {
    throw new Error(`applyFertilizer: units must be a positive integer (got ${units}).`);
  }
  if (treeId !== undefined && treeId.length === 0) {
    throw new Error('applyFertilizer: treeId, when provided, must be a non-empty string.');
  }
  const payload: ApplyFertilizerAction['payload'] =
    treeId === undefined ? { fertilizerId, units } : { fertilizerId, units, treeId };
  return { type: 'apply-fertilizer', payload };
}

// ----------------------------------------------------------------------------
// Economy factories (P3b/P3c — `purchase`, `pay-expense` GameActions).
// ----------------------------------------------------------------------------

/**
 * Build a `purchase` action (P3b — TDD §10.5, §10.6, GDD §8.5). Player buys
 * `quantity` units of `marketId`'s commodity; cash flows from
 * `player:personal` to `market:<id>` via the underlying `transfer()`
 * (category `'purchase'`). Inventory is credited with
 * `{ resourceId: market.commodityId, quantity }`.
 */
export function purchase(marketId: string, quantity: number): PurchaseAction {
  if (!marketId) {
    throw new Error('purchase: marketId must be a non-empty string.');
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error(`purchase: quantity must be a positive integer (got ${quantity}).`);
  }
  return { type: 'purchase', payload: { marketId, quantity } };
}

/**
 * Build a `pay-expense` action (P3c — GDD §7.1). Manually pay a living-expense
 * bill of `amount` (bigint minor units as string) for `category`. The
 * handler debits `player:personal` and sinks to the authority. Insufficient
 * funds are handled gracefully — the handler does NOT throw, it increments
 * `player.unpaidDays` and emits an `expense-due` event with `paid: false`.
 */
export function payExpense(
  category: LivingExpenseCategory,
  amount: string,
): PayExpenseAction {
  if (!amount || !/^\d+$/.test(amount)) {
    throw new Error(
      `payExpense: amount must be a non-empty bigint-as-string of digits (got "${amount}").`,
    );
  }
  return { type: 'pay-expense', payload: { category, amount } };
}

// ----------------------------------------------------------------------------
// UI-only action — currency cosmetic selection (NOT a GameAction).
// ----------------------------------------------------------------------------

/**
 * Discriminant for UI-only actions handled by the store directly (NOT routed
 * through `engine.executeAction`). P5a only ships one: `set-currency-cosmetic`.
 *
 * Why a separate union? `GameAction` is the engine's discriminated union
 * (TDD §4.1) — adding UI-only variants there would couple the engine to UI
 * concerns. UI-only actions live in the web app and dispatch through the
 * store's UI mutators, which never touch `simState` (rule 6: rendering reads
 * state, never writes — the symmetric rule for UI: UI state never writes
 * simulation state).
 */
export type UiAction = SetCurrencyCosmeticAction;

/**
 * UI-only action: select a currency cosmetic (TDD §15.4, GDD §14). Mutates
 * `ui.selectedCurrencyId` — does NOT modify the underlying monetary value
 * or simulation balance. The selected id is resolved by the rendering
 * package's `findCurrencyVisual(id)` to a `CurrencyVisual` for the
 * `TreeView` component.
 */
export interface SetCurrencyCosmeticAction {
  readonly type: 'set-currency-cosmetic';
  readonly payload: { readonly currencyId: string };
}

/**
 * Build a `set-currency-cosmetic` UI action. The store handles this
 * internally (sets `ui.selectedCurrencyId`) — it does NOT route through
 * the engine.
 */
export function setCurrencyCosmetic(currencyId: string): SetCurrencyCosmeticAction {
  if (!currencyId) {
    throw new Error('setCurrencyCosmetic: currencyId must be a non-empty string.');
  }
  return { type: 'set-currency-cosmetic', payload: { currencyId } };
}
