import { z } from 'zod';
import { automationPolicySchema } from './automation.js';

/**
 * Automation-related GameAction variants (P6b1 — TDD §12, GDD §9).
 *
 * Added to the `GameAction` discriminated union via
 * `packages/shared/src/schemas/actions.ts`. P6b1 introduces the *schema*
 * layer only; the action handlers + AutomationSystem land in P6b2. The
 * variants:
 *
 *   - `set-automation-policy`: attach/replace the condition-based trigger on
 *     an existing automation. The handler (P6b2) looks up the automation by
 *     `automationId`, validates its equipment supports the policy's `kind`,
 *     and stores `policy` on the `AutomationState`.
 *   - `enable-automation`: flip `enabled` to true (resume a paused
 *     automation). Idempotent — enabling an already-enabled automation is a
 *     no-op (P6b2 emits no event in that case).
 *   - `disable-automation`: flip `enabled` to false (pause without removing).
 *     Idempotent. The automation keeps its policy + schedule so re-enabling
 *     resumes from the same configuration.
 *   - `purchase-equipment`: buy a piece of equipment and instantiate an
 *     automation from its definition. The handler debits `cost` from
 *     `player:personal` via P3a's `transfer()` (category `'equipment'`), so
 *     money moves through the economy ledger (pillar 1: spending moves money,
 *     it doesn't vanish). `targetId` is the tree/plot the equipment serves.
 *
 * HOW TO EXTEND: add a new variant with a unique `type` literal. Register a
 * handler in `packages/simulation/src/actions/handlers.ts`. Keep actions pure
 * — never mutate input state. Reject unknown action types with
 * `UnknownActionError` (handled centrally by `executeAction`).
 *
 * Re-exported from `packages/shared/src/schemas/actions.ts` so consumers can
 * `import { SetAutomationPolicyAction } from '@capitalist-tree/shared'`.
 */

/**
 * `set-automation-policy` action — attach/replace a policy on an automation.
 *
 * The `automationId` MUST match an entry in `state.automation`. The handler
 * (P6b2) validates that the automation's underlying equipment declares the
 * policy's `kind` in its `supportedPolicies` (content gate), then stores
 * `policy` on the `AutomationState`. A `null`-able replacement is NOT
 * supported via this action — to clear a policy, disable the automation and
 * set a new schedule-only one. (Kept strict so the action payload fully
 * describes the resulting policy — determinism, TDD §18.3.)
 */
export const setAutomationPolicyActionSchema = z.object({
  type: z.literal('set-automation-policy'),
  payload: z.object({
    /** Id of the automation to reconfigure (must exist in `state.automation`). */
    automationId: z.string().min(1),
    /** The new policy (replaces any existing policy on this automation). */
    policy: automationPolicySchema,
  }),
});
export type SetAutomationPolicyAction = z.infer<typeof setAutomationPolicyActionSchema>;

/**
 * `enable-automation` action — resume a paused automation.
 *
 * Sets `AutomationState.enabled = true`. Idempotent on an already-enabled
 * automation (P6b2 no-ops without emitting an event). The `automationId` MUST
 * match an entry in `state.automation`; an unknown id raises
 * `UnknownAutomationError` (P6b2).
 */
export const enableAutomationActionSchema = z.object({
  type: z.literal('enable-automation'),
  payload: z.object({
    /** Id of the automation to enable. */
    automationId: z.string().min(1),
  }),
});
export type EnableAutomationAction = z.infer<typeof enableAutomationActionSchema>;

/**
 * `disable-automation` action — pause an automation without removing it.
 *
 * Sets `AutomationState.enabled = false`. Idempotent. The automation retains
 * its policy, schedule, and `lastRunAt` so re-enabling resumes the same
 * configuration (cooldown window continues to elapse while disabled, but no
 * new runs fire). The `automationId` MUST match an entry in
 * `state.automation`.
 */
export const disableAutomationActionSchema = z.object({
  type: z.literal('disable-automation'),
  payload: z.object({
    /** Id of the automation to disable. */
    automationId: z.string().min(1),
  }),
});
export type DisableAutomationAction = z.infer<typeof disableAutomationActionSchema>;

/**
 * `purchase-equipment` action — buy equipment and instantiate an automation.
 *
 * The handler (P6b2):
 *   1. Resolves the equipment by `equipmentId` via `getEquipmentById` (content
 *      gate — unknown id raises `UnknownEquipmentError`).
 *   2. Checks unlock requirements (tree maturity / player level) if present.
 *   3. Debits `definition.cost` from `player:personal` via P3a's `transfer()`
 *      (category `'equipment'`) — money moves through the ledger, never
 *      destroyed (pillar 1).
 *   4. Derives an `AutomationState` from the definition (energy, maintenance,
 *      environmental impact, supported actions) and appends it to
 *      `state.automation` with a deterministic id.
 *   5. Emits an `equipment-purchased` event carrying the cost + new
 *      automation id.
 *
 * `targetId` is the tree/plot the equipment serves (e.g. `'original'`). The
 * handler rejects `targetId` values that don't match an owned tree (P6b1 only
 * knows the original tree — GDD §16.1/16.2).
 */
export const purchaseEquipmentActionSchema = z.object({
  type: z.literal('purchase-equipment'),
  payload: z.object({
    /** Equipment id (must be registered in `packages/content/src/equipment/`). */
    equipmentId: z.string().min(1),
    /** Tree/plot the equipment serves (e.g. `'original'`). */
    targetId: z.string().min(1),
  }),
});
export type PurchaseEquipmentAction = z.infer<typeof purchaseEquipmentActionSchema>;
