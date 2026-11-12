/**
 * useSimulationLoop hook tests (P5a — TDD §16 + TDD §6.3 Pause contract).
 *
 * Tests:
 *   - The hook boots from a non-empty Storage (publishes the loaded state).
 *   - The hook boots from `engine.initialize` when storage is empty / null.
 *   - The rAF loop advances the simulation when not paused (clock advances).
 *   - `pause()` (dispatching `set-speed=0`) cancels the rAF.
 *   - `resume()` (dispatching `set-speed=N`) restarts the rAF.
 *   - `save()` round-trips through `storage.save` + `storage.load`.
 *   - `newGame()` discards the current state and boots fresh.
 *
 * Environment: happy-dom. The hook uses `requestAnimationFrame` +
 * `cancelAnimationFrame` + `Date.now` + `performance.now` — happy-dom
 * provides a DOM-shaped global, but we override rAF with a manual controller
 * so the tests are deterministic (don't depend on real wall-clock timing).
 *
 * Why manual rAF mocking (not `vi.useFakeTimers`)? Zustand's `subscribe`
 * fires synchronously, but the hook's boot is async (`storage.load()`). Fake
 * timers don't help here — we need to control the rAF callback list
 * explicitly so we can fire exactly one frame at a known timestamp and
 * assert the resulting simState.
 *
 * Why use 60x speed + small dt? The loop's `PROVISIONAL_UI_LOOP_FRAME_DT_MAX_MS`
 * cap (250ms) limits per-frame sim-second accumulation. At 1x speed, a
 * single 250ms frame contributes only 15 sim seconds (250/1000 * 60) —
 * sub-step, so the accumulator carries it forward but the state doesn't
 * advance. To trigger a real advance in a single frame, we use 60x speed
 * (a single 100ms frame yields 360 sim seconds = 6 steps). This is the
 * realistic high-speed scenario the UI is designed for.
 */
// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup, waitFor } from '@testing-library/react';
import { engine, InMemoryStorage, DEFAULT_GAME_CONFIG } from '@capitalist-tree/simulation';
import type { Storage } from '@capitalist-tree/simulation';
import type { GameConfig } from '@capitalist-tree/shared';
import { useSimulationLoop } from '../../hooks/useSimulationLoop';
import { useGameStore, __resetGameStoreForTests } from '../../stores/game-store';
import { pause, resume, setSpeed } from '../../lib/actions';

// ----------------------------------------------------------------------------
// Manual rAF controller — deterministic frame scheduling.
// ----------------------------------------------------------------------------

interface RafEntry {
  readonly id: number;
  readonly cb: (now: number) => void;
  cancelled: boolean;
}

let rafCounter = 0;
const rafQueue: RafEntry[] = [];

function installRafMocks(): void {
  rafCounter = 0;
  rafQueue.length = 0;

  vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void): number => {
    rafCounter += 1;
    const entry: RafEntry = { id: rafCounter, cb, cancelled: false };
    rafQueue.push(entry);
    return entry.id;
  });

  vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
    // Mark matching entries as cancelled. Pending entries in the queue get
    // skipped on the next flush; already-fired entries are no-ops.
    for (const entry of rafQueue) {
      if (entry.id === id) {
        entry.cancelled = true;
        return;
      }
    }
  });
}

function uninstallRafMocks(): void {
  vi.unstubAllGlobals();
}

/**
 * Fire all queued rAF callbacks with the given wall-clock timestamp (ms).
 *
 * After firing, the queue is cleared. Callbacks scheduled DURING the flush
 * (i.e. by a callback calling `requestAnimationFrame` again) are queued for
 * the NEXT `flushRaf` call — matching real rAF semantics where re-entrant
 * scheduling waits for the next frame. Cancelled entries are skipped.
 *
 * Returns the count of callbacks actually fired (useful for assertions).
 */
function flushRaf(nowMs: number): number {
  const current = rafQueue.splice(0, rafQueue.length);
  let fired = 0;
  for (const entry of current) {
    if (entry.cancelled) continue;
    entry.cb(nowMs);
    fired += 1;
  }
  return fired;
}

/** Count of currently-pending (non-cancelled) rAF callbacks. */
function pendingRafCount(): number {
  return rafQueue.filter((e) => !e.cancelled).length;
}

/**
 * Fire a sequence of frames at the given timestamps (ms). Each timestamp
 * fires one frame; the loop reschedules itself between fires. Useful for
 * simulating a sequence of small dt intervals (so the per-frame dt stays
 * below PROVISIONAL_UI_LOOP_FRAME_DT_MAX_MS).
 */
function flushRafSequence(timestamps: readonly number[]): number {
  let total = 0;
  for (const t of timestamps) {
    total += flushRaf(t);
  }
  return total;
}

// ----------------------------------------------------------------------------
// Helpers.
// ----------------------------------------------------------------------------

function freshConfig(): GameConfig {
  return { ...DEFAULT_GAME_CONFIG, createdAt: 1_700_000_000_000 };
}

/**
 * Wait for the hook's `ready` flag to flip true. The boot is async (storage
 * load), so we use `waitFor` which polls + flushes both microtasks and
 * macrotasks. `waitFor` is wrapped in `act` automatically by RTL.
 */
async function waitForReady(): Promise<void> {
  await waitFor(
    () => {
      expect(useGameStore.getState().engineStatus).toBe('running');
      expect(useGameStore.getState().simState).not.toBeNull();
    },
    { timeout: 1500, interval: 5 },
  );
  // Give React one more flush to propagate `setReady(true)` into the hook's
  // returned value.
  await act(async () => {
    await Promise.resolve();
  });
}

// ----------------------------------------------------------------------------
// Tests.
// ----------------------------------------------------------------------------

describe('useSimulationLoop (P5a) — boot', () => {
  beforeEach(() => {
    __resetGameStoreForTests();
    installRafMocks();
  });
  afterEach(() => {
    cleanup();
    uninstallRafMocks();
  });

  it('boots from engine.initialize when storage is null', async () => {
    const config = freshConfig();
    const { result } = renderHook(() => useSimulationLoop(config, null));
    await waitForReady();
    expect(result.current.ready).toBe(true);
    const simState = useGameStore.getState().simState;
    expect(simState).not.toBeNull();
    expect(simState?.metadata.saveId).toBe(config.saveId);
    expect(useGameStore.getState().engineStatus).toBe('running');
  });

  it('boots from the loaded save when storage has one', async () => {
    const storage = new InMemoryStorage();
    // Pre-save a state with a non-default saveId so we can distinguish it.
    const preSaved = engine.initialize({ ...freshConfig(), saveId: 'pre-saved' });
    await storage.save(preSaved);

    const config = freshConfig();
    const { result } = renderHook(() => useSimulationLoop(config, storage));
    await waitForReady();
    expect(result.current.ready).toBe(true);
    const simState = useGameStore.getState().simState;
    expect(simState?.metadata.saveId).toBe('pre-saved');
  });

  it('boots from engine.initialize when storage.load() returns null', async () => {
    const storage = new InMemoryStorage(); // empty
    const config = freshConfig();
    const { result } = renderHook(() => useSimulationLoop(config, storage));
    await waitForReady();
    expect(result.current.ready).toBe(true);
    const simState = useGameStore.getState().simState;
    expect(simState?.metadata.saveId).toBe(config.saveId);
  });

  it('recovers from a storage.load() rejection by initializing fresh', async () => {
    // Build a Storage whose `load` always rejects. We construct it via the
    // `Storage` interface (not `InMemoryStorage` class) so the spread doesn't
    // need to copy private fields — only the four public methods matter.
    const base = new InMemoryStorage();
    const failingStorage: Storage = {
      save: (state) => base.save(state),
      load: async () => {
        throw new Error('simulated IDB failure');
      },
      listSaves: () => base.listSaves(),
      deleteSave: (id) => base.deleteSave(id),
      validate: (raw) => base.validate(raw),
    };
    const config = freshConfig();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { result } = renderHook(() => useSimulationLoop(config, failingStorage));
      await waitForReady();
      expect(result.current.ready).toBe(true);
      expect(useGameStore.getState().simState?.metadata.saveId).toBe(config.saveId);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('useSimulationLoop (P5a) — rAF loop advances the simulation', () => {
  beforeEach(() => {
    __resetGameStoreForTests();
    installRafMocks();
  });
  afterEach(() => {
    cleanup();
    uninstallRafMocks();
  });

  it('advances clock.elapsedSeconds after rAF frames at 60x speed', async () => {
    const config = freshConfig();
    const { result } = renderHook(() => useSimulationLoop(config, null));
    await waitForReady();

    // Bump to 60x so a single small-dt frame advances multiple steps.
    // At 60x with dt=100ms (below the 250ms cap):
    //   realDelta = 0.1 sec, simDelta = 0.1 * 60 * 60 = 360 sim sec = 6 steps.
    await act(async () => {
      useGameStore.getState().dispatch(setSpeed(60));
    });

    const startElapsed = useGameStore.getState().simState?.clock.elapsedSeconds ?? 0;
    expect(startElapsed).toBe(0); // sanity: fresh state

    // Prime the loop's `lastTs` (first rAF tick just establishes the
    // baseline; no advance because lastTs is null).
    await act(async () => {
      flushRaf(0);
    });
    expect(pendingRafCount()).toBe(1); // loop rescheduled itself

    // Fire one frame at t=100ms — should advance the simulation.
    await act(async () => {
      flushRaf(100);
    });

    const elapsed1 = useGameStore.getState().simState?.clock.elapsedSeconds ?? 0;
    expect(elapsed1).toBeGreaterThanOrEqual(60); // at least one step

    // Fire another frame at t=200ms — another advance.
    await act(async () => {
      flushRaf(200);
    });
    const elapsed2 = useGameStore.getState().simState?.clock.elapsedSeconds ?? 0;
    expect(elapsed2).toBeGreaterThan(elapsed1);

    void result;
  });

  it('advances via multiple small frames at 1x speed (accumulator pattern)', async () => {
    const config = freshConfig();
    renderHook(() => useSimulationLoop(config, null));
    await waitForReady();

    // Stay at 1x. Each frame's dt stays below the 250ms cap, so the
    // accumulator carries sub-step remainders forward until they sum to a
    // whole step. This proves the accumulator pattern (P0 contract).
    //
    // 1 real second = 60 sim seconds = 1 step. We fire 10 frames at 100ms
    // intervals = 1 real second total = 60 sim seconds = 1 step.
    await act(async () => {
      // Prime.
      flushRaf(0);
      // 10 frames × 100ms = 1 real second.
      for (let i = 1; i <= 10; i++) {
        flushRaf(i * 100);
      }
    });

    const elapsed = useGameStore.getState().simState?.clock.elapsedSeconds ?? 0;
    expect(elapsed).toBeGreaterThanOrEqual(60); // at least one step
  });

  it('does NOT advance while paused (set-speed=0 cancels rAF)', async () => {
    const config = freshConfig();
    renderHook(() => useSimulationLoop(config, null));
    await waitForReady();

    // Pause via the store's dispatch path (this is how P5b panels will do it).
    await act(async () => {
      useGameStore.getState().dispatch(pause());
    });

    // After pausing, the rAF should have been cancelled — pendingRafCount
    // should be 0 (no scheduled frames).
    expect(pendingRafCount()).toBe(0);
    expect(useGameStore.getState().simState?.clock.speedMultiplier).toBe(0);

    const elapsedBefore = useGameStore.getState().simState?.clock.elapsedSeconds ?? 0;

    // Fire frames anyway — should be no-ops because the rAF was cancelled
    // (no callbacks in the queue).
    const fired = flushRafSequence([1000, 2000, 3000, 4000, 5000]);
    expect(fired).toBe(0);

    const elapsedAfter = useGameStore.getState().simState?.clock.elapsedSeconds ?? 0;
    expect(elapsedAfter).toBe(elapsedBefore); // unchanged
  });

  it('resumes the rAF when clock.speedMultiplier becomes non-zero', async () => {
    const config = freshConfig();
    renderHook(() => useSimulationLoop(config, null));
    await waitForReady();

    // Pause.
    await act(async () => {
      useGameStore.getState().dispatch(pause());
    });
    expect(pendingRafCount()).toBe(0);

    // Resume at 60x — the pause-watcher should restart the rAF.
    await act(async () => {
      useGameStore.getState().dispatch(resume(60));
    });
    expect(useGameStore.getState().simState?.clock.speedMultiplier).toBe(60);
    expect(pendingRafCount()).toBe(1); // rAF rescheduled

    // Prime + advance — the clock should advance now.
    const elapsedBefore = useGameStore.getState().simState?.clock.elapsedSeconds ?? 0;
    await act(async () => {
      flushRaf(0); // prime
    });
    await act(async () => {
      flushRaf(100); // 100ms later at 60x → 360 sim sec = 6 steps
    });
    const elapsedAfter = useGameStore.getState().simState?.clock.elapsedSeconds ?? 0;
    expect(elapsedAfter).toBeGreaterThan(elapsedBefore);
  });

  it('cancelAnimationFrame is called at least once during unmount', async () => {
    const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame');
    const config = freshConfig();
    const { unmount } = renderHook(() => useSimulationLoop(config, null));
    await waitForReady();

    // The loop has scheduled at least one rAF by now (post-boot).
    expect(pendingRafCount()).toBeGreaterThan(0);

    unmount();
    // cancelAnimationFrame is called at least once during teardown (the
    // stopLoop helper inside the loop-effect cleanup).
    expect(cancelSpy.mock.calls.length).toBeGreaterThan(0);
    cancelSpy.mockRestore();
  });
});

describe('useSimulationLoop (P5a) — save / load / newGame', () => {
  beforeEach(() => {
    __resetGameStoreForTests();
    installRafMocks();
  });
  afterEach(() => {
    cleanup();
    uninstallRafMocks();
  });

  it('save() persists to storage; load() restores from storage', async () => {
    const storage = new InMemoryStorage();
    const config = freshConfig();
    const { result } = renderHook(() => useSimulationLoop(config, storage));
    await waitForReady();

    // Bump to 60x for faster advance, then prime + advance.
    await act(async () => {
      useGameStore.getState().dispatch(setSpeed(60));
    });
    await act(async () => {
      flushRaf(0); // prime
    });
    await act(async () => {
      flushRaf(100); // advance
    });
    const beforeSave = useGameStore.getState().simState?.clock.elapsedSeconds ?? 0;
    expect(beforeSave).toBeGreaterThan(0);

    // Save.
    await act(async () => {
      await result.current.save();
    });
    // save() stamps lastSavedAt — the simState reference changes but the
    // clock's elapsedSeconds is preserved.
    expect(useGameStore.getState().simState?.clock.elapsedSeconds).toBe(beforeSave);

    // Pause to stop the loop so it doesn't advance further during the load.
    await act(async () => {
      useGameStore.getState().dispatch(pause());
    });

    // load() restores the saved state — elapsedSeconds matches.
    await act(async () => {
      await result.current.load();
    });
    expect(useGameStore.getState().simState?.clock.elapsedSeconds).toBe(beforeSave);
  });

  it('newGame() discards the current state and boots fresh', async () => {
    const config = freshConfig();
    const { result } = renderHook(() => useSimulationLoop(config, null));
    await waitForReady();

    // Bump to 60x + advance.
    await act(async () => {
      useGameStore.getState().dispatch(setSpeed(60));
    });
    await act(async () => {
      flushRaf(0);
    });
    await act(async () => {
      flushRaf(100);
    });
    const beforeNewGame = useGameStore.getState().simState?.clock.elapsedSeconds ?? 0;
    expect(beforeNewGame).toBeGreaterThan(0);

    // newGame with a different saveId so we can verify it really restarted.
    await act(async () => {
      result.current.newGame({ ...freshConfig(), saveId: 'fresh-save' });
    });
    expect(useGameStore.getState().simState?.metadata.saveId).toBe('fresh-save');
    expect(useGameStore.getState().simState?.clock.elapsedSeconds).toBe(0);
    expect(result.current.accumulator).toBe(0);
  });
});
