/**
 * Prestige pure helpers (P9b — TDD §5.7 / §11, GDD §11.3 Prestige).
 *
 * GDD §11.3 is explicit: "Prestige should represent generational progress
 * rather than simply resetting the game for a numerical multiplier." The
 * prestige currency is genetic-legacy points (GDD §11.2 Genetic Legacy),
 * earned by completing a generation and spent on `unlock-research` +
 * `activate-trait`.
 *
 *   - `computePrestigeEarned(state)` : the PRESTIGE POTENTIAL — what the player
 *     WOULD earn if they prestige now. Computes
 *     `(base + activeTraitCount * traitMultiplier) * prestigeMultiplier`
 *     (GDD §11.3 + the constants doc). Returns a bigint (genetic-legacy points
 *     are integers; the prestige currency uses bigint minor-units string
 *     precision discipline — TDD §10.1). This is a pure read — it does NOT
 *     mutate state.
 *   - `applyPrestigeReset(state, newTreeSpeciesId, tick)` : the skeleton of
 *     the actual reset — credits the earned points to `geneticLegacyPoints`,
 *     increments `totalGenerations` + `currentGeneration`, finalises the
 *     current `generationHistory` entry (`endDate: tick`, `outcome:
 *     'completed'`, `prestigeEarned`), appends the new generation's history
 *     entry (`generationNumber: currentGeneration + 1`, `treeSpeciesId:
 *     newTreeSpeciesId`, `startDate: tick`, `outcome: 'ongoing'`), preserves
 *     the `PROVISIONAL_PRESTIGE_PRESERVED_RESOURCES` fraction of unlocked
 *     research (some research carries over; the rest is reset), and PRESERVES
 *     across the reset: `originalLineageId` (permanent — GDD §11.2), the
 *     acquired `activeTraits` (genetic material), the full `generationHistory`,
 *     and `geneticLegacyPoints` (which only grows). Returns `{ state, event }`
 *     (the `generation-established` SimulationEvent).
 *   - `computeGenerationStart(state)` : the simulation second at which the
 *     current generation started (0 if no prestige has happened yet; the last
 *     `generationHistory` entry's `startDate` otherwise). Used by the
 *     `prestige-reset` action handler to enforce
 *     `PROVISIONAL_PRESTIGE_GENERATION_MIN_DURATION_DAYS`.
 *
 * DEFERRED TO P9c (the full prestige-reset mechanics — documented here so the
 * contract is clear): the actual play-state reset — clearing `player.cash` +
 * `economy.accounts`, removing `businesses` + `automation` + `inventory`,
 * replanting `originalTree` as a sapling of `newTreeSpeciesId` (keeping
 * `originalTree.id === 'original'` + `isOriginal === true` per GDD §16.1 /
 * §16.2), re-seeding the economy, and the trait-inheritance mechanics (which
 * traits carry forward at what magnitude, how `prestigeMultiplier` grows with
 * generations). P9b implements only the progression-state-side changes (the
 * currency credit + generation counters + history + research preservation);
 * the play-state reset is a no-op in P9b so the skeleton is testable in
 * isolation. The `generation-established` event still fires so downstream
 * systems / the UI can react.
 *
 * `originalLineageId` is NEVER modified by `applyPrestigeReset` — GDD §11.2
 * "the original tree's lineage should remain identifiable". The
 * `originalLineageId` guard test pins this.
 *
 * Pure: every helper returns a new state (and events) without mutating the
 * input. Deterministic given (state, newTreeSpeciesId, tick).
 */
import type {
  GameState,
  GenerationHistoryEntry,
  ResearchNodeState,
  SimulationEvent,
} from '@capitalist-tree/shared';
import {
  PROVISIONAL_PRESTIGE_BASE_LEGACY_POINTS_PER_GENERATION,
  PROVISIONAL_PRESTIGE_LEGACY_MULTIPLIER_PER_TRAIT,
  PROVISIONAL_PRESTIGE_PRESERVED_RESOURCES,
  PROVISIONAL_PRESTIGE_GENERATION_MIN_DURATION_DAYS,
} from '@capitalist-tree/shared';
import { SECONDS_PER_DAY } from '../systems/time-system.js';

// PROVISIONAL (GDD §17: Prestige and Generational Progression — §11.3)
//
// The prestige multiplier grows with each completed generation, rewarding
// sustained lineage development (GDD §11.3 — generational progress, not a
// numerical reset-for-multiplier). `prestigeMultiplier = 1 + 0.1 *
// totalGenerations` (after increment). PROVISIONAL — tuned during playtesting.
const PROVISIONAL_PRESTIGE_MULTIPLIER_PER_GENERATION = 0.1;

// ---------------------------------------------------------------------------
// computeGenerationStart
// ---------------------------------------------------------------------------

/**
 * The simulation second at which the current generation started. 0 if no
 * prestige has happened yet (the player is playing generation 1 — the original
 * tree — which started at game start, elapsedSeconds 0). Otherwise the last
 * `generationHistory` entry's `startDate` (the entry for the current, ongoing
 * generation). Pure read.
 */
export function computeGenerationStart(state: GameState): number {
  const history = state.progression.generationHistory;
  if (history.length === 0) {
    return 0;
  }
  return history[history.length - 1]!.startDate;
}

// ---------------------------------------------------------------------------
// computePrestigeEarned — the prestige potential (pure read)
// ---------------------------------------------------------------------------

/**
 * The genetic-legacy points the player WOULD earn if they prestige-reset now.
 * Formula (GDD §11.3 + the constants doc):
 *
 *   earned = (base + activeTraitCount * traitMultiplier) * prestigeMultiplier
 *
 * where:
 *   - base = PROVISIONAL_PRESTIGE_BASE_LEGACY_POINTS_PER_GENERATION (10)
 *   - activeTraitCount = genetics.activeTraits.filter(t => t.active).length
 *     (only traits currently being expressed count — GDD §11.2 modifications
 *     have trade-offs; the player toggles which are expressed)
 *   - traitMultiplier = PROVISIONAL_PRESTIGE_LEGACY_MULTIPLIER_PER_TRAIT (2)
 *   - prestigeMultiplier = prestige.prestigeMultiplier (the derived bonus)
 *
 * Returns a bigint (genetic-legacy points are whole integers). The
 * floating-point product is rounded to the nearest integer so the credited
 * amount is always a whole point count (TDD §10.1 — the prestige currency uses
 * bigint precision discipline; we never credit fractional points).
 *
 * Pure: reads only the state. Does NOT mutate.
 */
export function computePrestigeEarned(state: GameState): bigint {
  const activeTraitCount = state.progression.genetics.activeTraits.filter(
    (t) => t.active,
  ).length;
  const base =
    PROVISIONAL_PRESTIGE_BASE_LEGACY_POINTS_PER_GENERATION +
    activeTraitCount * PROVISIONAL_PRESTIGE_LEGACY_MULTIPLIER_PER_TRAIT;
  const earned = base * state.progression.prestige.prestigeMultiplier;
  return BigInt(Math.max(0, Math.round(earned)));
}

// ---------------------------------------------------------------------------
// applyPrestigeReset — the skeleton of the actual reset
// ---------------------------------------------------------------------------

export interface ApplyPrestigeResetResult {
  readonly state: GameState;
  readonly event: SimulationEvent;
}

/**
 * Apply a prestige reset — establish a new generation (GDD §11.3). The
 * progression-state-side skeleton:
 *
 *   1. Compute the genetic-legacy points earned this generation via
 *      `computePrestigeEarned(state)`.
 *   2. Credit the earned points to `prestige.geneticLegacyPoints` (bigint
 *      string arithmetic — the currency only grows across resets).
 *   3. Increment `prestige.totalGenerations` + `prestige.currentGeneration`.
 *   4. Recompute `prestige.prestigeMultiplier = 1 +
 *      PROVISIONAL_PRESTIGE_MULTIPLIER_PER_GENERATION * totalGenerations`
 *      (after increment — the new generation enjoys the grown bonus).
 *   5. Finalise the current `generationHistory` entry (`endDate: tick`,
 *      `outcome: 'completed'`, `prestigeEarned: <earned>`). If no history
 *      exists yet (first prestige), synthesise the generation-1 entry from
 *      the original tree's current species (the player has been playing
 *      generation 1 as `originalTree.speciesId` since game start).
 *   6. Append the new generation's history entry (`generationNumber:
 *      currentGeneration` AFTER increment, `treeSpeciesId: newTreeSpeciesId`,
 *      `startDate: tick`, `endDate: null`, `outcome: 'ongoing'`,
 *      `prestigeEarned: '0'`).
 *   7. Preserve the `PROVISIONAL_PRESTIGE_PRESERVED_RESOURCES` fraction of
 *      unlocked research (GDD §11.3 reward: research advantages). The
 *      preserved nodes stay `unlocked: true`; the rest are flipped back to
 *      `unlocked: false` / `unlockedAt: 0` (the player re-earns them in the
 *      new generation). The node RECORDS themselves stay (their
 *      definition-derived `categoryId` / `prerequisites` / `cost` are
 *      preserved) — only their `unlocked` flag is reset for the non-preserved
 *      fraction.
 *   8. PRESERVE across the reset (GDD §11.2 / §11.3): `originalLineageId`
 *      (NEVER modified), the acquired `activeTraits` (genetic material), the
 *      full `generationHistory`, `geneticLegacyPoints` (which grew in step 2),
 *      and `historicalRecords` (the lineage's recorded history is permanent).
 *
 * DEFERRED TO P9c: the play-state reset — clearing `player.cash` +
 * `economy.accounts`, removing `businesses` + `automation` + `inventory`,
 * replanting `originalTree` as a sapling of `newTreeSpeciesId`, re-seeding the
 * economy, and the trait-inheritance mechanics. P9b does NOT touch any of
 * these — the skeleton is testable in isolation, and the play-state reset is
 * an atomic operation that belongs in P9c alongside the trait-inheritance
 * design (which decides what carries forward at what magnitude).
 *
 * `tick` is the simulation second at which the reset runs — explicit so the
 * history stamps + event `at` are deterministic given (state,
 * newTreeSpeciesId, tick) (TDD §18.3).
 *
 * Pure: returns a new state + the `generation-established` event. Never
 * mutates the input. `originalLineageId` is preserved verbatim.
 */
export function applyPrestigeReset(
  state: GameState,
  newTreeSpeciesId: string,
  tick: number,
): ApplyPrestigeResetResult {
  const earned = computePrestigeEarned(state);
  const previousGeneration = state.progression.prestige.currentGeneration;
  const newGenerationNumber = previousGeneration + 1;
  const newTotalGenerations = state.progression.prestige.totalGenerations + 1;
  const newPrestigeMultiplier =
    1 + PROVISIONAL_PRESTIGE_MULTIPLIER_PER_GENERATION * newTotalGenerations;
  const balanceAfter =
    BigInt(state.progression.prestige.geneticLegacyPoints) + earned;

  // --- Finalise the current generation's history entry ---
  // If no history exists yet, the current generation is generation 1 (the
  // original tree), which started at tick 0 playing `originalTree.speciesId`.
  // Synthesise its entry so the history is complete.
  const history = state.progression.generationHistory;
  let finalisedHistory: GenerationHistoryEntry[];
  if (history.length === 0) {
    finalisedHistory = [
      {
        generationNumber: 1,
        treeSpeciesId: state.originalTree.speciesId,
        startDate: 0,
        endDate: tick,
        outcome: 'completed',
        prestigeEarned: earned.toString(10),
      },
    ];
  } else {
    finalisedHistory = history.map((entry, i) =>
      i === history.length - 1
        ? {
            ...entry,
            endDate: tick,
            outcome: 'completed' as const,
            prestigeEarned: earned.toString(10),
          }
        : entry,
    );
  }

  // --- Append the new generation's history entry ---
  const newEntry: GenerationHistoryEntry = {
    generationNumber: newGenerationNumber,
    treeSpeciesId: newTreeSpeciesId,
    startDate: tick,
    endDate: null,
    outcome: 'ongoing',
    prestigeEarned: '0',
  };
  const newHistory = [...finalisedHistory, newEntry];

  // --- Preserve the PROVISIONAL fraction of unlocked research ---
  // The preserved nodes stay unlocked; the rest are flipped back to locked
  // (the player re-earns them in the new generation). The node RECORDS stay
  // (their definition-derived fields are preserved) — only the `unlocked`
  // flag is reset for the non-preserved fraction.
  const unlockedNodes = state.progression.research.nodes.filter(
    (n) => n.unlocked,
  );
  const preservedCount = Math.floor(
    unlockedNodes.length * PROVISIONAL_PRESTIGE_PRESERVED_RESOURCES,
  );
  // Preserve the first `preservedCount` unlocked nodes (insertion order —
  // deterministic given the save's node order). The remainder are reset.
  let resetIndex = 0;
  const newResearchNodes: ResearchNodeState[] =
    state.progression.research.nodes.map((node) => {
      if (!node.unlocked) {
        return node; // already locked — unchanged.
      }
      resetIndex += 1;
      if (resetIndex <= preservedCount) {
        return node; // preserved — stays unlocked.
      }
      // Reset — flip back to locked (the record stays so the player can see
      // the node was once unlocked, but they must re-pay to unlock it again).
      return { ...node, unlocked: false, unlockedAt: 0 };
    });

  // --- Build the next state ---
  // PRESERVED verbatim: originalLineageId, activeTraits, historicalRecords,
  // generationHistory (the new full history). totalSpent is preserved (the
  // cumulative genetic-legacy points spent on research — a historical tally,
  // not a per-generation budget). availableTraits is preserved (genetic
  // material unlocked via research stays unlocked for acquisition, even if the
  // research that unlocked them is reset — GDD §11.2 genetic material is
  // preserved across the lineage).
  const next: GameState = {
    ...state,
    progression: {
      research: {
        nodes: newResearchNodes,
        totalSpent: state.progression.research.totalSpent,
      },
      genetics: state.progression.genetics, // preserved verbatim (incl. originalLineageId)
      achievements: state.progression.achievements, // preserved (achievements are permanent — GDD §12)
      prestige: {
        geneticLegacyPoints: balanceAfter.toString(10),
        totalGenerations: newTotalGenerations,
        currentGeneration: newGenerationNumber,
        prestigeMultiplier: newPrestigeMultiplier,
        historicalRecords: state.progression.prestige.historicalRecords, // preserved
      },
      generationHistory: newHistory,
    },
    // DEFERRED TO P9c: the play-state reset (cash, accounts, businesses,
    // automation, inventory, originalTree replant, economy re-seed,
    // trait inheritance). P9b does NOT touch these — the skeleton is testable
    // in isolation. The play-state reset lands atomically in P9c.
  };

  const event: SimulationEvent = {
    type: 'generation-established',
    at: tick,
    payload: {
      generationNumber: newGenerationNumber,
      previousGeneration,
      geneticLegacyPointsEarned: earned.toString(10),
      geneticLegacyPointsAfter: balanceAfter.toString(10),
      prestigeMultiplierAfter: newPrestigeMultiplier,
      newTreeSpeciesId,
    },
  };

  return { state: next, event };
}

// ---------------------------------------------------------------------------
// Duration check (used by the prestige-reset action handler)
// ---------------------------------------------------------------------------

/**
 * Whether the current generation has run long enough to be prestige-reset
 * (PROVISIONAL_PRESTIGE_GENERATION_MIN_DURATION_DAYS sim days since the
 * current generation started — GDD §11.3 / §17). Returns the days elapsed
 * since the generation start + the boolean decision. Pure read.
 */
export function generationDurationStatus(
  state: GameState,
  tick: number,
): { daysElapsed: number; minDays: number; canPrestige: boolean } {
  const start = computeGenerationStart(state);
  const daysElapsed = Math.max(0, Math.floor((tick - start) / SECONDS_PER_DAY));
  const minDays = PROVISIONAL_PRESTIGE_GENERATION_MIN_DURATION_DAYS;
  return { daysElapsed, minDays, canPrestige: daysElapsed >= minDays };
}
