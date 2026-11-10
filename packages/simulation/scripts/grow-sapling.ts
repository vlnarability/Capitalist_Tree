#!/usr/bin/env node
/**
 * Headless P1 grow-a-sapling script (TDD §21.14: "The simulation can be tested
 * independently of Next.js").
 *
 * Boots the engine with the default GameConfig (White Oak sapling), advances
 * the simulation by several in-game years under stub weather/resources/economy/
 * etc. systems, and prints a summary. Used to sanity-check that:
 *
 *   - The sapling survives several sim years.
 *   - It grows structurally (height, trunk, branch, leafCapacity all increase).
 *   - It photosynthesizes and accumulates reserves.
 *   - The simulation is deterministic (same seed → identical output).
 *   - Biology invariants hold (no negative leaves/reserves, health in [0,1],
 *     structure never exceeds species maxima).
 *   - Seasonal budding/senescence produces visible foliage variation.
 *
 * Usage:
 *   pnpm tsx scripts/grow-sapling.ts [years] [seed]
 *
 *   years defaults to 5; seed defaults to 42.
 */
import {
  engine,
  DEFAULT_GAME_CONFIG,
} from '../src/index.js';
import {
  PROVISIONAL_DAYS_PER_YEAR,
  PROVISIONAL_SIMULATION_STEP_SECONDS,
} from '@capitalist-tree/shared';
import { WHITE_OAK } from '@capitalist-tree/content';
import type { GameState, SimulationEvent } from '@capitalist-tree/shared';

const SECONDS_PER_DAY = 24 * 60 * 60;

function formatTree(tree: GameState['originalTree']): string {
  return [
    `alive=${tree.alive}`,
    `ageDays=${tree.ageDays.toFixed(1)}`,
    `height=${tree.structure.height.toFixed(2)}m / ${WHITE_OAK.maximumHeight}m max`,
    `trunk=${tree.structure.trunkDiameter.toFixed(3)}m / ${WHITE_OAK.maximumTrunkDiameter}m max`,
    `branches=${tree.structure.branchDevelopment.toFixed(1)} / ${WHITE_OAK.maximumBranchDevelopment} max`,
    `leaves=${tree.foliage.currentLeaves}/${tree.foliage.leafCapacity} (cap)`,
    `seasonalCond=${tree.foliage.seasonalCondition.toFixed(2)}`,
    `reserves=${tree.energy.reserves.toFixed(0)} eu (prod ${tree.energy.production.toFixed(2)} eu/day, maint ${tree.energy.consumption.toFixed(2)} eu/day)`,
    `water=${tree.water.stored.toFixed(1)} / ${tree.water.capacity} L`,
    `stress=${(tree.stress * 100).toFixed(1)}%`,
    `health=${(tree.health * 100).toFixed(0)}%`,
    `damage records=${tree.damage.length}`,
    `pendingIssuances=${tree.pendingIssuances.length}`,
  ].join('\n  ');
}

function formatClock(state: GameState): string {
  const day = state.clock.day;
  const year = Math.floor(day / PROVISIONAL_DAYS_PER_YEAR) + 1;
  const dayOfYear = (day % PROVISIONAL_DAYS_PER_YEAR) + 1;
  return `Year ${year}, Day ${dayOfYear} (${state.clock.season}, ${(state.clock.timeOfDay * 24).toFixed(1)}h)`;
}

function countEventTypes(events: SimulationEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of events) {
    counts[e.type] = (counts[e.type] ?? 0) + 1;
  }
  return counts;
}

function assertInvariants(state: GameState, label: string): void {
  const t = state.originalTree;
  const errors: string[] = [];
  if (t.foliage.currentLeaves < 0) errors.push(`negative leaves: ${t.foliage.currentLeaves}`);
  if (t.energy.reserves < 0) errors.push(`negative reserves: ${t.energy.reserves}`);
  if (t.water.stored < 0) errors.push(`negative water: ${t.water.stored}`);
  if (t.nutrients.nitrogen < 0 || t.nutrients.phosphorus < 0 || t.nutrients.potassium < 0) {
    errors.push(`negative nutrients: ${JSON.stringify(t.nutrients)}`);
  }
  if (t.health < 0 || t.health > 1) errors.push(`health out of [0,1]: ${t.health}`);
  if (t.stress < 0 || t.stress > 1) errors.push(`stress out of [0,1]: ${t.stress}`);
  if (t.structure.height > WHITE_OAK.maximumHeight + 1e-6) {
    errors.push(`height ${t.structure.height} exceeds max ${WHITE_OAK.maximumHeight}`);
  }
  if (t.structure.trunkDiameter > WHITE_OAK.maximumTrunkDiameter + 1e-6) {
    errors.push(`trunk ${t.structure.trunkDiameter} exceeds max ${WHITE_OAK.maximumTrunkDiameter}`);
  }
  if (errors.length > 0) {
    console.error(`[INVARIANT VIOLATION — ${label}]`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
}

function main(): void {
  const yearsArg = process.argv[2];
  const seedArg = process.argv[3];
  const years = yearsArg ? Number(yearsArg) : 5;
  const seed = seedArg ? Number(seedArg) : 42;

  console.log('=== The Capitalist Tree — P1 Headless Grow-a-Sapling ===');
  console.log(`Species: ${WHITE_OAK.name} (${WHITE_OAK.scientificName})`);
  console.log(`Seed: ${seed}`);
  console.log(`Simulation length: ${years} sim years (${years * PROVISIONAL_DAYS_PER_YEAR} sim days)`);
  console.log(`Step size: ${PROVISIONAL_SIMULATION_STEP_SECONDS}s = 1 in-game minute`);
  console.log('');

  // Initialize.
  const initial = engine.initialize({ ...DEFAULT_GAME_CONFIG, seed, createdAt: 0 });
  console.log('--- Initial sapling state ---');
  console.log(`  ${formatClock(initial)}`);
  console.log(`  ${formatTree(initial.originalTree)}`);
  console.log('');

  // Advance.
  const totalSeconds = years * PROVISIONAL_DAYS_PER_YEAR * SECONDS_PER_DAY;
  const start = Date.now();
  const result = engine.advance(initial, totalSeconds);
  const elapsed = Date.now() - start;
  const finalState = result.state;
  const events = result.events;

  console.log(`--- After ${years} sim years (${(totalSeconds / PROVISIONAL_SIMULATION_STEP_SECONDS).toFixed(0)} steps in ${elapsed}ms) ---`);
  console.log(`  ${formatClock(finalState)}`);
  console.log(`  ${formatTree(finalState.originalTree)}`);
  console.log('');

  // Event summary.
  const eventCounts = countEventTypes(events);
  console.log('--- Event summary ---');
  for (const [type, count] of Object.entries(eventCounts).sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`  ${type}: ${count}`);
  }
  console.log('');

  // Invariant checks.
  assertInvariants(finalState, 'final state');
  console.log('--- Invariant checks ---');
  console.log('  All biology invariants hold (no negative leaves/reserves/water,');
  console.log('  health and stress in [0,1], structure within species maxima).');
  console.log('');

  // Growth checks.
  const sapling = initial.originalTree;
  const mature = finalState.originalTree;
  console.log('--- Growth summary ---');
  console.log(`  Height: ${sapling.structure.height.toFixed(2)}m → ${mature.structure.height.toFixed(2)}m (+${((mature.structure.height - sapling.structure.height) * 100).toFixed(0)}cm)`);
  console.log(`  Trunk:  ${sapling.structure.trunkDiameter.toFixed(3)}m → ${mature.structure.trunkDiameter.toFixed(3)}m`);
  console.log(`  Branches: ${sapling.structure.branchDevelopment.toFixed(1)} → ${mature.structure.branchDevelopment.toFixed(1)}`);
  console.log(`  Leaf capacity: ${sapling.foliage.leafCapacity} → ${mature.foliage.leafCapacity}`);
  console.log(`  Reserves: ${sapling.energy.reserves.toFixed(0)} → ${mature.energy.reserves.toFixed(0)} eu`);
  console.log(`  Alive: ${mature.alive}`);
  console.log('');

  // Determinism check: run the same simulation again and assert identical output.
  const initial2 = engine.initialize({ ...DEFAULT_GAME_CONFIG, seed, createdAt: 0 });
  const result2 = engine.advance(initial2, totalSeconds);
  const sameState = JSON.stringify(result2.state) === JSON.stringify(result.state);
  const sameEvents = JSON.stringify(result2.events) === JSON.stringify(events);
  console.log('--- Determinism check (TDD §18.3) ---');
  console.log(`  Same seed + same duration → identical state: ${sameState ? 'PASS' : 'FAIL'}`);
  console.log(`  Same seed + same duration → identical events: ${sameEvents ? 'PASS' : 'FAIL'}`);
  if (!sameState || !sameEvents) {
    console.error('  DETERMINISM FAILED');
    process.exit(1);
  }
  console.log('');

  console.log('=== Done. ===');
}

main();
