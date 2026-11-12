/**
 * Tests for `AdvancedViewToggle` (P5c — GDD §13.3 advanced-view toggle).
 *
 * Smoke + behavior coverage:
 *   - Renders the simplified-view label by default.
 *   - Clicking the button dispatches `setAdvancedView(true)` (the
 *     `ui.advancedView` flag flips).
 *   - Clicking again toggles back to false (the toggle is symmetric).
 *   - Subscribes narrowly: an unrelated `simState` commit does NOT
 *     re-render the toggle.
 */
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { engine, DEFAULT_GAME_CONFIG } from '@capitalist-tree/simulation';
import {
  useGameStore,
  __resetGameStoreForTests,
} from '../../../stores/game-store';
import { AdvancedViewToggle } from '../../../components/dashboard/AdvancedViewToggle';

function freshState() {
  return engine.initialize({ ...DEFAULT_GAME_CONFIG, createdAt: 1_700_000_000_000 });
}

describe('AdvancedViewToggle (P5c)', () => {
  beforeEach(() => __resetGameStoreForTests());
  afterEach(() => cleanup());

  it('defaults to the simplified-view label (ui.advancedView === false)', () => {
    const { getByTestId } = render(<AdvancedViewToggle />);
    expect(getByTestId('advanced-view-toggle-button')).toHaveTextContent(
      'Simplified view',
    );
  });

  it('toggles ui.advancedView to true when clicked', () => {
    expect(useGameStore.getState().ui.advancedView).toBe(false);
    const { getByTestId } = render(<AdvancedViewToggle />);
    fireEvent.click(getByTestId('advanced-view-toggle-button'));
    expect(useGameStore.getState().ui.advancedView).toBe(true);
    // Label flips + the button now reflects the active tone.
    expect(getByTestId('advanced-view-toggle-button')).toHaveTextContent(
      'Advanced view',
    );
    expect(getByTestId('advanced-view-toggle-button')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('toggles back to false on a second click', () => {
    const { getByTestId } = render(<AdvancedViewToggle />);
    fireEvent.click(getByTestId('advanced-view-toggle-button'));
    expect(useGameStore.getState().ui.advancedView).toBe(true);
    fireEvent.click(getByTestId('advanced-view-toggle-button'));
    expect(useGameStore.getState().ui.advancedView).toBe(false);
  });

  it('leaves the simState reference untouched (rule 6 — UI mutators only touch the ui slice)', () => {
    useGameStore.getState().commitSimState(freshState(), []);
    const before = useGameStore.getState().simState;
    const { getByTestId } = render(<AdvancedViewToggle />);
    fireEvent.click(getByTestId('advanced-view-toggle-button'));
    expect(useGameStore.getState().simState).toBe(before);
  });

  it('subscribes narrowly — does not re-render on an unrelated simState commit', async () => {
    useGameStore.getState().commitSimState(freshState(), []);
    const spy = vi.fn(AdvancedViewToggle);
    const ToggleSpy = spy as unknown as typeof AdvancedViewToggle;
    render(<ToggleSpy />);
    await Promise.resolve();
    const baseline = spy.mock.calls.length;
    expect(baseline).toBeGreaterThanOrEqual(1);

    // Touch the simState via a fresh commit (unrelated slice — tree stress).
    // The toggle subscribes only to `ui.advancedView` + the
    // `setAdvancedView` mutator reference (stable across commits), so it
    // should NOT re-render.
    const base2 = freshState();
    useGameStore.getState().commitSimState(
      { ...base2, originalTree: { ...base2.originalTree, stress: 0.5 } },
      [],
    );
    await Promise.resolve();
    expect(spy.mock.calls.length).toBe(baseline);

    // Flip the toggle — should re-render because `ui.advancedView`
    // changed.
    useGameStore.getState().setAdvancedView(true);
    await waitFor(() => {
      expect(spy.mock.calls.length).toBeGreaterThan(baseline);
    });
  });
});
