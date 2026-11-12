/**
 * Tests for the AutomationPanel + sub-components (P6d1 — TDD §12, GDD §9).
 *
 * Covers:
 *   - AutomationPanel returns null until simState is published.
 *   - Equipment shop renders all categories + cards; Purchase button is
 *     disabled when the player can't afford and enabled when they can.
 *   - Clicking Purchase dispatches `purchase-equipment` (cash debited +
 *     automation list grows).
 *   - Active automations section shows the empty state when none purchased.
 *   - Active automation rows render the equipment name + policy summary.
 *   - The enable/disable toggle dispatches the correct action.
 *
 * Environment: happy-dom. Each test publishes a `GameState` snapshot via
 * the store's `commitSimState` helper — mirrors the economy panel tests.
 */
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, render, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { engine, DEFAULT_GAME_CONFIG } from '@capitalist-tree/simulation';
import type { AutomationState, GameState } from '@capitalist-tree/shared';
import {
  useGameStore,
  __resetGameStoreForTests,
} from '../../../stores/game-store';
import { AutomationPanel } from '../../../components/automation/AutomationPanel';

function freshState(overrides: Partial<GameState> = {}): GameState {
  return {
    ...engine.initialize({ ...DEFAULT_GAME_CONFIG, createdAt: 1_700_000_000_000 }),
    ...overrides,
  };
}

function publish(state: GameState): void {
  useGameStore.getState().commitSimState(state, []);
}

/** A minimal AutomationState fixture derived from SPRINKLER_T1. */
function sampleAutomation(overrides: Partial<AutomationState> = {}): AutomationState {
  return {
    id: 'automation:equipment:sprinkler-t1:original:0',
    type: 'equipment:sprinkler-t1',
    enabled: true,
    targetId: 'original',
    schedule: { kind: 'interval', value: 86_400 },
    resourceConsumption: [{ resourceId: 'resource:water', amount: 1 }],
    energyConsumption: 0.5,
    maintenanceCost: '5',
    environmentalImpact: {
      carbonEmissions: 0.05,
      waterConsumption: 1.2,
      soilDegradation: 0,
      pollution: 0,
      landDisturbance: 0,
      biodiversityImpact: 0,
    },
    policy: {
      kind: 'threshold',
      condition: {
        field: 'world.environment.soil.soilWater',
        op: '<',
        value: 0.3,
      },
      action: 'apply-water',
      actionParams: { litres: 5 },
    },
    lastRunAt: 0,
    cooldownSeconds: 3600,
    ...overrides,
  } as AutomationState;
}

// ----------------------------------------------------------------------------
// Boot + shop rendering.
// ----------------------------------------------------------------------------

describe('AutomationPanel (P6d1) — boot + equipment shop', () => {
  beforeEach(() => __resetGameStoreForTests());
  afterEach(() => cleanup());

  it('returns null until simState is published', () => {
    const { container } = render(<AutomationPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the equipment shop grouped by category with the basic sprinkler', () => {
    publish(freshState());
    const { getByTestId } = render(<AutomationPanel />);
    expect(getByTestId('automation-shop')).toBeInTheDocument();
    // All five categories render (GDD §9).
    expect(getByTestId('automation-shop-irrigation')).toBeInTheDocument();
    expect(getByTestId('automation-shop-fertilization')).toBeInTheDocument();
    expect(getByTestId('automation-shop-harvesting')).toBeInTheDocument();
    expect(getByTestId('automation-shop-monitoring')).toBeInTheDocument();
    expect(getByTestId('automation-shop-energy')).toBeInTheDocument();
    // The basic sprinkler card is present.
    expect(
      getByTestId('equipment-card-equipment:sprinkler-t1'),
    ).toBeInTheDocument();
    // Cash display reflects the fresh-state cash ($500.00 = 50000 minor).
    expect(getByTestId('automation-cash').textContent ?? '').toMatch(
      /\$500\.00/,
    );
  });

  it('disables the Purchase button when the player cannot afford the equipment', () => {
    const base = freshState();
    publish({
      ...base,
      player: { ...base.player, personalCash: '100' }, // $1.00
    });
    const { getByTestId } = render(<AutomationPanel />);
    const btn = getByTestId(
      'equipment-card-equipment:sprinkler-t1-purchase',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(
      getByTestId('equipment-card-equipment:sprinkler-t1-insufficient'),
    ).toBeInTheDocument();
  });

  it('enables the Purchase button when the player can afford the equipment', () => {
    publish(freshState()); // $500.00 — sprinkler-t1 is $20.00
    const { getByTestId } = render(<AutomationPanel />);
    const btn = getByTestId(
      'equipment-card-equipment:sprinkler-t1-purchase',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('dispatches purchase-equipment when Purchase is clicked (cash debited + automation grows)', () => {
    const base = freshState();
    publish(base);
    const cashBefore = BigInt(base.player.personalCash);
    const { getByTestId } = render(<AutomationPanel />);
    fireEvent.click(
      getByTestId('equipment-card-equipment:sprinkler-t1-purchase'),
    );
    const after = useGameStore.getState().simState!;
    // Cash debited by the sprinkler's $20.00 cost (2000 minor).
    expect(BigInt(after.player.personalCash)).toBe(cashBefore - 2000n);
    // A new automation was appended.
    expect(after.automation.length).toBe(1);
    // The automation's type matches the equipment id (purchase-equipment
    // handler sets type = equipment.id, P6b2).
    expect(after.automation[0]!.type).toBe('equipment:sprinkler-t1');
  });
});

// ----------------------------------------------------------------------------
// Active automations.
// ----------------------------------------------------------------------------

describe('AutomationPanel (P6d1) — active automations', () => {
  beforeEach(() => __resetGameStoreForTests());
  afterEach(() => cleanup());

  it('shows the empty state when no automation has been purchased', () => {
    publish(freshState());
    const { getByTestId, queryByTestId } = render(<AutomationPanel />);
    expect(getByTestId('automation-empty')).toBeInTheDocument();
    expect(queryByTestId('automation-list')).toBeNull();
  });

  it('renders an active automation row with the equipment name + policy summary', () => {
    const base = freshState();
    const a = sampleAutomation();
    publish({ ...base, automation: [a] });
    const { getByTestId } = render(<AutomationPanel />);
    const row = getByTestId(`automation-row-${a.id}`);
    expect(row).toBeInTheDocument();
    // Equipment name resolved via getEquipmentById(automation.type).
    expect(
      getByTestId(`automation-row-${a.id}-name`).textContent ?? '',
    ).toMatch(/Basic Sprinkler/);
    // Policy summary contains the field label + percentage value.
    const policy = getByTestId(`automation-row-${a.id}-policy`);
    expect(policy.textContent ?? '').toMatch(/soil/);
    expect(policy.textContent ?? '').toMatch(/30%/);
  });

  it('dispatches disable-automation when the toggle is clicked on an enabled automation', () => {
    const base = freshState();
    const a = sampleAutomation({ enabled: true });
    publish({ ...base, automation: [a] });
    const { getByTestId } = render(<AutomationPanel />);
    fireEvent.click(getByTestId(`automation-row-${a.id}-toggle`));
    const after = useGameStore.getState().simState!;
    expect(after.automation[0]!.enabled).toBe(false);
  });

  it('dispatches enable-automation when the toggle is clicked on a paused automation', () => {
    const base = freshState();
    const a = sampleAutomation({ enabled: false });
    publish({ ...base, automation: [a] });
    const { getByTestId } = render(<AutomationPanel />);
    fireEvent.click(getByTestId(`automation-row-${a.id}-toggle`));
    const after = useGameStore.getState().simState!;
    expect(after.automation[0]!.enabled).toBe(true);
  });

  it('opens the policy configurator and dispatches set-automation-policy on save', () => {
    const base = freshState();
    const a = sampleAutomation();
    publish({ ...base, automation: [a] });
    const { getByTestId } = render(<AutomationPanel />);
    // Open the configurator.
    fireEvent.click(getByTestId(`automation-row-${a.id}-configure`));
    const valueInput = getByTestId(`policy-value-${a.id}`) as HTMLInputElement;
    // Change the threshold value to 0.5 (50%).
    fireEvent.change(valueInput, { target: { value: '0.5' } });
    fireEvent.click(getByTestId(`policy-submit-${a.id}`));
    const after = useGameStore.getState().simState!;
    // The policy's threshold value was updated to 0.5.
    const policy = after.automation[0]!.policy;
    expect(policy).toBeDefined();
    expect(policy?.kind).toBe('threshold');
    if (policy?.kind === 'threshold') {
      expect(policy.condition.value).toBe(0.5);
    }
  });
});
