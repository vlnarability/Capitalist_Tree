/**
 * Weather event definitions (P2 — TDD §9.1, GDD §4.3).
 *
 * Pure data — one entry per weather condition. Defines the static effects of
 * each condition: rainfall amount, evaporation multiplier, light factor,
 * temperature delta, and damage potential.
 *
 * The values mirror the constants in `packages/shared/src/constants/resources.ts`
 * (`PROVISIONAL_WEATHER_RAINFALL_L_PER_DAY`, etc.) but are exposed here as
 * data so future climates / mods can override per-condition behaviour without
 * touching engine code (rule 5: content is data).
 *
 * Adding a new weather condition means appending to `ALL_WEATHER_EVENTS` and
 * to the `WEATHER_CONDITIONS` tuple in `packages/shared/src/schemas/weather.ts`
 * — the engine code stays fixed.
 *
 * PROVISIONAL per GDD §17 ("detailed climate model").
 */
import type { WeatherCondition, WeatherEventDefinition } from '@capitalist-tree/shared';
import {
  PROVISIONAL_WEATHER_RAINFALL_L_PER_DAY,
  PROVISIONAL_WEATHER_EVAPORATION_MULT,
  PROVISIONAL_WEATHER_LIGHT_FACTOR_MULT,
  PROVISIONAL_WEATHER_TEMP_DELTAS_C,
} from '@capitalist-tree/shared';

/** The static definition for each weather condition. */
function defineEvent(
  condition: WeatherCondition,
  label: string,
  canDamage: boolean,
  damageType?: 'storm' | 'frost' | 'heat' | 'wind' | 'drought',
): WeatherEventDefinition {
  return {
    condition,
    label,
    rainfallLPerDay: PROVISIONAL_WEATHER_RAINFALL_L_PER_DAY[condition] ?? 0,
    evaporationMultiplier: PROVISIONAL_WEATHER_EVAPORATION_MULT[condition] ?? 1,
    lightFactorMultiplier: PROVISIONAL_WEATHER_LIGHT_FACTOR_MULT[condition] ?? 1,
    temperatureDeltaC: PROVISIONAL_WEATHER_TEMP_DELTAS_C[condition] ?? 0,
    canDamage,
    damageType,
  };
}

/**
 * All weather event definitions, indexed by condition.
 *
 * The list mirrors the `WEATHER_CONDITIONS` tuple in
 * `packages/shared/src/schemas/weather.ts` — every condition has a definition.
 */
export const ALL_WEATHER_EVENTS: readonly WeatherEventDefinition[] = [
  defineEvent('sunny', 'Sunny', false),
  defineEvent('cloudy', 'Cloudy', false),
  defineEvent('rain', 'Rain', false),
  defineEvent('heavy-rain', 'Heavy Rain', false),
  defineEvent('drought', 'Drought', true, 'drought'),
  defineEvent('frost', 'Frost', true, 'frost'),
  defineEvent('heat-wave', 'Heat Wave', true, 'heat'),
  defineEvent('wind', 'Wind', true, 'wind'),
  defineEvent('severe-storm', 'Severe Storm', true, 'storm'),
];

/** Map of condition -> event definition, for O(1) lookup by WeatherSystem. */
export const WEATHER_EVENT_MAP: Readonly<Record<WeatherCondition, WeatherEventDefinition>> =
  Object.freeze(
    Object.fromEntries(ALL_WEATHER_EVENTS.map((e) => [e.condition, e])) as Record<
      WeatherCondition,
      WeatherEventDefinition
    >,
  );

/**
 * Look up a weather event definition by condition. Returns the definition or
 * `undefined` if the condition is unknown (defensive — should not happen given
 * the schema's enum constraint).
 */
export function findWeatherEvent(condition: WeatherCondition): WeatherEventDefinition | undefined {
  return WEATHER_EVENT_MAP[condition];
}
