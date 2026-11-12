/**
 * Automation execution (P6b2 — TDD §12, GDD §9, §9.1, §95 pillar 4).
 *
 * Pure helper that runs an automation's action for the current tick. Called by
 * the AutomationSystem (`systems/automation.ts`) ONLY when `evaluatePolicy`
 * returned `shouldRun: true`. The helper:
 *
 *   1. Pre-checks `resourceConsumption` against `state.inventory` — if the
 *      player lacks the inputs the action would consume, the automation is
 *      skipped with reason `insufficient-resources` (graceful, GDD §16.3) and
 *      `lastRunAt` is NOT advanced (so it retries next tick when stock is
 *      replenished).
 *   2. Builds the `GameAction` from `policy.action` + `policy.actionParams`
 *      (or the legacy schedule-only path) and dispatches it via the normal
 *      `dispatch` pipeline — economy/resource invariants still hold because
 *      the action goes through the same handlers a player action would
 *      (TDD §12: "Automation actions should be processed by the simulation
 *      engine").
 *   3. If the action dispatch throws (e.g. `InsufficientFundsError` from a
 *      purchase, `OriginalTreeNotTransferableError` from a sell-tree), the
 *      automation is skipped with reason `insufficient-resources` and
 *      `lastRunAt` is NOT advanced. The error is swallowed — automation
 *      failure must not crash the sim (mirrors P3c's graceful handling).
 *   4. On success: applies the pillar-4 trade-offs (GDD §95):
 *        - `resourceConsumption`: deducted from `inventory.items` (floored at
 *          0; conservation-enforced — the resource is consumed, not destroyed
 *          silently, because the action it fed already moved the
 *          corresponding physical quantity, e.g. apply-water added water to
 *          soil).
 *        - `energyConsumption`: P7c — the energy pool now exists
 *          (`EnvironmentState.energy`, P7a). Before the action runs, the
 *          per-fire draw (`energyConsumption × stepSeconds / 86400`) is pre-
 *          checked against `environment.energy.stored`; if the pool is short,
 *          the automation is skipped with reason `insufficient-resources` (the
 *          frozen reason enum has no `insufficient-energy` variant — energy is
 *          a resource) and `lastRunAt` is NOT advanced. On a successful fire,
 *          the draw is debited from `stored` (clamped at 0). Resolves R-P6-3.
 *        - `environmentalImpact`: pro-rated per tick
 *          (`impact × stepSeconds / 86400`) and routed onto the
 *          `EnvironmentState` accumulators by the centralized pure helper
 *          `environment/impact.ts` `applyEnvironmentalImpact`. P7c routes all
 *          six GDD §9.1 channels, including `landDisturbance →
 *          landUse.degraded` (which P6b2 left payload-only — R-P6-4).
 *        - `maintenanceCost`: pro-rated per tick
 *          (`cost × stepSeconds / 86400`, bigint floor division) and moved
 *          via `ledger.transfer` from `player:personal` to the virtual
 *          authority (a sink — `monetarySupply` decreases, `totalSinks`
 *          increases). The transfer carries a deterministic `requestId`
 *          derived from `(saveId, simSecond, automationId)` so repeated
 *          processing of the same tick (e.g. after a save/load) does not
 *          double-charge (idempotency, TDD §10.3). Zero per-tick maintenance
 *          (small daily cost rounding down) skips the transfer —
 *          `validateAmount` rejects 0-amount transfers.
 *      `lastRunAt` is advanced to `now`.
 *   5. Emits `automation-triggered` carrying the policy + the action type
 *      string that ran.
 *
 * The function is pure: it returns a new state + events, never mutates the
 * input. Deterministic given (state, automation, now, stepSeconds, rng).
 */
import type {
  AutomationState,
  GameState,
  SimulationEvent,
} from '@capitalist-tree/shared';
import {
  PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
  PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
} from '@capitalist-tree/shared';
import type { Rng } from '../rng.js';
import type { SystemResult } from '../systems/system.js';
import { dispatch } from '../actions/handlers.js';
import {
  transfer,
  getBalance,
  parseAmount,
  isRequestProcessed,
} from '../economy/ledger.js';
import { applyEnvironmentalImpact, hasEnergy, debitEnergy } from '../environment/index.js';

/** Maintenance transaction category (free-form string — categories are NOT
 *  Zod enums per `packages/shared/src/constants/economy.ts`). */
const CATEGORY_MAINTENANCE = 'maintenance';

/** Equipment purchase transaction category. */
const CATEGORY_EQUIPMENT = 'equipment';

const SECONDS_PER_DAY = 24 * 60 * 60;

export interface ExecuteAutomationParams {
  /** Current simulation second (ctx.now). */
  now: number;
  /** Length of this step in seconds (ctx.stepSeconds). */
  stepSeconds: number;
  /** Forked RNG sub-stream for the AutomationSystem. Currently unused by the
   *  deterministic execution path, but accepted so future stochastic failure
   *  modes (e.g. equipment breakdown rolls) can draw from it without changing
   *  the signature. */
  rng: Rng;
}

/**
 * Build a `GameAction` from an automation's policy (or legacy schedule path).
 *
 * The policy's `action` is the `GameAction['type']` string; `actionParams` is
 * the action's `payload`. For automations without a policy (legacy
 * interval-only), there is no action to run — the caller should not reach
 * this path (evaluatePolicy returns shouldRun for schedule-only automations,
 * but they have no action; executeAutomation treats a missing action as a
 * no-op run that still advances lastRunAt + applies costs).
 */
function buildAction(automation: AutomationState): { type: string; payload?: unknown } | undefined {
  const policy = automation.policy;
  if (policy === undefined) {
    return undefined;
  }
  return { type: policy.action, payload: policy.actionParams };
}

/**
 * Check the player's inventory has every declared resource input. Returns
 * true if all inputs are satisfiable, false otherwise (caller emits
 * `insufficient-resources`).
 */
function hasResources(state: GameState, automation: AutomationState): boolean {
  if (automation.resourceConsumption.length === 0) return true;
  for (const cost of automation.resourceConsumption) {
    const item = state.inventory.items.find((i) => i.resourceId === cost.resourceId);
    const available = item?.quantity ?? 0;
    if (available < cost.amount) return false;
  }
  return true;
}

/**
 * Deduct the automation's declared resource inputs from inventory. Returns a
 * new inventory array (never mutates input). Caller has already verified
 * sufficiency via `hasResources`.
 */
function deductResources(
  state: GameState,
  automation: AutomationState,
): GameState['inventory'] {
  if (automation.resourceConsumption.length === 0) {
    return state.inventory;
  }
  const items = state.inventory.items.map((item) => {
    const cost = automation.resourceConsumption.find((c) => c.resourceId === item.resourceId);
    if (!cost) return item;
    return { ...item, quantity: Math.max(0, item.quantity - cost.amount) };
  });
  return { items };
}

/**
 * Accumulate the automation's environmental impact onto the EnvironmentState.
 *
 * P7c extracts this routing into a centralized pure helper
 * (`environment/impact.ts` `applyEnvironmentalImpact`) that routes all six
 * GDD §9.1 channels — including `landDisturbance → landUse.degraded`, which
 * P6b2 left payload-only (R-P6-4, docs/offline-automation.md §6.4). See that
 * module for the full mapping + the rationale for centralizing it. The helper
 * is pure (returns a new env, never mutates its input).
 */

/**
 * Move the per-tick maintenance cost from `player:personal` to the virtual
 * authority (a sink). Pro-rated: `dailyCost × stepSeconds / 86400` using
 * bigint floor division. Skipped when the per-tick amount rounds down to 0
 * (`validateAmount` rejects 0-amount transfers) — small daily costs thus
 * accrue only at the daily boundary in the current model (@provisional — a
 * fractional accumulator would smooth this, but no schema field exists yet).
 *
 * The `requestId` is derived from `(saveId, simSecond, automationId)` so a
 * re-processed tick (save/load) does not double-charge (idempotency,
 * TDD §10.3). If the requestId is already processed, the transfer is skipped.
 *
 * Returns the new state (unchanged if the per-tick cost is 0 or already
 * processed) plus the transaction record if one was recorded (for the event
 * audit trail).
 */
function applyMaintenance(
  state: GameState,
  automation: AutomationState,
  now: number,
  stepSeconds: number,
): { state: GameState; transactionId?: string } {
  if (automation.maintenanceCost === '0') {
    return { state };
  }
  const daily = parseAmount(automation.maintenanceCost, 'maintenanceCost');
  if (daily <= 0n) return { state };
  const perTick = (daily * BigInt(stepSeconds)) / BigInt(SECONDS_PER_DAY);
  if (perTick <= 0n) return { state };

  const saveId = state.metadata.saveId;
  const requestId = `maintenance:${saveId}:${now}:${automation.id}`;
  if (isRequestProcessed(state, requestId)) {
    return { state };
  }

  // If the player cannot afford the maintenance, sink what we can? No —
  // `transfer()` throws InsufficientFundsError. The automation path treats
  // maintenance as a hard cost: if the player can't pay, the automation
  // still ran its action this tick (the action already executed) but the
  // maintenance transfer fails and the whole executeAutomation is rolled
  // back to `insufficient-resources`. To keep the action's effects AND
  // signal the shortfall, we instead skip the maintenance transfer when
  // funds are insufficient (the automation runs "unmaintained" this tick —
  // @provisional; a future maintenance-debt ledger is P6+).
  const balance = getBalance(state, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID);
  if (balance < perTick) {
    // Cannot afford maintenance — record nothing, automation still ran.
    // @provisional: a maintenance-debt ledger would accrue the shortfall.
    return { state };
  }

  const afterTransfer = transfer(state, {
    sourceAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
    destinationAccount: PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
    amount: perTick.toString(10),
    category: CATEGORY_MAINTENANCE,
    description: `Maintenance: ${automation.id} (${automation.type})`,
    timestamp: now,
    requestId,
  });

  // Mirror the new player balance to player.personalCash (same coupling as
  // P3a/P3b/P3c — the ledger is the source of truth, player.personalCash is
  // a denormalized view for the UI).
  const newBalance = afterTransfer.economy.accounts.find(
    (a) => a.id === PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
  )?.balance;
  let next: GameState = afterTransfer;
  if (newBalance !== undefined && newBalance !== next.player.personalCash) {
    next = {
      ...next,
      player: { ...next.player, personalCash: newBalance },
    };
  }
  const lastTxn = next.economy.transactions[next.economy.transactions.length - 1];
  const transactionId = lastTxn?.id;
  // Under exactOptionalPropertyTypes, an explicit `undefined` is not assignable
  // to an optional `string`, so only spread the field in when it is present.
  return transactionId !== undefined
    ? { state: next, transactionId }
    : { state: next };
}

/**
 * Execute an automation's action for the current tick.
 *
 * See the module doc for the full contract. Pure: returns a new state +
 * events, never mutates the input. Deterministic given the inputs.
 */
export function executeAutomation(
  state: GameState,
  automation: AutomationState,
  params: ExecuteAutomationParams,
): SystemResult {
  const { now, stepSeconds, rng } = params;
  // Reference rng so the parameter is not flagged unused — future stochastic
  // failure modes (equipment breakdown) will draw from this sub-stream.
  void rng;

  const events: SimulationEvent[] = [];
  const automationId = automation.id;

  // 1. Pre-check resource inputs.
  if (!hasResources(state, automation)) {
    events.push({
      type: 'automation-skipped',
      at: now,
      payload: { automationId, reason: 'insufficient-resources' },
    });
    return { state, events };
  }

  // 1b. Pre-check the energy pool (P7c — resolves R-P6-3). If the automation
  //     has a positive `energyConsumption` and the pool has less than the
  //     per-fire draw, skip with reason `insufficient-resources` (the frozen
  //     `automation-skipped` reason enum has no `insufficient-energy` variant,
  //     so the energy shortfall reuses the resources reason — energy IS a
  //     resource). `lastRunAt` is NOT advanced (retries next tick when the
  //     pool is replenished by solar generation). Equipment with
  //     `energyConsumption <= 0` (solar-panel, battery, harvester-t1) passes.
  if (automation.energyConsumption > 0 && !hasEnergy(state.world.environment, automation.energyConsumption, stepSeconds)) {
    events.push({
      type: 'automation-skipped',
      at: now,
      payload: { automationId, reason: 'insufficient-resources' },
    });
    return { state, events };
  }

  // 2. Build + dispatch the action.
  const actionSpec = buildAction(automation);
  let next: GameState = state;
  if (actionSpec !== undefined) {
    try {
      const result = dispatch(next, { type: actionSpec.type, payload: actionSpec.payload } as never);
      next = result.state;
      // Carry the action's own events (e.g. water-applied) so consumers see
      // the full effect chain alongside the automation-triggered event.
      events.push(...result.events);
    } catch {
      // Graceful failure — automation must not crash the sim (GDD §16.3,
      // mirrors P3c's insufficient-funds handling). Do NOT advance lastRunAt
      // so the automation retries next tick.
      events.push({
        type: 'automation-skipped',
        at: now,
        payload: { automationId, reason: 'insufficient-resources' },
      });
      return { state, events };
    }
  }

  // 3. Apply resource consumption (deduct from inventory).
  next = { ...next, inventory: deductResources(next, automation) };

  // 4. Debit the energy pool for this fire (P7c — resolves R-P6-3) + apply
  //    the automation's environmental impact (pillar 4 — GDD §9.1, §95). The
  //    energy debit is the per-fire draw (`energyConsumption × dtDays`, see
  //    `computeEnergyDebit`), debited from `environment.energy.stored` (clamped
  //    at 0). The impact routing — incl. `landDisturbance → landUse.degraded`,
  //    which P6b2 left payload-only (R-P6-4) — is centralized in
  //    `environment/impact.ts`; both are pure transforms over the environment.
  //    The pre-check (step 1b) already guaranteed the pool covers the draw.
  next = {
    ...next,
    world: {
      ...next.world,
      environment: (() => {
        let env = next.world.environment;
        if (automation.energyConsumption > 0) {
          env = {
            ...env,
            energy: {
              ...env.energy,
              stored: debitEnergy(env, automation.energyConsumption, stepSeconds),
            },
          };
        }
        return applyEnvironmentalImpact(env, automation.environmentalImpact, stepSeconds);
      })(),
    },
  };

  // 5. Apply maintenance cost (pillar 4 — money moves through the ledger).
  const maintenanceResult = applyMaintenance(next, automation, now, stepSeconds);
  next = maintenanceResult.state;

  // 6. Advance lastRunAt. Find the automation in next.automation and update.
  //    (The action dispatch may have restructured state, but the automation
  //    array identity is preserved — actions don't rewrite state.automation
  //    except the automation-management actions, which aren't dispatched by
  //    executeAutomation.)
  next = {
    ...next,
    automation: next.automation.map((a) =>
      a.id === automationId ? { ...a, lastRunAt: now } : a,
    ),
  };

  // 7. Emit automation-triggered.
  events.push({
    type: 'automation-triggered',
    at: now,
    payload: {
      automationId,
      policy: automation.policy ?? {
        kind: 'schedule' as const,
        condition: automation.schedule,
        action: actionSpec?.type ?? 'no-op',
        actionParams: (actionSpec?.payload as Record<string, unknown>) ?? {},
      },
      actionExecuted: actionSpec?.type ?? 'no-op',
    },
  });

  return { state: next, events };
}

// Re-export the category constants for tests / audit.
export { CATEGORY_MAINTENANCE, CATEGORY_EQUIPMENT };
