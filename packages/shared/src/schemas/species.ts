import { z } from 'zod';
import { nutrientStateSchema } from './tree.js';

/**
 * TreeSpecies data (TDD §7.7, GDD §5).
 *
 * A TreeSpecies is pure data — it lives in `packages/content` and is consumed
 * by the BiologySystem at runtime. The engine NEVER hardcodes species traits
 * (rule 5: species are data, not engine logic). Adding a new species means
 * adding a new `TreeSpecies` object to content; the engine code stays fixed.
 *
 * Notes on units:
 *   - All energy values are in arbitrary "energy units" (eu). The BiologySystem
 *     normalises photosynthesis output and allocation demand to eu.
 *   - `leafDenominationMinor` is the currency a single harvested leaf is worth,
 *     in minor currency units (bigint serialized as string per TDD §10.1).
 *   - Temperature values are in °C.
 *   - Heights and diameters are in metres.
 *
 * `initial` describes the sapling stage the player starts with — used by
 * `initializeState` to seed `originalTree`. Different species can start as
 * very different saplings (e.g. a slow-growing oak vs a fast-growing maple).
 *
 * PROVISIONAL tuning values: the species table is a GDD §17 unresolved item
 * ("Detailed photosynthesis and energy allocation equations"). Every constant
 * here is provisional and subject to playtesting.
 */
export const temperatureRangeSchema = z.object({
  /** Temperature below which photosynthesis is zero (°C). */
  minimum: z.number(),
  /** Temperature at which photosynthesis is maximised (°C). */
  optimum: z.number(),
  /** Temperature above which photosynthesis is zero (°C). */
  maximum: z.number(),
});
export type TemperatureRange = z.infer<typeof temperatureRangeSchema>;

/**
 * Initial biological state for a sapling of this species.
 *
 * Used by `SimulationEngine.initialize` to populate `originalTree`. Keeping
 * this on the species (rather than hardcoding in `initial-state.ts`) is what
 * lets multiple species coexist without engine changes (rule 5).
 */
export const speciesInitialStateSchema = z.object({
  height: z.number().nonnegative(),
  trunkDiameter: z.number().nonnegative(),
  branchDevelopment: z.number().nonnegative(),
  leafCapacity: z.number().int().nonnegative(),
  rootDevelopment: z.number().nonnegative(),
  absorptionCapacity: z.number().nonnegative(),
  reserveCapacity: z.number().nonnegative(),
  waterCapacity: z.number().nonnegative(),
  energyReserves: z.number().nonnegative(),
  waterStored: z.number().nonnegative(),
  nutrients: nutrientStateSchema,
});
export type SpeciesInitialState = z.infer<typeof speciesInitialStateSchema>;

export const treeSpeciesSchema = z.object({
  /** Unique species id. Convention: `species:<slug>` (e.g. `species:white-oak`). */
  id: z.string().min(1),
  /** Human-readable common name (e.g. "White Oak"). */
  name: z.string().min(1),
  /** Scientific name (e.g. "Quercus alba"). */
  scientificName: z.string().optional(),
  /** Whether the species sheds leaves seasonally (GDD §4.4). */
  deciduous: z.boolean(),
  /** General growth-rate multiplier (dimensionless, ~1.0 baseline). */
  growthRate: z.number().positive(),
  /** Age in days at which the tree is considered mature (GDD §5.5). */
  matureAgeDays: z.number().int().positive(),
  /** Maximum structural height (m). Growth asymptotically approaches this. */
  maximumHeight: z.number().positive(),
  /** Maximum trunk diameter (m). */
  maximumTrunkDiameter: z.number().positive(),
  /** Maximum branch development score (dimensionless). */
  maximumBranchDevelopment: z.number().positive(),
  /** Root development rate multiplier. */
  rootDevelopmentRate: z.number().positive(),
  /** Baseline reserve capacity (eu). Scaled by structural development at runtime. */
  reserveCapacity: z.number().positive(),
  /** Daily water requirement at full foliage (L/day, scaled by active foliage). */
  waterRequirement: z.number().positive(),
  /** Baseline nutrient requirements (units scaled to uptake model). */
  nutrientRequirement: nutrientStateSchema,
  /** Temperature response curve (°C). */
  temperatureRange: temperatureRangeSchema,
  /**
   * Maximum photosynthetic production per unit active leaf area per simulation
   * day at optimum conditions (eu / leaf-area / day).
   */
  photosynthesisRate: z.number().positive(),
  /** Active photosynthetic area contributed by a single leaf (m²). */
  leafAreaPerLeaf: z.number().positive(),
  /**
   * Currency value of a single harvested leaf, in minor currency units
   * (bigint serialized as string per TDD §10.1).
   *
   * PROVISIONAL (GDD §17: initial leaf denomination and production rules).
   */
  leafDenominationMinor: z.string(),
  /**
   * Energy cost the tree pays to regrow one leaf (eu).
   * PROVISIONAL (GDD §17: detailed photosynthesis and energy allocation equations).
   */
  leafEnergyCost: z.number().positive(),
  /**
   * Maximum fraction of current foliage a single harvest action can remove
   * in one tick (GDD §5.4, §17: maximum harvesting rates).
   */
  maximumHarvestFraction: z.number().min(0).max(1),
  /** Initial sapling state used by `initializeState`. */
  initial: speciesInitialStateSchema,
});
export type TreeSpecies = z.infer<typeof treeSpeciesSchema>;
