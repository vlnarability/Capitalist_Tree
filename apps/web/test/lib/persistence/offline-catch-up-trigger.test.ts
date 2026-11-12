/**
 * Tests for the catch-up-on-load trigger (P6d2 — TDD §14.4, GDD §4.2).
 *
 * Covers `catchUpOnLoad` (pure core) + `applyCatchUpOnLoad` (notification
 * routing wrapper) in `apps/web/lib/persistence/offline-catch-up-trigger.ts`:
 *
 *   - A stale save (elapsed > PROVISIONAL_OFFLINE_PROMPT_THRESHOLD_MS) triggers
 *     `runOfflineCatchUp`: the returned state's `metadata.lastSimulatedAt` is
 *     advanced to `nowMs`, and the summary is returned with `chunksRun > 0`.
 *   - A fresh save (elapsed ≤ threshold) does NOT trigger catch-up: the input
 *     state is returned unchanged with `summary: null`.
 *   - A backwards clock beyond the tolerance throws `OfflineClockTamperedError`
 *     from `catchUpOnLoad`.
 *   - `applyCatchUpOnLoad` routes the tampered-clock error to the notification
 *     bridge (`pushNotification`) and returns the original state unchanged
 *     with `summary: null`.
 *
 * Environment: node (default). The trigger is a pure function — no DOM, no
 * rAF. The catch-up runs `engine.advance` per 1-sim-day chunk; tests use a
 * small stale interval (25 real minutes → 1 chunk) so each catch-up is fast.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { engine, DEFAULT_GAME_CONFIG } from '@capitalist-tree/simulation';
import type { GameState } from '@capitalist-tree/shared';
import { OfflineClockTamperedError } from '@capitalist-tree/shared';
import {
  __resetGameStoreForTests,
} from '../../../stores/game-store';
import {
  catchUpOnLoad,
  applyCatchUpOnLoad,
  type CatchUpOnLoadStore,
} from '../../../lib/persistence/offline-catch-up-trigger';
import { PROVISIONAL_OFFLINE_PROMPT_THRESHOLD_MS } from '../../../lib/constants';

// ----------------------------------------------------------------------------
// Helpers.
// ----------------------------------------------------------------------------

function freshState(): GameState {
  return engine.initialize({ ...DEFAULT_GAME_CONFIG, createdAt: 1_700_000_000_000 });
}

/** A state whose `lastSimulatedAt` is `staleMs` in the past relative to `nowMs`. */
function staleState(nowMs: number, staleMs: number): GameState {
  const s = freshState();
  return { ...s, metadata: { ...s.metadata, lastSimulatedAt: nowMs - staleMs } };
}

/** A minimal stub store for `applyCatchUpOnLoad` — records pushNotification calls. */
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

describe('catchUpOnLoad (P6d2) — pure core', () => {
  beforeEach(() => __resetGameStoreForTests());

  it('does NOT trigger catch-up for a fresh save (elapsed ≤ threshold)', () => {
    const nowMs = 1_700_000_000_000;
    // 1 real second ago — well under the 60s threshold.
    const state = staleState(nowMs, 1_000);
    const result = catchUpOnLoad(state, nowMs);
    // Input state returned unchanged (same reference).
    expect(result.state).toBe(state);
    // No summary, no events.
    expect(result.summary).toBeNull();
    expect(result.events).toEqual([]);
    // lastSimulatedAt is NOT advanced for a fresh save.
    expect(result.state.metadata.lastSimulatedAt).toBe(nowMs - 1_000);
  });

  it('does NOT trigger catch-up when elapsed === threshold exactly (boundary)', () => {
    const nowMs = 1_700_000_000_000;
    const state = staleState(nowMs, PROVISIONAL_OFFLINE_PROMPT_THRESHOLD_MS);
    const result = catchUpOnLoad(state, nowMs);
    expect(result.state).toBe(state);
    expect(result.summary).toBeNull();
  });

  it('triggers runOfflineCatchUp for a stale save and advances lastSimulatedAt to nowMs', () => {
    const nowMs = 1_700_000_000_000;
    // 25 real minutes ago → 1500 real sec × 60 = 90_000 sim sec → 1 chunk.
    const staleMs = 25 * 60 * 1000;
    const state = staleState(nowMs, staleMs);
    const result = catchUpOnLoad(state, nowMs);
    // A fresh state reference was produced (catch-up ran).
    expect(result.state).not.toBe(state);
    // The save marker is advanced to nowMs (P6a step 10).
    expect(result.state.metadata.lastSimulatedAt).toBe(nowMs);
    // A non-null summary with chunksRun > 0 was returned → modal should show.
    expect(result.summary).not.toBeNull();
    expect(result.summary!.chunksRun).toBeGreaterThan(0);
    // The summary's bounds reflect the catch-up.
    expect(result.summary!.fromSimSeconds).toBe(state.clock.elapsedSeconds);
    expect(result.summary!.toSimSeconds).toBe(result.state.clock.elapsedSeconds);
  });

  it('throws OfflineClockTamperedError on a backwards clock beyond tolerance', () => {
    const nowMs = 1_700_000_000_000;
    // lastSimulatedAt is 1_000_000 ms AHEAD of nowMs → backwards by 1_000_000 ms
    // (well beyond the 1_000 ms tolerance).
    const s = freshState();
    const state: GameState = {
      ...s,
      metadata: { ...s.metadata, lastSimulatedAt: nowMs + 1_000_000 },
    };
    expect(() => catchUpOnLoad(state, nowMs)).toThrow(OfflineClockTamperedError);
  });
});

describe('applyCatchUpOnLoad (P6d2) — notification routing', () => {
  beforeEach(() => __resetGameStoreForTests());

  it('returns the catch-up result verbatim on a successful stale-save catch-up', () => {
    const nowMs = 1_700_000_000_000;
    const state = staleState(nowMs, 25 * 60 * 1000);
    const store = stubStore(state);
    const result = applyCatchUpOnLoad(state, nowMs, store);
    expect(result.state).not.toBe(state);
    expect(result.summary).not.toBeNull();
    expect(result.summary!.chunksRun).toBeGreaterThan(0);
    // No notification was pushed on the success path.
    expect(store.notifications).toHaveLength(0);
  });

  it('routes OfflineClockTamperedError to the notification bridge and returns the original state', () => {
    const nowMs = 1_700_000_000_000;
    const s = freshState();
    const state: GameState = {
      ...s,
      metadata: { ...s.metadata, lastSimulatedAt: nowMs + 1_000_000 },
    };
    const store = stubStore(state);
    const result = applyCatchUpOnLoad(state, nowMs, store);
    // The original state is returned unchanged (save is intact).
    expect(result.state).toBe(state);
    expect(result.summary).toBeNull();
    expect(result.events).toEqual([]);
    // A single notification was pushed with the clock-tamper code.
    expect(store.notifications).toHaveLength(1);
    const notif = store.notifications[0] as Record<string, unknown>;
    expect(notif['code']).toBe('offline-clock-tampered');
    expect(notif['severity']).toBe('critical');
    expect(String(notif['message'])).toMatch(/clock moved backwards/i);
  });

  it('does NOT push a notification on a fresh save', () => {
    const nowMs = 1_700_000_000_000;
    const state = staleState(nowMs, 1_000);
    const store = stubStore(state);
    const result = applyCatchUpOnLoad(state, nowMs, store);
    expect(result.summary).toBeNull();
    expect(store.notifications).toHaveLength(0);
  });
});
