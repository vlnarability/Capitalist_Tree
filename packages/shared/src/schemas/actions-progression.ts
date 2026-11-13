import { z } from 'zod';

/**
 * Progression-related GameAction variants (P9a — TDD §5.7 / §11, GDD §11
 * Progression and Generations, §12 Player Objectives).
 *
 * Added to the `GameAction` discriminated union via
 * `packages/shared/src/schemas/actions.ts`. P9a introduces the *schema*
 * layer only; the action handlers + ProgressionSystem land in P9b. The
 * variants:
 *
 *   - `unlock-research`: spend genetic-legacy points (the prestige currency)
 *     to unlock a research node (GDD §11.2 — genetic legacy unlocks research).
 *   - `activate-trait`: activate (express) a genetic trait the lineage has
 *     acquired (GDD §11.2 — modifications have trade-offs, so the player
 *     toggles them on).
 *   - `deactivate-trait`: deactivate a trait (toggle it off to drop its
 *     trade-off, at the cost of its benefit).
 *   - `prestige-reset`: establish a new generation (GDD §11.3 — prestige is
 *     generational progress, NOT a numerical reset-for-multiplier). Resets
 *     most play state but PRESERVES the genetic legacy (points + acquired
 *     traits), the generation history, and the original tree's permanent
 *     lineage identity (GDD §11.2 — original tree's lineage remains
 *     identifiable).
 *   - `record-historical-event`: record a historical event id against the
 *     lineage (GDD §11.3 rewards: historical records).
 *
 * Genetic-legacy point amounts use bigint minor-units strings (TDD §10.1) —
 * the prestige currency is tracked with the same precision discipline as
 * money, never floating point.
 *
 * HOW TO EXTEND: add a new variant with a unique `type` literal. Register a
 * handler in `packages/simulation/src/actions/handlers.ts`. Keep actions pure
 * — never mutate input state. Reject unknown action types with
 * `UnknownActionError` (handled centrally by `executeAction`).
 *
 * Re-exported from `packages/shared/src/schemas/actions.ts` so consumers can
 * `import { UnlockResearchAction } from '@capitalist-tree/shared'`.
 */

/**
 * `unlock-research` action — spend genetic-legacy points to unlock a research
 * node (GDD §11.2 — genetic legacy unlocks research).
 *
 * The handler (P9b):
 *   1. Resolves the research node by `researchNodeId` via `getResearchNodeById`
 *      (content gate — unknown id raises `UnknownResearchNodeError`).
 *   2. Verifies every `definition.prerequisites` research node id is already
 *      unlocked on `state.progression.research.nodes` (rejects with
 *      `ResearchPrerequisitesNotMetError` if any are locked).
 *   3. Verifies the player has at least `definition.cost` genetic-legacy
 *      points in `state.progression.prestige.geneticLegacyPoints` (rejects
 *      with `InsufficientGeneticLegacyError` if not).
 *   4. Debits `definition.cost` from `geneticLegacyPoints` (bigint string
 *      arithmetic), adds it to `research.totalSpent`, and upserts the node's
 *      `ResearchNodeState` record (`unlocked: true`, `unlockedAt: tick`).
 *   5. Emits a `research-unlocked` event carrying the node id, the cost spent,
 *      and the resulting genetic-legacy balance.
 *
 * `tick` is the simulation second at which the unlock runs — explicit so the
 * action payload fully describes the result (determinism — TDD §18.3).
 */
export const unlockResearchActionSchema = z.object({
  type: z.literal('unlock-research'),
  payload: z.object({
    /** Research node id (must be registered in `packages/content/src/progression/research/`). */
    researchNodeId: z.string().min(1),
    /** Simulation second at which the unlock runs (deterministic event `at` + state stamp). */
    tick: z.number().int().nonnegative(),
  }),
});
export type UnlockResearchAction = z.infer<typeof unlockResearchActionSchema>;

/**
 * `activate-trait` action — activate (express) a genetic trait the lineage has
 * acquired (GDD §11.2 — modifications have trade-offs; the player toggles
 * which are expressed).
 *
 * The handler (P9b):
 *   1. Verifies the trait is acquired — either present in
 *      `state.progression.genetics.activeTraits` (toggle back on) or in
 *      `availableTraits` (newly expressed, moved into `activeTraits`). Rejects
 *      with `TraitNotAcquiredError` if the trait is neither acquired nor
 *      available.
 *   2. Sets the trait state's `active: true` and `magnitude` to the requested
 *      value (clamped to [0, 1], defaulting to
 *      `PROVISIONAL_TRAIT_MAGNITUDE_DEFAULT` when omitted).
 *   3. Emits a `trait-activated` event carrying the trait id, the magnitude,
 *      and the generation.
 *
 * `magnitude` is optional — the handler defaults it to
 * `PROVISIONAL_TRAIT_MAGNITUDE_DEFAULT` when omitted (determinism — TDD §18.3:
 * the schema requires the caller to be explicit only when overriding the
 * default).
 */
export const activateTraitActionSchema = z.object({
  type: z.literal('activate-trait'),
  payload: z.object({
    /** Trait id (must be a known GeneticTraitDefinition.id). */
    traitId: z.string().min(1),
    /** How strongly to express the trait, 0–1. Defaults to PROVISIONAL_TRAIT_MAGNITUDE_DEFAULT. */
    magnitude: z.number().min(0).max(1).optional(),
  }),
});
export type ActivateTraitAction = z.infer<typeof activateTraitActionSchema>;

/**
 * `deactivate-trait` action — deactivate a genetic trait (toggle it off,
 * dropping its trade-off at the cost of its benefit).
 *
 * The handler (P9b) sets the trait state's `active: false` (the trait remains
 * acquired — it stays in `activeTraits` with `active: false`, so the lineage
 * retains the genetic material and can re-express it later; GDD §11.2 —
 * genetic material is preserved across the lineage). Emits a
 * `trait-deactivated` event carrying the trait id.
 */
export const deactivateTraitActionSchema = z.object({
  type: z.literal('deactivate-trait'),
  payload: z.object({
    /** Trait id (must be an acquired GeneticTraitDefinition.id). */
    traitId: z.string().min(1),
  }),
});
export type DeactivateTraitAction = z.infer<typeof deactivateTraitActionSchema>;

/**
 * `prestige-reset` action — establish a new generation (GDD §11.3 — prestige
 * is generational progress, NOT a numerical reset-for-multiplier).
 *
 * The handler (P9b):
 *   1. Verifies the minimum generation duration has elapsed
 *      (`PROVISIONAL_PRESTIGE_GENERATION_MIN_DURATION_DAYS` sim days since the
 *      current generation started — rejects with
 *      `GenerationTooEarlyError` if not).
 *   2. Computes the genetic-legacy points earned this generation:
 *      `PROVISIONAL_PRESTIGE_BASE_LEGACY_POINTS_PER_GENERATION +
 *      activeTraits.length * PROVISIONAL_PRESTIGE_LEGACY_MULTIPLIER_PER_TRAIT`,
 *      scaled by `prestigeMultiplier`. Credits the result to
 *      `prestige.geneticLegacyPoints`.
 *   3. Finalises the current `generationHistory` entry (`endDate: tick`,
 *      `outcome: 'completed'`, `prestigeEarned: <earned>`).
 *   4. Appends a new `generationHistory` entry (`generationNumber:
 *      currentGeneration + 1`, `treeSpeciesId: newTreeSpeciesId`,
 *      `startDate: tick`, `endDate: null`, `outcome: 'ongoing'`).
 *   5. Increments `prestige.totalGenerations` + `prestige.currentGeneration`.
 *   6. PRESERVES across the reset (GDD §11.2 / §11.3): `geneticLegacyPoints`,
 *      the acquired `activeTraits` (genetic material), `originalLineageId`
 *      (the original tree's permanent lineage identity — NEVER reset), and the
 *      full `generationHistory`. A fraction
 *      (`PROVISIONAL_PRESTIGE_PRESERVED_RESOURCES`) of unlocked research is
 *      also preserved; the rest is reset.
 *   7. Resets the rest of the play state (the original tree is replanted as a
 *      sapling of `newTreeSpeciesId`, businesses / automation / inventory are
 *      cleared, economy is re-seeded, etc.). The original tree's `id` stays
 *      `'original'` and `isOriginal` stays `true` (GDD §16.1/16.2).
 *   8. Emits a `generation-established` event carrying the new generation
 *      number, the points earned, and the new species.
 *
 * `newTreeSpeciesId` is the species the player will play in the next
 * generation (GDD §11.1 — multiple species across generations; §11.3 reward:
 * new species). Must be a registered species id.
 */
export const prestigeResetActionSchema = z.object({
  type: z.literal('prestige-reset'),
  payload: z.object({
    /** Species to play in the new generation (GDD §11.1 / §11.3 — new species reward). */
    newTreeSpeciesId: z.string().min(1),
    /** Simulation second at which the reset runs (deterministic event `at` + history stamp). */
    tick: z.number().int().nonnegative(),
  }),
});
export type PrestigeResetAction = z.infer<typeof prestigeResetActionSchema>;

/**
 * `record-historical-event` action — record a historical event id against the
 * lineage (GDD §11.3 rewards: historical records; the original tree remains
 * permanently represented in the player's history).
 *
 * The handler (P9b) appends `eventId` to `state.progression.prestige.
 * historicalRecords` (idempotent — a duplicate `eventId` is a no-op, mirroring
 * P6b2's enable/disable-automation idempotency) and emits a
 * `historical-event-recorded` event. The descriptive `title` /
 * `description` ride along on the event for the UI / audit log; the persisted
 * record is just the id (the canonical content lookup is by id).
 *
 * `eventId` is a content-defined or action-supplied id (e.g.
 * `'history:first-leaf-sold'`, `'history:original-tree-matured'`). The
 * ProgressionSystem (P9b) is the canonical emitter of system-driven
 * historical events; this action lets the engine / scheduler record
 * action-driven ones.
 */
export const recordHistoricalEventActionSchema = z.object({
  type: z.literal('record-historical-event'),
  payload: z.object({
    /** Historical event id (recorded against the lineage). */
    eventId: z.string().min(1),
    /** Human-readable title for the UI / audit log. */
    title: z.string().min(1),
    /** Human-readable description for the UI / audit log. */
    description: z.string(),
    /** Simulation second at which the event is recorded (deterministic event `at`). */
    tick: z.number().int().nonnegative(),
  }),
});
export type RecordHistoricalEventAction = z.infer<typeof recordHistoricalEventActionSchema>;
