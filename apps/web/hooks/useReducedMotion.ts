'use client';

/**
 * useReducedMotion — prefers-reduced-motion + in-game setting (P5d).
 *
 * Accessibility hook implementing WCAG 2.1 AA / 2.3.3 Animation from
 * Interactions. (GDD §13 only formalises §13.1-§13.5; accessibility is
 * not yet a dedicated GDD section — docs/ui.md §"Accessibility decisions"
 * records the WCAG criteria P5d satisfies + the gap R-P5d-2 for TreeView.)
 *
 * Returns a boolean. `true` means "reduce motion" — consumers should disable
 * non-essential animations (parallax, autoscroll, transitions on hover,
 * branch-sway in the tree renderer). `false` means "motion OK".
 *
 * Inputs (combined in priority order — first match wins):
 *
 *   1. In-game setting: `ui.reducedMotionOverride` in the Zustand store.
 *      - `'on'`  → always reduce (regardless of OS).
 *      - `'off'` → never reduce (regardless of OS).
 *      - `'auto'` → defer to the OS preference (next).
 *   2. OS preference: `matchMedia('(prefers-reduced-motion: reduce)')`.
 *      - When the override is `'auto'`, the hook returns whatever the OS
 *        media query reports.
 *
 * SSR / non-DOM safety: if `window` / `matchMedia` is undefined (SSR, Node
 * test env, or a browser without matchMedia — extremely rare), the hook
 * falls back to `false` (motion OK) for `'auto' | 'off'`, and `true` for
 * `'on'`. This avoids breaking SSR rendering; the client-side hydration
 * pass will pick up the real OS preference.
 *
 * Re-subscription: the hook subscribes to the `matchMedia` list via
 * `addEventListener('change', ...)`. When the OS preference flips (e.g.
 * the player toggles "Reduce motion" in macOS System Settings), the hook
 * re-renders its consumer. Cleanup on unmount removes the listener.
 *
 * GAP (R-P5d-2): P4's `TreeView` does NOT yet consume this hook — its rAF
 * loop animates branch-sway + leaf-particles + currency-leaf drift
 * unconditionally. Wiring TreeView to honour `useReducedMotion()` is a
 * future rendering-package change (it would gate the per-frame sway
 * offset + particle pool updates). Documented in docs/ui.md §"Accessibility
 * decisions" — the hook is ready for consumers, the consumer isn't yet.
 *
 * Rule 6 (rendering / UI reads state, never writes): the hook reads
 * `ui.reducedMotionOverride` and the OS media query; it never writes.
 */
import { useEffect, useState } from 'react';
import { useGameStore } from '../stores/game-store';

/** The matchMedia query string for the OS reduced-motion preference. */
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Read the OS `prefers-reduced-motion` media query. Returns `false` when
 * `matchMedia` is unavailable (SSR, Node test env). Pure given the global —
 * safe to call outside React.
 */
function readOsPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return window.matchMedia(REDUCED_MOTION_QUERY).matches;
  } catch {
    // Some browsers (very old / non-standard) throw on unknown queries.
    // Fail safe — assume motion OK (the in-game override can force 'on').
    return false;
  }
}

/**
 * Resolve the final "reduce motion?" boolean from the in-game override +
 * the OS preference. Pure — given (override, osPreference) returns boolean.
 *
 * Priority:
 *   1. `override === 'on'`  → true  (always reduce).
 *   2. `override === 'off'` → false (never reduce — explicit user override).
 *   3. `override === 'auto'` → osPreference (defer to OS).
 *
 * Exported for testing + for consumers that want to compute the value
 * without subscribing to the OS media query (e.g. one-shot render decisions).
 */
export function resolveReducedMotion(
  override: 'auto' | 'on' | 'off',
  osPreference: boolean,
): boolean {
  if (override === 'on') return true;
  if (override === 'off') return false;
  return osPreference;
}

/**
 * Subscribe to OS `prefers-reduced-motion` changes. Returns `[value, ready]`
 * where `ready` flips `true` after the first effect run (so the consumer
 * can avoid a flash of motion-enabled state on hydration).
 *
 * Implementation note: React 19's `useSyncExternalStore` would be the
 * idiomatic choice here, but the OS media query is a single boolean that
 * changes at most a handful of times per session — the simpler
 * `useState` + `addEventListener('change', ...)` pattern is clearer and
 * avoids the getServerSnapshot / getSnapshot asymmetry (which would force
 * us to return `false` on the server anyway).
 */
function useOsPrefersReducedMotion(): boolean {
  // Lazy-init from the global so the first render matches the OS setting
  // (no flash of "motion enabled" if the OS says "reduce").
  const [osPreference, setOsPreference] = useState<boolean>(() =>
    readOsPrefersReducedMotion(),
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    let mql: MediaQueryList;
    try {
      mql = window.matchMedia(REDUCED_MOTION_QUERY);
    } catch {
      return;
    }
    // Seed from the live value (in case it changed between the lazy init and
    // the effect — extremely unlikely, but free to do).
    setOsPreference(mql.matches);
    const onChange = (e: MediaQueryListEvent): void => {
      setOsPreference(e.matches);
    };
    // Safari < 14 only supports the deprecated `addListener` API; modern
    // browsers (and the spec) use `addEventListener`. Try both; ignore
    // failure (we'd just miss the live update, not the initial value).
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    if (typeof (mql as MediaQueryList).addListener === 'function') {
      (mql as MediaQueryList).addListener(onChange);
      return () => (mql as MediaQueryList).removeListener(onChange);
    }
    return;
  }, []);

  return osPreference;
}

/**
 * Decide whether to reduce motion, combining the in-game override with the
 * OS `prefers-reduced-motion` media query. See the file header for the
 * priority order.
 *
 * @example
 *   const reduce = useReducedMotion();
 *   <div className={reduce ? '' : 'animate-pulse'}>…</div>
 */
export function useReducedMotion(): boolean {
  const override = useGameStore((s) => s.ui.reducedMotionOverride);
  const osPreference = useOsPrefersReducedMotion();
  return resolveReducedMotion(override, osPreference);
}
