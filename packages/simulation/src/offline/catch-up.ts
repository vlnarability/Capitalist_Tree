/**
 * Offline catch-up processor (P6a — TDD §14.4, GDD §4.2).
 *
 * `runOfflineCatchUp(state, nowMs)` is the entry point invoked when a save is
 * loaded and `state.metadata.lastSimulatedAt` is older than "now" (the real
 * wall-clock ms at load time). It does NOT multiply production rates by the
 * elapsed real time (GDD §4.2 — "Offline progression must not simply multiply
 * production rates by elapsed time"). Instead it converts the elapsed
 * real-world interval into simulation seconds and runs `engine.advance` per
 * 1-sim-day chunk so biological / environmental / economic events all fire
 * through the normal simulation pipeline.
 *
 * Real→sim conversion uses `PROVISIONAL_REAL_TO_SIM_SECONDS` (60), the SAME
 * factor the live accumulator in apps/web uses
 * (`realDelta * PROVISIONAL_REAL_TO_SIM_SECONDS * speedMultiplier`). This
 * keeps offline catch-up consistent with live progression: being away for 1
 * real hour and catching up advances the sim by the same amount as playing
 * live at 1x for 1 real hour (216_000 sim sec = 2 sim days, floored to whole
 * 1-sim-day chunks → 2 chunks). The doc comments in
 * `packages/shared/src/constants/offline.ts` that read "1 real hour = 1 sim
 * day" / "720 chunks for 30 real days" used a factor of 24 and are
 * arithmetically inconsistent with the constant 60; at factor 60 the cap is
 * 1800 chunks (30 real days × 60 sim sec/real sec = 155_520_000 sim sec).
 *
 * Safeguards (TDD §14.4 step 4 + GDD §17):
 *   - Clock tamper detection: a backwards clock beyond
 *     `PROVISIONAL_OFFLINE_BACKWARDS_CLOCK_TOLERANCE_MS` throws
 *     `OfflineClockTamperedError`. A small backwards jitter within the
 *     tolerance is treated as zero elapsed (no chunks, empty summary).
 *   - Max interval cap: the requested real interval is capped at
 *     `PROVISIONAL_OFFLINE_MAX_REAL_INTERVAL_MS` (30 real days). At factor 60
 *     this is 1800 1-sim-day chunks worst-case — bounded so the consumer's
 *     catch-up run stays finite. `summary.capped === true` records that the
 *     absence was only partially honoured so the UI can warn the player.
 *   - Chunked execution: sim time is processed in 1-sim-day chunks
 *     (`PROVISIONAL_OFFLINE_CHUNK_SIM_SECONDS`) so per-chunk event
 *     accumulation stays bounded.
 *
 * Purity (rule 2 — pure state transforms, no input mutation):
 *   - The input `state` is NEVER mutated. A `deepCopy` is taken before any
 *     advancing (the engine's own `advance` deep-copies on entry too, so the
 *     input is doubly safe). The returned `state` is a fresh object.
 *   - All randomness flows through the seeded RNG reconstructed from
 *     `state.rngState`; there is no `Math.random()` / `Date.now()` here. The
 *     only external input is `nowMs`, which the caller derives from
 *     `Date.now()` at load time.
 *
 * Splittability (TDD §18.3): because the engine is pure and deterministic,
 * `chunked advance` (N × `engine.advance(chunk)`) produces results
 * bit-identical to a single `engine.advance(N × chunk)`. The divergence
 * assertion lives in the test file
 * (`packages/simulation/test/offline-catch-up.test.ts`), NOT in this
 * production path — the processor must not assert on its own output.
 */
import type {
  GameState,
  SimulationEvent,
  OfflineSummary,
  OfflineSummaryDelta,
  OfflineBooleanDelta,
  OfflineStringDelta,
  OfflineCatchUpStartedEvent,
  OfflineCatchUpCompletedEvent,
} from '@capitalist-tree/shared';
import {
  PROVISIONAL_OFFLINE_MAX_REAL_INTERVAL_MS,
  PROVISIONAL_OFFLINE_CHUNK_SIM_SECONDS,
  PROVISIONAL_OFFLINE_BACKWARDS_CLOCK_TOLERANCE_MS,
  PROVISIONAL_REAL_TO_SIM_SECONDS,
  OfflineClockTamperedError,
} from '@capitalist-tree/shared';
import { engine } from '../simulation.js';
import { deepCopy } from '../deep-copy.js';

/**
 * The catch-up plan — what the processor WOULD do, computed without executing
 * any chunks. Exposed (alongside `runOfflineCatchUp`) so:
 *   - The cap safeguard can be tested without running a 30-real-day catch-up
 *     (1800 chunks at factor 60 ≈ minutes of execution — infeasible in a
 *     test). `planOfflineCatchUp` returns the planned `chunksPlanned` /
 *     `simElapsedSeconds` / `capped` instantly.
 *   - The apps/web consumer (P6d) can show "Catching up N days..." before
 *     kicking off the (potentially long) execution.
 *
 * `clockTampered` is always `false` on a returned plan — a tampered clock
 * throws `OfflineClockTamperedError` and no plan is produced. The field is
 * kept for shape symmetry with `OfflineSummary`.
 */
export interface OfflineCatchUpPlan {
  /** Elapsed real ms the processor was asked to cover (≥0 after tolerance). */
  readonly requestedRealMs: number;
  /** Ms actually simulated, after capping at the max interval. */
  readonly cappedRealMs: number;
  /** Planned sim seconds (a multiple of the chunk size; remainder dropped). */
  readonly simElapsedSeconds: number;
  /** Planned number of `engine.advance(chunk)` calls. */
  readonly chunksPlanned: number;
  /** True if the requested interval exceeded the max. */
  readonly capped: boolean;
  /** Always false on return — a tampered clock throws instead. */
  readonly clockTampered: false;
}

/**
 * Compute the catch-up plan for a save loaded at real time `nowMs`, WITHOUT
 * executing any chunks. Pure; throws `OfflineClockTamperedError` on a
 * backwards clock beyond the tolerance.
 *
 * Steps (TDD §14.4):
 *   1. `requestedRealMs = nowMs - state.metadata.lastSimulatedAt`.
 *   2. Backwards clock: within tolerance → treat as 0; beyond → throw.
 *   3. Cap at `PROVISIONAL_OFFLINE_MAX_REAL_INTERVAL_MS`.
 *   4. `simElapsedSeconds = floor(cappedRealMs/1000 * REAL_TO_SIM_SECONDS)`,
 *      rounded DOWN to a multiple of the chunk size (sub-chunk remainder
 *      dropped, matching `engine.advance`'s step-rounding).
 *   5. `chunksPlanned = simElapsedSeconds / chunkSimSeconds`.
 */
export function planOfflineCatchUp(state: GameState, nowMs: number): OfflineCatchUpPlan {
  const lastSimulatedAt = state.metadata.lastSimulatedAt;

  // Step 1 — elapsed real ms.
  let requestedRealMs = nowMs - lastSimulatedAt;

  // Step 2 — backwards-clock tamper detection (TDD §14.4, GDD §17).
  if (requestedRealMs < 0) {
    const backwardsMs = -requestedRealMs;
    if (backwardsMs <= PROVISIONAL_OFFLINE_BACKWARDS_CLOCK_TOLERANCE_MS) {
      // Small jitter (Date.now() rounding, NTP micro-step) — treat as zero.
      requestedRealMs = 0;
    } else {
      throw new OfflineClockTamperedError(lastSimulatedAt, nowMs, backwardsMs);
    }
  }

  // Step 3 — cap at the max interval.
  const cappedRealMs = Math.min(requestedRealMs, PROVISIONAL_OFFLINE_MAX_REAL_INTERVAL_MS);
  const capped = cappedRealMs < requestedRealMs;

  // Step 4 — real→sim conversion, rounded DOWN to a whole chunk. The factor
  // matches the live accumulator so offline stays consistent with live play.
  const rawSimSeconds = Math.floor((cappedRealMs / 1000) * PROVISIONAL_REAL_TO_SIM_SECONDS);
  const simElapsedSeconds =
    Math.floor(rawSimSeconds / PROVISIONAL_OFFLINE_CHUNK_SIM_SECONDS) *
    PROVISIONAL_OFFLINE_CHUNK_SIM_SECONDS;

  // Step 5 — chunk count.
  const chunksPlanned = simElapsedSeconds / PROVISIONAL_OFFLINE_CHUNK_SIM_SECONDS;

  return {
    requestedRealMs,
    cappedRealMs,
    simElapsedSeconds,
    chunksPlanned,
    capped,
    clockTampered: false,
  };
}

/**
 * Result of `runOfflineCatchUp`. The `events` array is the full event stream
 * produced by the catch-up: the `offline-catch-up-started` event, the chunk
 * events emitted by `engine.advance` (tick / season-changed / harvest /
 * transaction / etc. — whatever the systems produce), and the
 * `offline-catch-up-completed` event. Consumers (apps/web P6d) can filter or
 * drop the chunk events if they only want the bookend events.
 *
 * The event type is `SimulationEvent` (the discriminated union that
 * `OfflineCatchUpStartedEvent` / `OfflineCatchUpCompletedEvent` are members
 * of) — the array is heterogeneous by design, so a union of two array types
 * would not typecheck.
 */
export interface OfflineCatchUpResult {
  readonly state: GameState;
  readonly summary: OfflineSummary;
  readonly events: readonly SimulationEvent[];
}

/**
 * Deep read of the fields `OfflineSummary` tracks, taken from a single state.
 * Reading them once into a flat object lets the before/after delta builder
 * stay declarative and avoids re-walking the state tree per field.
 *
 * Field paths (confirmed against packages/shared/src/schemas/*.ts):
 *   biological: originalTree.{structure.height, structure.trunkDiameter,
 *                foliage.currentLeaves, energy.reserves, water.stored,
 *                health, stress, alive}
 *   economic:   player.personalCash, economy.{monetarySupply, inflationIndex,
 *                totalIssued, transactions.length}
 *   environmental: world.environment.{soil.soilWater,
 *                freshwater.availability, biodiversity.index, forestCoverage,
 *                globalTemperature, atmosphere.co2Concentration}
 *   clock:      clock.{elapsedSeconds, day}
 */
interface FieldSnapshot {
  // biological
  readonly height: number;
  readonly trunkDiameter: number;
  readonly currentLeaves: number;
  readonly energyReserves: number;
  readonly waterStored: number;
  readonly health: number;
  readonly stress: number;
  readonly alive: boolean;
  // economic
  readonly personalCash: string;
  readonly monetarySupply: string;
  readonly inflationIndex: number;
  readonly totalIssued: string;
  readonly transactionsCount: number;
  // environmental
  readonly soilWater: number;
  readonly freshwaterAvailability: number;
  readonly biodiversityIndex: number;
  readonly forestCoverage: number;
  readonly globalTemperature: number;
  readonly co2Concentration: number;
  // clock (for from/to bounds)
  readonly elapsedSeconds: number;
  readonly day: number;
}

function snapshotFields(state: GameState): FieldSnapshot {
  return {
    height: state.originalTree.structure.height,
    trunkDiameter: state.originalTree.structure.trunkDiameter,
    currentLeaves: state.originalTree.foliage.currentLeaves,
    energyReserves: state.originalTree.energy.reserves,
    waterStored: state.originalTree.water.stored,
    health: state.originalTree.health,
    stress: state.originalTree.stress,
    alive: state.originalTree.alive,
    personalCash: state.player.personalCash,
    monetarySupply: state.economy.monetarySupply,
    inflationIndex: state.economy.inflationIndex,
    totalIssued: state.economy.totalIssued,
    transactionsCount: state.economy.transactions.length,
    soilWater: state.world.environment.soil.soilWater,
    freshwaterAvailability: state.world.environment.freshwater.availability,
    biodiversityIndex: state.world.environment.biodiversity.index,
    forestCoverage: state.world.environment.forestCoverage,
    globalTemperature: state.world.environment.globalTemperature,
    co2Concentration: state.world.environment.atmosphere.co2Concentration,
    elapsedSeconds: state.clock.elapsedSeconds,
    day: state.clock.day,
  };
}

function numDelta(before: number, after: number): OfflineSummaryDelta {
  return { before, after, delta: after - before };
}

function boolDelta(before: boolean, after: boolean): OfflineBooleanDelta {
  return { before, after };
}

function strDelta(before: string, after: string): OfflineStringDelta {
  return { before, after };
}

/**
 * Build the full `OfflineSummary` from before/after field snapshots plus the
 * catch-up plan. Pure — no state reads beyond the two snapshots.
 */
function buildSummary(before: FieldSnapshot, after: FieldSnapshot, plan: OfflineCatchUpPlan): OfflineSummary {
  return {
    requestedRealMs: plan.requestedRealMs,
    cappedRealMs: plan.cappedRealMs,
    simElapsedSeconds: plan.simElapsedSeconds,
    chunksRun: plan.chunksPlanned,
    capped: plan.capped,
    // Always false on a returned summary — a tampered clock throws and no
    // summary is produced. The field exists so consumers switching on summary
    // shape have a complete view.
    clockTampered: false,
    fromSimSeconds: before.elapsedSeconds,
    toSimSeconds: after.elapsedSeconds,
    fromDay: before.day,
    toDay: after.day,
    biological: {
      height: numDelta(before.height, after.height),
      trunkDiameter: numDelta(before.trunkDiameter, after.trunkDiameter),
      currentLeaves: numDelta(before.currentLeaves, after.currentLeaves),
      energyReserves: numDelta(before.energyReserves, after.energyReserves),
      waterStored: numDelta(before.waterStored, after.waterStored),
      health: numDelta(before.health, after.health),
      stress: numDelta(before.stress, after.stress),
      alive: boolDelta(before.alive, after.alive),
    },
    economic: {
      personalCash: strDelta(before.personalCash, after.personalCash),
      monetarySupply: strDelta(before.monetarySupply, after.monetarySupply),
      inflationIndex: numDelta(before.inflationIndex, after.inflationIndex),
      totalIssued: strDelta(before.totalIssued, after.totalIssued),
      transactionsCount: numDelta(before.transactionsCount, after.transactionsCount),
    },
    environmental: {
      soilWater: numDelta(before.soilWater, after.soilWater),
      freshwaterAvailability: numDelta(before.freshwaterAvailability, after.freshwaterAvailability),
      biodiversityIndex: numDelta(before.biodiversityIndex, after.biodiversityIndex),
      forestCoverage: numDelta(before.forestCoverage, after.forestCoverage),
      globalTemperature: numDelta(before.globalTemperature, after.globalTemperature),
      co2Concentration: numDelta(before.co2Concentration, after.co2Concentration),
    },
  };
}

/**
 * Run the offline catch-up for a save loaded at real time `nowMs`.
 *
 * Algorithm (TDD §14.4):
 *   1–5. Compute the plan via `planOfflineCatchUp` (clock tamper check, cap,
 *        real→sim conversion, chunk count).
 *   6.  If `chunksPlanned === 0`: return a clone of the input with an empty
 *        summary (all deltas before==after, no events). `lastSimulatedAt` is
 *        NOT advanced — a zero-chunk catch-up simulated nothing, and advancing
 *        the marker for a within-tolerance backwards clock would move it
 *        backwards.
 *   7.  Snapshot the before-state; emit `offline-catch-up-started` at the
 *        pre-catch-up `clock.elapsedSeconds`.
 *   8.  Clone the state; for each chunk run `engine.advance(state, chunk)`,
 *        collecting chunk events.
 *   9.  Snapshot the after-state; build the summary; emit
 *        `offline-catch-up-completed` at the post-catch-up `clock.elapsedSeconds`.
 *  10.  Advance `state.metadata.lastSimulatedAt = nowMs` (the processor owns
 *        the save marker).
 *  11.  Return `{ state, summary, events: [started, ...chunkEvents, completed] }`.
 *
 * Determinism: same `(state, nowMs)` produces a bit-identical result across
 * calls (the engine is pure and seeded). See the determinism test.
 */
export function runOfflineCatchUp(state: GameState, nowMs: number): OfflineCatchUpResult {
  const plan = planOfflineCatchUp(state, nowMs);

  // Before-snapshot is read from the input state (the pre-catch-up reality).
  const before = snapshotFields(state);

  // Step 6 — zero-chunk short-circuit: empty summary, no events, no marker
  // advance. Return a clone so the caller gets a fresh object (purity).
  if (plan.chunksPlanned === 0) {
    const emptyState = deepCopy(state);
    const emptySummary = buildSummary(before, before, { ...plan, simElapsedSeconds: 0, chunksPlanned: 0 });
    return { state: emptyState, summary: emptySummary, events: [] };
  }

  // Step 7 — emit the started event at the pre-catch-up sim time.
  const startedEvent: OfflineCatchUpStartedEvent = {
    type: 'offline-catch-up-started',
    at: before.elapsedSeconds,
    payload: {
      requestedRealMs: plan.requestedRealMs,
      simElapsedSecondsPlanned: plan.simElapsedSeconds,
      chunksPlanned: plan.chunksPlanned,
      capped: plan.capped,
    },
  };

  // Step 8 — clone + chunked advance. The clone honours rule 2 (no input
  // mutation) explicitly; `engine.advance` also deep-copies on entry, so the
  // input is never touched.
  let work = deepCopy(state);
  const chunkEvents: SimulationEvent[] = [];
  for (let i = 0; i < plan.chunksPlanned; i++) {
    const result = engine.advance(work, PROVISIONAL_OFFLINE_CHUNK_SIM_SECONDS);
    work = result.state;
    if (result.events.length > 0) {
      for (const ev of result.events) {
        chunkEvents.push(ev);
      }
    }
  }

  // Step 9 — after-snapshot + summary.
  const after = snapshotFields(work);
  const summary = buildSummary(before, after, plan);

  const completedEvent: OfflineCatchUpCompletedEvent = {
    type: 'offline-catch-up-completed',
    at: after.elapsedSeconds,
    payload: { summary },
  };

  // Step 10 — advance the save marker. `work` is the engine's fresh return
  // value; we replace its metadata with an updated `lastSimulatedAt` without
  // mutating the input.
  work = {
    ...work,
    metadata: {
      ...work.metadata,
      lastSimulatedAt: nowMs,
    },
  };

  // Step 11 — full event stream: bookend events + chunk events in order.
  const events: SimulationEvent[] = [startedEvent, ...chunkEvents, completedEvent];

  return { state: work, summary, events };
}
