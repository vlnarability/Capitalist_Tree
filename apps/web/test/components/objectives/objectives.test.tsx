/**
 * ObjectivesPanel tests (DR-8 — docs/reviews/DECISIONS.md).
 *
 * Covers:
 *   - Returns null until simState is published (loop has not booted).
 *   - Renders all six GDD §12 objectives with a status badge each.
 *   - A completed objective (in `eventState.objectives.completed`) shows the
 *     "Completed" badge + a full progress bar.
 *   - On a fresh state, no objective is "Completed" (the completed list is
 *     empty + none are achieved this tick).
 *
 * Environment: happy-dom. Publishes a GameState snapshot via the store's
 * `commitSimState` helper (the same path the simulation loop uses), then
 * renders + asserts against the testids.
 */
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { engine, DEFAULT_GAME_CONFIG, OBJECTIVE_IDS } from '@capitalist-tree/simulation';
import type { GameState } from '@capitalist-tree/shared';
import {
  useGameStore,
  __resetGameStoreForTests,
} from '../../../stores/game-store';
import { ObjectivesPanel } from '../../../components/objectives/ObjectivesPanel';

function freshState(overrides: Partial<GameState> = {}): GameState {
  return {
    ...engine.initialize({ ...DEFAULT_GAME_CONFIG, createdAt: 1_700_000_000_000 }),
    ...overrides,
  };
}

function publish(state: GameState): void {
  useGameStore.getState().commitSimState(state, []);
}

describe('ObjectivesPanel (DR-8)', () => {
  beforeEach(() => __resetGameStoreForTests());
  afterEach(() => cleanup());

  it('returns null until simState is published (loop has not booted)', () => {
    const { container } = render(<ObjectivesPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the panel + all six GDD §12 objectives, each with a status badge', () => {
    publish(freshState());
    const { getByTestId } = render(<ObjectivesPanel />);
    expect(getByTestId('objectives-panel')).toBeInTheDocument();
    // Every objective id has a list item + a status badge.
    for (const id of OBJECTIVE_IDS) {
      expect(getByTestId(`objective-${id}`)).toBeInTheDocument();
      const status = getByTestId(`objective-${id}-status`);
      expect(status).toBeInTheDocument();
      // The badge text is one of the three DR-8 statuses.
      expect(status.textContent ?? '').toMatch(/Completed|In Progress|Available/);
    }
  });

  it('a completed objective (persisted in eventState.objectives.completed) shows "Completed" + a full progress bar', () => {
    // Mark generational-legacy as completed (persisted). The panel must read
    // the completed list + render that objective as Completed regardless of
    // the live progress value.
    const withCompleted = freshState({
      eventState: {
        ...freshState().eventState,
        objectives: { completed: ['generational-legacy'] },
      },
    });
    publish(withCompleted);
    const { getByTestId } = render(<ObjectivesPanel />);
    const status = getByTestId('objective-generational-legacy-status');
    expect(status.textContent ?? '').toBe('Completed');
    // The progress bar is full (100%) for a completed objective.
    const progress = getByTestId('objective-generational-legacy-progress');
    expect(progress.getAttribute('style') ?? '').toMatch(/width:\s*100%/);
  });

  it('on a fresh state, no objective is "Completed" (completed list empty + none achieved)', () => {
    publish(freshState());
    const { getByTestId } = render(<ObjectivesPanel />);
    for (const id of OBJECTIVE_IDS) {
      const status = getByTestId(`objective-${id}-status`);
      expect(status.textContent ?? '').not.toBe('Completed');
    }
  });
});
