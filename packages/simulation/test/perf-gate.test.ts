/**
 * P11 (W29 / GAP-41): per-tick profiler + CI perf regression gate.
 *
 * Two concerns:
 *   1. The profiler works — enabling it records per-system timings for a step.
 *   2. A perf regression gate — running N ticks stays under a per-tick budget.
 *      Catches a future change that makes a system O(n²) or accidentally
 *      synchronous-blocking. The budget is generous (CI runners vary) but
 *      tight enough to catch gross regressions.
 *
 * The gate runs 100 ticks on a fresh state (a realistic midgame load: tree +
 * economy + regions seeded) + asserts the average per-tick time stays under
 * the budget. Profiling is enabled so per-system timings are recorded (the
 * test can report which system is slow if the gate trips).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  engine,
  setProfilerEnabled,
  isProfilerEnabled,
  getProfilerLastStep,
  DEFAULT_GAME_CONFIG,
} from '../src/index.js';
import { PROVISIONAL_SIMULATION_STEP_SECONDS as STEP } from '@capitalist-tree/shared';

/** Per-tick budget (ms). Generous for CI runners; catches gross regressions. */
const PER_TICK_BUDGET_MS = 50;
/** Ticks to run for the perf gate. */
const PERF_GATE_TICKS = 100;

describe('P11 W29 — per-tick profiler', () => {
  it('setProfilerEnabled toggles the flag + getProfilerLastStep records timings', () => {
    setProfilerEnabled(false);
    expect(isProfilerEnabled()).toBe(false);
    expect(getProfilerLastStep()).toBe(null);

    setProfilerEnabled(true);
    expect(isProfilerEnabled()).toBe(true);

    // Run one step; the profiler should record per-system timings.
    const state = engine.initialize(DEFAULT_GAME_CONFIG);
    engine.advance(state, STEP);
    const profile = getProfilerLastStep();
    expect(profile).not.toBe(null);
    expect(profile!.steps).toBe(1);
    expect(profile!.totalMs).toBeGreaterThanOrEqual(0);
    // At least the TimeSystem should have a timing entry.
    expect(profile!.systems['TimeSystem']).toBeGreaterThanOrEqual(0);

    setProfilerEnabled(false);
  });

  it('profiling is zero-overhead when disabled (lastProfile stays null)', () => {
    setProfilerEnabled(false);
    const state = engine.initialize(DEFAULT_GAME_CONFIG);
    engine.advance(state, STEP);
    expect(getProfilerLastStep()).toBe(null);
  });
});

describe('P11 W29 — CI perf regression gate', () => {
  beforeAll(() => setProfilerEnabled(true));
  afterAll(() => setProfilerEnabled(false));

  it(`running ${PERF_GATE_TICKS} ticks stays under ${PER_TICK_BUDGET_MS}ms/tick average`, () => {
    let state = engine.initialize(DEFAULT_GAME_CONFIG);
    // Warm up one step (seeds regions via EventSystem, etc.).
    state = engine.advance(state, STEP).state;

    const start = performance.now();
    for (let i = 0; i < PERF_GATE_TICKS; i++) {
      state = engine.advance(state, STEP).state;
    }
    const elapsedMs = performance.now() - start;
    const avgPerTickMs = elapsedMs / PERF_GATE_TICKS;

    // Report per-system timings from the last step (helps diagnose a trip).
    const lastProfile = getProfilerLastStep();
    if (lastProfile) {
      const slowest = Object.entries(lastProfile.systems).sort((a, b) => b[1] - a[1])[0];
      if (slowest) {
        // eslint-disable-next-line no-console
        console.log(
          `[perf-gate] avg ${avgPerTickMs.toFixed(2)}ms/tick, ` +
            `slowest system: ${slowest[0]} (${slowest[1].toFixed(2)}ms)`,
        );
      }
    }

    expect(avgPerTickMs).toBeLessThan(PER_TICK_BUDGET_MS);
  });
});
