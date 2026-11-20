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

// ---------------------------------------------------------------------------
// P11 (W29 / GAP-41): per-tick profiler. Opt-in (off by default so production
// pays zero overhead). When enabled via setProfilerEnabled(true), runOneStep
// measures each system's execution time + stores it; getProfilerLastStep()
// returns the last step's per-system timings (ms) for the CI perf gate +
// ad-hoc profiling. The measurement uses performance.now() (sub-ms
// resolution) when available, else Date.now().
// ---------------------------------------------------------------------------
let profilerEnabled = false;

/** Per-system timing record for one step (ms). */
export interface StepProfile {
  /** Total step time (ms), summed across systems + overhead. */
  readonly totalMs: number;
  /** Per-system-id timing (ms). */
  readonly systems: Readonly<Record<string, number>>;
  /** Number of whole steps this profile represents (always 1 from runOneStep). */
  readonly steps: number;
}

let lastProfile: StepProfile | null = null;

/** Enable/disable the per-tick profiler. Off by default (zero overhead). */
export function setProfilerEnabled(enabled: boolean): void {
  profilerEnabled = enabled;
  // Clear the last profile when disabling so a stale reading from a prior
  // enabled run doesn't linger (getProfilerLastStep returns null until the
  // next enabled step).
  if (!enabled) {
    lastProfile = null;
  }
}

/** Whether the profiler is currently enabled. */
export function isProfilerEnabled(): boolean {
  return profilerEnabled;
}

/** The last step's per-system timings, or null if profiling is off / no step ran. */
export function getProfilerLastStep(): StepProfile | null {
  return lastProfile;
}

/** High-resolution timestamp (ms). Falls back to Date.now() if perf unavailable. */
function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function runOneStep(state: GameState, stepSeconds: number): SystemResult {
  // Rebuild RNG from persisted state so the position survives across calls.
  // DR-6: thread the save's rngVersion so fork() uses the correct behavior
  // (v1 legacy root-consuming for old saves, v2 non-root-consuming for new).
  const rng = Rng.fromState(state.rngState, state.rngVersion);
  // DR-6 v2: per-tick root nonce. Under v1, forks themselves advanced the
  // root (a side effect that varied the root state across ticks). Under v2,
  // forks are non-root-consuming — so without this nonce, nothing would
  // advance the root + every v2 fork would derive the SAME child sequence
  // every tick (the root state is static), freezing per-tick RNG-driven
  // outcomes like mortality rolls. The nonce advances the root exactly one
  // draw per tick, independent of how many systems fork, so:
  //   - the root state varies across ticks (mortality/weather rolls vary),
  //   - adding a fork still does NOT shift the root or other systems' forks
  //     (the nonce is fixed at 1 draw/tick regardless of fork count).
  // v1 skips the nonce — its root advancement (via forks) is preserved exactly
  // so legacy saves keep their RNG sequence.
  if (rng.forkVersion === 2) {
    rng.next();
  }
  const baseCtx = {
    now: state.clock.elapsedSeconds + stepSeconds,
    stepSeconds,
    dayOfYear: state.clock.day,
    rng,
  };

  let next: GameState = state;
  const events: SimulationEvent[] = [];
  const systemTimings: Record<string, number> = {};
  const stepStart = profilerEnabled ? nowMs() : 0;

  for (const system of defaultRegistry.all()) {
    const sysStart = profilerEnabled ? nowMs() : 0;
    // Thread the events emitted so far this tick into ctx so a system can
    // react to what earlier systems emitted in the same step (the
    // AutomationSystem's `event` policy kind). `events` is the engine's live
    // accumulator — each system sees every event emitted before it, in
    // registry order. Systems are contractually pure + MUST NOT mutate
    // ctx.events.
    const ctx: SystemContext = { ...baseCtx, events };
    const result = system.execute(next, ctx);
    next = result.state;
    if (result.events.length > 0) {
      events.push(...result.events);
    }
    if (profilerEnabled) {
      systemTimings[system.id] = nowMs() - sysStart;
    }
  }

  // P11 (W29): store the per-system profile for the CI perf gate + ad-hoc use.
  if (profilerEnabled) {
    lastProfile = {
      totalMs: nowMs() - stepStart,
      systems: systemTimings,
      steps: 1,
    };
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
