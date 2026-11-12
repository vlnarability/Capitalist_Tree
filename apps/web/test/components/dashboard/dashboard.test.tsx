/**
 * Tests for the dashboard summary components (P5b — GDD §13.1).
 *
 * Covers:
 *   - `MoneyDisplay` formats bigint-as-string `personalCash` as `$X.XX`
 *     (the headline test the task brief calls out).
 *   - `SpeedControls` dispatches `pause()` / `resume()` / `setSpeed(m)`
 *     through the store (the dispatch test the task brief calls out).
 *   - `TreeConditionSummary` shows the tier label (the tier test the task
 *     brief calls out).
 *   - `ExpensesSummary` totals the five categories.
 *   - `WeatherDisplay` shows the weather label + temperature + season.
 *   - `ResourcesSummary` shows the soil + tree-water bars.
 *
 * Environment: happy-dom. Each test publishes a `GameState` snapshot via the
 * store's `commitSimState` helper (the same path the simulation loop uses),
 * then renders the component and asserts against the rendered output.
 */
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { engine, DEFAULT_GAME_CONFIG } from '@capitalist-tree/simulation';
import type { GameState } from '@capitalist-tree/shared';
import { PROVISIONAL_SPEED_1X } from '@capitalist-tree/shared';
import { useGameStore, __resetGameStoreForTests } from '../../../stores/game-store';
import { setSpeed } from '../../../lib/actions';
import { MoneyDisplay } from '../../../components/dashboard/MoneyDisplay';
import { SpeedControls } from '../../../components/dashboard/SpeedControls';
import { TreeConditionSummary } from '../../../components/dashboard/TreeConditionSummary';
import { ExpensesSummary } from '../../../components/dashboard/ExpensesSummary';
import { WeatherDisplay } from '../../../components/dashboard/WeatherDisplay';
import { ResourcesSummary } from '../../../components/dashboard/ResourcesSummary';

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

describe('MoneyDisplay (P5b)', () => {
  beforeEach(() => __resetGameStoreForTests());
  afterEach(() => cleanup());

  it('returns null until simState is published (loop has not booted)', () => {
    const { container } = render(<MoneyDisplay />);
    expect(container.firstChild).toBeNull();
  });

  it('formats bigint-as-string personalCash as $X.XX (headline test)', () => {
    // $500.00 = 50000 minor units (the default starting cash).
    const state = freshState();
    expect(state.player.personalCash).toBe('50000');
    publish(state);
    const { getByTestId } = render(<MoneyDisplay />);
    expect(getByTestId('money-nominal')).toHaveTextContent('$500.00');
  });

  it('formats large values with grouping', () => {
    const state = freshState({
      ...freshState(),
      player: {
        ...freshState().player,
        personalCash: '123456789', // $1,234,567.89
      },
    });
    publish(state);
    const { getByTestId } = render(<MoneyDisplay />);
    expect(getByTestId('money-nominal')).toHaveTextContent('$1,234,567.89');
  });

  it('subscribes narrowly — does not re-render when an unrelated UI slice changes', async () => {
    const state = freshState();
    publish(state);

    // Wrap `MoneyDisplay` in a `vi.fn` so we can assert how many times React
    // invokes the component function. Each React re-render of the component
    // bumps the spy's call count by 1 (Zustand's `useGameStore(selector)` is
    // implemented on top of `useSyncExternalStore`; when the store notifies,
    // React re-renders the component only if the selector's snapshot changed
    // via `Object.is` — primitive selectors like `s => s.simState?.player
    // .personalCash ?? null` skip the re-render when the primitive is the
    // same value).
    //
    // `vi.fn(MoneyDisplay)` returns a `Mock` object; we keep two references
    // — `spy` for `.mock.calls.length` assertions, `MoneyDisplaySpy` (a cast
    // back to the component type) for JSX — because TS's JSX element
    // resolution doesn't pick up the call signature on the bare `Mock`.
    const spy = vi.fn(MoneyDisplay);
    const MoneyDisplaySpy = spy as unknown as typeof MoneyDisplay;
    render(<MoneyDisplaySpy />);
    // Wait a microtask for any initial mount effects to flush before we
    // capture the baseline.
    await Promise.resolve();
    const baseline = spy.mock.calls.length;
    expect(baseline).toBeGreaterThanOrEqual(1);

    // Touch an unrelated UI slice (ui.selectedTab). MoneyDisplay subscribes
    // to player.personalCash + economy.inflationIndex only — both unchanged.
    // React's useSyncExternalStore bails out → no re-render.
    useGameStore.getState().setSelectedTab('economy');
    await Promise.resolve();
    expect(spy.mock.calls.length).toBe(baseline);

    // Touch an unrelated simulation slice via commit (tree stress). The store
    // replaces `simState` with a new reference, but the two fields MoneyDisplay
    // subscribes to are unchanged primitives — still no re-render.
    const base2 = freshState();
    publish({
      ...base2,
      originalTree: { ...base2.originalTree, stress: 0.5 },
    });
    await Promise.resolve();
    expect(spy.mock.calls.length).toBe(baseline);

    // Now touch personalCash via a fresh commit — MoneyDisplay SHOULD
    // re-render because its selector returns a new primitive value.
    publish(
      freshState({
        ...freshState(),
        player: { ...freshState().player, personalCash: '60000' },
      }),
    );
    // Zustand notifies synchronously; React schedules the re-render on the
    // next microtask. `waitFor` polls until the assertion passes.
    await waitFor(() => {
      expect(spy.mock.calls.length).toBeGreaterThan(baseline);
    });
  });

  it('shows the inflation-adjusted purchasing power when index > 1', () => {
    const state = freshState({
      ...freshState(),
      player: { ...freshState().player, personalCash: '50000' }, // $500.00
      economy: { ...freshState().economy, inflationIndex: 1.25 }, // 25% inflation
    });
    publish(state);
    const { queryByTestId } = render(<MoneyDisplay />);
    const real = queryByTestId('money-real');
    expect(real).not.toBeNull();
    // $500 nominal / 1.25 index = $400 real.
    expect(real).toHaveTextContent('$400.00');
  });

  it('hides the inflation-adjusted line when index == 1.0 (start of game)', () => {
    const state = freshState();
    expect(state.economy.inflationIndex).toBe(1.0);
    publish(state);
    const { queryByTestId } = render(<MoneyDisplay />);
    expect(queryByTestId('money-real')).toBeNull();
  });
});

describe('SpeedControls (P5b) — dispatch test', () => {
  beforeEach(() => __resetGameStoreForTests());
  afterEach(() => cleanup());

  it('dispatches pause() when the Pause button is clicked', () => {
    publish(freshState());
    // Sanity: the fresh state's speed is the engine default (1x), not paused.
    expect(useGameStore.getState().simState?.clock.speedMultiplier).toBe(PROVISIONAL_SPEED_1X);
    expect(useGameStore.getState().simState?.clock.paused).toBe(false);

    const { getByTestId } = render(<SpeedControls accumulator={0} />);
    fireEvent.click(getByTestId('speed-controls-toggle'));

    // pause() dispatches `set-speed=0` — the loop's pause-watcher (in
    // useSimulationLoop) cancels the rAF in response. The engine does NOT
    // set `clock.paused=true`; the multiplier is the authoritative signal.
    expect(useGameStore.getState().simState?.clock.speedMultiplier).toBe(0);
    // The button now reads "Resume" because speedMultiplier === 0 (paused).
    expect(getByTestId('speed-controls-toggle')).toHaveTextContent('Resume');
  });

  it('dispatches resume() when the Resume button is clicked (after pause)', () => {
    publish(freshState());
    const { getByTestId } = render(<SpeedControls accumulator={0} />);

    // Pause first.
    fireEvent.click(getByTestId('speed-controls-toggle'));
    expect(useGameStore.getState().simState?.clock.speedMultiplier).toBe(0);

    // Now resume — the label flips back to "Pause" and the multiplier
    // returns to 1x (the last non-zero multiplier or default).
    fireEvent.click(getByTestId('speed-controls-toggle'));
    expect(useGameStore.getState().simState?.clock.speedMultiplier).toBeGreaterThan(0);
    expect(getByTestId('speed-controls-toggle')).toHaveTextContent('Pause');
  });

  it('dispatches setSpeed(m) when a multiplier button is clicked', () => {
    publish(freshState());
    const { getByTestId } = render(<SpeedControls accumulator={0} />);

    fireEvent.click(getByTestId('speed-controls-5x'));
    expect(useGameStore.getState().simState?.clock.speedMultiplier).toBe(5);

    fireEvent.click(getByTestId('speed-controls-60x'));
    expect(useGameStore.getState().simState?.clock.speedMultiplier).toBe(60);

    fireEvent.click(getByTestId('speed-controls-15x'));
    expect(useGameStore.getState().simState?.clock.speedMultiplier).toBe(15);
  });

  it('highlights the active multiplier button (active tone class)', () => {
    publish(freshState());
    // Fresh state is 1x.
    expect(useGameStore.getState().simState?.clock.speedMultiplier).toBe(1);
    const { getByTestId } = render(<SpeedControls accumulator={0} />);
    const oneX = getByTestId('speed-controls-1x');
    expect(oneX.className).toContain('border-emerald-500');
    expect(oneX.className).toContain('bg-emerald-500/10');
  });

  it('renders the accumulator remainder', () => {
    publish(freshState());
    const { getByTestId } = render(<SpeedControls accumulator={42.5} />);
    expect(getByTestId('speed-controls-accumulator')).toHaveTextContent('42.50 sim seconds');
  });

  it('subscribes narrowly — does not re-render on unrelated ui changes', async () => {
    publish(freshState());
    const spy = vi.fn(SpeedControls);
    const SpeedControlsSpy = spy as unknown as typeof SpeedControls;
    render(<SpeedControlsSpy accumulator={0} />);
    await Promise.resolve();
    const baseline = spy.mock.calls.length;
    expect(baseline).toBeGreaterThanOrEqual(1);

    // Touch an unrelated UI slice. SpeedControls subscribes only to
    // clock.speedMultiplier + clock.paused + dispatch — none of which change
    // when selectedTab flips. React's useSyncExternalStore bails out → no
    // re-render.
    useGameStore.getState().setSelectedTab('economy');
    await Promise.resolve();
    expect(spy.mock.calls.length).toBe(baseline);

    // Touch the clock slice via dispatch — SpeedControls SHOULD re-render
    // because its `clock.speedMultiplier` selector returns a new value.
    useGameStore.getState().dispatch(setSpeed(5));
    await waitFor(() => {
      expect(spy.mock.calls.length).toBeGreaterThan(baseline);
    });
  });
});

describe('TreeConditionSummary (P5b) — tier test', () => {
  beforeEach(() => __resetGameStoreForTests());
  afterEach(() => cleanup());

  it('shows the Healthy tier when stress is low', () => {
    const state = freshState();
    // Fresh state: stress=0 (no biology stress yet).
    publish(state);
    const { getByTestId } = render(<TreeConditionSummary />);
    expect(getByTestId('tree-condition-tier')).toHaveTextContent('Healthy');
    // Hint should be present.
    expect(getByTestId('tree-condition-hint').textContent ?? '').toMatch(/thriving/i);
  });

  it('shows the Stressed tier when stress is mid-range', () => {
    const base = freshState();
    publish({
      ...base,
      originalTree: { ...base.originalTree, stress: 0.5, alive: true },
    });
    const { getByTestId } = render(<TreeConditionSummary />);
    expect(getByTestId('tree-condition-tier')).toHaveTextContent('Stressed');
  });

  it('shows the Critical tier when stress is high', () => {
    const base = freshState();
    publish({
      ...base,
      originalTree: { ...base.originalTree, stress: 0.9, alive: true },
    });
    const { getByTestId } = render(<TreeConditionSummary />);
    expect(getByTestId('tree-condition-tier')).toHaveTextContent('Critical');
  });

  it('shows the Dead tier when alive=false (regardless of stress)', () => {
    const base = freshState();
    publish({
      ...base,
      originalTree: { ...base.originalTree, stress: 0.0, alive: false },
    });
    const { getByTestId } = render(<TreeConditionSummary />);
    expect(getByTestId('tree-condition-tier')).toHaveTextContent('Dead');
  });

  it('renders the canopy density bar (ProgressBar) with value derived from currentLeaves/leafCapacity', () => {
    const base = freshState();
    // A sapling: 100 leaves / 1000 capacity = 10% density.
    publish({
      ...base,
      originalTree: {
        ...base.originalTree,
        foliage: { ...base.originalTree.foliage, currentLeaves: 100, leafCapacity: 1000 },
      },
    });
    const { getByText } = render(<TreeConditionSummary />);
    // 10% density label.
    expect(getByText('10%')).toBeInTheDocument();
  });

  it('returns null until simState is published', () => {
    const { container } = render(<TreeConditionSummary />);
    expect(container.firstChild).toBeNull();
  });
});

describe('ExpensesSummary (P5b)', () => {
  beforeEach(() => __resetGameStoreForTests());
  afterEach(() => cleanup());

  it('renders the monthly total formatted as $X.XX', () => {
    // Use non-zero expenses so the monthly total is distinct from the per-
    // category `$0.00` cells (otherwise getByText finds multiple matches
    // and the test is ambiguous).
    const base = freshState();
    const state: GameState = {
      ...base,
      player: {
        ...base.player,
        livingExpenses: {
          food: '12000',         // $120.00
          housing: '45000',      // $450.00
          utilities: '8000',     // $80.00
          healthcare: '5000',    // $50.00
          transportation: '3000', // $30.00
        },
      },
    };
    publish(state);
    const { getByText } = render(<ExpensesSummary />);

    // Total = 12000 + 45000 + 8000 + 5000 + 3000 = 73000 = $730.00.
    expect(getByText('$730.00')).toBeInTheDocument();
  });

  it('shows the unpaid-days warning when unpaidDays > 0', () => {
    const base = freshState();
    publish({
      ...base,
      player: { ...base.player, unpaidDays: 5 },
    });
    const { queryByTestId } = render(<ExpensesSummary />);
    expect(queryByTestId('expenses-warning')).not.toBeNull();
    expect(queryByTestId('expenses-warning')?.textContent ?? '').toMatch(/unpaid/i);
  });

  it('hides the unpaid-days warning when unpaidDays === 0', () => {
    publish(freshState());
    const { queryByTestId } = render(<ExpensesSummary />);
    expect(queryByTestId('expenses-warning')).toBeNull();
  });

  it('renders a breakdown row per category', () => {
    publish(freshState());
    const { getByText } = render(<ExpensesSummary />);
    // All five category labels should appear.
    expect(getByText('Food')).toBeInTheDocument();
    expect(getByText('Housing')).toBeInTheDocument();
    expect(getByText('Utilities')).toBeInTheDocument();
    expect(getByText('Healthcare')).toBeInTheDocument();
    expect(getByText('Transportation')).toBeInTheDocument();
  });
});

describe('WeatherDisplay (P5b)', () => {
  beforeEach(() => __resetGameStoreForTests());
  afterEach(() => cleanup());

  it('renders the weather label + temperature + time-of-day + season', () => {
    const base = freshState();
    // Fresh state starts in spring at day 0 with sunny weather.
    publish(base);
    const { getByText, getByTestId } = render(<WeatherDisplay />);

    // Weather label.
    expect(getByText('Sunny')).toBeInTheDocument();
    // Season label.
    expect(getByText('Spring')).toBeInTheDocument();
    // Hint should be present.
    expect(getByTestId('weather-hint').textContent ?? '').toMatch(/clear skies/i);
  });

  it('formats the temperature as °C', () => {
    const base = freshState();
    publish({
      ...base,
      world: { ...base.world, weather: { ...base.world.weather, temperature: 22.4 } },
    });
    const { getByText } = render(<WeatherDisplay />);
    // 22.4 rounds to 22°C.
    expect(getByText('22°C')).toBeInTheDocument();
  });

  it('shows the elapsed Day N, HH:MM summary', () => {
    const base = freshState();
    publish({
      ...base,
      clock: {
        ...base.clock,
        elapsedSeconds: 86_400 * 3 + 3_600 * 4 + 60 * 30, // 3 days, 4h, 30m
        day: 3,
        timeOfDay: (4 * 3_600 + 30 * 60) / 86_400, // 0.1875
      },
    });
    const { getByText } = render(<WeatherDisplay />);
    // Day 3, 04:30 appears either as the elapsed summary or the time-of-day.
    expect(getByText('Day 3, 04:30')).toBeInTheDocument();
  });

  it('renders the intensity ProgressBar', () => {
    publish(freshState());
    const { container } = render(<WeatherDisplay />);
    const bar = container.querySelector('[role="progressbar"][aria-label="Weather intensity"]');
    expect(bar).not.toBeNull();
  });
});

describe('ResourcesSummary (P5b)', () => {
  beforeEach(() => __resetGameStoreForTests());
  afterEach(() => cleanup());

  it('renders soil-health + tree-hydration ProgressBars', () => {
    publish(freshState());
    const { container } = render(<ResourcesSummary />);
    const soilBar = container.querySelector('[role="progressbar"][aria-label="Soil health"]');
    const treeBar = container.querySelector('[role="progressbar"][aria-label="Tree hydration"]');
    expect(soilBar).not.toBeNull();
    expect(treeBar).not.toBeNull();
  });

  it('shows the soil moisture value (litres)', () => {
    const base = freshState();
    publish({
      ...base,
      world: {
        ...base.world,
        environment: { ...base.world.environment, soil: { ...base.world.environment.soil, soilWater: 1234 } },
      },
    });
    const { getByText } = render(<ResourcesSummary />);
    expect(getByText('1,234 L')).toBeInTheDocument();
  });

  it('returns null until simState is published', () => {
    const { container } = render(<ResourcesSummary />);
    expect(container.firstChild).toBeNull();
  });
});
