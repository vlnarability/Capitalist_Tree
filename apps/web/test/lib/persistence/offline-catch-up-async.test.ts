/**
 * Tests for the async offline catch-up wrapper (P11 W11 + W34).
 *
 * `apps/web/lib/persistence/offline-catch-up-async.ts` runs the catch-up in a
 * Web Worker when available, falling back to a main-thread chunked path when
 * it isn't (SSR, test env, worker-URL failure). In vitest (Node) `Worker` +
 * `window` are both undefined, so `catchUpOnLoadAsync` takes the FALLBACK path
 * — which is exactly what W34 hardens.
 *
 * W34 key assertion: the fallback yields to the event loop between chunks
 * (`setTimeout(0)`), so a 30-real-day absence can no longer freeze the main
 * thread. A concurrent `setTimeout(0)` scheduled before the catch-up fires
 * DURING the catch-up (between chunks). A purely synchronous fallback would
 * block the event loop for the full duration + the setTimeout would not have
 * fired yet when the await resumes (microtasks drain before macrotasks).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { engine, DEFAULT_GAME_CONFIG } from '@capitalist-tree/simulation';
import type { GameState } from '@capitalist-tree/shared';
import { __resetGameStoreForTests } from '../../../stores/game-store';
import {
  catchUpOnLoadAsync,
  applyCatchUpOnLoadAsync,
  type CatchUpProgressFn,
} from '../../../lib/persistence/offline-catch-up-async';
import { catchUpOnLoad, type CatchUpOnLoadStore } from '../../../lib/persistence/offline-catch-up-trigger';
import { PROVISIONAL_OFFLINE_PROMPT_THRESHOLD_MS } from '../../../lib/constants';

// ----------------------------------------------------------------------------
// Helpers (mirror offline-catch-up-trigger.test.ts).
// ----------------------------------------------------------------------------

function freshState(): GameState {
  return engine.initialize({ ...DEFAULT_GAME_CONFIG, createdAt: 1_700_000_000_000 });
}

/** A state whose `lastSimulatedAt` is `staleMs` in the past relative to `nowMs`. */
function staleState(nowMs: number, staleMs: number): GameState {
  const s = freshState();
  return { ...s, metadata: { ...s.metadata, lastSimulatedAt: nowMs - staleMs } };
}

type NotificationPayload = Parameters<CatchUpOnLoadStore['pushNotification']>[0];
interface RecordingStore extends CatchUpOnLoadStore {
  readonly notifications: readonly NotificationPayload[];
}
function stubStore(simState: GameState | null = null): RecordingStore {
  const notifications: NotificationPayload[] = [];
  const store: RecordingStore = {
    simState,
    pushNotification: (n: NotificationPayload) => {
      notifications.push(n);
    },
    get notifications() {
      return notifications;
    },
  };
  return store;
}

// ----------------------------------------------------------------------------
// Tests.
// ----------------------------------------------------------------------------

describe('catchUpOnLoadAsync — fallback path (W34: chunked + yields)', () => {
  beforeEach(() => __resetGameStoreForTests());

  it('produces the same result as the synchronous catchUpOnLoad (correctness)', async () => {
    const nowMs = 1_700_000_000_000;
    const staleMs = 25 * 60 * 1000; // 25 real min → 1 chunk
    const state = staleState(nowMs, staleMs);

    const sync = catchUpOnLoad(state, nowMs);
    const asyncResult = await catchUpOnLoadAsync(state, nowMs);

    // Same advanced save marker (both advanced to nowMs).
    expect(asyncResult.state.metadata.lastSimulatedAt).toBe(sync.state.metadata.lastSimulatedAt);
    expect(asyncResult.state.metadata.lastSimulatedAt).toBe(nowMs);
    // Same chunk count.
    expect(asyncResult.summary).not.toBeNull();
    expect(sync.summary).not.toBeNull();
    expect(asyncResult.summary!.chunksRun).toBe(sync.summary!.chunksRun);
    expect(asyncResult.summary!.chunksRun).toBeGreaterThan(0);
    // Same event count (bookend events + chunk events).
    expect(asyncResult.events.length).toBe(sync.events.length);
  });

  it('yields to the event loop between chunks (a concurrent setTimeout fires mid-catch-up)', async () => {
    const nowMs = 1_700_000_000_000;
    // 100 real min → ~4 chunks → ≥3 yield points between chunks.
    const staleMs = 100 * 60 * 1000;
    const state = staleState(nowMs, staleMs);

    let concurrentFired = false;
    setTimeout(() => {
      concurrentFired = true;
    }, 0);

    await catchUpOnLoadAsync(state, nowMs);

    // The concurrent setTimeout should have fired DURING the chunked catch-up
    // (the fallback yields between chunks via setTimeout(0)). A purely
    // synchronous fallback would block the event loop for the full duration +
    // the setTimeout would not have fired yet when the await resumes
    // (microtasks drain before macrotasks).
    expect(concurrentFired).toBe(true);
  });

  it('reports progress (0, total) → … → (total, total) with monotonic completed', async () => {
    const nowMs = 1_700_000_000_000;
    const staleMs = 50 * 60 * 1000; // 50 real min → 2 chunks
    const state = staleState(nowMs, staleMs);

    const ticks: Array<[number, number]> = [];
    const onProgress: CatchUpProgressFn = (completed, total) => ticks.push([completed, total]);

    await catchUpOnLoadAsync(state, nowMs, onProgress);

    const total = ticks[0]?.[1] ?? 0;
    expect(total).toBeGreaterThan(0);
    // First tick is (0, total) — reported before the first chunk.
    expect(ticks[0]).toEqual([0, total]);
    // Last tick is (total, total) — 100%.
    expect(ticks[ticks.length - 1]).toEqual([total, total]);
    // Monotonic non-decreasing completed count.
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]![0]).toBeGreaterThanOrEqual(ticks[i - 1]![0]);
    }
  });

  it('fresh save → no catch-up (summary null, state ref unchanged)', async () => {
    const nowMs = 1_700_000_000_000;
    const state = staleState(nowMs, 1_000); // 1s ago — fresh
    const result = await catchUpOnLoadAsync(state, nowMs);
    expect(result.summary).toBeNull();
    expect(result.events).toEqual([]);
    // Fresh save returns the input state reference (no processor call).
    expect(result.state).toBe(state);
  });

  it('does NOT trigger catch-up when elapsed === threshold exactly (boundary)', async () => {
    const nowMs = 1_700_000_000_000;
    const state = staleState(nowMs, PROVISIONAL_OFFLINE_PROMPT_THRESHOLD_MS);
    const result = await catchUpOnLoadAsync(state, nowMs);
    expect(result.summary).toBeNull();
    expect(result.state).toBe(state);
  });
});

describe('applyCatchUpOnLoadAsync — notification routing (async)', () => {
  beforeEach(() => __resetGameStoreForTests());

  it('routes OfflineClockTamperedError to the notification bridge + returns the original state', async () => {
    const nowMs = 1_700_000_000_000;
    const s = freshState();
    const state: GameState = {
      ...s,
      metadata: { ...s.metadata, lastSimulatedAt: nowMs + 1_000_000 }, // 1_000_000 ms ahead → backwards
    };
    const store = stubStore(state);
    const result = await applyCatchUpOnLoadAsync(state, nowMs, store);
    // Original state returned unchanged (save intact).
    expect(result.state).toBe(state);
    expect(result.summary).toBeNull();
    expect(result.events).toEqual([]);
    // A single clock-tamper notification was pushed.
    expect(store.notifications).toHaveLength(1);
    const notif = store.notifications[0] as Record<string, unknown>;
    expect(notif['code']).toBe('offline-clock-tampered');
    expect(notif['severity']).toBe('critical');
  });

  it('returns the catch-up result verbatim on a successful stale-save catch-up', async () => {
    const nowMs = 1_700_000_000_000;
    const state = staleState(nowMs, 25 * 60 * 1000); // 1 chunk
    const store = stubStore(state);
    const result = await applyCatchUpOnLoadAsync(state, nowMs, store);
    expect(result.state).not.toBe(state);
    expect(result.summary).not.toBeNull();
    expect(result.summary!.chunksRun).toBeGreaterThan(0);
    // No notification on the success path.
    expect(store.notifications).toHaveLength(0);
  });
});
