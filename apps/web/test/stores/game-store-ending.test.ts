/**
 * game-store ending-detection tests (GAP-36 — GDD §12 endings).
 *
 * Pins the `commitSimState` newly-completed-objective detection:
 *   - On the first commit (prev simState null — the load case), an already-
 *     populated `completed` list does NOT fire an ending (the player already
 *     saw it; re-firing on every reload would be wrong).
 *   - On a subsequent commit (prev non-null), an id newly added to `completed`
 *     parks `ui.pendingEnding` on that id.
 *   - A second new completion in the same tick does NOT clobber an already-
 *     pending ending (the second stays recorded in `completed` + shows on the
 *     ObjectivesPanel).
 *   - `clearPendingEnding` clears the parked id (the modal's Continue).
 *
 * Environment: happy-dom (the store hook is React-aware).
 */
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { engine, DEFAULT_GAME_CONFIG } from '@capitalist-tree/simulation';
import type { GameState } from '@capitalist-tree/shared';
import {
  useGameStore,
  __resetGameStoreForTests,
} from '../../stores/game-store';

function stateWithCompleted(completed: readonly string[]): GameState {
  const base = engine.initialize({ ...DEFAULT_GAME_CONFIG, createdAt: 1_700_000_000_000 });
  return {
    ...base,
    eventState: {
      ...base.eventState,
      objectives: { ...base.eventState.objectives, completed: [...completed] },
    },
  };
}

describe('game-store ending detection (GAP-36)', () => {
  beforeEach(() => {
    __resetGameStoreForTests();
  });

  it('initial pendingEnding is null', () => {
    expect(useGameStore.getState().ui.pendingEnding).toBeNull();
  });

  it('does NOT fire an ending on the first commit (load case) even if completed is populated', () => {
    // A loaded save where an objective was already completed in a prior session.
    const loaded = stateWithCompleted(['wealthiest-being']);
    useGameStore.getState().commitSimState(loaded, []);
    expect(useGameStore.getState().ui.pendingEnding).toBeNull();
  });

  it('fires an ending when an objective newly completes on a subsequent commit', () => {
    // First commit (load) — no completion yet.
    useGameStore.getState().commitSimState(stateWithCompleted([]), []);
    expect(useGameStore.getState().ui.pendingEnding).toBeNull();
    // Second commit — wealthiest-being newly completes.
    useGameStore.getState().commitSimState(stateWithCompleted(['wealthiest-being']), []);
    expect(useGameStore.getState().ui.pendingEnding).toBe('wealthiest-being');
  });

  it('does NOT re-fire when the same completed list is committed again (no new id)', () => {
    useGameStore.getState().commitSimState(stateWithCompleted([]), []);
    useGameStore.getState().commitSimState(stateWithCompleted(['wealthiest-being']), []);
    expect(useGameStore.getState().ui.pendingEnding).toBe('wealthiest-being');
    // Clear, then commit the same completed list again — no new id, no re-fire.
    useGameStore.getState().clearPendingEnding();
    useGameStore.getState().commitSimState(stateWithCompleted(['wealthiest-being']), []);
    expect(useGameStore.getState().ui.pendingEnding).toBeNull();
  });

  it('does NOT clobber a pending ending with a second new completion in the same tick', () => {
    useGameStore.getState().commitSimState(stateWithCompleted([]), []);
    // First new completion parks the ending.
    useGameStore.getState().commitSimState(stateWithCompleted(['wealthiest-being']), []);
    expect(useGameStore.getState().ui.pendingEnding).toBe('wealthiest-being');
    // A second new completion in the next tick does NOT replace the pending one
    // (it stays parked until the player dismisses it).
    useGameStore.getState().commitSimState(
      stateWithCompleted(['wealthiest-being', 'great-restoration']),
      [],
    );
    expect(useGameStore.getState().ui.pendingEnding).toBe('wealthiest-being');
  });

  it('clearPendingEnding clears the parked id (the modal Continue)', () => {
    useGameStore.getState().commitSimState(stateWithCompleted([]), []);
    useGameStore.getState().commitSimState(stateWithCompleted(['last-tree']), []);
    expect(useGameStore.getState().ui.pendingEnding).toBe('last-tree');
    useGameStore.getState().clearPendingEnding();
    expect(useGameStore.getState().ui.pendingEnding).toBeNull();
  });

  it('clearPendingEnding does not touch simState (rule 6)', () => {
    const s = stateWithCompleted(['natural-balance']);
    useGameStore.getState().commitSimState(s, []);
    useGameStore.getState().commitSimState(
      stateWithCompleted(['natural-balance', 'industrial-empire']),
      [],
    );
    const before = useGameStore.getState().simState;
    useGameStore.getState().clearPendingEnding();
    expect(useGameStore.getState().simState).toBe(before); // same reference
  });
});
