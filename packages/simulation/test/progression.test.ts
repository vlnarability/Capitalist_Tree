/**
 * Progression module unit + integration tests (P9b — TDD §18.1, §18.4; TDD
 * §5.7 Progression State, §11; GDD §11 Progression and Generations, §12
 * Player Objectives).
 *
 * Asserts the invariants the GDD and TDD require:
 *
 *   - Research: unlockResearchNode checks prerequisites (fails if prereq not
 *     unlocked), checks cost (fails if insufficient geneticLegacyPoints),
 *     deducts cost, sets unlocked + unlockedAt; getUnlockedResearch returns
 *     the correct list; isResearchUnlocked boolean gate.
 *   - Achievements: checkAchievements evaluates criteria (wealth unlocks when
 *     personalCash >= threshold; restoration unlocks when biodiversity +
 *     forestCoverage high; industrial unlocks when businesses span supply-
 *     chain levels; generational unlocks when totalGenerations >= N);
 *     throttled by interval (not every tick); emits achievement-unlocked;
 *     doesn't re-unlock already-unlocked.
 *   - Prestige: computePrestigeEarned = (base + traits*mult) * multiplier;
 *     applyPrestigeReset increments generation counter, records history,
 *     adds earned to geneticLegacyPoints, preserves originalLineageId.
 *   - Actions: unlock-research (success + fail paths); activate-trait
 *     (available→active); deactivate-trait (active→available flag);
 *     prestige-reset (skeleton); record-historical-event (idempotent).
 *   - originalLineageId never modified by any action.
 *   - Determinism: same seed → same progression state.
 *   - Purity: input not mutated (freeze test).
 *   - RNG fork DEFERRED (R-P9-1): ProgressionSystem at slot #11 does NOT fork
 *     'progression' — the persisted rngState accumulates every per-step fork,
 *     so a fork here would shift the BiologySystem (#3) + AutomationSystem (#9)
 *     child seeds at every subsequent tick (they fork BEFORE ProgressionSystem
 *     but their child seeds depend on the root state). That breaks the
 *     calibrated mortality / catch-up death sequences. The fork lands in P9c
 *     alongside its stochastic mechanics once the downstream sequences are
 *     retuned. Verified by the zero-root-draw + starved-tree-still-dies tests.
 */
import { describe, it, expect } from 'vitest';
import {
  engine,
  progressionSystem,
  defaultRegistry,
  defaultSystems,
  unlockResearchNode,
  getUnlockedResearch,
  isResearchUnlocked,
  effectiveResearchCost,
  researchNodeTier,
  checkAchievements,
  seedTrackedAchievements,
  shouldCheckAchievements,
  evaluateAchievementProgress,
  computePrestigeEarned,
  applyPrestigeReset,
  computeGenerationStart,
  generationDurationStatus,
  createBusinessFromDefinition,
  UnknownResearchNodeError,
  ResearchPrerequisitesNotMetError,
  InsufficientGeneticLegacyError,
  UnknownTraitError,
  TraitNotAcquiredError,
  GenerationTooEarlyError,
} from '../src/index.js';
import type { SystemContext } from '../src/systems/system.js';
import { Rng } from '../src/rng.js';
import { DEFAULT_GAME_CONFIG } from '../src/initial-state.js';
import {
  IMPROVED_PHOTOSYNTHESIS,
  DROUGHT_RESISTANCE_BREEDING,
  ADVANCED_IRRIGATION,
  PRECISION_FERTILIZATION,
  RAPID_GROWTH,
  DEEP_ROOTS,
  getAchievementById,
  ACHIEVEMENTS,
  WATER_EXTRACTION_PLANT,
  FERTILIZER_FACTORY,
} from '@capitalist-tree/content';
import {
  type GameState,
  type GameConfig,
  type BusinessState,
  PROVISIONAL_SIMULATION_STEP_SECONDS,
  PROVISIONAL_PRESTIGE_BASE_LEGACY_POINTS_PER_GENERATION,
  PROVISIONAL_PRESTIGE_LEGACY_MULTIPLIER_PER_TRAIT,
  PROVISIONAL_PRESTIGE_GENERATION_MIN_DURATION_DAYS,
  PROVISIONAL_TRAIT_MAGNITUDE_DEFAULT,
  PROVISIONAL_ACHIEVEMENT_CHECK_INTERVAL_TICKS,
} from '@capitalist-tree/shared';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const STEP = PROVISIONAL_SIMULATION_STEP_SECONDS;
const SECONDS_PER_DAY = 24 * 60 * 60;

function cfg(seed: number): GameConfig {
  return { ...DEFAULT_GAME_CONFIG, seed };
}

/** Fresh GameState from a seed. */
function freshState(seed = 42): GameState {
  return engine.initialize(cfg(seed));
}

/**
 * Build a state with a given geneticLegacyPoints balance (the prestige
 * currency) so research-unlock tests can drive the cost gate without running
 * a full prestige cycle.
 */
function stateWithLegacy(points: string, seed = 42): GameState {
  const state = freshState(seed);
  return {
    ...state,
    progression: {
      ...state.progression,
      prestige: {
        ...state.progression.prestige,
        geneticLegacyPoints: points,
      },
    },
  };
}

/** Deep-freeze an object so any mutation throws (purity test). */
function deepFreeze<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v;
  Object.freeze(v);
  if (Array.isArray(v)) {
    for (const item of v) deepFreeze(item);
  } else {
    for (const key of Object.keys(v as Record<string, unknown>)) {
      deepFreeze((v as Record<string, unknown>)[key]);
    }
  }
  return v;
}

/** Build a SystemContext for a single step at `now`. */
function ctxAt(state: GameState, now: number, seed = 42): SystemContext {
  return {
    now,
    stepSeconds: STEP,
    dayOfYear: state.clock.day,
    rng: Rng.fromState(state.rngState),
  };
}

// ---------------------------------------------------------------------------
// Registry position — slot #11
// ---------------------------------------------------------------------------

describe('registry position — ProgressionSystem is slot #11', () => {
  it('defaultSystems has ProgressionSystem at index 10 (slot #11)', () => {
    expect(defaultSystems[10]?.id).toBe('ProgressionSystem');
  });

  it('defaultRegistry.all()[10] is ProgressionSystem', () => {
    expect(defaultRegistry.all()[10]?.id).toBe('ProgressionSystem');
  });

  it('defaultRegistry.ids() lists ProgressionSystem after EnvironmentSystem', () => {
    const ids = defaultRegistry.ids();
    const envIdx = ids.indexOf('EnvironmentSystem');
    const progIdx = ids.indexOf('ProgressionSystem');
    const eventIdx = ids.indexOf('EventSystem');
    expect(envIdx).toBeGreaterThanOrEqual(0);
    expect(progIdx).toBe(envIdx + 1);
    expect(eventIdx).toBe(progIdx + 1);
  });
});

// ---------------------------------------------------------------------------
// Research pure helpers
// ---------------------------------------------------------------------------

describe('research — unlockResearchNode', () => {
  it('throws UnknownResearchNodeError for an unknown node id', () => {
    const state = stateWithLegacy('1000');
    expect(() => unlockResearchNode(state, 'research:does-not-exist', 0)).toThrow(
      UnknownResearchNodeError,
    );
  });

  it('unlocks a root node (no prerequisites), debiting the effective cost', () => {
    const state = stateWithLegacy('100');
    const result = unlockResearchNode(
      state,
      IMPROVED_PHOTOSYNTHESIS.id,
      100,
    );
    expect(result.event.type).toBe('research-unlocked');
    expect(result.event.payload.researchNodeId).toBe(IMPROVED_PHOTOSYNTHESIS.id);
    // IMPROVED_PHOTOSYNTHESIS is a root (tier 0) → effective cost = base cost.
    const expectedCost = effectiveResearchCost(IMPROVED_PHOTOSYNTHESIS);
    expect(result.event.payload.cost).toBe(expectedCost.toString(10));
    // Cost was debited from geneticLegacyPoints.
    const balanceAfter = BigInt('100') - expectedCost;
    expect(result.state.progression.prestige.geneticLegacyPoints).toBe(
      balanceAfter.toString(10),
    );
    // totalSpent was incremented.
    expect(result.state.progression.research.totalSpent).toBe(
      expectedCost.toString(10),
    );
    // The node record is now unlocked + stamped.
    const record = result.state.progression.research.nodes.find(
      (n) => n.id === IMPROVED_PHOTOSYNTHESIS.id,
    );
    expect(record?.unlocked).toBe(true);
    expect(record?.unlockedAt).toBe(100);
    expect(record?.categoryId).toBe('biology');
    expect(record?.prerequisites).toEqual([]);
    expect(record?.cost).toBe(IMPROVED_PHOTOSYNTHESIS.cost);
  });

  it('throws ResearchPrerequisitesNotMetError when a prerequisite is not unlocked', () => {
    const state = stateWithLegacy('1000');
    // DROUGHT_RESISTANCE_BREEDING requires IMPROVED_PHOTOSYNTHESIS (not yet
    // unlocked).
    expect(() =>
      unlockResearchNode(state, DROUGHT_RESISTANCE_BREEDING.id, 0),
    ).toThrow(ResearchPrerequisitesNotMetError);
  });

  it('unlocks a chained node after its prerequisite is unlocked', () => {
    let state = stateWithLegacy('1000');
    state = unlockResearchNode(state, IMPROVED_PHOTOSYNTHESIS.id, 100).state;
    const result = unlockResearchNode(
      state,
      DROUGHT_RESISTANCE_BREEDING.id,
      200,
    );
    expect(result.event.type).toBe('research-unlocked');
    expect(result.event.payload.researchNodeId).toBe(
      DROUGHT_RESISTANCE_BREEDING.id,
    );
    // DROUGHT_RESISTANCE_BREEDING is tier 1 → effective cost is scaled.
    const expectedCost = effectiveResearchCost(DROUGHT_RESISTANCE_BREEDING);
    expect(BigInt(expectedCost)).toBeGreaterThan(
      BigInt(DROUGHT_RESISTANCE_BREEDING.cost),
    );
    const record = result.state.progression.research.nodes.find(
      (n) => n.id === DROUGHT_RESISTANCE_BREEDING.id,
    );
    expect(record?.unlocked).toBe(true);
    expect(record?.unlockedAt).toBe(200);
  });

  it('throws InsufficientGeneticLegacyError when the balance is too low', () => {
    const state = stateWithLegacy('5'); // less than the cost (10).
    expect(() => unlockResearchNode(state, IMPROVED_PHOTOSYNTHESIS.id, 0)).toThrow(
      InsufficientGeneticLegacyError,
    );
  });

  it('is idempotent — unlocking an already-unlocked node is a no-op (no double-spend)', () => {
    let state = stateWithLegacy('1000');
    state = unlockResearchNode(state, IMPROVED_PHOTOSYNTHESIS.id, 100).state;
    const balanceBefore = state.progression.prestige.geneticLegacyPoints;
    const result = unlockResearchNode(
      state,
      IMPROVED_PHOTOSYNTHESIS.id,
      200,
    );
    // Balance unchanged — no double-spend.
    expect(result.state.progression.prestige.geneticLegacyPoints).toBe(
      balanceBefore,
    );
    // The node is still unlocked; the marker event carries cost '0'.
    expect(result.event.payload.cost).toBe('0');
  });

  it('does NOT mutate its input (freeze test)', () => {
    const state = deepFreeze(structuredClone(stateWithLegacy('100')));
    expect(() =>
      unlockResearchNode(state, IMPROVED_PHOTOSYNTHESIS.id, 0),
    ).not.toThrow();
  });
});

describe('research — queries', () => {
  it('getUnlockedResearch returns the unlocked node ids in insertion order', () => {
    let state = stateWithLegacy('1000');
    state = unlockResearchNode(state, IMPROVED_PHOTOSYNTHESIS.id, 100).state;
    state = unlockResearchNode(state, DROUGHT_RESISTANCE_BREEDING.id, 200).state;
    expect(getUnlockedResearch(state)).toEqual([
      IMPROVED_PHOTOSYNTHESIS.id,
      DROUGHT_RESISTANCE_BREEDING.id,
    ]);
  });

  it('isResearchUnlocked is a boolean gate', () => {
    let state = stateWithLegacy('1000');
    expect(isResearchUnlocked(state, IMPROVED_PHOTOSYNTHESIS.id)).toBe(false);
    state = unlockResearchNode(state, IMPROVED_PHOTOSYNTHESIS.id, 100).state;
    expect(isResearchUnlocked(state, IMPROVED_PHOTOSYNTHESIS.id)).toBe(true);
    // Unknown node id → false (defensive).
    expect(isResearchUnlocked(state, 'research:unknown')).toBe(false);
  });
});

describe('research — effectiveResearchCost + researchNodeTier', () => {
  it('root nodes are tier 0 and cost the base', () => {
    expect(researchNodeTier(IMPROVED_PHOTOSYNTHESIS.id)).toBe(0);
    expect(effectiveResearchCost(IMPROVED_PHOTOSYNTHESIS)).toBe(
      BigInt(IMPROVED_PHOTOSYNTHESIS.cost),
    );
  });

  it('chained nodes are tier 1+ and cost more than the base', () => {
    expect(researchNodeTier(DROUGHT_RESISTANCE_BREEDING.id)).toBe(1);
    expect(
      BigInt(effectiveResearchCost(DROUGHT_RESISTANCE_BREEDING)),
    ).toBeGreaterThan(BigInt(DROUGHT_RESISTANCE_BREEDING.cost));
  });

  it('PRECISION_FERTILIZATION is tier 2 (chain depth 2)', () => {
    // PRECISION_FERTILIZATION requires ADVANCED_IRRIGATION (root) → tier 1.
    // AUTONOMOUS_HARVESTING requires PRECISION_FERTILIZATION → tier 2.
    expect(researchNodeTier(PRECISION_FERTILIZATION.id)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Achievements pure helpers
// ---------------------------------------------------------------------------

describe('achievements — seeding + throttle', () => {
  it('seedTrackedAchievements populates one record per known achievement', () => {
    const state = freshState();
    const seeded = seedTrackedAchievements(state);
    expect(seeded.progression.achievements.tracked).toHaveLength(
      ACHIEVEMENTS.length,
    );
    for (const record of seeded.progression.achievements.tracked) {
      expect(record.unlocked).toBe(false);
      expect(record.progress).toBe(0);
      expect(getAchievementById(record.id)).toBeDefined();
    }
  });

  it('seedTrackedAchievements is idempotent', () => {
    const state = freshState();
    const once = seedTrackedAchievements(state);
    const twice = seedTrackedAchievements(once);
    expect(twice.progression.achievements.tracked).toEqual(
      once.progression.achievements.tracked,
    );
  });

  it('shouldCheckAchievements is true only every interval ticks', () => {
    const interval = PROVISIONAL_ACHIEVEMENT_CHECK_INTERVAL_TICKS;
    // tickIndex 0 → true (0 % interval === 0).
    expect(shouldCheckAchievements(0, STEP)).toBe(true);
    // tickIndex 1 → false.
    expect(shouldCheckAchievements(STEP, STEP)).toBe(false);
    // tickIndex interval → true.
    expect(shouldCheckAchievements(interval * STEP, STEP)).toBe(true);
    // tickIndex interval + 1 → false.
    expect(shouldCheckAchievements((interval + 1) * STEP, STEP)).toBe(false);
  });

  it('shouldCheckAchievements returns false when stepSeconds <= 0 (defensive)', () => {
    expect(shouldCheckAchievements(100, 0)).toBe(false);
  });
});

describe('achievements — evaluateAchievementProgress', () => {
  it('wealth achievement progress rises with personalCash', () => {
    const state = freshState();
    const def = getAchievementById('achievement:wealthiest-being')!;
    // Starting cash (50000) is well below the 10,000,000 threshold.
    const lowProgress = evaluateAchievementProgress(def, state);
    expect(lowProgress).toBeGreaterThanOrEqual(0);
    expect(lowProgress).toBeLessThan(1);
    // Crank personalCash to the threshold → progress 1 (if supply share met).
    const rich: GameState = {
      ...state,
      player: { ...state.player, personalCash: '10000000' },
      economy: { ...state.economy, monetarySupply: '10000000' },
    };
    const fullProgress = evaluateAchievementProgress(def, rich);
    expect(fullProgress).toBe(1);
  });

  it('restoration achievement unlocks when biodiversity + forestCoverage + soil + resilience are high', () => {
    const state = freshState();
    const def = getAchievementById('achievement:great-restoration')!;
    const restored: GameState = {
      ...state,
      world: {
        ...state.world,
        environment: {
          ...state.world.environment,
          biodiversity: { ...state.world.environment.biodiversity, index: 0.9 },
          forestCoverage: 0.9,
          soil: { ...state.world.environment.soil, health: 0.9 },
          ecosystemResilience: 0.9,
        },
      },
    };
    expect(evaluateAchievementProgress(def, restored)).toBe(1);
    // At baseline (0.8 / 0.3 / 1 / 0.8) progress is partial (forest 0.3/0.8).
    const baselineProgress = evaluateAchievementProgress(def, state);
    expect(baselineProgress).toBeLessThan(1);
  });

  it('industrial achievement progress rises with distinct supply-chain levels owned', () => {
    const state = freshState();
    const def = getAchievementById('achievement:industrial-empire')!;
    // No businesses → progress 0.
    expect(evaluateAchievementProgress(def, state)).toBe(0);
    // Build three businesses at distinct supply-chain levels (0, 2, 1) using
    // the real createBusinessFromDefinition helper so the BusinessState shape
    // is correct. WATER_EXTRACTION_PLANT is level 0 (extraction);
    // FERTILIZER_FACTORY is level 2 (manufacturing); override the third's
    // supplyChainLevel to 1 (processing) so the three are distinct.
    const b1 = createBusinessFromDefinition(
      WATER_EXTRACTION_PLANT,
      'business:test:0',
      'B0',
    );
    const b2 = createBusinessFromDefinition(
      FERTILIZER_FACTORY,
      'business:test:1',
      'B2',
    );
    const b3: BusinessState = {
      ...createBusinessFromDefinition(
        FERTILIZER_FACTORY,
        'business:test:2',
        'B1',
      ),
      supplyChainLevel: 1,
    };
    const withBusinesses: GameState = {
      ...state,
      businesses: [b1, b2, b3],
    };
    // Three distinct levels owned out of 6 → progress 0.5.
    expect(evaluateAchievementProgress(def, withBusinesses)).toBeCloseTo(0.5, 5);
  });

  it('generational achievement unlocks when totalGenerations >= threshold AND a trait is active', () => {
    const state = freshState();
    const def = getAchievementById('achievement:generational-legacy')!;
    // No generations + no traits → progress 0.
    expect(evaluateAchievementProgress(def, state)).toBe(0);
    // 3 generations + one active trait → progress 1.
    const progressed: GameState = {
      ...state,
      progression: {
        ...state.progression,
        prestige: {
          ...state.progression.prestige,
          totalGenerations: 3,
        },
        genetics: {
          ...state.progression.genetics,
          activeTraits: [
            {
              traitId: 'trait:rapid-growth',
              active: true,
              generation: 1,
              magnitude: 0.75,
            },
          ],
        },
      },
    };
    expect(evaluateAchievementProgress(def, progressed)).toBe(1);
  });

  it('milestone achievements are binary (first-million, first-generation, first-trait, research-pioneer)', () => {
    const state = freshState();
    const firstMillion = getAchievementById('achievement:first-million')!;
    const firstGen = getAchievementById('achievement:first-generation')!;
    const firstTrait = getAchievementById('achievement:first-trait')!;
    const researchPioneer = getAchievementById('achievement:research-pioneer')!;
    // Baseline — none met.
    expect(evaluateAchievementProgress(firstMillion, state)).toBe(0);
    expect(evaluateAchievementProgress(firstGen, state)).toBe(0);
    expect(evaluateAchievementProgress(firstTrait, state)).toBe(0);
    expect(evaluateAchievementProgress(researchPioneer, state)).toBe(0);
    // Met.
    const rich: GameState = {
      ...state,
      player: { ...state.player, personalCash: '1000000' },
      progression: {
        research: {
          nodes: [
            {
              id: IMPROVED_PHOTOSYNTHESIS.id,
              categoryId: 'biology',
              unlocked: true,
              unlockedAt: 1,
              prerequisites: [],
              cost: '10',
            },
          ],
          totalSpent: '10',
        },
        genetics: {
          ...state.progression.genetics,
          activeTraits: [
            {
              traitId: 'trait:rapid-growth',
              active: true,
              generation: 1,
              magnitude: 0.75,
            },
          ],
        },
        prestige: {
          ...state.progression.prestige,
          totalGenerations: 1,
        },
        achievements: state.progression.achievements,
        generationHistory: state.progression.generationHistory,
      },
    };
    expect(evaluateAchievementProgress(firstMillion, rich)).toBe(1);
    expect(evaluateAchievementProgress(firstGen, rich)).toBe(1);
    expect(evaluateAchievementProgress(firstTrait, rich)).toBe(1);
    expect(evaluateAchievementProgress(researchPioneer, rich)).toBe(1);
  });
});

describe('achievements — checkAchievements', () => {
  it('seeds tracked + emits achievement-unlocked for newly-completed achievements', () => {
    const state = freshState();
    // Make the player wealthy enough for first-million (1,000,000 minor units).
    const rich: GameState = {
      ...state,
      player: { ...state.player, personalCash: '1000000' },
    };
    const result = checkAchievements(rich, 100);
    const unlocked = result.events.filter(
      (e) => e.type === 'achievement-unlocked',
    );
    expect(unlocked.length).toBeGreaterThanOrEqual(1);
    const ids = unlocked.map(
      (e) => e.payload.achievementId,
    );
    expect(ids).toContain('achievement:first-million');
    // The tracked record for first-million is now unlocked + stamped.
    const record = result.state.progression.achievements.tracked.find(
      (a) => a.id === 'achievement:first-million',
    );
    expect(record?.unlocked).toBe(true);
    expect(record?.unlockedAt).toBe(100);
    expect(record?.progress).toBe(1);
  });

  it('does NOT re-unlock an already-unlocked achievement (idempotent)', () => {
    const state = freshState();
    const rich: GameState = {
      ...state,
      player: { ...state.player, personalCash: '1000000' },
    };
    const first = checkAchievements(rich, 100);
    const second = checkAchievements(first.state, 200);
    const secondUnlocked = second.events.filter(
      (e) => e.type === 'achievement-unlocked',
    );
    // No first-million event on the second pass (already unlocked).
    const firstMillionEvents = secondUnlocked.filter(
      (e) => e.payload.achievementId === 'achievement:first-million',
    );
    expect(firstMillionEvents).toHaveLength(0);
  });

  it('emits no events when nothing newly completes', () => {
    const state = freshState();
    // Baseline state — no achievement thresholds met at game start (cash 50000,
    // no businesses, no traits, no research, no generations).
    const result = checkAchievements(state, 100);
    const unlocked = result.events.filter(
      (e) => e.type === 'achievement-unlocked',
    );
    expect(unlocked).toEqual([]);
  });

  it('does NOT mutate its input (freeze test)', () => {
    const state = deepFreeze(structuredClone(freshState()));
    expect(() => checkAchievements(state, 100)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Prestige pure helpers
// ---------------------------------------------------------------------------

describe('prestige — computePrestigeEarned', () => {
  it('returns the base when no active traits + multiplier 1', () => {
    const state = freshState();
    const earned = computePrestigeEarned(state);
    // base = 10, 0 active traits, multiplier 1 → 10.
    expect(earned).toBe(
      BigInt(PROVISIONAL_PRESTIGE_BASE_LEGACY_POINTS_PER_GENERATION),
    );
  });

  it('adds the per-trait bonus for each active (expressed) trait', () => {
    const state = freshState();
    const withTraits: GameState = {
      ...state,
      progression: {
        ...state.progression,
        genetics: {
          ...state.progression.genetics,
          activeTraits: [
            { traitId: 'trait:rapid-growth', active: true, generation: 1, magnitude: 0.75 },
            { traitId: 'trait:large-foliage', active: true, generation: 1, magnitude: 0.75 },
            // A deactivated trait does NOT count.
            { traitId: 'trait:deep-roots', active: false, generation: 1, magnitude: 0.75 },
          ],
        },
      },
    };
    const earned = computePrestigeEarned(withTraits);
    // base(10) + 2 active * 2 = 14, * multiplier 1 = 14.
    expect(earned).toBe(
      BigInt(
        PROVISIONAL_PRESTIGE_BASE_LEGACY_POINTS_PER_GENERATION +
          2 * PROVISIONAL_PRESTIGE_LEGACY_MULTIPLIER_PER_TRAIT,
      ),
    );
  });

  it('scales by the prestige multiplier', () => {
    const state = freshState();
    const withMultiplier: GameState = {
      ...state,
      progression: {
        ...state.progression,
        prestige: {
          ...state.progression.prestige,
          prestigeMultiplier: 2.0,
        },
        genetics: {
          ...state.progression.genetics,
          activeTraits: [
            { traitId: 'trait:rapid-growth', active: true, generation: 1, magnitude: 0.75 },
          ],
        },
      },
    };
    const earned = computePrestigeEarned(withMultiplier);
    // (base 10 + 1*2) * 2.0 = 24.
    expect(earned).toBe(24n);
  });
});

describe('prestige — applyPrestigeReset (skeleton)', () => {
  it('throws GenerationTooEarlyError when fired before the minimum duration', () => {
    const state = freshState();
    // Fire at tick = 10 seconds — well below 120 days.
    expect(() =>
      applyPrestigeReset(state, 'species:white-oak', 10),
    ).toThrow(GenerationTooEarlyError);
  });

  it('increments totalGenerations + currentGeneration, credits earned points, records history', () => {
    const state = stateWithLegacy('0');
    const minDurationSeconds =
      PROVISIONAL_PRESTIGE_GENERATION_MIN_DURATION_DAYS * SECONDS_PER_DAY;
    const result = applyPrestigeReset(
      state,
      'species:white-oak',
      minDurationSeconds,
    );
    expect(result.event.type).toBe('generation-established');
    expect(result.event.payload.generationNumber).toBe(2);
    expect(result.event.payload.previousGeneration).toBe(1);
    // Earned = base 10 (no traits, multiplier 1).
    const earned = computePrestigeEarned(state);
    expect(result.event.payload.geneticLegacyPointsEarned).toBe(
      earned.toString(10),
    );
    // Balance grew by the earned amount.
    expect(result.state.progression.prestige.geneticLegacyPoints).toBe(
      (BigInt('0') + earned).toString(10),
    );
    expect(result.state.progression.prestige.totalGenerations).toBe(1);
    expect(result.state.progression.prestige.currentGeneration).toBe(2);
    // History: the generation-1 entry is finalised 'completed' + a new
    // generation-2 'ongoing' entry is appended.
    expect(result.state.progression.generationHistory).toHaveLength(2);
    const gen1 = result.state.progression.generationHistory[0]!;
    expect(gen1.generationNumber).toBe(1);
    expect(gen1.outcome).toBe('completed');
    expect(gen1.endDate).toBe(minDurationSeconds);
    expect(gen1.prestigeEarned).toBe(earned.toString(10));
    const gen2 = result.state.progression.generationHistory[1]!;
    expect(gen2.generationNumber).toBe(2);
    expect(gen2.outcome).toBe('ongoing');
    expect(gen2.endDate).toBeNull();
    expect(gen2.treeSpeciesId).toBe('species:white-oak');
    expect(gen2.startDate).toBe(minDurationSeconds);
  });

  it('PRESERVES originalLineageId across the reset (GDD §11.2)', () => {
    const state = freshState();
    const before = state.progression.genetics.originalLineageId;
    const minDurationSeconds =
      PROVISIONAL_PRESTIGE_GENERATION_MIN_DURATION_DAYS * SECONDS_PER_DAY;
    const result = applyPrestigeReset(
      state,
      'species:red-maple',
      minDurationSeconds,
    );
    expect(result.state.progression.genetics.originalLineageId).toBe(before);
  });

  it('preserves the PROVISIONAL fraction of unlocked research', () => {
    // Unlock 2 research nodes, then prestige — floor(2 * 0.5) = 1 preserved.
    let state = stateWithLegacy('1000');
    state = unlockResearchNode(state, IMPROVED_PHOTOSYNTHESIS.id, 100).state;
    state = unlockResearchNode(state, ADVANCED_IRRIGATION.id, 200).state;
    const unlockedBefore = getUnlockedResearch(state);
    expect(unlockedBefore).toHaveLength(2);
    const minDurationSeconds =
      PROVISIONAL_PRESTIGE_GENERATION_MIN_DURATION_DAYS * SECONDS_PER_DAY;
    const result = applyPrestigeReset(
      state,
      'species:white-oak',
      minDurationSeconds,
    );
    const unlockedAfter = getUnlockedResearch(result.state);
    // floor(2 * 0.5) = 1 preserved.
    expect(unlockedAfter).toHaveLength(1);
    // The records themselves are preserved (only the unlocked flag flips).
    expect(result.state.progression.research.nodes).toHaveLength(2);
  });

  it('does NOT mutate its input (freeze test)', () => {
    const minDurationSeconds =
      PROVISIONAL_PRESTIGE_GENERATION_MIN_DURATION_DAYS * SECONDS_PER_DAY;
    const state = deepFreeze(structuredClone(freshState()));
    expect(() =>
      applyPrestigeReset(state, 'species:white-oak', minDurationSeconds),
    ).not.toThrow();
  });

  it('generationDurationStatus reports daysElapsed + canPrestige', () => {
    const state = freshState();
    const early = generationDurationStatus(state, SECONDS_PER_DAY);
    expect(early.canPrestige).toBe(false);
    expect(early.daysElapsed).toBe(1);
    const late = generationDurationStatus(
      state,
      (PROVISIONAL_PRESTIGE_GENERATION_MIN_DURATION_DAYS + 1) * SECONDS_PER_DAY,
    );
    expect(late.canPrestige).toBe(true);
  });

  it('computeGenerationStart is 0 before any prestige', () => {
    const state = freshState();
    expect(computeGenerationStart(state)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

describe('actions — unlock-research', () => {
  it('success path: deducts cost, emits research-unlocked, flips the node', () => {
    const state = stateWithLegacy('1000');
    const result = engine.executeAction(state, {
      type: 'unlock-research',
      payload: { researchNodeId: IMPROVED_PHOTOSYNTHESIS.id, tick: 100 },
    });
    const event = result.events.find((e) => e.type === 'research-unlocked');
    expect(event).toBeDefined();
    expect(event?.payload.researchNodeId).toBe(IMPROVED_PHOTOSYNTHESIS.id);
    expect(isResearchUnlocked(result.state, IMPROVED_PHOTOSYNTHESIS.id)).toBe(
      true,
    );
  });

  it('fail path: insufficient genetic-legacy points throws', () => {
    const state = stateWithLegacy('1');
    expect(() =>
      engine.executeAction(state, {
        type: 'unlock-research',
        payload: { researchNodeId: IMPROVED_PHOTOSYNTHESIS.id, tick: 0 },
      }),
    ).toThrow(InsufficientGeneticLegacyError);
  });

  it('fail path: unknown node id throws', () => {
    const state = stateWithLegacy('1000');
    expect(() =>
      engine.executeAction(state, {
        type: 'unlock-research',
        payload: { researchNodeId: 'research:unknown', tick: 0 },
      }),
    ).toThrow(UnknownResearchNodeError);
  });

  it('fail path: prerequisite not unlocked throws', () => {
    const state = stateWithLegacy('1000');
    expect(() =>
      engine.executeAction(state, {
        type: 'unlock-research',
        payload: { researchNodeId: DROUGHT_RESISTANCE_BREEDING.id, tick: 0 },
      }),
    ).toThrow(ResearchPrerequisitesNotMetError);
  });
});

describe('actions — activate-trait / deactivate-trait', () => {
  /** Build a state where IMPROVED_PHOTOSYNTHESIS is unlocked + RAPID_GROWTH is
   *  available (in availableTraits) but not yet acquired. */
  function stateWithAvailableTrait(): GameState {
    let state = stateWithLegacy('1000');
    state = unlockResearchNode(state, IMPROVED_PHOTOSYNTHESIS.id, 100).state;
    // The research node's effects.unlocks lists trait:rapid-growth; the
    // activate-trait flow expects the trait to be in availableTraits. Seed it
    // there (simulating the research-unlock side-effect that P9c will wire
    // fully — P9b's research helper stamps the node record; the trait
    // availability is content-defined via effects.unlocks).
    const unlocked = IMPROVED_PHOTOSYNTHESIS.effects.unlocks ?? [];
    return {
      ...state,
      progression: {
        ...state.progression,
        genetics: {
          ...state.progression.genetics,
          availableTraits: unlocked.filter((id) =>
            id.startsWith('trait:'),
          ),
        },
      },
    };
  }

  it('activate-trait moves a trait from availableTraits into activeTraits', () => {
    const state = stateWithAvailableTrait();
    expect(
      state.progression.genetics.availableTraits,
    ).toContain(RAPID_GROWTH.id);
    expect(state.progression.genetics.activeTraits).toHaveLength(0);
    const result = engine.executeAction(state, {
      type: 'activate-trait',
      payload: { traitId: RAPID_GROWTH.id },
    });
    const event = result.events.find((e) => e.type === 'trait-activated');
    expect(event).toBeDefined();
    expect(event?.payload.traitId).toBe(RAPID_GROWTH.id);
    expect(event?.payload.magnitude).toBe(PROVISIONAL_TRAIT_MAGNITUDE_DEFAULT);
    expect(event?.payload.generation).toBe(1);
    // The trait moved into activeTraits with active=true.
    const active = result.state.progression.genetics.activeTraits.find(
      (t) => t.traitId === RAPID_GROWTH.id,
    );
    expect(active?.active).toBe(true);
    expect(active?.magnitude).toBe(PROVISIONAL_TRAIT_MAGNITUDE_DEFAULT);
    expect(active?.generation).toBe(1);
    // availableTraits no longer lists it.
    expect(
      result.state.progression.genetics.availableTraits,
    ).not.toContain(RAPID_GROWTH.id);
  });

  it('activate-trait honors an explicit magnitude (clamped to [0, 1])', () => {
    const state = stateWithAvailableTrait();
    const result = engine.executeAction(state, {
      type: 'activate-trait',
      payload: { traitId: RAPID_GROWTH.id, magnitude: 0.5 },
    });
    const active = result.state.progression.genetics.activeTraits.find(
      (t) => t.traitId === RAPID_GROWTH.id,
    );
    expect(active?.magnitude).toBe(0.5);
  });

  it('activate-trait clamps an out-of-range magnitude to [0, 1]', () => {
    const state = stateWithAvailableTrait();
    const result = engine.executeAction(state, {
      type: 'activate-trait',
      payload: { traitId: RAPID_GROWTH.id, magnitude: 2.0 },
    });
    const active = result.state.progression.genetics.activeTraits.find(
      (t) => t.traitId === RAPID_GROWTH.id,
    );
    expect(active?.magnitude).toBe(1);
  });

  it('activate-trait throws TraitNotAcquiredError for a trait not acquired or available', () => {
    const state = freshState();
    // DEEP_ROOTS is a known trait but not acquired/available.
    expect(() =>
      engine.executeAction(state, {
        type: 'activate-trait',
        payload: { traitId: DEEP_ROOTS.id },
      }),
    ).toThrow(TraitNotAcquiredError);
  });

  it('activate-trait throws UnknownTraitError for an unknown trait id', () => {
    const state = freshState();
    expect(() =>
      engine.executeAction(state, {
        type: 'activate-trait',
        payload: { traitId: 'trait:unknown' },
      }),
    ).toThrow(UnknownTraitError);
  });

  it('activate-trait re-activates a deactivated trait (toggle back on)', () => {
    // Start with an active trait, deactivate, then re-activate.
    let state = stateWithAvailableTrait();
    state = engine.executeAction(state, {
      type: 'activate-trait',
      payload: { traitId: RAPID_GROWTH.id },
    }).state;
    state = engine.executeAction(state, {
      type: 'deactivate-trait',
      payload: { traitId: RAPID_GROWTH.id },
    }).state;
    const deactivated = state.progression.genetics.activeTraits.find(
      (t) => t.traitId === RAPID_GROWTH.id,
    );
    expect(deactivated?.active).toBe(false);
    // Re-activate.
    const result = engine.executeAction(state, {
      type: 'activate-trait',
      payload: { traitId: RAPID_GROWTH.id, magnitude: 0.9 },
    });
    const reactivated = result.state.progression.genetics.activeTraits.find(
      (t) => t.traitId === RAPID_GROWTH.id,
    );
    expect(reactivated?.active).toBe(true);
    expect(reactivated?.magnitude).toBe(0.9);
  });

  it('deactivate-trait sets active=false (trait stays acquired)', () => {
    let state = stateWithAvailableTrait();
    state = engine.executeAction(state, {
      type: 'activate-trait',
      payload: { traitId: RAPID_GROWTH.id },
    }).state;
    const result = engine.executeAction(state, {
      type: 'deactivate-trait',
      payload: { traitId: RAPID_GROWTH.id },
    });
    const event = result.events.find((e) => e.type === 'trait-deactivated');
    expect(event).toBeDefined();
    expect(event?.payload.traitId).toBe(RAPID_GROWTH.id);
    // The trait stays in activeTraits with active=false.
    const trait = result.state.progression.genetics.activeTraits.find(
      (t) => t.traitId === RAPID_GROWTH.id,
    );
    expect(trait).toBeDefined();
    expect(trait?.active).toBe(false);
  });

  it('deactivate-trait is idempotent — deactivating an already-deactivated trait is a no-op', () => {
    let state = stateWithAvailableTrait();
    state = engine.executeAction(state, {
      type: 'activate-trait',
      payload: { traitId: RAPID_GROWTH.id },
    }).state;
    state = engine.executeAction(state, {
      type: 'deactivate-trait',
      payload: { traitId: RAPID_GROWTH.id },
    }).state;
    const result = engine.executeAction(state, {
      type: 'deactivate-trait',
      payload: { traitId: RAPID_GROWTH.id },
    });
    expect(result.events).toEqual([]);
  });

  it('deactivate-trait throws TraitNotAcquiredError for a trait not acquired', () => {
    const state = freshState();
    expect(() =>
      engine.executeAction(state, {
        type: 'deactivate-trait',
        payload: { traitId: RAPID_GROWTH.id },
      }),
    ).toThrow(TraitNotAcquiredError);
  });
});

describe('actions — prestige-reset (skeleton)', () => {
  it('success path: increments generation + emits generation-established', () => {
    const state = freshState();
    const minDurationSeconds =
      PROVISIONAL_PRESTIGE_GENERATION_MIN_DURATION_DAYS * SECONDS_PER_DAY;
    const result = engine.executeAction(state, {
      type: 'prestige-reset',
      payload: {
        newTreeSpeciesId: 'species:white-oak',
        tick: minDurationSeconds,
      },
    });
    const event = result.events.find((e) => e.type === 'generation-established');
    expect(event).toBeDefined();
    expect(event?.payload.generationNumber).toBe(2);
    expect(result.state.progression.prestige.totalGenerations).toBe(1);
    expect(result.state.progression.prestige.currentGeneration).toBe(2);
  });

  it('fail path: throws GenerationTooEarlyError before the minimum duration', () => {
    const state = freshState();
    expect(() =>
      engine.executeAction(state, {
        type: 'prestige-reset',
        payload: { newTreeSpeciesId: 'species:white-oak', tick: 10 },
      }),
    ).toThrow(GenerationTooEarlyError);
  });
});

describe('actions — record-historical-event', () => {
  it('appends the event id + emits historical-event-recorded', () => {
    const state = freshState();
    const result = engine.executeAction(state, {
      type: 'record-historical-event',
      payload: {
        eventId: 'history:first-leaf-sold',
        title: 'First Leaf Sold',
        description: 'The original tree yielded its first harvest.',
        tick: 100,
      },
    });
    const event = result.events.find(
      (e) => e.type === 'historical-event-recorded',
    );
    expect(event).toBeDefined();
    expect(event?.payload.eventId).toBe('history:first-leaf-sold');
    expect(event?.payload.title).toBe('First Leaf Sold');
    expect(event?.payload.recordsAfter).toBe(1);
    expect(
      result.state.progression.prestige.historicalRecords,
    ).toContain('history:first-leaf-sold');
  });

  it('is idempotent — a duplicate eventId is a no-op', () => {
    let state = freshState();
    state = engine.executeAction(state, {
      type: 'record-historical-event',
      payload: {
        eventId: 'history:first-leaf-sold',
        title: 'First Leaf Sold',
        description: '...',
        tick: 100,
      },
    }).state;
    const result = engine.executeAction(state, {
      type: 'record-historical-event',
      payload: {
        eventId: 'history:first-leaf-sold',
        title: 'First Leaf Sold',
        description: '...',
        tick: 200,
      },
    });
    expect(result.events).toEqual([]);
    expect(
      result.state.progression.prestige.historicalRecords,
    ).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// originalLineageId guard — never modified by any action
// ---------------------------------------------------------------------------

describe('originalLineageId guard — never modified by any action', () => {
  function stateWithResearchAndTrait(): GameState {
    let state = stateWithLegacy('1000');
    state = unlockResearchNode(state, IMPROVED_PHOTOSYNTHESIS.id, 100).state;
    return {
      ...state,
      progression: {
        ...state.progression,
        genetics: {
          ...state.progression.genetics,
          availableTraits: [RAPID_GROWTH.id],
        },
      },
    };
  }

  it('unlock-research preserves originalLineageId', () => {
    const state = stateWithLegacy('1000');
    const before = state.progression.genetics.originalLineageId;
    const result = engine.executeAction(state, {
      type: 'unlock-research',
      payload: { researchNodeId: IMPROVED_PHOTOSYNTHESIS.id, tick: 0 },
    });
    expect(result.state.progression.genetics.originalLineageId).toBe(before);
  });

  it('activate-trait preserves originalLineageId', () => {
    const state = stateWithResearchAndTrait();
    const before = state.progression.genetics.originalLineageId;
    const result = engine.executeAction(state, {
      type: 'activate-trait',
      payload: { traitId: RAPID_GROWTH.id },
    });
    expect(result.state.progression.genetics.originalLineageId).toBe(before);
  });

  it('deactivate-trait preserves originalLineageId', () => {
    let state = stateWithResearchAndTrait();
    state = engine.executeAction(state, {
      type: 'activate-trait',
      payload: { traitId: RAPID_GROWTH.id },
    }).state;
    const before = state.progression.genetics.originalLineageId;
    const result = engine.executeAction(state, {
      type: 'deactivate-trait',
      payload: { traitId: RAPID_GROWTH.id },
    });
    expect(result.state.progression.genetics.originalLineageId).toBe(before);
  });

  it('prestige-reset preserves originalLineageId', () => {
    const state = freshState();
    const before = state.progression.genetics.originalLineageId;
    const minDurationSeconds =
      PROVISIONAL_PRESTIGE_GENERATION_MIN_DURATION_DAYS * SECONDS_PER_DAY;
    const result = engine.executeAction(state, {
      type: 'prestige-reset',
      payload: {
        newTreeSpeciesId: 'species:white-oak',
        tick: minDurationSeconds,
      },
    });
    expect(result.state.progression.genetics.originalLineageId).toBe(before);
  });

  it('record-historical-event preserves originalLineageId', () => {
    const state = freshState();
    const before = state.progression.genetics.originalLineageId;
    const result = engine.executeAction(state, {
      type: 'record-historical-event',
      payload: {
        eventId: 'history:test',
        title: 'Test',
        description: '...',
        tick: 0,
      },
    });
    expect(result.state.progression.genetics.originalLineageId).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Determinism + purity
// ---------------------------------------------------------------------------

describe('determinism + purity', () => {
  it('same seed → same progression state after N steps', () => {
    const make = (seed: number) => engine.advance(engine.initialize(cfg(seed)), STEP * 130).state;
    expect(make(99)).toEqual(make(99));
  });

  it('ProgressionSystem.execute does NOT mutate its input (freeze test)', () => {
    const state = freshState();
    const frozen = deepFreeze(structuredClone(state));
    const c = ctxAt(state, state.clock.elapsedSeconds + STEP);
    expect(() => progressionSystem.execute(frozen, c)).not.toThrow();
  });

  it('executeAction(unlock-research) does NOT mutate its input (freeze test)', () => {
    const state = deepFreeze(structuredClone(stateWithLegacy('1000')));
    expect(() =>
      engine.executeAction(state, {
        type: 'unlock-research',
        payload: { researchNodeId: IMPROVED_PHOTOSYNTHESIS.id, tick: 0 },
      }),
    ).not.toThrow();
  });

  it('same (state, ctx) → same ProgressionSystem result', () => {
    const state = freshState();
    const c1 = ctxAt(state, state.clock.elapsedSeconds + STEP);
    const c2 = ctxAt(state, state.clock.elapsedSeconds + STEP);
    const r1 = progressionSystem.execute(state, c1);
    const r2 = progressionSystem.execute(state, c2);
    expect(r2.state).toEqual(r1.state);
    expect(r2.events).toEqual(r1.events);
  });
});

// ---------------------------------------------------------------------------
// RNG fork DEFERRED (R-P9-1 — matches the R-P7-1 / R-P8-1 precedent)
// ---------------------------------------------------------------------------

describe('ProgressionSystem — RNG fork deferred (R-P9-1: zero root draws)', () => {
  it('execute() consumes ZERO root RNG draws (rng state unchanged)', () => {
    const initial = freshState(42);
    const rng = Rng.fromState(initial.rngState);
    const before = rng.getState();
    const c: SystemContext = {
      now: initial.clock.elapsedSeconds + STEP,
      stepSeconds: STEP,
      dayOfYear: initial.clock.day,
      rng,
    };
    progressionSystem.execute(initial, c);
    // The ProgressionSystem drew nothing (no fork). If a future change adds
    // ctx.rng.fork('ProgressionSystem'), fork() advances the root by one draw
    // (rng.ts) and this assertion fails.
    expect(rng.getState()).toEqual(before);
  });

  it('execute() consumes ZERO root RNG draws even when the achievement check runs (first tick, tracked empty)', () => {
    const initial = freshState(42);
    const rng = Rng.fromState(initial.rngState);
    const before = rng.getState();
    const c: SystemContext = {
      now: initial.clock.elapsedSeconds + STEP,
      stepSeconds: STEP,
      dayOfYear: initial.clock.day,
      rng,
    };
    // The first tick seeds + evaluates achievements (tracked empty → check
    // runs). The evaluation is pure arithmetic — it still consumes zero root
    // RNG draws.
    const result = progressionSystem.execute(initial, c);
    expect(result.state.progression.achievements.tracked.length).toBeGreaterThan(0);
    expect(rng.getState()).toEqual(before);
  });

  it('a full engine.advance persists the SAME root RNG whether or not the ProgressionSystem runs', () => {
    const initial = freshState(42);
    const full = engine.advance(initial, STEP);
    // Manually replay one step WITHOUT the ProgressionSystem to isolate its
    // root-RNG contribution (mirrors runOneStep's RNG threading).
    const rng = Rng.fromState(initial.rngState);
    const c: SystemContext = {
      now: initial.clock.elapsedSeconds + STEP,
      stepSeconds: STEP,
      dayOfYear: initial.clock.day,
      rng,
    };
    let next: GameState = initial;
    for (const system of defaultRegistry.all()) {
      if (system.id === 'ProgressionSystem') continue;
      next = system.execute(next, c).state;
    }
    // The persisted root RNG position is IDENTICAL whether or not the
    // ProgressionSystem ran — it contributes zero root draws, so the
    // downstream BiologySystem + AutomationSystem RNG sequences are
    // unaffected (R-P9-1).
    expect(rng.getState()).toEqual(full.state.rngState);
  });

  it('does NOT perturb the BiologySystem mortality sequence (starved tree still dies with the ProgressionSystem present)', () => {
    // The crippled-tree "starved tree still dies" test (environment.test.ts:984)
    // is calibrated to the CURRENT root-RNG sequence. Adding a ProgressionSystem
    // fork would shift BiologySystem's mortality rolls (the persisted rngState
    // accumulates every per-step fork, so BiologySystem's child seed at step
    // N+1 depends on step N's fork count) and flip dies-in-1-day → survives.
    // This test pins the no-fork outcome: a crippled tree still dies within
    // one sim day with the ProgressionSystem in the registry — proving the
    // mortality sequence is unperturbed.
    function crippled(seed: number): GameState {
      const s = engine.initialize({ ...DEFAULT_GAME_CONFIG, seed, createdAt: 0 });
      const t = s.originalTree;
      return {
        ...s,
        originalTree: {
          ...t,
          alive: true,
          stress: 1,
          health: 0,
          energy: { ...t.energy, reserves: 0, production: 0, consumption: 0 },
          water: { ...t.water, stored: 0 },
          foliage: { ...t.foliage, currentLeaves: 0 },
          damage: [
            { type: 'severe-defoliation', severity: 1, appliedAt: s.clock.elapsedSeconds },
            { type: 'severe-defoliation', severity: 1, appliedAt: s.clock.elapsedSeconds },
          ],
        },
      };
    }
    const s = crippled(3);
    const result = engine.advance(s, SECONDS_PER_DAY);
    expect(result.state.originalTree.alive).toBe(false);
    expect(result.events.some((e) => e.type === 'tree-died')).toBe(true);
  });
});
