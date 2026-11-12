/**
 * Tests for the OfflineModal + OfflineDeltaRow (P6d2 — TDD §14.4, GDD §4.2).
 *
 * Covers:
 *   - The modal returns null when no summary is parked on the UI slice.
 *   - A parked summary renders the header (title + day range), workload line,
 *     and the biological / economic / environmental delta sections.
 *   - The capped warning renders when `summary.capped === true` and is absent
 *     otherwise.
 *   - The "Your tree died while you were away." line renders in red when
 *     `alive.before && !alive.after` and is absent otherwise.
 *   - The Continue button clears the summary from the UI slice (modal
 *     unmounts + `pendingOfflineSummary` is null).
 *
 * Environment: happy-dom. Each test publishes a mock OfflineSummary via the
 * store's `setPendingOfflineSummary` UI mutator — mirrors the catch-up-on-load
 * trigger's parking path.
 */
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, render, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { OfflineSummary } from '@capitalist-tree/shared';
import {
  useGameStore,
  __resetGameStoreForTests,
} from '../../../stores/game-store';
import { OfflineModal } from '../OfflineModal';

// ----------------------------------------------------------------------------
// Mock OfflineSummary builder.
// ----------------------------------------------------------------------------

const numDelta = (before: number, after: number) => ({ before, after, delta: after - before });
const strDelta = (before: string, after: string) => ({ before, after });
const boolDelta = (before: boolean, after: boolean) => ({ before, after });

function mockSummary(overrides: Partial<OfflineSummary> = {}): OfflineSummary {
  return {
    requestedRealMs: 3_600_000,
    cappedRealMs: 3_600_000,
    simElapsedSeconds: 86_400,
    chunksRun: 1,
    capped: false,
    clockTampered: false,
    fromSimSeconds: 0,
    toSimSeconds: 86_400,
    fromDay: 0,
    toDay: 1,
    biological: {
      height: numDelta(10, 12.5),
      trunkDiameter: numDelta(0.2, 0.25),
      currentLeaves: numDelta(100, 150),
      energyReserves: numDelta(0.4, 0.6),
      waterStored: numDelta(0.5, 0.7),
      health: numDelta(0.7, 0.85),
      stress: numDelta(0.3, 0.2),
      alive: boolDelta(true, true),
    },
    economic: {
      personalCash: strDelta('50000', '55000'),
      monetarySupply: strDelta('100000', '105000'),
      inflationIndex: numDelta(1.0, 1.02),
      totalIssued: strDelta('100000', '105000'),
      transactionsCount: numDelta(0, 3),
    },
    environmental: {
      soilWater: numDelta(0.5, 0.45),
      freshwaterAvailability: numDelta(0.8, 0.75),
      biodiversityIndex: numDelta(0.7, 0.69),
      forestCoverage: numDelta(0.6, 0.6),
      globalTemperature: numDelta(14.0, 14.05),
      co2Concentration: numDelta(420, 421),
    },
    ...overrides,
  } as OfflineSummary;
}

function park(summary: OfflineSummary): void {
  useGameStore.getState().setPendingOfflineSummary(summary);
}

// ----------------------------------------------------------------------------
// Tests.
// ----------------------------------------------------------------------------

describe('OfflineModal (P6d2) — render + dismiss', () => {
  beforeEach(() => __resetGameStoreForTests());
  afterEach(() => cleanup());

  it('returns null when no summary is parked', () => {
    const { container } = render(<OfflineModal />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the header, day range, workload, and all three delta sections', () => {
    park(mockSummary({ fromDay: 4, toDay: 130 }));
    const { getByTestId } = render(<OfflineModal />);
    expect(getByTestId('offline-modal')).toBeInTheDocument();
    expect(getByTestId('offline-modal-title')).toHaveTextContent('While You Were Away');
    // fromDay 4 → Year 1 Day 5; toDay 130 → Year 2 Day 11 (120 days/year).
    expect(getByTestId('offline-modal-range').textContent ?? '').toMatch(
      /Year 1 Day 5 → Year 2 Day 11/,
    );
    expect(getByTestId('offline-modal-workload')).toBeInTheDocument();
    expect(getByTestId('offline-modal-biological')).toBeInTheDocument();
    expect(getByTestId('offline-modal-economic')).toBeInTheDocument();
    expect(getByTestId('offline-modal-environmental')).toBeInTheDocument();
    // Simulated 1 sim day in 1 chunk (86_400 sim sec / 86_400).
    expect(getByTestId('offline-modal-workload').textContent ?? '').toMatch(/Simulated 1 sim days in 1 chunks/);
    // Transactions recorded line.
    expect(getByTestId('offline-modal-transactions').textContent ?? '').toMatch(
      /3 transactions recorded/,
    );
  });

  it('collapses the year prefix when the absence stays within one sim year', () => {
    park(mockSummary({ fromDay: 4, toDay: 46 }));
    const { getByTestId } = render(<OfflineModal />);
    expect(getByTestId('offline-modal-range').textContent ?? '').toMatch(
      /Day 5 → Day 47/,
    );
  });

  it('renders all biological delta rows', () => {
    park(mockSummary());
    const { getByTestId } = render(<OfflineModal />);
    for (const label of [
      'height',
      'trunk-diameter',
      'current-leaves',
      'energy-reserves',
      'water-stored',
      'health',
      'stress',
    ]) {
      expect(getByTestId(`offline-delta-${label}`)).toBeInTheDocument();
    }
  });

  it('renders the economic + environmental delta rows', () => {
    park(mockSummary());
    const { getByTestId } = render(<OfflineModal />);
    expect(getByTestId('offline-delta-personal-cash')).toBeInTheDocument();
    expect(getByTestId('offline-delta-monetary-supply')).toBeInTheDocument();
    expect(getByTestId('offline-delta-inflation-index')).toBeInTheDocument();
    expect(getByTestId('offline-delta-total-issued')).toBeInTheDocument();
    for (const label of [
      'soil-water',
      'freshwater-availability',
      'biodiversity-index',
      'forest-coverage',
      'global-temperature',
      'co2-concentration',
    ]) {
      expect(getByTestId(`offline-delta-${label}`)).toBeInTheDocument();
    }
  });

  it('does NOT show the capped warning when summary.capped is false', () => {
    park(mockSummary({ capped: false }));
    const { queryByTestId } = render(<OfflineModal />);
    expect(queryByTestId('offline-modal-capped-warning')).toBeNull();
  });

  it('shows the capped warning when summary.capped is true', () => {
    park(mockSummary({ capped: true }));
    const { getByTestId } = render(<OfflineModal />);
    expect(getByTestId('offline-modal-capped-warning')).toBeInTheDocument();
    expect(getByTestId('offline-modal-capped-warning').textContent ?? '').toMatch(
      /30-day cap/,
    );
  });

  it('does NOT show the tree-died message when the tree survived', () => {
    park(mockSummary({ biological: { ...mockSummary().biological, alive: boolDelta(true, true) } }));
    const { queryByTestId } = render(<OfflineModal />);
    expect(queryByTestId('offline-modal-tree-died')).toBeNull();
  });

  it('shows the tree-died message when alive.before && !alive.after', () => {
    const base = mockSummary();
    park({
      ...base,
      biological: { ...base.biological, alive: boolDelta(true, false) },
    });
    const { getByTestId } = render(<OfflineModal />);
    expect(getByTestId('offline-modal-tree-died')).toBeInTheDocument();
    expect(getByTestId('offline-modal-tree-died').textContent ?? '').toMatch(
      /Your tree died while you were away/,
    );
  });

  it('clears the summary from UI state when Continue is clicked', () => {
    park(mockSummary());
    const { getByTestId, queryByTestId } = render(<OfflineModal />);
    expect(getByTestId('offline-modal')).toBeInTheDocument();
    fireEvent.click(getByTestId('offline-modal-continue'));
    // The store's UI mutator cleared the parked summary synchronously.
    expect(useGameStore.getState().ui.pendingOfflineSummary).toBeNull();
    // The modal re-rendered to null.
    expect(queryByTestId('offline-modal')).toBeNull();
  });

  it('leaves the simState reference untouched when Continue is clicked (rule 6)', () => {
    // Park a summary; simState is null here (no commit) — the rule-6 check is
    // that the UI mutator doesn't fabricate a simState. Verify pendingOfflineSummary
    // clears but the (null) simState stays null.
    park(mockSummary());
    const before = useGameStore.getState().simState;
    const { getByTestId } = render(<OfflineModal />);
    fireEvent.click(getByTestId('offline-modal-continue'));
    expect(useGameStore.getState().simState).toBe(before);
  });
});
