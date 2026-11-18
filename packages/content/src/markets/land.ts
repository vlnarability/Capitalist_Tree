/**
 * Land market definition (P13-A / GAP-22 — TDD §10.6, GDD §8.5).
 *
 * Land is a spatial asset market — the player buys parcels to expand the
 * plantable area (more tree slots, buffer zones, restoration plots). The
 * `commodityId` `'land:parcel'` is a durable asset (not consumed on use); a
 * future buy-land action will credit a land holdings counter + expand the
 * plot capacity rather than credit the consumable inventory.
 *
 * PROVISIONAL pricing: $1 000 / parcel = 100 000 minor units
 * (PROVISIONAL_MARKET_PRICE_LAND). Location-multiplier pricing is a future
 * category-specific extension; P13-A uses the uniform supply/demand model so
 * the market joins the inflation basket + responds to monetary conditions.
 */
import type { MarketDefinition } from './index.js';

export const LAND_MARKET: MarketDefinition = {
  id: 'market:land',
  commodityId: 'land:parcel',
  basePrice: '100000', // $1 000 / parcel (PROVISIONAL — matches PROVISIONAL_MARKET_PRICE_LAND)
  category: 'land',
  unit: 'parcel',
  description:
    'Land parcels that expand the plantable area (tree slots, buffer zones, ' +
    'restoration plots). A durable asset — a future buy-land action credits a ' +
    'land holdings counter + expands plot capacity rather than the consumable ' +
    'inventory. Category-specific location-multiplier pricing is a future ' +
    'extension.',
};
