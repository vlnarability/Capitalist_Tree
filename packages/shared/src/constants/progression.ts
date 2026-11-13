/**
 * Progression provisional constants (P9a — TDD §5.7 / §11, GDD §11 Progression
 * and Generations, §12 Player Objectives).
 *
 * Every value in this file is a provisional tuning decision for the
 * ProgressionSystem (P9b — research unlocking, trait application, achievement
 * evaluation, prestige reset). They live here, in a single file, so they can
 * be tuned in one place during playtesting rather than scattered as magic
 * numbers across the system (matching the convention in
 * `packages/shared/src/constants/provisional.ts`).
 *
 * CONVENTION (GDD §17): each constant carries a `// PROVISIONAL (GDD §17:
 * <item>)` comment pointing at the GDD entry it resolves. When a value is
 * promoted from "provisional" to "decided" via playtesting, move it to a new
 * `decided.ts` sibling and remove the `PROVISIONAL_` prefix.
 */

// PROVISIONAL (GDD §17: Prestige and Generational Progression — §11.3)
//
// Base genetic-legacy points earned per completed generation, BEFORE trait
// bonuses and the prestige multiplier. The ProgressionSystem (P9b) credits
// `base + activeTraits * PROVISIONAL_PRESTIGE_LEGACY_MULTIPLIER_PER_TRAIT`,
// scaled by `prestige.prestigeMultiplier`, when a `prestige-reset` action
// finalises a generation. Tunable — the starting balance of the prestige
// economy.
export const PROVISIONAL_PRESTIGE_BASE_LEGACY_POINTS_PER_GENERATION = 10;

// PROVISIONAL (GDD §17: Prestige and Generational Progression — §11.2 / §11.3)
//
// Bonus genetic-legacy points earned per active (expressed) trait the lineage
// carries into the prestige reset. Rewards the player for building a rich
// genetic legacy (GDD §11.2). Stacks linearly with the active-trait count.
export const PROVISIONAL_PRESTIGE_LEGACY_MULTIPLIER_PER_TRAIT = 2;

// PROVISIONAL (GDD §17: Prestige and Generational Progression — §11.3)
//
// Minimum simulation days the current generation must have run before a
// `prestige-reset` is allowed. Prevents instant-reset farming. The
// ProgressionSystem (P9b) rejects the action with `GenerationTooEarlyError`
// if `clock.day - generationHistory[current].startDate / SECONDS_PER_DAY`
// is below this threshold.
export const PROVISIONAL_PRESTIGE_GENERATION_MIN_DURATION_DAYS = 120;

// PROVISIONAL (GDD §17: Prestige and Generational Progression — §11.3)
//
// Fraction (0–1) of unlocked research that is PRESERVED across a prestige
// reset. The remainder is reset (the player re-earns it in the new
// generation). Genetic-legacy points, acquired traits, the original-tree
// lineage id, and the full generation history are ALWAYS preserved (GDD §11.2
// / §11.3) — this constant only governs how much research survives. 0.5 means
// half the unlocked research nodes carry over.
export const PROVISIONAL_PRESTIGE_PRESERVED_RESOURCES = 0.5;

// PROVISIONAL (GDD §17: Prestige and Generational Progression — §11.2)
//
// Cost scaling multiplier per research-node tier. The ProgressionSystem (P9b)
// applies research-node costs as defined in content (genetic-legacy points),
// but this factor scales the effective cost upward for higher-tier nodes
// (those with longer prerequisite chains) to keep deep research expensive.
// Applied as `effectiveCost = definition.cost * (1 + tier * multiplier)`
// where `tier` = the node's prerequisite depth.
export const PROVISIONAL_RESEARCH_COST_MULTIPLIER = 0.25;

// PROVISIONAL (GDD §17: Prestige and Generational Progression — §11.2)
//
// Default magnitude (0–1) at which a genetic trait is expressed when the
// `activate-trait` action is dispatched without an explicit `magnitude`. The
// ProgressionSystem (P9b) clamps any provided magnitude to [0, 1] and applies
// this default when the payload omits it.
export const PROVISIONAL_TRAIT_MAGNITUDE_DEFAULT = 0.75;

// PROVISIONAL (GDD §17: Prestige and Generational Progression — §12)
//
// How often (in simulation ticks) the ProgressionSystem (P9b) re-evaluates
// achievement completion. Achievements are checked on a slower cadence than
// per-tick state advances (the evaluation reads across many systems — cash,
// biodiversity, generation count — so running it every tick is wasteful).
// 60 ticks = 60 simulation minutes = 1 real minute at 1x speed.
export const PROVISIONAL_ACHIEVEMENT_CHECK_INTERVAL_TICKS = 60;
