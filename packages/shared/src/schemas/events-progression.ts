import { z } from 'zod';
import { achievementObjectiveCategorySchema } from './progression.js';

/**
 * Progression-related SimulationEvent variants (P9a — TDD §5.7 / §11, GDD §11
 * Progression and Generations, §12 Player Objectives).
 *
 * Added to the `SimulationEvent` discriminated union via
 * `packages/shared/src/schemas/events.ts`. P9a introduces the *schema*
 * layer only; the ProgressionSystem that emits these events lands in P9b.
 *
 * These events are the engine's *output* channel for progression activity:
 * they tell the UI / audit layer what the ProgressionSystem and the
 * progression action handlers decided (research unlocked, traits toggled,
 * generation established, achievement completed, historical event recorded)
 * without handing the rendering layer the authority to run actions
 * (rendering reads only — rule 8).
 *
 *   - `research-unlocked`: the `unlock-research` action succeeded — genetic-
 *     legacy points were spent and a research node is now unlocked.
 *   - `trait-activated`: a genetic trait was toggled on (expressed).
 *   - `trait-deactivated`: a genetic trait was toggled off.
 *   - `generation-established`: a `prestige-reset` established a new
 *     generation (GDD §11.3 — prestige is generational progress). Carries the
 *     new generation number, the genetic-legacy points earned, and the new
 *     species.
 *   - `achievement-unlocked`: an achievement's `progress` reached 1 and the
 *     ProgressionSystem flipped it to unlocked.
 *   - `historical-event-recorded`: a historical event id was recorded against
 *     the lineage (GDD §11.3 rewards: historical records).
 *
 * Genetic-legacy point amounts use bigint minor-units strings (TDD §10.1).
 *
 * HOW TO EXTEND: add a new variant with a unique `type` literal. Do NOT
 * loosen the union with a catch-all.
 */

/**
 * `research-unlocked` event — the `unlock-research` action succeeded (GDD
 * §11.2 — genetic legacy unlocks research).
 *
 * Emitted by the `unlock-research` action handler (P9b) after it debited
 * `cost` genetic-legacy points from `prestige.geneticLegacyPoints`, added them
 * to `research.totalSpent`, and flipped the node's `ResearchNodeState` to
 * `unlocked: true` / `unlockedAt: at`. Carries the node id, the cost spent
 * (bigint string), and the resulting genetic-legacy balance.
 */
export const researchUnlockedEventSchema = z.object({
  type: z.literal('research-unlocked'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    /** Research node id that was unlocked. */
    researchNodeId: z.string().min(1),
    /** Genetic-legacy points spent (bigint as string). */
    cost: z.string(),
    /** Genetic-legacy balance after the spend (bigint as string). */
    geneticLegacyPointsAfter: z.string(),
  }),
});
export type ResearchUnlockedEvent = z.infer<typeof researchUnlockedEventSchema>;

/**
 * `trait-activated` event — a genetic trait was toggled on (GDD §11.2 —
 * modifications have trade-offs; the player expresses them selectively).
 *
 * Emitted by the `activate-trait` action handler (P9b). Carries the trait id,
 * the magnitude it was set to (clamped to [0, 1]), and the generation in
 * which the trait was originally acquired (so the UI can show whether the
 * active trait belongs to the original lineage or a later generation).
 */
export const traitActivatedEventSchema = z.object({
  type: z.literal('trait-activated'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    /** Trait id that was activated. */
    traitId: z.string().min(1),
    /** Magnitude the trait is now expressed at (0–1). */
    magnitude: z.number().min(0).max(1),
    /** Generation in which the trait was originally acquired (1 = original lineage). */
    generation: z.number().int().positive(),
  }),
});
export type TraitActivatedEvent = z.infer<typeof traitActivatedEventSchema>;

/**
 * `trait-deactivated` event — a genetic trait was toggled off (GDD §11.2).
 *
 * Emitted by the `deactivate-trait` action handler (P9b). The trait remains
 * acquired by the lineage (genetic material preserved); only its expression
 * is suspended. Carries the trait id.
 */
export const traitDeactivatedEventSchema = z.object({
  type: z.literal('trait-deactivated'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    /** Trait id that was deactivated. */
    traitId: z.string().min(1),
  }),
});
export type TraitDeactivatedEvent = z.infer<typeof traitDeactivatedEventSchema>;

/**
 * `generation-established` event — a `prestige-reset` established a new
 * generation (GDD §11.3 — prestige is generational progress, NOT a numerical
 * reset-for-multiplier).
 *
 * Emitted by the `prestige-reset` action handler (P9b) after it credited the
 * earned genetic-legacy points, finalised the prior generation's history
 * entry, appended the new generation's history entry, incremented the
 * generation counters, and replanted the original tree as a sapling of the
 * new species. Carries the new generation number, the previous generation
 * number, the points earned this generation, the resulting prestige
 * multiplier, and the new species id.
 */
export const generationEstablishedEventSchema = z.object({
  type: z.literal('generation-established'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    /** Generation the player is now playing (previous + 1). */
    generationNumber: z.number().int().positive(),
    /** Generation that just concluded. */
    previousGeneration: z.number().int().positive(),
    /** Genetic-legacy points earned for the concluded generation (bigint as string). */
    geneticLegacyPointsEarned: z.string(),
    /** Genetic-legacy balance after the credit (bigint as string). */
    geneticLegacyPointsAfter: z.string(),
    /** Prestige multiplier in effect for the new generation. */
    prestigeMultiplierAfter: z.number(),
    /** Species the player will play in the new generation (GDD §11.1 / §11.3). */
    newTreeSpeciesId: z.string().min(1),
  }),
});
export type GenerationEstablishedEvent = z.infer<typeof generationEstablishedEventSchema>;

/**
 * `achievement-unlocked` event — an achievement's `progress` reached 1 and the
 * ProgressionSystem flipped it to unlocked (GDD §12 — objectives tracked
 * independently).
 *
 * Emitted by the ProgressionSystem (P9b) on the
 * `PROVISIONAL_ACHIEVEMENT_CHECK_INTERVAL_TICKS` cadence when an
 * achievement crosses the completion threshold. Carries the achievement id and
 * its objective category so the UI can group the unlock by GDD §12 objective.
 */
export const achievementUnlockedEventSchema = z.object({
  type: z.literal('achievement-unlocked'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    /** Achievement id that was unlocked. */
    achievementId: z.string().min(1),
    /** Objective category (GDD §12 — the six objectives + milestone). */
    objectiveCategory: achievementObjectiveCategorySchema,
  }),
});
export type AchievementUnlockedEvent = z.infer<typeof achievementUnlockedEventSchema>;

/**
 * `historical-event-recorded` event — a historical event id was recorded
 * against the lineage (GDD §11.3 rewards: historical records; the original
 * tree remains permanently represented in the player's history).
 *
 * Emitted by the `record-historical-event` action handler (P9b) and by the
 * ProgressionSystem for system-driven historical events. Carries the event id
 * + title for the UI / audit log. The persisted record on
 * `prestige.historicalRecords` is just the id (canonical lookup is by id).
 */
export const historicalEventRecordedEventSchema = z.object({
  type: z.literal('historical-event-recorded'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    /** Historical event id recorded against the lineage. */
    eventId: z.string().min(1),
    /** Human-readable title (rides along for the UI / audit log). */
    title: z.string().min(1),
    /** Total number of historical events recorded for the lineage after this one. */
    recordsAfter: z.number().int().nonnegative(),
  }),
});
export type HistoricalEventRecordedEvent = z.infer<typeof historicalEventRecordedEventSchema>;
