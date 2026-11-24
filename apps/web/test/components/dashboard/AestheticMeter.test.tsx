/**
 * AestheticMeter tests (W51).
 *
 * The meter is a thin presentational component over the
 * `selectSustainabilityScore` store selector. These tests verify it renders
 * nothing pre-boot (simState null) + shows the score / pips / tier label once
 * the sim state is published. The store is driven directly via `setState`
 * with a minimal GameState fixture (only the fields the score reads).
 */
// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { AestheticMeter } from '../../../components/dashboard/AestheticMeter';
import { useGameStore } from '../../../stores/game-store';
import type { GameState } from '@capitalist-tree/shared';

function makeState(opts: {
  leaves?: number;
  leafCapacity?: number;
  health?: number;
  resilience?: number;
  biodiversity?: number;
  soilHealth?: number;
  airQuality?: number;
  contamination?: number;
  degraded?: number;
}): GameState {
  return {
    originalTree: {
      foliage: { currentLeaves: opts.leaves ?? 50, leafCapacity: opts.leafCapacity ?? 200 },
      health: opts.health ?? 1,
    },
    world: {
      environment: {
        ecosystemResilience: opts.resilience ?? 0.8,
        biodiversity: { index: opts.biodiversity ?? 0.8 },
        soil: { health: opts.soilHealth ?? 1, contamination: opts.contamination ?? 0 },
        airQuality: opts.airQuality ?? 1,
        landUse: { developed: 0, degraded: opts.degraded ?? 0, protected: 0 },
      },
    },
  } as unknown as GameState;
}

describe('AestheticMeter (W51)', () => {
  beforeEach(() => {
    cleanup();
    useGameStore.setState({ simState: null });
  });

  it('renders nothing pre-boot (simState null)', () => {
    const { container } = render(<AestheticMeter />);
    expect(container.firstChild).toBeNull();
  });

  it('renders score 5 + the neutral tier for the pristine start', () => {
    useGameStore.setState({ simState: makeState({}) });
    render(<AestheticMeter />);
    const meter = screen.getByTestId('aesthetic-meter');
    expect(meter).toHaveAttribute('data-aesthetic-tier', 'neutral');
    expect(screen.getByText('5/10')).toBeInTheDocument();
    expect(screen.getByText('Balanced')).toBeInTheDocument();
  });

  it('renders 10 pips (filled up to the score)', () => {
    useGameStore.setState({ simState: makeState({}) });
    render(<AestheticMeter />);
    const pips = screen.getByRole('img').querySelectorAll('span');
    expect(pips.length).toBe(10);
  });

  it('renders the exploitation tier at a low score', () => {
    // over-harvested + degraded → brutalist tier.
    useGameStore.setState({
      simState: makeState({
        leaves: 10,
        health: 0.5,
        soilHealth: 0.5,
        airQuality: 0.5,
        degraded: 0.3,
      }),
    });
    render(<AestheticMeter />);
    const meter = screen.getByTestId('aesthetic-meter');
    expect(meter).toHaveAttribute('data-aesthetic-tier', 'brutalist');
    expect(screen.getByText('Exploitation')).toBeInTheDocument();
  });

  it('renders the sustainability tier at a high score', () => {
    // full lush canopy + pristine ecology → floral tier (score 10).
    useGameStore.setState({ simState: makeState({ leaves: 200 }) });
    render(<AestheticMeter />);
    const meter = screen.getByTestId('aesthetic-meter');
    expect(meter).toHaveAttribute('data-aesthetic-tier', 'floral');
    expect(screen.getByText('Sustainability')).toBeInTheDocument();
  });
});
