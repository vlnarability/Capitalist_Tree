/**
 * Typed errors for the automation module (P6b2 — TDD §12, GDD §9).
 *
 * Each error is a real `class` so callers can use `instanceof` for routing
 * (e.g. the UI surfaces "unknown automation" as a toast without crashing the
 * engine). The AutomationSystem itself never throws for graceful failure
 * conditions (cooldown / disabled / condition-not-met / insufficient-resources)
 * — those are converted into `automation-skipped` events. These errors are for
 * *programmer* mistakes: an action referencing an automation/equipment id that
 * does not exist, or a policy an equipment does not support.
 *
 * The errors are NOT part of the saved GameState — they are runtime-only
 * signals, mirroring the economy module's `economy/errors.ts` pattern. They
 * live here (not in `@capitalist-tree/shared`) because P6b1 was not allowed to
 * extend the shared error surface, and P6b2 stays in the simulation package
 * (`packages/shared/` is out of scope per the P6b2 task contract).
 */
import type { AutomationPolicy } from '@capitalist-tree/shared';

/** An automation action referenced an `automationId` not in `state.automation`. */
export class UnknownAutomationError extends Error {
  readonly automationId: string;

  constructor(automationId: string) {
    super(
      `Unknown automation "${automationId}". Register the automation via ` +
        `the purchase-equipment action before referencing it.`,
    );
    this.name = 'UnknownAutomationError';
    this.automationId = automationId;
  }
}

/** A purchase-equipment action referenced an unknown `equipmentId`. */
export class UnknownEquipmentError extends Error {
  readonly equipmentId: string;

  constructor(equipmentId: string) {
    super(
      `Unknown equipment "${equipmentId}". Register the equipment in ` +
        `packages/content/src/equipment/index.ts.`,
    );
    this.name = 'UnknownEquipmentError';
    this.equipmentId = equipmentId;
  }
}

/**
 * A `set-automation-policy` action tried to attach a policy whose `kind` or
 * `action` the underlying equipment does not declare support for (content
 * gate). Thrown rather than silently accepted so the caller gets a clear
 * signal that the policy would never fire / would execute an unsupported
 * action.
 */
export class UnsupportedPolicyError extends Error {
  readonly automationId: string;
  readonly policy: AutomationPolicy;
  readonly reason: string;

  constructor(automationId: string, policy: AutomationPolicy, reason: string) {
    super(
      `Unsupported policy for automation "${automationId}": ${reason}. ` +
        `The equipment's supportedActions / supportedPolicies must declare ` +
        `the policy's action and kind.`,
    );
    this.name = 'UnsupportedPolicyError';
    this.automationId = automationId;
    this.policy = policy;
    this.reason = reason;
  }
}
