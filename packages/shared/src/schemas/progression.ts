import { z } from 'zod';

/**
 * Progression state + content definitions (P9a — TDD §5.1 / §5.7, GDD §11
 * Progression and Generations, §12 Player Objectives).
 *
 * This file EXTENDS the P0 stub (which only tracked `research: [{id,
 * completedAt}]`, `achievements: [{id, completedAt}]`, and a provisional
 * `geneticLegacy: number`). P9a replaces that minimal stub with the full
 * progression shape required by GDD §11 (Genetic Legacy, Prestige) and §12
 * (Player Objectives). The v11 → v12 migration in
 * `packages/shared/src/migrations/defaults.ts` restructures a v11 save's
 * progression field into this new shape so legacy saves load cleanly.
 *
 * P9a introduces the *schema* + *content* layers only; the ProgressionSystem
 * (research unlocking, trait application, achievement evaluation, prestige
 * reset) lands in P9b. The ProgressionSystem stub at
 * `packages/simulation/src/systems/stubs.ts` stays a no-op until P9b.
 *
 * Layout mirrors `business.ts`: state schemas (what is persisted on
 * `GameState.progression`) live alongside content definition schemas (what
 * lives in `packages/content/src/progression/` as pure data — rule 5). The
 * content package's ResearchNodeDefinition / GeneticTraitDefinition /
 * AchievementDefinition objects conform to the definition schemas here, the
 * same way BusinessTypeDefinition objects conform to
 * `businessTypeDefinitionSchema`.
 *
 * All new state fields carry Zod `.default(...)` so a hand-constructed or
 * partially-migrated v12 state parses cleanly (the v11 → v12 migration
 * backfills them explicitly so consumers can rely on their presence without
 * re-running the zod default pipeline — matching the v3 → v4 / v5 → v6 / … /
 * v10 → v11 convention).
 *
 * Money-like fields (genetic-legacy points, prestige earned, research spent)
 * are bigint minor-units strings (TDD §10.1) — the prestige currency is
 * tracked with the same precision discipline as money, never floating point.
 */

// ---------------------------------------------------------------------------
// Enums shared by state + content definitions.
// ---------------------------------------------------------------------------

/**
 * Research category (GDD §11.1 Expansion — the research tree spans the
 * simulation's pillars: biology, automation, business, environment, energy).
 *
 * Used both as `ResearchNodeDefinition.category` (content) and as
 * `ResearchNodeState.categoryId` (the per-save unlock record mirrors its
 * definition's category so the UI can group unlocks without re-resolving the
 * definition).
 */
export const researchCategorySchema = z.enum([
  'biology',
  'automation',
  'business',
  'environment',
  'energy',
]);
export type ResearchCategory = z.infer<typeof researchCategorySchema>;

/**
 * Genetic trait family (GDD §11.2 — the seven genetic modifications). Used as
 * `GeneticTraitDefinition.category` so the UI can group traits by the
 * biological system they modify.
 */
export const geneticTraitCategorySchema = z.enum([
  'growth',
  'foliage',
  'roots',
  'trunk',
  'resistance',
  'photosynthesis',
]);
export type GeneticTraitCategory = z.infer<typeof geneticTraitCategorySchema>;

/**
 * Achievement objective category (GDD §12 — the six player objectives plus a
 * `milestone` bucket for incremental achievements like "first business" /
 * "first million"). Objectives are tracked independently and may overlap
 * (GDD §12 last paragraph).
 */
export const achievementObjectiveCategorySchema = z.enum([
  'wealth', // The Wealthiest Being
  'restoration', // The Great Restoration
  'destruction', // The Last Tree
  'balance', // The Natural Balance
  'industrial', // The Industrial Empire
  'generational', // The Generational Legacy
  'milestone', // incremental achievements (first-business, first-million, …)
]);
export type AchievementObjectiveCategory = z.infer<
  typeof achievementObjectiveCategorySchema
>;

/**
 * Outcome of a past generation (GDD §11.3 Prestige). A generation is
 * `ongoing` while the player is playing it; it becomes `completed` when the
 * player prestige-resets into the next generation, or `failed` if the lineage
 * died out (the original tree perished without establishing a successor).
 */
export const generationOutcomeSchema = z.enum(['ongoing', 'completed', 'failed']);
export type GenerationOutcome = z.infer<typeof generationOutcomeSchema>;

// ---------------------------------------------------------------------------
// State schemas (persisted on GameState.progression).
// ---------------------------------------------------------------------------

/**
 * Per-save research node unlock record (P9a — GDD §11.2 genetic legacy
 * unlocks research; the research tree is content-defined).
 *
 * One entry per research node that has been *considered* by the player
 * (whether unlocked or not yet). The ProgressionSystem (P9b) appends an entry
 * when a node first becomes available and flips `unlocked` to `true` when the
 * `unlock-research` action spends the genetic-legacy cost. `categoryId`
 * mirrors the definition's category so the UI can group unlocks without
 * re-resolving the definition; `prerequisites` + `cost` are copied from the
 * definition at record-creation time so the unlock decision is self-contained
 * on the save (determinism — TDD §18.3: the save fully describes the result).
 *
 * All fields have Zod `.default(...)` so v11 saves parse cleanly under v12
 * after the migration restructures the progression field.
 */
export const researchNodeStateSchema = z.object({
  /** Research node id (matches a ResearchNodeDefinition.id, e.g. `'research:improved-photosynthesis'`). */
  id: z.string().min(1),
  /** Category copied from the definition at record-creation time. */
  categoryId: researchCategorySchema,
  /** Whether the node has been unlocked (genetic-legacy cost paid). */
  unlocked: z.boolean().default(false),
  /** Simulation second at which the node was unlocked. 0 until unlocked. */
  unlockedAt: z.number().int().nonnegative().default(0),
  /** Research node ids that must be unlocked before this one (copied from the
   *  definition). */
  prerequisites: z.array(z.string().min(1)).default([]),
  /** Genetic-legacy point cost copied from the definition (bigint as string). */
  cost: z.string().default('0'),
});
export type ResearchNodeState = z.infer<typeof researchNodeStateSchema>;

/**
 * Per-save genetic trait expression record (P9a — GDD §11.2 genetic
 * modifications with trade-offs).
 *
 * One entry per genetic trait that has been acquired by the lineage. `active`
 * distinguishes a trait the player is currently expressing from one held in
 * reserve (GDD §11.2 — modifications have trade-offs, so the player toggles
 * them). `generation` records which generation acquired the trait (the
 * original tree's lineage is permanently identifiable — GDD §11.2 last
 * sentence; traits acquired in generation 1 belong to the original lineage).
 * `magnitude` (0–1) is how strongly the trait is expressed — the
 * ProgressionSystem (P9b) scales the trait's benefit + trade-off by it.
 *
 * All fields have Zod `.default(...)` so v11 saves parse cleanly under v12
 * after the migration restructures the progression field.
 */
export const geneticTraitStateSchema = z.object({
  /** Trait id (matches a GeneticTraitDefinition.id, e.g. `'trait:rapid-growth'`). */
  traitId: z.string().min(1),
  /** Whether the trait is currently being expressed (toggleable — GDD §11.2 trade-offs). */
  active: z.boolean().default(false),
  /** Generation in which the trait was acquired (1 = original lineage). */
  generation: z.number().int().nonnegative().default(1),
  /** How strongly the trait is expressed, 0 (dormant) to 1 (fully expressed). */
  magnitude: z.number().min(0).max(1).default(0),
});
export type GeneticTraitState = z.infer<typeof geneticTraitStateSchema>;

/**
 * Per-save achievement tracking record (P9a — GDD §12 player objectives,
 * tracked independently).
 *
 * One entry per achievement the ProgressionSystem (P9b) is tracking. `progress`
 * (0–1) is how far toward completion the achievement is; the ProgressionSystem
 * recomputes it on `PROVISIONAL_ACHIEVEMENT_CHECK_INTERVAL_TICKS` and flips
 * `unlocked` to `true` + stamps `unlockedAt` when `progress` reaches 1.
 *
 * All fields have Zod `.default(...)` so v11 saves parse cleanly under v12
 * after the migration restructures the progression field.
 */
export const achievementStateSchema = z.object({
  /** Achievement id (matches an AchievementDefinition.id). */
  id: z.string().min(1),
  /** Whether the achievement has been completed. */
  unlocked: z.boolean().default(false),
  /** Simulation second at which the achievement was completed. 0 until then. */
  unlockedAt: z.number().int().nonnegative().default(0),
  /** Progress toward completion, 0 (not started) to 1 (complete). */
  progress: z.number().min(0).max(1).default(0),
});
export type AchievementState = z.infer<typeof achievementStateSchema>;

/**
 * Prestige currency + generation counters (P9a — GDD §11.2 Genetic Legacy is a
 * prestige currency; §11.3 Prestige is generational progress, not a numerical
 * multiplier).
 *
 * `geneticLegacyPoints` is the prestige currency (bigint minor-units string —
 * TDD §10.1 precision discipline). It is earned by completing generations and
 * spent on `unlock-research` + `activate-trait`. `totalGenerations` is the
 * count of generations established (0 until the first prestige reset).
 * `currentGeneration` is the generation the player is currently playing
 * (starts at 1 — the original tree is generation 1). `prestigeMultiplier` is a
 * derived bonus applied to genetic-legacy earnings (NOT a wealth multiplier —
 * GDD §11.3 explicitly says prestige is generational progress, not a numerical
 * reset-for-multiplier). `historicalRecords` is the list of historical-event
 * ids recorded for this lineage (GDD §11.3 rewards: historical records; the
 * original tree remains permanently represented in the player's history).
 *
 * All fields have Zod `.default(...)` so v11 saves parse cleanly under v12
 * after the migration restructures the progression field.
 */
export const prestigeStateSchema = z.object({
  /** Prestige currency (bigint minor-units string). Earned per generation, spent on research + traits. */
  geneticLegacyPoints: z.string().default('0'),
  /** Total generations established (0 until the first prestige reset). */
  totalGenerations: z.number().int().nonnegative().default(0),
  /** Generation the player is currently playing (1 = the original tree). */
  currentGeneration: z.number().int().positive().default(1),
  /** Derived bonus applied to genetic-legacy earnings (NOT a wealth multiplier — GDD §11.3). */
  prestigeMultiplier: z.number().nonnegative().default(1.0),
  /** Ids of historical events recorded for this lineage (GDD §11.3 rewards). */
  historicalRecords: z.array(z.string().min(1)).default([]),
});
export type PrestigeState = z.infer<typeof prestigeStateSchema>;

/**
 * One entry in the per-generation history (P9a — GDD §11.3: the original tree
 * remains permanently represented in the player's history).
 *
 * The ProgressionSystem (P9b) appends an entry when a generation is
 * established via `prestige-reset` and finalises it (`endDate` + `outcome`)
 * when the next generation begins or the lineage dies. `treeSpeciesId` is the
 * species the player played in that generation (GDD §11.1 multiple species).
 * `prestigeEarned` is the genetic-legacy points that generation contributed
 * (bigint minor-units string).
 */
export const generationHistoryEntrySchema = z.object({
  /** Generation number (1 = the original tree). */
  generationNumber: z.number().int().positive(),
  /** Species played in that generation (GDD §11.1 — multiple species across generations). */
  treeSpeciesId: z.string().min(1),
  /** Simulation second at which the generation started. */
  startDate: z.number().int().nonnegative(),
  /** Simulation second at which the generation ended. `null` while `outcome === 'ongoing'`. */
  endDate: z.number().int().nonnegative().nullable(),
  /** How the generation concluded. */
  outcome: generationOutcomeSchema,
  /** Genetic-legacy points the generation contributed (bigint minor-units string). */
  prestigeEarned: z.string().default('0'),
});
export type GenerationHistoryEntry = z.infer<typeof generationHistoryEntrySchema>;

/**
 * Top-level ProgressionState (TDD §5.1 — `progression: ProgressionState` on
 * GameState; TDD §199 ProgressionSystem: research, genetics, achievements).
 *
 * Replaces the P0 stub shape `{ research: [{id, completedAt}], achievements:
 * [{id, completedAt}], geneticLegacy: number }`. The v11 → v12 migration
 * restructures a v11 save's progression field into this shape.
 *
 *   - `research`        : `{ nodes, totalSpent }` — the per-save research
 *     unlock records + the cumulative genetic-legacy points spent on research.
 *   - `genetics`        : `{ activeTraits, availableTraits, originalLineageId }`
 *     — expressed + reserve traits, the trait ids unlocked but not yet
 *     acquired, and the ORIGINAL TREE'S permanent genetic identity
 *     (`originalLineageId`). `originalLineageId` is set once at game start and
 *     NEVER changes across prestige resets — GDD §11.2 "the original tree's
 *     lineage should remain identifiable". It defaults to `'original'`
 *     (matching `originalTree.id`).
 *   - `achievements`    : `{ tracked }` — the per-save achievement records.
 *   - `prestige`        : the prestige currency + generation counters.
 *   - `generationHistory`: the per-generation history (GDD §11.3).
 *
 * Every nested field has Zod `.default(...)` so v11 saves parse cleanly under
 * v12 after the migration restructures the progression field, and so a
 * hand-constructed v12 state with a partial progression still validates.
 */
export const progressionStateSchema = z.object({
  research: z.object({
    /** Per-save research node records (one per node the player has encountered). */
    nodes: z.array(researchNodeStateSchema).default([]),
    /** Cumulative genetic-legacy points spent on research (bigint as string). */
    totalSpent: z.string().default('0'),
  }).default({ nodes: [], totalSpent: '0' }),
  genetics: z.object({
    /** Traits currently or previously expressed by the lineage. */
    activeTraits: z.array(geneticTraitStateSchema).default([]),
    /** Trait ids unlocked (via research) but not yet acquired by the lineage. */
    availableTraits: z.array(z.string().min(1)).default([]),
    /** The original tree's permanent genetic identity. Set once, never changes across prestige resets (GDD §11.2). */
    originalLineageId: z.string().min(1).default('original'),
  }).default({ activeTraits: [], availableTraits: [], originalLineageId: 'original' }),
  achievements: z.object({
    /** Per-save achievement tracking records. */
    tracked: z.array(achievementStateSchema).default([]),
  }).default({ tracked: [] }),
  prestige: prestigeStateSchema.default(() => ({
    geneticLegacyPoints: '0',
    totalGenerations: 0,
    currentGeneration: 1,
    prestigeMultiplier: 1.0,
    historicalRecords: [],
  })),
  /** Per-generation history (GDD §11.3 — original tree permanently in history). */
  generationHistory: z.array(generationHistoryEntrySchema).default([]),
});
export type ProgressionState = z.infer<typeof progressionStateSchema>;

// ---------------------------------------------------------------------------
// Content definition schemas (pure data in packages/content/src/progression/).
// ---------------------------------------------------------------------------
// Mirrors `businessTypeDefinitionSchema` in business.ts: the definition is
// content (rule 5), the state is what gets persisted. The ProgressionSystem
// (P9b) reads a definition to derive / validate a state record.

/**
 * Effects a research node grants when unlocked (P9a — GDD §11.2). Pure-data
 * description of what the unlock does; the ProgressionSystem (P9b) interprets
 * it. `description` is human-readable; `unlocks` lists content ids (equipment,
 * business types, trait ids) the node makes available; `multiplier` is an
 * optional numeric bonus the node applies (e.g. +0.1 to a growth rate).
 */
export const researchEffectsSchema = z.object({
  /** Human-readable summary of what the unlock does. */
  description: z.string(),
  /** Content ids unlocked (equipment / business types / trait ids). */
  unlocks: z.array(z.string().min(1)).default([]),
  /** Optional numeric bonus the node applies (e.g. +0.1 growth rate). */
  multiplier: z.number().optional(),
});
export type ResearchEffects = z.infer<typeof researchEffectsSchema>;

/**
 * Static research node definition — pure data (P9a — TDD §5.7 / §11, GDD §11.2
 * genetic legacy unlocks research).
 *
 * The ProgressionSystem (P9b) reads a definition to validate an
 * `unlock-research` action: the action's `researchNodeId` must resolve to a
 * definition, its `prerequisites` must all be unlocked, and the player must
 * have `cost` genetic-legacy points. `cost` is bigint genetic-legacy points as
 * string (TDD §10.1 precision discipline).
 *
 * PROVISIONAL per GDD §17 (research tree balance). Costs are genetic-legacy
 * points (the prestige currency), NOT minor currency units.
 */
export const researchNodeDefinitionSchema = z.object({
  /** Unique research node id, e.g. `'research:improved-photosynthesis'`. */
  id: z.string().min(1),
  /** Human-readable name for the research tree UI. */
  name: z.string().min(1),
  /** Short description for the UI / docs. */
  description: z.string(),
  /** Research category (GDD §11.1 pillars). */
  category: researchCategorySchema,
  /** Research node ids that must be unlocked first. */
  prerequisites: z.array(z.string().min(1)).default([]),
  /** Genetic-legacy point cost (bigint as string — the prestige currency). */
  cost: z.string().min(1),
  /** What the unlock grants (description + unlocks + optional multiplier). */
  effects: researchEffectsSchema,
});
export type ResearchNodeDefinition = z.infer<typeof researchNodeDefinitionSchema>;

/**
 * Static genetic trait definition — pure data (P9a — GDD §11.2 genetic
 * modifications with trade-offs; the seven traits).
 *
 * Each trait has a `benefit` and a `tradeOff` (GDD §11.2 table). The
 * ProgressionSystem (P9b) applies the benefit scaled by the trait state's
 * `magnitude` and applies the trade-off symmetrically. `availabilityRequirement`
 * is the research node id that unlocks the trait for acquisition (GDD §11.2:
 * genetic legacy unlocks genetic modifications).
 *
 * PROVISIONAL per GDD §17 (genetic modification balance).
 */
export const geneticTraitDefinitionSchema = z.object({
  /** Unique trait id, e.g. `'trait:rapid-growth'`. */
  id: z.string().min(1),
  /** Human-readable name. */
  name: z.string().min(1),
  /** Short description for the UI / docs. */
  description: z.string(),
  /** The benefit the trait grants (e.g. `'+20% growth rate'`). Human-readable. */
  benefit: z.string(),
  /** The trade-off the trait imposes (e.g. `'+30% water demand'`). Human-readable. */
  tradeOff: z.string(),
  /** Trait family (GDD §11.2 — the seven modifications). */
  category: geneticTraitCategorySchema,
  /** Research node id that unlocks the trait for acquisition (GDD §11.2). */
  availabilityRequirement: z.string().min(1),
});
export type GeneticTraitDefinition = z.infer<typeof geneticTraitDefinitionSchema>;

/**
 * Static achievement definition — pure data (P9a — GDD §12 player objectives).
 *
 * `completionCriteria` is a human-readable description of what satisfies the
 * achievement (the ProgressionSystem evaluates it in P9b against live state).
 * Keeping it descriptive here keeps the content pure-data (rule 5) — the
 * evaluation logic lives in the system, not in the content.
 *
 * PROVISIONAL per GDD §17 (achievement thresholds).
 */
export const achievementDefinitionSchema = z.object({
  /** Unique achievement id, e.g. `'achievement:wealthiest-being'`. */
  id: z.string().min(1),
  /** Human-readable name. */
  name: z.string().min(1),
  /** Short description for the UI / docs. */
  description: z.string(),
  /** Objective category (GDD §12 — the six objectives + milestone bucket). */
  objectiveCategory: achievementObjectiveCategorySchema,
  /** Descriptive completion criteria (the ProgressionSystem evaluates in P9b). */
  completionCriteria: z.string(),
});
export type AchievementDefinition = z.infer<typeof achievementDefinitionSchema>;
