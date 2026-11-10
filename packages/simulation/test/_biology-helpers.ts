/**
 * Test helpers for biology tests.
 *
 * Constructs trees, species, and contexts in known configurations so we can
 * assert biological invariants without depending on the full engine pipeline.
 */
import type {
  GameState,
  TreeState,
  TreeSpecies,
  EnvironmentState,
  Season,
} from '@capitalist-tree/shared';
import { WHITE_OAK } from '@capitalist-tree/content';

const SECONDS_PER_DAY = 24 * 60 * 60;
const STEP_SECONDS = 60;

/** Deep merge: for each key in `overrides`, recursively merge nested objects. */
function deepMerge<T>(base: T, overrides: Partial<T>): T {
  if (!overrides) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const key of Object.keys(overrides as Record<string, unknown>)) {
    const b = (base as Record<string, unknown>)[key];
    const o = (overrides as Record<string, unknown>)[key];
    if (
      b && o &&
      typeof b === 'object' && !Array.isArray(b) &&
      typeof o === 'object' && !Array.isArray(o)
    ) {
      out[key] = deepMerge(b, o);
    } else if (o !== undefined) {
      out[key] = o;
    }
  }
  return out as T;
}

/**
 * Build a TreeState for testing. Defaults to a mid-spring, healthy, mid-sized
 * tree with full canopy. Override any field (including nested) via `overrides`.
 */
export function testTree(overrides: Partial<TreeState> = {}): TreeState {
  const base: TreeState = {
    id: 'original',
    speciesId: WHITE_OAK.id,
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
    roots: {
      development: 0.5,
      absorptionCapacity: 0.5,
    },
    energy: {
      reserves: 500,
      production: 0,
      consumption: 0,
    },
    water: {
      stored: 25,
      capacity: 50,
    },
    nutrients: {
      nitrogen: 5,
      phosphorus: 2,
      potassium: 4,
    },
    health: 1,
    stress: 0,
    damage: [],
    pendingIssuances: [],
  };
  return deepMerge(base, overrides);
}

/** The White Oak species, the default for tests. */
export const SPECIES: TreeSpecies = WHITE_OAK;

/** A neutral environment for testing — full sun, ample water, no stressors. */
export function neutralEnvironment(overrides: Partial<EnvironmentState> = {}): EnvironmentState {
  const base: EnvironmentState = {
    atmosphere: {
      co2Concentration: 410,
      emissions: 0,
      sequestration: 0,
    },
    soil: {
      health: 1,
      organicMatter: 50,
      contamination: 0,
      nutrients: { nitrogen: 50, phosphorus: 50, potassium: 50 },
      soilWater: 100,
      ph: 6.5,
      compaction: 0,
      microbialActivity: 1.0,
    },
    freshwater: {
      availability: 1000,
      groundwater: 500,
      contamination: 0,
    },
    biodiversity: {
      index: 0.8,
      speciesPopulations: [],
    },
    forestCoverage: 0.3,
    ecosystemResilience: 0.8,
    globalTemperature: 22, // oak optimum → tempF = 1.0
  };
  return deepMerge(base, overrides);
}

/** A minimal BiologyContext for testing pure functions. */
export function testContext(overrides: {
  stepSeconds?: number;
  now?: number;
  season?: Season;
  timeOfDay?: number;
  species?: TreeSpecies;
  environment?: EnvironmentState;
} = {}): {
  now: number;
  stepSeconds: number;
  stepDays: number;
  season: Season;
  timeOfDay: number;
  species: TreeSpecies;
  environment: EnvironmentState;
} {
  const stepSeconds = overrides.stepSeconds ?? STEP_SECONDS;
  return {
    now: overrides.now ?? STEP_SECONDS,
    stepSeconds,
    stepDays: stepSeconds / SECONDS_PER_DAY,
    season: overrides.season ?? 'summer',
    timeOfDay: overrides.timeOfDay ?? 0.5, // noon → lightF = 1.0
    species: overrides.species ?? SPECIES,
    environment: overrides.environment ?? neutralEnvironment(),
  };
}

/**
 * Build a fresh GameState with the test tree as originalTree. Useful for
 * BiologySystem.execute tests that need a full GameState.
 */
export function testState(treeOverrides: Partial<TreeState> = {}): GameState {
  const tree = testTree(treeOverrides);
  return {
    metadata: {
      saveId: 'save-test',
      version: 2,
      createdAt: 0,
      lastSavedAt: 0,
      lastSimulatedAt: 0,
      randomSeed: 1,
      simulationVersion: 1,
    },
    clock: {
      elapsedSeconds: 0,
      day: 0,
      season: 'summer',
      timeOfDay: 0.5,
      speedMultiplier: 1,
      paused: false,
    },
    player: {
      personalCash: '50000',
      assets: '0',
      liabilities: '0',
      health: 1,
      happiness: 0.7,
      financialSecurity: 0.5,
      livingExpenses: {
        food: '0', housing: '0', utilities: '0', healthcare: '0', transportation: '0',
      },
    },
    originalTree: tree,
    world: {
      environment: neutralEnvironment(),
      weather: {
        condition: 'sunny',
        temperature: 22,
        intensity: 0.5,
        prevCondition: null,
        daysInCondition: 0,
      },
      regionId: 'region:starting-plot',
    },
    economy: {
      monetarySupply: '50000',
      inflationRate: 0,
      interestRate: 0,
      monetaryAuthority: {
        monetarySupply: '50000',
        interestRate: 0,
        inflationTarget: 0.02,
      },
      markets: [
        {
          id: 'market:default',
          commodityId: 'currency:leaf-dollar',
          price: '1',
          supply: 0,
          demand: 0,
        },
      ],
      transactions: [],
    },
    businesses: [],
    inventory: { items: [] },
    automation: [],
    progression: { research: [], achievements: [], geneticLegacy: 0 },
    history: { snapshots: [], archive: [] },
    rngState: [0, 0, 0, 0],
    rngStreams: { weather: [0, 0, 0, 0] },
    scheduler: { events: [] },
  };
}

export { SECONDS_PER_DAY, STEP_SECONDS };
