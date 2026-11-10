import { describe, it, expect } from 'vitest';
import { Rng } from '../src/rng.js';

describe('Rng determinism (sfc32 + splitmix32 seeder)', () => {
  it('same seed -> same first N values', () => {
    const a = Rng.fromSeed(42);
    const b = Rng.fromSeed(42);
    for (let i = 0; i < 1000; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('different seeds -> different sequences', () => {
    const a = Rng.fromSeed(1);
    const b = Rng.fromSeed(2);
    let differ = 0;
    for (let i = 0; i < 100; i++) {
      if (a.next() !== b.next()) differ++;
    }
    expect(differ).toBeGreaterThan(90);
  });

  it('values are in [0, 1)', () => {
    const r = Rng.fromSeed(42);
    for (let i = 0; i < 10_000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('getState + fromState is identity-preserving across a save/load', () => {
    // Advance N, save state, advance M from reloaded = advance N+M from start.
    const N = 50;
    const M = 30;
    const baseStart = Rng.fromSeed(123);
    const baseExpected: number[] = [];
    for (let i = 0; i < N + M; i++) baseExpected.push(baseStart.next());

    // Now: advance N, snapshot, advance M from snapshot
    const live = Rng.fromSeed(123);
    const afterN: number[] = [];
    for (let i = 0; i < N; i++) afterN.push(live.next());
    const snap = live.getState();
    const restored = Rng.fromState(snap);
    const afterM: number[] = [];
    for (let i = 0; i < M; i++) afterM.push(restored.next());

    expect([...afterN, ...afterM]).toEqual(baseExpected);
  });

  it('nextInt respects bounds', () => {
    const r = Rng.fromSeed(42);
    for (let i = 0; i < 1000; i++) {
      const v = r.nextInt(5, 10);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThanOrEqual(10);
    }
  });
});

describe('Rng fork independence', () => {
  it('fork("a") and fork("b") produce independent sequences', () => {
    const parent = Rng.fromSeed(42);
    const a = parent.fork('a');
    const b = parent.fork('b');
    let differ = 0;
    for (let i = 0; i < 100; i++) {
      if (a.next() !== b.next()) differ++;
    }
    // At least 90% should differ for independent RNGs.
    expect(differ).toBeGreaterThan(90);
  });

  it('fork is deterministic given same parent state + same name', () => {
    const p1 = Rng.fromSeed(99);
    const p2 = Rng.fromSeed(99);
    const a1 = p1.fork('weather');
    const a2 = p2.fork('weather');
    for (let i = 0; i < 100; i++) {
      expect(a1.next()).toBe(a2.next());
    }
  });

  it('forking does not produce the same sequence as the parent', () => {
    const parent = Rng.fromSeed(7);
    const child = parent.fork('child');
    let differ = 0;
    const parentFresh = Rng.fromSeed(7);
    for (let i = 0; i < 100; i++) {
      if (child.next() !== parentFresh.next()) differ++;
    }
    expect(differ).toBeGreaterThan(90);
  });
});
