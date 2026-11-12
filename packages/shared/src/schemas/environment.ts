import { z } from 'zod';
import { nutrientStateSchema } from './tree.js';
import { weatherStateSchema } from './weather.js';
import { PROVISIONAL_ENERGY_BATTERY_CAPACITY_DEFAULT } from '../constants/environment.js';

export const speciesPopulationSchema = z.object({
  speciesId: z.string(),
  population: z.number().nonnegative(),
});
export type SpeciesPopulation = z.infer<typeof speciesPopulationSchema>;

/**
 * Global environmental state (TDD §5.5, §8.3, §9.2; GDD §10, §170).
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
 *
 * P7a additions (TDD §13 Environment System, §9.2 Climate Model; GDD §10,
 * §28, §59–67, §170; resolves R-P6-3 / R-P6-4 from
 * docs/offline-automation.md §6.3 / §6.4):
 *   - `atmosphere.methaneConcentration`, `atmosphere.nitrousOxideConcentration`,
 *     `atmosphere.aerosols` — the other major GHGs + aerosols for a richer
 *     climate model (GDD §170). Methane (CH4) and nitrous oxide (N2O) are
 *     potent GHGs; aerosols are net-cooling (negative = cooling, positive =
 *     warming). The EnvironmentSystem (P7b) folds these into
 *     `climateForcing`. Defaults to real-world-ish baselines (1.9 / 0.33 / 0).
 *   - `climateForcing: number` — net radiative forcing in W/m^2, derived from
 *     the GHG concentrations (CO2 + CH4 + N2O) minus aerosol cooling. The
 *     EnvironmentSystem computes it each tick; it drives `globalTemperature`.
 *   - `seaLevelRise: number` — mm above baseline, the long-term consequence
 *     of sustained warming (GDD §170). Advances each sim year with warming.
 *   - `energy: { stored, capacity, generationRate, consumptionRate }` — the
 *     energy pool P6 lacked (R-P6-3). The `solar-panel` equipment (P6b1)
 *     generates into `stored`; the `battery` raises `capacity`; automation
 *     `energyConsumption` debits `stored` (wired in P7c). Until then energy
 *     consumption is reported-but-unenforced, but the pool now exists so the
 *     data path is in place.
 *   - `landUse: { developed, degraded, protected }` — the land-use
 *     accumulators P6b2's `landDisturbance` had no target for (R-P6-4). Each
 *     is a fraction in [0, 1]. `landDisturbance` now increments `degraded`
 *     (wired in P7c); the schema field exists now so the migration can seed
 *     it and the EnvironmentSystem (P7b) can read it.
 *
 * All P7a fields have Zod `.default(...)` so v8 saves parse cleanly under v9
 * even without re-running the migration, and the v8 -> v9 migration backfills
 * them explicitly so consumers can rely on their presence (matching the
 * v3 -> v4 / v5 -> v6 / v6 -> v7 convention).
 */
export const environmentStateSchema = z.object({
  atmosphere: z.object({
    co2Concentration: z.number().nonnegative(),
    emissions: z.number(),
    sequestration: z.number(),
    /**
     * Atmospheric methane (CH4) concentration in ppm (TDD §9.2, GDD §170).
     * Potent GHG — ~28× CO2's warming potential per molecule. The
     * EnvironmentSystem (P7b) folds it into `climateForcing`. Default 1.9
     * (real-world-ish baseline). Backfilled by the v8 -> v9 migration.
     */
    methaneConcentration: z.number().nonnegative().default(1.9),
    /**
     * Atmospheric nitrous oxide (N2O) concentration in ppm (TDD §9.2, GDD
     * §170). Potent long-lived GHG — ~265× CO2's warming potential. Default
     * 0.33 (real-world-ish baseline). Backfilled by the v8 -> v9 migration.
     */
    nitrousOxideConcentration: z.number().nonnegative().default(0.33),
    /**
     * Net aerosol forcing contribution (TDD §9.2, GDD §170). Aerosols are
     * net-cooling (sulphate, dust) or net-warming (black carbon); the sign
     * convention is negative = cooling, positive = warming. The
     * EnvironmentSystem adds this directly to `climateForcing`. Default 0
     * (no aerosol perturbation). Backfilled by the v8 -> v9 migration.
     */
    aerosols: z.number().default(0),
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
  /**
   * Net radiative forcing in W/m^2 (TDD §9.2, GDD §170). Derived by the
   * EnvironmentSystem (P7b) from the GHG concentrations (CO2 + CH4 + N2O
   * forcing) minus aerosol cooling. Drives `globalTemperature` via
   * `PROVISIONAL_ENV_TEMP_SENSITIVITY_PER_W_M2`. Sign: positive = net warming.
   * Default 0 (no perturbation at baseline). Backfilled by v8 -> v9 migration.
   */
  climateForcing: z.number().default(0),
  /**
   * Sea level rise in mm above baseline (TDD §9.2, GDD §170). Long-term
   * consequence of sustained warming — advanced each sim year by
   * `max(0, globalTemperature - baselineTemp) ×
   * PROVISIONAL_ENV_SEA_LEVEL_RISE_RATE`. Slow on purpose: only visible across
   * many sim years of warming. Default 0. Backfilled by v8 -> v9 migration.
   */
  seaLevelRise: z.number().nonnegative().default(0),
  /**
   * Energy pool (TDD §13 Environment System, GDD §9.1 — resolves R-P6-3).
   * P6b1 defined the `energy` equipment category (`solar-panel`, `battery`)
   * and `AutomationState.energyConsumption`, but P6 had no pool to debit
   * (docs/offline-automation.md §6.3). P7a adds this; P7c wires
   * `energyConsumption` to debit `stored`.
   *   - `stored` — current energy in the pool (energy-units, ≥ 0).
   *   - `capacity` — max the pool can hold (raised when a battery is bought).
   *   - `generationRate` — energy added per sim day (e.g. solar output).
   *   - `consumptionRate` — energy drawn per sim day (automation + baseline).
   * The EnvironmentSystem (P7b) reconciles `stored` from the two rates each
   * tick. Default capacity is `PROVISIONAL_ENERGY_BATTERY_CAPACITY_DEFAULT`
   * so a freshly-migrated save can bank surplus once a panel is installed;
   * `stored` defaults to 0 (no legacy save starts with free energy).
   */
  energy: z
    .object({
      stored: z.number().nonnegative(),
      capacity: z.number().nonnegative(),
      generationRate: z.number(),
      consumptionRate: z.number(),
    })
    .default(() => ({
      stored: 0,
      capacity: PROVISIONAL_ENERGY_BATTERY_CAPACITY_DEFAULT,
      generationRate: 0,
      consumptionRate: 0,
    })),
  /**
   * Land-use accumulators (TDD §5.5, GDD §10 — resolves R-P6-4). Each is a
   * fraction in [0, 1]. P6b2's `applyEnvironmentalImpact` had no target for
   * `landDisturbance` (docs/offline-automation.md §6.4); P7c routes it to
   * `degraded`. The schema field exists now so the migration seeds it and the
   * EnvironmentSystem (P7b) can read it.
   *   - `developed` — share of the plot built out for industry / automation.
   *   - `degraded` — share damaged by disturbance / contamination / erosion.
   *   - `protected` — share set aside as conserved / restored habitat.
   */
  landUse: z
    .object({
      developed: z.number().min(0).max(1),
      degraded: z.number().min(0).max(1),
      protected: z.number().min(0).max(1),
    })
    .default(() => ({ developed: 0, degraded: 0, protected: 0 })),
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
