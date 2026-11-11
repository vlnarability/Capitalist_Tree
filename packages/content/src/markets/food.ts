/**
 * Food market definition (P3b — TDD §10.6, GDD §8.5, §6.3).
 *
 * Food is one of the player's recurring living expenses (GDD §7.1, §6.3).
 * P3c's `pay-expense` action will consume from this market (player pays
 * `market:food.price × dailyFoodUnits` per day). The `commodityId` is the
 * canonical inventory `resourceId` for food units, so the same purchase
 * mechanic as water/fertilizer applies.
 *
 * PROVISIONAL pricing per GDD §17. $10.00 / food unit = 1000 minor units.
 */
import type { MarketDefinition } from './index.js';

export const FOOD_MARKET: MarketDefinition = {
  id: 'market:food',
  commodityId: 'resource:food',
  basePrice: '1000', // $10.00 / unit (PROVISIONAL)
  category: 'consumable',
  unit: 'unit',
  description:
    "Food for the player (living expense, GDD §7.1). P3c's pay-expense " +
    'action will consume from this market; P3b defines the market and the ' +
    'price so the inflation basket covers GDD §6.3 (Food, Housing, ' +
    'Utilities, Labor, Fertilizer, Equipment, Land, Services).',
};
