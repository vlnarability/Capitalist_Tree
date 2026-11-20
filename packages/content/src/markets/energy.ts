/**
 * Energy market definition (P3b — TDD §10.6, GDD §8.5, §6.3).
 *
 * Energy (utilities) is one of the player's recurring living expenses
 * (GDD §7.1, §6.3 — Utilities). P3c's `pay-expense` action will consume
 * from this market. The `commodityId` is the canonical inventory
 * `resourceId` for energy units.
 *
 * PROVISIONAL pricing per GDD §17. $0.50 / kWh-equivalent = 50 minor units.
 */
import type { MarketDefinition } from './index.js';

export const ENERGY_MARKET: MarketDefinition = {
  id: 'market:energy',
  commodityId: 'resource:energy',
  basePrice: '50', // $0.50 / kWh-equiv (PROVISIONAL)
  category: 'consumable',
  unit: 'kWh',
  // P13-B / GAP-24: energy is pricier abroad (1.2×) — the player's region
  // has cheap renewables, so exporting surplus energy (or energy-dense
  // goods) earns a 20% premium. PROVISIONAL per GDD §17.
  foreignPriceMultiplier: 1.2,
  description:
    "Energy (utilities) for the player (living expense, GDD §7.1). P3c's " +
    'pay-expense action will consume from this market; P3b defines the ' +
    'market and the price so the inflation basket covers GDD §6.3.',
};
