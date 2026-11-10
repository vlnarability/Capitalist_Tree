import { z } from 'zod';

/**
 * Biology-related GameAction variants (P1 — TDD §7.5).
 *
 * These are added to the `GameAction` discriminated union via
 * `packages/shared/src/schemas/actions.ts`. P1 introduces:
 *
 *   - `harvest-leaves`: player-initiated leaf harvest. The handler calls the
 *     pure `harvestLeaves` biology function, applies the result to the tree
 *     state (foliage reduction, stress, damage record), and emits a
 *     `harvest-completed` SimulationEvent carrying the `HarvestResult` (which
 *     in turn carries the `CurrencyIssuanceRequest` P3 will fulfil).
 *
 * HOW TO EXTEND: add a new variant with a unique `type` literal. Do NOT loosen
 * the union with a catch-all.
 */

export const harvestLeavesActionSchema = z.object({
  type: z.literal('harvest-leaves'),
  payload: z.object({
    /** Tree to harvest. MUST match `originalTree.id` (or, later, an owned tree id). */
    treeId: z.string().min(1),
    /** Requested leaf count. The handler caps this to the available foliage and
     *  the species' `maximumHarvestFraction`. */
    requestedLeaves: z.number().int().nonnegative(),
  }),
});
export type HarvestLeavesAction = z.infer<typeof harvestLeavesActionSchema>;
