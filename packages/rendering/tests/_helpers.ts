/**
 * Shared test fixtures for the rendering package's tests.
 *
 * Mirrors the pattern in packages/simulation/test/_biology-helpers.ts but
 * at the rendering layer's scope. Construct minimal valid
 * TreeState / EnvironmentState / WorldState / SimulationClock for use by
 * both tree-render-data.test.ts and environment-render-data.test.ts so we
 * don't duplicate the fixture setup in each file.
 *
 * Kept self-contained (does NOT import from @capitalist-tree/simulation)
 * so rendering tests stay decoupled from the simulation package — the
 * rendering layer should be testable against the public
 * @capitalist-tree/shared schema alone.
 */
import type {
  TreeState,
  WorldState,
  SimulationClock,
  EnvironmentState,
} from '@capitalist-tree/shared';

/** Deep merge: for each key in `overrides`, recursively merge nested objects. */
export function deepMerge<T>(base: T, overrides: Partial<T>): T {
  if (!overrides) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const key of Object.keys(overrides as Record<string, unknown>)) {
    const b = (base as Record<string, unknown>)[key];
    const o = (overrides as Record<string, unknown>)[key];
    if (
      b &&
      o &&
      typeof b === 'object' &&
      !Array.isArray(b) &&
      typeof o === 'object' &&
      !Array.isArray(o)
    ) {
      out[key] = deepMerge(b, o);
    } else if (o !== undefined) {
      out[key] = o;
    }
  }
  return out as T;
}

/**
 * Build a TreeState for rendering tests. Defaults to a healthy mid-aged
 * summer white-oak with partial canopy. Override any field (including
 * nested) via `overrides`.
 */
export function baseTree(overrides: Partial<TreeState> = {}): TreeState {
  const base: TreeState = {
    id: 'original',
    speciesId: 'species:white-oak',
    isOriginal: true,
    ageDays: 100,
    alive: true,
    structure: {
      height: 5,
      trunkDiameter: 0.2,
      branchDevelopment: 20,
      structuralIntegrity: 1,
    },
    foliage: {
      currentLeaves: 1000,
      leafCapacity: 2050,
      activeLeafArea: 5,
      seasonalCondition: 1,
      leafGrowthProgress: 0,
    },
    roots: { development: 0.5, absorptionCapacity: 0.5 },
    energy: { reserves: 500, production: 0, consumption: 0 },
    water: { stored: 25, capacity: 50 },
    nutrients: { nitrogen: 5, phosphorus: 2, potassium: 4 },
    health: 1,
    stress: 0,
    damage: [],
    pendingIssuances: [],
  };
  return deepMerge(base, overrides);
}

/** A neutral environment for rendering tests — healthy soil, no contamination. */
export function baseEnvironment(overrides: Partial<EnvironmentState> = {}): EnvironmentState {
  const base: EnvironmentState = {
    atmosphere: { co2Concentration: 410, emissions: 0, sequestration: 0 },
    soil: {
      health: 0.9,
      organicMatter: 50,
      contamination: 0,
      nutrients: { nitrogen: 50, phosphorus: 50, potassium: 50 },
      soilWater: 100,
      ph: 6.5,
      compaction: 0,
      microbialActivity: 1.0,
    },
    freshwater: { availability: 1000, groundwater: 500, contamination: 0 },
    biodiversity: { index: 0.8, speciesPopulations: [] },
    forestCoverage: 0.3,
    ecosystemResilience: 0.8,
    globalTemperature: 22,
  };
  return deepMerge(base, overrides);
}

/**
 * A neutral world for rendering tests — sunny summer midday, healthy
 * environment. Override any field via `overrides`.
 */
export function baseWorld(overrides: Partial<WorldState> = {}): WorldState {
  const base: WorldState = {
    environment: baseEnvironment(),
    weather: {
      condition: 'sunny',
      temperature: 22,
      intensity: 0.5,
      prevCondition: null,
      daysInCondition: 0,
    },
    regionId: 'region:starting-plot',
  };
  return deepMerge(base, overrides);
}

/**
 * A neutral clock for rendering tests — summer noon, default speed, not
 * paused. Override any field via `overrides`.
 */
export function baseClock(overrides: Partial<SimulationClock> = {}): SimulationClock {
  const base: SimulationClock = {
    elapsedSeconds: 0,
    day: 0,
    season: 'summer',
    timeOfDay: 0.5,
    speedMultiplier: 1,
    paused: false,
  };
  return deepMerge(base, overrides);
}
