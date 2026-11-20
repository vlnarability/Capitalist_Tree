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

/**
 * DR-6 (docs/reviews/DECISIONS.md): fork() behavior is versioned.
 *   - v1 (legacy): root-consuming — fork() consumes one parent draw.
 *   - v2 (current): non-root-consuming — fork() derives the child seed from
 *     the parent's CURRENT state without advancing it.
 * The point of v2: adding a fork (e.g. a new system that calls
 * ctx.rng.fork('NewSystem')) must NOT shift the parent's subsequent draws, so
 * adding a weather calculation cannot change mortality outcomes simply by
 * consuming extra random values. New sims initialize at v2; legacy saves keep
 * v1 (their RNG sequence is preserved).
 */
describe('DR-6 fork versioning (v1 legacy root-consuming vs v2 non-root-consuming)', () => {
  // Helper: a fresh parent at a given version, seeded identically.
  const parentState = (seed: number) => Rng.fromSeed(seed).getState();

  it('v1 fork is root-consuming — the parent advances by one draw on fork', () => {
    const state = parentState(42);
    // The first draw the parent WOULD produce without forking.
    const noForkFirst = Rng.fromState(state, 1).next();

    // Rebuild + fork — v1 must consume a root draw.
    const forked = Rng.fromState(state, 1);
    forked.fork('BiologySystem');

    // The state changed from the initial persisted state (a draw was consumed) ...
    expect(forked.getState()).not.toEqual(state);
    // ... and the next draw after the fork (the SECOND draw) differs from the
    // no-fork FIRST draw — the fork shifted the parent's position by one.
    expect(forked.next()).not.toBe(noForkFirst);
  });

  it('v2 fork is non-root-consuming — the parent state + next draw are unchanged by forking', () => {
    const state = parentState(42);
    // The first draw the parent WOULD produce without forking.
    const noForkFirst = Rng.fromState(state, 2).next();

    // Rebuild + fork — v2 must NOT consume a root draw.
    const forked = Rng.fromState(state, 2);
    forked.fork('BiologySystem');

    // The state is byte-identical to the initial persisted state (no draw consumed) ...
    expect(forked.getState()).toEqual(state);
    // ... and the next draw after the fork equals the no-fork FIRST draw — the
    // fork left the parent's position untouched.
    expect(forked.next()).toBe(noForkFirst);
  });

  it('v2: adding a fork does not shift the parent subsequent draws (the core DR-6 property)', () => {
    // Two identical parents at v2. One forks a child; the other does not.
    // Their subsequent root draws MUST match — forking is invisible to the
    // parent's sequence. (Under v1 this would FAIL — forking shifts the root.)
    const state = parentState(2024);
    const withFork = Rng.fromState(state, 2);
    const withoutFork = Rng.fromState(state, 2);

    withFork.fork('SomeNewSystem');
    // withoutFork does not fork.

    for (let i = 0; i < 200; i++) {
      expect(withFork.next()).toBe(withoutFork.next());
    }
  });

  it('v1 (contrast): adding a fork DOES shift the parent subsequent draws', () => {
    // The legacy behavior DR-6 replaces — forking consumes a root draw, so the
    // parent's subsequent sequence diverges from a no-fork parent. This test
    // documents WHY v1 was a problem + guards that v1 stays legacy-only.
    const state = parentState(2024);
    const withFork = Rng.fromState(state, 1);
    const withoutFork = Rng.fromState(state, 1);

    withFork.fork('SomeNewSystem');

    let differ = 0;
    for (let i = 0; i < 200; i++) {
      if (withFork.next() !== withoutFork.next()) differ++;
    }
    expect(differ).toBeGreaterThan(180);
  });

  it('both versions are deterministic — same (state, name) yields the same child sequence', () => {
    const state = parentState(7);
    for (const version of [1, 2] as const) {
      const a = Rng.fromState(state, version).fork('weather');
      const b = Rng.fromState(state, version).fork('weather');
      for (let i = 0; i < 100; i++) {
        expect(a.next()).toBe(b.next());
      }
    }
  });

  it('v1 and v2 produce different child sequences for the same (state, name)', () => {
    // The switchover changes behavior — this is the migration concern DR-6
    // addresses by versioning: legacy saves keep v1, new sims get v2.
    const state = parentState(7);
    const childV1 = Rng.fromState(state, 1).fork('BiologySystem');
    const childV2 = Rng.fromState(state, 2).fork('BiologySystem');
    let differ = 0;
    for (let i = 0; i < 100; i++) {
      if (childV1.next() !== childV2.next()) differ++;
    }
    expect(differ).toBeGreaterThan(90);
  });

  it('a child inherits the parent fork version (nested forks preserve the behavior)', () => {
    const state = parentState(5);
    const parentV2 = Rng.fromState(state, 2);
    const child = parentV2.fork('BiologySystem');
    expect(child.forkVersion).toBe(2);
    // The child's fork is also non-root-consuming.
    const before = child.getState();
    child.fork('SubSystem');
    expect(child.getState()).toEqual(before);

    const parentV1 = Rng.fromState(state, 1);
    const childV1 = parentV1.fork('BiologySystem');
    expect(childV1.forkVersion).toBe(1);
  });
});
