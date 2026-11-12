/**
 * Automation action handlers (P6b2 — TDD §12, GDD §9).
 *
 * Four player-facing actions live here, registered in the action dispatch
 * (`packages/simulation/src/actions/handlers.ts`) and dispatched by
 * `executeAction` via the `actionHandlers` map:
 *
 *   - `set-automation-policy`: attach/replace the condition-based trigger on
 *     an existing automation. Validates the policy's `action` is in the
 *     underlying equipment's `supportedActions` and the policy's `kind` is in
 *     its `supportedPolicies` (content gate), when the equipment can be
 *     resolved from the automation's `type` field (the
 *     `purchase-equipment` handler sets `type = equipment.id`).
 *   - `enable-automation` / `disable-automation`: flip `enabled`. Idempotent
 *     on an already-enabled / already-disabled automation (no event emitted
 *     in the idempotent case).
 *   - `purchase-equipment`: buy a piece of equipment and instantiate an
 *     automation from its definition. Debits `cost` from `player:personal`
 *     via `transfer()` (sink to the virtual authority — money leaves
 *     circulation, pillar 1), derives an `AutomationState` from the
 *     definition, appends it to `state.automation`, emits
 *     `equipment-purchased`. Idempotent on the `requestId` so a replayed
 *     purchase (e.g. after a save/load mid-action) does not double-charge or
 *     spawn a duplicate automation.
 *
 * All handlers are pure: they return a new state + events without mutating
 * the input. Deterministic given (state, action).
 *
 * Money NEVER silently created or destroyed (TDD §10.4): equipment purchases
 * are `transfer()` calls with `destinationAccount = authority` (a sink);
 * `monetarySupply` decreases, `totalSinks` increases. The conservation
 * invariant holds by construction.
 */
import type {
  AutomationState,
  GameState,
  SimulationEvent,
  SetAutomationPolicyAction,
  EnableAutomationAction,
  DisableAutomationAction,
  PurchaseEquipmentAction,
  EquipmentDefinition,
  ResourceCost,
} from '@capitalist-tree/shared';
import {
  PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
  PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
} from '@capitalist-tree/shared';
import { getEquipmentById } from '@capitalist-tree/content';
import type { ActionListener } from '../actions/handlers.js';
import {
  transfer,
  isRequestProcessed,
  parseAmount,
} from '../economy/ledger.js';
import {
  UnknownAutomationError,
  UnknownEquipmentError,
  UnsupportedPolicyError,
} from './errors.js';

/** Equipment purchase transaction category (mirrors execute.ts; kept local to
 *  avoid a circular import actions.ts → execute.ts → handlers.ts → actions.ts).
 *  Categories are free-form strings (NOT Zod enums) per
 *  `packages/shared/src/constants/economy.ts`. */
const CATEGORY_EQUIPMENT = 'equipment';

const SECONDS_PER_DAY = 24 * 60 * 60;

/**
 * Default schedule for a freshly purchased automation: interval 86400 (one
 * fire per sim day). The player can reconfigure via `set-automation-policy`
 * (which replaces the policy, taking precedence over the legacy schedule).
 * @provisional — GDD §17 tuning.
 */
const DEFAULT_PURCHASE_SCHEDULE = { kind: 'interval' as const, value: SECONDS_PER_DAY };

// @provisional (GDD §17: automation cost/effectiveness balance) — per-fire
// resource amounts used to derive `AutomationState.resourceConsumption` from
// an equipment's `supportedActions` at purchase time (P7c — resolves R-P6-6,
// docs/offline-automation.md §6.6). The exact per-fire draw depends on the
// policy's `actionParams` (e.g. `apply-water` litres), which are not known at
// purchase; these nominal values gate the inventory pre-check ("does the
// player have water / fertilizer to run this?") until a future phase derives
// the amount from the policy's actionParams at fire time. Promote to decided
// shared constants once playtesting calibrates the per-fire resource draw.
const PROVISIONAL_AUTOMATION_WATER_PER_FIRE = 5; // resource:water units / fire
const PROVISIONAL_AUTOMATION_FERTILIZER_PER_FIRE = 1; // resource:fertilizer units / fire

/**
 * Derive an automation's `resourceConsumption` from its equipment's
 * `supportedActions` (P7c — resolves R-P6-6).
 *
 * P6b2 seeded `resourceConsumption: []` for every freshly-purchased automation,
 * so automations that feed a resource-consuming action (e.g. `apply-water`)
 * did not pre-check inventory for the resource itself — the action handler
 * still gated on its own pool (soil water), but the inventory accounting was
 * empty. P7c derives the array from `supportedActions`:
 *
 *   - `apply-water`     → `resource:water` (PROVISIONAL_AUTOMATION_WATER_PER_FIRE)
 *   - `apply-fertilizer`→ `resource:fertilizer` (PROVISIONAL_AUTOMATION_FERTILIZER_PER_FIRE)
 *   - `harvest-leaves`  → (none — harvesting produces `pendingIssuances`
 *     currency, it consumes no inventory resource)
 *   - monitoring/energy equipment (empty `supportedActions`) → (none)
 *
 * Duplicate actions on one equipment merge by `resourceId` (sum amounts) so a
 * theoretical `['apply-water', 'apply-water']` doesn't double-declare. Pure:
 * takes the definition, returns the array. @provisional — future actions
 * (`apply-pesticide`, etc.) add their own mapping here.
 */
function deriveResourceConsumption(equipment: EquipmentDefinition): ResourceCost[] {
  const merged = new Map<string, number>();
  for (const action of equipment.supportedActions) {
    if (action === 'apply-water') {
      merged.set(
        'resource:water',
        (merged.get('resource:water') ?? 0) + PROVISIONAL_AUTOMATION_WATER_PER_FIRE,
      );
    } else if (action === 'apply-fertilizer') {
      merged.set(
        'resource:fertilizer',
        (merged.get('resource:fertilizer') ?? 0) + PROVISIONAL_AUTOMATION_FERTILIZER_PER_FIRE,
      );
    }
    // 'harvest-leaves' + unknown actions: no inventory resource consumed.
  }
  return [...merged.entries()].map(([resourceId, amount]) => ({ resourceId, amount }));
}

/**
 * Look up the automation by id. Throws `UnknownAutomationError` if not found.
 */
function requireAutomation(state: GameState, automationId: string): AutomationState {
  const automation = state.automation.find((a) => a.id === automationId);
  if (!automation) {
    throw new UnknownAutomationError(automationId);
  }
  return automation;
}

/**
 * Resolve the equipment backing an automation, if any.
 *
 * The `purchase-equipment` handler sets `automation.type = equipment.id`. For
 * legacy / manually-constructed automations whose `type` is not an equipment
 * id, this returns `undefined` and policy validation is skipped (the action
 * is accepted without a content gate — @provisional, the schema does not yet
 * require an explicit `equipmentId` field).
 */
function resolveEquipment(automation: AutomationState): EquipmentDefinition | undefined {
  return getEquipmentById(automation.type);
}

/**
 * `set-automation-policy` action handler (P6b2 — TDD §12).
 *
 * Replaces the `policy` on the matching automation. Validates:
 *   - The automation exists (`UnknownAutomationError`).
 *   - If the equipment backing the automation can be resolved, the policy's
 *     `kind` is in `supportedPolicies` and the policy's `action` is in
 *     `supportedActions` (`UnsupportedPolicyError`). Monitoring/energy
 *     equipment with empty `supportedActions` rejects action-bearing policies.
 *
 * Pure: returns a new state, never mutates input.
 */
export const setAutomationPolicyHandler: ActionListener<SetAutomationPolicyAction> = (
  state,
  action,
) => {
  const { automationId, policy } = action.payload;
  const automation = requireAutomation(state, automationId);

  // Content gate — only when the equipment is resolvable.
  const equipment = resolveEquipment(automation);
  if (equipment) {
    if (!equipment.supportedPolicies.includes(policy.kind)) {
      throw new UnsupportedPolicyError(
        automationId,
        policy,
        `policy kind "${policy.kind}" not in supportedPolicies [${equipment.supportedPolicies.join(', ')}]`,
      );
    }
    if (policy.action !== 'no-op' && !equipment.supportedActions.includes(policy.action)) {
      throw new UnsupportedPolicyError(
        automationId,
        policy,
        `action "${policy.action}" not in supportedActions [${equipment.supportedActions.join(', ')}]`,
      );
    }
  }

  const next: GameState = {
    ...state,
    automation: state.automation.map((a) =>
      a.id === automationId ? { ...a, policy } : a,
    ),
  };
  const events: SimulationEvent[] = [
    {
      type: 'system',
      at: state.clock.elapsedSeconds,
      payload: {
        systemId: 'AutomationSystem',
        message: `Policy set on automation "${automationId}": ${policy.kind} → ${policy.action}`,
        data: { automationId, policyKind: policy.kind, action: policy.action },
      },
    },
  ];
  return { state: next, events };
};

/**
 * `enable-automation` action handler (P6b2 — TDD §12).
 *
 * Sets `enabled = true`. Idempotent — enabling an already-enabled automation
 * is a no-op (state unchanged, no event). Throws `UnknownAutomationError` for
 * an unknown automation id.
 */
export const enableAutomationHandler: ActionListener<EnableAutomationAction> = (
  state,
  action,
) => {
  const { automationId } = action.payload;
  const automation = requireAutomation(state, automationId);
  if (automation.enabled) {
    // Idempotent — already enabled.
    return { state, events: [] };
  }
  const next: GameState = {
    ...state,
    automation: state.automation.map((a) =>
      a.id === automationId ? { ...a, enabled: true } : a,
    ),
  };
  const events: SimulationEvent[] = [
    {
      type: 'system',
      at: state.clock.elapsedSeconds,
      payload: {
        systemId: 'AutomationSystem',
        message: `Automation "${automationId}" enabled.`,
      },
    },
  ];
  return { state: next, events };
};

/**
 * `disable-automation` action handler (P6b2 — TDD §12).
 *
 * Sets `enabled = false` (pause without removing). Idempotent on an already-
 * disabled automation. The automation retains its policy + schedule +
 * `lastRunAt` so re-enabling resumes the same configuration.
 */
export const disableAutomationHandler: ActionListener<DisableAutomationAction> = (
  state,
  action,
) => {
  const { automationId } = action.payload;
  const automation = requireAutomation(state, automationId);
  if (!automation.enabled) {
    // Idempotent — already disabled.
    return { state, events: [] };
  }
  const next: GameState = {
    ...state,
    automation: state.automation.map((a) =>
      a.id === automationId ? { ...a, enabled: false } : a,
    ),
  };
  const events: SimulationEvent[] = [
    {
      type: 'system',
      at: state.clock.elapsedSeconds,
      payload: {
        systemId: 'AutomationSystem',
        message: `Automation "${automationId}" disabled.`,
      },
    },
  ];
  return { state: next, events };
};

/**
 * Derive a deterministic automation id from a purchase action.
 *
 * `automation:<equipmentId>:<targetId>:<index>` where `<index>` is the post-
 * purchase length of `state.automation` (so two purchases of the same
 * equipment for the same target get distinct ids). Deterministic given the
 * same purchase sequence (TDD §18.3).
 */
function deriveAutomationId(
  state: GameState,
  equipmentId: string,
  targetId: string,
): string {
  const index = state.automation.length;
  return `automation:${equipmentId}:${targetId}:${index}`;
}

/**
 * Derive the deterministic purchase `requestId` (idempotency key) from the
 * action inputs. Same (saveId, equipmentId, targetId, index) always produces
 * the same id — a replayed purchase (e.g. after a save/load mid-action) is
 * detected via `processedRequestIds` and rejected without double-charging.
 */
function derivePurchaseRequestId(
  state: GameState,
  equipmentId: string,
  targetId: string,
): string {
  const saveId = state.metadata.saveId;
  const index = state.automation.length;
  return `equipment:${saveId}:${equipmentId}:${targetId}:${index}`;
}

/**
 * `purchase-equipment` action handler (P6b2 — TDD §12, GDD §9).
 *
 *   1. Resolve the equipment by `equipmentId` via `getEquipmentById` (content
 *      gate — unknown id raises `UnknownEquipmentError`).
 *   2. Debit `definition.cost` from `player:personal` via `transfer()`
 *      (category `'equipment'`, sink to the virtual authority — money leaves
 *      circulation). The `requestId` makes the purchase idempotent: a replay
 *      (same requestId already in `processedRequestIds`) returns state
 *      unchanged with no events.
 *   3. Derive an `AutomationState` from the definition
 *      (energyConsumption, maintenanceCost, environmentalImpact from the
 *      EquipmentDefinition; resourceConsumption left empty — derived in a
 *      future phase from supportedActions; schedule = interval 1 sim day;
 *      enabled=true; lastRunAt=0; cooldownSeconds=0).
 *   4. Append the automation to `state.automation`.
 *   5. Emit `equipment-purchased` carrying cost + new automation id.
 *
 * Money is a transaction (bigint, requestId). The conservation invariant
 * holds (sink transfer).
 */
export const purchaseEquipmentHandler: ActionListener<PurchaseEquipmentAction> = (
  state,
  action,
) => {
  const { equipmentId, targetId } = action.payload;
  const definition = getEquipmentById(equipmentId);
  if (!definition) {
    throw new UnknownEquipmentError(equipmentId);
  }

  const requestId = derivePurchaseRequestId(state, equipmentId, targetId);

  // Idempotency: if this purchase was already processed (replay after
  // save/load), return state unchanged with no events.
  if (isRequestProcessed(state, requestId)) {
    return { state, events: [] };
  }

  const cost = parseAmount(definition.cost, 'cost');
  const timestamp = state.clock.elapsedSeconds;

  // Debit the player:personal account, sinking the cost to the authority.
  // Insufficient funds propagate as InsufficientFundsError (the action layer
  // surfaces it — unlike recurring expenses, an equipment purchase is a
  // discrete player action and should fail loudly if unaffordable).
  let next: GameState = transfer(state, {
    sourceAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
    destinationAccount: PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
    amount: cost.toString(10),
    category: CATEGORY_EQUIPMENT,
    description: `Purchase equipment ${equipmentId} for ${targetId}`,
    timestamp,
    requestId,
  });

  // Mirror the new player balance to player.personalCash.
  const newBalance = next.economy.accounts.find(
    (a) => a.id === PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
  )?.balance;
  if (newBalance !== undefined && newBalance !== next.player.personalCash) {
    next = {
      ...next,
      player: { ...next.player, personalCash: newBalance },
    };
  }

  // Derive the automation id from the post-transfer state (automation array
  // unchanged by the transfer — same index as before).
  const automationId = deriveAutomationId(state, equipmentId, targetId);

  // Derive the AutomationState from the equipment definition.
  const automation: AutomationState = {
    id: automationId,
    type: definition.id, // link back to the equipment for policy validation
    enabled: true,
    targetId,
    schedule: { ...DEFAULT_PURCHASE_SCHEDULE },
    // P7c — derived from the equipment's supportedActions (resolves R-P6-6).
    // Irrigation → resource:water; fertilization → resource:fertilizer;
    // harvesting / monitoring / energy → [] (they produce currency / readings /
    // power, not consume inventory resources). See deriveResourceConsumption.
    resourceConsumption: deriveResourceConsumption(definition),
    energyConsumption: definition.baseEnergyConsumption,
    maintenanceCost: definition.baseMaintenanceCost,
    environmentalImpact: { ...definition.baseEnvironmentalImpact },
    lastRunAt: 0,
    cooldownSeconds: 0,
    // No policy by default — the player sets one via set-automation-policy.
    // The legacy `schedule` (interval 1 day) drives the cadence until then.
  };

  next = {
    ...next,
    automation: [...next.automation, automation],
  };

  const events: SimulationEvent[] = [
    {
      type: 'transaction-recorded',
      at: timestamp,
      payload: {
        record: next.economy.transactions[next.economy.transactions.length - 1]!,
      },
    },
    {
      type: 'equipment-purchased',
      at: timestamp,
      payload: {
        equipmentId,
        automationId,
        cost: cost.toString(10),
      },
    },
  ];

  return { state: next, events };
};

