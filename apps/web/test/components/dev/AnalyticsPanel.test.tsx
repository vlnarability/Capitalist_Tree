/**
 * GAP-31 Phase 3 (DR-13) — AnalyticsPanel tests.
 *
 * Verifies the observability panel renders its sections from the read API
 * (counts by category, latest sim-summary + trend, tick perf aggregate, error
 * history, recent gameplay), that the Clear button wipes the store, that the
 * Export button runs without error, + that the panel is null when closed.
 *
 * Environment: happy-dom — React Testing Library `render` needs a DOM.
 */
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { AnalyticsPanel } from '../../../components/dev/AnalyticsPanel';
import {
  initAnalytics,
  resetAnalytics,
  recordAnalyticsEvent,
} from '../../../lib/analytics/analytics';
import { InMemoryAnalyticsStore } from '@capitalist-tree/analytics';

let store: InMemoryAnalyticsStore;

beforeEach(() => {
  store = new InMemoryAnalyticsStore();
  initAnalytics(store);
  // Seed one of each kind so every panel section has content.
  recordAnalyticsEvent('tree-planted', 'gameplay', { species: 'oak' });
  recordAnalyticsEvent('tree-died', 'gameplay');
  recordAnalyticsEvent('sim-summary', 'simulation', {
    elapsedSeconds: 86_400,
    tree: { alive: true, ageDays: 1, height: 1.2, trunkDiameter: 0.1, health: 0.9, energyReserves: 50 },
    environment: { airQuality: 0.95, oceanHealth: 0.9 },
    economy: { totalIssued: '50000' },
  });
  recordAnalyticsEvent('tick-perf', 'performance', { tick: 60, tickDurationMs: 1.5, fps: 60 });
  recordAnalyticsEvent('error-caught', 'error', { message: 'boom', stack: 'Error: boom' });
  // Let the collector flush to the store before the panel reads it.
  return flush();
});
afterEach(() => {
  resetAnalytics();
  cleanup();
  vi.restoreAllMocks();
});

describe('AnalyticsPanel', () => {
  it('is null when closed', () => {
    const { container } = render(<AnalyticsPanel open={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders event counts by category', async () => {
    const { findByTestId } = render(<AnalyticsPanel open={true} onClose={() => {}} />);
    // Each count card's text starts with the count (the label follows).
    expect((await findByTestId('count-gameplay')).textContent ?? '').toMatch(/^2/);
    expect((await findByTestId('count-simulation')).textContent ?? '').toMatch(/^1/);
    expect((await findByTestId('count-performance')).textContent ?? '').toMatch(/^1/);
    expect((await findByTestId('count-error')).textContent ?? '').toMatch(/^1/);
  });

  it('renders the latest sim-summary snapshot (sim-day label)', async () => {
    const { findByText } = render(<AnalyticsPanel open={true} onClose={() => {}} />);
    // The latest block labels the sim-day (height/health also render but appear
    // in both the latest block + the trend table, so the sim-day label is the
    // unique assertion).
    expect(await findByText('Latest (sim-day 1)')).toBeTruthy();
  });

  it('renders the tick-perf aggregate (latest FPS)', async () => {
    const { findByText } = render(<AnalyticsPanel open={true} onClose={() => {}} />);
    // The latest FPS stat card shows 60.
    expect(await findByText('Latest FPS')).toBeTruthy();
  });

  it('renders the error history with the error message', async () => {
    const { findByText } = render(<AnalyticsPanel open={true} onClose={() => {}} />);
    expect(await findByText('boom')).toBeTruthy();
  });

  it('renders recent gameplay events', async () => {
    const { findAllByText } = render(<AnalyticsPanel open={true} onClose={() => {}} />);
    // tree-planted + tree-died both appear as recent gameplay event names.
    const planted = await findAllByText('tree-planted');
    const died = await findAllByText('tree-died');
    expect(planted.length).toBeGreaterThanOrEqual(1);
    expect(died.length).toBeGreaterThanOrEqual(1);
  });

  it('Clear history wipes the store (after confirm) + refreshes to zero counts', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { findByTestId, getByText } = render(<AnalyticsPanel open={true} onClose={() => {}} />);
    // Wait for the initial render to populate.
    await findByTestId('count-gameplay');
    const clearBtn = getByText('Clear history');
    clearBtn.click();
    // The panel clears the store + refreshes; gameplay count drops to 0.
    await findByTestId('count-gameplay');
    // Let the refresh propagate.
    await flush();
    expect(await store.count()).toBe(0);
  });

  it('Export JSON runs without error (the read API is covered separately)', async () => {
    // Stub the download primitives so no real anchor click happens in the test env.
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
    vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);
    const { findByTestId, getByText } = render(<AnalyticsPanel open={true} onClose={() => {}} />);
    await findByTestId('count-gameplay');
    expect(() => getByText('Export JSON').click()).not.toThrow();
  });
});

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
