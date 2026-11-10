/**
 * GameAction handlers.
 *
 * `executeAction(state, action)` dispatches here based on `action.type`.
 * Each handler is pure: it returns a new state (and optionally events)
 * without mutating the input.
 *
 * HOW TO ADD A NEW ACTION (P1/P3):
 *   1. Add a new variant to `gameActionSchema` in
 *      `packages/shared/src/schemas/actions.ts`.
 *   2. Add a handler function here.
 *   3. Register the handler in `actionHandlers` below.
 *   4. `executeAction` automatically routes by `action.type`.
 */
import type { GameState, GameAction, SimulationEvent, SetSpeedAction } from '@capitalist-tree/shared';
import { UnknownActionError } from '@capitalist-tree/shared';
import type { SystemResult } from '../systems/system.js';

export type ActionListener<A extends GameAction = GameAction> = (
  state: GameState,
  action: A,
) => SystemResult;

const noOp: ActionListener = (state) => ({ state, events: [] });

const setSpeed: ActionListener<SetSpeedAction> = (state, action) => {
  const next: GameState = {
    ...state,
    clock: {
      ...state.clock,
      speedMultiplier: action.payload.multiplier,
    },
  };
  const events: SimulationEvent[] = [
    {
      type: 'system',
      at: state.clock.elapsedSeconds,
      payload: {
        systemId: 'ActionProcessor',
        message: `Speed set to ${action.payload.multiplier}x`,
      },
    },
  ];
  return { state: next, events };
};

export const actionHandlers: Record<string, ActionListener> = {
  'no-op': noOp,
  'set-speed': setSpeed as ActionListener,
};

/** Dispatch a GameAction to its handler. Raises UnknownActionError for unknown types. */
export function dispatch(state: GameState, action: GameAction): SystemResult {
  const handler = actionHandlers[action.type];
  if (!handler) {
    throw new UnknownActionError(action.type);
  }
  return handler(state, action);
}
