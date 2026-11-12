import { z } from 'zod';

export const resourceCostSchema = z.object({
  resourceId: z.string().min(1),
  amount: z.number().nonnegative(),
});
export type ResourceCost = z.infer<typeof resourceCostSchema>;

export const environmentalImpactSchema = z.object({
  carbonEmissions: z.number(),
  waterConsumption: z.number(),
  soilDegradation: z.number(),
  pollution: z.number(),
  landDisturbance: z.number(),
  biodiversityImpact: z.number(),
});
export type EnvironmentalImpact = z.infer<typeof environmentalImpactSchema>;

export const automationScheduleSchema = z.object({
  // Crontab-like trigger; for P0 we only support `interval` (every N sim seconds)
  // and `at` (one-shot at given sim time).
  kind: z.enum(['interval', 'at']),
  // For 'interval': every N sim seconds. For 'at': absolute sim seconds.
  value: z.number().int().nonnegative(),
});
export type AutomationSchedule = z.infer<typeof automationScheduleSchema>;

/**
 * Operator set supported by `threshold` policies (TDD §12).
 *
 * The AutomationSystem (P6b2) evaluates `state[...] op value` against a
 * numeric reading drawn from game state by `field` path. Kept deliberately
 * small — richer predicates (ranges, boolean AND) can be layered later
 * without breaking saves (policies are content, not persisted on the
 * AutomationState's own required shape).
 */
export const automationThresholdOperatorSchema = z.enum(['<', '>', '==', '>=', '<=']);
export type AutomationThresholdOperator = z.infer<typeof automationThresholdOperatorSchema>;

/**
 * Automation policy (P6b1 — TDD §12, GDD §9).
 *
 * A policy is a condition-based *trigger* that selects when an automation
 * runs, distinct from the P0 `schedule` (interval/at) which fires purely on
 * a clock. Policies let automation react to game state ("water when soil
 * moisture drops below 30") or to emitted events ("harvest when a
 * leaf-maturity event fires") rather than only on a fixed cadence.
 *
 * Discriminated union on `kind`:
 *   - `threshold`: fires when a numeric state reading satisfies
 *     `{field, op, value}`. `field` is a dotted path into GameState the
 *     AutomationSystem resolves (e.g. `'world.environment.soil.soilWater'`,
 *     `'originalTree.health'`). The reading MUST be numeric; non-numeric
 *     readings are treated as condition-not-met (P6b2 emits
 *     `automation-skipped`).
 *   - `event`: fires when a SimulationEvent of the given `eventType` is
 *     emitted during the same tick. `eventType` is a literal matching one of
 *     the `SimulationEvent['type']` strings (e.g. `'weather-damage'`,
 *     `'season-changed'`).
 *   - `schedule`: fires per a clock `AutomationSchedule` (reuses the P0
 *     schedule shape). Present so a single policy object can express both
 *     reactive and clocked triggers uniformly; legacy automations that only
 *     set `AutomationState.schedule` keep working without a policy.
 *
 * `action` is the `GameAction['type']` string to execute when the policy
 * fires (e.g. `'apply-water'`, `'apply-fertilizer'`, `'harvest-leaves'`).
 * `actionParams` carries the action's arguments (e.g. `{ litres: 5 }`,
 * `{ fertilizerId: '...', units: 1 }`) so the policy fully describes the
 * action without the AutomationSystem needing extra configuration.
 *
 * The policy does NOT itself move money or resources — it only describes
 * *when* and *what* to run. The executed GameAction goes through the normal
 * `executeAction` pipeline (TDD §4.1), so economy/resource invariants still
 * hold. The rendering layer MUST NOT execute policies directly (TDD §12:
 * "rendering layer should not execute automation independently").
 *
 * PROVISIONAL: the field-path resolution semantics, the event-type matching
 * rules, and the cooldown/threshold tuning are all provisional per GDD §17.
 */
export const automationPolicySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('threshold'),
    condition: z.object({
      field: z.string().min(1),
      op: automationThresholdOperatorSchema,
      value: z.number(),
    }),
    action: z.string().min(1),
    actionParams: z.record(z.string(), z.unknown()),
  }),
  z.object({
    kind: z.literal('event'),
    condition: z.object({
      eventType: z.string().min(1),
    }),
    action: z.string().min(1),
    actionParams: z.record(z.string(), z.unknown()),
  }),
  z.object({
    kind: z.literal('schedule'),
    condition: automationScheduleSchema,
    action: z.string().min(1),
    actionParams: z.record(z.string(), z.unknown()),
  }),
]);
export type AutomationPolicy = z.infer<typeof automationPolicySchema>;

/**
 * Automation state (TDD §12).
 *
 * Automation has meaningful costs (energy, maintenance, environmental impact)
 * — GDD pillar 4. P0 leaves an empty automation list.
 *
 * P6b1 extensions (backward compatible — all new fields are optional):
 *   - `policy`: an optional condition-based trigger (see `automationPolicySchema`).
 *     Absent on P0/P1/P2/P3/P4/P5/P6a automations that rely solely on
 *     `schedule`. Present when the automation is configured to react to
 *     thresholds or events rather than (or in addition to) a fixed cadence.
 *   - `lastRunAt`: simulation seconds at which this automation last
 *     executed its action. The AutomationSystem (P6b2) uses this together
 *     with `cooldownSeconds` to skip runs that would fire too soon.
 *   - `cooldownSeconds`: minimum gap (sim seconds) between two executions.
 *     Prevents a threshold policy that stays true from firing every tick.
 *
 * The P0 `schedule` field is retained unchanged so interval/at automations
 * keep working without a policy. When both `schedule` and `policy` are set,
 * P6b2's AutomationSystem treats the policy as authoritative for *when* to
 * fire and `schedule` as the fallback cadence (exact precedence is
 * provisional, GDD §17).
 */
export const automationStateSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  enabled: z.boolean(),
  targetId: z.string().min(1),
  schedule: automationScheduleSchema,
  resourceConsumption: z.array(resourceCostSchema),
  energyConsumption: z.number().nonnegative(),
  maintenanceCost: z.string(),
  environmentalImpact: environmentalImpactSchema,
  // P6b1 additions (TDD §12, GDD §9). All optional for backward compatibility
  // with P0–P6a interval-only automations. Migration v7 -> v8 backfills
  // `lastRunAt` and `cooldownSeconds` to 0 on existing entries; `policy` is
  // left absent (no natural default for a discriminated union).
  policy: automationPolicySchema.optional(),
  lastRunAt: z.number().int().nonnegative().optional(),
  cooldownSeconds: z.number().int().nonnegative().optional(),
});
export type AutomationState = z.infer<typeof automationStateSchema>;
