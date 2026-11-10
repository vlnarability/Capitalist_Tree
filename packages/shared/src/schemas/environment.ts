import { z } from 'zod';
import { nutrientStateSchema } from './tree.js';
import { weatherStateSchema } from './weather.js';

export const speciesPopulationSchema = z.object({
  speciesId: z.string(),
  population: z.number().nonnegative(),
});
export type SpeciesPopulation = z.infer<typeof speciesPopulationSchema>;

/**
 * Global environmental state (TDD §5.5, §8.3).
 *
 * Regional environments will eventually reuse this shape (TDD §5.5 note).
 * All fields are physical quantities; P0 leaves them at neutral defaults.
 *
 * P2 additions to `soil`:
 *   - `soilWater: number` — soil water content (L) for the water-balance
 *     model. Inputs (rainfall, irrigation), outputs (evaporation, drainage,
 *     tree uptake, runoff). Lives on `environment.soil` (not on `freshwater`)
 *     because it's the per-plot soil moisture the ResourceSystem owns.
 *   - `ph`, `compaction`, `microbialActivity: number` — extension-point
 *     stubs for the soil health derivation (TDD §8.3 "Potential variables").
 *     P2 leaves them at neutral defaults (pH 6.5, compaction 0, microbial
 *     activity 1.0). P6+ will populate them when the soil model is extended.
 *     Schema exists so future content / systems can read them without
 *     another migration.
 */
export const environmentStateSchema = z.object({
  atmosphere: z.object({
    co2Concentration: z.number().nonnegative(),
    emissions: z.number(),
    sequestration: z.number(),
  }),
  soil: z.object({
    health: z.number().min(0).max(1),
    organicMatter: z.number().nonnegative(),
    contamination: z.number().nonnegative(),
    nutrients: nutrientStateSchema,
    /**
     * Soil water content (L) — P2 addition. Owned and updated each tick by
     * the ResourceSystem. Read by BiologySystem's placeholder via the
     * `freshwater.availability` field which ResourceSystem keeps in sync.
     * Default 0 (backfilled by v3 -> v4 migration for older saves).
     */
    soilWater: z.number().nonnegative().default(0),
    /**
     * Soil pH (0-14 scale, neutral = 7). Extension-point stub for the soil
     * health derivation (TDD §8.3). P2 leaves at 6.5 (slightly acidic, ideal
     * for most trees). P6+ will model pH dynamics (acid rain, liming, etc.).
     */
    ph: z.number().min(0).max(14).default(6.5),
    /**
     * Soil compaction in [0, 1] (0 = loose, 1 = fully compacted).
     * Extension-point stub — P2 leaves at 0. P6+ will model compaction
     * dynamics (heavy equipment traffic, root penetration, etc.).
     */
    compaction: z.number().min(0).max(1).default(0),
    /**
     * Microbial activity in [0, 1+] (1.0 = baseline). Extension-point stub —
     * P2 leaves at 1.0. P6+ will model microbial dynamics (compost tea,
     * fungicides, etc.). Above 1.0 means more active than baseline.
     */
    microbialActivity: z.number().min(0).default(1.0),
  }),
  freshwater: z.object({
    availability: z.number().nonnegative(),
    groundwater: z.number().nonnegative(),
    contamination: z.number().nonnegative(),
  }),
  biodiversity: z.object({
    index: z.number().min(0).max(1),
    speciesPopulations: z.array(speciesPopulationSchema),
  }),
  forestCoverage: z.number().min(0).max(1),
  ecosystemResilience: z.number().min(0).max(1),
  globalTemperature: z.number(),
});
export type EnvironmentState = z.infer<typeof environmentStateSchema>;

/**
 * World state — wraps global environment, current weather, plus a stub for
 * regional data. P0 has a single region (the player's land). P2 adds the
 * `weather` field for the WeatherSystem's output.
 */
export const worldStateSchema = z.object({
  environment: environmentStateSchema,
  /**
   * Current weather (P2). Updated once per step by WeatherSystem (slot #2).
   * Read by ResourceSystem (slot #4), BiologySystem (slot #3, via
   * `environment.globalTemperature` until refactored — see R-P2-1), and
   * P4's renderer.
   */
  weather: weatherStateSchema.default(() => ({
    condition: 'sunny' as const,
    temperature: 18,
    intensity: 0.5,
    prevCondition: null,
    daysInCondition: 0,
  })),
  // PROVISIONAL: regional granularity is unresolved (GDD §17). P0 has one
  // implicit region. P6/P9 will expand this into a region map.
  regionId: z.string().min(1),
});
export type WorldState = z.infer<typeof worldStateSchema>;
