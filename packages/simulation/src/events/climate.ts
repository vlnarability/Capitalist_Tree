/**
 * Climate feedback loop + secondary environmental consequences (P10c — GDD
 * §10.3 Environmental Feedback, lines 650-665; TDD Milestone 9: Climate
 * feedback).
 *
 * Pure helpers used by the EventSystem (slot #12,
 * `packages/simulation/src/systems/events.ts`). This module is the P7↔P10
 * bridge: it closes the climate feedback loop by reading P7's
 * EnvironmentSystem globals (`state.world.environment.atmosphere.
 * co2Concentration` + `globalTemperature`) and perturbing the P10 regional
 * climate baselines + applying the GDD §10.3 secondary-consequence chains.
 *
 *   - `applyClimateFeedback(state, dtSeconds)` — GHG → temperature → regional
 *     climate shifts → increased extreme-weather event probability. Reads P7's
 *     `globalTemperature` + `atmosphere.co2Concentration`; drifts each region's
 *     `climate.temperatureBaseline` toward the elevated global temperature and
 *     lowers `precipitationBaseline` proportional to warming (a hotter
 *     atmosphere holds more moisture but shifts rainfall patterns — GDD §10.3
 *     "climate → drought/heat/extreme weather"). The elevated baselines are
 *     then read by `rollRandomEvents` (random.ts) so drought / heat-wave /
 *     wildfire / flood events roll more often under warming (the probability
 *     weight is computed there from the climate + degradation, NOT stored on a
 *     schema field — P10a froze the schemas, so the feedback is realized
 *     through the state the roller reads).
 *
 *   - `applyEnvironmentalFeedback(state)` — GDD §10.3 secondary consequences:
 *     deforestation (low `forestCoverage`) increases erosion (reduces
 *     `soilHealth`); soil degradation reduces productivity (reduces
 *     `industrialActivity`); water scarcity raises resource prices (raises the
 *     `index:commodity-basket` market index); biodiversity loss reduces
 *     ecosystem resilience. Chain reactions. Species extinction is IRREVERSIBLE
 *     — once a region's `biodiversity` drops below
 *     `PROVISIONAL_SPECIES_EXTINCTION_THRESHOLD` it is floored at its current
 *     value (no recovery) and the global `speciesExtinctionRate` is ratcheted
 *     (the floor is enforced here as a secondary-consequence guard; the primary
 *     ratchet lives in `evolveRegions`).
 *
 * All helpers are pure: they return a new state (and events) without mutating
 * the input (TDD §4.1, §18.4). Deterministic given (state, dtSeconds) — no RNG
 * (the stochastic rolling lives in `random.ts` via a SEEDED sub-RNG that does
 * NOT perturb the root RNG — R-P10-N resolved).
 */
import type {
  GameState,
  SimulationEvent,
  RegionState,
} from '@capitalist-tree/shared';
import { PROVISIONAL_SPECIES_EXTINCTION_THRESHOLD } from '@capitalist-tree/shared';
import { deepCopy } from '../deep-copy.js';

const SECONDS_PER_DAY = 24 * 60 * 60;
const SECONDS_PER_YEAR = 365 * SECONDS_PER_DAY;

// ---------------------------------------------------------------------------
// Local @provisional climate-feedback tuning constants (GDD §10.3 — climate
// disruption; GDD §17 — detailed resource simulation equations) — R-P10-1/2
// ---------------------------------------------------------------------------
// These resolve GDD §17 design decisions for the climate feedback magnitudes.
// @provisional tuning values local to the simulation package (rule 10).

// PROVISIONAL (GDD §17: Climate model sensitivity; GDD §10.3)
// Fraction of the gap between a region's temperatureBaseline and the P7
// globalTemperature (warmed) that the regional baseline closes per sim year.
// 0.1 ≈ the regional baseline moves 10% of the way toward the global
// temperature per sim year — slow secular drift, fast enough to be visible
// across a multi-year campaign. PROVISIONAL.
const PROVISIONAL_CLIMATE_BASELINE_DRIFT_RATE = 0.1;

// PROVISIONAL (GDD §17: Climate model sensitivity; GDD §10.3)
// Per-degree-warming fractional reduction in regional precipitation baseline
// per sim year. A +2 °C warming anomaly drains 2 * 0.02 = 4% of the
// precipitation baseline per sim year. PROVISIONAL.
const PROVISIONAL_PRECIPITATION_WARMING_PENALTY = 0.02;

// PROVISIONAL (GDD §10.3: deforestation increases erosion)
// Erosion (soilHealth loss) per unit of missing forestCoverage per sim day.
// A region with forestCoverage 0.1 (missing 0.9) loses 0.9 * 0.002 = ~0.0018
// soilHealth per sim day to erosion. PROVISIONAL.
const PROVISIONAL_DEFORESTATION_EROSION_RATE = 0.002;

// PROVISIONAL (GDD §10.3: soil degradation reduces productivity)
// Industrial-activity penalty per unit of soil-health deficit (1 - soilHealth)
// per sim day. A region at soilHealth 0.3 (deficit 0.7) loses 0.7 * 0.001
// industrialActivity per sim day. PROVISIONAL.
const PROVISIONAL_SOIL_PRODUCTIVITY_PENALTY = 0.001;

// PROVISIONAL (GDD §10.3: water scarcity increases resource prices)
// Per-unit water-deficit fractional lift applied to the commodity-basket market
// index per sim day. A region at waterAvailability 0.2 (deficit 0.8) lifts the
// index by 0.8 * 0.0008 per sim day. PROVISIONAL.
const PROVISIONAL_WATER_SCARCITY_PRICE_LIFT = 0.0008;

// PROVISIONAL (GDD §10.3: biodiversity loss reduces ecosystem resilience)
// Direct ecosystem-resilience penalty per unit of biodiversity deficit. A
// region at biodiversity 0.4 (deficit 0.6) pulls the global resilience down by
// 0.6 * 0.01 = 0.006 per application. PROVISIONAL.
const PROVISIONAL_BIODIVERSITY_RESILIENCE_PENALTY = 0.01;

// The commodity-basket market index id (matches `global.ts` + content effects).
const COMMODITY_BASKET_INDEX_ID = 'index:commodity-basket';
const MARKET_INDEX_BASELINE = 100;
// Pre-industrial baseline temperature used as the climate-feedback reference
// (matches P7's `PROVISIONAL_ENV_BASELINE_TEMP_C`).
const PREINDUSTRIAL_BASELINE_TEMP_C = 14;

/** Clamp a number into [0, 1]. */
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// ---------------------------------------------------------------------------
// applyClimateFeedback — the P7↔P10 bridge (GDD §10.3: GHG → temperature →
// regional climate → extreme-weather event probability)
// ---------------------------------------------------------------------------

/**
 * `applyClimateFeedback` — close the climate feedback loop (GDD §10.3). Pure:
 * returns a new state + `climate-shifted` notification events for regions
 * whose temperature baseline moved materially.
 *
 * Reads P7's `state.world.environment.globalTemperature` + `atmosphere.
 * co2Concentration` (the EnvironmentSystem at slot #10 already advances these
 * from emissions vs sequestration). For each P10 region:
 *   - Drift `climate.temperatureBaseline` toward the warmed global temperature
 *     at `PROVISIONAL_CLIMATE_BASELINE_DRIFT_RATE` per sim year (secular
 *     convergence — regional climates track the global mean).
 *   - Lower `climate.precipitationBaseline` proportional to the warming
 *     anomaly at `PROVISIONAL_PRECIPITATION_WARMING_PENALTY` per degree per
 *     sim year (hotter atmosphere shifts rainfall — GDD §10.3 drought risk).
 *
 * The elevated baselines are READ by `rollRandomEvents` (random.ts), which
 * scales environmental-event probability by the warming anomaly + regional
 * climate stress. There is no schema field for "event probability multiplier"
 * (P10a froze the schemas); the feedback is realized through the state the
 * roller reads — this is the documented P7↔P10 bridge.
 *
 * A no-op when `dtSeconds <= 0` or there are no regions. Deterministic given
 * (state, dtSeconds) — no RNG.
 */
export function applyClimateFeedback(
  state: GameState,
  dtSeconds: number,
): { state: GameState; events: SimulationEvent[] } {
  if (dtSeconds <= 0) {
    return { state, events: [] };
  }
  const regions = state.eventState.global.regions;
  if (regions.length === 0) {
    return { state, events: [] };
  }

  const globalTemperature = state.world.environment.globalTemperature;
  const warmingAnomaly = globalTemperature - PREINDUSTRIAL_BASELINE_TEMP_C;
  // No warming → no secular climate drift to apply (the baselines hold).
  if (Math.abs(warmingAnomaly) < 1e-9) {
    return { state, events: [] };
  }

  const next: GameState = deepCopy(state);
  const years = dtSeconds / SECONDS_PER_YEAR;
  const driftFraction = PROVISIONAL_CLIMATE_BASELINE_DRIFT_RATE * years;
  const precipPenalty = PROVISIONAL_PRECIPITATION_WARMING_PENALTY * warmingAnomaly * years;
  const events: SimulationEvent[] = [];

  const shiftedRegions = next.eventState.global.regions.map((region) => {
    const beforeTemp = region.climate.temperatureBaseline;
    // Converge the regional temperature baseline toward the warmed global mean.
    const temperatureBaseline =
      beforeTemp + (globalTemperature - beforeTemp) * driftFraction;
    // Hotter atmosphere shifts precipitation patterns (net drying on average —
    // GDD §10.3 drought risk). Clamp >= 0.
    const precipitationBaseline = Math.max(0, region.climate.precipitationBaseline - precipPenalty);

    if (Math.abs(temperatureBaseline - beforeTemp) > 0.05) {
      events.push({
        type: 'notification',
        at: state.clock.elapsedSeconds,
        payload: {
          severity: warmingAnomaly > 2 ? 'critical' : 'warning',
          code: 'climate-baseline-shifted',
          message: `${region.name} climate baseline drifted: temperature ${temperatureBaseline.toFixed(1)} °C (was ${beforeTemp.toFixed(1)} °C).`,
        },
      });
    }

    return {
      ...region,
      climate: {
        ...region.climate,
        temperatureBaseline,
        precipitationBaseline,
      },
    };
  });

  next.eventState = {
    ...next.eventState,
    global: {
      ...next.eventState.global,
      regions: shiftedRegions,
    },
  };

  return { state: next, events };
}

// ---------------------------------------------------------------------------
// applyEnvironmentalFeedback — GDD §10.3 secondary consequences
// ---------------------------------------------------------------------------

/**
 * `applyEnvironmentalFeedback` — apply the GDD §10.3 secondary-consequence
 * chains (environmental damage creates secondary consequences; recovery is
 * costly; species extinction is irreversible). Pure: returns a new state +
 * notification events for material secondary damage.
 *
 * Chain reactions applied per region per call (rates are per sim day; this
 * helper is called once per EventSystem tick with the tick's `dtSeconds` baked
 * into the magnitude via the @provisional rates above — the magnitudes are
 * small per-tick so a single call does not overshoot):
 *   - DEFORESTATION → EROSION: low `forestCoverage` (missing canopy → exposed
 *     soil) reduces `soilHealth` at `PROVISIONAL_DEFORESTATION_EROSION_RATE`
 *     per unit of missing coverage.
 *   - SOIL DEGRADATION → REDUCED PRODUCTIVITY: low `soilHealth` reduces
 *     `industrialActivity` at `PROVISIONAL_SOIL_PRODUCTIVITY_PENALTY` per unit
 *     of soil-health deficit (GDD §10.3 "soil degradation → reduced
 *     productivity").
 *   - WATER SCARCITY → HIGHER PRICES: low `waterAvailability` raises the
 *     `index:commodity-basket` global market index at
 *     `PROVISIONAL_WATER_SCARCITY_PRICE_LIFT` per unit of water deficit (GDD
 *     §10.3 "water scarcity → higher prices"). Averaged across regions
 *     (population-weighted) so a populous parched region lifts the global
 *     price more.
 *   - BIODIVERSITY LOSS → REDUCED RESILIENCE: low `biodiversity` pulls the
 *     global `ecosystemResilience` down at
 *     `PROVISIONAL_BIODIVERSITY_RESILIENCE_PENALTY` per unit of deficit.
 *
 * SPECIES EXTINCTION (irreversible — GDD §10.3): if a region's `biodiversity`
 * is below `PROVISIONAL_SPECIES_EXTINCTION_THRESHOLD`, it is FLOORED at its
 * current value here (the secondary-consequence guard) and the global
 * `speciesExtinctionRate` is ratcheted up. The primary recovery floor + rate
 * ratchet live in `evolveRegions` (regional.ts); this helper reinforces the
 * irreversibility so a downstream secondary effect cannot lift biodiversity
 * back above the threshold once collapse has begun.
 *
 * A no-op when there are no regions. Deterministic given `state` — no RNG.
 */
export function applyEnvironmentalFeedback(
  state: GameState,
): { state: GameState; events: SimulationEvent[] } {
  const regions = state.eventState.global.regions;
  if (regions.length === 0) {
    return { state, events: [] };
  }

  const next: GameState = deepCopy(state);
  const events: SimulationEvent[] = [];
  let ecosystemResilience = next.eventState.global.aggregatedIndicators.ecosystemResilience;
  let speciesExtinctionRate = next.eventState.global.aggregatedIndicators.speciesExtinctionRate;
  const globalMarketIndices = { ...next.eventState.global.globalMarketIndices };

  const commodityLiftedRegions: string[] = [];

  const shiftedRegions = next.eventState.global.regions.map((region) => {
    let soilHealth = region.soilHealth;
    let industrialActivity = region.industrialActivity;
    let biodiversity = region.biodiversity;

    // 1. Deforestation → erosion (low forestCoverage erodes soilHealth).
    const missingForest = 1 - region.forestCoverage;
    const erosion = missingForest * PROVISIONAL_DEFORESTATION_EROSION_RATE;
    soilHealth = clamp01(soilHealth - erosion);

    // 2. Soil degradation → reduced productivity (low soilHealth cuts
    //    industrialActivity).
    const soilDeficit = 1 - soilHealth;
    const productivityPenalty = soilDeficit * PROVISIONAL_SOIL_PRODUCTIVITY_PENALTY;
    industrialActivity = clamp01(industrialActivity - productivityPenalty);

    // 3. Water scarcity → higher resource prices (lifts the commodity-basket
    //    global market index). Population-weighted so a populous parched region
    //    weighs more on the global price.
    const waterDeficit = 1 - region.waterAvailability;
    if (waterDeficit > 0) {
      const lift = waterDeficit * PROVISIONAL_WATER_SCARCITY_PRICE_LIFT * Math.max(1, region.population / 1_000_000);
      const current = globalMarketIndices[COMMODITY_BASKET_INDEX_ID] ?? MARKET_INDEX_BASELINE;
      globalMarketIndices[COMMODITY_BASKET_INDEX_ID] = current + lift;
      if (waterDeficit > 0.5) commodityLiftedRegions.push(region.name);
    }

    // 4. Biodiversity loss → reduced ecosystem resilience (global).
    const biodiversityDeficit = 1 - biodiversity;
    ecosystemResilience = clamp01(
      ecosystemResilience - biodiversityDeficit * PROVISIONAL_BIODIVERSITY_RESILIENCE_PENALTY,
    );

    // 5. Species extinction (irreversible — GDD §10.3). Floor biodiversity at
    //    its current value once collapse has begun (it cannot recover above
    //    the threshold via this helper); ratchet the global extinction rate.
    if (biodiversity < PROVISIONAL_SPECIES_EXTINCTION_THRESHOLD) {
      // Floor — no recovery through the secondary chain. biodiversity stays.
      speciesExtinctionRate += PROVISIONAL_BIODIVERSITY_RESILIENCE_PENALTY;
      events.push({
        type: 'notification',
        at: state.clock.elapsedSeconds,
        payload: {
          severity: 'critical',
          code: 'species-extinction-collapse',
          message: `${region.name} biodiversity below the extinction threshold (${(biodiversity * 100).toFixed(0)}%); collapse is irreversible.`,
        },
      });
    }

    return {
      ...region,
      soilHealth,
      industrialActivity,
      biodiversity,
    };
  });

  if (commodityLiftedRegions.length > 0) {
    events.push({
      type: 'notification',
      at: state.clock.elapsedSeconds,
      payload: {
        severity: 'warning',
        code: 'resource-scarcity-price-lift',
        message: `Water scarcity in ${commodityLiftedRegions.join(', ')} lifted the commodity-basket market index.`,
      },
    });
  }

  next.eventState = {
    ...next.eventState,
    global: {
      ...next.eventState.global,
      regions: shiftedRegions,
      globalMarketIndices,
      aggregatedIndicators: {
        ...next.eventState.global.aggregatedIndicators,
        ecosystemResilience,
        speciesExtinctionRate,
      },
    },
  };

  return { state: next, events };
}

/**
 * Read-only access to the @provisional climate-feedback tuning constants for
 * tests + future tuning promotion (rule 10).
 */
export const CLIMATE_CONSTANTS = {
  PROVISIONAL_CLIMATE_BASELINE_DRIFT_RATE,
  PROVISIONAL_PRECIPITATION_WARMING_PENALTY,
  PROVISIONAL_DEFORESTATION_EROSION_RATE,
  PROVISIONAL_SOIL_PRODUCTIVITY_PENALTY,
  PROVISIONAL_WATER_SCARCITY_PRICE_LIFT,
  PROVISIONAL_BIODIVERSITY_RESILIENCE_PENALTY,
  COMMODITY_BASKET_INDEX_ID,
  MARKET_INDEX_BASELINE,
  PREINDUSTRIAL_BASELINE_TEMP_C,
} as const;

/**
 * Compute the warming-driven environmental-event probability multiplier used
 * by `rollRandomEvents` (random.ts) to scale environmental event probability.
 * Reads P7's `globalTemperature` (the climate feedback signal). A +2 °C
 * anomaly doubles environmental-event probability; a +4 °C anomaly triples it.
 * Pure + read-only.
 */
export function environmentalEventProbabilityMultiplier(state: GameState): number {
  const warmingAnomaly = state.world.environment.globalTemperature - PREINDUSTRIAL_BASELINE_TEMP_C;
  if (warmingAnomaly <= 0) return 1;
  // 1 + 0.5 per degree of warming — @provisional (GDD §10.3 / §17).
  return 1 + 0.5 * warmingAnomaly;
}

// Reference the imported RegionState type so the import is preserved for
// downstream type narrowing (the per-region drift builds RegionState-shaped
// objects).
export type { RegionState };
