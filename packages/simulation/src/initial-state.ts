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
  type MarketState,
  PROVISIONAL_DEFAULT_CURRENCY_ID,
  PROVISIONAL_DAYS_PER_YEAR,
  PROVISIONAL_INITIAL_INFLATION_RATE,
  PROVISIONAL_INITIAL_INTEREST_RATE,
  PROVISIONAL_SPEED_1X,
  PROVISIONAL_RESOURCE_INITIAL_FRESHWATER_AVAILABILITY,
  PROVISIONAL_RESOURCE_INITIAL_GROUNDWATER,
  PROVISIONAL_RESOURCE_INITIAL_SOIL_WATER,
  PROVISIONAL_RESOURCE_INITIAL_SOIL_NUTRIENTS,
  PROVISIONAL_RESOURCE_INITIAL_ORGANIC_MATTER,
  PROVISIONAL_WEATHER_INITIAL_CONDITION,
  PROVISIONAL_WEATHER_INITIAL_INTENSITY,
  PROVISIONAL_WEATHER_DEFAULT_CLIMATE_ID,
  PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
  PROVISIONAL_ECONOMY_EXTERNAL_ACCOUNT_ID,
  PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_LABEL,
  PROVISIONAL_ECONOMY_EXTERNAL_ACCOUNT_LABEL,
  PROVISIONAL_ECONOMY_MARKET_ACCOUNT_PREFIX,
  PROVISIONAL_ECONOMY_MARKET_INITIAL_SUPPLY,
} from '@capitalist-tree/shared';
import { findSpeciesById, ALL_MARKETS } from '@capitalist-tree/content';
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

  // Fork a child RNG for the WeatherSystem at game start. Persisted on
  // `state.rngStreams.weather` so the Markov sequence survives save/load
  // (TDD §18.3 — see docs/simulation.md §6 note).
  const weatherRng = rng.fork('WeatherSystem');

  // PROVISIONAL: starting plot is in a temperate zone. P2 keeps the original
  // P1 default of 18°C so the sapling's first-step photosynthesis matches the
  // P1 baseline; WeatherSystem will overwrite this each tick with the
  // local-temperature derivation.
  const startTempC = 18;
  void PROVISIONAL_WEATHER_DEFAULT_CLIMATE_ID;

  // P3b: seed the 5 commodity markets from content definitions
  // (water, fertilizer, seeds, food, energy — GDD §8.5). Each market starts
  // with `price = basePrice` (so the inflation index = 1.0 at game start),
  // `supply = PROVISIONAL_ECONOMY_MARKET_INITIAL_SUPPLY`, and
  // `demand = 0`. The EconomySystem recomputes prices each tick based on
  // supply/demand + monetary conditions.
  const markets: MarketState[] = ALL_MARKETS.map((def) => ({
    id: def.id,
    commodityId: def.commodityId,
    price: def.basePrice,
    supply: PROVISIONAL_ECONOMY_MARKET_INITIAL_SUPPLY,
    demand: 0,
    lastPriceUpdate: 0,
  }));

  // P3b: per-market external accounts. Each market has a dedicated
  // `market:<id>` account that holds the revenue from purchases — the
  // player's cash transfers from `player:personal` to the market's account.
  // P3c+ may drain these to the authority (supplier taxes) or route to
  // player-owned business accounts (TDD §10.5).
  const marketAccounts = ALL_MARKETS.map((def) => ({
    id: `${PROVISIONAL_ECONOMY_MARKET_ACCOUNT_PREFIX}${def.id.replace(/^market:/, '')}`,
    type: 'external' as const,
    label: `Market — ${def.id.replace(/^market:/, '')}`,
    balance: '0',
  }));

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
          organicMatter: PROVISIONAL_RESOURCE_INITIAL_ORGANIC_MATTER,
          contamination: 0,
          nutrients: { ...PROVISIONAL_RESOURCE_INITIAL_SOIL_NUTRIENTS },
          soilWater: PROVISIONAL_RESOURCE_INITIAL_SOIL_WATER,
          ph: 6.5,
          compaction: 0,
          microbialActivity: 1.0,
        },
        freshwater: {
          availability: PROVISIONAL_RESOURCE_INITIAL_FRESHWATER_AVAILABILITY,
          groundwater: PROVISIONAL_RESOURCE_INITIAL_GROUNDWATER,
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
        // P2's WeatherSystem overwrites this each tick with the local
        // temperature (climate baseline + per-condition delta). The starting
        // value here is the day-0 baseline before WeatherSystem's first tick.
        globalTemperature: startTempC,
      },
      weather: {
        condition: PROVISIONAL_WEATHER_INITIAL_CONDITION,
        temperature: startTempC,
        intensity: PROVISIONAL_WEATHER_INITIAL_INTENSITY,
        prevCondition: null,
        daysInCondition: 0,
      },
      regionId: 'region:starting-plot',
    },
    economy: {
      monetarySupply: config.startingPersonalCash,
      inflationRate: PROVISIONAL_INITIAL_INFLATION_RATE,
      // P3b: starts at 1.0 (all markets priced at base). The EconomySystem
      // recomputes this each tick from the basket of market prices.
      inflationIndex: 1.0,
      interestRate: PROVISIONAL_INITIAL_INTEREST_RATE,
      monetaryAuthority: {
        monetarySupply: config.startingPersonalCash,
        interestRate: PROVISIONAL_INITIAL_INTEREST_RATE,
        inflationTarget: 0.02,
      },
      markets,
      transactions: [],
      // P3a: explicit account ledger. The central monetary authority is
      // virtual (the "mint"); `accounts` holds only real holders. Seeded at
      // game start with:
      //   - `player:personal` carrying the starting cash.
      //   - `external:default` placeholder (kept for backward-compat with
      //     P3a tests that transfer money there).
      //   - `market:water` / `market:fertilizer` / `market:seeds` /
      //     `market:food` / `market:energy` — one per commodity market
      //     (P3b). Each market holds the revenue from purchases until
      //     drained (P3c+ supplier taxes / business routing).
      accounts: [
        {
          id: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
          type: 'player',
          label: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_LABEL,
          balance: config.startingPersonalCash,
        },
        {
          id: PROVISIONAL_ECONOMY_EXTERNAL_ACCOUNT_ID,
          type: 'external',
          label: PROVISIONAL_ECONOMY_EXTERNAL_ACCOUNT_LABEL,
          balance: '0',
        },
        ...marketAccounts,
      ],
      // P3a: idempotency set — every fulfilled or rejected CurrencyIssuanceRequest
      // has its requestId recorded here so a re-processed request never
      // double-issues money, even across save/load.
      processedRequestIds: [],
      // P3a: cumulative currency ever issued by the authority. Starts at 0 —
      // the player's starting cash is treated as pre-existing money (the
      // conservation invariant treats it as `initialSupply`, not `totalIssued`).
      totalIssued: '0',
      // P3a: cumulative currency removed from circulation via explicit
      // monetary operations (taxes, fees, central-bank interventions).
      totalSinks: '0',
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
    rngStreams: {
      // WeatherSystem's persisted RNG sub-stream. Initialized at game start by
      // forking from the root RNG; advanced each tick by WeatherSystem.
      weather: weatherRng.getState(),
    },
    scheduler: {
      events: [],
    },
  };

  // Sanity: PROVISIONAL_DAYS_PER_YEAR is referenced here only to ensure the
  // import is used in case future code computes season boundaries from it.
  void PROVISIONAL_DAYS_PER_YEAR;

  return state;
}
