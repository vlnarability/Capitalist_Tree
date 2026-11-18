/**
 * Equipment market definition (P13-A / GAP-22 — TDD §10.6, GDD §8.5).
 *
 * Equipment is a durable good (not a consumable) — the player buys tools +
 * machinery that improve productivity (e.g. irrigation pumps, harvesters).
 * The `commodityId` matches the `EQUIPMENT_FACTORY` business output
 * (`packages/content/src/businesses/manufacturing.ts`) + the
 * `market:equipment` id that factory's `marketParticipation` already targets,
 * so the dangling reference P3b left is now resolved.
 *
 * PROVISIONAL pricing: $200 / unit = 20 000 minor units
 * (PROVISIONAL_MARKET_PRICE_EQUIPMENT). Durable-goods depreciation is a future
 * category-specific pricing extension (index.ts `category` doc); P13-A ships
 * the uniform pricing model — the market joins the inflation basket + responds
 * to supply/demand like the consumables.
 */
import type { MarketDefinition } from './index.js';

export const EQUIPMENT_MARKET: MarketDefinition = {
  id: 'market:equipment',
  commodityId: 'resource:equipment',
  basePrice: '20000', // $200 / unit (PROVISIONAL — matches PROVISIONAL_MARKET_PRICE_EQUIPMENT)
  category: 'equipment',
  unit: 'unit',
  description:
    'Durable equipment (pumps, harvesters, tools) that improves productivity. ' +
    'The commodityId matches the EQUIPMENT_FACTORY output; a future ' +
    'equipment-purchase action will credit durable inventory + apply a ' +
    'productivity modifier. Category-specific depreciation pricing is a ' +
    'future extension — P13-A uses the uniform supply/demand model.',
};
