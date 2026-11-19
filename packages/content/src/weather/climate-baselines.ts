/**
 * Climate baselines (P2 — TDD §9.2, GDD §10.2; extended by GAP-17 / DR-11).
 *
 * Pure data — defines the long-term climate parameters WeatherSystem uses to
 * derive local temperature and pick transition matrices.
 *
 * GAP-17 expands the catalog from the single P2 default (`climate:temperate`,
 * a warm-Dfb) to the full Köppen-Geiger classification: the 31 climate types in
 * `koppen-zones.ts` (Af…EF) + this default. The H highland elevation modifier
 * lives in `highland.ts`. The engine code stays fixed (rule 5: content is data).
 *
 * The baseline's `seasonalBaseTemp` field gives the long-term average
 * temperature for each season. The local temperature for a step is
 * `seasonalBaseTemp[season] + conditionDelta * (0.5 + intensity * 0.5)` —
 * the condition's delta is modulated by intensity (a high-intensity heat
 * wave is hotter than a weak one).
 *
 * PROVISIONAL per GDD §17 ("detailed climate model"); Köppen grounding per
 * GAP-17 / DR-11. Tunable in playtesting.
 */
import type { ClimateBaseline } from '@capitalist-tree/shared';
import {
  PROVISIONAL_WEATHER_CLIMATE_SHIFT_BASELINE_TEMP_C,
} from '@capitalist-tree/shared';
import { KOPPEN_ZONES } from './koppen-zones.js';

/**
 * Temperate continental climate — the default starting plot's climate (GAP-17
 * classifies it as a warm Dfb).
 *
 * Roughly corresponds to USDA hardiness zone 5-6 (e.g. southern Ontario,
 * upstate New York, parts of central Europe). The White Oak (Quercus alba)
 * thrives in this climate in real life.
 *
 * Köppen note (transparency): classified Dfb (warm humid continental) per the
 * original USDA-zone-5-6 intent + the GAP-17 design ("default remains Dfb").
 * The winter baseline (0 °C) sits at the Köppen C/D boundary (−3 °C rule) and
 * the summer (24 °C) at the Dfb/Dfa (22 °C) boundary — this default is
 * gameplay-tuned slightly warm so the sapling can bootstrap on day 0. A strict
 * pure-Dfb exemplar (7/19/7/-5 °C) is `climate:dfb` in `koppen-zones.ts`. The
 * seasonal temperatures + climateShiftHook are byte-identical to the pre-GAP-17
 * baseline (no behavior change for current saves).
 *
 * PROVISIONAL per GDD §17 ("detailed climate model"). Tunable in playtesting.
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
  // --- GAP-17 (DR-11) Köppen-Geiger profile (warm-Dfb default; temps unchanged above) ---
  koppenCode: 'Dfb',
  koppenClass: 'D',
  description: 'Warm humid continental — the default starting climate (southern Ontario, upstate NY, central Europe). White Oak thrives here.',
  precipitation: { annualMm: 750, pattern: 'year-round', driestMonthMm: 40 },
  seasonality: 'four-season',
  frostRisk: 'regular-winter',
  heatStressRisk: 'none',
  supportsTrees: true,
  treeSuitabilityNote: 'Forgiving default — cold winters + warm summers; the White Oak thrives here.',
};

/**
 * All known climate zones: the default starting climate + the 31 Köppen-Geiger
 * exemplar zones from `koppen-zones.ts`. The H highland modifier is applied
 * dynamically (not a fixed entry — see `highland.ts`). Add new zones in
 * `koppen-zones.ts`; the engine code stays fixed.
 */
export const ALL_CLIMATES: readonly ClimateBaseline[] = [TEMPERATE_CLIMATE, ...KOPPEN_ZONES];

/**
 * Look up a climate baseline by id. Returns the baseline or `undefined` if
 * unknown.
 */
export function findClimateById(climateId: string): ClimateBaseline | undefined {
  return ALL_CLIMATES.find((c) => c.id === climateId);
}
