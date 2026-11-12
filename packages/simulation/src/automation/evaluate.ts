/**
 * Automation policy evaluation (P6b2 — TDD §12, GDD §9).
 *
 * Pure helpers that decide *whether* an automation should fire this tick.
 * The matching `executeAutomation` helper (see `execute.ts`) actually runs the
 * action — separation of "when" from "what" keeps the policy engine auditable
 * (TDD §12: "Automation actions should be processed by the simulation engine.
 * The rendering layer should not execute automation independently.").
 *
 * Evaluation order (mirrors the `automation-skipped` event `reason` enum):
 *   1. `disabled`        — `AutomationState.enabled === false` (paused).
 *   2. `cooldown`        — `lastRunAt + cooldownSeconds > now` (ran too
 *                          recently; prevents a persistently-true threshold
 *                          from firing every tick).
 *   3. `condition-not-met`— the policy's trigger did not match this tick:
 *                          - threshold: the field reading did not satisfy the
 *                            operator, or the field path did not resolve to a
 *                            number.
 *                          - event: the event type was not emitted this tick.
 *                          - schedule: the cadence boundary has not been
 *                            reached / the interval has not elapsed since the
 *                            last run.
 *
 * If none of the above apply, `shouldRun === true` and `executeAutomation` is
 * called. Note `insufficient-resources` is NOT an evaluation outcome — it is
 * an *execution* outcome (the policy fired but the action could not run for
 * lack of resources); `executeAutomation` emits it.
 *
 * PROVISIONAL (GDD §17):
 *   - Field-path resolution semantics for `threshold` policies. The path is a
 *     dotted lookup into `GameState` (e.g. `'world.environment.soil.soilWater'`,
 *     `'originalTree.health'`). Non-numeric readings are treated as
 *     condition-not-met.
 *   - Event-triggered policies: the AutomationSystem receives the current
 *     tick's emitted events via the `tickEvents` parameter (the system collects
 *     events emitted by earlier systems this step and passes them in). This
 *     wires the `event` policy kind; prior drafts left it as a TODO.
 *   - Cooldown / threshold tuning constants.
 */
import type { AutomationState, GameState } from '@capitalist-tree/shared';

/** Why an automation was skipped this tick (matches the event `reason` enum). */
export type SkipReason = 'cooldown' | 'disabled' | 'condition-not-met';

export interface EvaluateResult {
  /** True if the automation's action should run this tick. */
  shouldRun: boolean;
  /** Present (and shouldRun === false) when the automation was skipped. */
  reason?: SkipReason;
}

/**
 * Resolve a dotted field path into a numeric reading from GameState.
 *
 * Returns `undefined` if any segment is missing or the leaf is not a finite
 * number. The caller treats `undefined` as condition-not-met (TDD §12 +
 * `automation-skipped` reason `condition-not-met`).
 *
 * @provisional The exact path semantics (e.g. whether to support array
 * indices, computed derivations) — GDD §17.
 */
export function resolveNumericPath(state: GameState, path: string): number | undefined {
  if (path.length === 0) return undefined;
  const segments = path.split('.');
  let cursor: unknown = state;
  for (const seg of segments) {
    if (seg.length === 0) return undefined;
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[seg];
  }
  if (typeof cursor !== 'number' || !Number.isFinite(cursor)) return undefined;
  return cursor;
}

/**
 * Apply a threshold operator to a reading vs a target value.
 *
 * Pure: deterministic given (reading, op, value). Returns false for any
 * unrecognized operator (defensive — the schema enum constrains the set).
 */
export function applyThresholdOp(
  reading: number,
  op: '<' | '>' | '==' | '>=' | '<=',
  value: number,
): boolean {
  switch (op) {
    case '<':
      return reading < value;
    case '>':
      return reading > value;
    case '==':
      return reading === value;
    case '>=':
      return reading >= value;
    case '<=':
      return reading <= value;
    default:
      return false;
  }
}

/**
 * Evaluate an automation's policy for the current tick.
 *
 * `now` is the current simulation second (`ctx.now`, which equals
 * `state.clock.elapsedSeconds` after the TimeSystem has run). `tickEvents` is
 * the list of `SimulationEvent.type` strings emitted earlier in this same
 * step (used by `event` policies).
 *
 * Automations without a `policy` fall back to the P0 `schedule` (interval/at)
 * cadence — legacy interval-only automations keep working (the schema's
 * `policy` field is optional). When both are present, the policy is
 * authoritative for *when* to fire (`@provisional` precedence per the
 * automation schema comment).
 *
 * Pure: deterministic given (state, automation, now, tickEvents). Never
 * mutates state.
 */
export function evaluatePolicy(
  state: GameState,
  automation: AutomationState,
  now: number,
  tickEvents: readonly string[] = [],
): EvaluateResult {
  if (!automation.enabled) {
    return { shouldRun: false, reason: 'disabled' };
  }

  // Cooldown: lastRunAt + cooldownSeconds must have elapsed. Both fields are
  // optional (absent on P0–P6a interval-only automations); treat absence as
  // lastRunAt=0 / no cooldown.
  const lastRunAt = automation.lastRunAt ?? 0;
  const cooldownSeconds = automation.cooldownSeconds ?? 0;
  if (cooldownSeconds > 0 && lastRunAt + cooldownSeconds > now) {
    return { shouldRun: false, reason: 'cooldown' };
  }

  const policy = automation.policy;
  if (policy === undefined) {
    // No condition-based policy: fall back to the P0 schedule cadence.
    return evaluateSchedule(automation, now, lastRunAt);
  }

  switch (policy.kind) {
    case 'threshold': {
      const reading = resolveNumericPath(state, policy.condition.field);
      if (reading === undefined) {
        return { shouldRun: false, reason: 'condition-not-met' };
      }
      const ok = applyThresholdOp(reading, policy.condition.op, policy.condition.value);
      return ok ? { shouldRun: true } : { shouldRun: false, reason: 'condition-not-met' };
    }
    case 'event': {
      const ok = tickEvents.includes(policy.condition.eventType);
      return ok ? { shouldRun: true } : { shouldRun: false, reason: 'condition-not-met' };
    }
    case 'schedule': {
      return evaluateScheduleCondition(policy.condition.kind, policy.condition.value, now, lastRunAt);
    }
    default: {
      // Exhaustiveness guard — the discriminated union has no other kind.
      return { shouldRun: false, reason: 'condition-not-met' };
    }
  }
}

/**
 * Evaluate the P0 `AutomationState.schedule` (interval/at) cadence. Used both
 * as the fallback when no `policy` is set and as the implementation of a
 * `policy.kind === 'schedule'` trigger.
 *
 *   - `interval`: fire when `now` is on the cadence boundary
 *     (`now % value === 0`) AND at least `value` seconds have elapsed since
 *     the last run (`now - lastRunAt >= value`). The second clause prevents
 *     double-firing if multiple steps land on the same boundary (should not
 *     happen with a fixed 60s step, but is defensive).
 *   - `at`: one-shot. Fire when `now >= value` AND it has not fired yet
 *     (`lastRunAt < value`). After firing, `executeAutomation` sets
 *     `lastRunAt = now >= value`, so the second clause becomes false and the
 *     automation never fires again.
 */
export function evaluateSchedule(
  automation: AutomationState,
  now: number,
  lastRunAt: number,
): EvaluateResult {
  return evaluateScheduleCondition(
    automation.schedule.kind,
    automation.schedule.value,
    now,
    lastRunAt,
  );
}

/** Shared schedule-condition evaluator (used by both policy + legacy paths). */
function evaluateScheduleCondition(
  kind: 'interval' | 'at',
  value: number,
  now: number,
  lastRunAt: number,
): EvaluateResult {
  if (kind === 'interval') {
    if (value <= 0) {
      // A zero/negative interval never fires (avoids a divide-by-zero / always-
      // fire loop). @provisional — the schema allows 0; treat as disabled.
      return { shouldRun: false, reason: 'condition-not-met' };
    }
    const onBoundary = now % value === 0;
    const elapsedSinceRun = now - lastRunAt;
    if (onBoundary && elapsedSinceRun >= value) {
      return { shouldRun: true };
    }
    return { shouldRun: false, reason: 'condition-not-met' };
  }
  // kind === 'at' (one-shot).
  if (now >= value && lastRunAt < value) {
    return { shouldRun: true };
  }
  return { shouldRun: false, reason: 'condition-not-met' };
}
