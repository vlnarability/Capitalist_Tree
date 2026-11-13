/**
 * End-game objectives (P10c — GDD §12 Player Objectives and Endings, lines
 * 723-747; TDD Milestone 9: Global objectives).
 *
 * Pure READ-ONLY helpers used by the EventSystem (slot #12). Evaluates the six
 * GDD §12 objectives against the current game state. Each objective is tracked
 * INDEPENDENTLY (they may overlap; no mandatory ending — GDD §12 "tracked
 * independently, may overlap, no mandatory ending").
 *
 * The 6 objectives (GDD §12):
 *   - `wealthiest-being` — personalCash >= threshold + control a significant
 *     portion of the global economy (globalMarketIndices influence).
 *   - `great-restoration` — biodiversity > 0.8 + forestCoverage > 0.8 +
 *     ecosystemResilience > 0.8 (all regional + global).
 *   - `last-tree` — biodiversity < 0.2 + forestCoverage < 0.2 + high
 *     extraction (pursue environmental destruction).
 *   - `natural-balance` — financial independence (financialSecurity > 0.8 as
 *     the passive-income > expenses proxy) + ecosystem self-sustaining
 *     (ecosystemResilience > 0.8).
 *   - `industrial-empire` — own businesses across all 6 supply chain levels
 *     (0-5; read from state.businesses).
 *   - `generational-legacy` — totalGenerations >= 3 (read from
 *     state.progression.prestige).
 *
 * These are READ-ONLY evaluations (no state mutation); the UI / rendering layer
 * reads the returned map to show progress. The EventSystem emits a
 * `notification` event (code `objective-achieved`) when an objective FIRST
 * flips false → true across a tick transition — it computes the map on the
 * pre-tick state and the post-tick state and emits for the diff. This reuses
 * the existing `notification` SimulationEvent variant (P10a froze the shared
 * schemas, so no new `objective-achieved` event type is added; the code field
 * carries the objective id). @provisional — a future schema may add a
 * persisted `objectives` block + a dedicated `objective-achieved` event type.
 *
 * NOTE (GDD §12): the ProgressionSystem (P9b) already tracks 12 achievements;
 * the 6 end-game objectives here are the GDD §12 "endings" layer on TOP of
 * achievements. They may overlap with achievements but are evaluated
 * separately (this module does NOT read the achievements list).
 *
 * All helpers are pure: they return a result without mutating the input (TDD
 * §4.1, §18.4). Deterministic given `state` — no RNG.
 */
import type { GameState } from '@capitalist-tree/shared';

// ---------------------------------------------------------------------------
// Objective ids (GDD §12 — the 6 endings)
// ---------------------------------------------------------------------------

export type ObjectiveId =
  | 'wealthiest-being'
  | 'great-restoration'
  | 'last-tree'
  | 'natural-balance'
  | 'industrial-empire'
  | 'generational-legacy';

/** The stable ordered list of objective ids (GDD §12). */
export const OBJECTIVE_IDS: readonly ObjectiveId[] = [
  'wealthiest-being',
  'great-restoration',
  'last-tree',
  'natural-balance',
  'industrial-empire',
  'generational-legacy',
];

/** Human-readable descriptions (GDD §12) for the UI. */
const OBJECTIVE_DESCRIPTIONS: Readonly<Record<ObjectiveId, string>> = {
  'wealthiest-being':
    'Amass a billion in personal wealth and exert significant influence over the global economy.',
  'great-restoration':
    'Restore biodiversity, forest coverage, and ecosystem resilience above 0.8 across the world.',
  'last-tree':
    'Pursue environmental destruction — drive biodiversity and forest coverage below 0.2 under high extraction.',
  'natural-balance':
    'Achieve financial independence (passive income above expenses) with a self-sustaining ecosystem.',
  'industrial-empire':
    'Own businesses spanning all six supply chain levels (0-5).',
  'generational-legacy':
    'Establish at least three generations through prestige resets.',
};

// ---------------------------------------------------------------------------
// Local @provisional objective thresholds (GDD §12 — endings; §17 — tuning)
// ---------------------------------------------------------------------------

// PROVISIONAL (GDD §17: endings tuning; GDD §12)
// Personal-cash threshold (bigint minor units as a string) for the
// Wealthiest-Being objective — 1 billion in major currency at 2 decimals =
// 1e11 minor units. PROVISIONAL.
const PROVISIONAL_WEALTHIEST_BEING_CASH_MINOR = 100_000_000_000n; // 1e11

// PROVISIONAL (GDD §12) — restoration / balance thresholds.
const PROVISIONAL_RESTORATION_THRESHOLD = 0.8;
const PROVISIONAL_DESTRUCTION_THRESHOLD = 0.2;

// PROVISIONAL (GDD §12) — generational-legacy generation count.
const PROVISIONAL_GENERATIONAL_LEGACY_GENERATIONS = 3;

// PROVISIONAL (GDD §12) — natural-balance financial-independence proxy
// (financialSecurity > 0.8 + ecosystemResilience > 0.8).
const PROVISIONAL_FINANCIAL_INDEPENDENCE = 0.8;

// PROVISIONAL (GDD §12) — wealthiest-being global-economy-influence proxy:
// the sum of all globalMarketIndices deviations from the 100 baseline must
// exceed this fraction of the baseline summed across indices.
const PROVISIONAL_WEALTHIEST_BEING_INFLUENCE = 0.1;

// The number of distinct supply-chain levels (0-5) for industrial-empire.
const SUPPLY_CHAIN_LEVEL_COUNT = 6;
const MARKET_INDEX_BASELINE = 100;

// ---------------------------------------------------------------------------
// Objective result
// ---------------------------------------------------------------------------

/** The evaluation result for a single objective. */
export interface ObjectiveResult {
  /** The objective id. */
  readonly id: ObjectiveId;
  /** Whether the objective is achieved this tick. */
  readonly achieved: boolean;
  /** Progress toward achievement in [0, 1] (1 = achieved). */
  readonly progress: number;
  /** Human-readable description (GDD §12). */
  readonly description: string;
}

/** The full evaluation map — objective id → result. */
export type ObjectiveMap = Readonly<Record<ObjectiveId, ObjectiveResult>>;

/** Clamp a number into [0, 1]. */
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// ---------------------------------------------------------------------------
// Per-objective evaluators (pure + read-only)
// ---------------------------------------------------------------------------

/**
 * Wealthiest-Being (GDD §12): personalCash >= threshold + significant global-
 * economy influence (the sum of globalMarketIndices deviations from the 100
 * baseline exceeds `PROVISIONAL_WEALTHIEST_BEING_INFLUENCE`). Progress is the
 * geometric mean of the cash progress + the influence progress.
 */
function evaluateWealthiestBeing(state: GameState): ObjectiveResult {
  const cash = BigInt(state.player.personalCash || '0');
  const cashProgress = Number(
    (cash * 1000n) / (PROVISIONAL_WEALTHIEST_BEING_CASH_MINOR / 1000n > 0n
      ? PROVISIONAL_WEALTHIEST_BEING_CASH_MINOR
      : 1n),
  ) / 1000;
  // Safer: compute cashProgress via floating ratio (cash is bigint; convert).
  const cashFloat = Number(cash) / Number(PROVISIONAL_WEALTHIEST_BEING_CASH_MINOR);
  const indices = state.eventState.global.globalMarketIndices;
  const indexValues = Object.values(indices);
  const sumBaseline = (indexValues.length || 1) * MARKET_INDEX_BASELINE;
  const sumDeviation = indexValues.reduce((a, v) => a + Math.abs(v - MARKET_INDEX_BASELINE), 0);
  const influence = sumBaseline > 0 ? sumDeviation / sumBaseline : 0;
  const influenceProgress = Math.min(1, influence / PROVISIONAL_WEALTHIEST_BEING_INFLUENCE);
  const cashAchieved = cash >= PROVISIONAL_WEALTHIEST_BEING_CASH_MINOR;
  const influenceAchieved = influence >= PROVISIONAL_WEALTHIEST_BEING_INFLUENCE;
  const achieved = cashAchieved && influenceAchieved;
  const progress = clamp01(Math.min(cashFloat, influenceProgress));
  return {
    id: 'wealthiest-being',
    achieved,
    progress,
    description: OBJECTIVE_DESCRIPTIONS['wealthiest-being'],
  };
}

/**
 * Great-Restoration (GDD §12): biodiversity > 0.8 + forestCoverage > 0.8 +
 * ecosystemResilience > 0.8 (all regional + global — the global aggregated
 * indicators must clear the bar AND every region must too, so a healthy
 * average cannot conceal a collapsing local ecosystem — GDD §10.2). Progress
 * is the min of the three global indicators.
 */
function evaluateGreatRestoration(state: GameState): ObjectiveResult {
  const indicators = state.eventState.global.aggregatedIndicators;
  const regions = state.eventState.global.regions;
  const globalBiodiversity = indicators.avgBiodiversity;
  const globalForest = indicators.avgForestCoverage;
  const globalResilience = indicators.ecosystemResilience;
  // Every region must also clear the bar (GDD §10.2 local-collapse guard).
  const allRegionsRestored =
    regions.length > 0 &&
    regions.every(
      (r) =>
        r.biodiversity >= PROVISIONAL_RESTORATION_THRESHOLD &&
        r.forestCoverage >= PROVISIONAL_RESTORATION_THRESHOLD,
    );
  const achieved =
    globalBiodiversity >= PROVISIONAL_RESTORATION_THRESHOLD &&
    globalForest >= PROVISIONAL_RESTORATION_THRESHOLD &&
    globalResilience >= PROVISIONAL_RESTORATION_THRESHOLD &&
    allRegionsRestored;
  const progress = clamp01(
    Math.min(globalBiodiversity, globalForest, globalResilience) / PROVISIONAL_RESTORATION_THRESHOLD,
  );
  return {
    id: 'great-restoration',
    achieved,
    progress,
    description: OBJECTIVE_DESCRIPTIONS['great-restoration'],
  };
}

/**
 * Last-Tree (GDD §12): biodiversity < 0.2 + forestCoverage < 0.2 + high
 * extraction (industrialActivity high). The "destruction" ending. Progress is
 * how close to the destruction threshold the most-degraded global indicator is.
 */
function evaluateLastTree(state: GameState): ObjectiveResult {
  const indicators = state.eventState.global.aggregatedIndicators;
  const globalBiodiversity = indicators.avgBiodiversity;
  const globalForest = indicators.avgForestCoverage;
  // High extraction = aggregate industrialActivity above 0.6. @provisional.
  const regions = state.eventState.global.regions;
  const aggregateActivity =
    regions.length > 0
      ? regions.reduce((a, r) => a + r.industrialActivity, 0) / regions.length
      : 0;
  const highExtraction = aggregateActivity >= 0.6;
  const achieved =
    globalBiodiversity <= PROVISIONAL_DESTRUCTION_THRESHOLD &&
    globalForest <= PROVISIONAL_DESTRUCTION_THRESHOLD &&
    highExtraction;
  // Progress: how far BELOW 0.2 the indicators have fallen (0.2 → progress 1;
  // 1.0 → progress 0). Use the max of the two (the less-destroyed one gates).
  const destructionProgress = (PROVISIONAL_DESTRUCTION_THRESHOLD - Math.max(globalBiodiversity, globalForest)) /
    PROVISIONAL_DESTRUCTION_THRESHOLD;
  const progress = clamp01(Math.min(destructionProgress, aggregateActivity / 0.6));
  return {
    id: 'last-tree',
    achieved,
    progress,
    description: OBJECTIVE_DESCRIPTIONS['last-tree'],
  };
}

/**
 * Natural-Balance (GDD §12): financial independence (passive income > expenses
 * — proxied by `player.financialSecurity > 0.8` since the PersonalSystem tracks
 * it) + ecosystem self-sustaining (ecosystemResilience > 0.8). Progress is the
 * min of the two.
 */
function evaluateNaturalBalance(state: GameState): ObjectiveResult {
  const financialSecurity = state.player.financialSecurity;
  const ecosystemResilience = state.eventState.global.aggregatedIndicators.ecosystemResilience;
  const achieved =
    financialSecurity >= PROVISIONAL_FINANCIAL_INDEPENDENCE &&
    ecosystemResilience >= PROVISIONAL_FINANCIAL_INDEPENDENCE;
  const progress = clamp01(
    Math.min(financialSecurity, ecosystemResilience) / PROVISIONAL_FINANCIAL_INDEPENDENCE,
  );
  return {
    id: 'natural-balance',
    achieved,
    progress,
    description: OBJECTIVE_DESCRIPTIONS['natural-balance'],
  };
}

/**
 * Industrial-Empire (GDD §12): own businesses across all 6 supply chain levels
 * (0-5). Progress is the distinct-level count / 6.
 */
function evaluateIndustrialEmpire(state: GameState): ObjectiveResult {
  const ownedLevels = new Set<number>();
  for (const b of state.businesses) {
    ownedLevels.add(b.supplyChainLevel);
  }
  const distinct = ownedLevels.size;
  const achieved = distinct >= SUPPLY_CHAIN_LEVEL_COUNT;
  const progress = clamp01(distinct / SUPPLY_CHAIN_LEVEL_COUNT);
  return {
    id: 'industrial-empire',
    achieved,
    progress,
    description: OBJECTIVE_DESCRIPTIONS['industrial-empire'],
  };
}

/**
 * Generational-Legacy (GDD §12): totalGenerations >= 3. Progress is
 * min(1, totalGenerations / 3).
 */
function evaluateGenerationalLegacy(state: GameState): ObjectiveResult {
  const generations = state.progression.prestige.totalGenerations;
  const achieved = generations >= PROVISIONAL_GENERATIONAL_LEGACY_GENERATIONS;
  const progress = clamp01(generations / PROVISIONAL_GENERATIONAL_LEGACY_GENERATIONS);
  return {
    id: 'generational-legacy',
    achieved,
    progress,
    description: OBJECTIVE_DESCRIPTIONS['generational-legacy'],
  };
}

// ---------------------------------------------------------------------------
// evaluateObjectives — the full read-only map (GDD §12)
// ---------------------------------------------------------------------------

/**
 * `evaluateObjectives` — evaluate all six GDD §12 objectives against the
 * current game state. Pure + READ-ONLY: returns the objective-id → result
 * map; mutates nothing. Each objective is tracked independently (may overlap;
 * no mandatory ending — GDD §12).
 *
 * The EventSystem computes this on the pre-tick state and the post-tick state
 * each tick and emits a `notification` (code `objective-achieved`) for each
 * objective that flips false → true (first achievement within the live
 * simulation). The objectives themselves are NOT persisted (P10a froze the
 * schemas) — they are recomputed each tick from the live state.
 */
export function evaluateObjectives(state: GameState): ObjectiveMap {
  return {
    'wealthiest-being': evaluateWealthiestBeing(state),
    'great-restoration': evaluateGreatRestoration(state),
    'last-tree': evaluateLastTree(state),
    'natural-balance': evaluateNaturalBalance(state),
    'industrial-empire': evaluateIndustrialEmpire(state),
    'generational-legacy': evaluateGenerationalLegacy(state),
  };
}

/**
 * `diffObjectives` — compute the set of objective ids that flipped false → true
 * between a `before` map and an `after` map. Pure. Used by the EventSystem to
 * emit `objective-achieved` notifications on first achievement.
 */
export function diffObjectives(before: ObjectiveMap, after: ObjectiveMap): ObjectiveId[] {
  const newlyAchieved: ObjectiveId[] = [];
  for (const id of OBJECTIVE_IDS) {
    if (!before[id].achieved && after[id].achieved) {
      newlyAchieved.push(id);
    }
  }
  return newlyAchieved;
}

/**
 * Read-only access to the @provisional objective thresholds for tests + future
 * tuning promotion (rule 10).
 */
export const OBJECTIVE_CONSTANTS = {
  PROVISIONAL_WEALTHIEST_BEING_CASH_MINOR,
  PROVISIONAL_RESTORATION_THRESHOLD,
  PROVISIONAL_DESTRUCTION_THRESHOLD,
  PROVISIONAL_GENERATIONAL_LEGACY_GENERATIONS,
  PROVISIONAL_FINANCIAL_INDEPENDENCE,
  PROVISIONAL_WEALTHIEST_BEING_INFLUENCE,
  SUPPLY_CHAIN_LEVEL_COUNT,
  MARKET_INDEX_BASELINE,
} as const;
