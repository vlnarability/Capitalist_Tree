// @capitalist-tree/rendering — public API (P4a).
//
// P4a ships the TreeRenderData / EnvironmentRenderData / CurrencyVisual
// data contracts and the TreeRenderer interface. The simulation produces
// `TreeState` / `WorldState` / `SimulationClock`; this package transforms
// those into pure visual-data snapshots via `buildTreeRenderData` /
// `buildEnvironmentRenderData`, which the renderer (P4b Canvas, P4c
// environment + currency visuals, P4d React wrapper) consumes.
//
// Rule 6 (TDD §15.1, GDD §6.1): rendering reads state, NEVER writes.
// Everything in this package is a pure read of simulation state.
//
// Phase status:
//   - P4a (this commit): types + mapping + interface + headless renderer.
//   - P4b: Canvas TreeRenderer implementation.
//   - P4c: environment + currency visuals rendering.
//   - P4d: React wrapper + demo page.

// Public types (TDD §15.1–§15.4, GDD §13.4, §14).
export type {
  TreeRenderData,
  EnvironmentRenderData,
  SeasonalAppearance,
  SpeciesShape,
  DamageMarker,
  CurrencyDenomination,
  CurrencyVisual,
  TreeRenderer,
  TreeRendererTarget,
  CreateTreeRendererTarget,
  TreeViewProps,
} from './types.js';

// Re-export TreeDamageState so consumers building DamageMarkers from raw
// TreeState.damage entries don't need a second import (re-exported from
// types.ts which itself re-exports from @capitalist-tree/shared).
export type { TreeDamageState } from './types.js';

// Pure mapping functions (TDD §15.1, §15.2).
export {
  buildTreeRenderData,
  deriveSeasonalAppearance,
  resolveSpeciesShape,
  mapDamageMarker,
  findSpeciesById,
} from './tree-render-data.js';
export type { BuildTreeRenderDataOptions } from './tree-render-data.js';
export {
  buildEnvironmentRenderData,
} from './environment-render-data.js';
export type { BuildEnvironmentRenderDataOptions } from './environment-render-data.js';

// CurrencyVisual data + lookup (TDD §15.4, GDD §14).
export {
  LEAF_BANKNOTE,
  GOLD_LEAF,
  EURO_LEAF,
  ALL_CURRENCY_VISUALS,
  findCurrencyVisual,
  getDefaultCurrencyVisual,
  resolveCurrencyVisual,
} from './currency-visuals.js';

// TreeRenderer factory + headless implementation (TDD §15.3).
export { createTreeRenderer } from './renderer-factory.js';
export { HeadlessTreeRenderer } from './headless-renderer.js';
export type { HeadlessRenderSnapshot } from './headless-renderer.js';

// Provisional visual tuning constants (GDD §13.4, §14, §17).
export * from './constants/index.js';

// Sentinel retained for backwards-compatibility with P0 (some import paths
// may still reference the placeholder). Will be removed in P4b.
export const RENDERING_PACKAGE_NOT_IMPLEMENTED = false;
