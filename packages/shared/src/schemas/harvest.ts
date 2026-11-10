import { z } from 'zod';

/**
 * Currency issuance request (TDD §10.2).
 *
 * P1's HarvestSystem produces a `CurrencyIssuanceRequest` whenever the player
 * harvests leaves. P3's EconomySystem consumes it and applies monetary
 * authority policy (issuance limits, inflation, etc.) before crediting the
 * player. P1 does NOT mutate `state.economy` directly — it emits the request
 * as a `harvest-completed` SimulationEvent (see events-biology.ts) and lets
 * P3's EconomySystem handle the actual currency creation.
 *
 * `amount` is bigint minor units serialized as string (TDD §10.1).
 */
export const currencyIssuanceRequestSchema = z.object({
  /** Tree whose leaves were harvested. */
  treeId: z.string().min(1),
  /** Amount to issue, in minor currency units (bigint-as-string). */
  amount: z.string(),
  /** Currency id (matches `economy.markets[*].commodityId`). */
  currencyId: z.string().min(1),
  /** Reason for issuance, for audit trail / P3 categorisation. */
  source: z.string().min(1),
});
export type CurrencyIssuanceRequest = z.infer<typeof currencyIssuanceRequestSchema>;

/**
 * HarvestResult (TDD §7.5).
 *
 * Pure output of the `harvestLeaves` biology function. The HarvestAction
 * handler applies it to the tree's state and emits a `harvest-completed`
 * SimulationEvent carrying the result so P3 (EconomySystem) can read the
 * currency-issuance request.
 *
 * Invariants:
 *   - `leavesHarvested >= 0`
 *   - `leavesHarvested <= foliageBefore`
 *   - `foliageAfter === foliageBefore - leavesHarvested`
 *   - `leavesHarvested <= foliageBefore * species.maximumHarvestFraction`
 *     (the engine enforces the per-action cap)
 */
export const harvestResultSchema = z.object({
  /** Tree that was harvested. */
  treeId: z.string().min(1),
  /** Leaves actually removed (capped by availability and species fraction). */
  leavesHarvested: z.number().int().nonnegative(),
  /** Foliage count before the harvest. */
  foliageBefore: z.number().int().nonnegative(),
  /** Foliage count after the harvest (= foliageBefore - leavesHarvested). */
  foliageAfter: z.number().int().nonnegative(),
  /** Active leaf area before the harvest. */
  activeLeafAreaBefore: z.number().nonnegative(),
  /** Active leaf area after the harvest. */
  activeLeafAreaAfter: z.number().nonnegative(),
  /** Photosynthetic capacity (eu/day) before the harvest. */
  photosyntheticCapacityBefore: z.number().nonnegative(),
  /** Photosynthetic capacity (eu/day) after the harvest. */
  photosyntheticCapacityAfter: z.number().nonnegative(),
  /** Stress added immediately by the harvest (in [0, 1]). */
  stressInduced: z.number().min(0).max(1),
  /** Energy cost the tree will pay to regrow the harvested foliage (eu). */
  energyCost: z.number().nonnegative(),
  /** Currency issuance request P3 will fulfil. */
  currencyIssuance: currencyIssuanceRequestSchema,
  /** Simulation time at which the harvest was performed (sim seconds). */
  at: z.number().int().nonnegative(),
});
export type HarvestResult = z.infer<typeof harvestResultSchema>;

/**
 * Estimated sustainable harvest level (GDD §5.4).
 *
 * The game exposes this to the player as a soft guideline — it is the number
 * of leaves the tree could lose without driving reserves into decline given
 * its current production rate. The player is free to harvest more or less.
 */
export const sustainableHarvestEstimateSchema = z.object({
  treeId: z.string().min(1),
  /** Estimated sustainable leaves-per-day harvest at current conditions. */
  leavesPerDay: z.number().nonnegative(),
  /** Fraction of current foliage this corresponds to (for UI display). */
  fractionOfFoliage: z.number().min(0).max(1),
  /** Current photosynthetic production (eu/day). */
  productionPerDay: z.number().nonnegative(),
  /** Current maintenance consumption (eu/day). */
  maintenancePerDay: z.number().nonnegative(),
});
export type SustainableHarvestEstimate = z.infer<typeof sustainableHarvestEstimateSchema>;
