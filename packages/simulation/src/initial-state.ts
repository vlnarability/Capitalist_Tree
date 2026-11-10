/**
 * Default GameConfig and GameState factory.
 *
 * `initialize(config)` produces a fresh GameState: a sapling (the original
 * tree) seeded from the species' `initial` block, modest starting cash, day 0 =
 * first day of spring, an empty scheduler, and the RNG seeded from
 * `config.seed`.
 *
 * P1: the sapling's starting biology (height, trunk, leaf capacity, reserves,
 * water, nutrients) is taken from `species.initial`. Different species can
 * start as very different saplings without engine changes (rule 5).
 */
import {
  type GameConfig,
  type GameState,
  PROVISIONAL_DEFAULT_CURRENCY_ID,
  PROVISIONAL_DAYS_PER_YEAR,
  PROVISIONAL_INITIAL_INFLATION_RATE,
  PROVISIONAL_INITIAL_INTEREST_RATE,
  PROVISIONAL_SPEED_1X,
} from '@capitalist-tree/shared';
import { findSpeciesById } from '@capitalist-tree/content';
import { seasonFromDay, SECONDS_PER_DAY } from './systems/time-system.js';
import { Rng } from './rng.js';

export const DEFAULT_GAME_CONFIG: GameConfig = {
  seed: 42,
  saveId: 'save-default',
  startingDay: 0,
  startingPersonalCash: '50000', // $500.00 in minor units
  speciesId: 'species:white-oak',
  currencyId: PROVISIONAL_DEFAULT_CURRENCY_ID,
};

/**
 * Build a fresh GameState from a GameConfig.
 *
 * Pure and deterministic: same config -> same state (modulo the `createdAt`
 * timestamp, which is only set if provided in config).
 *
 * Throws if `config.speciesId` is not registered in the content package.
 */
export function initializeState(config: GameConfig): GameState {
  const rng = Rng.fromSeed(config.seed);
  const day = config.startingDay;
  // elapsedSeconds must be consistent with `day` so the TimeSystem's
  // recomputation `day = floor(elapsedSeconds / SECONDS_PER_DAY)` is stable
  // across the first step.
  const startElapsedSeconds = day * SECONDS_PER_DAY;
  const season = seasonFromDay(day);
  const createdAt = config.createdAt ?? 0;

  const species = findSpeciesById(config.speciesId);
  if (!species) {
    throw new Error(
      `initializeState: unknown species id "${config.speciesId}". ` +
        `Register the species in packages/content/src/species/index.ts.`,
    );
  }
  const initialBio = species.initial;

  const state: GameState = {
    metadata: {
      saveId: config.saveId,
      version: 1,
      createdAt,
      lastSavedAt: createdAt,
      lastSimulatedAt: createdAt,
      randomSeed: config.seed,
      simulationVersion: 1,
    },
    clock: {
      elapsedSeconds: startElapsedSeconds,
      day,
      season,
      timeOfDay: 0,
      speedMultiplier: PROVISIONAL_SPEED_1X,
      paused: false,
    },
    player: {
      personalCash: config.startingPersonalCash,
      assets: '0',
      liabilities: '0',
      health: 1,
      happiness: 0.7,
      financialSecurity: 0.5,
      livingExpenses: {
        food: '0',
        housing: '0',
        utilities: '0',
        healthcare: '0',
        transportation: '0',
      },
    },
    originalTree: {
      id: 'original',
      speciesId: config.speciesId,
      isOriginal: true,
      ageDays: 0,
      alive: true,
      structure: {
        height: initialBio.height,
        trunkDiameter: initialBio.trunkDiameter,
        branchDevelopment: initialBio.branchDevelopment,
        structuralIntegrity: 1,
      },
      foliage: {
        // Saplings from a nursery come with starter leaves already budded —
        // enough to bootstrap photosynthesis on day 0 without depleting
        // reserves. 50 leaves ≈ a typical nursery oak sapling's flush.
        // Fewer leaves would not photosynthesize enough to outpace the
        // night maintenance draw on reserves (see docs/biology.md
        // §"Sapling bootstrap").
        // PROVISIONAL: tuned against the species' photosynthesis/maintenance
        // balance.
        currentLeaves: 50,
        leafCapacity: initialBio.leafCapacity,
        activeLeafArea: 0,
        // Start at the spring budding target so the sapling isn't winter-dormant
        // on day 0 (the game starts in spring per DEFAULT_GAME_CONFIG).
        seasonalCondition: 0.5,
        // Accumulator for fractional leaf growth (see growth.ts).
        leafGrowthProgress: 0,
      },
      roots: {
        development: initialBio.rootDevelopment,
        absorptionCapacity: initialBio.absorptionCapacity,
      },
      energy: {
        reserves: initialBio.energyReserves,
        production: 0,
        consumption: 0,
      },
      water: {
        stored: initialBio.waterStored,
        capacity: initialBio.waterCapacity,
      },
      nutrients: { ...initialBio.nutrients },
      health: 1, // placeholder; BiologySystem recomputes this each tick (GDD §5.1)
      stress: 0,
      damage: [],
      pendingIssuances: [], // P1: queue of CurrencyIssuanceRequests for P3's EconomySystem
    },
    world: {
      environment: {
        atmosphere: {
          co2Concentration: 410, // ppm
          emissions: 0,
          sequestration: 0,
        },
        soil: {
          health: 1,
          organicMatter: 50,
          contamination: 0,
          nutrients: {
            nitrogen: 50,
            phosphorus: 50,
            potassium: 50,
          },
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
        // PROVISIONAL: 18°C temperate-region average for the starting plot.
        // The global average (~14°C) would leave a spring oak sapling
        // photosynthesizing at ~50% of optimum, which is too cold to bootstrap.
        // The starting plot is in a temperate zone — P6 (EnvironmentSystem)
        // will introduce regional temperature variation. Below the species'
        // minimum (5°C) photosynthesis is zero; at optimum (22°C) it peaks.
        globalTemperature: 18,
      },
      regionId: 'region:starting-plot',
    },
    economy: {
      monetarySupply: config.startingPersonalCash,
      inflationRate: PROVISIONAL_INITIAL_INFLATION_RATE,
      interestRate: PROVISIONAL_INITIAL_INTEREST_RATE,
      monetaryAuthority: {
        monetarySupply: config.startingPersonalCash,
        interestRate: PROVISIONAL_INITIAL_INTEREST_RATE,
        inflationTarget: 0.02,
      },
      markets: [
        {
          id: 'market:default',
          commodityId: config.currencyId,
          price: '1',
          supply: 0,
          demand: 0,
        },
      ],
      transactions: [],
    },
    businesses: [],
    inventory: {
      items: [],
    },
    automation: [],
    progression: {
      research: [],
      achievements: [],
      geneticLegacy: 0,
    },
    history: {
      snapshots: [],
      archive: [],
    },
    rngState: rng.getState(),
    scheduler: {
      events: [],
    },
  };

  // Sanity: PROVISIONAL_DAYS_PER_YEAR is referenced here only to ensure the
  // import is used in case future code computes season boundaries from it.
  void PROVISIONAL_DAYS_PER_YEAR;

  return state;
}
