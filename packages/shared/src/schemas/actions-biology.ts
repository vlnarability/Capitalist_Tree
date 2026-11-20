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

/**
 * `plant-seed` action (GAP-19 / GDD §11.2 — Genetic Legacy: the seed production
 * → planting loop). Consumes ONE seed from the tree's `seeds` accumulator +
 * credits `PROVISIONAL_PROGRESSION_LEGACY_POINTS_PER_SEED` genetic-legacy points
 * to `state.progression.prestige.geneticLegacyPoints` (the prestige currency
 * that funds `unlock-research`). A mid-generation earning mechanism that
 * supplements the generation-end prestige bonus — gives the player a reason to
 * accumulate + plant seeds between prestige resets.
 *
 * The handler (`packages/simulation/src/actions/handlers.ts plantSeedHandler`):
 *   1. Resolves the tree (P1: only the original tree — rejects with an error if
 *      `treeId` doesn't match `originalTree.id`).
 *   2. Verifies `tree.seeds >= 1` (rejects with `InsufficientSeedsError` if 0 —
 *      the tree has produced no seeds to plant yet).
 *   3. Decrements `tree.seeds` by 1.
 *   4. Credits `PROVISIONAL_PROGRESSION_LEGACY_POINTS_PER_SEED` to
 *      `geneticLegacyPoints` (bigint string arithmetic — TDD §10.1 precision
 *      discipline, same as `unlock-research` / `prestige-reset`).
 *   5. Emits a `seed-planted` event carrying the seeds consumed (1), the seeds
 *      remaining, the points gained, + the resulting genetic-legacy balance.
 */
export const plantSeedActionSchema = z.object({
  type: z.literal('plant-seed'),
  payload: z.object({
    /** Tree to plant a seed from. MUST match `originalTree.id`. */
    treeId: z.string().min(1),
    /** Simulation second at which the planting runs (deterministic event `at`). */
    tick: z.number().int().nonnegative(),
  }),
});
export type PlantSeedAction = z.infer<typeof plantSeedActionSchema>;
