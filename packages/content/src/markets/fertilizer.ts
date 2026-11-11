/**
 * Fertilizer market definition (P3b — TDD §10.6, GDD §8.5).
 *
 * The fertilizer market sells the Balanced 10-10-10 NPK fertilizer. The
 * `commodityId` matches `fertilizer:balanced-10-10-10` (the existing
 * content registry id) so the purchase→apply-fertilizer chain is consistent:
 * the player buys units → inventory credits `{ resourceId:
 * 'fertilizer:balanced-10-10-10', quantity }` → the apply-fertilizer action
 * looks the fertilizer up by the same id (P3c will wire the inventory
 * deduction).
 *
 * PROVISIONAL pricing per GDD §17. The base price matches the existing
 * `BALANCED_10_10_10.costMinor` field (`'500'` = $5.00) — the market's
 * `basePrice` is the canonical starting price; the `Fertilizer.costMinor`
 * field is preserved for backward-compat with P2 content tests.
 */
import type { MarketDefinition } from './index.js';

export const FERTILIZER_MARKET: MarketDefinition = {
  id: 'market:fertilizer',
  commodityId: 'fertilizer:balanced-10-10-10',
  basePrice: '500', // $5.00 / unit (PROVISIONAL — matches BALANCED_10_10_10.costMinor)
  category: 'consumable',
  unit: 'unit',
  description:
    'Balanced 10-10-10 NPK fertilizer. Apply via the apply-fertilizer action ' +
    '(P2) with fertilizerId "fertilizer:balanced-10-10-10". P3c will wire ' +
    'the apply-fertilizer handler to consume from inventory.',
};
