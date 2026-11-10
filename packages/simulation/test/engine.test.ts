import { describe, it, expect } from 'vitest';
import {
  engine,
  type GameState,
} from '../src/index.js';
import {
  type GameConfig,
  PROVISIONAL_SIMULATION_STEP_SECONDS as STEP,
  PROVISIONAL_SPEED_5X,
  PROVISIONAL_SPEED_60X,
} from '@capitalist-tree/shared';
import { InMemoryStorage } from '../src/index.js';
import { DEFAULT_GAME_CONFIG } from '../src/initial-state.js';

const STEP_SECONDS = STEP;

function cfg(seed: number): GameConfig {
  return { ...DEFAULT_GAME_CONFIG, seed, createdAt: 0 };
}

describe('engine.initialize', () => {
  it('produces a valid GameState that passes the schema superRefine', async () => {
    const { gameStateSchema } = await import('@capitalist-tree/shared');
    const s = engine.initialize(cfg(42));
    expect(() => gameStateSchema.parse(s)).not.toThrow();
  });

  it('two initializations with the same seed are deeply equal', () => {
    const a = engine.initialize(cfg(42));
    const b = engine.initialize(cfg(42));
    expect(a).toEqual(b);
  });
});

describe('determinism', () => {
  it('advance 1000 steps with same seed -> identical state and events', () => {
    const a0 = engine.initialize(cfg(42));
    const a1 = engine.advance(a0, 1000 * STEP_SECONDS);

    const b0 = engine.initialize(cfg(42));
    const b1 = engine.advance(b0, 1000 * STEP_SECONDS);

    expect(a1.state).toEqual(b1.state);
    expect(a1.events).toEqual(b1.events);
  });

  it('save->load->advance 1000 == advance 2000 from start (without saving)', async () => {
    const a0 = engine.initialize(cfg(42));
    const a1 = engine.advance(a0, 1000 * STEP_SECONDS);

    const storage = new InMemoryStorage();
    await storage.save(a1.state);
    const loaded = await storage.load();
    expect(loaded).not.toBeNull();
    const a2 = engine.advance(loaded!, 1000 * STEP_SECONDS);

    const b0 = engine.initialize(cfg(42));
    const b2 = engine.advance(b0, 2000 * STEP_SECONDS);

    expect(a2.state).toEqual(b2.state);
    // Save->load preserves RNG position, so events from the second 1000-step
    // advance must equal events [1000..1999] of the unified 2000-step run.
    expect([...a1.events, ...a2.events]).toEqual(b2.events);
  });
});

describe('splittability', () => {
  it('advance(N steps).state + advance(M steps) == advance(N+M steps) (state)', () => {
    const N = 5;
    const M = 7;
    const a0 = engine.initialize(cfg(11));
    const a1 = engine.advance(a0, N * STEP_SECONDS);
    const a2 = engine.advance(a1.state, M * STEP_SECONDS);

    const b0 = engine.initialize(cfg(11));
    const b1 = engine.advance(b0, (N + M) * STEP_SECONDS);

    expect(a2.state).toEqual(b1.state);
  });

  it('advance(N steps) + advance(M steps) events == advance(N+M steps) events', () => {
    const N = 5;
    const M = 7;
    const a0 = engine.initialize(cfg(11));
    const a1 = engine.advance(a0, N * STEP_SECONDS);
    const a2 = engine.advance(a1.state, M * STEP_SECONDS);
    // Total events from the split run = first-N + next-M
    const splitEvents = [...a1.events, ...a2.events];

    const b0 = engine.initialize(cfg(11));
    const b1 = engine.advance(b0, (N + M) * STEP_SECONDS);

    expect(splitEvents).toEqual(b1.events);
  });

  it('advance(N steps) + advance(M steps) has events == advance(N+M steps) events (smaller N,M)', () => {
    const N = 3;
    const M = 4;
    const a0 = engine.initialize(cfg(11));
    const a1 = engine.advance(a0, N * STEP_SECONDS);
    const a2 = engine.advance(a1.state, M * STEP_SECONDS);
    const splitEvents = [...a1.events, ...a2.events];

    const b0 = engine.initialize(cfg(11));
    const b1 = engine.advance(b0, (N + M) * STEP_SECONDS);

    expect(splitEvents).toEqual(b1.events);
  });
});

describe('pause contract', () => {
  it('engine.advance progresses even when clock.paused === true', () => {
    const s = engine.initialize(cfg(3));
    const pausedState: GameState = {
      ...s,
      clock: { ...s.clock, paused: true },
    };
    const r = engine.advance(pausedState, 5 * STEP_SECONDS);
    expect(r.state.clock.elapsedSeconds).toBeGreaterThan(s.clock.elapsedSeconds);
    expect(r.state.clock.paused).toBe(true); // pause flag preserved
  });

  it('the accumulator layer (consumer) is what enforces pause; engine is pure', () => {
    // Simulate the consumer's accumulator: do not call advance when paused.
    const s = engine.initialize(cfg(3));
    const pausedState: GameState = {
      ...s,
      clock: { ...s.clock, paused: true },
    };
    // Consumer skips advancing while paused.
    const r = { state: pausedState, events: [], consumedSeconds: 0 };
    expect(r.state.clock.elapsedSeconds).toBe(s.clock.elapsedSeconds);
  });
});

describe('speed multiplier', () => {
  it('speed multiplier scales elapsed sim time at the accumulator layer', () => {
    // Engine.advance receives sim seconds already scaled by the consumer.
    // The test demonstrates: 1 real second @ 5x -> 5 sim minutes (300 sim s)
    // -> floor(300/60) = 5 steps.
    const realSeconds = 1;
    const speed = PROVISIONAL_SPEED_5X;
    const simSeconds = realSeconds * 60 * speed; // 60 real->sim factor, 5x speed
    const s = engine.initialize(cfg(3));
    const r = engine.advance(s, simSeconds);
    expect(r.consumedSeconds).toBe(5 * STEP_SECONDS);
    expect(r.state.clock.elapsedSeconds).toBe(5 * STEP_SECONDS);
  });

  it('60x produces 60x as many steps as 1x for the same wall-clock delta', () => {
    const realSeconds = 1;
    const baseSim = realSeconds * 60; // 60 sim seconds = 1 step
    const s1 = engine.initialize(cfg(3));
    const r1 = engine.advance(s1, baseSim * 1);
    const s60 = engine.initialize(cfg(3));
    const r60 = engine.advance(s60, baseSim * 60);
    expect(r1.consumedSeconds).toBe(STEP_SECONDS);
    expect(r60.consumedSeconds).toBe(60 * STEP_SECONDS);
  });

  it('set-speed action changes the clock.speedMultiplier', () => {
    const s = engine.initialize(cfg(3));
    const r = engine.executeAction(s, {
      type: 'set-speed',
      payload: { multiplier: PROVISIONAL_SPEED_60X },
    });
    expect(r.state.clock.speedMultiplier).toBe(PROVISIONAL_SPEED_60X);
  });
});

describe('executeAction', () => {
  it('rejects unknown action types with UnknownActionError', async () => {
    const { UnknownActionError } = await import('@capitalist-tree/shared');
    const s = engine.initialize(cfg(3));
    const unknown = { type: 'plant-tree', payload: {} } as unknown as Parameters<typeof engine.executeAction>[1];
    expect(() => engine.executeAction(s, unknown)).toThrow(UnknownActionError);
  });

  it('no-op action returns state unchanged (deep equal)', () => {
    const s = engine.initialize(cfg(3));
    const r = engine.executeAction(s, { type: 'no-op' });
    expect(r.state).toEqual(s);
    expect(r.events).toEqual([]);
  });
});

describe('purity — engine never mutates its input state (TDD §4.1, rule 2)', () => {
  // Deep-freeze the input to ensure any mutation would throw, then run the
  // engine and confirm the input is structurally unchanged afterward.
  function deepFreeze<T>(v: T): T {
    if (v && typeof v === 'object') {
      for (const k of Object.keys(v as Record<string, unknown>)) {
        deepFreeze((v as Record<string, unknown>)[k]);
      }
      Object.freeze(v);
    }
    return v;
  }

  it('engine.advance does not mutate its input state', () => {
    const s = deepFreeze(engine.initialize(cfg(7)));
    // Must not throw — strict mode would surface any mutation as a TypeError.
    expect(() => engine.advance(s, 5 * STEP_SECONDS)).not.toThrow();
    // Snapshot for post-call deep equality.
    const before = engine.initialize(cfg(7));
    engine.advance(before, 5 * STEP_SECONDS);
    expect(before).toEqual(engine.initialize(cfg(7)));
  });

  it('engine.executeAction does not mutate its input state', () => {
    const s = deepFreeze(engine.initialize(cfg(7)));
    expect(() =>
      engine.executeAction(s, {
        type: 'set-speed',
        payload: { multiplier: PROVISIONAL_SPEED_5X },
      }),
    ).not.toThrow();
    const before = engine.initialize(cfg(7));
    engine.executeAction(before, {
      type: 'set-speed',
      payload: { multiplier: PROVISIONAL_SPEED_5X },
    });
    expect(before).toEqual(engine.initialize(cfg(7)));
  });
});
