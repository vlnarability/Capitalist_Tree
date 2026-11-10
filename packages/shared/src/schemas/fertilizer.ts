import { z } from 'zod';
import { nutrientStateSchema } from './tree.js';

/**
 * Fertilizer composition (TDD §8.2, GDD §10.1).
 *
 * Pure data — lives in `packages/content/src/fertilizers/`. Each fertilizer
 * product specifies its N-P-K composition (and future micro-nutrients,
 * growth-promoters, etc.). The `apply-fertilizer` action handler reads the
 * fertilizer by id and applies its composition to the soil nutrient pool.
 *
 * Adding a new fertilizer means appending to `ALL_FERTILIZERS` in
 * `packages/content/src/fertilizers/index.ts` — the engine code stays fixed
 * (rule 5: content is data).
 *
 * Units: N/P/K are in the same arbitrary "units" used by `NutrientState` —
 * matching the species' `nutrientRequirement` so the BiologySystem's Liebig
 * math scales correctly.
 *
 * PROVISIONAL per GDD §17 ("detailed resource simulation equations").
 */

/**
 * Fertilizer NPK composition + application metadata.
 *
 * `npk` is the amount added to the soil nutrient pool per unit of fertilizer
 * applied (1 unit = 1 "application"). `slowReleaseFraction` controls how
 * much of the dose is immediately bioavailable vs. released over time (P2
 * treats all as immediately available — slow-release is an extension point,
 * value 1.0 = all immediate).
 *
 * `contaminationPerUnit` is the contamination added per application when the
 * soil is at capacity (over-application harm, GDD §8.3). Linear scaling below
 * capacity: at half capacity, half the contamination; at zero capacity,
 * zero extra contamination.
 */
export const fertilizerCompositionSchema = z.object({
  /** NPK composition (units added to soil per application). */
  npk: nutrientStateSchema,
  /**
   * Fraction of the dose immediately available to the tree (vs. slow-release).
   * 1.0 = all immediate. PROVISIONAL — slow-release is a future extension
   * point (TDD §8.2 "Additional nutrients can be added later").
   */
  slowReleaseFraction: z.number().min(0).max(1).default(1.0),
  /**
   * Contamination added per application when soil is at nutrient capacity.
   * Below capacity the contamination scales down linearly (over-application
   * harm, GDD §8.3). Captures the rule that "excessive or inappropriate
   * application can damage soil or contaminate surrounding environments".
   */
  contaminationPerUnit: z.number().nonnegative(),
  /**
   * Organic matter added per application. Composts add organic matter;
   * synthetic fertilizers do not. Improves long-term soil health derivation.
   */
  organicMatterPerUnit: z.number().nonnegative().default(0),
});
export type FertilizerComposition = z.infer<typeof fertilizerCompositionSchema>;

/**
 * A fertilizer product definition (TDD §8.2).
 */
export const fertilizerSchema = z.object({
  /** Unique fertilizer id. Convention: `fertilizer:<slug>`. */
  id: z.string().min(1),
  /** Human-readable name. */
  name: z.string().min(1),
  /** Composition + application metadata. */
  composition: fertilizerCompositionSchema,
  /**
   * Cost per unit (bigint minor currency units, serialized as string per
   * TDD §10.1). PROVISIONAL — P3 will wire the actual purchase action; P2
   * leaves this as a data field so the content registry exposes it for
   * future market pricing.
   */
  costMinor: z.string().optional(),
});
export type Fertilizer = z.infer<typeof fertilizerSchema>;

/**
 * Result of applying fertilizer — for the `fertilizer-applied` event payload
 * and the `apply-fertilizer` action handler's return value.
 *
 * Pure data: the `applyFertilizer` pure function returns this; the action
 * handler applies the deltas to the soil state and emits the event.
 */
export const fertilizerApplicationResultSchema = z.object({
  /** Fertilizer id applied. */
  fertilizerId: z.string().min(1),
  /** Units applied (>= 1). */
  units: z.number().int().positive(),
  /** Soil nutrients BEFORE application. */
  nutrientsBefore: nutrientStateSchema,
  /** Soil nutrients AFTER application (capped at soil nutrient capacity). */
  nutrientsAfter: nutrientStateSchema,
  /** Nutrients actually added (after capacity cap). */
  nutrientsAdded: nutrientStateSchema,
  /** Nutrients lost to over-capacity overflow (becomes contamination). */
  nutrientsOverflowed: nutrientStateSchema,
  /** Contamination BEFORE application. */
  contaminationBefore: z.number().nonnegative(),
  /** Contamination AFTER application. */
  contaminationAfter: z.number().nonnegative(),
  /** Organic matter added. */
  organicMatterAdded: z.number().nonnegative(),
  /** Simulation time the application occurred. */
  at: z.number().int().nonnegative(),
});
export type FertilizerApplicationResult = z.infer<typeof fertilizerApplicationResultSchema>;

/**
 * Result of applying water (irrigation) — for the `water-applied` event
 * payload and the `apply-water` action handler's return value.
 */
export const waterApplicationResultSchema = z.object({
  /** Litres applied. */
  litres: z.number().nonnegative(),
  /** Soil water BEFORE application. */
  soilWaterBefore: z.number().nonnegative(),
  /** Soil water AFTER application (capped at soil water capacity). */
  soilWaterAfter: z.number().nonnegative(),
  /** Litres that ran off (couldn't be absorbed by soil). */
  runoff: z.number().nonnegative(),
  /** Simulation time the application occurred. */
  at: z.number().int().nonnegative(),
});
export type WaterApplicationResult = z.infer<typeof waterApplicationResultSchema>;
