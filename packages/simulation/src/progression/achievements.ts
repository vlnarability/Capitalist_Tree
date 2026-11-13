/**
 * Achievement evaluation pure helpers (P9b — TDD §5.7 / §11, GDD §12 Player
 * Objectives).
 *
 * The six GDD §12 objective achievements (wealth, restoration, destruction,
 * balance, industrial, generational) plus six incremental `milestone`
 * achievements are content-defined
 * (`packages/content/src/progression/achievements/`). Each AchievementDefinition
 * carries a *descriptive* `completionCriteria` string (rule 5 — content is
 * data); the *evaluation* logic lives here, reading the relevant live state
 * (personalCash for wealth, environment.biodiversity/forestCoverage/soil/
 * ecosystemResilience for restoration, businesses' supply-chain levels for
 * industrial, prestige.totalGenerations for generational, etc.).
 *
 *   - `checkAchievements(state, currentTick)` : the throttled evaluation. For
 *     each tracked achievement not yet unlocked, compute its `progress` (0–1)
 *     against the current game state; when `progress` reaches 1, flip
 *     `unlocked: true` + stamp `unlockedAt`, and emit an
 *     `achievement-unlocked` event. Returns `{ state, events }`.
 *   - `seedTrackedAchievements(state)` : populate
 *     `progression.achievements.tracked` with one entry per known
 *     AchievementDefinition (all unlocked=false, progress=0). Idempotent —
 *     a second call is a no-op (existing records are preserved). Called by the
 *     ProgressionSystem on its first tick (when `tracked` is empty) so the
 *     system has a record to update.
 *   - `shouldCheckAchievements(currentTick, stepSeconds)` : the throttle gate
 *     — true every PROVISIONAL_ACHIEVEMENT_CHECK_INTERVAL_TICKS ticks.
 *   - `evaluateAchievementProgress(definition, state)` : compute a single
 *     achievement's progress (0–1) against the state. Exposed so tests can
 *     assert the per-achievement thresholds directly.
 *
 * Throttle (GDD §17 — achievement evaluation reads across many systems, so
 * running it every tick is wasteful): the ProgressionSystem calls
 * `checkAchievements` only when `shouldCheckAchievements` returns true (or on
 * the first tick, when `tracked` is empty and must be seeded). The throttle is
 * deterministic given `currentTick` + `stepSeconds` — no persisted
 * last-checked field is needed (the schema's AchievementState has no such
 * field; P9a froze the schema).
 *
 * Pure: every helper returns a new state (and events) without mutating the
 * input. Deterministic given (state, currentTick).
 */
import type {
  AchievementDefinition,
  AchievementState,
  GameState,
  SimulationEvent,
} from '@capitalist-tree/shared';
import { PROVISIONAL_ACHIEVEMENT_CHECK_INTERVAL_TICKS } from '@capitalist-tree/shared';
import { ACHIEVEMENTS, getAchievementById } from '@capitalist-tree/content';

// ---------------------------------------------------------------------------
// Local @provisional thresholds (GDD §17 — achievement thresholds) — R-P9-4
// ---------------------------------------------------------------------------
// The AchievementDefinition.completionCriteria strings reference
// `PROVISIONAL_ACHIEVEMENT_*` thresholds descriptively (e.g. "personalCash >=
// PROVISIONAL_ACHIEVEMENT_WEALTH_THRESHOLD"). P9a did not stamp these as
// constants in packages/shared (the shared progression constants file holds
// only the cadence + prestige-economy constants). P9b defines them here, in
// the simulation package, as @provisional tuning values (rule 10). They are
// pure data — promote them to packages/shared/src/constants/progression.ts
// (dropping the local prefix) once playtesting settles the thresholds.

// PROVISIONAL (GDD §17: Player Objectives — §12 The Wealthiest Being)
// "extraordinary wealth" — 10,000,000 minor units = $100,000. PROVISIONAL.
const PROVISIONAL_ACHIEVEMENT_WEALTH_THRESHOLD = 10_000_000n;

// PROVISIONAL (GDD §17: Player Objectives — §12 The Wealthiest Being)
// Fraction of total monetary supply the player must control (>= 25%). PROVISIONAL.
const PROVISIONAL_ACHIEVEMENT_WEALTH_SUPPLY_SHARE = 0.25;

// PROVISIONAL (GDD §17: Player Objectives — §12 The Generational Legacy)
// Generations to establish before the achievement unlocks. PROVISIONAL.
const PROVISIONAL_ACHIEVEMENT_GENERATIONS_THRESHOLD = 3;

// PROVISIONAL (GDD §17: Player Objectives — §12 The Industrial Empire)
// All six supply-chain levels must be owned. PROVISIONAL (matches GDD §8.2).
const PROVISIONAL_ACHIEVEMENT_SUPPLY_CHAIN_LEVELS = 6;

// PROVISIONAL (GDD §17: Player Objectives — §12 The Great Restoration)
// All four env indicators must exceed 0.8. PROVISIONAL.
const PROVISIONAL_ACHIEVEMENT_RESTORATION_THRESHOLD = 0.8;

// PROVISIONAL (GDD §17: Player Objectives — §12 The Last Tree)
// Destruction thresholds (biodiversity < 0.2, forestCoverage < 0.1,
// landUse.degraded > 0.8). PROVISIONAL.
const PROVISIONAL_ACHIEVEMENT_DESTRUCTION_BIODIVERSITY_MAX = 0.2;
const PROVISIONAL_ACHIEVEMENT_DESTRUCTION_FOREST_MAX = 0.1;
const PROVISIONAL_ACHIEVEMENT_DESTRUCTION_DEGRADED_MIN = 0.8;

// PROVISIONAL (GDD §17: Player Objectives — §12 The Natural Balance)
// Financial security threshold + original tree alive. PROVISIONAL.
const PROVISIONAL_ACHIEVEMENT_BALANCE_FINANCIAL_SECURITY = 0.8;

// PROVISIONAL (GDD §17: Player Objectives — §12 The Last Tree)
// Cumulative extraction threshold. The simulation does not yet track a
// cumulative-extraction counter (no schema field); P9b approximates "cumulative
// extraction exceeds threshold" by checking that total currency sinks
// (`economy.totalSinks`) exceed a provisional minor-unit threshold. This is a
// coarse proxy — a real extraction ledger lands in a later phase (R-P9-5).
// PROVISIONAL.
const PROVISIONAL_ACHIEVEMENT_EXTRACTION_SINKS_THRESHOLD = 1_000_000n;

// ---------------------------------------------------------------------------
// Throttle
// ---------------------------------------------------------------------------

/**
 * The throttle gate — true when the current tick index is a multiple of
 * PROVISIONAL_ACHIEVEMENT_CHECK_INTERVAL_TICKS. `currentTick` is the
 * simulation second (= ctx.now); `stepSeconds` is the per-step duration
 * (PROVISIONAL_SIMULATION_STEP_SECONDS). The tick index is
 * `floor(currentTick / stepSeconds)`. Deterministic given (currentTick,
 * stepSeconds). Returns false if stepSeconds <= 0 (defensive — the
 * ProgressionSystem only runs during advance where stepSeconds > 0).
 */
export function shouldCheckAchievements(
  currentTick: number,
  stepSeconds: number,
): boolean {
  if (stepSeconds <= 0) return false;
  const tickIndex = Math.floor(currentTick / stepSeconds);
  return tickIndex % PROVISIONAL_ACHIEVEMENT_CHECK_INTERVAL_TICKS === 0;
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

/**
 * Populate `progression.achievements.tracked` with one AchievementState per
 * known AchievementDefinition (all unlocked=false, progress=0). Idempotent —
 * records that already exist (by id) are preserved; only missing ones are
 * appended (defensive against content additions after a save was written — a
 * new achievement in content gets a fresh record on the next seed call).
 *
 * Pure: returns a new state. Returns the input unchanged if every known
 * achievement already has a record.
 */
export function seedTrackedAchievements(state: GameState): GameState {
  const existingIds = new Set(state.progression.achievements.tracked.map((a) => a.id));
  const missing = ACHIEVEMENTS.filter((a) => !existingIds.has(a.id));
  if (missing.length === 0) {
    return state;
  }
  const newRecords: AchievementState[] = missing.map((a) => ({
    id: a.id,
    unlocked: false,
    unlockedAt: 0,
    progress: 0,
  }));
  return {
    ...state,
    progression: {
      ...state.progression,
      achievements: {
        tracked: [...state.progression.achievements.tracked, ...newRecords],
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Per-achievement progress evaluation
// ---------------------------------------------------------------------------

/**
 * Compute the progress (0–1) of a single achievement against the current game
 * state. Progress is a continuous fraction where reasonable (wealth /
 * restoration / balance / generational) so the UI can show a progress bar;
 * binary achievements (milestones like first-business, first-trait,
 * research-pioneer) return 0 or 1.
 *
 * The evaluation reads the relevant state slices per the achievement's
 * `objectiveCategory` + id:
 *
 *   - `achievement:wealthiest-being` (wealth) : personalCash >= threshold AND
 *     player controls >= 25% of total monetary supply. Progress = min of the
 *     two sub-fractions.
 *   - `achievement:great-restoration` (restoration) : biodiversity.index >
 *     0.8 AND forestCoverage > 0.8 AND soil.health > 0.8 AND
 *     ecosystemResilience > 0.8. Progress = min of the four sub-fractions.
 *   - `achievement:last-tree` (destruction) : biodiversity.index < 0.2 AND
 *     forestCoverage < 0.1 AND landUse.degraded > 0.8 AND cumulative
 *     extraction (proxied by economy.totalSinks) exceeds threshold. Progress =
 *     min of the four sub-fractions (destruction inverts the env fractions).
 *   - `achievement:natural-balance` (balance) : originalTree.alive AND
 *     player.financialSecurity > 0.8 AND ecosystem self-sustaining (proxied
 *     by ecosystemResilience > 0.8 in P9b — a real self-sustaining check is
 *     deferred). Progress = min of the three sub-fractions; alive is binary.
 *   - `achievement:industrial-empire` (industrial) : player owns at least one
 *     business at each of the six supply-chain levels AND total business
 *     valuation exceeds a provisional threshold. Progress = (levels owned /
 *     6) capped by the valuation fraction.
 *   - `achievement:generational-legacy` (generational) :
 *     prestige.totalGenerations >= threshold AND at least one trait carried
 *     forward across each generation boundary (proxied in P9b by
 *     activeTraits.length >= 1 once generations >= threshold). Progress =
 *     min(generationsFraction, traitFraction).
 *   - `achievement:first-business` (milestone) : businesses.length >= 1.
 *   - `achievement:first-million` (milestone) : personalCash >= 1,000,000.
 *   - `achievement:first-generation` (milestone) : totalGenerations >= 1.
 *   - `achievement:1000-days-survived` (milestone) : originalTree.alive AND
 *     clock.day >= 1000.
 *   - `achievement:first-trait` (milestone) : activeTraits.length >= 1.
 *   - `achievement:research-pioneer` (milestone) : >= 1 unlocked research
 *     node.
 *
 * Unknown achievement ids (defensive — content may add achievements after a
 * save was written) return 0.
 *
 * Pure: reads only the state.
 */
export function evaluateAchievementProgress(
  definition: AchievementDefinition,
  state: GameState,
): number {
  const clamp = (v: number): number => Math.max(0, Math.min(1, v));
  const env = state.world.environment;
  const prestige = state.progression.prestige;
  const genetics = state.progression.genetics;

  switch (definition.id) {
    case 'achievement:wealthiest-being': {
      const cash = BigInt(state.player.personalCash);
      const supply = BigInt(state.economy.monetarySupply);
      const cashFrac =
        PROVISIONAL_ACHIEVEMENT_WEALTH_THRESHOLD > 0n
          ? Number(cash) / Number(PROVISIONAL_ACHIEVEMENT_WEALTH_THRESHOLD)
          : 1;
      // Player's share of the total monetary supply (personalCash / supply).
      // Defensively guard against zero supply.
      const shareFrac =
        supply > 0n
          ? Number(cash) / Number(supply) / PROVISIONAL_ACHIEVEMENT_WEALTH_SUPPLY_SHARE
          : 0;
      return clamp(Math.min(cashFrac, shareFrac));
    }

    case 'achievement:great-restoration': {
      const bio = clamp(env.biodiversity.index / PROVISIONAL_ACHIEVEMENT_RESTORATION_THRESHOLD);
      const forest = clamp(env.forestCoverage / PROVISIONAL_ACHIEVEMENT_RESTORATION_THRESHOLD);
      const soil = clamp(env.soil.health / PROVISIONAL_ACHIEVEMENT_RESTORATION_THRESHOLD);
      const resilience = clamp(
        env.ecosystemResilience / PROVISIONAL_ACHIEVEMENT_RESTORATION_THRESHOLD,
      );
      return clamp(Math.min(bio, forest, soil, resilience));
    }

    case 'achievement:last-tree': {
      // Destruction: low biodiversity + low forest + high degradation + high
      // extraction. Each sub-fraction inverts so "worse env = higher progress".
      const bioFrac =
        env.biodiversity.index <= PROVISIONAL_ACHIEVEMENT_DESTRUCTION_BIODIVERSITY_MAX
          ? 1
          : clamp(
              1 -
                (env.biodiversity.index - PROVISIONAL_ACHIEVEMENT_DESTRUCTION_BIODIVERSITY_MAX) /
                  (1 - PROVISIONAL_ACHIEVEMENT_DESTRUCTION_BIODIVERSITY_MAX),
            );
      const forestFrac =
        env.forestCoverage <= PROVISIONAL_ACHIEVEMENT_DESTRUCTION_FOREST_MAX
          ? 1
          : clamp(
              1 -
                (env.forestCoverage - PROVISIONAL_ACHIEVEMENT_DESTRUCTION_FOREST_MAX) /
                  (1 - PROVISIONAL_ACHIEVEMENT_DESTRUCTION_FOREST_MAX),
            );
      const degradedFrac = clamp(
        env.landUse.degraded / PROVISIONAL_ACHIEVEMENT_DESTRUCTION_DEGRADED_MIN,
      );
      // Cumulative extraction proxied by economy.totalSinks (a real extraction
      // ledger lands in a later phase — R-P9-5, @provisional).
      const sinks = BigInt(state.economy.totalSinks);
      const extractionFrac =
        PROVISIONAL_ACHIEVEMENT_EXTRACTION_SINKS_THRESHOLD > 0n
          ? Number(sinks) / Number(PROVISIONAL_ACHIEVEMENT_EXTRACTION_SINKS_THRESHOLD)
          : 1;
      return clamp(Math.min(bioFrac, forestFrac, degradedFrac, extractionFrac));
    }

    case 'achievement:natural-balance': {
      // Binary alive + financial security + ecosystem resilience proxy.
      const aliveFrac = state.originalTree.alive ? 1 : 0;
      const securityFrac = clamp(
        state.player.financialSecurity / PROVISIONAL_ACHIEVEMENT_BALANCE_FINANCIAL_SECURITY,
      );
      // P9b proxies "ecosystem self-sustaining" by ecosystemResilience (a real
      // year-over-year stability check is deferred — R-P9-6, @provisional).
      const sustainFrac = clamp(
        env.ecosystemResilience / PROVISIONAL_ACHIEVEMENT_RESTORATION_THRESHOLD,
      );
      return clamp(Math.min(aliveFrac, securityFrac, sustainFrac));
    }

    case 'achievement:industrial-empire': {
      // Player owns at least one business at each of the six supply-chain
      // levels (GDD §8.2). Progress = levels owned / 6 (the valuation
      // sub-requirement is approximated by the levels fraction in P9b — a real
      // total-valuation threshold lands in a later phase — @provisional).
      const levelsOwned = new Set(
        state.businesses.map((b) => b.supplyChainLevel),
      );
      const levelsFrac =
        levelsOwned.size / PROVISIONAL_ACHIEVEMENT_SUPPLY_CHAIN_LEVELS;
      return clamp(levelsFrac);
    }

    case 'achievement:generational-legacy': {
      const gensFrac =
        prestige.totalGenerations / PROVISIONAL_ACHIEVEMENT_GENERATIONS_THRESHOLD;
      // P9b proxies "at least one trait carried forward across each generation
      // boundary" by activeTraits.length >= 1 once generations >= threshold.
      // A real per-generation trait-inheritance audit lands in P9c
      // (@provisional).
      const traitFrac = genetics.activeTraits.length >= 1 ? 1 : 0;
      return clamp(Math.min(gensFrac, traitFrac));
    }

    case 'achievement:first-business':
      return state.businesses.length >= 1 ? 1 : 0;

    case 'achievement:first-million':
      return BigInt(state.player.personalCash) >= 1_000_000n ? 1 : 0;

    case 'achievement:first-generation':
      return prestige.totalGenerations >= 1 ? 1 : 0;

    case 'achievement:1000-days-survived':
      return state.originalTree.alive && state.clock.day >= 1000 ? 1 : 0;

    case 'achievement:first-trait':
      return genetics.activeTraits.length >= 1 ? 1 : 0;

    case 'achievement:research-pioneer':
      return state.progression.research.nodes.some((n) => n.unlocked) ? 1 : 0;

    default:
      // Unknown achievement id (defensive — content may add achievements
      // after a save was written). Returns 0; the achievement never unlocks
      // until a handler is written for it.
      return 0;
  }
}

// ---------------------------------------------------------------------------
// checkAchievements — the throttled evaluation
// ---------------------------------------------------------------------------

export interface CheckAchievementsResult {
  readonly state: GameState;
  readonly events: readonly SimulationEvent[];
}

/**
 * Evaluate every tracked achievement against the current game state. For each
 * tracked achievement not yet unlocked, recompute its `progress` (0–1); when
 * `progress` reaches 1, flip `unlocked: true`, stamp `unlockedAt =
 * currentTick`, and emit an `achievement-unlocked` event carrying the
 * achievement id + its objective category (so the UI can group the unlock by
 * GDD §12 objective).
 *
 * Already-unlocked achievements are NOT re-evaluated (idempotent — an
 * achievement unlocks once; the GDD §12 objectives "are tracked independently
 * and may overlap" but each individual achievement fires at most once). The
 * `progress` field of an already-unlocked achievement is left at 1 (it was set
 * when the achievement unlocked).
 *
 * The throttle (PROVISIONAL_ACHIEVEMENT_CHECK_INTERVAL_TICKS) is applied by
 * the ProgressionSystem BEFORE calling this — `checkAchievements` itself
 * evaluates unconditionally so tests can drive it directly. The system's
 * throttle is the only cadence gate.
 *
 * Pure: returns a new state + events. Deterministic given (state,
 * currentTick). Never mutates the input.
 */
export function checkAchievements(
  state: GameState,
  currentTick: number,
): CheckAchievementsResult {
  // Ensure every known achievement has a tracked record (idempotent).
  let next: GameState = seedTrackedAchievements(state);
  const events: SimulationEvent[] = [];

  let trackedChanged = false;
  const tracked = next.progression.achievements.tracked.map((record) => {
    if (record.unlocked) {
      return record; // already unlocked — do not re-evaluate.
    }
    const definition = getAchievementById(record.id);
    if (!definition) {
      return record; // unknown id (content removed) — skip defensively.
    }
    const progress = evaluateAchievementProgress(definition, next);
    if (progress >= 1) {
      trackedChanged = true;
      events.push({
        type: 'achievement-unlocked',
        at: currentTick,
        payload: {
          achievementId: record.id,
          objectiveCategory: definition.objectiveCategory,
        },
      });
      return {
        ...record,
        unlocked: true,
        unlockedAt: currentTick,
        progress: 1,
      };
    }
    // Update the progress fraction (the UI reads it for progress bars). Only
    // mark trackedChanged if the progress actually moved (avoids needless
    // state churn when nothing changed).
    if (progress !== record.progress) {
      trackedChanged = true;
      return { ...record, progress };
    }
    return record;
  });

  if (!trackedChanged) {
    // No record moved — return the seeded state (which may differ from the
    // input if seeding appended records).
    return { state: next, events };
  }

  next = {
    ...next,
    progression: {
      ...next.progression,
      achievements: { tracked },
    },
  };
  return { state: next, events };
}
