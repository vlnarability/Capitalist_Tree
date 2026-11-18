/**
 * EndingScreen tests (GAP-36 — GDD §12 endings).
 *
 * Covers:
 *   - Returns null (not in the DOM) when no ending is parked.
 *   - When an objective newly completes (parked via commitSimState detection),
 *     renders the ending modal with the title, objective, + epilogue from
 *     `getEnding`.
 *   - The Continue click clears `pendingEnding` (the modal unmounts).
 *
 * Environment: happy-dom. Publishes GameState snapshots via the store's
 * `commitSimState` (the same path the simulation loop uses), then renders +
 * asserts against the testids.
 */
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, render, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { engine, DEFAULT_GAME_CONFIG, OBJECTIVE_IDS } from '@capitalist-tree/simulation';
import type { GameState } from '@capitalist-tree/shared';
import {
  useGameStore,
  __resetGameStoreForTests,
} from '../../../stores/game-store';
import { EndingScreen } from '../../../components/common/EndingScreen';

function freshState(completed: readonly string[]): GameState {
  const base = engine.initialize({ ...DEFAULT_GAME_CONFIG, createdAt: 1_700_000_000_000 });
  return {
    ...base,
    eventState: {
      ...base.eventState,
      objectives: { ...base.eventState.objectives, completed: [...completed] },
    },
  };
}

describe('EndingScreen (GAP-36)', () => {
  beforeEach(() => {
    __resetGameStoreForTests();
  });
  afterEach(() => {
    cleanup();
  });

  it('renders nothing when no ending is parked', () => {
    useGameStore.getState().commitSimState(freshState([]), []);
    const { queryByTestId } = render(<EndingScreen />);
    expect(queryByTestId('ending-screen')).toBeNull();
  });

  it('renders the ending modal when an objective newly completes', () => {
    // Load (prev null) — no ending.
    useGameStore.getState().commitSimState(freshState([]), []);
    // Subsequent commit — 'wealthiest-being' newly completes → parked.
    useGameStore.getState().commitSimState(freshState(['wealthiest-being']), []);
    expect(useGameStore.getState().ui.pendingEnding).toBe('wealthiest-being');

    const { getByTestId } = render(<EndingScreen />);
    expect(getByTestId('ending-screen')).toBeInTheDocument();
    expect(getByTestId('ending-screen-title').textContent).toBe('The Wealthiest Being');
    expect(getByTestId('ending-screen-body')).toBeInTheDocument();
  });

  it('Continue clears the parked ending (modal unmounts)', () => {
    useGameStore.getState().commitSimState(freshState([]), []);
    useGameStore.getState().commitSimState(freshState(['last-tree']), []);

    const { getByTestId, queryByTestId } = render(<EndingScreen />);
    fireEvent.click(getByTestId('ending-screen-continue'));
    expect(useGameStore.getState().ui.pendingEnding).toBeNull();
    expect(queryByTestId('ending-screen')).toBeNull();
  });

  it('renders for each of the six endings (id → title round-trip)', () => {
    for (const id of OBJECTIVE_IDS) {
      __resetGameStoreForTests();
      useGameStore.getState().commitSimState(freshState([]), []); // load (prev null)
      useGameStore.getState().commitSimState(freshState([id]), []); // newly completes → parks
      expect(useGameStore.getState().ui.pendingEnding).toBe(id);
      const { getByTestId, unmount } = render(<EndingScreen />);
      expect(getByTestId('ending-screen-title').textContent).toBeTruthy();
      unmount();
    }
  });
});
