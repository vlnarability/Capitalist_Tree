/**
 * Climate baselines (P2 — TDD §9.2, GDD §10.2).
 *
 * Pure data — defines the long-term climate parameters WeatherSystem uses to
 * derive local temperature and pick transition matrices.
 *
 * P2 ships a single baseline: a temperate continental climate
 * (`climate:temperate`). P6/P9 add regional climate data; the engine code
 * stays fixed (rule 5: content is data).
 *
 * The baseline's `seasonalBaseTemp` field gives the long-term average
 * temperature for each season. The local temperature for a step is
 * `seasonalBaseTemp[season] + conditionDelta * (0.5 + intensity * 0.5)` —
 * the condition's delta is modulated by intensity (a high-intensity heat
 * wave is hotter than a weak one).
 *
 * PROVISIONAL per GDD §17 ("detailed climate model"). Tunable in playtesting.
 */
import type { ClimateBaseline } from '@capitalist-tree/shared';
import {
  PROVISIONAL_WEATHER_CLIMATE_SHIFT_BASELINE_TEMP_C,
} from '@capitalist-tree/shared';

/**
 * Temperate continental climate — the starting plot's climate.
 *
 * Roughly corresponds to a USDA hardiness zone 5-6 (e.g. southern Ontario,
 * upstate New York, parts of central Europe). The White Oak (Quercus alba)
 * thrives in this climate in real life.
 *
 * PROVISIONAL per GDD §17 ("detailed climate model"). Tuned so the default
 * starting plot is temperate (not tropical, not arctic) and the sapling
 * can bootstrap on day 0.
 */
export const TEMPERATE_CLIMATE: ClimateBaseline = {
  id: 'climate:temperate',
  name: 'Temperate Continental',
  seasonalBaseTemp: {
    // °C — long-term seasonal averages.
    spring: 12, // cool spring — budding season, occasional late frost
    summer: 24, // warm summer — full canopy, occasional heat wave
    autumn: 12, // mild autumn — senescence begins
    winter: 0, // cold winter — dormant, occasional frost
  },
  climateShiftHook: {
    // PROVISIONAL: the global average temperature (~14°C) is the baseline.
    // When P6's EnvironmentSystem raises globalTemperature above this, the
    // WeatherSystem will (in a future revision) shift the baseline
    // temperatures + transition probabilities. P2 leaves the hook in place —
    // the actual shift is a no-op until P6 plumbs a real temperature
    // trajectory. See R-P2-3 in docs/resources-weather.md.
    baselineTempC: PROVISIONAL_WEATHER_CLIMATE_SHIFT_BASELINE_TEMP_C,
    tempShiftPerDegreeC: 1.0, // 1:1 warming → 1°C baseline shift per degree of global temp rise
    droughtProbShiftPerDegreeC: 0.02, // 2% more drought probability per degree of warming
  },
};

/**
 * All known climate baselines. Add new climates here.
 */
export const ALL_CLIMATES: readonly ClimateBaseline[] = [TEMPERATE_CLIMATE];

/**
 * Look up a climate baseline by id. Returns the baseline or `undefined` if
 * unknown.
 */
export function findClimateById(climateId: string): ClimateBaseline | undefined {
  return ALL_CLIMATES.find((c) => c.id === climateId);
}
