import { z } from 'zod';
import { harvestResultSchema } from './harvest.js';

/**
 * Biology-related SimulationEvent variants (P1).
 *
 * Added to the `SimulationEvent` discriminated union via
 * `packages/shared/src/schemas/events.ts`. P1 introduces:
 *
 *   - `harvest-completed`: emitted by the `harvest-leaves` action handler
 *     carrying the full `HarvestResult`. P3's EconomySystem listens for these
 *     and reads `payload.result.currencyIssuance` to fulfil currency issuance.
 *   - `tree-died`: emitted by BiologySystem when the original tree dies. P4's
 *     renderer reads this to swap the live-tree visual for a stump (GDD §5.6).
 *   - `defoliation`: emitted when a harvest removes ≥ 50% of foliage in one
 *     action. Useful for UI notifications ("Severe defoliation event").
 *   - `biology-notification`: a soft notification channel for biology events
 *     that the UI may surface (low reserves, drought stress, etc.). Severity
 *     follows the existing `notification` event convention.
 *
 * HOW TO EXTEND: add a new variant with a unique `type` literal. Do NOT loosen
 * the union with a catch-all.
 */
export const harvestCompletedEventSchema = z.object({
  type: z.literal('harvest-completed'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    /** The tree that was harvested. */
    treeId: z.string().min(1),
    /** Full harvest result — P3 reads `result.currencyIssuance` to issue currency. */
    result: harvestResultSchema,
  }),
});
export type HarvestCompletedEvent = z.infer<typeof harvestCompletedEventSchema>;

export const treeDiedEventSchema = z.object({
  type: z.literal('tree-died'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    treeId: z.string().min(1),
    /** Short cause code: 'reserves-exhausted' | 'stress' | 'defoliation' | 'structural' | 'unknown'. */
    cause: z.string().min(1),
    /** Free-form diagnostic for the event log. */
    detail: z.string().optional(),
  }),
});
export type TreeDiedEvent = z.infer<typeof treeDiedEventSchema>;

export const defoliationEventSchema = z.object({
  type: z.literal('defoliation'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    treeId: z.string().min(1),
    /** Fraction of pre-harvest foliage removed, in [0, 1]. */
    fractionRemoved: z.number().min(0).max(1),
    /** True if this is the second or later severe defoliation within the
     *  `PROVISIONAL_DEATH_DEFOLIATION_WINDOW_DAYS` window. */
    repeated: z.boolean(),
  }),
});
export type DefoliationEvent = z.infer<typeof defoliationEventSchema>;

export const biologyNotificationEventSchema = z.object({
  type: z.literal('biology-notification'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    treeId: z.string().min(1),
    severity: z.enum(['info', 'warning', 'critical']),
    /** Short machine code, e.g. 'reserves-low', 'drought-stress'. */
    code: z.string().min(1),
    /** Human-readable message for the UI. */
    message: z.string().min(1),
  }),
});
export type BiologyNotificationEvent = z.infer<typeof biologyNotificationEventSchema>;

/**
 * P12-B (GAP-18): a pest or disease infestation took hold on the tree.
 *
 * Emitted by the BiologySystem when `rollInfestation` appends a `pest` or
 * `disease` damage record. The damage record itself drives the stress/
 * mortality path (via `tree.damage.length`); this event is the hand-off for
 * the UI (NotificationsPanel) + the event log.
 */
export const infestationEventSchema = z.object({
  type: z.literal('infestation'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    treeId: z.string().min(1),
    /** Whether this is a pest or a disease infestation. */
    kind: z.enum(['pest', 'disease']),
    /** Severity in [0, 1] — uniform in [MIN, MAX] (see biology constants). */
    severity: z.number().min(0).max(1),
  }),
});
export type InfestationEvent = z.infer<typeof infestationEventSchema>;

/**
 * `seed-dispersed` event (GAP-19 / GDD §11.2 — reproduction / seeding).
 *
 * Emitted by the BiologySystem when the tree's `seedGrowthProgress` accumulator
 * (fed by `alloc.reproduction`) reaches 1.0 AND the tree is past its fruiting
 * age (`ageDays >= species.matureAgeDays ×
 * PROVISIONAL_BIOLOGY_REPRODUCTION_FRUITING_AGE_FRACTION`). Carries the seed
 * yield this event, the tree's total seed count after, + the reset accumulator
 * value (0). A future `plant-seed` action (GDD §11.2 Genetic Legacy) will
 * consume the accumulated `tree.seeds` to establish offspring trees.
 */
export const seedDispersedEventSchema = z.object({
  type: z.literal('seed-dispersed'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    /** The tree that produced + dispersed the seeds. */
    treeId: z.string().min(1),
    /** Seeds produced by THIS dispersal event (= SEED_YIELD). */
    seedsProduced: z.number().int().positive(),
    /** The tree's total seed count after this event (monotonic). */
    seedsTotal: z.number().int().nonnegative(),
    /** `seedGrowthProgress` after the reset (0 — the accumulator emptied). */
    seedGrowthProgressAfter: z.number().min(0).max(1),
  }),
});
export type SeedDispersedEvent = z.infer<typeof seedDispersedEventSchema>;

/**
 * `seed-planted` event (GAP-19 / GDD §11.2 — Genetic Legacy: the seed production
 * → planting loop).
 *
 * Emitted by the `plant-seed` action handler when the player plants a seed: the
 * tree's `seeds` count is decremented by 1 + `PROVISIONAL_PROGRESSION_LEGACY_
 * POINTS_PER_SEED` genetic-legacy points are credited to
 * `prestige.geneticLegacyPoints`. Carries the seeds consumed (always 1), the
 * tree's remaining seed count, the points gained, + the resulting genetic-legacy
 * balance (bigint minor-units string — TDD §10.1, same precision discipline as
 * `research-unlocked` / `generation-established`).
 */
export const seedPlantedEventSchema = z.object({
  type: z.literal('seed-planted'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    /** The tree that planted the seed (consumed it from its `seeds` accumulator). */
    treeId: z.string().min(1),
    /** Seeds consumed by THIS planting (always 1 — one seed per action). */
    seedsConsumed: z.number().int().positive(),
    /** The tree's remaining seed count after this action. */
    seedsRemaining: z.number().int().nonnegative(),
    /** Genetic-legacy points gained this action (the per-seed reward). */
    legacyPointsGained: z.number().int().nonnegative(),
    /** The prestige balance after the credit (bigint minor-units string). */
    geneticLegacyPointsAfter: z.string(),
  }),
});
export type SeedPlantedEvent = z.infer<typeof seedPlantedEventSchema>;
