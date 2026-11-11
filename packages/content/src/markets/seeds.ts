/**
 * Seeds market definition (P3b — TDD §10.6, GDD §8.5).
 *
 * Seeds are a future commodity — P3b defines the market so the pricing +
 * inflation index has a 5-market basket from day one, but no action yet
 * consumes them (no `apply-seeds` action). The `commodityId` is the
 * canonical inventory `resourceId` for future wiring.
 *
 * PROVISIONAL pricing per GDD §17. $2.00 / seed packet = 200 minor units.
 */
import type { MarketDefinition } from './index.js';

export const SEEDS_MARKET: MarketDefinition = {
  id: 'market:seeds',
  commodityId: 'resource:seeds',
  basePrice: '200', // $2.00 / packet (PROVISIONAL)
  category: 'consumable',
  unit: 'packet',
  description:
    'Seed packets for planting additional trees (P7+ expansion). No ' +
    'apply-seeds action yet — P3b defines the market so the inflation ' +
    'basket has 5 commodities from day one.',
};
