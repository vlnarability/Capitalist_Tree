/**
 * System interface (TDD §4.2).
 *
 * A System is a pure state transformation: it receives the current GameState
 * and a per-step context, and returns `{ state, events }`. Systems NEVER
 * mutate the input state — they produce a new state. Systems NEVER read
 * `Date.now()` or `Math.random()`; randomness comes from `ctx.rng`.
 *
 * Execution order is fixed by the SystemRegistry (see
 * `packages/simulation/src/systems/registry.ts` and `docs/simulation.md`).
 * Later phases replace stubs with real implementations WITHOUT changing the
 * registry order, so determinism across saves is preserved.
 *
 * HOW TO IMPLEMENT A SYSTEM (P1+):
 *
 *   export const mySystem: System = {
 *     id: 'MySystem',
 *     execute(state, ctx) {
 *       const next = deepCopy(state);
 *       const rng = ctx.rng.fork('MySystem'); // deterministic sub-stream
 *       // ... mutate `next` ...
 *       return { state: next, events: [{ type: 'system', at: ctx.now, payload: { systemId: 'MySystem', message: '...' } }] };
 *     },
 *   };
 *
 * Then register it in `packages/simulation/src/systems/index.ts` at the
 * correct position (do NOT reorder existing entries).
 */
import type { GameState, SimulationEvent } from '@capitalist-tree/shared';
import type { Rng } from '../rng.js';

export interface SystemContext {
  /** Current simulation time (clock.elapsedSeconds) for this step. */
  readonly now: number;
  /** Length of this step in simulation seconds (= SIMULATION_STEP_SECONDS). */
  readonly stepSeconds: number;
  /** Day-of-year for this step (0-based). */
  readonly dayOfYear: number;
  /** Root RNG. Systems should `fork(name)` for their own sub-stream. */
  readonly rng: Rng;
}

export interface SystemResult {
  readonly state: GameState;
  readonly events: readonly SimulationEvent[];
}

export interface System {
  readonly id: string;
  execute(state: GameState, ctx: SystemContext): SystemResult;
}

/**
 * Helper for stub systems: returns state unchanged and emits no events.
 */
export function noopSystem(id: string): System {
  return {
    id,
    execute(state) {
      return { state, events: [] };
    },
  };
}
