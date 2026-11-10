/**
 * Weather effect functions (TDD §9.3, GDD §4.3).
 *
 * Pure functions computing the per-step effects of a weather condition:
 *
 *   - Local temperature (climate baseline + condition delta, intensity-modulated).
 *   - Rainfall amount (L/day, scaled by intensity + stepDays).
 *   - Evaporation multiplier (per-condition; combined with base rate).
 *   - Damage potential (whether the condition emits a weather-damage event).
 *
 * The functions are pure: they take inputs and return outputs. The
 * WeatherSystem applies the outputs to the GameState.
 */
import type {
  ClimateBaseline,
  Season,
  WeatherCondition,
  WeatherEventDefinition,
} from '@capitalist-tree/shared';
import { PROVISIONAL_WEATHER_DAMAGE_INTENSITY_THRESHOLD, PROVISIONAL_WEATHER_DAMAGE_SEVERITY_SCALE } from '@capitalist-tree/shared';

/**
 * Compute the local temperature (°C) for a step given the climate baseline,
 * current season, condition, and intensity.
 *
 *   localTemp = baseline.seasonalBaseTemp[season]
 *             + conditionDelta * (0.5 + intensity * 0.5)
 *
 * The intensity modulation means a high-intensity heat wave is hotter than a
 * weak one; a high-intensity frost is colder. At intensity = 0, the delta is
 * halved (50% effect); at intensity = 1, the delta is full.
 *
 * Pure: takes inputs, returns the temperature.
 */
export function computeLocalTemperature(
  climate: ClimateBaseline,
  season: Season,
  condition: WeatherCondition,
  intensity: number,
  eventDef: WeatherEventDefinition,
): number {
  const baseTemp = climate.seasonalBaseTemp[season];
  const delta = eventDef.temperatureDeltaC;
  const intensityScale = 0.5 + intensity * 0.5;
  return baseTemp + delta * intensityScale;
}

/**
 * Compute the rainfall amount (L) for a step given the condition's base rate,
 * the weather intensity, and the step length in days.
 *
 *   rainfallL = eventDef.rainfallLPerDay * intensity * stepDays
 *
 * At intensity 0, no rainfall. At intensity 1, the full per-day rate scaled
 * by step length.
 *
 * Pure: takes inputs, returns the rainfall amount in litres.
 */
export function computeRainfall(
  eventDef: WeatherEventDefinition,
  intensity: number,
  stepDays: number,
): number {
  return eventDef.rainfallLPerDay * intensity * stepDays;
}

/**
 * Compute the evaporation multiplier for a step given the condition's base
 * multiplier, the local temperature, and a base evaporation rate.
 *
 * The effective evaporation rate is:
 *
 *   evapPerDay = baseRate * eventDef.evaporationMultiplier * tempFactor
 *
 * Where `tempFactor` is a linear ramp from 0 at
 * PROVISIONAL_RESOURCE_EVAPORATION_BASE_TEMP_C to 2 at 30°C above baseline
 * (and clamped above). Cold conditions suppress evaporation; hot conditions
 * accelerate it.
 *
 * Returns the effective evaporation rate (L/day) given the inputs. Caller
 * multiplies by stepDays to get per-step evaporation.
 *
 * Pure: takes inputs, returns the evaporation rate in L/day.
 */
export function computeEvaporationRate(
  eventDef: WeatherEventDefinition,
  localTempC: number,
  baseRatePerDay: number,
  evaporationBaseTempC: number,
): number {
  // Temperature factor: 0 at evaporationBaseTempC, 2 at +30°C, clamped.
  const tempFactor =
    localTempC <= evaporationBaseTempC
      ? 0
      : Math.min(2, (localTempC - evaporationBaseTempC) / 30);
  return baseRatePerDay * eventDef.evaporationMultiplier * tempFactor;
}

/**
 * Compute the damage severity (in [0, 1]) for a damage-capable weather
 * condition. Returns 0 if the condition cannot damage (eventDef.canDamage is
 * false) or if the intensity is below the threshold.
 *
 *   severity = clamp(intensity * DAMAGE_SEVERITY_SCALE, 0, 1) when canDamage
 *              and intensity >= DAMAGE_INTENSITY_THRESHOLD, else 0
 *
 * Pure: takes inputs, returns the severity.
 */
export function computeDamageSeverity(
  eventDef: WeatherEventDefinition,
  intensity: number,
): number {
  if (!eventDef.canDamage) return 0;
  if (intensity < PROVISIONAL_WEATHER_DAMAGE_INTENSITY_THRESHOLD) return 0;
  return Math.max(0, Math.min(1, intensity * PROVISIONAL_WEATHER_DAMAGE_SEVERITY_SCALE));
}

/**
 * Decide whether a damage event should be emitted this step.
 *
 * Returns true if the condition can damage AND the intensity meets/exceeds
 * the threshold. The WeatherSystem uses this to decide whether to push a
 * `weather-damage` event.
 *
 * Pure: takes the event definition + intensity, returns a boolean.
 */
export function shouldEmitDamage(
  eventDef: WeatherEventDefinition,
  intensity: number,
): boolean {
  return (
    eventDef.canDamage &&
    eventDef.damageType !== undefined &&
    intensity >= PROVISIONAL_WEATHER_DAMAGE_INTENSITY_THRESHOLD
  );
}
