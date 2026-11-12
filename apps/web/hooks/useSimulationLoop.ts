'use client';

/**
 * useSimulationLoop — rAF + accumulator driving the Zustand store (P5a).
 *
 * Responsibilities:
 *   - **Boot**: on mount, try `storage.load()`. If a save exists, publish it
 *     via `useGameStore.getState().commitSimState(loaded)`. Otherwise, call
 *     `engine.initialize(initialConfig)` and publish the fresh state. Either
 *     way, set `engineStatus = 'running'` so consumers (panels, dashboard)
 *     can render against a non-null `simState`.
 *   - **Loop**: requestAnimationFrame + accumulator pattern (extracted from
 *     P0's `use-engine-game.ts`). Each frame: accumulate
 *     `realDelta * PROVISIONAL_REAL_TO_SIM_SECONDS * speedMultiplier` sim
 *     seconds; when the accumulator >= 1 second, call `engine.advance(state,
 *     accumulator)` and publish the result via `commitSimState`.
 *   - **Pause**: subscribe to `simState.clock.paused` + `speedMultiplier`.
 *     Cancel the rAF when paused (or multiplier === 0); restart when resumed.
 *     The engine itself is pause-agnostic (TDD §6.3 — the Pause contract);
 *     this hook is where the Pause contract is enforced.
 *   - **Speed**: speed multiplier scales elapsed sim time, so 5x means 5x
 *     more sim seconds per real second.
 *   - **Persistence**: expose `save()`, `load()`, `newGame(config)` so the
 *     UI can wire up Save/Load/New-Game buttons. These update both the
 *     internal state reference and the store's `simState`.
 *
 * The hook does NOT render anything — it's a side-effect hook that drives
 * the store. P5b's panels consume the store via selectors; this hook is the
 * ONLY writer of `simState` outside of UI-initiated `dispatch` calls.
 *
 * Why extract from P0's `use-engine-game.ts` (instead of reusing it)?
 *   - P0's hook held `state` in React `useState`, which re-rendered the
 *     entire page on every simulation step. P5a splits the architecture:
 *     the Zustand store holds the reactive `simState` snapshot (selective
 *     subscriptions prevent full-tree re-renders), and this hook owns the
 *     non-reactive accumulator + rAF lifecycle.
 *   - P0's hook returned `{ state, events, setSpeed, togglePause, save,
 *     load, newGame }` — coupling the consumer to the loop's internals.
 *     P5a's hook returns only `{ ready, accumulator, save, load, newGame }`;
 *     speed / pause / actions go through the store's `dispatch`.
 *
 * Boot contract:
 *   - The hook reads `storage` once on mount (in a `useMemo` / `useRef`).
 *     Changes to the `storage` prop after mount are NOT supported — the hook
 *     is designed for a stable Storage instance per page mount (typically
 *     `createBrowserStorage()` called once in the page component).
 *   - If `storage` is `null` (SSR / Node / unavailable), the hook boots from
 *     `engine.initialize(initialConfig)` directly. This is the same fallback
 *     the P0 page used.
 *
 * Determinism (TDD §18.3):
 *   - The hook adds NO randomness. All randomness flows through the engine's
 *     seeded RNG (rebuilt from `state.rngState` each step). The hook only
 *     advances the clock — it doesn't introduce `Date.now()` or
 *     `Math.random()` into the simulation. (`Date.now()` is used ONLY for
 *     `metadata.lastSavedAt` on save, which is the spec-allowed single
 *     read at game creation / save time.)
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { engine, type Storage } from '@capitalist-tree/simulation';
import type { GameConfig, GameState } from '@capitalist-tree/shared';
import { PROVISIONAL_REAL_TO_SIM_SECONDS } from '@capitalist-tree/shared';
import { useGameStore } from '../stores/game-store';
import {
  PROVISIONAL_UI_COMMIT_THROTTLE_MS,
  PROVISIONAL_UI_LOOP_FRAME_DT_MAX_MS,
} from '../lib/constants';

// ----------------------------------------------------------------------------
// Public types.
// ----------------------------------------------------------------------------

/** Return value of {@link useSimulationLoop}. */
export interface UseSimulationLoop {
  /** True once the boot effect has published a non-null `simState`. */
  readonly ready: boolean;
  /** Current accumulator remainder (sim seconds not yet consumed by a step). */
  readonly accumulator: number;
  /** Save the current state to `storage` (no-op if storage is null). */
  readonly save: () => Promise<void>;
  /** Reload the latest save from `storage` (no-op if storage is null). */
  readonly load: () => Promise<void>;
  /** Discard the current state and boot a fresh game from `config`. */
  readonly newGame: (config: GameConfig) => void;
}

// ----------------------------------------------------------------------------
// Hook implementation.
// ----------------------------------------------------------------------------

/**
 * Drive the simulation loop and publish snapshots to the Zustand store.
 *
 * @param initialConfig — GameConfig used when no save is loaded. MUST be
 *   referentially stable across renders (wrap in `useMemo` at the call site)
 *   — the hook only uses it on boot + `newGame()`, but a stable reference
 *   avoids spurious boot-effect reruns in StrictMode.
 * @param storage — Storage instance (typically `createBrowserStorage()`).
 *   Null in SSR / Node / when IndexedDB is unavailable; the hook falls back
 *   to `engine.initialize(initialConfig)` in that case.
 */
export function useSimulationLoop(
  initialConfig: GameConfig,
  storage: Storage | null,
): UseSimulationLoop {
  const [ready, setReady] = useState(false);
  const [accumulator, setAccumulator] = useState(0);

  // Refs (non-reactive; the rAF closure reads from these without subscribing).
  const accumulatorRef = useRef(0);
  const stateRef = useRef<GameState | null>(null);
  const storageRef = useRef<Storage | null>(storage);
  const initialConfigRef = useRef<GameConfig>(initialConfig);

  // Keep storageRef + initialConfigRef in sync (in case the caller swaps
  // them after mount — though the contract says they should be stable).
  useEffect(() => {
    storageRef.current = storage;
  }, [storage]);
  useEffect(() => {
    initialConfigRef.current = initialConfig;
  }, [initialConfig]);

  // Keep stateRef in sync with the store's simState. The store is the
  // authoritative holder; stateRef is a non-reactive mirror the rAF closure
  // reads from to avoid calling getState() every frame (cheaper + avoids
  // any chance of the closure seeing a half-applied update).
  useEffect(() => {
    const unsubscribe = useGameStore.subscribe((state) => {
      stateRef.current = state.simState;
    });
    // Seed stateRef with the current value (in case the loop starts before
    // the subscribe fires).
    stateRef.current = useGameStore.getState().simState;
    return unsubscribe;
  }, []);

  // --------------------------------------------------------------------------
  // Boot effect — load from IDB or initialize fresh, then publish.
  // --------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    const store = useGameStore.getState();

    async function boot(): Promise<void> {
      store.setEngineStatus('booting');
      let state: GameState | null = null;
      const s = storageRef.current;
      if (s) {
        try {
          state = await s.load();
        } catch (err) {
          // Don't crash the page — fall through to a fresh initialize.
          console.warn('useSimulationLoop: storage.load() failed, initializing fresh game:', err);
          state = null;
        }
      }
      if (cancelled) return;
      if (!state) {
        state = engine.initialize(initialConfigRef.current);
      }
      if (cancelled) return;
      stateRef.current = state;
      accumulatorRef.current = 0;
      setAccumulator(0);
      useGameStore.getState().commitSimState(state, []);
      useGameStore.getState().setEngineStatus('running');
      setReady(true);
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  // --------------------------------------------------------------------------
  // Loop effect — rAF + accumulator, paused via cancelAnimationFrame.
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (typeof requestAnimationFrame !== 'function') return;

    let raf = 0;
    let lastTs: number | null = null;
    let lastCommitMs = 0;
    const loop = (now: number): void => {
      const current = stateRef.current;
      if (!current) {
        // Boot hasn't completed yet — keep ticking so we pick up the first
        // commit. The rAF is cheap when there's no advance to run.
        raf = requestAnimationFrame(loop);
        return;
      }
      // Pause contract: the engine itself doesn't short-circuit on paused
      // (TDD §6.3); this hook enforces it. The pause-watcher below should
      // have cancelled the rAF, but this guard is defensive.
      if (current.clock.paused || current.clock.speedMultiplier <= 0) {
        lastTs = now;
        raf = requestAnimationFrame(loop);
        return;
      }
      if (lastTs != null) {
        // Clamp dt so a long tab-suspend (e.g. laptop sleep) doesn't advance
        // the simulation by an arbitrary amount.
        const realDelta = Math.min(
          PROVISIONAL_UI_LOOP_FRAME_DT_MAX_MS,
          now - lastTs,
        ) / 1000;
        const simDelta =
          realDelta * PROVISIONAL_REAL_TO_SIM_SECONDS * current.clock.speedMultiplier;
        accumulatorRef.current += simDelta;
        if (accumulatorRef.current >= 1) {
          const result = engine.advance(current, accumulatorRef.current);
          accumulatorRef.current -= result.consumedSeconds;
          stateRef.current = result.state;

          // Throttle commits if PROVISIONAL_UI_COMMIT_THROTTLE_MS > 0.
          // When 0 (default for P5a), commit every step.
          const shouldCommit =
            PROVISIONAL_UI_COMMIT_THROTTLE_MS <= 0 ||
            now - lastCommitMs >= PROVISIONAL_UI_COMMIT_THROTTLE_MS;
          if (shouldCommit) {
            useGameStore.getState().commitSimState(result.state, result.events);
            setAccumulator(accumulatorRef.current);
            lastCommitMs = now;
          } else {
            // Even when throttling the reactive commit, keep stateRef in
            // sync so the next frame sees the latest state.
          }
        }
      }
      lastTs = now;
      raf = requestAnimationFrame(loop);
    };

    const startLoop = (): void => {
      if (raf === 0) {
        lastTs = null;
        lastCommitMs = 0;
        raf = requestAnimationFrame(loop);
      }
    };
    const stopLoop = (): void => {
      if (raf !== 0) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    // Pause-watcher: subscribe to simState changes; cancel/restart the rAF
    // based on `clock.paused` + `speedMultiplier`. Use the store's subscribe
    // API (NOT useGameStore as a hook — this is a non-React context).
    let lastPaused = true;
    const updatePause = (): void => {
      const s = useGameStore.getState().simState;
      const isPaused = !s || s.clock.paused || s.clock.speedMultiplier <= 0;
      if (isPaused !== lastPaused) {
        lastPaused = isPaused;
        if (isPaused) stopLoop();
        else startLoop();
      }
    };
    // Seed the initial pause state — start the loop if not paused.
    updatePause();
    const unsubscribe = useGameStore.subscribe(updatePause);

    return () => {
      stopLoop();
      unsubscribe();
    };
  }, []);

  // --------------------------------------------------------------------------
  // save / load / newGame — exposed for the page's Save/Load/New-Game buttons.
  // --------------------------------------------------------------------------

  const save = useCallback(async () => {
    const s = storageRef.current;
    const current = stateRef.current;
    if (!s || !current) return;
    // Stamp the save with the current wall-clock time (the spec-allowed
    // single Date.now() read at save time — see docs/simulation.md §14.4).
    const stamped: GameState = {
      ...current,
      metadata: {
        ...current.metadata,
        lastSavedAt: Date.now(),
        lastSimulatedAt: Date.now(),
      },
    };
    stateRef.current = stamped;
    useGameStore.getState().commitSimState(stamped, []);
    await s.save(stamped);
  }, []);

  const load = useCallback(async () => {
    const s = storageRef.current;
    if (!s) return;
    const loaded = await s.load();
    if (!loaded) return;
    stateRef.current = loaded;
    accumulatorRef.current = 0;
    setAccumulator(0);
    useGameStore.getState().commitSimState(loaded, []);
  }, []);

  const newGame = useCallback((config: GameConfig) => {
    const fresh = engine.initialize(config);
    stateRef.current = fresh;
    accumulatorRef.current = 0;
    setAccumulator(0);
    useGameStore.getState().commitSimState(fresh, []);
  }, []);

  return {
    ready,
    accumulator,
    save,
    load,
    newGame,
  };
}
