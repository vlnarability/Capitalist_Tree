/**
 * Resources module — public surface (P2 — TDD §8).
 *
 * All resource logic is split across pure functions in this directory. The
 * ResourceSystem (systems/resource-system.ts) is the only writer to:
 *   - `state.world.environment.soil.{soilWater, nutrients, contamination,
 *     organicMatter, health}`
 *   - `state.world.environment.freshwater.{availability, groundwater}`
 *   - `originalTree.water.stored`           (water uptake + transpiration)
 *   - `originalTree.nutrients.{N,P,K}`      (nutrient absorption + consumption)
 *
 * P1's BiologySystem previously owned a placeholder uptake that mirrored env
 * into tree.water/nutrients. P2's ResourceSystem replaces the placeholder:
 * the full water + nutrient balance (conservation-enforced) is owned here.
 * BiologySystem no longer mutates tree.water.stored or tree.nutrients; it
 * reads them (via photosynthesis's `waterFactor` / `nutrientFactor`) to
 * compute Liebig factors. The values are populated by ResourceSystem's
 * uptake from env.soil.soilWater + env.soil.nutrients.
 *
 * P3 (EconomySystem) consumes the fertilizer-applied event payload (for
 * inventory + cash transactions). P4 (renderer) reads soil.health,
 * soil.soilWater, soil.nutrients for UI display.
 */
export * from './types.js';
export * from './water.js';
export * from './nutrients.js';
export * from './soil.js';
