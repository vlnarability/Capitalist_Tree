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

// Economy module — pure functions used by EconomySystem + (in P3c) the
// purchase / pay-expense action handlers. Tests import these directly to
// assert ledger + transaction + idempotency invariants (TDD §18.1).
export * from './economy/index.js';

// Personal module (P3c) — pure functions used by PersonalSystem +
// the pay-expense action handler. Tests import these directly to assert
// the recurring-expenses + well-being + diminishing-returns invariants
// (TDD §18.1, GDD §7).
export * from './personal/index.js';

// Automation module (P6b2 — TDD §12, GDD §9). Pure helpers used by the
// AutomationSystem (policy evaluation + execution) and the four automation
// action handlers (set-automation-policy / enable-automation /
// disable-automation / purchase-equipment). Tests import these directly to
// assert the policy evaluation + execution + purchase + determinism
// invariants (TDD §18.1, GDD §95 pillar 4).
export * from './automation/index.js';

// Offline catch-up module (P6a — TDD §14.4, GDD §4.2). The catch-up
// processor is a pure function over existing GameState (no schema change,
// no migration bump). The `OfflineSummary` / event types it produces live
// in @capitalist-tree/shared.
export * from './offline/index.js';
