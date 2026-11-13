/**
 * Prestige pure helpers (P9b skeleton + P9c full reset — TDD §5.7 / §11, GDD
 * §11.3 Prestige).
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
 *   - `applyPrestigeReset(state, newTreeSpeciesId, tick)` : the FULL
 *     generational reset (P9c, resolves P9b deferred item #1) — credits the
 *     earned points to `geneticLegacyPoints`, increments `totalGenerations` +
 *     `currentGeneration`, finalises the current `generationHistory` entry,
 *     appends the new generation's history entry, preserves the
 *     `PROVISIONAL_PRESTIGE_PRESERVED_RESOURCES` fraction of unlocked research,
 *     carries the lineage's active traits into the new generation via
 *     `inheritTraits` (GDD §11.2 — genetic material preserved; magnitude
 *     lightly mutated), and performs the full play-state reset: replants
 *     `originalTree` as a sapling of `newTreeSpeciesId` (keeping `id ===
 *     'original'` + `isOriginal === true` — GDD §16.1 / §16.2), resets
 *     `player` to the starting baseline, clears `businesses` + `automation` +
 *     `inventory`, resets `world.environment` to the ecological baseline, and
 *     re-seeds the `economy`. PRESERVES across the reset: `originalLineageId`
 *     (permanent — GDD §11.2), `geneticLegacyPoints` (grows), the full
 *     `generationHistory`, `historicalRecords`, `achievements` (permanent —
 *     GDD §12), `metadata`, `clock`, `history`, `rngState` (zero root draws —
 *     R-P9-1), `rngStreams`, and `scheduler`. Returns `{ state, event }` (the
 *     `generation-established` SimulationEvent).
 *   - `computeGenerationStart(state)` : the simulation second at which the
 *     current generation started (0 if no prestige has happened yet; the last
 *     `generationHistory` entry's `startDate` otherwise). Used by the
 *     `prestige-reset` action handler to enforce
 *     `PROVISIONAL_PRESTIGE_GENERATION_MIN_DURATION_DAYS`.
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
  ProgressionState,
  ResearchNodeState,
  SimulationEvent,
} from '@capitalist-tree/shared';
import {
  PROVISIONAL_PRESTIGE_BASE_LEGACY_POINTS_PER_GENERATION,
  PROVISIONAL_PRESTIGE_LEGACY_MULTIPLIER_PER_TRAIT,
  PROVISIONAL_PRESTIGE_PRESERVED_RESOURCES,
  PROVISIONAL_PRESTIGE_GENERATION_MIN_DURATION_DAYS,
} from '@capitalist-tree/shared';
import { findSpeciesById } from '@capitalist-tree/content';
import { SECONDS_PER_DAY } from '../systems/time-system.js';
import { initializeState, DEFAULT_GAME_CONFIG } from '../initial-state.js';
import { inheritTraits } from './genetics.js';

/** The genetics slice of ProgressionState (activeTraits + availableTraits + originalLineageId). */
type GeneticsState = ProgressionState['genetics'];

// PROVISIONAL (GDD §17: Prestige and Generational Progression — §11.3)
//
// The prestige multiplier grows with each completed generation, rewarding
// sustained lineage development (GDD §11.3 — generational progress, not a
// numerical reset-for-multiplier). `prestigeMultiplier = 1 + 0.1 *
// totalGenerations` (after increment). PROVISIONAL — tuned during playtesting.
// R-P9-7: this growth constant is a LOCAL @provisional (NOT promoted to a
// shared PROVISIONAL_PRESTIGE_ constant in packages/shared); promote it once
// playtesting calibrates the prestige-multiplier curve.
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
// applyPrestigeReset — the FULL generational reset (P9c)
// ---------------------------------------------------------------------------

export interface ApplyPrestigeResetResult {
  readonly state: GameState;
  readonly event: SimulationEvent;
}

/**
 * Apply a prestige reset — establish a new generation (GDD §11.3 — prestige
 * is generational progress, NOT a numerical reset-for-multiplier). The FULL
 * reset (P9c, resolves P9b deferred item #1):
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
 *      the original tree's current species.
 *   6. Append the new generation's history entry (`generationNumber:
 *      currentGeneration` AFTER increment, `treeSpeciesId: newTreeSpeciesId`,
 *      `startDate: tick`, `endDate: null`, `outcome: 'ongoing'`,
 *      `prestigeEarned: '0'`).
 *   7. Preserve the `PROVISIONAL_PRESTIGE_PRESERVED_RESOURCES` fraction of
 *      unlocked research (GDD §11.3 reward: research advantages).
 *   8. PRESERVE across the reset (GDD §11.2 / §11.3): `originalLineageId`
 *      (NEVER modified), the acquired `activeTraits` (genetic material —
 *      carried into the new generation via `inheritTraits`, re-stamped to the
 *      new generation + lightly mutated), the full `generationHistory`,
 *      `geneticLegacyPoints` (which grew in step 2), `historicalRecords`,
 *      `availableTraits` (genetic potential unlocked via research stays
 *      unlocked for acquisition), and `achievements` (permanent — GDD §12).
 *   9. P9c play-state reset — CLEAR / re-seed the per-generation play state:
 *        a. `originalTree` REPLANTED as a sapling of `newTreeSpeciesId`
 *           (age 0, alive, biology reset to the species' `initial` block).
 *           The tree's `id` stays `'original'` + `isOriginal` stays `true`
 *           (GDD §16.1 / §16.2) — the original tree is the PERMANENT anchor;
 *           only its biological state resets. `originalLineageId` (the
 *           genetic identity) is preserved separately on `genetics`.
 *        b. `player` reset to the starting baseline (personalCash =
 *           startingPersonalCash, health/happiness/financialSecurity at
 *           neutral, unpaidDays 0, livingExpenses zeroed — a new generation
 *           starts fresh financially).
 *        c. `businesses` CLEARED (they do not survive generations — GDD §11.3
 *           prestige resets the commercial empire).
 *        d. `automation` CLEARED.
 *        e. `inventory` CLEARED.
 *        f. `world.environment` RESET to the ecological baseline (a new
 *           generation starts fresh ecologically — GDD §11.3 reward: new
 *           starting environments; P9c uses the canonical baseline). The
 *           persisted `rngStreams.weather` is preserved so the WeatherSystem
 *           sequence stays deterministic across the reset.
 *        g. `economy` RE-SEEDED (markets back to base prices + initial
 *           supply, accounts reset to the starting cash distribution,
 *           monetarySupply / totalIssued / totalSinks reset to the starting
 *           values, monetaryAuthority structure preserved with fresh
 *           policy). The conservation invariant is re-established at the new
 *           generation's start.
 *   10. PRESERVE across the reset (non-play state): `metadata`, `clock` (the
 *       game does not rewind — the prestige-reset is an action at `tick`),
 *       `history` (snapshots/archive), `rngState` (root RNG — prestige-reset
 *       consumes ZERO root RNG draws; `inheritTraits` derives independent
 *       seeded rngs, R-P9-1), `rngStreams`, and `scheduler`.
 *
 * The play-state slices in step 9 are borrowed from a fresh
 * `initializeState({...DEFAULT_GAME_CONFIG, speciesId: newTreeSpeciesId,
 * seed: <old seed>})` template. This guarantees the reset slices EXACTLY
 * match a fresh game of the new species (correct sapling biology, baseline
 * environment, re-seeded economy, starting cash) without duplicating the
 * initial-state construction logic. The template's RNG (root + weather fork)
 * is DISCARDED — the old state's `rngState` + `rngStreams` are preserved so
 * the simulation's RNG determinism contract survives the reset (TDD §18.3).
 *
 * `newTreeSpeciesId` MUST be a registered species id (`findSpeciesById`).
 * An unknown id throws — the prestige-reset cannot replant a sapling of an
 * unregistered species. The action handler does not pre-validate (the
 * schema's `prestigeResetActionSchema` only requires a non-empty string);
 * this helper is the gatekeeper.
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
  // Resolve the new species — the originalTree is replanted as a sapling of
  // this species. An unknown id throws (the prestige-reset cannot replant an
  // unregistered species).
  const species = findSpeciesById(newTreeSpeciesId);
  if (!species) {
    throw new Error(
      `applyPrestigeReset: unknown species id "${newTreeSpeciesId}". ` +
        `Register the species in packages/content/src/species/ (findSpeciesById).`,
    );
  }

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

  // --- P9c trait inheritance (GDD §11.2) ---
  // Active traits carry into the new generation, re-stamped to the new
  // generation + lightly mutated. originalLineageId + availableTraits are
  // preserved verbatim by inheritTraits.
  const inheritedGenetics: GeneticsState = inheritTraits(
    state,
    newGenerationNumber,
  );

  // --- P9c play-state reset: borrow slices from a fresh init template ---
  // The template is a full fresh GameState of the new species with the SAME
  // seed. Only the play-state slices (originalTree sapling, baseline
  // environment, re-seeded economy, starting player, empty
  // businesses/inventory/automation) are borrowed; the template's RNG +
  // metadata + clock + history + scheduler + progression are DISCARDED (the
  // old state's are preserved below). Deterministic given (seed, speciesId).
  const template = initializeState({
    ...DEFAULT_GAME_CONFIG,
    seed: state.metadata.randomSeed,
    saveId: state.metadata.saveId,
    speciesId: newTreeSpeciesId,
    createdAt: state.metadata.createdAt,
    startingDay: state.clock.day,
  });

  // --- Build the next state ---
  const next: GameState = {
    // PRESERVED verbatim: metadata, clock (no rewind), history, rngState
    // (zero root draws — R-P9-1), rngStreams (weather sequence stays
    // deterministic), scheduler, eventState (the EventSystem's scheduler +
    // global/regional world state — preserved like the P0 scheduler; the
    // EventSystem (P10b) may refine whether active events clear on prestige).
    metadata: state.metadata,
    clock: state.clock,
    history: state.history,
    rngState: state.rngState,
    rngStreams: state.rngStreams,
    scheduler: state.scheduler,
    eventState: state.eventState,
    // P9c play-state reset — borrowed from the fresh template.
    originalTree: template.originalTree, // sapling of newTreeSpeciesId; id='original'
    player: template.player, // starting cash + neutral well-being
    businesses: template.businesses, // [] — cleared
    inventory: template.inventory, // { items: [] } — cleared
    automation: template.automation, // [] — cleared
    // Environment reset to baseline + weather reset to initial condition;
    // preserve the old regionId (the plot is the same across generations).
    world: { ...template.world, regionId: state.world.regionId },
    // Economy re-seeded (markets at base price, accounts at starting cash,
    // monetarySupply/totalIssued/totalSinks reset; monetaryAuthority
    // structure preserved with fresh policy).
    economy: template.economy,
    progression: {
      research: {
        nodes: newResearchNodes,
        // totalSpent is preserved (cumulative genetic-legacy points spent on
        // research — a historical tally, not a per-generation budget).
        totalSpent: state.progression.research.totalSpent,
      },
      // P9c — inherited genetics (activeTraits carried into the new
      // generation; availableTraits + originalLineageId preserved verbatim).
      genetics: inheritedGenetics,
      achievements: state.progression.achievements, // preserved (permanent — GDD §12)
      prestige: {
        geneticLegacyPoints: balanceAfter.toString(10),
        totalGenerations: newTotalGenerations,
        currentGeneration: newGenerationNumber,
        prestigeMultiplier: newPrestigeMultiplier,
        historicalRecords: state.progression.prestige.historicalRecords, // preserved
      },
      generationHistory: newHistory,
    },
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
