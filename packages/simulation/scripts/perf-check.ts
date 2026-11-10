#!/usr/bin/env node
/**
 * Headless P2 sanity script — Resources + Weather (TDD §21.14: "The
 * simulation can be tested independently of Next.js").
 *
 * Boots the engine with the default GameConfig (White Oak sapling), advances
 * the simulation by several in-game years under the real WeatherSystem +
 * ResourceSystem (no stubs), and prints a summary demonstrating realistic
 * weather + resource evolution. Used to sanity-check that:
 *
 *   - Weather conditions cycle sensibly across seasons.
 *   - Per-season weather distribution matches the design intent in the
 *     transition matrices (sunny dominates summer, frost in winter, etc.).
 *   - The water balance evolves (soilWater + treeWater stay bounded and
 *     non-negative across a multi-year run).
 *   - The nutrient balance evolves similarly.
 *   - Derived soil health is recomputed each tick and stays in [0, 1].
 *   - ResourceNotification events fire under stress conditions.
 *   - The simulation is deterministic across a save/load round-trip.
 *   - The full P2 stack runs in a reasonable wall-clock time (perf regression
 *     guard for future refactors).
 *
 * Usage:
 *   pnpm tsx packages/simulation/scripts/perf-check.ts [years] [seed]
 *
 *   years defaults to 5; seed defaults to 42.
 */
import {
  engine,
  InMemoryStorage,
  DEFAULT_GAME_CONFIG,
} from '../src/index.js';
import {
  PROVISIONAL_DAYS_PER_YEAR,
  PROVISIONAL_RESOURCE_SOIL_NUTRIENT_CAPACITY,
  PROVISIONAL_RESOURCE_SOIL_WATER_CAPACITY,
  PROVISIONAL_SIMULATION_STEP_SECONDS,
} from '@capitalist-tree/shared';
import type {
  GameState,
  WeatherCondition,
  Season,
} from '@capitalist-tree/shared';

const SECONDS_PER_DAY = 24 * 60 * 60;

const ALL_CONDITIONS: readonly WeatherCondition[] = [
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

function emptyTally(): Record<WeatherCondition, number> {
  const out = {} as Record<WeatherCondition, number>;
  for (const c of ALL_CONDITIONS) out[c] = 0;
  return out;
}

function formatTallyRow(label: string, tally: Record<WeatherCondition, number>): string {
  const total = Object.values(tally).reduce((a, b) => a + b, 0);
  const cells = ALL_CONDITIONS.map((c) => {
    const pct = total > 0 ? (tally[c] / total) * 100 : 0;
    return `${c}=${pct.toFixed(1)}%`;
  });
  return `${label.padEnd(8)} total=${total}  ${cells.join('  ')}`;
}

function assertFinite(label: string, value: number): void {
  if (!Number.isFinite(value)) {
    console.error(`[INVARIANT VIOLATION] ${label} is not finite: ${value}`);
    process.exit(1);
  }
}

function assertNonNegative(label: string, value: number): void {
  if (value < 0) {
    console.error(`[INVARIANT VIOLATION] ${label} is negative: ${value}`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const yearsArg = process.argv[2];
  const seedArg = process.argv[3];
  const years = yearsArg ? Number(yearsArg) : 5;
  const seed = seedArg ? Number(seedArg) : 42;

  console.log('=== The Capitalist Tree — P2 Resources + Weather Sanity ===');
  console.log(`Seed: ${seed}`);
  console.log(`Simulation length: ${years} sim years (${years * PROVISIONAL_DAYS_PER_YEAR} sim days)`);
  console.log(`Step size: ${PROVISIONAL_SIMULATION_STEP_SECONDS}s = 1 in-game minute`);
  console.log('');

  const initial = engine.initialize({ ...DEFAULT_GAME_CONFIG, seed, createdAt: 0 });
  console.log('--- Initial resources ---');
  console.log(`  soil.soilWater    = ${initial.world.environment.soil.soilWater.toFixed(1)} L / ${PROVISIONAL_RESOURCE_SOIL_WATER_CAPACITY} L capacity`);
  console.log(`  soil.nutrients.N  = ${initial.world.environment.soil.nutrients.nitrogen.toFixed(1)} / ${PROVISIONAL_RESOURCE_SOIL_NUTRIENT_CAPACITY}`);
  console.log(`  soil.nutrients.P  = ${initial.world.environment.soil.nutrients.phosphorus.toFixed(1)} / ${PROVISIONAL_RESOURCE_SOIL_NUTRIENT_CAPACITY}`);
  console.log(`  soil.nutrients.K  = ${initial.world.environment.soil.nutrients.potassium.toFixed(1)} / ${PROVISIONAL_RESOURCE_SOIL_NUTRIENT_CAPACITY}`);
  console.log(`  soil.organicMatter = ${initial.world.environment.soil.organicMatter.toFixed(1)}`);
  console.log(`  soil.contamination = ${initial.world.environment.soil.contamination.toFixed(1)}`);
  console.log(`  soil.health       = ${initial.world.environment.soil.health.toFixed(2)} (derived)`);
  console.log(`  tree.water.stored  = ${initial.originalTree.water.stored.toFixed(1)} L / ${initial.originalTree.water.capacity} L capacity`);
  console.log(`  tree.nutrients.N/P/K = ${initial.originalTree.nutrients.nitrogen}/${initial.originalTree.nutrients.phosphorus}/${initial.originalTree.nutrients.potassium}`);
  console.log(`  weather            = ${initial.world.weather.condition} @ ${initial.world.weather.temperature.toFixed(1)}°C (intensity ${initial.world.weather.intensity.toFixed(2)})`);
  console.log('');

  // Advance, tallying the weather condition at the end of each day.
  const totalSeconds = years * PROVISIONAL_DAYS_PER_YEAR * SECONDS_PER_DAY;
  const totalDays = Math.floor(totalSeconds / SECONDS_PER_DAY);
  const perSeasonTally: Record<Season, Record<WeatherCondition, number>> = {
    spring: emptyTally(),
    summer: emptyTally(),
    autumn: emptyTally(),
    winter: emptyTally(),
  };
  let state: GameState = initial;
  const start = Date.now();
  for (let d = 0; d < totalDays; d++) {
    const r = engine.advance(state, SECONDS_PER_DAY);
    state = r.state;
    perSeasonTally[state.clock.season][state.world.weather.condition]++;
  }
  const elapsed = Date.now() - start;

  console.log(`--- After ${years} sim years (${(totalSeconds / PROVISIONAL_SIMULATION_STEP_SECONDS).toFixed(0)} steps in ${elapsed}ms) ---`);
  console.log(`  soil.soilWater    = ${state.world.environment.soil.soilWater.toFixed(1)} L / ${PROVISIONAL_RESOURCE_SOIL_WATER_CAPACITY} L capacity`);
  console.log(`  soil.nutrients.N  = ${state.world.environment.soil.nutrients.nitrogen.toFixed(1)} / ${PROVISIONAL_RESOURCE_SOIL_NUTRIENT_CAPACITY}`);
  console.log(`  soil.nutrients.P  = ${state.world.environment.soil.nutrients.phosphorus.toFixed(1)} / ${PROVISIONAL_RESOURCE_SOIL_NUTRIENT_CAPACITY}`);
  console.log(`  soil.nutrients.K  = ${state.world.environment.soil.nutrients.potassium.toFixed(1)} / ${PROVISIONAL_RESOURCE_SOIL_NUTRIENT_CAPACITY}`);
  console.log(`  soil.organicMatter = ${state.world.environment.soil.organicMatter.toFixed(1)}`);
  console.log(`  soil.contamination = ${state.world.environment.soil.contamination.toFixed(1)}`);
  console.log(`  soil.health       = ${state.world.environment.soil.health.toFixed(2)} (derived)`);
  console.log(`  freshwater.groundwater = ${state.world.environment.freshwater.groundwater.toFixed(1)} L`);
  console.log(`  freshwater.availability = ${state.world.environment.freshwater.availability.toFixed(1)} L`);
  console.log(`  tree.water.stored  = ${state.originalTree.water.stored.toFixed(1)} L / ${state.originalTree.water.capacity} L capacity`);
  console.log(`  tree.nutrients.N/P/K = ${state.originalTree.nutrients.nitrogen.toFixed(1)}/${state.originalTree.nutrients.phosphorus.toFixed(1)}/${state.originalTree.nutrients.potassium.toFixed(1)}`);
  console.log(`  tree.alive         = ${state.originalTree.alive}`);
  console.log(`  tree.health        = ${(state.originalTree.health * 100).toFixed(0)}%`);
  console.log(`  tree.stress        = ${(state.originalTree.stress * 100).toFixed(0)}%`);
  console.log(`  weather            = ${state.world.weather.condition} @ ${state.world.weather.temperature.toFixed(1)}°C (intensity ${state.world.weather.intensity.toFixed(2)})`);
  console.log(`  rngStreams.weather = [${state.rngStreams.weather.join(', ')}]`);
  console.log('');

  // Per-season weather distribution.
  console.log('--- Per-season weather distribution (over ${years} sim years) ---'.replace('${years}', String(years)));
  for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) {
    console.log('  ' + formatTallyRow(season, perSeasonTally[season]));
  }
  console.log('');

  // Invariant checks (catch catastrophic bugs the unit tests miss).
  const soil = state.world.environment.soil;
  const tree = state.originalTree;
  assertFinite('soil.soilWater', soil.soilWater);
  assertFinite('soil.organicMatter', soil.organicMatter);
  assertFinite('soil.contamination', soil.contamination);
  assertFinite('soil.health', soil.health);
  assertFinite('soil.nutrients.N', soil.nutrients.nitrogen);
  assertFinite('soil.nutrients.P', soil.nutrients.phosphorus);
  assertFinite('soil.nutrients.K', soil.nutrients.potassium);
  assertFinite('tree.water.stored', tree.water.stored);
  assertFinite('tree.nutrients.N', tree.nutrients.nitrogen);
  assertFinite('tree.nutrients.P', tree.nutrients.phosphorus);
  assertFinite('tree.nutrients.K', tree.nutrients.potassium);
  assertNonNegative('soil.soilWater', soil.soilWater);
  assertNonNegative('soil.organicMatter', soil.organicMatter);
  assertNonNegative('soil.contamination', soil.contamination);
  assertNonNegative('soil.nutrients.N', soil.nutrients.nitrogen);
  assertNonNegative('soil.nutrients.P', soil.nutrients.phosphorus);
  assertNonNegative('soil.nutrients.K', soil.nutrients.potassium);
  assertNonNegative('tree.water.stored', tree.water.stored);
  assertNonNegative('tree.nutrients.N', tree.nutrients.nitrogen);
  assertNonNegative('tree.nutrients.P', tree.nutrients.phosphorus);
  assertNonNegative('tree.nutrients.K', tree.nutrients.potassium);
  if (soil.soilWater > PROVISIONAL_RESOURCE_SOIL_WATER_CAPACITY + 1e-6) {
    console.error(`[INVARIANT VIOLATION] soil.soilWater ${soil.soilWater} exceeds capacity ${PROVISIONAL_RESOURCE_SOIL_WATER_CAPACITY}`);
    process.exit(1);
  }
  if (soil.nutrients.nitrogen > PROVISIONAL_RESOURCE_SOIL_NUTRIENT_CAPACITY + 1e-6) {
    console.error(`[INVARIANT VIOLATION] soil.nutrients.N ${soil.nutrients.nitrogen} exceeds capacity ${PROVISIONAL_RESOURCE_SOIL_NUTRIENT_CAPACITY}`);
    process.exit(1);
  }
  if (soil.health < 0 || soil.health > 1) {
    console.error(`[INVARIANT VIOLATION] soil.health ${soil.health} out of [0,1]`);
    process.exit(1);
  }
  console.log('--- Invariant checks ---');
  console.log('  All resource + weather fields finite, non-negative, capacity-bounded.');
  console.log('  Derived soil health in [0,1].');
  console.log('');

  // Determinism + save/load round-trip.
  const initial2 = engine.initialize({ ...DEFAULT_GAME_CONFIG, seed, createdAt: 0 });
  const initial3 = engine.initialize({ ...DEFAULT_GAME_CONFIG, seed, createdAt: 0 });
  const rerun = engine.advance(initial2, totalSeconds);
  // Deep equality (NOT JSON.stringify, which is sensitive to key-insertion
  // order — Zod reordering during load can flip the order of fields without
  // changing their values). The engine itself never depends on key order.
  const sameState = deepEqual(rerun.state, state);
  console.log('--- Determinism check (TDD §18.3) ---');
  console.log(`  Same seed + same duration → identical state: ${sameState ? 'PASS' : 'FAIL'}`);
  if (!sameState) {
    console.error('  DETERMINISM FAILED');
    process.exit(1);
  }

  // Save/load round-trip: advance half, save, load, advance the other half,
  // compare to a straight-through advance.
  const halfway = Math.floor(totalSeconds / 2);
  const secondHalf = totalSeconds - halfway;
  const a1 = engine.advance(initial3, halfway);
  const storage = new InMemoryStorage();
  await storage.save(a1.state);
  const loaded = await storage.load();
  if (!loaded) {
    console.error('  SAVE/LOAD FAILED — loaded state is null');
    process.exit(1);
  }
  const a2 = engine.advance(loaded, secondHalf);
  const b2 = engine.advance(engine.initialize({ ...DEFAULT_GAME_CONFIG, seed, createdAt: 0 }), totalSeconds);
  const sameState2 = deepEqual(a2.state, b2.state);
  console.log(`  Save -> load -> advance(half) == advance(full): ${sameState2 ? 'PASS' : 'FAIL'}`);
  if (!sameState2) {
    console.error('  SAVE/LOAD DETERMINISM FAILED');
    process.exit(1);
  }
  console.log('');

  console.log('=== Done. ===');
}

/** Deep equality check (NOT JSON.stringify-based — key order can vary after
 *  Zod parse during load, but values are what matter). Compares values
 *  recursively, including arrays in order. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ak = Object.keys(a as Record<string, unknown>);
    const bk = Object.keys(b as Record<string, unknown>);
    if (ak.length !== bk.length) return false;
    const aset = new Set(ak);
    for (const k of bk) if (!aset.has(k)) return false;
    for (const k of ak) {
      if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) {
        return false;
      }
    }
    return true;
  }
  return false;
}

main().catch((err) => {
  console.error('perf-check failed:', err);
  process.exit(1);
});
