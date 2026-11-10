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
