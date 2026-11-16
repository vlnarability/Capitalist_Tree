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

// Environment module (P7b — TDD §13 Environment System, §5.5, §9.2; GDD §10,
// §28, §59–67, §170). Pure helpers used by the EnvironmentSystem (registry
// slot #10) to advance the atmosphere / climate / freshwater / soil /
// biodiversity subsystems each tick. Tests import these directly to assert
// the climate + biodiversity + soil invariants (TDD §18.1, §18.4 conservation).
export * from './environment/index.js';

// Business module (P8b — TDD §5.7 Business State, §11 Personal and Business
// Accounting; GDD §8 Business and Economic Simulation). Pure helpers used by
// the BusinessSystem (registry slot #8) and the eight business action
// handlers (purchase/operate/sell-business, take/repay-loan,
// hire/lay-off-employees, set-business-status). Tests import these directly
// to assert the production / supply-chain / accounting / valuation /
// conservation invariants (TDD §18.1, §18.4 conservation, GDD §8.1 / §8.2 /
// §8.4 / §8.5).
export * from './business/index.js';

// Progression module (P9b — TDD §5.7 / §11, GDD §11 Progression and
// Generations, §12 Player Objectives). Pure helpers used by the
// ProgressionSystem (registry slot #11) and the five progression action
// handlers (unlock-research / activate-trait / deactivate-trait /
// prestige-reset / record-historical-event). Tests import these directly to
// assert the research-unlock / achievement-evaluation / prestige-computation
// invariants (TDD §18.1, §18.4, GDD §11.2 / §11.3 / §12).
export * from './progression/index.js';

// EventSystem module (P10b — TDD §6.4 Event Scheduling, TDD line 200
// EventSystem; GDD §10 Environment and Climate, §148-152 influence over
// regional/global markets/governments/regulations, §404-408 monetary
// authority; TDD Milestone 9: Regional environments, Governments, Monetary
// policy, Global markets, Climate feedback, Global objectives). Pure helpers
// used by the EventSystem (registry slot #12 — the LAST system) and the six
// event action handlers (schedule-event / cancel-event / trigger-event /
// resolve-event / set-government-policy / set-monetary-policy). Tests import
// these directly to assert the scheduler / regional-evolution /
// global-aggregation / policy-reaction / effect-application invariants (TDD
// §18.1, §18.4, GDD §10.1 / §10.2 / §10.3 / §148-152 / §404-408).
export * from './events/index.js';
