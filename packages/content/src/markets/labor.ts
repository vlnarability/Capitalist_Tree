/**
 * Labor market definition (P13-A / GAP-22 — TDD §10.6, GDD §8.5).
 *
 * Labor is a service market (not a storable commodity) — the player hires
 * person-days of work (e.g. for planting, pruning, harvesting crews). The
 * `commodityId` `'labor:person-day'` is NOT inventory-creditable (you cannot
 * stockpile labor); a future hire-labor action will consume cash + apply a
 * one-shot labor effect (e.g. a prune-all or plant-crew action) rather than
 * credit inventory. The player-side `perform-labor` action
 * (`packages/simulation/src/economy/actions.ts`) is the inverse — the player
 * sells their own labor for cash; this market is the buy side.
 *
 * PROVISIONAL pricing: $5 / person-day = 500 minor units
 * (PROVISIONAL_MARKET_PRICE_LABOR). Wage-index pricing is a future
 * category-specific extension; P13-A uses the uniform supply/demand model so
 * the market joins the inflation basket.
 */
import type { MarketDefinition } from './index.js';

export const LABOR_MARKET: MarketDefinition = {
  id: 'market:labor',
  commodityId: 'labor:person-day',
  basePrice: '500', // $5 / person-day (PROVISIONAL — matches PROVISIONAL_MARKET_PRICE_LABOR)
  category: 'labor',
  unit: 'person-day',
  description:
    'Hired labor (person-days) for crew actions — planting, pruning, harvest ' +
    'crews. NOT inventory-creditable: a future hire-labor action consumes ' +
    'cash + applies a one-shot labor effect. The player-side perform-labor ' +
    'action is the inverse (the player sells their own labor). Category-' +
    'specific wage-index pricing is a future extension.',
};
