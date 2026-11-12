/**
 * Tests for the advanced-view environmental panels (P5c — GDD §13.3).
 *
 * Covers:
 *   - BiologyPanel renders photosynthesis rate + Liebig factors + energy
 *     allocation breakdown + sustainable harvest estimate + derived
 *     health explanation. Returns null until simState is published.
 *   - EnvironmentPanel renders soil N/P/K + water balance + weather
 *     details + pollution summary + biodiversity. Returns null until
 *     simState is published.
 *
 * Environment: happy-dom. Each test publishes a `GameState` snapshot via
 * the store's `commitSimState` helper (the same path the simulation loop
 * uses), then renders the component and asserts against the rendered output.
 */
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { engine, DEFAULT_GAME_CONFIG } from '@capitalist-tree/simulation';
import type { GameState } from '@capitalist-tree/shared';
import {
  useGameStore,
  __resetGameStoreForTests,
} from '../../../stores/game-store';
import { BiologyPanel } from '../../../components/environment/BiologyPanel';
import { EnvironmentPanel } from '../../../components/environment/EnvironmentPanel';

function freshState(overrides: Partial<GameState> = {}): GameState {
  return {
    ...engine.initialize({ ...DEFAULT_GAME_CONFIG, createdAt: 1_700_000_000_000 }),
    ...overrides,
  };
}

function publish(state: GameState): void {
  useGameStore.getState().commitSimState(state, []);
}

describe('BiologyPanel (P5c)', () => {
  beforeEach(() => __resetGameStoreForTests());
  afterEach(() => cleanup());

  it('returns null until simState is published (loop has not booted)', () => {
    const { container } = render(<BiologyPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the photosynthesis rate + Liebig-minimum relationship', () => {
    publish(freshState());
    const { getByTestId } = render(<BiologyPanel />);
    const photosynthesis = getByTestId('biology-photosynthesis');
    expect(photosynthesis).toBeInTheDocument();
    expect(photosynthesis.textContent ?? '').toMatch(/eu\/day/);
    const limiting = getByTestId('biology-limiting-factor');
    expect(limiting.textContent ?? '').not.toBe('');
    expect(getByTestId('biology-factor-light')).toBeInTheDocument();
    expect(getByTestId('biology-factor-water')).toBeInTheDocument();
  });

  it('renders the energy allocation breakdown', () => {
    publish(freshState());
    const { getByTestId } = render(<BiologyPanel />);
    expect(getByTestId('biology-alloc-production')).toBeInTheDocument();
    expect(getByTestId('biology-alloc-maintenance')).toBeInTheDocument();
    expect(getByTestId('biology-alloc-root-growth')).toBeInTheDocument();
    expect(getByTestId('biology-alloc-leaf-growth')).toBeInTheDocument();
    expect(getByTestId('biology-alloc-reserve-storage')).toBeInTheDocument();
    expect(getByTestId('biology-energy-balance').textContent ?? '').not.toBe('');
  });

  it('renders the sustainable harvest estimate', () => {
    publish(freshState());
    const { getByTestId } = render(<BiologyPanel />);
    const sustainable = getByTestId('biology-sustainable-harvest');
    expect(sustainable).toBeInTheDocument();
    expect(sustainable.textContent ?? '').toMatch(/Recommended leaves/);
  });

  it('renders the derived health explanation', () => {
    publish(freshState());
    const { getByTestId } = render(<BiologyPanel />);
    const explanation = getByTestId('biology-health-explanation');
    expect(explanation.textContent ?? '').not.toBe('');
  });

  it('explains the limiting factor as water when soil water is critically low', () => {
    // Tree at noon (full light) with stored water at 0 L — water factor = 0,
    // making it the dominant Liebig bottleneck (every other factor > 0).
    const base = freshState();
    publish({
      ...base,
      clock: { ...base.clock, timeOfDay: 0.5 }, // noon — full light
      originalTree: {
        ...base.originalTree,
        water: { stored: 0, capacity: 50 },
      },
    });
    const { getByTestId } = render(<BiologyPanel />);
    const limiting = getByTestId('biology-limiting-factor');
    expect(limiting.textContent ?? '').toMatch(/Water is the limiting factor/);
  });

  it('shows the damage entries when present', () => {
    const base = freshState();
    publish({
      ...base,
      originalTree: {
        ...base.originalTree,
        damage: [
          {
            type: 'severe-defoliation',
            severity: 0.55,
            appliedAt: 86_400 * 2,
          },
        ],
      },
    });
    const { queryByTestId } = render(<BiologyPanel />);
    expect(queryByTestId('biology-damage')).not.toBeNull();
    expect(queryByTestId('biology-damage')?.textContent ?? '').toMatch(
      /severe-defoliation/,
    );
  });

  it('hides the damage list when no damage entries exist', () => {
    publish(freshState());
    const { queryByTestId } = render(<BiologyPanel />);
    expect(queryByTestId('biology-damage')).toBeNull();
  });
});

describe('EnvironmentPanel (P5c)', () => {
  beforeEach(() => __resetGameStoreForTests());
  afterEach(() => cleanup());

  it('returns null until simState is published', () => {
    const { container } = render(<EnvironmentPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the soil N/P/K + nutrient summary', () => {
    publish(freshState());
    const { getByTestId } = render(<EnvironmentPanel />);
    expect(getByTestId('environment-soil')).toBeInTheDocument();
    expect(getByTestId('environment-npk-nitrogen')).toBeInTheDocument();
    expect(getByTestId('environment-npk-phosphorus')).toBeInTheDocument();
    expect(getByTestId('environment-npk-potassium')).toBeInTheDocument();
    expect(
      getByTestId('environment-nutrient-summary').textContent ?? '',
    ).not.toBe('');
  });

  it('renders the water balance summary + soil moisture bar', () => {
    publish(freshState());
    const { getByTestId, container } = render(<EnvironmentPanel />);
    const summary = getByTestId('environment-water-summary');
    expect(summary.textContent ?? '').not.toBe('');
    const bar = container.querySelector(
      '[role="progressbar"][aria-label="Soil moisture vs capacity"]',
    );
    expect(bar).not.toBeNull();
  });

  it('renders the weather details (condition + temperature + intensity + prevCondition)', () => {
    publish(freshState());
    const { getByTestId } = render(<EnvironmentPanel />);
    expect(getByTestId('environment-weather')).toBeInTheDocument();
    expect(getByTestId('environment-weather').textContent ?? '').toMatch(
      /sunny/i,
    );
  });

  it('renders the pollution summary', () => {
    publish(freshState());
    const { getByTestId } = render(<EnvironmentPanel />);
    const pollution = getByTestId('environment-pollution');
    expect(pollution.textContent ?? '').not.toBe('');
    expect(pollution.textContent ?? '').toMatch(/clean/i);
  });

  it('renders the biodiversity index', () => {
    publish(freshState());
    const { getByTestId } = render(<EnvironmentPanel />);
    expect(getByTestId('environment-biodiversity')).toBeInTheDocument();
    expect(getByTestId('environment-biodiversity').textContent ?? '').toMatch(
      /Biodiversity index/,
    );
  });

  it('shows the species population list when entries exist', () => {
    const base = freshState();
    publish({
      ...base,
      world: {
        ...base.world,
        environment: {
          ...base.world.environment,
          biodiversity: {
            index: 0.7,
            speciesPopulations: [
              { speciesId: 'bird:robin', population: 12 },
              { speciesId: 'insect:bee', population: 200 },
            ],
          },
        },
      },
    });
    const { queryByTestId } = render(<EnvironmentPanel />);
    expect(queryByTestId('environment-species-populations')).not.toBeNull();
    const pops = queryByTestId('environment-species-populations');
    expect(pops?.textContent ?? '').toMatch(/bird:robin/);
    expect(pops?.textContent ?? '').toMatch(/insect:bee/);
  });
});
