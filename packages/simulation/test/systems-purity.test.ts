/**
 * P11 (W19 / RV1-6): per-system purity tests.
 *
 * For each of the 12 systems in `defaultSystems`, deep-freeze a fresh
 * GameState, run the system's `execute`, + assert it does NOT throw (a
 * mutation attempt on a frozen object throws TypeError in strict mode). This
 * catches any system that mutates its input instead of returning a fresh
 * state — the purity contract (rule 2) every system must honor.
 *
 * The test is deliberately per-system (not via `engine.advance`) so a
 * mutation in one system is attributed precisely. The frozen state is a
 * deep-frozen clone of a fresh-initialized state (deep-frozen so nested
 * mutations surface, not just top-level reassignment).
 */
import { describe, it, expect } from 'vitest';
import { engine, defaultSystems, DEFAULT_GAME_CONFIG } from '../src/index.js';
import { Rng } from '../src/rng.js';
import type { SystemContext } from '../src/systems/system.js';
import { PROVISIONAL_SIMULATION_STEP_SECONDS as STEP } from '@capitalist-tree/shared';
import type { GameState } from '@capitalist-tree/shared';

/** Recursively freeze an object + all nested objects/arrays. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    if (Array.isArray(value)) {
      for (const el of value) deepFreeze(el);
    } else {
      for (const k of Object.keys(value as Record<string, unknown>)) {
        deepFreeze((value as Record<string, unknown>)[k]);
      }
    }
    Object.freeze(value);
  }
  return value;
}

function freshState(): GameState {
  return engine.initialize(DEFAULT_GAME_CONFIG);
}

/** Build a SystemContext matching the engine's runOneStep construction. */
function makeCtx(state: GameState): SystemContext {
  return {
    now: state.clock.elapsedSeconds + STEP,
    stepSeconds: STEP,
    dayOfYear: state.clock.day,
    rng: Rng.fromState(state.rngState),
  };
}

describe('P11 W19 — per-system purity (Object.freeze, no input mutation)', () => {
  // One test per system so failures attribute precisely.
  for (const system of defaultSystems) {
    it(`${system.id} does not mutate its frozen input state`, () => {
      const state = deepFreeze(JSON.parse(JSON.stringify(freshState())) as GameState);
      const ctx = makeCtx(state);
      // A mutation attempt on a frozen object throws TypeError in strict
      // mode. The system MUST return a fresh state + never touch the input.
      expect(() => system.execute(state, ctx)).not.toThrow();
    });
  }

  it('all 12 default systems are covered', () => {
    // Guard against a future system being added to defaultSystems without a
    // corresponding purity test (the for-loop above auto-covers new systems,
    // but this assertion makes the count explicit).
    expect(defaultSystems.length).toBe(12);
    expect(defaultSystems.map((s) => s.id)).toEqual([
      'TimeSystem',
      'WeatherSystem',
      'BiologySystem',
      'ResourceSystem',
      'HarvestSystem',
      'EconomySystem',
      'PersonalSystem',
      'BusinessSystem',
      'AutomationSystem',
      'EnvironmentSystem',
      'ProgressionSystem',
      'EventSystem',
    ]);
  });
});
