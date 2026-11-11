/**
 * Water market definition (P3b — TDD §10.6, GDD §8.5).
 *
 * The water market is where the player buys irrigation water. The
 * `commodityId` doubles as the inventory `resourceId` — purchases credit
 * `{ resourceId: 'resource:water', quantity }` to `inventory.items`. P2's
 * `apply-water` action will consume from this inventory in P3c (P3b only
 * verifies the ids match so the purchase→apply chain is consistent).
 *
 * PROVISIONAL pricing per GDD §17 ("Exact inflation model"). The base price
 * is in bigint minor currency units serialized as string (TDD §10.1).
 * $0.10 / litre = 10 minor units per litre (PROVISIONAL).
 */
import type { MarketDefinition } from './index.js';

export const WATER_MARKET: MarketDefinition = {
  id: 'market:water',
  commodityId: 'resource:water',
  basePrice: '10', // $0.10 / litre (PROVISIONAL)
  category: 'consumable',
  unit: 'litre',
  description:
    'Irrigation water for the plot. Apply via the apply-water action (P2). ' +
    'Purchases credit the inventory; P3c will wire the apply-water handler ' +
    'to consume from inventory before applying to the soil.',
};
