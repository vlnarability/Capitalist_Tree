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
 * Automation state (TDD §12).
 *
 * Automation has meaningful costs (energy, maintenance, environmental impact)
 * — GDD pillar 4. P0 leaves an empty automation list.
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
});
export type AutomationState = z.infer<typeof automationStateSchema>;
