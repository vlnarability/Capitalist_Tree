/**
 * Regional environment evolution + global aggregation (P10b — TDD §6.4 Event
 * Scheduling, TDD line 200 EventSystem; GDD §10.2 Regional Environments,
 * §10.1 Global Indicators, §10.3 Environmental Feedback).
 *
 * Pure helpers used by the EventSystem (slot #12,
 * `packages/simulation/src/systems/events.ts`):
 *
 *   - `seedDefaultRegions(state)` — populate `eventState.global.regions`
 *     with a small @provisional set of representative biomes on the first
 *     EventSystem tick (the v13 migration leaves `regions` empty; the
 *     EventSystem seeds it — `packages/simulation/src/initial-state.ts`
 *     documents this). Idempotent — a non-empty `regions` list is preserved.
 *   - `evolveRegions(state, dtSeconds)` — each region's indicators drift
 *     over time: pollution accumulates from `industrialActivity` and decays
 *     naturally; `soilHealth` / `waterAvailability` / `biodiversity` /
 *     `forestCoverage` recover toward baseline at
 *     `PROVISIONAL_EVENT_RECOVERY_RATE` minus pollution-driven stress
 *     (GDD §10.3 — recovery is possible but costly). Regions whose
 *     biodiversity drops below `PROVISIONAL_SPECIES_EXTINCTION_THRESHOLD`
 *     lose biodiversity irreversibly and ratchet the global
 *     `speciesExtinctionRate` up permanently (GDD §10.3 — species extinction
 *     is irreversible). Emits `regional-condition-shifted` when an indicator
 *     crosses a threshold (GDD §10.2 — a collapsing local ecosystem must be
 *     visible).
 *   - `aggregateGlobalIndicators(state)` — compute the global
 *     `aggregatedIndicators` averages from regional conditions, weighted by
 *     `PROVISIONAL_REGIONAL_AGGREGATION_WEIGHTS` (`'population'` weights each
 *     region by its `population`; `'area'` falls back to equal weighting —
 *     RegionState has no `area` field). Tracks the MIN regional values
 *     alongside the averages so a healthy global average cannot conceal a
 *     collapsing local ecosystem (GDD §10.2). Preserves
 *     `atmosphericCarbon` / `globalTemperature` (P7 EnvironmentSystem /
 *     P10c climate-feedback domain) and `speciesExtinctionRate` (irreversible
 *     accumulator updated by `evolveRegions`).
 *
 * All helpers are pure: they return a new state (and events) without mutating
 * the input (TDD §4.1, §18.4). Deterministic given (state, params) (TDD
 * §18.3) — no RNG (the EventSystem RNG fork is DEFERRED as R-P10-N).
 */
import type {
  GameState,
  SimulationEvent,
  RegionState,
  GlobalAggregatedIndicators,
} from '@capitalist-tree/shared';
import {
  PROVISIONAL_EVENT_RECOVERY_RATE,
  PROVISIONAL_REGIONAL_AGGREGATION_WEIGHTS,
  PROVISIONAL_SPECIES_EXTINCTION_THRESHOLD,
} from '@capitalist-tree/shared';

const SECONDS_PER_DAY = 24 * 60 * 60;

// ---------------------------------------------------------------------------
// Local @provisional tuning constants (GDD §17 — regional granularity +
// environmental recovery timescales) — R-P10-1
// ---------------------------------------------------------------------------
// These resolve GDD §17 design decisions for the regional drift model. P10a
// stamped the cadence / threshold / recovery constants in
// `packages/shared/src/constants/events.ts`; the drift *rates* below are
// @provisional tuning values local to the simulation package (rule 10). They
// are pure data — promote them to packages/shared once playtesting settles.

// PROVISIONAL (GDD §17: Regional simulation granularity)
// Pollution load accumulated per unit of `industrialActivity` per sim day,
// split across air (full), water (half), soil (third). A region with
// industrialActivity 0.5 accumulates ~5 air-pollution load per sim day.
// PROVISIONAL — final rate depends on playtesting how fast pollution builds.
const PROVISIONAL_EVENT_POLLUTION_RATE = 10;

// PROVISIONAL (GDD §17: Environmental recovery timescales)
// Fraction of each pollution medium that decays naturally per sim day (the
// environment's own assimilation capacity). 0.05 ≈ 5% per day, so pollution
// reaches equilibrium when accumulation equals decay. PROVISIONAL.
const PROVISIONAL_EVENT_POLLUTION_DECAY_RATE = 0.05;

// PROVISIONAL (GDD §17: Environmental recovery timescales)
// Total pollution load (air + water + soil) at which ecosystem stress ≈ 1 per
// sim day (i.e. a region with this much pollution loses ~1 full point of
// soilHealth per day absent recovery). Scales the pollution→stress mapping.
// PROVISIONAL.
const PROVISIONAL_EVENT_POLLUTION_STRESS_SCALE = 200;

// PROVISIONAL (GDD §17: Environmental recovery timescales)
// Species-extinction-rate increment per sim day a region spends below
// `PROVISIONAL_SPECIES_EXTINCTION_THRESHOLD` (GDD §10.3 — irreversible). 0.01
// ≈ one full unit of extinction rate per 100 sim days in collapse.
// PROVISIONAL.
const PROVISIONAL_EVENT_EXTINCTION_RATE = 0.01;

// ---------------------------------------------------------------------------
// Thresholds for `regional-condition-shifted` emission (GDD §10.2)
// ---------------------------------------------------------------------------
// A regional indicator crossing one of these values emits a
// `regional-condition-shifted` event so the UI / audit layer can surface a
// collapsing local ecosystem even when the global average is healthy. The
// biodiversity list also includes the extinction threshold. @provisional.
const REGIONAL_THRESHOLDS: ReadonlyArray<number> = [0.2, 0.3, 0.5, 0.7];

/** Clamp a number into [0, 1]. */
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** True if `before` and `after` are on opposite sides of `threshold`. */
function crossedThreshold(before: number, after: number, threshold: number): boolean {
  return (before - threshold) * (after - threshold) < 0 || after === threshold;
}

/**
 * The indicator fields tracked for threshold crossings (the 0-1 regional
 * fields — `industrialActivity` is also 0-1 but its crossings are policy
 * signals, surfaced by `updateGovernmentPolicy` instead).
 */
type ThresholdField =
  | 'soilHealth'
  | 'waterAvailability'
  | 'biodiversity'
  | 'forestCoverage';

/**
 * Build `regional-condition-shifted` events for every threshold a region's
 * indicators crossed between `before` and `after`. Biodiversity additionally
 * checks the `PROVISIONAL_SPECIES_EXTINCTION_THRESHOLD`. Emits at `now`.
 */
function thresholdCrossingEvents(
  regionId: string,
  before: RegionState,
  after: RegionState,
  now: number,
): SimulationEvent[] {
  const events: SimulationEvent[] = [];
  const fields: ThresholdField[] = [
    'soilHealth',
    'waterAvailability',
    'biodiversity',
    'forestCoverage',
  ];
  for (const field of fields) {
    const b = before[field];
    const a = after[field];
    const thresholds =
      field === 'biodiversity'
        ? [...REGIONAL_THRESHOLDS, PROVISIONAL_SPECIES_EXTINCTION_THRESHOLD]
        : REGIONAL_THRESHOLDS;
    for (const t of thresholds) {
      if (crossedThreshold(b, a, t)) {
        events.push({
          type: 'regional-condition-shifted',
          at: now,
          payload: {
            regionId,
            field,
            previousValue: b,
            currentValue: a,
            region: after,
          },
        });
      }
    }
  }
  return events;
}

// ---------------------------------------------------------------------------
// Default regional seeding (first EventSystem tick)
// ---------------------------------------------------------------------------

/**
 * @provisional default regions seeded on the first EventSystem tick when
 * `eventState.global.regions` is empty (GDD §10.2 — regions have their own
 * climate / soil / water / biodiversity / forest / industry / pollution /
 * vulnerabilities). Four representative biomes spanning the climate + industry
 * + vulnerability space so the regional drift + aggregation have meaningful
 * input from tick one. P10c may replace this with a content registry of
 * regions (mirroring the businesses / fertilizers / weather content pattern);
 * until then these @provisional defaults live here (rule 10).
 *
 * Populations size the `'population'` aggregation weighting
 * (`PROVISIONAL_REGIONAL_AGGREGATION_WEIGHTS`).
 */
const DEFAULT_REGIONS: readonly RegionState[] = [
  {
    id: 'region:temperate-lowlands',
    name: 'Temperate Lowlands',
    climate: { temperatureBaseline: 12, precipitationBaseline: 0.6, humidityBaseline: 0.6 },
    soilHealth: 0.7,
    waterAvailability: 0.7,
    biodiversity: 0.7,
    forestCoverage: 0.4,
    industrialActivity: 0.5,
    pollution: { air: 10, water: 5, soil: 3 },
    vulnerabilities: ['flood-risk'],
    population: 10_000_000,
  },
  {
    id: 'region:tropical-rainforest',
    name: 'Tropical Rainforest',
    climate: { temperatureBaseline: 26, precipitationBaseline: 0.9, humidityBaseline: 0.8 },
    soilHealth: 0.6,
    waterAvailability: 0.8,
    biodiversity: 0.9,
    forestCoverage: 0.8,
    industrialActivity: 0.3,
    pollution: { air: 5, water: 4, soil: 2 },
    vulnerabilities: ['biodiversity-fragile', 'flood-risk'],
    population: 5_000_000,
  },
  {
    id: 'region:arid-highlands',
    name: 'Arid Highlands',
    climate: { temperatureBaseline: 18, precipitationBaseline: 0.2, humidityBaseline: 0.3 },
    soilHealth: 0.4,
    waterAvailability: 0.3,
    biodiversity: 0.3,
    forestCoverage: 0.1,
    industrialActivity: 0.4,
    pollution: { air: 8, water: 3, soil: 2 },
    vulnerabilities: ['drought-prone'],
    population: 3_000_000,
  },
  {
    id: 'region:boreal-taiga',
    name: 'Boreal Taiga',
    climate: { temperatureBaseline: 2, precipitationBaseline: 0.4, humidityBaseline: 0.5 },
    soilHealth: 0.5,
    waterAvailability: 0.5,
    biodiversity: 0.6,
    forestCoverage: 0.7,
    industrialActivity: 0.2,
    pollution: { air: 4, water: 2, soil: 1 },
    vulnerabilities: ['biodiversity-fragile'],
    population: 2_000_000,
  },
];

/**
 * Seed `eventState.global.regions` with the @provisional default biomes when
 * empty (first EventSystem tick). Idempotent — a non-empty `regions` list is
 * preserved verbatim. Pure: returns a new state.
 */
export function seedDefaultRegions(state: GameState): GameState {
  if (state.eventState.global.regions.length > 0) {
    return state;
  }
  return {
    ...state,
    eventState: {
      ...state.eventState,
      global: {
        ...state.eventState.global,
        regions: DEFAULT_REGIONS.map((r) => ({ ...r, climate: { ...r.climate }, pollution: { ...r.pollution } })),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// evolveRegions — per-tick regional drift (GDD §10.3)
// ---------------------------------------------------------------------------

/**
 * Evolve each region's environmental indicators over `dtSeconds` (GDD §10.3 —
 * environmental damage creates secondary consequences; recovery is costly;
 * species extinction is irreversible). Pure: returns a new state +
 * `regional-condition-shifted` events for threshold crossings.
 *
 * Drift model (@provisional — GDD §17):
 *   - Pollution accumulates from `industrialActivity` (`PROVISIONAL_EVENT_
 *     POLLUTION_RATE` per day, split air/water/soil) and decays naturally
 *     (`PROVISIONAL_EVENT_POLLUTION_DECAY_RATE` per day — the environment's
 *     assimilation capacity).
 *   - `soilHealth` / `waterAvailability` / `forestCoverage` recover toward
 *     baseline at `PROVISIONAL_EVENT_RECOVERY_RATE` per day, minus
 *     pollution-driven stress (total pollution / `PROVISIONAL_EVENT_
 *     POLLUTION_STRESS_SCALE`).
 *   - `biodiversity` recovers the same way ABOVE
 *     `PROVISIONAL_SPECIES_EXTINCTION_THRESHOLD`; BELOW the threshold it does
 *     NOT recover (irreversible collapse — GDD §10.3) and the global
 *     `speciesExtinctionRate` ratchets up by `PROVISIONAL_EVENT_EXTINCTION_
 *     RATE` per day.
 *
 * A no-op when `dtSeconds <= 0` or `regions` is empty. Deterministic given
 * (state, dtSeconds) — no RNG (R-P10-N).
 */
export function evolveRegions(
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

  const days = dtSeconds / SECONDS_PER_DAY;
  const events: SimulationEvent[] = [];
  let speciesExtinctionRate = state.eventState.global.aggregatedIndicators.speciesExtinctionRate;

  const evolvedRegions = regions.map((region) => {
    const before = region;

    // Pollution accumulation + natural decay.
    const accumulation = region.industrialActivity * PROVISIONAL_EVENT_POLLUTION_RATE * days;
    const decayFactor = Math.pow(1 - PROVISIONAL_EVENT_POLLUTION_DECAY_RATE, days);
    const pollution = {
      air: Math.max(0, region.pollution.air * decayFactor + accumulation),
      water: Math.max(0, region.pollution.water * decayFactor + accumulation * 0.5),
      soil: Math.max(0, region.pollution.soil * decayFactor + accumulation * 0.3),
    };

    // Ecosystem stress from the total pollution load.
    const totalPollution = pollution.air + pollution.water + pollution.soil;
    const pollutionStress = (totalPollution / PROVISIONAL_EVENT_POLLUTION_STRESS_SCALE) * days;

    // Recovery toward baseline (GDD §10.3 — recovery is possible but costly).
    const recovery = PROVISIONAL_EVENT_RECOVERY_RATE * days;

    const soilHealth = clamp01(
      region.soilHealth + recovery * (1 - region.soilHealth) - pollutionStress,
    );
    const waterAvailability = clamp01(
      region.waterAvailability + recovery * (1 - region.waterAvailability) - pollutionStress * 0.5,
    );
    const forestCoverage = clamp01(
      region.forestCoverage + recovery * (1 - region.forestCoverage) - pollutionStress * 0.3,
    );

    // Biodiversity — irreversible collapse below the extinction threshold
    // (GDD §10.3). Above the threshold it recovers like the other indicators;
    // below it, it does NOT recover and the global speciesExtinctionRate
    // ratchets up.
    let biodiversity: number;
    if (region.biodiversity >= PROVISIONAL_SPECIES_EXTINCTION_THRESHOLD) {
      biodiversity = clamp01(
        region.biodiversity + recovery * (1 - region.biodiversity) - pollutionStress * 0.4,
      );
    } else {
      biodiversity = Math.max(0, region.biodiversity - pollutionStress * 0.4);
    }
    if (biodiversity < PROVISIONAL_SPECIES_EXTINCTION_THRESHOLD) {
      speciesExtinctionRate += PROVISIONAL_EVENT_EXTINCTION_RATE * days;
    }

    const after: RegionState = {
      ...region,
      pollution,
      soilHealth,
      waterAvailability,
      forestCoverage,
      biodiversity,
    };

    // Surface threshold crossings (GDD §10.2 — a collapsing local ecosystem
    // must be visible even when the global average is healthy).
    events.push(...thresholdCrossingEvents(region.id, before, after, state.clock.elapsedSeconds));

    return after;
  });

  // Targeted clone (P10c perf — avoids a full structuredClone per tick). Only
  // the eventState.global path being modified is cloned (regions + the
  // irreversible speciesExtinctionRate accumulator on aggregatedIndicators);
  // the rest of the state is shared by reference. Pure: the frozen input is
  // never touched (new objects at every modified level).
  const next: GameState = {
    ...state,
    eventState: {
      ...state.eventState,
      global: {
        ...state.eventState.global,
        regions: evolvedRegions,
        aggregatedIndicators: {
          ...state.eventState.global.aggregatedIndicators,
          speciesExtinctionRate,
        },
      },
    },
  };

  return { state: next, events };
}

// ---------------------------------------------------------------------------
// aggregateGlobalIndicators — global averages from regional conditions
// (GDD §10.1 / §10.2)
// ---------------------------------------------------------------------------

/** The min regional values tracked alongside the global averages. */
export interface RegionalMinima {
  readonly soilHealth: number;
  readonly waterAvailability: number;
  readonly biodiversity: number;
  readonly forestCoverage: number;
}

/**
 * Compute the min regional indicator values across all regions (GDD §10.2 —
 * "A healthy global average must not conceal a collapsing local ecosystem").
 * Returns `null` when there are no regions. Pure.
 */
export function minRegionalIndicators(state: GameState): RegionalMinima | null {
  const regions = state.eventState.global.regions;
  if (regions.length === 0) {
    return null;
  }
  let minSoil = Infinity;
  let minWater = Infinity;
  let minBiodiversity = Infinity;
  let minForest = Infinity;
  for (const r of regions) {
    minSoil = Math.min(minSoil, r.soilHealth);
    minWater = Math.min(minWater, r.waterAvailability);
    minBiodiversity = Math.min(minBiodiversity, r.biodiversity);
    minForest = Math.min(minForest, r.forestCoverage);
  }
  return {
    soilHealth: minSoil,
    waterAvailability: minWater,
    biodiversity: minBiodiversity,
    forestCoverage: minForest,
  };
}

/**
 * Recompute the global `aggregatedIndicators` averages from regional
 * conditions (GDD §10.1 — global indicators derived from regional; §10.2 — a
 * healthy global average must not conceal a collapsing local ecosystem).
 * Pure: returns a new state + the min regional values alongside the averages.
 *
 * Weighting (`PROVISIONAL_REGIONAL_AGGREGATION_WEIGHTS`):
 *   - `'population'` — each region weighted by its `population` (a populous
 *     region's collapsing ecosystem weighs heavily on the global average).
 *   - `'area'` — RegionState has no `area` field, so this falls back to equal
 *     weighting (one region, one vote).
 *
 * Recomputes `avgSoilHealth` / `avgBiodiversity` / `avgForestCoverage` /
 * `ecosystemResilience` (a @provisional composite: 0.5*biodiversity +
 * 0.3*forestCoverage + 0.2*soilHealth). Preserves `atmosphericCarbon` +
 * `globalTemperature` (P7 EnvironmentSystem / P10c climate-feedback domain)
 * and `speciesExtinctionRate` (irreversible accumulator updated by
 * `evolveRegions`).
 *
 * A no-op when `regions` is empty. Deterministic given `state` — no RNG.
 */
export function aggregateGlobalIndicators(
  state: GameState,
): { state: GameState; events: SimulationEvent[]; minIndicators: RegionalMinima | null } {
  const regions = state.eventState.global.regions;
  if (regions.length === 0) {
    return { state, events: [], minIndicators: null };
  }

  // Compute weights.
  let weights: number[];
  if (PROVISIONAL_REGIONAL_AGGREGATION_WEIGHTS === 'population') {
    weights = regions.map((r) => r.population);
  } else {
    // 'area' — RegionState has no area field; fall back to equal weighting.
    weights = regions.map(() => 1);
  }
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight <= 0) {
    // All-zero populations (or area fallback) — equal weighting.
    weights = regions.map(() => 1);
  }
  const norm = weights.reduce((a, b) => a + b, 0);

  const avg = (sel: (r: RegionState) => number): number => {
    let acc = 0;
    for (let i = 0; i < regions.length; i++) {
      acc += sel(regions[i]!) * weights[i]!;
    }
    return acc / norm;
  };

  const avgSoilHealth = clamp01(avg((r) => r.soilHealth));
  const avgBiodiversity = clamp01(avg((r) => r.biodiversity));
  const avgForestCoverage = clamp01(avg((r) => r.forestCoverage));
  // @provisional composite (GDD §17 — ecosystem resilience derivation).
  const ecosystemResilience = clamp01(
    0.5 * avgBiodiversity + 0.3 * avgForestCoverage + 0.2 * avgSoilHealth,
  );

  const minIndicators = minRegionalIndicators(state);

  const next: GameState = {
    ...state,
    eventState: {
      ...state.eventState,
      global: {
        ...state.eventState.global,
        aggregatedIndicators: {
          ...state.eventState.global.aggregatedIndicators,
          avgSoilHealth,
          avgBiodiversity,
          avgForestCoverage,
          ecosystemResilience,
        },
      },
    },
  };

  return { state: next, events: [], minIndicators };
}

/**
 * Read-only access to the @provisional drift constants for tests + future
 * tuning promotion. Exposed so tests can assert the drift model without
 * hard-coding magic numbers.
 */
export const REGIONAL_DRIFT_CONSTANTS = {
  PROVISIONAL_EVENT_POLLUTION_RATE,
  PROVISIONAL_EVENT_POLLUTION_DECAY_RATE,
  PROVISIONAL_EVENT_POLLUTION_STRESS_SCALE,
  PROVISIONAL_EVENT_EXTINCTION_RATE,
  REGIONAL_THRESHOLDS,
} as const;

/**
 * Read-only access to the @provisional default regions seeded on the first
 * EventSystem tick (tests assert the seeding without re-deriving the list).
 */
export const DEFAULT_REGION_IDS: readonly string[] = DEFAULT_REGIONS.map((r) => r.id);

/**
 * Composite-ecosystem-resilience weights (@provisional — GDD §17). Exposed so
 * tests can assert the resilience formula without hard-coding.
 */
export const ECOSYSTEM_RESILIENCE_WEIGHTS = { biodiversity: 0.5, forestCoverage: 0.3, soilHealth: 0.2 } as const;

// Reference the imported GlobalAggregatedIndicators type so the import is
// preserved for downstream type narrowing (the aggregation builds a partial
// of this type).
export type { GlobalAggregatedIndicators };
