/**
 * Tests for the TradePanel (P13-B / GAP-24 — international trade UI).
 *
 * Covers:
 *   - Returns null until simState is published.
 *   - Renders a trade row per market + shows the foreign (world) price for
 *     each — food at 0.8× base ($8.00), energy at 1.2× base ($0.60).
 *   - Shows the import tariff rate.
 *   - Dispatches `import-commodity` when the Import button is clicked
 *     (inventory credited + cash debited by the foreign price × qty).
 *   - Disables Import when the player can't afford.
 *   - Disables Export when inventory is short.
 *   - Dispatches `export-commodity` after inventory is stocked (import then
 *     export — revenue issued to the player).
 *
 * Environment: happy-dom. Each test publishes a `GameState` snapshot via the
 * store's `commitSimState` helper; dispatch routes through the real engine.
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
import { TradePanel } from '../../../components/economy/TradePanel';

function freshState(overrides: Partial<GameState> = {}): GameState {
  return {
    ...engine.initialize({ ...DEFAULT_GAME_CONFIG, createdAt: 1_700_000_000_000 }),
    ...overrides,
  };
}

function publish(state: GameState): void {
  useGameStore.getState().commitSimState(state, []);
}

describe('TradePanel (P13-B / GAP-24)', () => {
  beforeEach(() => __resetGameStoreForTests());
  afterEach(() => cleanup());

  it('returns null until simState is published', () => {
    const { container } = render(<TradePanel />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a trade row per market + the foreign (world) price for each', () => {
    publish(freshState());
    const { getByTestId } = render(<TradePanel />);
    expect(getByTestId('trade-panel')).toBeInTheDocument();
    // Food: base 1000 minor ($10.00) × 0.8 = 800 minor = $8.00 foreign.
    const foodForeign = getByTestId('trade-foreign-market:food');
    expect(foodForeign.textContent ?? '').toMatch(/\$8\.00/);
    // Energy: base 50 minor ($0.50) × 1.2 = 60 minor = $0.60 foreign.
    const energyForeign = getByTestId('trade-foreign-market:energy');
    expect(energyForeign.textContent ?? '').toMatch(/\$0\.60/);
    // Water: neutral 1.0 multiplier → foreign == base == $0.10.
    const waterForeign = getByTestId('trade-foreign-market:water');
    expect(waterForeign.textContent ?? '').toMatch(/\$0\.10/);
  });

  it('shows the import tariff rate (0% by default)', () => {
    publish(freshState());
    const { getByTestId } = render(<TradePanel />);
    // The tariff stat renders the governmentPolicy.tariffRate as a percent.
    expect(getByTestId('trade-panel').textContent ?? '').toMatch(/0\.0%/);
  });

  it('dispatches import-commodity when Import is clicked (inventory credited + cash debited by foreign price)', () => {
    const base = freshState();
    publish(base);
    const cashBefore = BigInt(base.player.personalCash);
    const { getByTestId } = render(<TradePanel />);
    // Default qty = 1. Import 1 food @ foreign 800 → cash drops 800, inventory
    // gains 1 resource:food.
    fireEvent.click(getByTestId('trade-import-market:food'));
    const after = useGameStore.getState().simState!;
    expect(BigInt(after.player.personalCash)).toBe(cashBefore - 800n);
    const food = after.inventory.items.find((i) => i.resourceId === 'resource:food');
    expect(food?.quantity).toBe(1);
  });

  it('disables Import when the player cannot afford the foreign cost', () => {
    const base = freshState();
    // Starve the player — $0.01 (1 minor) can't import food ($8.00).
    publish({ ...base, player: { ...base.player, personalCash: '1' } });
    const { getByTestId } = render(<TradePanel />);
    const importBtn = getByTestId('trade-import-market:food') as HTMLButtonElement;
    expect(importBtn.disabled).toBe(true);
    expect(getByTestId('trade-import-short-market:food')).toBeInTheDocument();
  });

  it('disables Export when inventory is short (held 0)', () => {
    publish(freshState()); // empty inventory
    const { getByTestId } = render(<TradePanel />);
    const exportBtn = getByTestId('trade-export-market:food') as HTMLButtonElement;
    expect(exportBtn.disabled).toBe(true);
    expect(getByTestId('trade-export-short-market:food')).toBeInTheDocument();
  });

  it('dispatches export-commodity after inventory is stocked (import then export)', () => {
    const base = freshState();
    publish(base);
    const cashBefore = BigInt(base.player.personalCash);
    const { getByTestId } = render(<TradePanel />);
    // 1. Import 1 food @ foreign 800 → inventory +1 food, cash -800.
    fireEvent.click(getByTestId('trade-import-market:food'));
    let after = useGameStore.getState().simState!;
    expect(BigInt(after.player.personalCash)).toBe(cashBefore - 800n);
    // 2. Re-render picks up the new state (the store subscription fires).
    // Export 1 food @ foreign 800 → revenue +800 issued, inventory -1 food.
    fireEvent.click(getByTestId('trade-export-market:food'));
    after = useGameStore.getState().simState!;
    expect(BigInt(after.player.personalCash)).toBe(cashBefore);
    const food = after.inventory.items.find((i) => i.resourceId === 'resource:food');
    expect(food).toBeUndefined(); // exported the single unit → item dropped
  });
});
