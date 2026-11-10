import { z } from 'zod';

/**
 * Resource-related GameAction variants (P2 — TDD §8.2, §8.3).
 *
 * Added to the `GameAction` discriminated union via
 * `packages/shared/src/schemas/actions.ts`. P2 introduces:
 *
 *   - `apply-water`: player-initiated irrigation. Adds water to the soil
 *     water pool (capped at soil water capacity; excess becomes runoff).
 *     P3 will hook into this for the actual cash transaction; P2 just mutates
 *     the soil water state and emits a `water-applied` event.
 *   - `apply-fertilizer`: player-initiated fertilizer application. Adds
 *     NPK to the soil nutrient pool (capped at nutrient capacity; excess
 *     becomes contamination per GDD §8.3). P3 will hook into this for the
 *     actual cash + inventory transaction; P2 just mutates the soil state
 *     and emits a `fertilizer-applied` event.
 *
 * HOW TO EXTEND: add a new variant with a unique `type` literal. Do NOT
 * loosen the union with a catch-all.
 */

export const applyWaterActionSchema = z.object({
  type: z.literal('apply-water'),
  payload: z.object({
    /** Litres of water to apply to the soil. */
    litres: z.number().nonnegative(),
    /**
     * Tree to irrigate. MUST match `originalTree.id` (or, later, an owned
     * tree id). P2 uses this only for the event payload — water is applied
     * to the shared soil pool, not directly to the tree.
     */
    treeId: z.string().min(1).optional(),
  }),
});
export type ApplyWaterAction = z.infer<typeof applyWaterActionSchema>;

export const applyFertilizerActionSchema = z.object({
  type: z.literal('apply-fertilizer'),
  payload: z.object({
    /** Fertilizer id (must be registered in `packages/content/src/fertilizers/`). */
    fertilizerId: z.string().min(1),
    /** Units to apply (each unit adds the fertilizer's full NPK composition). */
    units: z.number().int().positive(),
    /**
     * Tree to fertilize. MUST match `originalTree.id` (or, later, an owned
     * tree id). P2 uses this only for the event payload — fertilizer is
     * applied to the shared soil nutrient pool, not directly to the tree.
     */
    treeId: z.string().min(1).optional(),
  }),
});
export type ApplyFertilizerAction = z.infer<typeof applyFertilizerActionSchema>;
