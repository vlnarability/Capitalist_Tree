/**
 * Resource + Weather provisional constants (P2 — TDD §8, §9; GDD §4.3, §4.4).
 *
 * Every value here corresponds to (or stands in for) a resource/weather
 * unresolved design decision in GDD §17. They live in a dedicated file so
 * tuning is localized to one place. The simulation engine imports these via
 * `@capitalist-tree/shared` — never use magic numbers inside the
 * ResourceSystem / WeatherSystem.
 *
 * CONVENTION: `PROVISIONAL_RESOURCE_*` / `PROVISIONAL_WEATHER_*` prefix and a
 * `// PROVISIONAL (GDD §17: <item>)` comment. When a value is promoted from
 * "provisional" to "decided" via playtesting, move it to a sibling `decided.ts`
 * and drop the prefix.
 */

// ---------------------------------------------------------------------------
// WATER MODEL (TDD §8.1, GDD §10.1 — freshwater availability)
// ---------------------------------------------------------------------------

// PROVISIONAL (GDD §17: detailed resource simulation equations)
//
// Soil water capacity in litres per square metre of soil column for the
// starting plot. Acts as the upper bound on `environment.soil.soilWater` —
// excess rainfall becomes runoff rather than pooling indefinitely.
// A typical loam soil holds ~150 L/m² in the top 30 cm.
export const PROVISIONAL_RESOURCE_SOIL_WATER_CAPACITY = 150; // L per m²

// PROVISIONAL (GDD §17: detailed resource simulation equations)
//
// Fraction of soil water that drains to groundwater per simulation day. Sandy
// soils drain faster, clay slower; 0.05/day is a temperate loam approximation.
export const PROVISIONAL_RESOURCE_DRAINAGE_RATE_PER_DAY = 0.05;

// PROVISIONAL (GDD §17: detailed resource simulation equations)
//
// Fraction of soil water lost to evaporation per day at baseline temperature
// and no wind. Scaled by weather condition (sunny / wind / heat wave increase
// it; cloudy / rain decrease it) and temperature.
export const PROVISIONAL_RESOURCE_EVAPORATION_RATE_PER_DAY = 0.02;

// PROVISIONAL (GDD §17: detailed resource simulation equations)
//
// Temperature (°C) used as the baseline for evaporation scaling. Below this,
// evaporation is suppressed (cold air holds less moisture); above this, it
// accelerates roughly linearly.
export const PROVISIONAL_RESOURCE_EVAPORATION_BASE_TEMP_C = 15;

// PROVISIONAL (GDD §17: detailed resource simulation equations)
//
// Maximum fraction of soil water the tree's root system can take up per
// simulation day, expressed as a fraction of the species' daily water
// requirement scaled by `roots.absorptionCapacity`. This caps uptake so a
// small root cannot drain a saturated soil in a single step (Liebig-style
// capacity limit). 1.5 means a full root system can take up to 150% of the
// daily need — headroom for refilling the internal water buffer.
export const PROVISIONAL_RESOURCE_MAX_UPTAKE_FRACTION = 1.5;

// PROVISIONAL (GDD §17: detailed resource simulation equations)
//
// Initial soil water content (L) for the starting plot. Below capacity so a
// fresh rainfall event can be absorbed without immediately running off.
export const PROVISIONAL_RESOURCE_INITIAL_SOIL_WATER = 100; // L

// PROVISIONAL (GDD §17: detailed resource simulation equations)
//
// Initial env.freshwater.availability. The BiologySystem placeholder reads
// this field directly; ResourceSystem keeps it in sync with soil water +
// groundwater so the placeholder's behaviour stays consistent with the real
// water balance. Tuned high enough that a fresh sapling can bootstrap.
export const PROVISIONAL_RESOURCE_INITIAL_FRESHWATER_AVAILABILITY = 1000; // L

// PROVISIONAL (GDD §17: detailed resource simulation equations)
//
// Initial groundwater (L). Recharged by drainage; drawn down only when
// soil water is insufficient (placeholder extension point — not yet wired).
export const PROVISIONAL_RESOURCE_INITIAL_GROUNDWATER = 500; // L

// ---------------------------------------------------------------------------
// NUTRIENT MODEL (TDD §8.2, GDD §10.1 — soil nutrients)
// ---------------------------------------------------------------------------

// PROVISIONAL (GDD §17: detailed resource simulation equations)
//
// Fraction of each soil nutrient that leaches out per simulation day when
// the soil is saturated (soilWater >= capacity). Leaching scales linearly
// down to zero at field capacity (50% of capacity) — dry soils don't leach.
// Over-fertilizing + heavy rain → leaching → contamination of freshwater.
export const PROVISIONAL_RESOURCE_LEACHING_RATE_PER_DAY = 0.10;

// PROVISIONAL (GDD §17: detailed resource simulation equations)
//
// Background daily replenishment of soil nutrients from mineral weathering
// and organic matter decomposition. Small so the soil slowly recovers from
// depletion if left fallow. Units: fraction of capacity per day.
export const PROVISIONAL_RESOURCE_NUTRIENT_REPLENISH_PER_DAY = 0.001;

// PROVISIONAL (GDD §17: detailed resource simulation equations)
//
// Maximum soil nutrient level (per nutrient) before over-application harm
// kicks in. Above this, excess fertilizer converts to contamination instead
// of usable nutrients (GDD §10.3: environmental feedback).
export const PROVISIONAL_RESOURCE_SOIL_NUTRIENT_CAPACITY = 200;

// PROVISIONAL (GDD §17: detailed resource simulation equations)
//
// Contamination added per unit of nutrient applied above the soil nutrient
// capacity. Captures the GDD §8.3 rule that "excessive or inappropriate
// application can damage soil or contaminate surrounding environments".
export const PROVISIONAL_RESOURCE_CONTAMINATION_PER_EXCESS_NUTRIENT = 0.05;

// PROVISIONAL (GDD §17: detailed resource simulation equations)
//
// Initial soil nutrient levels (N, P, K). Matches the P0 default in
// initial-state.ts but kept here as the canonical source so future agents
// don't drift.
export const PROVISIONAL_RESOURCE_INITIAL_SOIL_NUTRIENTS = Object.freeze({
  nitrogen: 50,
  phosphorus: 50,
  potassium: 50,
});

// PROVISIONAL (GDD §17: detailed resource simulation equations)
//
// Initial soil organic matter (arbitrary units). Higher organic matter
// improves soil health derivation (better water retention, microbial
// activity). Decays slowly under intensive cultivation; recovers via
// composting (future action).
export const PROVISIONAL_RESOURCE_INITIAL_ORGANIC_MATTER = 50;

// PROVISIONAL (GDD §17: detailed resource simulation equations)
//
// Rate at which organic matter naturally accumulates per day (e.g., leaf
// litter decomposition). Small so the soil takes a long time to recover
// from depletion — matches GDD §10.3: "Environmental recovery is possible,
// but the time and resources required should depend on the severity".
export const PROVISIONAL_RESOURCE_ORGANIC_MATTER_REPLENISH_PER_DAY = 0.001;

// ---------------------------------------------------------------------------
// SOIL HEALTH DERIVATION (TDD §8.3, GDD §10.1)
// ---------------------------------------------------------------------------

// PROVISIONAL (GDD §17: detailed resource simulation equations)
//
// Weights for the soil health derivation:
//   health = w_organic * organicFrac
//          + w_nutrients * nutrientFrac
//          + w_moisture * moistureFrac
//          + w_contamination * (1 - contaminationFrac)
//          + w_ph * phFrac                  // stub: 1.0 (extension point)
//          + w_compaction * (1 - compactionFrac)  // stub: 1.0
//          + w_microbial * microbialFrac    // stub: 1.0
// Weights sum to 1.0. Stubbed factors contribute their full weight so the
// derived health stays in a sensible range until P6+ extends them.
export const PROVISIONAL_RESOURCE_SOIL_HEALTH_WEIGHTS = Object.freeze({
  organicMatter: 0.25,
  nutrients: 0.30,
  moisture: 0.20,
  contamination: 0.15,
  // Extension-point stubs (TDD §8.3 "Potential variables" — pH, compaction,
  // microbial activity). They contribute full weight (1.0) until P6+.
  ph: 0.10,
  compaction: 0.0, // reserved — schema field exists, weight is 0 until modeled
  microbial: 0.0, // reserved — schema field exists, weight is 0 until modeled
});
export type SoilHealthWeights = typeof PROVISIONAL_RESOURCE_SOIL_HEALTH_WEIGHTS;

// PROVISIONAL (GDD §17: detailed resource simulation equations)
//
// Saturation level for organic matter used in the soil health derivation.
// At or above this value organic matter contributes its full weight to
// health. PROVISIONAL — final tuned against playtesting.
export const PROVISIONAL_RESOURCE_ORGANIC_MATTER_SATURATION = 100;

// PROVISIONAL (GDD §17: detailed resource simulation equations)
//
// Soil water fraction considered "ideal" for the moisture component of soil
// health. Above or below this, moisture contributes less. PROVISIONAL.
export const PROVISIONAL_RESOURCE_IDEAL_SOIL_WATER_FRACTION = 0.5;

// PROVISIONAL (GDD §17: detailed resource simulation equations)
//
// Contamination level at which soil health is fully degraded (health = 0
// from contamination alone). Above this the contamination factor is also 0.
export const PROVISIONAL_RESOURCE_CONTAMINATION_FULL_DEGRADE = 100;

// ---------------------------------------------------------------------------
// WEATHER MODEL (TDD §9.1, GDD §4.3)
// ---------------------------------------------------------------------------

// PROVISIONAL (GDD §17: detailed climate model)
//
// Default climate baseline id. P2 ships a single temperate baseline
// (`climate:temperate`); future phases (P6/P9) add regional climate data.
// The baseline is data — lives in `packages/content/src/weather/`.
export const PROVISIONAL_WEATHER_DEFAULT_CLIMATE_ID = 'climate:temperate';

// PROVISIONAL (GDD §17: detailed climate model)
//
// Default starting weather condition. Used when no previous weather is on
// the state (fresh game). Picked `sunny` so day-0 photosynthesis is at
// baseline (not artificially inflated by rain or suppressed by clouds).
export const PROVISIONAL_WEATHER_INITIAL_CONDITION = 'sunny' as const;

// PROVISIONAL (GDD §17: detailed climate model)
//
// Default starting weather intensity. Picked mid-range so the first tick has
// room to draw higher or lower intensities.
export const PROVISIONAL_WEATHER_INITIAL_INTENSITY = 0.5;

// PROVISIONAL (GDD §17: detailed climate model)
//
// Maximum number of consecutive days a weather condition can persist before
// the Markov chain forcibly re-rolls. Prevents the tree getting stuck under
// a multi-week drought or severe storm. Soft cap — actual transitions still
// depend on the per-season matrix; this only biases the roll when exceeded.
export const PROVISIONAL_WEATHER_MAX_DAYS_IN_CONDITION = 14;

// PROVISIONAL (GDD §17: detailed climate model)
//
// Additional bias (probability points) applied to the "transition away"
// column once `daysInCondition` exceeds the soft cap. The matrix entry for
// leaving the current condition is increased by this fraction of the
// remaining probability mass.
export const PROVISIONAL_WEATHER_STALENESS_BIAS = 0.3;

// PROVISIONAL (GDD §17: detailed climate model)
//
// Hook for future global-temperature-driven climate shifts (TDD §9.2). When
// P6's EnvironmentSystem raises `environment.globalTemperature` above this
// baseline, the WeatherSystem will shift the climate baseline (e.g., more
// heat waves, fewer frost days). P2 leaves the hook in place — the actual
// shift is a no-op until P6 plumbs a real globalTemperature trajectory.
export const PROVISIONAL_WEATHER_CLIMATE_SHIFT_BASELINE_TEMP_C = 14; // global avg

// PROVISIONAL (GDD §17: detailed climate model)
//
// Per-condition base temperature deltas (°C) relative to the climate
// baseline temperature. Applied each tick to derive the local temperature
// from the long-term baseline. Positive = warmer than baseline, negative =
// cooler. Intensity-modulated (a high-intensity heat wave is hotter than a
// weak one).
export const PROVISIONAL_WEATHER_TEMP_DELTAS_C: Readonly<Record<string, number>> =
  Object.freeze({
    sunny: 4,
    cloudy: 0,
    rain: -2,
    'heavy-rain': -3,
    drought: 6,
    frost: -10,
    'heat-wave': 12,
    wind: -1,
    'severe-storm': -4,
  });

// PROVISIONAL (GDD §17: detailed climate model)
//
// Rainfall amount (L/day) per weather condition at full intensity. Scaled
// by `weather.intensity` per tick. Sunny/cloudy/wind produce no rainfall;
// rain and heavy-rain are the main inputs. Severe storms dump the most.
export const PROVISIONAL_WEATHER_RAINFALL_L_PER_DAY: Readonly<Record<string, number>> =
  Object.freeze({
    sunny: 0,
    cloudy: 0,
    rain: 6,
    'heavy-rain': 20,
    drought: 0,
    frost: 0,
    'heat-wave': 0,
    wind: 0,
    'severe-storm': 30,
  });

// PROVISIONAL (GDD §17: detailed climate model)
//
// Evaporation multiplier per weather condition. The base evaporation rate
// (PROVISIONAL_RESOURCE_EVAPORATION_RATE_PER_DAY) is multiplied by this and
// by a temperature factor. Drought / heat wave / wind / sunny increase it;
// cloudy / rain decrease it.
export const PROVISIONAL_WEATHER_EVAPORATION_MULT: Readonly<Record<string, number>> =
  Object.freeze({
    sunny: 1.5,
    cloudy: 0.5,
    rain: 0.3,
    'heavy-rain': 0.2,
    drought: 2.5,
    frost: 0.1,
    'heat-wave': 3.0,
    wind: 2.0,
    'severe-storm': 0.5,
  });

// PROVISIONAL (GDD §17: detailed climate model)
//
// Light factor multiplier per weather condition. Applied to the
// BiologySystem's `lightFactor` via `environment.globalTemperature` only
// indirectly (P1 will read `weather.condition` directly in a future
// refactor — see R-P2-1). For now this is exposed for P3/P4 consumers and
// the resource module's evaporation math.
export const PROVISIONAL_WEATHER_LIGHT_FACTOR_MULT: Readonly<Record<string, number>> =
  Object.freeze({
    sunny: 1.0,
    cloudy: 0.6,
    rain: 0.4,
    'heavy-rain': 0.25,
    drought: 1.0, // droughts are sunny but dry
    frost: 0.7,
    'heat-wave': 1.0,
    wind: 0.8,
    'severe-storm': 0.1,
  });

// PROVISIONAL (GDD §17: detailed climate model)
//
// Probability threshold (per step) at which a damage-capable weather
// condition emits a `weather-damage` event. Frost/heat-wave/severe-storm
// only damage when their intensity exceeds this threshold. P2 emits the
// event; P1 (or a future refactor) records the damage entry on
// `tree.damage[]` (see R-P2-2 in docs/resources-weather.md).
export const PROVISIONAL_WEATHER_DAMAGE_INTENSITY_THRESHOLD = 0.6;

// PROVISIONAL (GDD §17: detailed climate model)
//
// Damage severity scaling factor. The emitted damage event's `severity` is
// `intensity * PROVISIONAL_WEATHER_DAMAGE_SEVERITY_SCALE` (clamped to [0, 1]).
// Future tuning can differentiate per condition (storm damages structure,
// frost damages foliage, etc.).
export const PROVISIONAL_WEATHER_DAMAGE_SEVERITY_SCALE = 0.5;
