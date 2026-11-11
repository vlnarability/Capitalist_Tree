import type { GameState } from '../src/index.js';

/**
 * Minimal valid GameState fixture for shared-package tests that need a
 * state without depending on @capitalist-tree/simulation (which itself
 * depends on shared — we avoid the cycle).
 */
export function baseState(overrides: Partial<GameState> = {}): GameState {
  const base: GameState = {
    metadata: {
      saveId: 'save-test',
      version: 1,
      createdAt: 0,
      lastSavedAt: 0,
      lastSimulatedAt: 0,
      randomSeed: 1,
      simulationVersion: 1,
    },
    clock: {
      elapsedSeconds: 0,
      day: 0,
      season: 'spring',
      timeOfDay: 0,
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
        food: '0',
        housing: '0',
        utilities: '0',
        healthcare: '0',
        transportation: '0',
      },
    },
    originalTree: {
      id: 'original',
      speciesId: 'species:proto-oak',
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
        leafGrowthProgress: 0,
      },
      roots: { development: 0.1, absorptionCapacity: 0.1 },
      energy: { reserves: 50, production: 0, consumption: 0 },
      water: { stored: 10, capacity: 50 },
      nutrients: { nitrogen: 10, phosphorus: 10, potassium: 10 },
      health: 1,
      stress: 0,
      damage: [],
      pendingIssuances: [],
    },
    world: {
      environment: {
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
        freshwater: { availability: 1000, groundwater: 500, contamination: 0 },
        biodiversity: { index: 0.8, speciesPopulations: [] },
        forestCoverage: 0.3,
        ecosystemResilience: 0.8,
        globalTemperature: 14,
      },
      weather: {
        condition: 'sunny',
        temperature: 18,
        intensity: 0.5,
        prevCondition: null,
        daysInCondition: 0,
      },
      regionId: 'region:starting-plot',
    },
    economy: {
      monetarySupply: '50000',
      inflationRate: 0,
      inflationIndex: 1.0,
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
          lastPriceUpdate: 0,
        },
      ],
      transactions: [],
      // P3a: account ledger + idempotency set + cumulative counters.
      accounts: [
        {
          id: 'player:personal',
          type: 'player',
          label: 'Player Personal',
          balance: '50000',
        },
        {
          id: 'external:default',
          type: 'external',
          label: 'External Participants',
          balance: '0',
        },
      ],
      processedRequestIds: [],
      totalIssued: '0',
      totalSinks: '0',
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
  return { ...base, ...overrides };
}
