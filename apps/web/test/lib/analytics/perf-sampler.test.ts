/**
 * GAP-31 Phase 2 (DR-13) — PerfSampler tests.
 *
 * Covers: cadence gating (no emit before N ticks), emits every N ticks with
 * the tick duration + derived FPS, + continues after the cadence (multiple
 * samples over a long run). Uses the real analytics singleton (init'd with an
 * InMemoryAnalyticsStore) so the emit path is exercised end-to-end.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PerfSampler } from '../../../lib/analytics/perf-sampler';
import { initAnalytics, resetAnalytics } from '../../../lib/analytics/analytics';
import { InMemoryAnalyticsStore } from '@capitalist-tree/analytics';

let store: InMemoryAnalyticsStore;

beforeEach(() => {
  store = new InMemoryAnalyticsStore();
  initAnalytics(store);
});
afterEach(() => {
  resetAnalytics();
});

describe('PerfSampler', () => {
  it('does not emit before the cadence is reached', async () => {
    const sampler = new PerfSampler(3);
    sampler.recordTick(1, 16.67);
    sampler.recordTick(2, 16.67);
    await flushMicrotasks();
    expect(await store.count()).toBe(0);
  });

  it('emits a tick-perf event on every Nth tick with duration + FPS', async () => {
    const sampler = new PerfSampler(3);
    sampler.recordTick(1.5, 16.67);
    sampler.recordTick(1.2, 16.67);
    sampler.recordTick(1.8, 16.67); // 3rd → emit
    await flushMicrotasks();
    const events = await store.query({ event: 'tick-perf' });
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toMatchObject({
      tick: 3,
      tickDurationMs: 1.8,
      fps: 60, // 1000 / 16.67 ≈ 60
    });
  });

  it('emits multiple samples over a long run (every Nth tick)', async () => {
    const sampler = new PerfSampler(2);
    for (let i = 1; i <= 6; i++) sampler.recordTick(i, 16.67);
    await flushMicrotasks();
    const events = await store.query({ event: 'tick-perf' });
    // Emits on tick 2, 4, 6 → 3 samples.
    expect(events).toHaveLength(3);
    expect(events.map((e) => (e.data as { tick: number }).tick)).toEqual([2, 4, 6]);
  });

  it('is a no-op when no collector is initialized (resetAnalytics)', async () => {
    resetAnalytics();
    const sampler = new PerfSampler(1);
    expect(() => sampler.recordTick(1, 16.67)).not.toThrow();
    await flushMicrotasks();
    // store is the old InMemoryAnalyticsStore (no collector writes to it now).
    expect(await store.count()).toBe(0);
  });
});

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
