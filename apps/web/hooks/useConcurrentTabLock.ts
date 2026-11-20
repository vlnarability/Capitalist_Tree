/**
 * useConcurrentTabLock — W21 (RV5-F4): concurrent-tab protection via the Web
 * Locks API. BLOCK approach (per user direction — see "Review later" below).
 *
 * Acquires an exclusive, `ifAvailable` Web Lock on mount + holds it for the
 * component's lifetime. If another tab already holds the lock, this tab is
 * `blocked` (the `ConcurrentTabGate` then renders a "paused" screen instead of
 * mounting the game — so the second tab never boots the simulation loop or
 * touches IndexedDB, preventing the two-tabs-clobber-the-same-save race that
 * RV5-F4 flagged).
 *
 * States:
 *   - `'acquiring'` — the lock request is in flight (brief; the gate shows a
 *     loading screen).
 *   - `'active'` — this tab holds the lock + may run the sim.
 *   - `'blocked'` — another tab holds the lock; this tab is paused.
 *   - `'unsupported'` — `navigator.locks` is unavailable (older browser / SSR /
 *     a failed request). The game proceeds WITHOUT cross-tab protection rather
 *     than breaking — the same default the local-first app has always had.
 *
 * The lock auto-releases when the tab closes (the browser drops it). On
 * component unmount, the held promise resolves + the lock is released.
 *
 * REVIEW LATER (warn vs block): the BLOCK approach was chosen per user
 * direction for now — the second tab is fully paused (safest for saves). Re-
 * review whether WARN (both tabs run + a banner surfaces the conflict risk) is
 * better UX; the swap is localized to this hook + the gate. Tracked in
 * docs/reviews/DECISIONS.md.
 *
 * Rule 6 (TDD §15.1, GDD §6.1): the hook touches no `simState` + writes no
 * store slice — it holds only local React state. The lock is a tab-level
 * browser resource, not simulation state.
 */
'use client';

import { useEffect, useState } from 'react';

export type ConcurrentTabLockState =
  | 'acquiring'
  | 'active'
  | 'blocked'
  | 'unsupported';

/** The Web Lock name — shared across tabs of the same origin. */
const LOCK_NAME = 'ct-active-tab';

export function useConcurrentTabLock(): ConcurrentTabLockState {
  // Initial state is always 'acquiring' (the loading screen). The navigator
  // check is deferred to the useEffect below — reading `navigator` in the
  // initializer would SSR-render 'unsupported' (Node has no navigator.locks)
  // while the client hydrates as 'acquiring', a hydration mismatch (React
  // warns + re-renders, which can delay the lock-acquisition useEffect + made
  // the e2e flaky on Node 20 CI). The useEffect transitions to 'unsupported'
  // / 'active' / 'blocked' on mount.
  const [state, setState] = useState<ConcurrentTabLockState>('acquiring');

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.locks) {
      setState('unsupported');
      return;
    }
    let release: (() => void) | null = null;
    let cancelled = false;

    // ifAvailable: don't queue — if another tab holds the lock, the callback
    // receives null + this tab is blocked immediately.
    navigator.locks
      .request(
        LOCK_NAME,
        { mode: 'exclusive', ifAvailable: true },
        async (lock: Lock | null) => {
          if (cancelled) return;
          if (lock === null) {
            setState('blocked');
            return;
          }
          setState('active');
          // Hold the lock until unmount (the promise resolves when release()
          // fires; the browser releases the lock on tab close regardless).
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        },
      )
      .catch(() => {
        // Acquisition threw (permissions, aborted, etc.) — don't block the game.
        if (!cancelled) setState('unsupported');
      });

    return () => {
      cancelled = true;
      release?.();
    };
  }, []);

  return state;
}
