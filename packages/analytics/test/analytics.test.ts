/**
 * GAP-31 (DR-13) — @capitalist-tree/analytics unit tests.
 *
 * Covers: schema validation, noopEmitter, InMemoryAnalyticsStore (put/query/
 * count/clear + retention cap), + createCollector (shaping, sim-time stamping,
 * invalid-event drop, store-failure swallowed, fire-and-forget).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  ANALYTICS_SCHEMA_VERSION,
  analyticsEventSchema,
  noopEmitter,
  InMemoryAnalyticsStore,
  createCollector,
} from '../src/index.js';
import type { AnalyticsStore, AnalyticsEvent } from '../src/index.js';

describe('analyticsEventSchema', () => {
  it('parses a well-formed event', () => {
    const ev = {
      id: 'a-1',
      schemaVersion: ANALYTICS_SCHEMA_VERSION,
      timestamp: 1000,
      simulationTime: 5000,
      category: 'gameplay',
      event: 'tree-died',
      data: { cause: 'neglect' },
    };
    const parsed = analyticsEventSchema.safeParse(ev);
    expect(parsed.success).toBe(true);
  });

  it('accepts an event without a data payload', () => {
    const parsed = analyticsEventSchema.safeParse({
      id: 'a-2',
      schemaVersion: ANALYTICS_SCHEMA_VERSION,
      timestamp: 1000,
      simulationTime: 0,
      category: 'error',
      event: 'save-corrupt',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown category', () => {
    const parsed = analyticsEventSchema.safeParse({
      id: 'a-3',
      schemaVersion: ANALYTICS_SCHEMA_VERSION,
      timestamp: 1,
      simulationTime: 0,
      category: 'cosmetic', // not in the enum
      event: 'x',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a wrong schemaVersion', () => {
    const parsed = analyticsEventSchema.safeParse({
      id: 'a-4',
      schemaVersion: 999,
      timestamp: 1,
      simulationTime: 0,
      category: 'gameplay',
      event: 'x',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('noopEmitter', () => {
  it('can be called with no effect (no throw)', () => {
    expect(() => noopEmitter.emit('anything', 'gameplay', { x: 1 })).not.toThrow();
  });
});

describe('InMemoryAnalyticsStore', () => {
  it('puts + queries events (most-recent first)', async () => {
    const store = new InMemoryAnalyticsStore();
    await store.put(makeEvent('a', 100, 'gameplay', 'tree-died'));
    await store.put(makeEvent('b', 300, 'error', 'save-corrupt'));
    await store.put(makeEvent('c', 200, 'gameplay', 'objective-completed'));

    const all = await store.query();
    expect(all.map((e) => e.id)).toEqual(['b', 'c', 'a']); // 300, 200, 100

    const gameplay = await store.query({ category: 'gameplay' });
    expect(gameplay.map((e) => e.id)).toEqual(['c', 'a']);

    const since = await store.query({ since: 150 });
    expect(since.map((e) => e.id)).toEqual(['b', 'c']);

    const limited = await store.query({ limit: 1 });
    expect(limited.map((e) => e.id)).toEqual(['b']);
  });

  it('counts events, optionally by category', async () => {
    const store = new InMemoryAnalyticsStore();
    await store.put(makeEvent('a', 1, 'gameplay', 'x'));
    await store.put(makeEvent('b', 2, 'gameplay', 'y'));
    await store.put(makeEvent('c', 3, 'error', 'z'));
    expect(await store.count()).toBe(3);
    expect(await store.count('gameplay')).toBe(2);
    expect(await store.count('error')).toBe(1);
    expect(await store.count('simulation')).toBe(0);
  });

  it('clears all events', async () => {
    const store = new InMemoryAnalyticsStore();
    await store.put(makeEvent('a', 1, 'gameplay', 'x'));
    await store.clear();
    expect(await store.count()).toBe(0);
  });

  it('enforces the maxEvents retention cap (evicts oldest)', async () => {
    const store = new InMemoryAnalyticsStore(3);
    await store.put(makeEvent('old', 100, 'gameplay', 'x'));
    await store.put(makeEvent('mid', 200, 'gameplay', 'x'));
    await store.put(makeEvent('new', 300, 'gameplay', 'x'));
    await store.put(makeEvent('newest', 400, 'gameplay', 'x')); // over cap
    expect(await store.count()).toBe(3);
    const ids = (await store.query({ limit: 3 })).map((e) => e.id);
    // oldest (timestamp 100) evicted
    expect(ids).toContain('newest');
    expect(ids).toContain('new');
    expect(ids).toContain('mid');
    expect(ids).not.toContain('old');
  });
});

describe('createCollector', () => {
  it('shapes + persists an emitted event (fire-and-forget)', async () => {
    const store = new InMemoryAnalyticsStore();
    const collector = createCollector(store);
    collector.setSimTime(42_000);
    collector.emit('tree-died', 'gameplay', { cause: 'neglect' });

    // emit is sync fire-and-forget; the flush is async. Wait a tick.
    await flushMicrotasks();
    const events = await store.query();
    expect(events).toHaveLength(1);
    expect(events[0]?.event).toBe('tree-died');
    expect(events[0]?.category).toBe('gameplay');
    expect(events[0]?.simulationTime).toBe(42_000);
    expect(events[0]?.schemaVersion).toBe(ANALYTICS_SCHEMA_VERSION);
    expect(events[0]?.data).toEqual({ cause: 'neglect' });
  });

  it('stamps timestamp at emit time (wall-clock)', async () => {
    const store = new InMemoryAnalyticsStore();
    const collector = createCollector(store);
    const before = Date.now();
    collector.emit('save-loaded', 'gameplay');
    await flushMicrotasks();
    const after = Date.now();
    const ev = (await store.query())[0];
    expect(ev.timestamp).toBeGreaterThanOrEqual(before);
    expect(ev.timestamp).toBeLessThanOrEqual(after);
  });

  it('drops an event with an invalid category (never throws)', async () => {
    const store = new InMemoryAnalyticsStore();
    const collector = createCollector(store);
    // @ts-expect-error — intentionally invalid category
    expect(() => collector.emit('x', 'bogus', {})).not.toThrow();
    await flushMicrotasks();
    expect(await store.count()).toBe(0);
  });

  it('swallows store.put failures (sim continues)', async () => {
    const failingStore: AnalyticsStore = {
      put: vi.fn().mockRejectedValue(new Error('IndexedDB gone')),
      query: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      clear: vi.fn().mockResolvedValue(undefined),
    };
    const collector = createCollector(failingStore);
    // Emit many events — none should throw, the failing put should not propagate.
    expect(() => {
      for (let i = 0; i < 5; i++) collector.emit('tree-died', 'gameplay', { i });
    }).not.toThrow();
    // Let the flush drain (it catches the rejections).
    await flushMicrotasks();
    await flushMicrotasks();
    expect(failingStore.put).toHaveBeenCalled();
  });

  it('coalesces concurrent emits into one drain loop (no lost events)', async () => {
    const store = new InMemoryAnalyticsStore();
    const collector = createCollector(store);
    // Fire 10 emits synchronously — they all buffer before the first flush drains.
    for (let i = 0; i < 10; i++) collector.emit('tick', 'simulation', { i });
    await flushMicrotasks();
    await flushMicrotasks();
    expect(await store.count()).toBe(10);
  });
});

// ─── helpers ────────────────────────────────────────────────────────────────

function makeEvent(
  id: string,
  timestamp: number,
  category: AnalyticsEvent['category'],
  event: string,
): AnalyticsEvent {
  return {
    id,
    schemaVersion: ANALYTICS_SCHEMA_VERSION,
    timestamp,
    simulationTime: 0,
    category,
    event,
  };
}

/** Yield to the event loop (a macrotask) so the collector's async drain loop —
 *  which awaits `store.put` per event — can fully complete regardless of how
 *  many awaits it needs. A single `Promise.resolve()` microtask yield only
 *  advances one `await`; a `setTimeout(0)` macrotask lets the whole microtask
 *  queue drain first. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
