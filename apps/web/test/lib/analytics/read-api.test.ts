/**
 * GAP-31 Phase 3 (DR-13) — read-only query API tests (the observability panel's
 * data layer).
 *
 * Exercises queryAnalyticsEvents (filter + limit + most-recent-first),
 * countAnalyticsByCategory, clearAnalytics, exportAnalyticsJson (header + full
 * dump), + the no-store fallback (empty / zeros / '[]').
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  initAnalytics,
  resetAnalytics,
  recordAnalyticsEvent,
  queryAnalyticsEvents,
  countAnalyticsByCategory,
  clearAnalytics,
  exportAnalyticsJson,
  getAnalyticsStore,
} from '../../../lib/analytics/analytics';
import { InMemoryAnalyticsStore } from '@capitalist-tree/analytics';

let store: InMemoryAnalyticsStore;

beforeEach(() => {
  store = new InMemoryAnalyticsStore();
  initAnalytics(store);
});
afterEach(() => {
  resetAnalytics();
});

describe('read API (Phase 3 observability)', () => {
  it('getAnalyticsStore returns the backing store', () => {
    expect(getAnalyticsStore()).toBe(store);
  });

  it('countAnalyticsByCategory counts per category', async () => {
    recordAnalyticsEvent('tree-planted', 'gameplay');
    recordAnalyticsEvent('tree-died', 'gameplay');
    recordAnalyticsEvent('sim-summary', 'simulation');
    recordAnalyticsEvent('tick-perf', 'performance');
    recordAnalyticsEvent('error-caught', 'error');
    await flushMicrotasks();
    const counts = await countAnalyticsByCategory();
    expect(counts).toEqual({ gameplay: 2, simulation: 1, performance: 1, error: 1 });
  });

  it('queryAnalyticsEvents filters by category + limits, most-recent first', async () => {
    for (let i = 0; i < 5; i++) recordAnalyticsEvent('tick-perf', 'performance', { i });
    await flushMicrotasks();
    const recent = await queryAnalyticsEvents({ category: 'performance', limit: 3 });
    expect(recent).toHaveLength(3);
    // most-recent first → i=4, 3, 2
    expect((recent[0]?.data as { i: number }).i).toBe(4);
    expect((recent[2]?.data as { i: number }).i).toBe(2);
  });

  it('queryAnalyticsEvents filters by event name', async () => {
    recordAnalyticsEvent('tree-planted', 'gameplay');
    recordAnalyticsEvent('tree-died', 'gameplay');
    recordAnalyticsEvent('tree-planted', 'gameplay');
    await flushMicrotasks();
    const planted = await queryAnalyticsEvents({ event: 'tree-planted' });
    expect(planted).toHaveLength(2);
    expect(planted.every((e) => e.event === 'tree-planted')).toBe(true);
  });

  it('clearAnalytics wipes the store (never touches anything else)', async () => {
    recordAnalyticsEvent('x', 'gameplay');
    await flushMicrotasks();
    expect(await store.count()).toBe(1);
    await clearAnalytics();
    expect(await store.count()).toBe(0);
  });

  it('exportAnalyticsJson dumps all events with a header', async () => {
    recordAnalyticsEvent('tree-planted', 'gameplay', { species: 'oak' });
    recordAnalyticsEvent('tick-perf', 'performance', { tick: 1, fps: 60 });
    await flushMicrotasks();
    const json = await exportAnalyticsJson();
    const parsed = JSON.parse(json) as {
      exportedAt: string;
      count: number;
      events: { event: string; data?: unknown }[];
    };
    expect(typeof parsed.exportedAt).toBe('string');
    expect(parsed.count).toBe(2);
    expect(parsed.events).toHaveLength(2);
    expect(parsed.events[0]?.event).toBe('tick-perf'); // most-recent first
  });

  it('returns empty / zeros / "[]" when no store is installed', async () => {
    resetAnalytics();
    expect(getAnalyticsStore()).toBeNull();
    expect(await queryAnalyticsEvents()).toEqual([]);
    expect(await countAnalyticsByCategory()).toEqual({
      gameplay: 0,
      simulation: 0,
      performance: 0,
      error: 0,
    });
    expect(await exportAnalyticsJson()).toBe('[]');
    await expect(clearAnalytics()).resolves.toBeUndefined();
  });
});

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
