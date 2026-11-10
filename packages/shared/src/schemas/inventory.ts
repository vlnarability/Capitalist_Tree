import { z } from 'zod';

/**
 * Player inventory (TDD §5.1 root state).
 *
 * Holds physical resources the player owns (water, fertilizer, seeds,
 * equipment). P0 leaves it empty; P2/P3 populate.
 */
export const inventoryStateSchema = z.object({
  // Map of resourceId -> quantity (number, since these are physical units,
  // not currency). Stored as an array of {id, qty} for JSON portability.
  items: z.array(
    z.object({
      resourceId: z.string().min(1),
      quantity: z.number().nonnegative(),
    }),
  ),
});
export type InventoryState = z.infer<typeof inventoryStateSchema>;
