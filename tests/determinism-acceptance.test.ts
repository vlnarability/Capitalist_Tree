/**
 * Determinism acceptance test (TDD §21 #15 — closes GAP-14).
 *
 * TDD §21 acceptance criterion #15: "Simulation results are deterministic
 * under identical inputs." This is the end-to-end acceptance test that pins
 * that contract at the engine boundary — it runs the FULL 12-system pipeline
 * (not a single subsystem) over a meaningful duration and asserts byte-
 * identical state + events across independent runs from the same seed.
 *
 * What "identical inputs" means here (and what this test pins):
 *
 *   1. Same seed → identical state AND identical events, over a run long
 *      enough to exercise season changes, weather Markov transitions,
 *      biology growth, resource flux, economy ticks, business cycles,
 *      environment evolution, + event-system fires (10,000 steps ≈ 6.9 sim
 *      days — spans a weather-condition change + multiple system cycles).
 *   2. Save → load → advance is equivalent to advancing the same total
 *      duration from a fresh start (the serialization round-trip preserves
 *      every field that affects the trajectory, including RNG sub-streams).
 *   3. Splittability: advancing N steps then M steps reaches the same state
 *      as advancing (N+M) in one call (the per-step pipeline is stateless
 *      w.r.t. call boundaries — no hidden accumulator).
 *   4. Different seeds → different states (sanity: the seed is actually
 *      wired into the RNG, not ignored).
 *
 * This file lives at the repo root (not under packages/simulation/test)
 * because it is a cross-cutting acceptance criterion, not a unit test of any
 * one package. It imports the engine via the `@simulation` alias (the same
 * alias the web app + other packages use), proving the contract holds at the
 * public API boundary.
 */
import { describe, it, expect } from 'vitest';
import { engine, InMemoryStorage } from '@simulation';
import { DEFAULT_GAME_CONFIG } from '@simulation/initial-state.js';
import {
  type GameConfig,
  PROVISIONAL_SIMULATION_STEP_SECONDS as STEP,
} from '@shared';

/** Build a config with a fixed seed + zero createdAt (deterministic). */
function cfg(seed: number): GameConfig {
  return { ...DEFAULT_GAME_CONFIG, seed, createdAt: 0 };
}

/**
 * Run duration: 10,000 steps (≈ 6.9 sim days at 60s/step). Long enough to
 * span weather-condition changes, a full day/night cycle, multiple economy
 * ticks, + event-system fires; short enough to stay CI-friendly (~5s via
 * the full 12-system engine on the default config). The determinism
 * contract is binary — if it holds for 10K steps it holds for any N (the
 * pipeline is a pure function of (state, ctx) per step).
 */
const RUN_STEPS = 10_000;
const RUN_SECONDS = RUN_STEPS * STEP;

describe('TDD §21 #15 — Simulation determinism acceptance', () => {
  it('same seed → identical state AND identical events over a full-pipeline run', () => {
    const a0 = engine.initialize(cfg(42));
    const a1 = engine.advance(a0, RUN_SECONDS);

    const b0 = engine.initialize(cfg(42));
    const b1 = engine.advance(b0, RUN_SECONDS);

    // The entire GameState (clock, world, originalTree, economy, businesses,
    // personal, eventState, generationHistory, rngState, rngStreams, …) must
    // be deep-equal. A single differing float anywhere fails the contract.
    expect(a1.state).toEqual(b1.state);
    // The emitted SimulationEvent stream must also match — event ordering +
    // payloads are part of the deterministic contract (the UI renders them).
    expect(a1.events).toEqual(b1.events);
    // consumedSeconds (the engine's reported progress) must agree.
    expect(a1.consumedSeconds).toBe(b1.consumedSeconds);
  });

  it('save → load → advance is equivalent to advancing the same total from start', async () => {
    // Run A: advance 5000, save, load, advance 5000 more.
    const a0 = engine.initialize(cfg(42));
    const a1 = engine.advance(a0, RUN_SECONDS / 2);
    const storage = new InMemoryStorage();
    await storage.save(a1.state);
    const loaded = await storage.load();
    expect(loaded).not.toBeNull();
    const a2 = engine.advance(loaded!, RUN_SECONDS / 2);

    // Run B: advance the full 10000 from a fresh start.
    const b0 = engine.initialize(cfg(42));
    const b1 = engine.advance(b0, RUN_SECONDS);

    // The serialization round-trip must preserve every field that affects
    // the trajectory — including the per-system RNG sub-streams
    // (rngStreams.weather/biology/…), which a naive save would lose.
    expect(a2.state).toEqual(b1.state);
  });

  it('splittability: advance(N) then advance(M) deepEquals advance(N+M)', () => {
    const a0 = engine.initialize(cfg(42));
    const a1 = engine.advance(a0, RUN_SECONDS / 4);
    const a2 = engine.advance(a1.state, RUN_SECONDS / 4);

    const b0 = engine.initialize(cfg(42));
    const b1 = engine.advance(b0, RUN_SECONDS / 2);

    // The per-step pipeline must not depend on how the caller chunks the
    // advance calls — no hidden accumulator or between-call state. This is
    // what makes offline catch-up (chunked replay) equivalent to live play.
    expect(a2.state).toEqual(b1.state);
  });

  it('different seeds → different states (the seed is wired into the RNG)', () => {
    const a = engine.advance(engine.initialize(cfg(42)), RUN_SECONDS);
    const b = engine.advance(engine.initialize(cfg(999)), RUN_SECONDS);

    // Sanity for the determinism test itself: if different seeds produced
    // the same state, "same seed → same state" would be trivially true
    // (everything is constant) + meaningless. The seed must perturb the
    // trajectory via the RNG.
    expect(a.state).not.toEqual(b.state);
  });
});
