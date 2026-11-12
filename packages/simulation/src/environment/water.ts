/**
 * Freshwater dynamics (TDD §13 Environment System, §5.5; GDD §10.1).
 *
 * Pure helper that advances the regional freshwater reserve one tick. The
 * EnvironmentSystem (`packages/simulation/src/systems/environment.ts`) calls
 * this after the climate step; it never mutates its input.
 *
 *   availability' = max(0, availability + rainfall - evaporation)   (L)
 *   groundwater'  = max(0, groundwater + recharge)                   (L, slow)
 *   contamination' = max(0, contamination * (1 - decay*dtDays))      (slow decay)
 *
 *   - `rainfall` comes from the WeatherSystem's just-produced weather
 *     (condition × intensity, via the content `WEATHER_EVENT_MAP` — same
 *     source the ResourceSystem uses).
 *   - `evaporation` scales with the local air temperature (warmer → more
 *     evap), using the resource module's base rate + base temperature so the
 *     two systems agree on the evaporation curve.
 *   - `groundwater` recharges from a small fraction of the rainfall (slow
 *     deep percolation) — distinct from the ResourceSystem's drainage term,
 *     which is the per-plot soil-water → groundwater transfer.
 *   - `contamination` decays slowly toward zero (natural attenuation /
 *     dilution). ResourceSystem does not touch `freshwater.contamination` —
 *     this is the EnvironmentSystem's field.
 *
 * @provisional overlap with ResourceSystem: ResourceSystem (slot #4) also
 * writes `freshwater.availability` (it syncs it to `soilWater + 0.1×groundwater`
 * as a per-plot soil-moisture proxy for legacy consumers). The EnvironmentSystem
 * (slot #10) runs after it, so this step's regional-reserve value is what
 * persists in the returned state — but ResourceSystem overwrites it again next
 * tick. The two notions of "availability" (regional reserve vs per-plot proxy)
 * share one schema field pending a regional-granularity refactor (GDD §17,
 * §10.2). The pure `stepFreshwater` function is correct and unit-tested in
 * isolation; the integration test only asserts finiteness + non-negativity.
 */
import type { EnvironmentState, WeatherState } from '@capitalist-tree/shared';
import {
  PROVISIONAL_RESOURCE_EVAPORATION_BASE_TEMP_C,
  PROVISIONAL_RESOURCE_EVAPORATION_RATE_PER_DAY,
} from '@capitalist-tree/shared';
import { WEATHER_EVENT_MAP } from '@capitalist-tree/content';

const SECONDS_PER_DAY = 24 * 60 * 60;

// @provisional (GDD §17: detailed resource simulation equations) — fraction of
// the rainfall that percolates into groundwater each sim day (slow deep
// recharge). Small (0.05) so groundwater is a slow-moving buffer, not a fast
// store. Tunable; promote to a shared decided constant once the regional water
// table model lands.
export const PROVISIONAL_ENV_GROUNDWATER_RECHARGE_FRACTION = 0.05;

// @provisional (GDD §17: Environmental recovery timescales) — fraction of the
// freshwater contamination removed per sim day by natural attenuation +
// dilution. Slow (0.01/day ≈ ~100-day half-life) so contamination lingers
// meaningfully after a pollution event (GDD §10.3 "recovery ... depends on
// the severity"). Tunable.
export const PROVISIONAL_ENV_FRESHWATER_CONTAMINATION_DECAY_RATE = 0.01; // per sim day

/**
 * Advance the regional freshwater reserve one tick.
 *
 * Pure: takes the environment + the WeatherSystem's just-produced weather +
 * step length, returns a NEW freshwater object. The caller assigns it back to
 * `env.freshwater`.
 */
export function stepFreshwater(
  env: EnvironmentState,
  weather: WeatherState,
  dtSeconds: number,
): EnvironmentState['freshwater'] {
  const dtDays = dtSeconds / SECONDS_PER_DAY;
  const fw = env.freshwater;

  // Rainfall from the weather condition × intensity (L over this step).
  const weatherEvent = WEATHER_EVENT_MAP[weather.condition];
  const rainfallLPerDay = weatherEvent ? weatherEvent.rainfallLPerDay : 0;
  const rainfall = rainfallLPerDay * weather.intensity * dtDays;

  // Evaporation scales with the local air temperature above the base temp
  // (mirrors resources/water.ts's evaporation curve so the two systems agree).
  const tempFactor = Math.max(0, weather.temperature - PROVISIONAL_RESOURCE_EVAPORATION_BASE_TEMP_C);
  const evaporation = PROVISIONAL_RESOURCE_EVAPORATION_RATE_PER_DAY * (1 + tempFactor * 0.1) * dtDays;

  // Availability: rainfall in, evaporation out.
  const availability = Math.max(0, fw.availability + rainfall - evaporation);

  // Groundwater: slow recharge from a fraction of the rainfall.
  const groundwater = Math.max(0, fw.groundwater + rainfall * PROVISIONAL_ENV_GROUNDWATER_RECHARGE_FRACTION);

  // Contamination: slow natural attenuation toward zero.
  const contamination = Math.max(0, fw.contamination * (1 - PROVISIONAL_ENV_FRESHWATER_CONTAMINATION_DECAY_RATE * dtDays));

  return { availability, groundwater, contamination };
}
