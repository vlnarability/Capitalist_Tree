import { z } from 'zod';

/**
 * Weather state (TDD §9.1, GDD §4.3).
 *
 * Lives at `state.world.weather`. Written once per simulation step by the
 * WeatherSystem (registry slot #2 — runs before BiologySystem so biology
 * reacts to the new weather). Read by:
 *   - The ResourceSystem (next slot) for rainfall + evaporation input.
 *   - P1's BiologySystem (via `state.world.environment.globalTemperature`,
 *     which WeatherSystem also writes for backwards compatibility until
 *     P1 is refactored to read `state.world.weather.temperature` directly —
 *     see R-P2-1 in docs/resources-weather.md).
 *   - P4's renderer (to display weather).
 *
 * `temperature` is the local temperature for this step (°C). It is derived
 * from the climate baseline + per-condition delta + intensity. It is NOT
 * the long-term climate baseline — that lives separately on the climate
 * data in `packages/content/src/weather/`.
 *
 * `intensity` is in [0, 1] — how strong the condition is. A high-intensity
 * heat wave is hotter than a weak one; a high-intensity severe storm is more
 * damaging. Drawn fresh each step from the weather RNG sub-stream.
 *
 * `daysInCondition` counts consecutive days in the current condition. The
 * WeatherSystem applies a staleness bias once this exceeds
 * `PROVISIONAL_WEATHER_MAX_DAYS_IN_CONDITION` to prevent indefinite runs.
 *
 * PROVISIONAL: every tuning constant referenced here lives in
 * `packages/shared/src/constants/resources.ts` and is marked with the
 * GDD §17 item it resolves (e.g., "detailed climate model").
 */
export const WEATHER_CONDITIONS = [
  'sunny',
  'cloudy',
  'rain',
  'heavy-rain',
  'drought',
  'frost',
  'heat-wave',
  'wind',
  'severe-storm',
] as const;
export type WeatherCondition = (typeof WEATHER_CONDITIONS)[number];

export const weatherConditionSchema = z.enum(WEATHER_CONDITIONS);
export type WeatherConditionSchema = typeof weatherConditionSchema;

export const weatherStateSchema = z.object({
  /** Current weather condition (GDD §4.3). */
  condition: weatherConditionSchema,
  /**
   * Local air temperature for this step (°C). Derived from the climate
   * baseline + per-condition delta + intensity modulation. NOT the long-term
   * climate baseline.
   */
  temperature: z.number(),
  /**
   * Intensity of the current condition, in [0, 1]. Drawn fresh each step
   * from the weather RNG sub-stream. Scales rainfall, evaporation, damage.
   */
  intensity: z.number().min(0).max(1),
  /**
   * Previous weather condition (or null on the first step). Used by the
   * WeatherSystem to emit `weather-changed` events and to compute Markov
   * transitions when the condition has just changed.
   */
  prevCondition: weatherConditionSchema.nullable(),
  /**
   * Number of consecutive days the current condition has persisted. Used to
   * apply the staleness bias (PROVISIONAL_WEATHER_STALENESS_BIAS) once it
   * exceeds PROVISIONAL_WEATHER_MAX_DAYS_IN_CONDITION.
   */
  daysInCondition: z.number().int().nonnegative(),
});
export type WeatherState = z.infer<typeof weatherStateSchema>;

/**
 * Climate baseline for a region (TDD §9.2, GDD §10.2).
 *
 * Pure data — lives in `packages/content/src/weather/climate-baselines.ts`.
 * Defines the long-term climate parameters WeatherSystem uses to derive
 * local temperature and pick transition matrices.
 *
 * P2 ships a single baseline (`climate:temperate`). P6/P9 add regional
 * climate data; the engine code stays fixed (rule 5: content is data).
 *
 * PROVISIONAL per GDD §17 ("detailed climate model").
 */
export const climateBaselineSchema = z.object({
  /** Climate id. Convention: `climate:<slug>` (e.g. `climate:temperate`). */
  id: z.string().min(1),
  /** Human-readable name. */
  name: z.string().min(1),
  /**
   * Per-season base temperature (°C). The local temperature for a step is
   * `baseline[season] + conditionDelta * (0.5 + intensity * 0.5)`.
   */
  seasonalBaseTemp: z.object({
    spring: z.number(),
    summer: z.number(),
    autumn: z.number(),
    winter: z.number(),
  }),
  /**
   * Hook for global-temperature-driven climate shifts (TDD §9.2). When P6's
   * EnvironmentSystem raises `environment.globalTemperature` above this
   * threshold, the WeatherSystem will (in a future revision) shift the
   * baseline temperatures + transition probabilities. P2 leaves this in
   * place — the actual shift is a no-op until P6 plumbs a real temperature
   * trajectory. See R-P2-3 in docs/resources-weather.md.
   */
  climateShiftHook: z.object({
    baselineTempC: z.number(),
    /** Per-degree-of-warming shift in base temperature, applied above baseline. */
    tempShiftPerDegreeC: z.number(),
    /** Per-degree-of-warming shift in drought probability, applied above baseline. */
    droughtProbShiftPerDegreeC: z.number(),
  }),
});
export type ClimateBaseline = z.infer<typeof climateBaselineSchema>;

/**
 * A single weather condition's static effects (TDD §9.3).
 *
 * Pure data — lives in `packages/content/src/weather/event-definitions.ts`.
 * Defines how each weather condition affects the simulation. WeatherSystem
 * reads this to compute rainfall, evaporation multiplier, light factor,
 * and damage potential.
 *
 * The values mirror the constants in `packages/shared/src/constants/resources.ts`
 * (`PROVISIONAL_WEATHER_RAINFALL_L_PER_DAY`, etc.) but are exposed here as
 * data so future climates / mods can override per-condition behaviour
 * without touching engine code (rule 5: content is data).
 *
 * PROVISIONAL per GDD §17 ("detailed climate model").
 */
export const weatherEventDefinitionSchema = z.object({
  /** The condition this definition applies to. */
  condition: weatherConditionSchema,
  /** Human-readable label for UI. */
  label: z.string().min(1),
  /** Rainfall amount (L/day) at full intensity (intensity = 1). */
  rainfallLPerDay: z.number().nonnegative(),
  /** Multiplier on the base evaporation rate. */
  evaporationMultiplier: z.number().nonnegative(),
  /** Multiplier on the BiologySystem's light factor (P1 will read directly later). */
  lightFactorMultiplier: z.number().min(0).max(1),
  /** Temperature delta (°C) added to the climate baseline at full intensity. */
  temperatureDeltaC: z.number(),
  /** Whether this condition can emit `weather-damage` events. */
  canDamage: z.boolean(),
  /**
   * Damage category — what kind of damage the condition inflicts. Used by
   * the WeatherSystem to populate the `weather-damage` event payload so P1
   * (or a future refactor) can record the appropriate `tree.damage[]` entry.
   */
  damageType: z.enum(['storm', 'frost', 'heat', 'wind', 'drought']).optional(),
});
export type WeatherEventDefinition = z.infer<typeof weatherEventDefinitionSchema>;

/**
 * Per-season Markov transition matrix (TDD §9.1).
 *
 * Pure data — lives in `packages/content/src/weather/transition-matrices.ts`.
 * Each row is a probability distribution over the next condition given the
 * current condition. Rows MUST sum to 1.0 (validated at content load time).
 *
 * The matrix is keyed by current condition → next condition. WeatherSystem
 * looks up the matrix for the current season, then the row for the current
 * condition, then rolls the weather RNG to pick the next condition.
 *
 * PROVISIONAL per GDD §17 ("detailed climate model").
 */
export const weatherTransitionMatrixSchema = z.object({
  /** Season this matrix applies to. */
  season: z.enum(['spring', 'summer', 'autumn', 'winter']),
  /**
   * Map: currentCondition -> { nextCondition -> probability }.
   * Inner objects MUST sum to 1.0 (validated by content loader, not by Zod —
   * floating-point sums can drift by epsilon so we don't enforce here).
   */
  transitions: z.record(weatherConditionSchema, z.record(weatherConditionSchema, z.number().min(0).max(1))),
});
export type WeatherTransitionMatrix = z.infer<typeof weatherTransitionMatrixSchema>;
