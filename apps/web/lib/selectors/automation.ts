/**
 * Automation selectors (P6d1 — TDD §12, GDD §9).
 *
 * Pure helpers that derive view-ready data from `GameState` slices. Kept in
 * `lib/selectors/` so the AutomationPanel + its sub-components stay
 * presentational and the join logic (AutomationState → EquipmentDefinition)
 * lives in one testable place.
 *
 *   - `getAffordableEquipment(state)` — equipment whose one-time `cost` the
 *     player's `personalCash` covers. Used to disable Purchase buttons in the
 *     shop (the engine re-checks affordability at dispatch time — this is the
 *     UX pre-flight).
 *   - `getAutomationWithEquipment(state)` — joins each `AutomationState` with
 *     its `EquipmentDefinition` via `automation.type === equipment.id` (the
 *     purchase-equipment handler sets `type = equipment.id`, P6b2). Returns
 *     `{ automation, equipment }` pairs; `equipment` is `undefined` if the
 *     automation wasn't derived from registered equipment (legacy / hand-built).
 *   - `formatPolicySummary(policy)` — one-line human summary of an
 *     `AutomationPolicy` (threshold / schedule / event). Mirrors the examples
 *     in the P6d1 spec: "Water when soil water < 30%", "Every 1 sim day",
 *     "On weather-damage".
 *   - `getCooldownRemaining(automation, clock)` — sim seconds until the
 *     automation can fire again (0 when ready). Mirrors P6b2's
 *     `evaluateAutomation` cooldown math.
 *
 * Rule 6 (rendering / UI reads state, never writes): every function here is
 * pure — given the same inputs it returns the same output, no side effects.
 */
import type {
  AutomationPolicy,
  AutomationState,
  EquipmentDefinition,
  GameState,
  SimulationClock,
} from '@capitalist-tree/shared';
import { EQUIPMENT, getEquipmentById } from '@capitalist-tree/content';

/** A joined automation + equipment pair (equipment may be undefined). */
export interface AutomationWithEquipment {
  readonly automation: AutomationState;
  readonly equipment: EquipmentDefinition | undefined;
}

/**
 * Parse a bigint-as-string minor-units value defensively. Returns `0n` for
 * anything that isn't a clean non-negative integer literal. Mirrors
 * `lib/format/money.ts`'s `parseMinorUnits` (kept local so the selector file
 * has no runtime dependency on the format module — pure data in, pure data out).
 */
function parseCash(minorStr: string): bigint {
  if (typeof minorStr !== 'string' || !/^\s*\d+\s*$/.test(minorStr)) return 0n;
  try {
    return BigInt(minorStr.trim());
  } catch {
    return 0n;
  }
}

/**
 * Equipment the player can afford right now (one-time `cost` ≤
 * `personalCash`). Returns a fresh array; does not mutate `EQUIPMENT`.
 */
export function getAffordableEquipment(state: GameState): EquipmentDefinition[] {
  const cash = parseCash(state.player.personalCash);
  return EQUIPMENT.filter((e) => parseCash(e.cost) <= cash);
}

/**
 * Join each `state.automation` entry with its `EquipmentDefinition` via
 * `automation.type === equipment.id` (the purchase-equipment handler sets
 * `type = equipment.id`, P6b2). Returns `{ automation, equipment }` pairs in
 * the same order as `state.automation`; `equipment` is `undefined` for
 * legacy / hand-built automations with no matching definition.
 */
export function getAutomationWithEquipment(state: GameState): AutomationWithEquipment[] {
  return state.automation.map((automation) => ({
    automation,
    equipment: getEquipmentById(automation.type),
  }));
}

// ----------------------------------------------------------------------------
// Policy summary formatting (view-only — does NOT execute the policy).
// ----------------------------------------------------------------------------

/**
 * Derive a human verb from a policy's `action` string. Falls back to the raw
 * action string for unknown actions so the summary is never empty.
 */
function actionVerb(action: string): string {
  if (action === 'apply-water') return 'Water';
  if (action === 'apply-fertilizer') return 'Fertilize';
  if (action === 'harvest-leaves') return 'Harvest';
  return action;
}

/**
 * Turn a dotted field path into a short human label. Takes the last segment
 * and splits camelCase into words: `'world.environment.soil.soilWater'` →
 * `'soil water'`. Falls back to the full path if splitting yields nothing.
 */
function fieldLabel(field: string): string {
  const last = field.split('.').pop() ?? field;
  const split = last.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return split || field;
}

/**
 * Format a threshold `value`. Fractions in (0, 1] render as a percentage
 * (e.g. `0.3` → `'30%'`); other numbers render as-is. This matches the spec
 * example "Water when soil < 30%" for soil-moisture fraction readings while
 * keeping integer readings (e.g. leaf counts) readable.
 */
function thresholdValueLabel(value: number): string {
  if (value > 0 && value <= 1) return `${Math.round(value * 100)}%`;
  return String(value);
}

const SECONDS_PER_DAY = 24 * 60 * 60;
const SECONDS_PER_HOUR = 60 * 60;

/**
 * One-line human summary of an `AutomationPolicy`. Pure. Examples:
 *   - threshold → `"Water when soil water < 30%"`
 *   - schedule (interval, 86400s) → `"Every 1 sim day"`
 *   - schedule (interval, 3600s) → `"Every 1 sim hour"`
 *   - schedule (at, 12345) → `"Once at sim t=12345s"`
 *   - event → `"On weather-damage"`
 */
export function formatPolicySummary(policy: AutomationPolicy): string {
  switch (policy.kind) {
    case 'threshold': {
      const { field, op, value } = policy.condition;
      return `${actionVerb(policy.action)} when ${fieldLabel(field)} ${op} ${thresholdValueLabel(value)}`;
    }
    case 'schedule': {
      const { kind, value } = policy.condition;
      if (kind === 'interval') {
        if (value >= SECONDS_PER_DAY) {
          const days = Math.round(value / SECONDS_PER_DAY);
          return `Every ${days} sim day${days === 1 ? '' : 's'}`;
        }
        if (value >= SECONDS_PER_HOUR) {
          const hours = Math.round(value / SECONDS_PER_HOUR);
          return `Every ${hours} sim hour${hours === 1 ? '' : 's'}`;
        }
        return `Every ${value}s`;
      }
      // kind === 'at' — one-shot at absolute sim seconds.
      return `Once at sim t=${value}s`;
    }
    case 'event':
      return `On ${policy.condition.eventType}`;
  }
}

/**
 * Sim seconds remaining until the automation can fire again. Mirrors P6b2's
 * `evaluateAutomation` cooldown math: `lastRunAt + cooldownSeconds > now` →
 * the gap is `lastRunAt + cooldownSeconds - now`, clamped at 0. Returns 0 when
 * the automation has no cooldown or is already ready.
 */
export function getCooldownRemaining(
  automation: AutomationState,
  clock: SimulationClock,
): number {
  const lastRunAt = automation.lastRunAt ?? 0;
  const cooldownSeconds = automation.cooldownSeconds ?? 0;
  if (cooldownSeconds <= 0) return 0;
  const ready = lastRunAt + cooldownSeconds;
  const remaining = ready - clock.elapsedSeconds;
  return remaining > 0 ? Math.ceil(remaining) : 0;
}
