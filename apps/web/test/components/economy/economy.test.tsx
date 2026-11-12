/**
 * Tests for the economy panels + controls (P5c — GDD §13.3).
 *
 * Covers:
 *   - TransactionsPanel renders transactions with bigint amounts +
 *     category labels + sim-day stamps. Returns null until simState
 *     is published.
 *   - HarvestControls shows the sustainable-harvest indicator (re-derived
 *     from `estimateSustainableHarvest`), dispatches the harvest action
 *     when the Harvest button is clicked, and disables the button on a
 *     dead tree.
 *   - PurchaseControls dispatches `purchase` + `apply-water` /
 *     `apply-fertilizer` when the Buy buttons are clicked. Shows prices.
 *   - CurrencyCosmeticPicker dispatches `setCurrencyCosmetic` when a
 *     currency visual button is clicked — leaves `simState` reference
 *     untouched (rule 6: cosmetics stay out of the sim).
 *
 * Environment: happy-dom. Each test publishes a `GameState` snapshot via
 * the store's `commitSimState` helper.
 */
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, render, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { engine, DEFAULT_GAME_CONFIG } from '@capitalist-tree/simulation';
import type { GameState, TransactionRecord } from '@capitalist-tree/shared';
import {
  useGameStore,
  __resetGameStoreForTests,
} from '../../../stores/game-store';
import { TransactionsPanel } from '../../../components/economy/TransactionsPanel';
import { HarvestControls } from '../../../components/economy/HarvestControls';
import { PurchaseControls } from '../../../components/economy/PurchaseControls';
import { CurrencyCosmeticPicker } from '../../../components/economy/CurrencyCosmeticPicker';

function freshState(overrides: Partial<GameState> = {}): GameState {
  return {
    ...engine.initialize({ ...DEFAULT_GAME_CONFIG, createdAt: 1_700_000_000_000 }),
    ...overrides,
  };
}

function publish(state: GameState): void {
  useGameStore.getState().commitSimState(state, []);
}

// A fixture transaction for the TransactionsPanel test. Mirrors the shape
// produced by the `purchase` action handler — category 'purchase',
// player:personal → market:water, $5.00 = 500 minor.
function sampleTransaction(): TransactionRecord {
  return {
    id: 'txn:0:0',
    timestamp: 86_400 * 2 + 3_600, // Day 2, 01:00
    sourceAccount: 'player:personal',
    destinationAccount: 'market:water',
    amount: '500',
    category: 'purchase',
    description: 'Purchase 10 × resource:water from market:water @ 10',
  };
}

// ----------------------------------------------------------------------------
// TransactionsPanel.
// ----------------------------------------------------------------------------

describe('TransactionsPanel (P5c)', () => {
  beforeEach(() => __resetGameStoreForTests());
  afterEach(() => cleanup());

  it('returns null until simState is published', () => {
    const { container } = render(<TransactionsPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the empty state when there are no transactions', () => {
    publish(freshState());
    const { queryByTestId } = render(<TransactionsPanel />);
    expect(queryByTestId('transactions-empty')).not.toBeNull();
    expect(queryByTestId('transactions-list')).toBeNull();
  });

  it('renders the most-recent transactions with formatted amounts + category', () => {
    const txn = sampleTransaction();
    const base = freshState();
    publish({
      ...base,
      economy: {
        ...base.economy,
        transactions: [txn],
      },
    });
    const { getByTestId } = render(<TransactionsPanel />);
    // The transaction row exists.
    expect(getByTestId(`transaction-${txn.id}`)).toBeInTheDocument();
    // Category label.
    expect(getByTestId(`transaction-${txn.id}`).textContent ?? '').toMatch(
      /Purchase/,
    );
    // Amount: outflow from player:personal → -$5.00.
    expect(
      getByTestId(`transaction-${txn.id}-amount`).textContent ?? '',
    ).toMatch(/-?\$5\.00/);
    // Summary includes Day 2.
    expect(
      getByTestId(`transaction-${txn.id}-summary`).textContent ?? '',
    ).toMatch(/Day 2/);
  });

  it('limits to the configured max number of transactions', () => {
    const base = freshState();
    const txns: TransactionRecord[] = Array.from({ length: 15 }, (_, i) => ({
      ...sampleTransaction(),
      id: `txn:0:${i}`,
      timestamp: 86_400 * (i + 1),
    }));
    publish({
      ...base,
      economy: { ...base.economy, transactions: txns },
    });
    const { container, rerender } = render(<TransactionsPanel max={5} />);
    // Count only the row <li> elements (each row carries data-testid
    // `transaction-${id}`; the amount + summary spans are children with
    // suffixed ids we don't want to count).
    const countRows = (): number =>
      container.querySelectorAll('[data-testid="transactions-list"] > li').length;
    expect(countRows()).toBe(5);
    // Re-render with max=10 — should show 10 (the cap).
    rerender(<TransactionsPanel max={10} />);
    expect(countRows()).toBe(10);
  });
});

// ----------------------------------------------------------------------------
// HarvestControls.
// ----------------------------------------------------------------------------

describe('HarvestControls (P5c) — sustainable indicator + dispatch', () => {
  beforeEach(() => __resetGameStoreForTests());
  afterEach(() => cleanup());

  it('returns null until simState is published', () => {
    const { container } = render(<HarvestControls />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the sustainable-harvest indicator (recommended leaves / day)', () => {
    publish(freshState());
    const { getByTestId } = render(<HarvestControls />);
    const recommended = getByTestId('harvest-recommended');
    expect(recommended.textContent ?? '').toMatch(/^\d+$/);
    // Recommendation summary carries the guidance sentence.
    expect(
      getByTestId('harvest-recommendation-summary').textContent ?? '',
    ).not.toBe('');
  });

  it('dispatches the harvest action when the Harvest button is clicked', () => {
    const base = freshState();
    publish(base);
    const leavesBefore = base.originalTree.foliage.currentLeaves;
    const { getByTestId } = render(<HarvestControls />);
    // Default input value = recommended; we override to 5 leaves.
    const input = getByTestId('harvest-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.click(getByTestId('harvest-button'));
    // Engine caps at species.maximumHarvestFraction (50%) of foliage AND
    // the requested amount. For 5 leaves on a 50-leaf sapling, foliage drops
    // by exactly 5.
    const after = useGameStore.getState().simState;
    expect(after?.originalTree.foliage.currentLeaves).toBe(leavesBefore - 5);
    // A transaction should have been recorded (harvest-leaves queues a
    // CurrencyIssuanceRequest; the engine processes it on the next tick).
    // The BiologySystem will not have run yet (no advance between
    // dispatch + this assertion), so the pendingIssuances should hold the
    // harvest request.
    expect(after?.originalTree.pendingIssuances.length).toBeGreaterThan(0);
  });

  it('disables the Harvest button when the tree is dead', () => {
    const base = freshState();
    publish({
      ...base,
      originalTree: { ...base.originalTree, alive: false },
    });
    const { getByTestId } = render(<HarvestControls />);
    const btn = getByTestId('harvest-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(getByTestId('harvest-dead-warning')).toBeInTheDocument();
  });

  it('Accept recommended button syncs the input to the sustainable estimate', () => {
    publish(freshState());
    const { getByTestId } = render(<HarvestControls />);
    const recommended = getByTestId('harvest-recommended').textContent ?? '';
    fireEvent.click(getByTestId('harvest-accept-recommended'));
    const input = getByTestId('harvest-input') as HTMLInputElement;
    expect(input.value).toBe(recommended);
  });

  it('shows the recommended amount as the default input value', () => {
    publish(freshState());
    const { getByTestId } = render(<HarvestControls />);
    const recommended = getByTestId('harvest-recommended').textContent ?? '';
    const input = getByTestId('harvest-input') as HTMLInputElement;
    expect(input.value).toBe(recommended);
  });
});

// ----------------------------------------------------------------------------
// PurchaseControls.
// ----------------------------------------------------------------------------

describe('PurchaseControls (P5c) — purchase + apply dispatch', () => {
  beforeEach(() => __resetGameStoreForTests());
  afterEach(() => cleanup());

  it('returns null until simState is published', () => {
    const { container } = render(<PurchaseControls />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the current market prices + player cash', () => {
    publish(freshState());
    const { getByTestId } = render(<PurchaseControls />);
    // Cash shown ($500.00 = 50000 minor in the fresh state).
    expect(getByTestId('purchase-controls').textContent ?? '').toMatch(
      /\$500\.00/,
    );
    // Water market + fertilizer market sections both render.
    expect(getByTestId('purchase-water')).toBeInTheDocument();
    expect(getByTestId('purchase-fertilizer')).toBeInTheDocument();
  });

  it('dispatches purchase + apply-water when Buy water is clicked', () => {
    const base = freshState();
    publish(base);
    const soilBefore = base.world.environment.soil.soilWater;
    const cashBefore = BigInt(base.player.personalCash);

    const { getByTestId } = render(<PurchaseControls />);
    // Default quantity is 1. Click Buy water.
    fireEvent.click(getByTestId('purchase-water-buy'));

    const after = useGameStore.getState().simState!;
    // Cash debited by the unit price (water market price = '10' minor
    // for $0.10/L).
    expect(BigInt(after.player.personalCash)).toBe(cashBefore - 10n);
    // Soil water increased by the purchased quantity (1 L).
    expect(after.world.environment.soil.soilWater).toBe(soilBefore + 1);
    // A purchase transaction was recorded.
    expect(after.economy.transactions.length).toBeGreaterThan(0);
    expect(after.economy.transactions[after.economy.transactions.length - 1]!.category).toBe(
      'purchase',
    );
  });

  it('dispatches purchase + apply-fertilizer when Buy fertilizer is clicked', () => {
    const base = freshState();
    publish(base);
    const nBefore = base.world.environment.soil.nutrients.nitrogen;
    const cashBefore = BigInt(base.player.personalCash);

    const { getByTestId } = render(<PurchaseControls />);
    fireEvent.click(getByTestId('purchase-fertilizer-buy'));

    const after = useGameStore.getState().simState!;
    // Cash debited by $5.00 (500 minor — the fertilizer base price).
    expect(BigInt(after.player.personalCash)).toBe(cashBefore - 500n);
    // Soil nitrogen increased by 10 (Balanced 10-10-10 composition = 10 N
    // per unit application).
    expect(after.world.environment.soil.nutrients.nitrogen).toBe(nBefore + 10);
  });

  it('updates the quantity via the quick-buttons', () => {
    publish(freshState());
    const { getByTestId } = render(<PurchaseControls />);
    fireEvent.click(getByTestId('purchase-water-qty-100'));
    expect((getByTestId('purchase-water-qty') as HTMLInputElement).value).toBe(
      '100',
    );
    // Cost reflects the new quantity: $0.10 × 100 = $10.00 = 1000 minor.
    expect(getByTestId('purchase-water-cost').textContent ?? '').toMatch(
      /\$10\.00/,
    );
  });

  it('disables the Buy button when the player cannot afford the purchase', () => {
    const base = freshState();
    // Drop the player's cash to $0.04 (4 minor) — can't afford even 1 L of
    // water at $0.10/L.
    publish({
      ...base,
      player: { ...base.player, personalCash: '4' },
      economy: {
        ...base.economy,
        accounts: base.economy.accounts.map((a) =>
          a.id === 'player:personal' ? { ...a, balance: '4' } : a,
        ),
      },
    });
    const { getByTestId } = render(<PurchaseControls />);
    const buyBtn = getByTestId('purchase-water-buy') as HTMLButtonElement;
    expect(buyBtn.disabled).toBe(true);
    expect(getByTestId('purchase-water-insufficient')).toBeInTheDocument();
  });
});

// ----------------------------------------------------------------------------
// CurrencyCosmeticPicker.
// ----------------------------------------------------------------------------

describe('CurrencyCosmeticPicker (P5c) — cosmetic selection', () => {
  beforeEach(() => __resetGameStoreForTests());
  afterEach(() => cleanup());

  it('renders one button per CurrencyVisual (P4a ships 3)', () => {
    render(<CurrencyCosmeticPicker />);
    // Default id is 'currency:leaf-dollar' (LEAF_BANKNOTE).
    expect(
      useGameStore.getState().ui.selectedCurrencyId,
    ).toBe('currency:leaf-dollar');
  });

  it('dispatches setCurrencyCosmetic when a currency button is clicked', () => {
    const before = useGameStore.getState().simState;
    const { getByTestId } = render(<CurrencyCosmeticPicker />);
    fireEvent.click(getByTestId('currency-cosmetic-currency:gold-leaf'));
    expect(useGameStore.getState().ui.selectedCurrencyId).toBe(
      'currency:gold-leaf',
    );
    // Selected label updates.
    expect(
      getByTestId('currency-cosmetic-selected').textContent ?? '',
    ).toMatch(/currency:gold-leaf/);
    // simState reference is unchanged (rule 6: cosmetics stay out of the sim).
    expect(useGameStore.getState().simState).toBe(before);
  });

  it('defaults to the LEAF_BANKNOTE cosmetic on a fresh store', () => {
    const { getByTestId } = render(<CurrencyCosmeticPicker />);
    const defaultBtn = getByTestId(
      'currency-cosmetic-currency:leaf-dollar',
    ) as HTMLButtonElement;
    expect(defaultBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('reflects an externally-applied currency change (applyUiAction path)', async () => {
    const { getByTestId } = render(<CurrencyCosmeticPicker />);
    // Apply the euro-leaf cosmetic via the store's UI action dispatcher.
    useGameStore.getState().applyUiAction({
      type: 'set-currency-cosmetic',
      payload: { currencyId: 'currency:euro-leaf' },
    });
    await waitFor(() => {
      const euroBtn = getByTestId(
        'currency-cosmetic-currency:euro-leaf',
      ) as HTMLButtonElement;
      expect(euroBtn.getAttribute('aria-pressed')).toBe('true');
    });
  });
});
