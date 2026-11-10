/**
 * Per-season Markov transition matrices (P2 — TDD §9.1).
 *
 * Pure data — each matrix defines the probability of transitioning from one
 * weather condition to another within a given season. WeatherSystem looks up
 * the matrix for the current season, then the row for the current condition,
 * then rolls the weather RNG to pick the next condition.
 *
 * Rows MUST sum to ~1.0 (within floating-point tolerance). The content
 * loader asserts this at module load — a malformed matrix fails fast.
 *
 * P2 ships a single temperate-continental transition matrix set
 * (`climate:temperate`). P6/P9 add regional matrices; the engine code stays
 * fixed (rule 5: content is data).
 *
 * Design intent per season (GDD §4.4):
 *
 *   - Spring: variable — budding weather, occasional late frost, rain.
 *   - Summer: mostly sunny with some clouds, occasional rain, drought risk,
 *     rare heat wave.
 *   - Autumn: cooler, cloudy, more rain, occasional wind.
 *   - Winter: cold, cloudy, occasional snow (treated as rain here), frost,
 *     rare severe storm.
 *
 * PROVISIONAL per GDD §17 ("detailed climate model"). Tunable.
 */
import type { WeatherCondition, WeatherTransitionMatrix, Season } from '@capitalist-tree/shared';

const C: WeatherCondition[] = [
  'sunny',
  'cloudy',
  'rain',
  'heavy-rain',
  'drought',
  'frost',
  'heat-wave',
  'wind',
  'severe-storm',
];

/**
 * Helper to build a transition row from a partial map of {next: probability}.
 * Unspecified transitions get 0 probability. The function does NOT normalize —
 * the caller is responsible for making rows sum to 1.0.
 */
function row(entries: Partial<Record<WeatherCondition, number>>): Record<WeatherCondition, number> {
  const out = {} as Record<WeatherCondition, number>;
  for (const c of C) {
    const value = entries[c as WeatherCondition];
    out[c] = value ?? 0;
  }
  return out;
}

/**
 * Validate that each row in a matrix sums to ~1.0 (within epsilon). Throws at
 * module load if a matrix is malformed — fails fast rather than producing
 * weird weather.
 */
function validateMatrix(matrix: WeatherTransitionMatrix): void {
  for (const [from, rowObj] of Object.entries(matrix.transitions)) {
    const sum = Object.values(rowObj).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1.0) > 1e-6) {
      throw new Error(
        `Weather transition matrix for season "${matrix.season}" has row "${from}" summing to ${sum} (must be 1.0).`,
      );
    }
    for (const c of C) {
      const p = rowObj[c as WeatherCondition];
      if (p === undefined) {
        throw new Error(
          `Weather transition matrix for season "${matrix.season}" row "${from}" is missing column "${c}".`,
        );
      }
    }
  }
}

// --- Temperate continental: spring (GDD §4.4 — bud development, frost risk) ---
const TEMPERATE_SPRING: WeatherTransitionMatrix = {
  season: 'spring',
  transitions: {
    sunny: row({ sunny: 0.55, cloudy: 0.20, rain: 0.15, wind: 0.05, frost: 0.05 }),
    cloudy: row({ sunny: 0.25, cloudy: 0.40, rain: 0.25, wind: 0.05, frost: 0.05 }),
    rain: row({ sunny: 0.15, cloudy: 0.40, rain: 0.30, 'heavy-rain': 0.10, wind: 0.05 }),
    'heavy-rain': row({ sunny: 0.05, cloudy: 0.30, rain: 0.40, 'heavy-rain': 0.20, wind: 0.05 }),
    drought: row({ sunny: 0.40, cloudy: 0.30, drought: 0.20, rain: 0.10 }),
    frost: row({ sunny: 0.30, cloudy: 0.30, frost: 0.20, rain: 0.10, wind: 0.10 }),
    'heat-wave': row({ sunny: 0.40, cloudy: 0.20, 'heat-wave': 0.20, drought: 0.10, wind: 0.10 }),
    wind: row({ sunny: 0.35, cloudy: 0.30, wind: 0.20, rain: 0.10, frost: 0.05 }),
    'severe-storm': row({ sunny: 0.10, cloudy: 0.30, rain: 0.30, 'heavy-rain': 0.15, wind: 0.15 }),
  },
};

// --- Temperate continental: summer (GDD §4.4 — high water, drought risk) ---
const TEMPERATE_SUMMER: WeatherTransitionMatrix = {
  season: 'summer',
  transitions: {
    sunny: row({ sunny: 0.55, cloudy: 0.15, rain: 0.10, drought: 0.10, 'heat-wave': 0.10 }),
    cloudy: row({ sunny: 0.30, cloudy: 0.35, rain: 0.25, 'heavy-rain': 0.05, drought: 0.05 }),
    rain: row({ sunny: 0.20, cloudy: 0.35, rain: 0.30, 'heavy-rain': 0.10, drought: 0.05 }),
    'heavy-rain': row({ sunny: 0.10, cloudy: 0.30, rain: 0.35, 'heavy-rain': 0.20, 'severe-storm': 0.05 }),
    drought: row({ sunny: 0.45, drought: 0.30, 'heat-wave': 0.20, cloudy: 0.05 }),
    frost: row({ sunny: 0.50, cloudy: 0.30, frost: 0.10, rain: 0.10 }), // very rare in summer
    'heat-wave': row({ sunny: 0.30, 'heat-wave': 0.35, drought: 0.30, cloudy: 0.05 }),
    wind: row({ sunny: 0.35, cloudy: 0.30, wind: 0.15, rain: 0.10, 'severe-storm': 0.10 }),
    'severe-storm': row({ sunny: 0.10, cloudy: 0.30, rain: 0.30, 'heavy-rain': 0.20, 'severe-storm': 0.10 }),
  },
};

// --- Temperate continental: autumn (GDD §4.4 — senescence, more rain/wind) ---
const TEMPERATE_AUTUMN: WeatherTransitionMatrix = {
  season: 'autumn',
  transitions: {
    sunny: row({ sunny: 0.40, cloudy: 0.30, rain: 0.15, wind: 0.10, frost: 0.05 }),
    cloudy: row({ sunny: 0.20, cloudy: 0.40, rain: 0.25, wind: 0.10, frost: 0.05 }),
    rain: row({ sunny: 0.10, cloudy: 0.35, rain: 0.35, 'heavy-rain': 0.15, wind: 0.05 }),
    'heavy-rain': row({ sunny: 0.05, cloudy: 0.30, rain: 0.35, 'heavy-rain': 0.20, wind: 0.05, 'severe-storm': 0.05 }),
    drought: row({ sunny: 0.40, cloudy: 0.30, drought: 0.20, rain: 0.10 }),
    frost: row({ sunny: 0.25, cloudy: 0.30, frost: 0.25, rain: 0.10, wind: 0.10 }),
    'heat-wave': row({ sunny: 0.35, cloudy: 0.30, 'heat-wave': 0.15, drought: 0.10, rain: 0.10 }),
    wind: row({ sunny: 0.25, cloudy: 0.30, wind: 0.25, rain: 0.10, 'severe-storm': 0.10 }),
    'severe-storm': row({ sunny: 0.05, cloudy: 0.30, rain: 0.30, 'heavy-rain': 0.20, wind: 0.15 }),
  },
};

// --- Temperate continental: winter (GDD §4.4 — dormancy, frost, storms) ---
const TEMPERATE_WINTER: WeatherTransitionMatrix = {
  season: 'winter',
  transitions: {
    sunny: row({ sunny: 0.35, cloudy: 0.30, frost: 0.20, rain: 0.10, wind: 0.05 }),
    cloudy: row({ sunny: 0.20, cloudy: 0.40, frost: 0.20, rain: 0.15, 'heavy-rain': 0.05 }),
    rain: row({ sunny: 0.10, cloudy: 0.30, rain: 0.30, 'heavy-rain': 0.15, frost: 0.10, wind: 0.05 }),
    'heavy-rain': row({ sunny: 0.05, cloudy: 0.25, rain: 0.30, 'heavy-rain': 0.20, frost: 0.10, 'severe-storm': 0.10 }),
    drought: row({ sunny: 0.30, cloudy: 0.30, frost: 0.30, drought: 0.10 }), // winter drought = cold + dry
    frost: row({ sunny: 0.20, cloudy: 0.30, frost: 0.40, rain: 0.05, wind: 0.05 }),
    'heat-wave': row({ sunny: 0.50, cloudy: 0.30, 'heat-wave': 0.10, frost: 0.10 }), // winter heat wave = warm spell
    wind: row({ sunny: 0.20, cloudy: 0.30, wind: 0.25, frost: 0.15, 'severe-storm': 0.10 }),
    'severe-storm': row({ sunny: 0.05, cloudy: 0.25, rain: 0.30, 'heavy-rain': 0.20, frost: 0.10, wind: 0.10 }),
  },
};

const TEMPERATE_MATRICES: WeatherTransitionMatrix[] = [
  TEMPERATE_SPRING,
  TEMPERATE_SUMMER,
  TEMPERATE_AUTUMN,
  TEMPERATE_WINTER,
];

// Fail fast at module load if any matrix is malformed.
for (const m of TEMPERATE_MATRICES) {
  validateMatrix(m);
}

/**
 * All transition matrices, indexed by climate id + season.
 *
 * Currently only the temperate climate has matrices. Adding a new climate
 * means appending a `WeatherTransitionMatrix[]` (one per season, in order
 * spring/summer/autumn/winter) here.
 */
export const ALL_TRANSITION_MATRICES: Readonly<Record<string, Readonly<Record<Season, WeatherTransitionMatrix>>>> =
  Object.freeze({
    'climate:temperate': Object.freeze({
      spring: TEMPERATE_SPRING,
      summer: TEMPERATE_SUMMER,
      autumn: TEMPERATE_AUTUMN,
      winter: TEMPERATE_WINTER,
    }),
  });

/**
 * Look up a transition matrix by climate id + season. Returns the matrix or
 * `undefined` if unknown. WeatherSystem asserts at startup that the default
 * climate's matrices exist (defensive — should never fail given the schema).
 */
export function findTransitionMatrix(
  climateId: string,
  season: Season,
): WeatherTransitionMatrix | undefined {
  return ALL_TRANSITION_MATRICES[climateId]?.[season];
}
