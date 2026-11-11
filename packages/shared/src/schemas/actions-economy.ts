import { z } from 'zod';

/**
 * Economy-related GameAction variants (P3b — TDD §10.5, §10.6, GDD §8.5).
 *
 * P3a shipped NO player actions (issuance was system-internal). P3b adds the
 * first one: `purchase`. Player buys a commodity (water, fertilizer, seeds,
 * food, energy) from a market — cash debited from `player:personal`,
 * inventory credited with `{ resourceId: market.commodityId, quantity }`,
 * market supply/demand adjusted, transaction recorded with category
 * `'purchase'`. The price may shift (immediately on purchase, and on each
 * EconomySystem tick).
 *
 * Future P3c actions deferred from this file:
 *   - `pay-expense`: pay a living expense (debits `player:personal`, sinks to
 *     the authority, records an `expense`/`sink` transaction).
 *   - `transfer`: internal transfer between player-owned accounts (TDD §10.5).
 *
 * P3d will add the `sell-tree` guard (refuses to sell the original tree,
 * GDD §16.1/16.2).
 *
 * HOW TO EXTEND: add a new variant with a unique `type` literal. Register a
 * handler in `packages/simulation/src/actions/handlers.ts`. The handler
 * signature is `(state, action) => { state, events }`. Keep actions pure —
 * never mutate input state. Reject unknown action types with
 * `UnknownActionError` (handled centrally by `executeAction`).
 *
 * Re-exported from `packages/shared/src/schemas/actions.ts` so consumers can
 * `import { PurchaseAction } from '@capitalist-tree/shared'`.
 */

/**
 * `purchase` action — player buys `quantity` units of a commodity from a
 * market (P3b — TDD §10.5, §10.6, GDD §8.5).
 *
 * Steps performed by the handler:
 *   1. Resolve the market by id; reject with `UnknownMarketError` if unknown.
 *   2. Compute cost = `market.price * quantity` (bigint).
 *   3. Transfer `cost` from `player:personal` to `market:<id>` via P3a's
 *      `transfer()` (category `'purchase'`). Validates sufficient funds.
 *   4. Credit `inventory.items` with `{ resourceId: market.commodityId,
 *      quantity }` (incrementing if the resource is already in inventory).
 *   5. Adjust market supply/demand: `supply -= quantity`, `demand +=
 *      quantity` (the purchase raises demand for the next tick and draws
 *      down the available stock).
 *   6. Emit a `purchase-completed` event carrying the full result.
 *
 * The `marketId` MUST match an entry in `economy.markets` (or content
 * `ALL_MARKETS`). `quantity` is a positive integer.
 */
export const purchaseActionSchema = z.object({
  type: z.literal('purchase'),
  payload: z.object({
    /** Market id, e.g. `'market:water'`, `'market:fertilizer'`. */
    marketId: z.string().min(1),
    /** Units to buy (>= 1). Each unit is priced at the market's current
     *  `price` (minor currency units per unit). */
    quantity: z.number().int().positive(),
  }),
});
export type PurchaseAction = z.infer<typeof purchaseActionSchema>;
