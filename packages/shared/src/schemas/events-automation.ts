import { z } from 'zod';
import { automationPolicySchema } from './automation.js';

/**
 * Automation-related SimulationEvent variants (P6b1 — TDD §12, GDD §9).
 *
 * Added to the `SimulationEvent` discriminated union via
 * `packages/shared/src/schemas/events.ts`. P6b1 introduces the *schema*
 * layer only; the AutomationSystem that emits these events lands in P6b2.
 *
 * Per TDD §12, automation actions are processed by the simulation engine —
 * the rendering layer MUST NOT execute automation independently. These events
 * are the engine's *output* channel for automation: they tell the UI / audit
 * layer what the AutomationSystem decided each tick without handing it the
 * authority to run actions.
 *
 *   - `automation-triggered`: a policy fired and the engine executed the
 *     policy's `action`. Carries the policy + the action type string that
 *     ran, so consumers can replay/audit without reaching into state.
 *   - `automation-skipped`: a policy was eligible to fire this tick but the
 *     engine declined to run it. The `reason` discriminates cooldown /
 *     disabled / condition-not-met / insufficient-resources so the UI can
 *     surface the right feedback (e.g. "paused", "no water in inventory").
 *   - `equipment-purchased`: the `purchase-equipment` action succeeded —
 *     money moved through the ledger and a new automation was instantiated.
 *     Carries the cost (audit) + the new automation id (so the UI can track
 *     the spawned automation).
 *
 * HOW TO EXTEND: add a new variant with a unique `type` literal. Do NOT
 * loosen the union with a catch-all.
 */

/**
 * `automation-triggered` event — a policy fired and its action ran.
 *
 * Emitted by the AutomationSystem (P6b2) after it dispatched the policy's
 * `action` through `executeAction`. `actionExecuted` is the `GameAction['type']`
 * string that ran (e.g. `'apply-water'`). The full action payload is NOT
 * duplicated here — it lives on the paired action event (e.g.
 * `water-applied`); this event records the *automation decision*, the action
 * event records the *action result*.
 */
export const automationTriggeredEventSchema = z.object({
  type: z.literal('automation-triggered'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    /** Automation that fired. */
    automationId: z.string().min(1),
    /** The policy that matched (full object, for audit/replay). */
    policy: automationPolicySchema,
    /** The `GameAction['type']` string that was executed. */
    actionExecuted: z.string().min(1),
  }),
});
export type AutomationTriggeredEvent = z.infer<typeof automationTriggeredEventSchema>;

/**
 * `automation-skipped` event — a policy was eligible but the engine declined.
 *
 * Emitted by the AutomationSystem (P6b2) when it evaluated a policy this tick
 * and chose NOT to run the action. Reasons:
 *   - `cooldown`: the automation ran recently and `lastRunAt + cooldownSeconds`
 *     has not yet elapsed (prevents a persistently-true threshold from firing
 *     every tick).
 *   - `disabled`: `AutomationState.enabled === false` (paused by the player).
 *   - `condition-not-met`: a `threshold` policy's reading did not satisfy the
 *     operator, or an `event` policy's `eventType` did not fire this tick, or
 *     a `schedule` policy's cadence has not elapsed.
 *   - `insufficient-resources`: the policy's action would consume resources
 *     the player doesn't have (e.g. an irrigation policy with no water in
 *     inventory). The engine declines rather than throwing — automation
 *     failure must not crash the sim (mirrors P3c's graceful insufficient-
 *     funds handling, GDD §16.3).
 */
export const automationSkippedEventSchema = z.object({
  type: z.literal('automation-skipped'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    /** Automation that was evaluated and skipped. */
    automationId: z.string().min(1),
    /** Why the engine declined to run the action this tick. */
    reason: z.enum(['cooldown', 'disabled', 'condition-not-met', 'insufficient-resources']),
  }),
});
export type AutomationSkippedEvent = z.infer<typeof automationSkippedEventSchema>;

/**
 * `equipment-purchased` event — the `purchase-equipment` action succeeded.
 *
 * Emitted by the `purchase-equipment` action handler (P6b2) after it debited
 * `cost` from `player:personal` via `transfer()` and appended a new
 * `AutomationState` to `state.automation`. `cost` is the bigint minor-units
 * string that moved through the ledger (audit trail — pairs with the
 * `transaction-recorded` event from the underlying `transfer()`).
 *
 * `automationId` is the id of the freshly-instantiated automation so the UI
 * can track the spawned equipment alongside the purchase.
 */
export const equipmentPurchasedEventSchema = z.object({
  type: z.literal('equipment-purchased'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    /** Equipment definition id that was purchased. */
    equipmentId: z.string().min(1),
    /** Id of the automation instantiated from the equipment. */
    automationId: z.string().min(1),
    /** Cost debited from `player:personal` (bigint minor units as string). */
    cost: z.string(),
  }),
});
export type EquipmentPurchasedEvent = z.infer<typeof equipmentPurchasedEventSchema>;
