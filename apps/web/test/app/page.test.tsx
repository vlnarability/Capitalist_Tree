/**
 * Page-level tests for the main game screen (P5c — GDD §13.3 wiring).
 *
 * Covers the wiring of `AdvancedViewToggle` + the advanced-view panels into
 * `apps/web/app/page.tsx`:
 *
 *   - The page mounts the `AdvancedViewToggle` inside the Simulation panel
 *     (always visible, regardless of `ui.advancedView`).
 *   - The advanced-view section is NOT in the document by default
 *     (`ui.advancedView === false` — simplified view per GDD §13.2).
 *   - Clicking the toggle flips `ui.advancedView` to true, which mounts the
 *     advanced panels (BiologyPanel, EnvironmentPanel, HarvestControls,
 *     PurchaseControls, TransactionsPanel, CurrencyCosmeticPicker).
 *   - Clicking the toggle again hides them.
 *
 * Mocks:
 *   - `useSimulationLoop` is stubbed so the test doesn't depend on rAF,
 *     IndexedDB, or async boot. Returns `ready: true` immediately so the
 *     page renders the game screen on the first paint.
 *   - `createBrowserStorage` is stubbed to return null (no IDB in happy-dom).
 *
 * The state is published directly via `useGameStore.getState().commitSimState`
 * (the same path the loop hook uses) so the page's narrow selectors see a
 * non-null `simState`.
 */
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { engine, DEFAULT_GAME_CONFIG } from '@capitalist-tree/simulation';
import type { GameState } from '@capitalist-tree/shared';
import {
  useGameStore,
  __resetGameStoreForTests,
} from '../../stores/game-store';

// ----------------------------------------------------------------------------
// Module mocks — applied BEFORE the page import so the page picks up the
// stubbed `useSimulationLoop` / `createBrowserStorage` at module-load time.
// ----------------------------------------------------------------------------

// Stub the simulation-loop hook. The page only reads `loop.ready`,
// `loop.accumulator`, and the save / load / newGame callbacks — none of
// which need to actually do anything for the wiring test. We DO want
// `loop.ready` to be `true` so the page renders the game screen (not the
// "Booting engine…" placeholder).
vi.mock('../../hooks/useSimulationLoop', () => ({
  useSimulationLoop: () => ({
    ready: true,
    accumulator: 0,
    save: vi.fn(),
    load: vi.fn(),
    newGame: vi.fn(),
  }),
}));

// Stub the storage factory so the page's `useMemo(() => createBrowserStorage(), [])`
// doesn't try to touch IndexedDB (which happy-dom doesn't fully implement).
vi.mock('../../lib/persistence', () => ({
  createBrowserStorage: () => null,
}));

// Import the page AFTER the mocks are installed. Vitest hoists `vi.mock`
// above all imports, so this works regardless of import order — but keeping
// the page import last makes the dependency-on-mock explicit to the reader.
import HomePage from '../../app/page';

// ----------------------------------------------------------------------------
// Helpers.
// ----------------------------------------------------------------------------

function freshState(overrides: Partial<GameState> = {}): GameState {
  return {
    ...engine.initialize({ ...DEFAULT_GAME_CONFIG, createdAt: 1_700_000_000_000 }),
    ...overrides,
  };
}

/** Publish a non-null simState via the store's commit path. */
function publish(state: GameState): void {
  useGameStore.getState().commitSimState(state, []);
}

// ----------------------------------------------------------------------------
// Tests.
// ----------------------------------------------------------------------------

describe('HomePage advanced-view wiring (P5c — GDD §13.3)', () => {
  beforeEach(() => __resetGameStoreForTests());
  afterEach(() => cleanup());

  it('mounts the AdvancedViewToggle inside the Simulation panel', () => {
    publish(freshState());
    const { getByTestId } = render(<HomePage />);
    // The toggle is rendered regardless of advancedView — the player can
    // always flip between simplified (GDD §13.2) and advanced (GDD §13.3).
    expect(getByTestId('advanced-view-toggle')).toBeInTheDocument();
    // Default label is the simplified-view side.
    expect(getByTestId('advanced-view-toggle-button')).toHaveTextContent(
      'Simplified view',
    );
  });

  it('does NOT render the advanced-view section by default (ui.advancedView === false)', () => {
    publish(freshState());
    const { queryByTestId } = render(<HomePage />);
    expect(queryByTestId('advanced-view')).toBeNull();
    // None of the advanced panels are mounted either.
    expect(queryByTestId('biology-panel')).toBeNull();
    expect(queryByTestId('environment-panel')).toBeNull();
    expect(queryByTestId('harvest-controls')).toBeNull();
    expect(queryByTestId('purchase-controls')).toBeNull();
    expect(queryByTestId('transactions-panel')).toBeNull();
    expect(queryByTestId('currency-cosmetic-picker')).toBeNull();
  });

  it('mounts the advanced-view section when the toggle is clicked', async () => {
    publish(freshState());
    const { getByTestId, queryByTestId } = render(<HomePage />);
    // Click the toggle — flips `ui.advancedView` to true.
    fireEvent.click(getByTestId('advanced-view-toggle-button'));
    // The store mutator is synchronous; React's re-render is not. Wait for
    // the advanced-view section + its panels to mount.
    await waitFor(() => {
      expect(queryByTestId('advanced-view')).not.toBeNull();
    });
    // The toggle's label flipped to the advanced-view side.
    expect(getByTestId('advanced-view-toggle-button')).toHaveTextContent(
      'Advanced view',
    );
    // All six advanced panels mount.
    expect(getByTestId('biology-panel')).toBeInTheDocument();
    expect(getByTestId('environment-panel')).toBeInTheDocument();
    expect(getByTestId('harvest-controls')).toBeInTheDocument();
    expect(getByTestId('purchase-controls')).toBeInTheDocument();
    expect(getByTestId('transactions-panel')).toBeInTheDocument();
    expect(getByTestId('currency-cosmetic-picker')).toBeInTheDocument();
  });

  it('unmounts the advanced-view section on a second click (toggle is symmetric)', async () => {
    publish(freshState());
    const { getByTestId, queryByTestId } = render(<HomePage />);
    // Turn advanced view on.
    fireEvent.click(getByTestId('advanced-view-toggle-button'));
    await waitFor(() => {
      expect(queryByTestId('advanced-view')).not.toBeNull();
    });
    // Turn it back off.
    fireEvent.click(getByTestId('advanced-view-toggle-button'));
    await waitFor(() => {
      expect(queryByTestId('advanced-view')).toBeNull();
    });
    // Panels are gone too.
    expect(queryByTestId('biology-panel')).toBeNull();
    expect(queryByTestId('environment-panel')).toBeNull();
  });

  it('leaves the simState reference untouched when the toggle is clicked (rule 6)', () => {
    publish(freshState());
    const before = useGameStore.getState().simState;
    const { getByTestId } = render(<HomePage />);
    fireEvent.click(getByTestId('advanced-view-toggle-button'));
    // UI mutators replace the `ui` slice only; `simState` reference is unchanged.
    expect(useGameStore.getState().simState).toBe(before);
    expect(useGameStore.getState().ui.advancedView).toBe(true);
  });

  it('renders the simplified dashboard panels always (Money / Expenses / Tree)', () => {
    publish(freshState());
    const { getByTestId } = render(<HomePage />);
    // The simplified view (GDD §13.2) is always present — the advanced
    // view is additive, not a replacement.
    expect(getByTestId('game-screen')).toBeInTheDocument();
    expect(getByTestId('save-button')).toBeInTheDocument();
    expect(getByTestId('load-button')).toBeInTheDocument();
    expect(getByTestId('new-game-button')).toBeInTheDocument();
  });
});
