/**
 * Default GameConfig and GameState factory.
 *
 * `initialize(config)` produces a fresh GameState: a sapling (the original
 * tree), modest starting cash, day 0 = first day of spring, an empty
 * scheduler, and the RNG seeded from `config.seed`.
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
import { seasonFromDay } from './systems/time-system.js';
import { Rng } from './rng.js';

export const DEFAULT_GAME_CONFIG: GameConfig = {
  seed: 42,
  saveId: 'save-default',
  startingDay: 0,
  startingPersonalCash: '50000', // $500.00 in minor units
  speciesId: 'species:proto-oak',
  currencyId: PROVISIONAL_DEFAULT_CURRENCY_ID,
};

/**
 * Build a fresh GameState from a GameConfig.
 *
 * Pure and deterministic: same config -> same state (modulo the `createdAt`
 * timestamp, which is only set if provided in config).
 */
export function initializeState(config: GameConfig): GameState {
  const rng = Rng.fromSeed(config.seed);
  const now = 0; // The clock starts at sim second 0.
  const day = config.startingDay;
  const season = seasonFromDay(day);
  const createdAt = config.createdAt ?? 0;

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
      elapsedSeconds: now,
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
        height: 0.1,
        trunkDiameter: 0.01,
        branchDevelopment: 0,
        structuralIntegrity: 1,
      },
      foliage: {
        currentLeaves: 0,
        leafCapacity: 100,
        activeLeafArea: 0,
        seasonalCondition: 1,
      },
      roots: {
        development: 0.1,
        absorptionCapacity: 0.1,
      },
      energy: {
        reserves: 50,
        production: 0,
        consumption: 0,
      },
      water: {
        stored: 10,
        capacity: 50,
      },
      nutrients: {
        nitrogen: 10,
        phosphorus: 10,
        potassium: 10,
      },
      health: 1,
      stress: 0,
      damage: [],
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
        globalTemperature: 14, // °C global average
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
