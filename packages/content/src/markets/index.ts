/**
 * Market content registry (P3b — TDD §10.6, GDD §8.5 — Market Simulation).
 *
 * Each market is a pure data object — the simulation engine reads it via
 * `findMarketById` and the initial-state factory seeds `economy.markets`
 * from `ALL_MARKETS` at game start. Content authors add new markets by
 * appending to `ALL_MARKETS`.
 *
 * The 5 P3b markets match GDD §8.5's "Initial markets" subset (water,
 * fertilizer, seeds, food, energy). P13-A / GAP-22 adds the three deferred
 * markets (equipment, labor, land) — purely additive: the pricing + inflation
 * pipeline auto-includes them. Category-specific pricing models (depreciation,
 * wage index, location multiplier) remain future extensions; P13-A uses the
 * uniform supply/demand model.
 *
 * PROVISIONAL: every `basePrice` is provisional per GDD §17 ("Exact
 * inflation model"). They are tuned for a starter $500 cash player so
 * a sapling-era player can afford enough water + fertilizer to bootstrap.
 */
import { WATER_MARKET } from './water.js';
import { FERTILIZER_MARKET } from './fertilizer.js';
import { SEEDS_MARKET } from './seeds.js';
import { FOOD_MARKET } from './food.js';
import { ENERGY_MARKET } from './energy.js';
import { EQUIPMENT_MARKET } from './equipment.js';
import { LABOR_MARKET } from './labor.js';
import { LAND_MARKET } from './land.js';

export { WATER_MARKET } from './water.js';
export { FERTILIZER_MARKET } from './fertilizer.js';
export { SEEDS_MARKET } from './seeds.js';
export { FOOD_MARKET } from './food.js';
export { ENERGY_MARKET } from './energy.js';
export { EQUIPMENT_MARKET } from './equipment.js';
export { LABOR_MARKET } from './labor.js';
export { LAND_MARKET } from './land.js';

/**
 * Market definition — pure data (TDD §10.6, GDD §8.5).
 *
 * A market's `basePrice` is the reference price the pricing model anchors
 * to. The actual `MarketState.price` on `economy.markets` starts at
 * `basePrice` and moves with supply/demand + monetary conditions.
 *
 * `commodityId` doubles as the inventory `resourceId` — purchases credit
 * the player's inventory with this id so the P2 `apply-water` /
 * `apply-fertilizer` actions can consume from inventory (P3c wires the
 * deduction; P3b verifies the ids match for end-to-end consistency).
 *
 * `category` is an extension point: P3b ships all 5 markets as
 * `'consumable'`. Future categories (`'equipment'`, `'labor'`, `'land'`)
 * can have different pricing models (depreciation, wage index, location
 * multiplier) — P3b's pricing model handles all categories uniformly.
 */
export interface MarketDefinition {
  /** Unique market id, e.g. `'market:water'`. */
  id: string;
  /** Commodity id (doubles as the inventory `resourceId`). */
  commodityId: string;
  /** Base price in bigint minor currency units (TDD §10.1), as string. */
  basePrice: string;
  /** Market category — extension point for future pricing models. */
  category: 'consumable' | 'equipment' | 'labor' | 'land';
  /** Unit of measure for display (e.g. `'litre'`, `'unit'`, `'kWh'`). */
  unit: string;
  /** Human-readable description for the UI / docs. */
  description: string;
}

/** All known markets. Add new markets here. */
export const ALL_MARKETS: readonly MarketDefinition[] = [
  WATER_MARKET,
  FERTILIZER_MARKET,
  SEEDS_MARKET,
  FOOD_MARKET,
  ENERGY_MARKET,
  // P13-A / GAP-22: the three GDD §8.5 markets P3b deferred. The pricing +
  // inflation pipeline auto-includes them; category-specific pricing models
  // (depreciation / wage-index / location-multiplier) are future extensions.
  EQUIPMENT_MARKET,
  LABOR_MARKET,
  LAND_MARKET,
];

/** Look up a market by id. Returns the market or `undefined` if unknown. */
export function findMarketById(marketId: string): MarketDefinition | undefined {
  return ALL_MARKETS.find((m) => m.id === marketId);
}

/** Look up a market by its `commodityId`. Returns the market or `undefined`. */
export function findMarketByCommodityId(commodityId: string): MarketDefinition | undefined {
  return ALL_MARKETS.find((m) => m.commodityId === commodityId);
}
