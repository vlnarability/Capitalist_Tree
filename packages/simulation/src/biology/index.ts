/**
 * Biology module — public surface (TDD §7).
 *
 * All biology logic is split across pure functions in this directory. The
 * BiologySystem (systems/biology-system.ts) is the only writer to TreeState
 * biology fields; the pure functions take a tree + context and return deltas
 * or new values that the system applies.
 *
 * P3 (EconomySystem) consumes the `CurrencyIssuanceRequest` carried by
 * `HarvestResult` (see harvest.ts). P4 (renderer) reads `tree.health`,
 * `tree.foliage.activeLeafArea`, and other fields but never writes them.
 */
export * from './types.js';
export * from './photosynthesis.js';
export * from './energy-allocation.js';
export * from './reserves.js';
export * from './seasons.js';
export * from './growth.js';
export * from './stress.js';
export * from './health.js';
export * from './death.js';
export * from './harvest.js';
export * from './species-registry.js';
