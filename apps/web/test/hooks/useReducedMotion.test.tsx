/**
 * Tests for useReducedMotion hook (P5d — WCAG 2.1 AA / 2.3.3).
 *
 * (GDD §13 only formalises §13.1-§13.5 — accessibility isn't yet a
 * dedicated GDD section. docs/ui.md §"Accessibility decisions" records
 * the WCAG criteria P5d satisfies.)
 *
 * Coverage:
 *   - `resolveReducedMotion(override, osPreference)` is pure — deterministic
 *     for the (override, osPreference) pair.
 *   - `'on'` always returns `true` regardless of the OS preference.
 *   - `'off'` always returns `false` regardless of the OS preference.
 *   - `'auto'` defers to the OS preference.
 *   - The hook reads from `ui.reducedMotionOverride` + the OS matchMedia
 *     query. When the override is `'on'`, the hook returns `true` (priority
 *     order: 'on' wins). happy-dom doesn't implement matchMedia, so the
 *     OS-preference read returns `false` — the `'auto'` default returns
 *     `false` (motion OK), the `'off'` override returns `false` too, but
 *     `'on'` returns `true`.
 *
 * Environment: happy-dom. The hook uses `useState` + `useEffect` +
 * `matchMedia`; happy-dom implements `useEffect` but not `matchMedia` —
 * the hook handles that via try/catch + fallback to `false`.
 */
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import {
  useGameStore,
  __resetGameStoreForTests,
} from '../../stores/game-store';
import {
  useReducedMotion,
  resolveReducedMotion,
} from '../../hooks/useReducedMotion';

// ----------------------------------------------------------------------------
// resolveReducedMotion — pure function.
// ----------------------------------------------------------------------------

describe('resolveReducedMotion (P5d) — pure resolver', () => {
  it("returns true when override is 'on' regardless of OS preference", () => {
    expect(resolveReducedMotion('on', false)).toBe(true);
    expect(resolveReducedMotion('on', true)).toBe(true);
  });

  it("returns false when override is 'off' regardless of OS preference", () => {
    expect(resolveReducedMotion('off', false)).toBe(false);
    expect(resolveReducedMotion('off', true)).toBe(false);
  });

  it("defers to OS preference when override is 'auto'", () => {
    expect(resolveReducedMotion('auto', false)).toBe(false);
    expect(resolveReducedMotion('auto', true)).toBe(true);
  });
});

// ----------------------------------------------------------------------------
// useReducedMotion — React hook.
// ----------------------------------------------------------------------------

describe('useReducedMotion (P5d) — hook', () => {
  beforeEach(() => __resetGameStoreForTests());
  afterEach(() => cleanup());

  it("returns false by default ('auto' override + no matchMedia in happy-dom)", () => {
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  it("returns true when the in-game override is 'on'", () => {
    useGameStore.getState().setReducedMotionOverride('on');
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it("returns false when the in-game override is 'off' (forces motion-enabled)", () => {
    useGameStore.getState().setReducedMotionOverride('off');
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  it("reflects override changes when re-rendered", () => {
    const { result, rerender } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false); // default 'auto' + no matchMedia.
    useGameStore.getState().setReducedMotionOverride('on');
    rerender();
    expect(result.current).toBe(true);
    useGameStore.getState().setReducedMotionOverride('off');
    rerender();
    expect(result.current).toBe(false);
    useGameStore.getState().setReducedMotionOverride('auto');
    rerender();
    expect(result.current).toBe(false); // back to OS fallback (false in happy-dom).
  });
});
