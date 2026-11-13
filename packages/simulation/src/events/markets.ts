/**
 * Global market index evolution (P10c — GDD line 563 "markets at regional and
 * global scales"; TDD Milestone 9: Global markets).
 *
 * Pure helpers used by the EventSystem (slot #12). This is the GLOBAL market
 * index layer — macro indicators like `index:commodity-basket`, `index:energy`,
 * `index:food`, `index:materials` that influence regional prices + the central
 * bank's recession / boom signal (global.ts `updateMonetaryPolicy`). It does
 * NOT replace P8's BusinessSystem per-business commodity market simulation;
 * it sits ABOVE it as the macro index layer the EventSystem evolves each tick.
 *
 *   - `evolveGlobalMarketIndices(state, dtSeconds)` — per-tick evolution of
 *     `eventState.global.globalMarketIndices` (a record of market-index id →
 *     level, baseline 100). Each index mean-reverts to its baseline, shifted by:
 *       * regional industrialActivity (supply pressure — high activity lifts
 *         the materials index, drags the commodity basket via oversupply),
 *       * monetary policy (interestRate deviation from neutral affects
 *         investment → all indices),
 *       * government policy (carbonTaxRate raises the energy index),
 *       * active events (an active `event:market-crash` drops indices; an
 *         active `event:boom` raises them — read from the EventSystem
 *         scheduler's active list).
 *   - `getGlobalMarketIndex(state, marketName)` — read a specific index
 *     (defaults to the 100 baseline when absent).
 *
 * If `globalMarketIndices` is empty, the helper seeds a @provisional default
 * set of macro indices (commodity-basket / energy / food / materials) at the
 * 100 baseline so the central bank + downstream consumers have a signal from
 * tick one. @provisional — final index set + weights depend on playtesting
 * (GDD §17).
 *
 * All helpers are pure: they return a new state without mutating the input
 * (TDD §4.1, §18.4). Deterministic given (state, dtSeconds) — no RNG.
 */
import type { GameState } from '@capitalist-tree/shared';
import { deepCopy } from '../deep-copy.js';

const SECONDS_PER_DAY = 24 * 60 * 60;

// ---------------------------------------------------------------------------
// Local @provisional market tuning constants (GDD §8.5 market simulation,
// §17 — economic tuning) — R-P10-2
// ---------------------------------------------------------------------------

// PROVISIONAL (GDD §17: economic tuning; §8.5 market simulation)
// Mean-reversion rate per sim day — the fraction of the gap between an index's
// current level and its baseline (shifted by supply/demand pressure) that the
// index closes per sim day. 0.02 ≈ 2% per sim day, so an index shocked 30
// above baseline returns halfway in ~35 sim days absent new pressure.
// PROVISIONAL.
const PROVISIONAL_MARKET_MEAN_REVERSION_RATE = 0.02;

// PROVISIONAL (GDD §17: economic tuning)
// Per-unit regional industrialActivity supply pressure on the materials index.
// Aggregate regional industrialActivity averaged at 0.5 lifts the materials
// index baseline by 0.5 * 10 = 5 points. PROVISIONAL.
const PROVISIONAL_MATERIALS_SUPPLY_PRESSURE = 10;

// PROVISIONAL (GDD §17: economic tuning; §8.5 supply/demand)
// Per-unit aggregate industrialActivity drag on the commodity-basket baseline
// (oversupply softens commodity prices). 0.5 activity drags the basket
// baseline by -0.5 * 5 = -2.5 points. PROVISIONAL.
const PROVISIONAL_COMMODITY_OVERSUPPLY_DRAG = 5;

// PROVISIONAL (GDD §17: economic tuning; §404-408 monetary policy)
// Per-unit interest-rate deviation from the 0.05 neutral rate applied to ALL
// indices (higher rates → lower investment → lower indices). A rate of 0.07
// (deviation +0.02) drags every index baseline by -0.02 * 200 = -4 points.
// PROVISIONAL.
const PROVISIONAL_INTEREST_RATE_INDEX_SENSITIVITY = 200;
const NEUTRAL_INTEREST_RATE = 0.05;

// PROVISIONAL (GDD §17: economic tuning; §148-152 carbon tax)
// Per-unit carbonTaxRate lift on the energy index baseline (a carbon tax
// raises energy costs). A 0.3 carbon tax lifts the energy baseline by
// 0.3 * 30 = 9 points. PROVISIONAL.
const PROVISIONAL_CARBON_TAX_ENERGY_LIFT = 30;

// PROVISIONAL (GDD §17: economic tuning; §8.5 market simulation)
// Active-event index pressure. An active `event:market-crash` (any severity)
// subtracts this many points from every index per active tick; an active
// `event:boom` adds it. 20 ≈ a 20-point swing per active event. Scaled by the
// severity multiplier (catastrophic crash = 2x). PROVISIONAL.
const PROVISIONAL_ACTIVE_EVENT_INDEX_SWING = 20;

// The @provisional default macro indices seeded when `globalMarketIndices` is
// empty (GDD §563 markets at global scale). The commodity-basket is the
// central-bank signal (global.ts `COMMODITY_BASKET_INDEX_ID`).
const DEFAULT_MARKET_INDICES: ReadonlyArray<string> = [
  'index:commodity-basket',
  'index:energy',
  'index:food',
  'index:materials',
];

const MARKET_INDEX_BASELINE = 100;

/** Clamp an index level to a nonnegative value (indices do not go negative). */
function clampNonNegative(v: number): number {
  return Math.max(0, v);
}

/**
 * The severity-multiplier mapping reused from `global.ts` (catastrophic = 2x,
 * severe = 1.5x, moderate = 1x, minor = 0.5x). Inlined here to avoid a circular
 * import (global.ts imports from this module's siblings, not from here, but
 * keeping the market module self-contained is cleaner for the macro layer).
 */
function severityScale(severity: string): number {
  switch (severity) {
    case 'catastrophic':
      return 2.0;
    case 'severe':
      return 1.5;
    case 'minor':
      return 0.5;
    case 'moderate':
    default:
      return 1.0;
  }
}

/**
 * Compute the aggregate (population-weighted) regional industrialActivity —
 * the global supply signal. Pure + read-only.
 */
function aggregateIndustrialActivity(state: GameState): number {
  const regions = state.eventState.global.regions;
  if (regions.length === 0) return 0;
  let weightSum = 0;
  let acc = 0;
  for (const r of regions) {
    const w = Math.max(1, r.population);
    acc += r.industrialActivity * w;
    weightSum += w;
  }
  return weightSum > 0 ? acc / weightSum : 0;
}

/**
 * Compute the per-index baseline shift from supply / monetary / policy /
 * active-event pressure. Returns the shifted baseline (around 100) for the
 * given index id. Pure + read-only.
 */
function shiftedBaseline(
  indexId: string,
  state: GameState,
  aggregateActivity: number,
): number {
  const monetary = state.eventState.global.monetaryPolicy;
  const government = state.eventState.global.governmentPolicy;
  const rateDeviation = monetary.interestRate - NEUTRAL_INTEREST_RATE;

  // Monetary policy affects ALL indices (investment cost of capital).
  let baseline = MARKET_INDEX_BASELINE - rateDeviation * PROVISIONAL_INTEREST_RATE_INDEX_SENSITIVITY;

  switch (indexId) {
    case 'index:materials':
      // High industrial activity lifts materials demand.
      baseline += aggregateActivity * PROVISIONAL_MATERIALS_SUPPLY_PRESSURE;
      break;
    case 'index:commodity-basket':
      // Oversupply from high activity softens commodity prices.
      baseline -= aggregateActivity * PROVISIONAL_COMMODITY_OVERSUPPLY_DRAG;
      break;
    case 'index:energy':
      // Carbon tax raises energy costs.
      baseline += government.carbonTaxRate * PROVISIONAL_CARBON_TAX_ENERGY_LIFT;
      break;
    case 'index:food':
      // Food index tracks ecosystem resilience (low resilience → scarce food →
      // higher prices). 1 - resilience lifts the baseline.
      baseline += (1 - state.eventState.global.aggregatedIndicators.ecosystemResilience) * 10;
      break;
    default:
      // Unknown index — mean-reverts to the unshifted 100 baseline.
      break;
  }

  // Active event pressure: a market-crash drops all indices; a boom raises
  // them. Scaled by severity.
  for (const active of state.eventState.scheduler.active) {
    const scale = severityScale(active.severity);
    if (active.type === 'event:market-crash') {
      baseline -= PROVISIONAL_ACTIVE_EVENT_INDEX_SWING * scale;
    } else if (active.type === 'event:boom') {
      baseline += PROVISIONAL_ACTIVE_EVENT_INDEX_SWING * scale;
    } else if (active.type === 'event:resource-scarcity') {
      // Resource scarcity lifts the commodity + food baskets.
      if (indexId === 'index:commodity-basket' || indexId === 'index:food') {
        baseline += PROVISIONAL_ACTIVE_EVENT_INDEX_SWING * 0.5 * scale;
      }
    } else if (active.type === 'event:recession') {
      baseline -= PROVISIONAL_ACTIVE_EVENT_INDEX_SWING * 0.5 * scale;
    }
  }

  return baseline;
}

// ---------------------------------------------------------------------------
// evolveGlobalMarketIndices — per-tick macro index evolution (GDD §563)
// ---------------------------------------------------------------------------

/**
 * `evolveGlobalMarketIndices` — evolve the global market-index levels over
 * `dtSeconds` (GDD §563 markets at global scale; TDD Milestone 9: Global
 * markets). Pure: returns a new state.
 *
 * Seeds a @provisional default set of macro indices (commodity-basket / energy
 * / food / materials) at the 100 baseline when `globalMarketIndices` is empty
 * (first tick), then mean-reverts each index toward its pressure-shifted
 * baseline at `PROVISIONAL_MARKET_MEAN_REVERSION_RATE` per sim day.
 *
 * A no-op when `dtSeconds <= 0`. Deterministic given (state, dtSeconds) — no
 * RNG.
 */
export function evolveGlobalMarketIndices(
  state: GameState,
  dtSeconds: number,
): { state: GameState; events: GameState[] } {
  if (dtSeconds <= 0) {
    return { state, events: [] as GameState[] };
  }
  const next: GameState = deepCopy(state);

  // Seed the @provisional default indices if the map is empty.
  let indices = next.eventState.global.globalMarketIndices;
  if (Object.keys(indices).length === 0) {
    indices = {};
    for (const id of DEFAULT_MARKET_INDICES) {
      indices[id] = MARKET_INDEX_BASELINE;
    }
  }

  const days = dtSeconds / SECONDS_PER_DAY;
  const reversion = 1 - Math.pow(1 - PROVISIONAL_MARKET_MEAN_REVERSION_RATE, days);
  const aggregateActivity = aggregateIndustrialActivity(next);

  const evolved: Record<string, number> = {};
  for (const [id, level] of Object.entries(indices)) {
    const baseline = shiftedBaseline(id, next, aggregateActivity);
    // Mean-revert toward the shifted baseline.
    const newLevel = clampNonNegative(level + (baseline - level) * reversion);
    evolved[id] = newLevel;
  }

  next.eventState = {
    ...next.eventState,
    global: {
      ...next.eventState.global,
      globalMarketIndices: evolved,
    },
  };

  // This helper emits no SimulationEvents — the central bank's
  // `monetary-policy-changed` (global.ts) surfaces material index moves on
  // its own cadence. The `events` slot is reserved for future market-shock
  // notifications; typed as GameState[] only to satisfy the no-events shape —
  // callers ignore it.
  return { state: next, events: [] as GameState[] };
}

/**
 * `getGlobalMarketIndex` — read a specific global market index by id (defaults
 * to the 100 baseline when the index is absent). Pure + read-only.
 */
export function getGlobalMarketIndex(state: GameState, marketName: string): number {
  return state.eventState.global.globalMarketIndices[marketName] ?? MARKET_INDEX_BASELINE;
}

/**
 * Read-only access to the @provisional market tuning constants + the default
 * index set for tests + future tuning promotion (rule 10).
 */
export const MARKET_CONSTANTS = {
  PROVISIONAL_MARKET_MEAN_REVERSION_RATE,
  PROVISIONAL_MATERIALS_SUPPLY_PRESSURE,
  PROVISIONAL_COMMODITY_OVERSUPPLY_DRAG,
  PROVISIONAL_INTEREST_RATE_INDEX_SENSITIVITY,
  PROVISIONAL_CARBON_TAX_ENERGY_LIFT,
  PROVISIONAL_ACTIVE_EVENT_INDEX_SWING,
  NEUTRAL_INTEREST_RATE,
  DEFAULT_MARKET_INDICES,
  MARKET_INDEX_BASELINE,
} as const;
