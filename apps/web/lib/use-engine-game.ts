'use client';

/**
 * useEngineGame — the consumer-side accumulator (TDD §6.3).
 *
 * Responsibilities:
 *   - Hold the current GameState in React state.
 *   - Run a `requestAnimationFrame` loop that:
 *       accumulator += realDelta * REAL_TO_SIM_SECONDS * speed
 *       advance(state, accumulator) -> new state + events
 *       accumulator -= consumedSeconds
 *   - Pause stops the accumulator from accumulating sim seconds, but the
 *     loop keeps running so the page stays mounted and responsive.
 *   - Keep a bounded event log (last N events) for the UI.
 *
 * The engine itself (`@capitalist-tree/simulation`) is pure and pause-agnostic;
 * this hook is where the Pause contract is enforced (see docs/simulation.md).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { engine, InMemoryStorage, type Storage } from '@capitalist-tree/simulation';
import {
  type GameConfig,
  type GameState,
  type SimulationEvent,
  PROVISIONAL_REAL_TO_SIM_SECONDS,
} from '@capitalist-tree/shared';

const MAX_LOG = 50;

export interface UseEngineGame {
  state: GameState | null;
  events: readonly SimulationEvent[];
  accumulator: number;
  setSpeed: (multiplier: number) => void;
  togglePause: () => void;
  save: () => Promise<void>;
  load: () => Promise<void>;
  newGame: (config: GameConfig) => void;
}

export function useEngineGame(
  initialConfig: GameConfig,
  storage: Storage | null,
): UseEngineGame {
  const [state, setState] = useState<GameState>(() => engine.initialize(initialConfig));
  const [events, setEvents] = useState<SimulationEvent[]>([]);
  const stateRef = useRef<GameState>(state);
  const accumulatorRef = useRef(0);
  const lastTimestampRef = useRef<number | null>(null);
  const storageRef = useRef<Storage | null>(storage);

  // Keep stateRef in sync for the RAF loop.
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const appendEvents = useCallback((evs: readonly SimulationEvent[]) => {
    if (evs.length === 0) return;
    setEvents((prev) => {
      const next = [...prev, ...evs];
      return next.slice(-MAX_LOG);
    });
  }, []);

  // RAF loop — runs continuously; pause just zeroes the speed multiplier.
  useEffect(() => {
    let raf = 0;
    const loop = (now: number) => {
      const last = lastTimestampRef.current;
      lastTimestampRef.current = now;
      if (last != null) {
        const realDelta = (now - last) / 1000; // seconds
        const current = stateRef.current;
        if (!current.clock.paused && current.clock.speedMultiplier > 0) {
          const simDelta =
            realDelta * PROVISIONAL_REAL_TO_SIM_SECONDS * current.clock.speedMultiplier;
          accumulatorRef.current += simDelta;
          if (accumulatorRef.current >= 1) {
            const result = engine.advance(stateRef.current, accumulatorRef.current);
            accumulatorRef.current -= result.consumedSeconds;
            stateRef.current = result.state;
            setState(result.state);
            appendEvents(result.events);
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [appendEvents]);

  // Storage helpers
  const setStorage = useCallback((s: Storage | null) => {
    storageRef.current = s;
  }, []);

  useEffect(() => {
    setStorage(storage);
  }, [storage, setStorage]);

  const setSpeed = useCallback((multiplier: number) => {
    const current = stateRef.current;
    const result = engine.executeAction(current, {
      type: 'set-speed',
      payload: { multiplier },
    });
    stateRef.current = result.state;
    setState(result.state);
    appendEvents(result.events);
  }, [appendEvents]);

  const togglePause = useCallback(() => {
    const current = stateRef.current;
    const next = { ...current, clock: { ...current.clock, paused: !current.clock.paused } };
    stateRef.current = next;
    setState(next);
  }, []);

  const save = useCallback(async () => {
    const s = storageRef.current;
    if (!s) return;
    const current = stateRef.current;
    const stamped: GameState = {
      ...current,
      metadata: {
        ...current.metadata,
        lastSavedAt: Date.now(),
        lastSimulatedAt: Date.now(),
      },
    };
    stateRef.current = stamped;
    setState(stamped);
    await s.save(stamped);
    appendEvents([
      {
        type: 'notification',
        at: stamped.clock.elapsedSeconds,
        payload: {
          severity: 'info',
          message: 'Game saved.',
          code: 'save.ok',
        },
      },
    ]);
  }, [appendEvents]);

  const load = useCallback(async () => {
    const s = storageRef.current;
    if (!s) return;
    const loaded = await s.load();
    if (!loaded) {
      appendEvents([
        {
          type: 'notification',
          at: stateRef.current.clock.elapsedSeconds,
          payload: {
            severity: 'warning',
            message: 'No save found.',
            code: 'load.empty',
          },
        },
      ]);
      return;
    }
    stateRef.current = loaded;
    setState(loaded);
    accumulatorRef.current = 0;
    lastTimestampRef.current = null;
    appendEvents([
      {
        type: 'notification',
        at: loaded.clock.elapsedSeconds,
        payload: {
          severity: 'info',
          message: 'Game loaded.',
          code: 'load.ok',
        },
      },
    ]);
  }, [appendEvents]);

  const newGame = useCallback((config: GameConfig) => {
    const fresh = engine.initialize(config);
    stateRef.current = fresh;
    setState(fresh);
    setEvents([]);
    accumulatorRef.current = 0;
    lastTimestampRef.current = null;
  }, []);

  return {
    state,
    events,
    accumulator: accumulatorRef.current,
    setSpeed,
    togglePause,
    save,
    load,
    newGame,
  };
}

// Re-export InMemoryStorage so the page can pick it as a fallback for SSR.
export { InMemoryStorage };
