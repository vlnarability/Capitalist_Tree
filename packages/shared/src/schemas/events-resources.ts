import { z } from 'zod';
import { fertilizerApplicationResultSchema, waterApplicationResultSchema } from './fertilizer.js';
import { weatherConditionSchema } from './weather.js';

/**
 * Resource + Weather related SimulationEvent variants (P2 — TDD §8, §9).
 *
 * Added to the `SimulationEvent` discriminated union via
 * `packages/shared/src/schemas/events.ts`. P2 introduces:
 *
 *   - `weather-changed` (already in P0's union as a stub — P2 populates it
 *     with real weather transition data: prev + new condition + intensity).
 *     Note: the P0 stub schema accepted only `{ from, to }`. P2 keeps that
 *     minimal shape for backwards-compat and adds the richer payload to the
 *     new `weather-state` event. Consumers wanting full weather data read
 *     `state.world.weather` directly.
 *   - `weather-damage`: emitted by WeatherSystem when a damage-capable
 *     condition (severe storm, frost, heat wave, wind, drought) exceeds its
 *     intensity threshold. P1 (or a future refactor) consumes this and
 *     records the appropriate damage entry on `tree.damage[]`. See R-P2-2.
 *   - `water-applied`: emitted by the `apply-water` action handler.
 *     Carries the full WaterApplicationResult for audit + UI feedback.
 *   - `fertilizer-applied`: emitted by the `apply-fertilizer` action handler.
 *     Carries the full FertilizerApplicationResult for audit + UI feedback,
 *     including the contamination increase for over-application.
 *   - `resource-notification`: soft notification channel for resource
 *     events the UI may surface (low soil water, drought stress, leaching
 *     detected, soil health declining). Severity follows the existing
 *     `notification` event convention.
 *
 * HOW TO EXTEND: add a new variant with a unique `type` literal. Do NOT
 * loosen the union with a catch-all.
 */

/**
 * `weather-damage` event (TDD §9.3, GDD §4.3).
 *
 * Emitted by WeatherSystem when a damage-capable condition exceeds its
 * intensity threshold (PROVISIONAL_WEATHER_DAMAGE_INTENSITY_THRESHOLD).
 * Carries enough information for P1 (or a future biology refactor) to
 * record the appropriate `tree.damage[]` entry.
 *
 * P2 does NOT modify `tree.damage[]` directly — biology is the only writer
 * to TreeState biology fields (rule: rendering reads, never writes; biology
 * is internally consistent; GDD §5.1). The weather-damage event is the
 * hand-off: WeatherSystem produces the conditions, the consumer (P1
 * BiologySystem in a future revision) records the damage entry. See R-P2-2
 * in docs/resources-weather.md.
 */
export const weatherDamageEventSchema = z.object({
  type: z.literal('weather-damage'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    /** Condition that caused the damage. */
    condition: weatherConditionSchema,
    /** Intensity in [0, 1] — how strong the condition is this step. */
    intensity: z.number().min(0).max(1),
    /** Damage category — what kind of damage this is. */
    damageType: z.enum(['storm', 'frost', 'heat', 'wind', 'drought']),
    /**
     * Severity in [0, 1] — derived from intensity *
     * PROVISIONAL_WEATHER_DAMAGE_SEVERITY_SCALE. P1 (or future refactor)
     * records this as the damage entry's `severity` on `tree.damage[]`.
     */
    severity: z.number().min(0).max(1),
    /**
     * Trees affected. P2 always includes the original tree; future phases
     * may include additional trees in the player's grove. Each affected
     * tree should have a damage entry recorded by the consumer.
     */
    treeIds: z.array(z.string().min(1)).min(1),
  }),
});
export type WeatherDamageEvent = z.infer<typeof weatherDamageEventSchema>;

/**
 * `water-applied` event — emitted by the `apply-water` action handler.
 */
export const waterAppliedEventSchema = z.object({
  type: z.literal('water-applied'),
  at: z.number().int().nonnegative(),
  payload: waterApplicationResultSchema,
});
export type WaterAppliedEvent = z.infer<typeof waterAppliedEventSchema>;

/**
 * `fertilizer-applied` event — emitted by the `apply-fertilizer` action
 * handler. Carries the full FertilizerApplicationResult including the
 * contamination increase for over-application (GDD §8.3).
 */
export const fertilizerAppliedEventSchema = z.object({
  type: z.literal('fertilizer-applied'),
  at: z.number().int().nonnegative(),
  payload: fertilizerApplicationResultSchema,
});
export type FertilizerAppliedEvent = z.infer<typeof fertilizerAppliedEventSchema>;

/**
 * `resource-notification` event — soft notification channel for resource
 * state changes the UI may surface (low soil water, drought, leaching,
 * declining soil health). Severity follows the existing `notification`
 * event convention.
 */
export const resourceNotificationEventSchema = z.object({
  type: z.literal('resource-notification'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    /** Short machine code, e.g. 'low-soil-water', 'drought-stress'. */
    code: z.string().min(1),
    /** Severity for UI prioritization. */
    severity: z.enum(['info', 'warning', 'critical']),
    /** Human-readable message for the UI. */
    message: z.string().min(1),
    /** Numeric context value (e.g., current soil water fraction) — optional. */
    value: z.number().optional(),
  }),
});
export type ResourceNotificationEvent = z.infer<typeof resourceNotificationEventSchema>;
