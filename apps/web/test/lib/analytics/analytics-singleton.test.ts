/**
 * GAP-31 Phase 2 (DR-13) — analytics singleton integration tests.
 *
 * Exercises the sim-summary cadence end-to-end through the real collector +
 * InMemoryAnalyticsStore: the first call seeds (no emit), a sim-day later
 * emits a `sim-summary` event, + a backward clock (newGame) re-seeds without
 * emitting.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  initAnalytics,
  resetAnalytics,
  recordSimSummaryIfDue,
} from '../../../lib/analytics/analytics';
import { InMemoryAnalyticsStore } from '@capitalist-tree/analytics';
import type { GameState } from '@capitalist-tree/shared';

let store: InMemoryAnalyticsStore;

beforeEach(() => {
  store = new InMemoryAnalyticsStore();
  initAnalytics(store);
});
afterEach(() => {
  resetAnalytics();
});

/** Minimal GameState fixture — only the fields recordSimSummaryIfDue /
 *  extractSimSummary touch (clock.elapsedSeconds + the summary paths). */
function fixture(elapsedSeconds: number): GameState {
  return {
    clock: { elapsedSeconds },
    originalTree: {
      alive: true,
      ageDays: elapsedSeconds / 86_400,
      structure: { height: 1, trunkDiameter: 0.1, branchDevelopment: 1, structuralIntegrity: 1 },
      health: 0.9,
      energy: { reserves: 50, production: 0, consumption: 0 },
    },
    world: { environment: { airQuality: 0.95, oceanHealth: 0.9 } },
    economy: { totalIssued: '50000' },
  } as unknown as GameState;
}

describe('recordSimSummaryIfDue', () => {
  it('seeds on the first call without emitting', async () => {
    expect(recordSimSummaryIfDue(fixture(0))).toBe(false);
    await flushMicrotasks();
    expect(await store.count()).toBe(0);
  });

  it('emits a sim-summary event after a full sim-day', async () => {
    recordSimSummaryIfDue(fixture(0)); // seed
    expect(recordSimSummaryIfDue(fixture(86_400))).toBe(true); // 1 sim-day later
    await flushMicrotasks();
    const events = await store.query({ event: 'sim-summary' });
    expect(events).toHaveLength(1);
    expect(events[0]?.category).toBe('simulation');
    expect(events[0]?.simulationTime).toBe(86_400 * 1000);
    expect(events[0]?.data).toMatchObject({
      elapsedSeconds: 86_400,
      tree: { alive: true, height: 1, health: 0.9 },
    });
  });

  it('does not emit twice in the same sim-day', async () => {
    recordSimSummaryIfDue(fixture(0)); // seed
    recordSimSummaryIfDue(fixture(86_400)); // emit
    expect(recordSimSummaryIfDue(fixture(100_000))).toBe(false); // < 2 sim-days
    await flushMicrotasks();
    expect(await store.count()).toBe(1);
  });

  it('re-seeds without emitting when the clock goes backward (newGame)', async () => {
    recordSimSummaryIfDue(fixture(86_400)); // seed at 86400
    expect(recordSimSummaryIfDue(fixture(0))).toBe(false); // reset to 0 — re-seed
    await flushMicrotasks();
    expect(await store.count()).toBe(0);
  });
});

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
