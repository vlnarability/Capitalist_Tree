/**
 * Automation module — public surface (P6b2 — TDD §12, GDD §9).
 *
 * All automation logic lives here:
 *   - `errors.ts`: typed errors thrown by the action handlers
 *     (`UnknownAutomationError`, `UnknownEquipmentError`,
 *     `UnsupportedPolicyError`). Runtime-only signals; not part of the saved
 *     GameState.
 *   - `evaluate.ts`: pure `evaluatePolicy(state, automation, now, tickEvents)`
 *     — decides whether an automation should fire this tick (disabled /
 *     cooldown / condition-not-met).
 *   - `execute.ts`: pure `executeAutomation(state, automation, params)` —
 *     runs the automation's action via the normal `dispatch` pipeline,
 *     applies pillar-4 trade-offs (resource consumption, environmental
 *     impact, maintenance cost), advances `lastRunAt`, emits
 *     `automation-triggered` / `automation-skipped`.
 *   - `actions.ts`: the four automation GameAction handlers
 *     (set-automation-policy / enable-automation / disable-automation /
 *     purchase-equipment), registered in the action dispatch.
 *
 * The AutomationSystem (`packages/simulation/src/systems/automation.ts`) is
 * the only system that drives automation execution each tick; it calls
 * `evaluatePolicy` + `executeAutomation` for each entry in
 * `state.automation` in array order.
 *
 * Tests import these directly (`packages/simulation/test/automation.test.ts`)
 * to assert the invariants the GDD and TDD require:
 *   - Policy evaluation: threshold met/not-met, cooldown blocks, disabled
 *     blocks, schedule interval + at one-shot.
 *   - Execution: action dispatched, lastRunAt advanced, resourceConsumption
 *     applied, environmentalImpact accumulated, maintenanceCost moved via
 *     ledger, automation-triggered emitted.
 *   - Graceful failure: insufficient resources → automation-skipped,
 *     lastRunAt NOT advanced.
 *   - Purchase: money moved, automation added, equipment-purchased event,
 *     idempotency (same requestId → no double-charge).
 *   - Integration: a threshold-policy sprinkler auto-waters when soil drops
 *     below threshold.
 *   - Determinism: same seed → same automation decisions/events.
 *   - originalTree guard: the automation path does not bypass the action-
 *     layer sell-tree rejection (GDD §16.1/16.2).
 */
export * from './errors.js';
export * from './evaluate.js';
export * from './execute.js';
export * from './actions.js';
