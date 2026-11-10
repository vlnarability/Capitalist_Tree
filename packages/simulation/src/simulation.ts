/**
 * SimulationEngine (TDD §4.1).
 *
 *   initialize(config)         -> GameState
 *   advance(state, seconds)    -> SimulationResult { state, events }
 *   executeAction(state, action) -> SimulationResult { state, events }
 *
 * Purity contract (TDD §4.1):
 *   - `advance` and `executeAction` NEVER mutate the input state. They deep-copy
 *     on entry and return a fresh state object.
 *   - All randomness flows through the seeded RNG reconstructed from
 *     `state.rngState`. No Math.random(), no Date.now() inside `advance`.
 *   - The RNG position is persisted in the returned state so the next call
 *     picks up where this one left off (determinism across calls + save/load).
 *
 * Fixed timestep (TDD §6.2/6.3):
 *   - `advance(state, elapsedSeconds)` internally breaks `elapsedSeconds` into
 *     `floor(elapsedSeconds / SIMULATION_STEP_SECONDS)` whole steps. Any
 *     remainder is dropped at this layer — the consumer (apps/web) tracks it
 *     in an accumulator.
 *   - Each step: rebuild Rng from state.rngState -> run all systems in registry
 *     order -> fire due scheduled events -> persist Rng state -> append events.
 *
 * Pause contract:
 *   - `advance` does NOT short-circuit on `clock.paused`. The accumulator in
 *     apps/web is responsible for not calling `advance` while paused. This
 *     keeps the engine pure and makes pause purely a UI concern.
 *
 * Splittability:
 *   - For any X, Y that are multiples of SIMULATION_STEP_SECONDS:
 *       advance(advance(s, X).state, Y) deepEquals advance(s, X + Y)
 *     in both state and events. This is the deterministic splittability test.
 *   - When X or Y is NOT a multiple of the step, the remainder is dropped,
 *     so splittability holds only for whole-step inputs.
 */
import type {
  GameAction,
  GameConfig,
  GameState,
  SimulationEvent,
} from '@capitalist-tree/shared';
import { PROVISIONAL_SIMULATION_STEP_SECONDS } from '@capitalist-tree/shared';
import { Rng } from './rng.js';
import { deepCopy } from './deep-copy.js';
import { defaultRegistry } from './systems/index.js';
import type { SystemContext, SystemResult } from './systems/system.js';
import { due as dueEvents } from './events/scheduler.js';
import { dispatch } from './actions/handlers.js';
import { initializeState } from './initial-state.js';

export interface SimulationResult {
  readonly state: GameState;
  readonly events: readonly SimulationEvent[];
  /** Number of simulation seconds actually consumed (multiple of SIMULATION_STEP_SECONDS). */
  readonly consumedSeconds: number;
}

export interface SimulationEngine {
  initialize(config: GameConfig): GameState;
  advance(state: GameState, elapsedSeconds: number): SimulationResult;
  executeAction(state: GameState, action: GameAction): SimulationResult;
}

const STEP = PROVISIONAL_SIMULATION_STEP_SECONDS;

function runOneStep(state: GameState, stepSeconds: number): SystemResult {
  // Rebuild RNG from persisted state so the position survives across calls.
  const rng = Rng.fromState(state.rngState);
  const ctx: SystemContext = {
    now: state.clock.elapsedSeconds + stepSeconds,
    stepSeconds,
    dayOfYear: state.clock.day,
    rng,
  };

  let next: GameState = state;
  const events: SimulationEvent[] = [];

  for (const system of defaultRegistry.all()) {
    const result = system.execute(next, ctx);
    next = result.state;
    if (result.events.length > 0) {
      events.push(...result.events);
    }
  }

  // Fire scheduled events whose `at` has been reached by the new clock.
  const fired = dueEvents(next, next.clock.elapsedSeconds);
  next = fired.state;
  for (const ev of fired.fired) {
    events.push({
      type: 'scheduled-event',
      at: next.clock.elapsedSeconds,
      payload: {
        eventId: ev.id,
        kind: ev.kind,
        data: ev.payload,
      },
    });
  }

  // Persist RNG position.
  next = { ...next, rngState: rng.getState() };

  return { state: next, events };
}

export const engine: SimulationEngine = {
  initialize(config: GameConfig): GameState {
    return initializeState(config);
  },

  advance(state: GameState, elapsedSeconds: number): SimulationResult {
    if (elapsedSeconds < 0) {
      throw new Error(`advance: elapsedSeconds must be >= 0 (got ${elapsedSeconds})`);
    }
    const wholeSteps = Math.floor(elapsedSeconds / STEP);
    const consumed = wholeSteps * STEP;

    let next = deepCopy(state);
    const events: SimulationEvent[] = [];
    for (let i = 0; i < wholeSteps; i++) {
      const result = runOneStep(next, STEP);
      next = result.state;
      if (result.events.length > 0) {
        events.push(...result.events);
      }
    }
    return { state: next, events, consumedSeconds: consumed };
  },

  executeAction(state: GameState, action: GameAction): SimulationResult {
    const next = deepCopy(state);
    const result = dispatch(next, action);
    return { state: result.state, events: result.events, consumedSeconds: 0 };
  },
};
