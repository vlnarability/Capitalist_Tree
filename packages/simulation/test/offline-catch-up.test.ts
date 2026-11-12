import { describe, it, expect } from 'vitest';
import {
  engine,
  deepCopy,
  runOfflineCatchUp,
  planOfflineCatchUp,
  DEFAULT_GAME_CONFIG,
} from '../src/index.js';
import type { GameState } from '@capitalist-tree/shared';
import {
  OfflineClockTamperedError,
  PROVISIONAL_OFFLINE_MAX_REAL_INTERVAL_MS,
  PROVISIONAL_OFFLINE_CHUNK_SIM_SECONDS,
  PROVISIONAL_OFFLINE_BACKWARDS_CLOCK_TOLERANCE_MS,
  PROVISIONAL_OFFLINE_DIVERGENCE_TOLERANCE,
  PROVISIONAL_REAL_TO_SIM_SECONDS,
  serialize,
  deserialize,
} from '@capitalist-tree/shared';

/**
 * Offline catch-up processor tests (P6a — TDD §14.4, GDD §4.2).
 *
 * Real→sim conversion note: the processor uses `PROVISIONAL_REAL_TO_SIM_SECONDS`
 * (= 60), the SAME factor the live apps/web accumulator uses
 * (`realDelta * 60 * speed`). This keeps offline catch-up consistent with live
 * progression. At factor 60:
 *   - 1 real second = 60 sim seconds
 *   - 1 real hour   = 216_000 sim sec = 2.5 sim days → floored to 2 chunks
 *   - 24 real min   =  86_400 sim sec = 1 sim day   → 1 chunk
 *   - 30 real days  = 155_520_000 sim sec            → 1800 chunks (the cap)
 * The task brief's "1 real hour = 1 sim day = 1 chunk" / "720 chunks for 30
 * days" used a factor of 24 and are arithmetically inconsistent with the
 * constant 60 (and with the live accumulator). The tests below assert the
 * correct factor-60 values.
 */

const CHUNK = PROVISIONAL_OFFLINE_CHUNK_SIM_SECONDS; // 86_400 sim sec = 1 sim day
const REAL_TO_SIM = PROVISIONAL_REAL_TO_SIM_SECONDS; // 60

/** Real ms that convert to exactly N chunks (N sim days). */
function realMsForChunks(n: number): number {
  return (n * CHUNK) / REAL_TO_SIM * 1000;
}

function freshState(seed = 42): GameState {
  return engine.initialize({ ...DEFAULT_GAME_CONFIG, seed, createdAt: 0 });
}

/** One real hour → 2 chunks at factor 60. */
const ONE_REAL_HOUR_MS = 60 * 60 * 1000;
/** Two chunks of sim time (2 sim days). */
const TWO_CHUNKS_SIM_SEC = 2 * CHUNK;

describe('runOfflineCatchUp — zero / no-op cases', () => {
  it('zero elapsed (nowMs === lastSimulatedAt): empty summary, no events, marker unchanged', () => {
    const s = freshState();
    const T = s.metadata.lastSimulatedAt;
    const r = runOfflineCatchUp(s, T);

    expect(r.summary.chunksRun).toBe(0);
    expect(r.summary.simElapsedSeconds).toBe(0);
    expect(r.summary.capped).toBe(false);
    expect(r.summary.clockTampered).toBe(false);
    expect(r.summary.requestedRealMs).toBe(0);
    expect(r.summary.cappedRealMs).toBe(0);
    expect(r.events).toEqual([]);
    // Before == after: every delta is zero / unchanged.
    expect(r.summary.biological.height.delta).toBe(0);
    expect(r.summary.biological.alive.before).toBe(r.summary.biological.alive.after);
    expect(r.summary.economic.personalCash.before).toBe(r.summary.economic.personalCash.after);
    // Marker NOT advanced on a zero-chunk catch-up.
    expect(r.state.metadata.lastSimulatedAt).toBe(T);
    // Returned state is a fresh clone, structurally equal to the input.
    expect(r.state).not.toBe(s);
    expect(r.state).toEqual(s);
  });

  it('small backwards clock within tolerance (nowMs = lastSimulatedAt - 500): empty summary, no throw', () => {
    const s = freshState();
    const T = s.metadata.lastSimulatedAt;
    const r = runOfflineCatchUp(s, T - 500);

    expect(r.summary.chunksRun).toBe(0);
    expect(r.summary.requestedRealMs).toBe(0); // treated as zero
    expect(r.summary.clockTampered).toBe(false);
    expect(r.events).toEqual([]);
    // Marker unchanged (no backwards movement).
    expect(r.state.metadata.lastSimulatedAt).toBe(T);
  });

  it('backwards clock within exactly the tolerance boundary is treated as zero (no throw)', () => {
    const s = freshState();
    const T = s.metadata.lastSimulatedAt;
    const r = runOfflineCatchUp(s, T - PROVISIONAL_OFFLINE_BACKWARDS_CLOCK_TOLERANCE_MS);
    expect(r.summary.chunksRun).toBe(0);
    expect(r.state.metadata.lastSimulatedAt).toBe(T);
  });

  it('backwards clock beyond tolerance (nowMs = lastSimulatedAt - 60_000): throws OfflineClockTamperedError', () => {
    const s = freshState();
    const T = s.metadata.lastSimulatedAt;
    expect(() => runOfflineCatchUp(s, T - 60_000)).toThrow(OfflineClockTamperedError);
    // The planner throws the same way.
    expect(() => planOfflineCatchUp(s, T - 60_000)).toThrow(OfflineClockTamperedError);
  });

  it('a tiny positive interval that rounds to 0 chunks yields an empty summary', () => {
    const s = freshState();
    const T = s.metadata.lastSimulatedAt;
    // 500 real ms → floor(0.5 * 60) = 30 sim sec → floored to 0 chunks.
    const r = runOfflineCatchUp(s, T + 500);
    expect(r.summary.chunksRun).toBe(0);
    expect(r.summary.requestedRealMs).toBe(500);
    expect(r.summary.cappedRealMs).toBe(500);
    expect(r.events).toEqual([]);
    expect(r.state.metadata.lastSimulatedAt).toBe(T);
  });
});

describe('runOfflineCatchUp — normal catch-up (1 real hour → 2 chunks at factor 60)', () => {
  it('runs 2 chunks, emits started+completed bookends, advances the marker', () => {
    const s = freshState();
    const T = s.metadata.lastSimulatedAt;
    const nowMs = T + ONE_REAL_HOUR_MS;
    const r = runOfflineCatchUp(s, nowMs);

    expect(r.summary.chunksRun).toBe(2);
    expect(r.summary.simElapsedSeconds).toBe(TWO_CHUNKS_SIM_SEC);
    expect(r.summary.capped).toBe(false);
    expect(r.summary.requestedRealMs).toBe(ONE_REAL_HOUR_MS);
    expect(r.summary.cappedRealMs).toBe(ONE_REAL_HOUR_MS);

    // Bookend events present, in order: started first, completed last.
    expect(r.events.length).toBeGreaterThanOrEqual(2);
    expect(r.events[0]?.type).toBe('offline-catch-up-started');
    expect(r.events.at(-1)?.type).toBe('offline-catch-up-completed');

    // Started event payload carries the plan; fired at the pre-catch-up sim time.
    const started = r.events[0]!;
    expect(started.at).toBe(s.clock.elapsedSeconds);
    expect(started.payload).toEqual({
      requestedRealMs: ONE_REAL_HOUR_MS,
      simElapsedSecondsPlanned: TWO_CHUNKS_SIM_SEC,
      chunksPlanned: 2,
      capped: false,
    });

    // Completed event payload carries the summary; fired at the post-catch-up sim time.
    const completed = r.events.at(-1)!;
    expect(completed.at).toBe(s.clock.elapsedSeconds + TWO_CHUNKS_SIM_SEC);
    expect(completed.payload.summary).toEqual(r.summary);

    // Sim time actually advanced by the chunked run.
    expect(r.summary.toSimSeconds).toBe(s.clock.elapsedSeconds + TWO_CHUNKS_SIM_SEC);
    expect(r.summary.fromSimSeconds).toBe(s.clock.elapsedSeconds);
    expect(r.summary.toDay).toBeGreaterThan(r.summary.fromDay);

    // The processor owns the save marker.
    expect(r.state.metadata.lastSimulatedAt).toBe(nowMs);
    expect(r.state.clock.elapsedSeconds).toBe(s.clock.elapsedSeconds + TWO_CHUNKS_SIM_SEC);
  });

  it('populates biological / economic / environmental deltas with before/after', () => {
    const s = freshState();
    const T = s.metadata.lastSimulatedAt;
    const r = runOfflineCatchUp(s, T + ONE_REAL_HOUR_MS);

    // Structural: every numeric delta has finite before/after/delta.
    const numOk = (d: { before: number; after: number; delta: number }) =>
      Number.isFinite(d.before) && Number.isFinite(d.after) && Number.isFinite(d.delta) && d.delta === d.after - d.before;
    expect(numOk(r.summary.biological.height)).toBe(true);
    expect(numOk(r.summary.biological.trunkDiameter)).toBe(true);
    expect(numOk(r.summary.biological.currentLeaves)).toBe(true);
    expect(numOk(r.summary.biological.energyReserves)).toBe(true);
    expect(numOk(r.summary.biological.waterStored)).toBe(true);
    expect(numOk(r.summary.biological.health)).toBe(true);
    expect(numOk(r.summary.biological.stress)).toBe(true);
    expect(numOk(r.summary.economic.inflationIndex)).toBe(true);
    expect(numOk(r.summary.economic.transactionsCount)).toBe(true);
    expect(numOk(r.summary.environmental.soilWater)).toBe(true);
    expect(numOk(r.summary.environmental.freshwaterAvailability)).toBe(true);
    expect(numOk(r.summary.environmental.biodiversityIndex)).toBe(true);
    expect(numOk(r.summary.environmental.forestCoverage)).toBe(true);
    expect(numOk(r.summary.environmental.globalTemperature)).toBe(true);
    expect(numOk(r.summary.environmental.co2Concentration)).toBe(true);

    // Money fields are bigint-as-string before/after.
    expect(typeof r.summary.economic.personalCash.before).toBe('string');
    expect(typeof r.summary.economic.personalCash.after).toBe('string');
    expect(typeof r.summary.economic.monetarySupply.before).toBe('string');
    expect(typeof r.summary.economic.totalIssued.before).toBe('string');

    // alive is a boolean delta.
    expect(typeof r.summary.biological.alive.before).toBe('boolean');
    expect(typeof r.summary.biological.alive.after).toBe('boolean');

    // Real simulation ran: at least one biological or environmental quantity
    // changed over 2 sim days (reserves/water/soil water fluctuate per tick).
    const someChange =
      r.summary.biological.energyReserves.delta !== 0 ||
      r.summary.biological.waterStored.delta !== 0 ||
      r.summary.environmental.soilWater.delta !== 0 ||
      r.summary.biological.currentLeaves.delta !== 0;
    expect(someChange).toBe(true);
  });

  it('summary.chunksRun === plan.chunksPlanned (plan ↔ execution consistency)', () => {
    const s = freshState();
    const T = s.metadata.lastSimulatedAt;
    const nowMs = T + ONE_REAL_HOUR_MS;
    const plan = planOfflineCatchUp(s, nowMs);
    const r = runOfflineCatchUp(s, nowMs);
    expect(r.summary.chunksRun).toBe(plan.chunksPlanned);
    expect(r.summary.simElapsedSeconds).toBe(plan.simElapsedSeconds);
    expect(r.summary.capped).toBe(plan.capped);
  });
});

describe('runOfflineCatchUp — cap safeguard (TDD §14.4 step 4)', () => {
  it('a 60-real-day interval is capped at 30 real days → 1800 planned chunks (factor 60)', () => {
    const s = freshState();
    const T = s.metadata.lastSimulatedAt;
    const sixtyRealDaysMs = 60 * 24 * 60 * 60 * 1000;
    const thirtyRealDaysMs = PROVISIONAL_OFFLINE_MAX_REAL_INTERVAL_MS;

    // Use the pure planner so the cap math is verified without executing
    // 1800 chunks (≈ minutes of engine time — infeasible in a test). The
    // plan↔execution consistency test above proves chunksPlanned would run.
    const plan = planOfflineCatchUp(s, T + sixtyRealDaysMs);

    expect(plan.capped).toBe(true);
    expect(plan.requestedRealMs).toBe(sixtyRealDaysMs);
    expect(plan.cappedRealMs).toBe(thirtyRealDaysMs);
    // 30 real days × 60 sim sec/real sec = 155_520_000 sim sec = 1800 sim days.
    expect(plan.simElapsedSeconds).toBe(thirtyRealDaysMs / 1000 * REAL_TO_SIM);
    expect(plan.simElapsedSeconds).toBe(1800 * CHUNK);
    expect(plan.chunksPlanned).toBe(1800);
  });

  it('an interval just under the cap is NOT capped', () => {
    const s = freshState();
    const T = s.metadata.lastSimulatedAt;
    const justUnder = PROVISIONAL_OFFLINE_MAX_REAL_INTERVAL_MS - 1;
    const plan = planOfflineCatchUp(s, T + justUnder);
    expect(plan.capped).toBe(false);
    expect(plan.cappedRealMs).toBe(justUnder);
  });
});

describe('runOfflineCatchUp — determinism (TDD §18.3)', () => {
  it('same (state, nowMs) → identical summary, state, and events across calls', () => {
    const s = freshState();
    const T = s.metadata.lastSimulatedAt;
    const nowMs = T + ONE_REAL_HOUR_MS;

    const a = runOfflineCatchUp(s, nowMs);
    const b = runOfflineCatchUp(s, nowMs);

    expect(a.summary).toEqual(b.summary);
    expect(a.state).toEqual(b.state);
    expect(a.events).toEqual(b.events);
  });
});

describe('runOfflineCatchUp — splittability / divergence (TDD §18.3)', () => {
  it('chunked advance (2 × chunk) deepEquals single advance (2 × chunk) — divergence 0', () => {
    // The catch-up processor relies on the engine's splittability invariant:
    // advance(advance(s, X).state, Y) === advance(s, X + Y). Assert it at the
    // offline chunk size (86_400) so the chunked catch-up is provably equal to
    // one big advance. This is the "chunked ≈ single" divergence check; it
    // lives in the test, not in the production path.
    const base = freshState(11);
    const X = CHUNK;
    const Y = CHUNK;

    let chunked = base;
    chunked = engine.advance(chunked, X).state;
    chunked = engine.advance(chunked, Y).state;

    const single = engine.advance(base, X + Y).state;

    // Bit-identical state (engine is pure + deterministic).
    expect(chunked).toEqual(single);

    // Explicit divergence on key numeric fields — all 0, well within tolerance.
    const div = (a: number, b: number) => Math.abs(a - b);
    expect(div(chunked.originalTree.structure.height, single.originalTree.structure.height)).toBeLessThan(
      PROVISIONAL_OFFLINE_DIVERGENCE_TOLERANCE,
    );
    expect(div(chunked.originalTree.energy.reserves, single.originalTree.energy.reserves)).toBeLessThan(
      PROVISIONAL_OFFLINE_DIVERGENCE_TOLERANCE,
    );
    expect(div(chunked.world.environment.atmosphere.co2Concentration, single.world.environment.atmosphere.co2Concentration)).toBeLessThan(
      PROVISIONAL_OFFLINE_DIVERGENCE_TOLERANCE,
    );
    expect(div(chunked.economy.inflationIndex, single.economy.inflationIndex)).toBeLessThan(
      PROVISIONAL_OFFLINE_DIVERGENCE_TOLERANCE,
    );
  });

  it('runOfflineCatchUp (chunked) reaches the same state as one engine.advance of the same sim seconds', () => {
    // End-to-end: the processor's chunked advance lands on the same state a
    // single advance of (chunks × chunk) would — minus the processor's
    // metadata.lastSimulatedAt update and bookend events (which the engine
    // alone does not produce).
    const base = freshState(7);
    const T = base.metadata.lastSimulatedAt;
    const nowMs = T + ONE_REAL_HOUR_MS; // 2 chunks

    const r = runOfflineCatchUp(base, nowMs);
    const single = engine.advance(base, TWO_CHUNKS_SIM_SEC).state;

    // Strip the processor-only metadata update so the comparison is over the
    // simulated state.
    const { ...simState } = r.state;
    const expected = { ...single, metadata: { ...single.metadata, lastSimulatedAt: nowMs } };
    expect(simState).toEqual(expected);
  });
});

describe('runOfflineCatchUp — save/load round-trip', () => {
  it('serialize → deserialize → run again with nowMs+1h yields a non-empty second summary', async () => {
    const s0 = freshState();
    const T0 = s0.metadata.lastSimulatedAt; // 0
    const nowMs1 = T0 + ONE_REAL_HOUR_MS;

    // First catch-up advances the marker to nowMs1.
    const r1 = runOfflineCatchUp(s0, nowMs1);
    expect(r1.state.metadata.lastSimulatedAt).toBe(nowMs1);

    // Round-trip through the save envelope.
    const loaded = deserialize(serialize(r1.state));
    expect(loaded).toEqual(r1.state);

    // Second catch-up: nowMs advanced by another hour. Because the marker was
    // advanced to nowMs1, the second call sees a fresh 1-hour gap → non-empty.
    const nowMs2 = nowMs1 + ONE_REAL_HOUR_MS;
    const r2 = runOfflineCatchUp(loaded, nowMs2);
    expect(r2.summary.chunksRun).toBe(2);
    expect(r2.summary.simElapsedSeconds).toBe(TWO_CHUNKS_SIM_SEC);
    expect(r2.state.metadata.lastSimulatedAt).toBe(nowMs2);
  });
});

describe('runOfflineCatchUp — originalTree.alive transition (GDD §5.6)', () => {
  /**
   * Tree death (packages/simulation/src/biology/death.ts) is stochastic:
   * `rng.next() < prob` with a per-day probability. It cannot be triggered
   * deterministically in a single chunk for an arbitrary seed. But the engine
   * is deterministic given (seed, state): for seed=3, a fully crippled tree
   * (stress=1, reserves=0, water=0, no leaves, + 2 severe-defoliation events
   * within the 60-day window) dies on the FIRST 1-sim-day chunk. So a 1-chunk
   * catch-up (24 real minutes at factor 60) deterministically flips
   * alive: true → false. Verified empirically before writing this test.
   */
  function crippled(seed: number): GameState {
    const s = engine.initialize({ ...DEFAULT_GAME_CONFIG, seed, createdAt: 0 });
    const t = s.originalTree;
    return {
      ...s,
      originalTree: {
        ...t,
        alive: true,
        stress: 1,
        health: 0,
        energy: { ...t.energy, reserves: 0, production: 0, consumption: 0 },
        water: { ...t.water, stored: 0 },
        foliage: { ...t.foliage, currentLeaves: 0 },
        damage: [
          { type: 'severe-defoliation', severity: 1, appliedAt: s.clock.elapsedSeconds },
          { type: 'severe-defoliation', severity: 1, appliedAt: s.clock.elapsedSeconds },
        ],
      },
    };
  }

  it('a starved tree dies during a 1-chunk catch-up: alive.before === true, alive.after === false', () => {
    const s = crippled(3);
    expect(s.originalTree.alive).toBe(true);
    const T = s.metadata.lastSimulatedAt;
    // 24 real minutes → 1 sim day → 1 chunk.
    const nowMs = T + realMsForChunks(1);
    const r = runOfflineCatchUp(s, nowMs);

    expect(r.summary.chunksRun).toBe(1);
    expect(r.summary.biological.alive.before).toBe(true);
    expect(r.summary.biological.alive.after).toBe(false);
    expect(r.state.originalTree.alive).toBe(false);

    // The engine's tree-died event is in the chunk event stream (between the
    // started and completed bookends).
    const chunkEvents = r.events.slice(1, -1);
    expect(chunkEvents.some((e) => e.type === 'tree-died')).toBe(true);
  });
});

describe('runOfflineCatchUp — purity (rule 2: no input mutation)', () => {
  function deepFreeze<T>(v: T): T {
    if (v && typeof v === 'object') {
      for (const k of Object.keys(v as Record<string, unknown>)) {
        deepFreeze((v as Record<string, unknown>)[k] as unknown);
      }
      Object.freeze(v);
    }
    return v;
  }

  it('does not mutate its input state (strict-mode freeze would surface any mutation)', () => {
    const s = deepFreeze(deepCopy(freshState()));
    const T = s.metadata.lastSimulatedAt;
    expect(() => runOfflineCatchUp(s, T + ONE_REAL_HOUR_MS)).not.toThrow();
    // Input is structurally unchanged.
    expect(s).toEqual(freshState());
  });
});
