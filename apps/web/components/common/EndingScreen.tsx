/**
 * EndingScreen — GAP-36 (GDD §12 "Player Objectives and Endings").
 *
 * Renders a celebratory ending modal when an objective newly completes. The
 * game has no mandatory ending (GDD §12); the six objectives ARE the endings —
 * each is a self-chosen long-term goal, tracked independently + may overlap.
 * Completion is soft: the modal surfaces the moment, the player continues
 * playing afterward (other endings remain pursuable).
 *
 * The ending is parked on the UI slice (`ui.pendingEnding`) by `commitSimState`
 * when `eventState.objectives.completed` gains an id absent from the previous
 * simState (so a load — where prev is null + completed is already populated —
 * does NOT re-fire). This modal is the ONLY surfacing of that signal; once
 * dismissed (Continue), `pendingEnding` is cleared. Completion itself persists
 * (`eventState.objectives.completed`, W8) + shows on the ObjectivesPanel.
 *
 * Architecture (mirrors OfflineModal):
 *   - Rule 6 (TDD §15.1, GDD §6.1): rendering / UI reads state, NEVER writes.
 *     Reads `ui.pendingEnding` via a narrow Zustand selector; clears it via
 *     `clearPendingEnding` (a UI mutator — `simState` is referentially
 *     untouched). The modal never runs simulation logic.
 *   - Rule 2 (purity): render is a pure function of `pendingEnding` + the
 *     `getEnding` content lookup.
 *   - P11 (W23 / RV6-3) accessibility: Escape to dismiss, focus trap, autofocus
 *     on the Continue button.
 *   - TDD §16 selective UI updates: subscribes to a single `ui.pendingEnding`
 *     reference — re-renders only when an ending is parked or cleared, not on
 *     every sim tick.
 *
 * i18n (P13-C): the modal chrome is English for now (matching the sibling
 * ObjectivesPanel); applying the `useT` table to endings is a follow-up.
 *
 * Returns `null` when `pendingEnding` is null (no modal to show).
 */
'use client';

import { useCallback, useEffect, useRef, type ReactElement } from 'react';
import { getEnding, type EndingTone } from '@capitalist-tree/content';
import { useGameStore } from '../../stores/game-store';
import { Button } from '../common/Button';

/** Tone → accent colour fragment for the modal's title + border. */
const TONE_ACCENT: Readonly<Record<EndingTone, string>> = {
  triumph: 'text-amber-300 border-amber-700/60',
  restoration: 'text-emerald-300 border-emerald-700/60',
  desolation: 'text-rose-300 border-rose-700/60',
  balance: 'text-sky-300 border-sky-700/60',
  industry: 'text-indigo-300 border-indigo-700/60',
  legacy: 'text-cyan-300 border-cyan-700/60',
};

export interface EndingScreenProps {
  /** Optional className applied to the outer wrapper. */
  readonly className?: string;
}

/**
 * Render the EndingScreen. Subscribes narrowly to `ui.pendingEnding`; returns
 * `null` when no ending is parked. The Continue click clears the ending via the
 * store's UI mutator (rule 6 — `simState` untouched).
 */
export function EndingScreen({ className }: EndingScreenProps = {}): ReactElement | null {
  const pendingEnding = useGameStore((s) => s.ui.pendingEnding);
  const clearPendingEnding = useGameStore((s) => s.clearPendingEnding);

  const onContinue = useCallback(() => {
    clearPendingEnding();
  }, [clearPendingEnding]);

  // P11 (W23 / RV6-3): accessibility — Escape to dismiss + focus trap +
  // autofocus on the Continue button.
  const dialogRef = useRef<HTMLDivElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (pendingEnding === null) return;
    continueRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        clearPendingEnding();
      } else if (e.key === 'Tab') {
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (!focusable || focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingEnding, clearPendingEnding]);

  if (pendingEnding === null) return null;

  const ending = getEnding(pendingEnding);
  const accent = TONE_ACCENT[ending.tone];

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ending-screen-title"
      data-testid="ending-screen"
    >
      <div
        ref={dialogRef}
        className={`max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-lg border bg-slate-900 p-6 shadow-2xl ${accent} ${className ?? ''}`}
      >
        {/* Header. */}
        <header className="mb-4 flex flex-col gap-1">
          <p
            className="text-xs uppercase tracking-wider text-slate-500"
            data-testid="ending-screen-eyebrow"
          >
            Ending Achieved — one of six (GDD §12)
          </p>
          <h2
            id="ending-screen-title"
            className={`text-2xl font-semibold ${accent.split(' ')[0]}`}
            data-testid="ending-screen-title"
          >
            {ending.title}
          </h2>
        </header>

        {/* Objective + epilogue. */}
        <section className="mb-5 flex flex-col gap-3" data-testid="ending-screen-body">
          <div>
            <h3 className="mb-1 text-xs uppercase tracking-wider text-slate-500">Objective</h3>
            <p className="text-sm text-slate-300">{ending.objective}</p>
          </div>
          <div>
            <h3 className="mb-1 text-xs uppercase tracking-wider text-slate-500">Epilogue</h3>
            <p className="text-sm leading-relaxed text-slate-200">{ending.epilogue}</p>
          </div>
        </section>

        {/* Note: other endings remain pursuable (GDD §12 — no mandatory ending). */}
        <p className="mb-5 text-xs text-slate-500" data-testid="ending-screen-hint">
          The game continues — pursue other endings through play. This completion
          persists across save/load + shows on the Objectives panel.
        </p>

        {/* Dismiss. */}
        <footer className="flex justify-end">
          <Button
            ref={continueRef}
            tone="active"
            onClick={onContinue}
            data-testid="ending-screen-continue"
          >
            Continue
          </Button>
        </footer>
      </div>
    </div>
  );
}
