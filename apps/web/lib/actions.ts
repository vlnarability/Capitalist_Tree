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
  AutomationPolicy,
  ActivateTraitAction,
  BusinessStatus,
  CancelEventAction,
  DeactivateTraitAction,
  DisableAutomationAction,
  EnableAutomationAction,
  EventPriority,
  EventSeverity,
  HarvestLeavesAction,
  HireEmployeesAction,
  LayOffEmployeesAction,
  PlantSeedAction,
  LivingExpenseCategory,
  OperateBusinessAction,
  PayExpenseAction,
  PrestigeResetAction,
  ExportCommodityAction,
  ImportCommodityAction,
  PurchaseAction,
  PurchaseBusinessAction,
  PurchaseEquipmentAction,
  RecordHistoricalEventAction,
  RepayLoanAction,
  ResolveEventAction,
  ScheduleEventAction,
  SellBusinessAction,
  SetAutomationPolicyAction,
  SetBusinessStatusAction,
  SetGovernmentPolicyAction,
  SetMonetaryPolicyAction,
  SetSpeedAction,
  TakeLoanAction,
  TriggerEventAction,
  UnlockResearchAction,
} from '@capitalist-tree/shared';
import {
  PROVISIONAL_SPEED_MULTIPLIERS,
  PROVISIONAL_SPEED_PAUSED,
  type GovernmentPolicy,
  type MonetaryPolicy,
} from '@capitalist-tree/shared';
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
 * Build a `plant-seed` action (GAP-19 / GDD §11.2 — Genetic Legacy: the seed
 * production → planting loop). `treeId` MUST match the original tree's id
 * (`'original'`) in P1. `tick` is the simulation second at which the planting
 * runs (the event `at` stamp — pass `clock.elapsedSeconds`). The handler
 * consumes one seed from `tree.seeds` + credits genetic-legacy points; throws
 * `InsufficientSeedsError` (surfaced to the player) if the tree has no seeds.
 */
export function plantSeed(treeId: string, tick: number): PlantSeedAction {
  if (!treeId) {
    throw new Error('plantSeed: treeId must be a non-empty string.');
  }
  if (!Number.isInteger(tick) || tick < 0) {
    throw new Error(`plantSeed: tick must be a non-negative integer (got ${tick}).`);
  }
  return {
    type: 'plant-seed',
    payload: { treeId, tick },
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
 * Build an `import-commodity` action (P13-B / GAP-24 — GDD §15 international
 * trade). Import `quantity` units of `marketId`'s commodity from the foreign
 * market at the world price (`basePrice × foreignPriceMultiplier`) plus a
 * tariff surcharge (= baseCost × `governmentPolicy.tariffRate`). Cash flows
 * `player:personal` → `external:default` (base) + `authority` (tariff);
 * inventory is credited at the market's `commodityId`. `tick` is the current
 * sim second — pass `simState.clock.elapsedSeconds` (mirrors `plantSeed`).
 */
export function importCommodity(
  marketId: string,
  quantity: number,
  tick: number,
): ImportCommodityAction {
  if (!marketId) {
    throw new Error('importCommodity: marketId must be a non-empty string.');
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error(
      `importCommodity: quantity must be a positive integer (got ${quantity}).`,
    );
  }
  if (!Number.isInteger(tick) || tick < 0) {
    throw new Error(
      `importCommodity: tick must be a non-negative integer (got ${tick}).`,
    );
  }
  return { type: 'import-commodity', payload: { marketId, quantity, tick } };
}

/**
 * Build an `export-commodity` action (P13-B / GAP-24 — GDD §15 international
 * trade). Sell `quantity` units of `marketId`'s commodity from the player's
 * inventory to the foreign market at the world price (`basePrice ×
 * foreignPriceMultiplier`). Revenue is issued from the authority (mint) →
 * `player:personal` (the foreign buyer's payment enters the domestic economy);
 * inventory is debited. No tariff on exports. `tick` is the current sim second.
 */
export function exportCommodity(
  marketId: string,
  quantity: number,
  tick: number,
): ExportCommodityAction {
  if (!marketId) {
    throw new Error('exportCommodity: marketId must be a non-empty string.');
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error(
      `exportCommodity: quantity must be a positive integer (got ${quantity}).`,
    );
  }
  if (!Number.isInteger(tick) || tick < 0) {
    throw new Error(
      `exportCommodity: tick must be a non-negative integer (got ${tick}).`,
    );
  }
  return { type: 'export-commodity', payload: { marketId, quantity, tick } };
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

// ----------------------------------------------------------------------------
// Automation factories (P6d1 — `purchase-equipment`, `enable-automation`,
// `disable-automation`, `set-automation-policy` GameActions — TDD §12, GDD §9).
//
// The AutomationPanel (P6d1) dispatches these via the store's `dispatch`. The
// engine's action handlers (P6b2) own the actual mutation — debit cash,
// append/enable/disable automation, attach a policy. The factories only
// validate inputs at the boundary + return plain action objects (rule 1 +
// rule 6: UI dispatches actions, never mutates state directly).
// ----------------------------------------------------------------------------

/**
 * Build a `purchase-equipment` action (P6b1/P6b2 — TDD §12, GDD §9). Buys the
 * equipment with id `equipmentId` (must be registered in
 * `packages/content/src/equipment/`) and serves `targetId` (the tree/plot —
 * defaults to the original tree's id at the call site). The handler debits
 * `definition.cost` from `player:personal` and appends an `AutomationState`
 * derived from the definition.
 */
export function purchaseEquipment(
  equipmentId: string,
  targetId: string,
): PurchaseEquipmentAction {
  if (!equipmentId) {
    throw new Error('purchaseEquipment: equipmentId must be a non-empty string.');
  }
  if (!targetId) {
    throw new Error('purchaseEquipment: targetId must be a non-empty string.');
  }
  return { type: 'purchase-equipment', payload: { equipmentId, targetId } };
}

/**
 * Build an `enable-automation` action (P6b2). Flips `AutomationState.enabled`
 * to true. Idempotent on an already-enabled automation. `automationId` MUST
 * match an entry in `state.automation`.
 */
export function enableAutomation(automationId: string): EnableAutomationAction {
  if (!automationId) {
    throw new Error('enableAutomation: automationId must be a non-empty string.');
  }
  return { type: 'enable-automation', payload: { automationId } };
}

/**
 * Build a `disable-automation` action (P6b2). Flips `AutomationState.enabled`
 * to false (pause without removing). Idempotent. The automation retains its
 * policy + schedule so re-enabling resumes the same configuration.
 */
export function disableAutomation(automationId: string): DisableAutomationAction {
  if (!automationId) {
    throw new Error('disableAutomation: automationId must be a non-empty string.');
  }
  return { type: 'disable-automation', payload: { automationId } };
}

/**
 * Build a `set-automation-policy` action (P6b2). Attaches/replaces the
 * condition-based trigger on the automation with id `automationId`. The
 * handler validates that the automation's equipment supports the policy's
 * `kind` (content gate) before storing `policy` on the `AutomationState`.
 */
export function setAutomationPolicy(
  automationId: string,
  policy: AutomationPolicy,
): SetAutomationPolicyAction {
  if (!automationId) {
    throw new Error('setAutomationPolicy: automationId must be a non-empty string.');
  }
  return { type: 'set-automation-policy', payload: { automationId, policy } };
}

// ----------------------------------------------------------------------------
// P11-E (W6 game-loop gap): business action factories (Phase 3 — Expansion).
// Bridges the previously-unreachable purchase-business / operate-business /
// sell-business GameActions to the UI. Pre-P11-E these actions had handlers
// but zero UI dispatchers (Phase 3 was entirely unwired).
// ----------------------------------------------------------------------------

/**
 * Build a `purchase-business` action (P8b — GDD §8.1/§8.2). Debits
 * `definition.baseCost` from `player:personal`, registers the business
 * account, + appends a `BusinessState` (with the definition's
 * `baseEnvironmentalImpact`). `businessTypeId` MUST match a content
 * definition in `packages/content/src/businesses/`.
 */
export function purchaseBusiness(businessTypeId: string): PurchaseBusinessAction {
  if (!businessTypeId) {
    throw new Error('purchaseBusiness: businessTypeId must be a non-empty string.');
  }
  return { type: 'purchase-business', payload: { businessTypeId } };
}

/**
 * Build an `operate-business` action (P8b — GDD §8.2/§8.4). Runs one
 * production cycle for the business. P11 (RV3-2): the handler ignores any
 * player-supplied tick + uses `state.clock.elapsedSeconds`. P11 (W6): the
 * handler also bridges the business's environmentalImpact to the home region.
 */
export function operateBusiness(businessId: string): OperateBusinessAction {
  if (!businessId) {
    throw new Error('operateBusiness: businessId must be a non-empty string.');
  }
  return { type: 'operate-business', payload: { businessId } };
}

/**
 * Build a `sell-business` action (P8b — TDD §11 valuation). Liquidates the
 * business: settles liabilities from the business's cash + the valuation
 * proceeds (valuation × (1 − HAIRCUT)), credits the residue to `player:personal`,
 * removes the business + its account.
 */
export function sellBusiness(businessId: string): SellBusinessAction {
  if (!businessId) {
    throw new Error('sellBusiness: businessId must be a non-empty string.');
  }
  return { type: 'sell-business', payload: { businessId } };
}

// ----------------------------------------------------------------------------
// P11-E (Phase 3 cont.): loan + employee action factories. Bridges the
// previously-unreachable take-loan / repay-loan / hire-employees /
// lay-off-employees / set-business-status GameActions to the UI.
// ----------------------------------------------------------------------------

/**
 * Build a `take-loan` action (P8b — GDD §8.4). Creates a Liability on the
 * business + credits the principal via an authority issuance. `principal` is
 * bigint minor-units as a string; `interestRate` is an annualized fraction;
 * `dueAt` is the sim second the loan matures.
 */
export function takeLoan(
  businessId: string,
  principal: string,
  interestRate: number,
  dueAt: number,
): TakeLoanAction {
  if (!businessId) {
    throw new Error('takeLoan: businessId must be a non-empty string.');
  }
  if (!principal || BigInt(principal) <= 0n) {
    throw new Error('takeLoan: principal must be a positive bigint minor-units string.');
  }
  return { type: 'take-loan', payload: { businessId, principal, interestRate, dueAt } };
}

/**
 * Build a `repay-loan` action (P8b — GDD §8.4). Reduces a Liability's
 * principal (paying accrued interest first). P11 (RV3-2): the handler ignores
 * a player-supplied tick + uses `state.clock.elapsedSeconds`.
 */
export function repayLoan(businessId: string, liabilityId: string, amount: string): RepayLoanAction {
  if (!businessId) {
    throw new Error('repayLoan: businessId must be a non-empty string.');
  }
  if (!liabilityId) {
    throw new Error('repayLoan: liabilityId must be a non-empty string.');
  }
  if (!amount || BigInt(amount) <= 0n) {
    throw new Error('repayLoan: amount must be a positive bigint minor-units string.');
  }
  return { type: 'repay-loan', payload: { businessId, liabilityId, amount } };
}

/**
 * Build a `hire-employees` action (P8b — GDD §8.3). Increases the business's
 * `employees` by `count`.
 */
export function hireEmployees(businessId: string, count: number): HireEmployeesAction {
  if (!businessId) {
    throw new Error('hireEmployees: businessId must be a non-empty string.');
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new Error('hireEmployees: count must be a positive integer.');
  }
  return { type: 'hire-employees', payload: { businessId, count } };
}

/**
 * Build a `lay-off-employees` action (P8b — GDD §8.3). Decreases the
 * business's `employees` by `count`.
 */
export function layOffEmployees(businessId: string, count: number): LayOffEmployeesAction {
  if (!businessId) {
    throw new Error('layOffEmployees: businessId must be a non-empty string.');
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new Error('layOffEmployees: count must be a positive integer.');
  }
  return { type: 'lay-off-employees', payload: { businessId, count } };
}

/**
 * Build a `set-business-status` action (P8b — GDD §8.2). Flips a business
 * between `operating` and `idle` (the player-actionable statuses; `bankrupt`
 * + `liquidating` are system-internal).
 */
export function setBusinessStatus(businessId: string, status: BusinessStatus): SetBusinessStatusAction {
  if (!businessId) {
    throw new Error('setBusinessStatus: businessId must be a non-empty string.');
  }
  if (status !== 'operating' && status !== 'idle') {
    throw new Error(`setBusinessStatus: only 'operating'/'idle' are player-actionable (got '${status}').`);
  }
  return { type: 'set-business-status', payload: { businessId, status } };
}

// ----------------------------------------------------------------------------
// P11-E (Phase 5 game-loop gap): progression action factories (Generational).
// Bridges the previously-unreachable unlock-research / activate-trait /
// deactivate-trait / prestige-reset GameActions to the UI. Pre-P11-E Phase 5
// "Generational Progression" was entirely unwired.
// ----------------------------------------------------------------------------

/**
 * Build an `unlock-research` action (P9a — GDD §11.2). Spends the
 * genetic-legacy cost + marks the research node as unlocked. `tick` is the
 * sim second (the caller passes `state.clock.elapsedSeconds`).
 */
export function unlockResearch(researchNodeId: string, tick: number): UnlockResearchAction {
  if (!researchNodeId) {
    throw new Error('unlockResearch: researchNodeId must be a non-empty string.');
  }
  return { type: 'unlock-research', payload: { researchNodeId, tick } };
}

/**
 * Build an `activate-trait` action (P9a — GDD §11.4). Activates an acquired
 * trait (expresses its effects in the BiologySystem via `applyTraitEffects`).
 * `magnitude` in [0, 1] controls expression strength.
 */
export function activateTrait(traitId: string, magnitude?: number): ActivateTraitAction {
  if (!traitId) {
    throw new Error('activateTrait: traitId must be a non-empty string.');
  }
  return {
    type: 'activate-trait',
    payload: magnitude !== undefined ? { traitId, magnitude } : { traitId },
  };
}

/**
 * Build a `deactivate-trait` action (P9a — GDD §11.4). Deactivates an
 * active trait (stops expressing its effects).
 */
export function deactivateTrait(traitId: string): DeactivateTraitAction {
  if (!traitId) {
    throw new Error('deactivateTrait: traitId must be a non-empty string.');
  }
  return { type: 'deactivate-trait', payload: { traitId } };
}

/**
 * Build a `prestige-reset` action (P9a — GDD §11.1/§11.3). Starts a new
 * generation: converts progress into genetic-legacy points, resets the tree
 * to a sapling of the new species, + carries acquired traits forward.
 * `newTreeSpeciesId` MUST match a registered species. `tick` is the sim
 * second.
 */
export function prestigeReset(newTreeSpeciesId: string, tick: number): PrestigeResetAction {
  if (!newTreeSpeciesId) {
    throw new Error('prestigeReset: newTreeSpeciesId must be a non-empty string.');
  }
  return { type: 'prestige-reset', payload: { newTreeSpeciesId, tick } };
}

// ----------------------------------------------------------------------------
// P11-E (Phase 6 game-loop gap): event + historical action factories.
// Bridges the previously-unreachable schedule-event / cancel-event /
// trigger-event / resolve-event / record-historical-event GameActions to the
// UI. Pre-P11-E Phase 6 event orchestration was entirely unwired.
// ----------------------------------------------------------------------------

/**
 * Build a `schedule-event` action (P10c — GDD §10.2). Queues an event of the
 * given type to fire at `scheduledAt` (sim seconds). P11 (RV3-2): the handler
 * uses `state.clock.elapsedSeconds` for the action `at`; `tick` is kept for
 * the deterministic event timestamp but ignored for timing.
 */
export function scheduleEvent(
  eventTypeId: string,
  scheduledAt: number,
  tick: number,
  priority: EventPriority = 'normal',
): ScheduleEventAction {
  if (!eventTypeId) {
    throw new Error('scheduleEvent: eventTypeId must be a non-empty string.');
  }
  return { type: 'schedule-event', payload: { eventTypeId, scheduledAt, payload: {}, priority, tick } };
}

/**
 * Build a `cancel-event` action (P10c). Removes a scheduled event from the
 * queue by id (before it fires).
 */
export function cancelEvent(eventId: string, tick: number): CancelEventAction {
  if (!eventId) {
    throw new Error('cancelEvent: eventId must be a non-empty string.');
  }
  return { type: 'cancel-event', payload: { eventId, tick } };
}

/**
 * Build a `trigger-event` action (P10c). Fires an event immediately (bypasses
 * the scheduler). `regionId` optional (omit for a global event); `severity`
 * optional (defaults to a roll within the definition's severityRange).
 */
export function triggerEvent(
  eventTypeId: string,
  tick: number,
  severity?: EventSeverity,
  regionId?: string,
): TriggerEventAction {
  if (!eventTypeId) {
    throw new Error('triggerEvent: eventTypeId must be a non-empty string.');
  }
  const payload: TriggerEventAction['payload'] = { eventTypeId, payload: {}, tick };
  if (severity !== undefined) payload.severity = severity;
  if (regionId !== undefined) payload.regionId = regionId;
  return { type: 'trigger-event', payload };
}

/**
 * Build a `resolve-event` action (P10c). Resolves an active event early (ends
 * its effects before the duration expires).
 */
export function resolveEvent(eventId: string, tick: number): ResolveEventAction {
  if (!eventId) {
    throw new Error('resolveEvent: eventId must be a non-empty string.');
  }
  return { type: 'resolve-event', payload: { eventId, tick } };
}

/**
 * Build a `record-historical-event` action (P9a — GDD §11.5). Records a
 * lineage-level historical event (a milestone / turning point) against the
 * audit log. Player-authored (title + description) — for the player to
 * annotate meaningful moments.
 */
export function recordHistoricalEvent(
  eventId: string,
  title: string,
  description: string,
  tick: number,
): RecordHistoricalEventAction {
  if (!eventId) {
    throw new Error('recordHistoricalEvent: eventId must be a non-empty string.');
  }
  if (!title) {
    throw new Error('recordHistoricalEvent: title must be a non-empty string.');
  }
  return { type: 'record-historical-event', payload: { eventId, title, description, tick } };
}

/**
 * Build a `set-government-policy` action (P10b — GDD §404). Merges a partial
 * government policy into `eventState.global.governmentPolicy`
 * (environmentalRegulations / carbonTaxRate / subsidies).
 */
export function setGovernmentPolicy(
  policy: Partial<GovernmentPolicy>,
  tick: number,
): SetGovernmentPolicyAction {
  return { type: 'set-government-policy', payload: { policy, tick } };
}

/**
 * Build a `set-monetary-policy` action (P10b — GDD §404-408). Merges a partial
 * monetary policy into `eventState.global.monetaryPolicy`
 * (interestRate / inflationTarget / moneySupplyGrowth).
 */
export function setMonetaryPolicy(
  policy: Partial<MonetaryPolicy>,
  tick: number,
): SetMonetaryPolicyAction {
  return { type: 'set-monetary-policy', payload: { policy, tick } };
}
