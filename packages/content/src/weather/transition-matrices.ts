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
import type { WeatherCondition, WeatherTransitionMatrix, Season, ClimateBaseline } from '@capitalist-tree/shared';
import { KOPPEN_ZONES } from './koppen-zones.js';

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

// ---------------------------------------------------------------------------
// GAP-17 (DR-11) Phase 3 — per-zone transition-matrix factory.
//
// Hand-authoring 31 Köppen zones × 4 seasons = 124 matrices is infeasible, so
// the per-zone matrices are DERIVED from the hand-tuned temperate base by
// applying additive per-condition biases drawn from each zone's Köppen code +
// frostRisk + heatStressRisk (content data fields from §3). Each row gets the
// bias added to its `to` condition, then is renormalized so rows stay
// stochastic. This is content data (a factory in packages/content); the sim's
// WeatherSystem is unchanged — it still calls `findTransitionMatrix`. The
// biases are intentionally simple + provisional (GDD §17); they capture the
// climate SIGNATURE (arid → drought/heat, tropical → rain/storms, severe-winter
// → frost, polar → frost year-round, Mediterranean → dry-summer/wet-winter)
// well enough that a BWh date palm drought-stresses, a Dwd larch goes dormant,
// + a Dfa white oak thrives.
// ---------------------------------------------------------------------------

const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];

const BASE_BY_SEASON: Readonly<Record<Season, WeatherTransitionMatrix>> = {
  spring: TEMPERATE_SPRING,
  summer: TEMPERATE_SUMMER,
  autumn: TEMPERATE_AUTUMN,
  winter: TEMPERATE_WINTER,
};

/**
 * Per-condition ADDITIVE bias (probability mass added to every row's `to`
 * condition) for a zone + season. Positive biases introduce/enhance a
 * condition; negative suppress it. Applied uniformly across `from` rows so the
 * zone's climate signature shows regardless of the current condition (an arid
 * zone is drought-prone whether it's sunny or cloudy). Renormalization
 * afterwards keeps each row stochastic.
 */
function biasesFor(zone: ClimateBaseline, season: Season): Partial<Record<WeatherCondition, number>> {
  const code = zone.koppenCode.toLowerCase();
  const cls = code[0]; // a/b/c/d/e
  const b: Partial<Record<WeatherCondition, number>> = {};
  const add = (c: WeatherCondition, d: number): void => {
    b[c] = (b[c] ?? 0) + d;
  };

  // Köppen CLASS signature (the dominant differentiator).
  if (cls === 'b') {
    // Arid: drought + sun dominate; rain suppressed. Hot arid (bwh/bsh) adds
    // heat-wave; cold desert (bwk) adds frost (Gobi).
    add('drought', 0.30);
    add('sunny', 0.15);
    add('rain', -0.15);
    add('heavy-rain', -0.05);
    if (code === 'bwh' || code === 'bsh') add('heat-wave', 0.15);
    if (code === 'bwk') add('frost', 0.10);
  } else if (cls === 'a') {
    // Tropical: rain + storms dominate; drought suppressed (Aw dry season below).
    add('rain', 0.15);
    add('heavy-rain', 0.15);
    add('severe-storm', 0.10);
    add('drought', -0.10);
    if (code === 'aw' && (season === 'autumn' || season === 'winter')) add('drought', 0.20);
  } else if (cls === 'e') {
    // Polar: frost year-round; rain + heat suppressed.
    add('frost', 0.30);
    add('sunny', 0.05);
    add('rain', -0.10);
    add('heat-wave', -0.05);
  }

  // Mediterranean dry-summer / wet-winter pattern (Cs*, Ds*): the 3rd Köppen
  // letter 's' = dry summer.
  if (code.length >= 3 && code[2] === 's') {
    if (season === 'summer') {
      add('drought', 0.20);
      add('rain', -0.10);
    }
    if (season === 'winter') add('rain', 0.10);
  }

  // Frost risk → frost in cold seasons (spring/autumn/winter).
  if (zone.frostRisk === 'severe' || zone.frostRisk === 'regular-winter') {
    if (season !== 'summer') add('frost', 0.20);
  }
  // Heat-stress risk → heat-wave in summer.
  if (zone.heatStressRisk === 'regular' && season === 'summer') add('heat-wave', 0.15);

  return b;
}

/**
 * Derive one season's matrix for a zone: take the temperate base, add the
 * zone's per-condition bias to each row, clip negatives, renormalize. Pure.
 */
function deriveMatrix(zone: ClimateBaseline, season: Season): WeatherTransitionMatrix {
  const base = BASE_BY_SEASON[season]!;
  const bias = biasesFor(zone, season);
  const transitions = {} as Record<WeatherCondition, Record<WeatherCondition, number>>;
  for (const from of C) {
    const baseRow = base.transitions[from]!;
    const raw = C.map((to) => Math.max(0, (baseRow[to] ?? 0) + (bias[to] ?? 0)));
    const sum = raw.reduce((a, c) => a + c, 0) || 1;
    const out = {} as Record<WeatherCondition, number>;
    C.forEach((to, i) => {
      out[to] = (raw[i] ?? 0) / sum;
    });
    transitions[from] = out;
  }
  return { season, transitions };
}

/** Derive all 4 seasonal matrices for a zone. Pure. */
function deriveTransitionMatrices(zone: ClimateBaseline): Record<Season, WeatherTransitionMatrix> {
  const out = {} as Record<Season, WeatherTransitionMatrix>;
  for (const s of SEASONS) out[s] = deriveMatrix(zone, s);
  return out;
}

/**
 * Build the full per-zone transition-matrix catalog: the hand-tuned
 * `climate:temperate` base (preserved for back-compat with the default game's
 * weather) + a derived set for every Köppen zone. Pure.
 */
function buildAllTransitionMatrices(): Record<string, Readonly<Record<Season, WeatherTransitionMatrix>>> {
  const out: Record<string, Readonly<Record<Season, WeatherTransitionMatrix>>> = {
    'climate:temperate': BASE_BY_SEASON,
  };
  for (const zone of KOPPEN_ZONES) {
    const id = `climate:${zone.koppenCode.toLowerCase()}`;
    const derived = deriveTransitionMatrices(zone);
    // Fail fast at module load if a derived matrix is malformed (a bias bug
    // that breaks row stochasticity would otherwise produce weird weather).
    for (const s of SEASONS) validateMatrix(derived[s]);
    out[id] = derived;
  }
  return out;
}

/**
 * All transition matrices, indexed by climate id + season.
 *
 * GAP-17 (DR-11) Phase 3: the hand-tuned `climate:temperate` base + a derived
 * set for every Köppen zone (built by `buildAllTransitionMatrices` from the
 * zone's Köppen code + frost/heat risk). Adding a new climate means appending a
 * `ClimateBaseline` to `KOPPEN_ZONES` (the factory derives its matrices); no
 * hand-authored matrix needed.
 */
export const ALL_TRANSITION_MATRICES: Readonly<Record<string, Readonly<Record<Season, WeatherTransitionMatrix>>>> =
  Object.freeze(buildAllTransitionMatrices());

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

// Module-level cache for highland-derived matrices (koppenClass === 'H'). Keyed
// by (climateId, frostRisk, season) — the matrix depends only on the Köppen code
// (preserved from the base by `applyHighlandModifier`), the bumped frostRisk, +
// the season. The cache is deterministic (same inputs → same matrix) + unbounded
// only across (id × frostRisk-tier × season) — a small fixed space.
const highlandMatrixCache = new Map<string, WeatherTransitionMatrix>();

/**
 * GAP-17 (DR-11) Phase 5: look up OR derive the transition matrix for a
 * (possibly highland-modified) climate.
 *
 * - Non-highland climates (koppenClass !== 'H') use the pre-built catalog
 *   (`findTransitionMatrix`) — the hand-tuned temperate base + the derived
 *   Köppen matrices built at module load. Unchanged behaviour.
 * - Highland-modified climates (koppenClass === 'H', produced by
 *   `applyHighlandModifier`) carry a bumped `frostRisk` that isn't in the
 *   pre-built catalog → derive the matrix at runtime via `deriveMatrix` (the
 *   bumped frostRisk adds frost/snow bias in non-summer seasons → MORE
 *   frost/snow events at altitude, not just colder temps) + memoize by
 *   (id, frostRisk, season). This closes the Phase-3 deferred gap where the
 *   matrix stayed per-base-zone at runtime.
 *
 * Pure aside from the cache (deterministic). The caller passes the EFFECTIVE
 * climate (base, or base + `applyHighlandModifier` when elevationM > 0).
 */
export function findOrDeriveTransitionMatrix(
  climate: ClimateBaseline,
  season: Season,
): WeatherTransitionMatrix | undefined {
  if (climate.koppenClass !== 'H') {
    return findTransitionMatrix(climate.id, season);
  }
  const key = `${climate.id}|${climate.frostRisk}|${season}`;
  const cached = highlandMatrixCache.get(key);
  if (cached) return cached;
  const derived = deriveMatrix(climate, season);
  validateMatrix(derived);
  highlandMatrixCache.set(key, derived);
  return derived;
}
