/**
 * Tests for LaborControls (W54 / P12-D — GDD §7.3 second income path).
 *
 * Covers:
 *   - Returns null until simState is published.
 *   - Shows the wage preview for the selected hours ($5/hr × hours).
 *   - Dispatches `perform-labor` when the Work button is clicked — cash
 *     rises + exhaustion accrues.
 *   - Disables the Work button when health is below the min-to-work
 *     threshold (0.15) and shows the inline warning.
 *   - Disables the Work button when the shift would overflow exhaustion.
 *
 * Environment: happy-dom. Each test publishes a `GameState` snapshot via
 * the store's `commitSimState` helper (mirrors economy.test.tsx).
 */
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, render, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { engine, DEFAULT_GAME_CONFIG } from '@capitalist-tree/simulation';
import type { GameState } from '@capitalist-tree/shared';
import {
  useGameStore,
  __resetGameStoreForTests,
} from '../../../stores/game-store';
import { LaborControls } from '../../../components/economy/LaborControls';

function freshState(overrides: Partial<GameState> = {}): GameState {
  return {
    ...engine.initialize({ ...DEFAULT_GAME_CONFIG, createdAt: 1_700_000_000_000 }),
    ...overrides,
  };
}

function publish(state: GameState): void {
  useGameStore.getState().commitSimState(state, []);
}

describe('LaborControls (W54) — wage preview + dispatch + guards', () => {
  beforeEach(() => __resetGameStoreForTests());
  afterEach(() => cleanup());

  it('returns null until simState is published', () => {
    const { container } = render(<LaborControls />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the wage preview for the default 8-hour shift ($40.00)', () => {
    publish(freshState());
    const { getByTestId } = render(<LaborControls />);
    // Default hours = 8; $5/hr × 8 = $40.00.
    expect(getByTestId('labor-wage').textContent ?? '').toBe('$40.00');
  });

  it('updates the wage preview when the shift length changes', () => {
    publish(freshState());
    const { getByTestId } = render(<LaborControls />);
    const input = getByTestId('labor-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '4' } });
    // $5/hr × 4 = $20.00.
    expect(getByTestId('labor-wage').textContent ?? '').toBe('$20.00');
  });

  it('dispatches perform-labor when the Work button is clicked (cash rises + exhaustion accrues)', () => {
    const base = freshState();
    publish(base);
    const cashBefore = BigInt(base.player.personalCash);
    const exhaustionBefore = base.player.laborExhaustion;
    const { getByTestId } = render(<LaborControls />);
    // Default hours = 8.
    fireEvent.click(getByTestId('labor-button'));
    const after = useGameStore.getState().simState;
    // $5/hr × 8 = 4000 minor = $40.00 credited from authority.
    expect(after?.player.personalCash).toBe(String(cashBefore + 4000n));
    // 8 hr × 0.05 = 0.40 exhaustion added.
    expect(after?.player.laborExhaustion).toBeCloseTo(exhaustionBefore + 0.4, 10);
  });

  it('disables the Work button when health is below the min-to-work threshold', () => {
    const base = freshState();
    publish({
      ...base,
      player: { ...base.player, health: 0.1 }, // below 0.15 min.
    });
    const { getByTestId } = render(<LaborControls />);
    const btn = getByTestId('labor-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(getByTestId('labor-warning')).toBeInTheDocument();
    expect(getByTestId('labor-warning').textContent ?? '').toMatch(/health too low/i);
  });

  it('disables the Work button when the shift would overflow exhaustion', () => {
    const base = freshState();
    // Start exhaustion high enough that an 8-hour shift (0.40 gain) would
    // exceed the 1.0 cap: 0.7 + 0.4 = 1.1 > 1.0.
    publish({
      ...base,
      player: { ...base.player, laborExhaustion: 0.7 },
    });
    const { getByTestId } = render(<LaborControls />);
    const btn = getByTestId('labor-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(getByTestId('labor-warning').textContent ?? '').toMatch(/too exhausted/i);
  });

  it('enables the Work button when healthy + exhaustion allows the shift', () => {
    publish(freshState());
    const { getByTestId } = render(<LaborControls />);
    const btn = getByTestId('labor-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    // No warning shown when the player can work.
    expect(() => getByTestId('labor-warning')).toThrow();
  });

  it('clamps the input to the max shift length (12 hours)', () => {
    publish(freshState());
    const { getByTestId } = render(<LaborControls />);
    const input = getByTestId('labor-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '20' } });
    // The component clamps hours to 12 internally; wage = $5 × 12 = $60.00.
    expect(getByTestId('labor-wage').textContent ?? '').toBe('$60.00');
  });
});
