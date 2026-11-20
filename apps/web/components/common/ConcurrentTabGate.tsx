/**
 * ConcurrentTabGate — W21 (RV5-F4): wraps the app so a second concurrent tab is
 * BLOCKED from mounting the game (see useConcurrentTabLock — BLOCK approach).
 *
 * Mounted in app/layout.tsx around `{children}`. When the lock state is
 * `'blocked'`, the gate renders a "paused" screen instead of the children — so
 * page.tsx (which calls `useSimulationLoop` on mount) never boots, never loads
 * the save, + never writes IndexedDB. This is the core protection: the second
 * tab cannot race the first tab's save.
 *
 * When `'acquiring'`, a brief loading screen (the lock request is async). When
 * `'active'` or `'unsupported'`, the children render normally.
 *
 * Architecture (rule 6 — rendering / UI reads state, never writes the sim):
 * the gate holds no simState; it gates MOUNTING of the sim-running tree. The
 * lock state is local to the `useConcurrentTabLock` hook (a tab-level browser
 * resource). The gate is a client component (it uses the hook); the layout that
 * renders it stays a server component.
 *
 * REVIEW LATER: if the warn-vs-block decision flips to warn, this gate becomes
 * a banner that always renders children + surfaces a warning instead of
 * blocking. See useConcurrentTabLock + docs/reviews/DECISIONS.md.
 */
'use client';

import { type ReactElement, type ReactNode } from 'react';
import { useConcurrentTabLock } from '../../hooks/useConcurrentTabLock';

export interface ConcurrentTabGateProps {
  readonly children: ReactNode;
}

export function ConcurrentTabGate({ children }: ConcurrentTabGateProps): ReactElement {
  const state = useConcurrentTabLock();

  if (state === 'blocked') {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-slate-950 p-6"
        data-testid="concurrent-tab-blocked"
      >
        <div className="max-w-md rounded-lg border border-amber-700/50 bg-slate-900 p-6 text-center">
          <h1 className="mb-2 text-lg font-semibold text-amber-300">
            Another tab is already open
          </h1>
          <p className="mb-4 text-sm text-slate-300">
            The Capitalist Tree is running in another tab. To protect your save
            from conflicts, this tab is paused. Close the other tab, then reload
            this one to play here.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:border-slate-400"
            data-testid="concurrent-tab-reload"
          >
            Reload this tab
          </button>
        </div>
      </div>
    );
  }

  if (state === 'acquiring') {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-slate-950 p-6"
        data-testid="concurrent-tab-acquiring"
      >
        <p className="text-sm text-slate-400">Loading…</p>
      </div>
    );
  }

  // 'active' or 'unsupported' — render the app.
  return <>{children}</>;
}
