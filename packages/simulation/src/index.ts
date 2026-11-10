// @capitalist-tree/simulation — public API.
//
// This package MUST NOT import from the web app, `next`, `react`,
// `react-dom`, `@reduxjs/*`, `idb`, or any browser-only API. The
// import-boundary test in `packages/simulation/test/import-boundary.test.ts`
// enforces this.

export { Rng, type RngState } from './rng.js';
export { deepCopy } from './deep-copy.js';
export {
  engine,
  type SimulationEngine,
  type SimulationResult,
} from './simulation.js';
export { initializeState, DEFAULT_GAME_CONFIG } from './initial-state.js';
export {
  type System,
  type SystemContext,
  type SystemResult,
  SystemRegistry,
  noopSystem,
} from './systems/index.js';
export { timeSystem, seasonFromDay, timeOfDayFraction, SECONDS_PER_DAY } from './systems/index.js';
export { defaultRegistry, defaultSystems } from './systems/index.js';
export {
  weatherSystem,
  biologySystem,
  resourceSystem,
  harvestSystem,
  economySystem,
  personalSystem,
  businessSystem,
  automationSystem,
  environmentSystem,
  progressionSystem,
  eventSystem,
} from './systems/index.js';
export { schedule, due, cancel } from './events/index.js';
export { dispatch, actionHandlers, type ActionListener } from './actions/index.js';
export { type Storage, InMemoryStorage } from './persistence/index.js';

// Biology module — pure functions used by BiologySystem + the harvest action
// handler. Tests import these directly to assert biological invariants.
export * from './biology/index.js';

// Weather module — pure functions used by WeatherSystem (P2). Tests import
// these directly to assert Markov chain + effect invariants.
export * from './weather/index.js';

// Resources module — pure functions used by ResourceSystem + the
// apply-water / apply-fertilizer action handlers (P2). Tests import these
// directly to assert water / nutrient / soil invariants.
export * from './resources/index.js';
