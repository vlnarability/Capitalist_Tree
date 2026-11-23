/**
 * WelcomePanel — GAP-33 first-time tutorial / onboarding (GDD §13 spirit).
 *
 * A one-time "Getting Started" modal shown on first load, framing the core loop
 * (grow → harvest → manage → scale → pursue an ending) in a few sentences. The
 * GDD has no formal tutorial spec; this is a lightweight orientation for a
 * first-prototype under review + new players.
 *
 * Visibility is backed by localStorage (`ct-welcome-dismissed`), matching the
 * `useAudio` mute-persistence pattern — the store does not persist UI
 * preferences (locale, selectedCurrencyId are in-memory), so a one-time
 * display preference lives here rather than on the `ui` slice. Once dismissed
 * (Get Started), it does not re-show on reload.
 *
 * Architecture:
 *   - Rule 6 (TDD §15.1, GDD §6.1): rendering / UI reads state, NEVER writes the
 *     sim. The panel reads no store state; its visibility is local component
 *     state synced to localStorage (a display preference, not simState). It
 *     emits no events + touches no engine state.
 *   - P11 (W23 / RV6-3) accessibility: Escape to dismiss, focus trap, autofocus
 *     on the Get Started button.
 *   - SSR-safe: localStorage is read inside useState's initializer guarded by
 *     `typeof window`, so the server render treats it as not-yet-dismissed
 *     (the modal mounts client-side after hydration).
 *
 * i18n (P13-C): the chrome is English for now (matching the EndingScreen +
 * ObjectivesPanel); applying the useT table to tutorial strings is a follow-up.
 *
 * Returns `null` when dismissed (no modal to show).
 */
'use client';

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { getTutorial } from '@capitalist-tree/content';
import { Button } from '../common/Button';

const WELCOME_KEY = 'ct-welcome-dismissed';

/** Read the persisted dismissed flag (defaults to false — show on first load). */
function readDismissed(): boolean {
  if (typeof window === 'undefined') return true; // SSR: don't render the modal
  try {
    return window.localStorage.getItem(WELCOME_KEY) === '1';
  } catch {
    return false;
  }
}

export interface WelcomePanelProps {
  /** Optional className applied to the outer wrapper. */
  readonly className?: string;
}

/**
 * Render the WelcomePanel. Reads the localStorage dismissed flag on mount;
 * returns `null` when dismissed. The Get Started click persists dismissed +
 * unmounts the modal.
 */
export function WelcomePanel({ className }: WelcomePanelProps = {}): ReactElement | null {
  const [dismissed, setDismissed] = useState<boolean>(readDismissed);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(WELCOME_KEY, '1');
      }
    } catch {
      // localStorage unavailable — in-memory dismissal still works this session.
    }
  }, []);

  // P11 (W23 / RV6-3): accessibility — Escape to dismiss + focus trap +
  // autofocus on the Get Started button.
  const dialogRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (dismissed) return;
    startRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        dismiss();
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
  }, [dismissed, dismiss]);

  if (dismissed) return null;

  const tutorial = getTutorial();

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-[60] flex items-center justify-center bg-parchment-2/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-panel-title"
      data-testid="welcome-panel"
    >
      <div
        ref={dialogRef}
        className={`max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-lg border border-ink bg-parchment p-6 shadow-2xl ${className ?? ''}`}
      >
        {/* Header. */}
        <header className="mb-4">
          <h2
            id="welcome-panel-title"
            className="text-lg font-semibold text-ink"
            data-testid="welcome-panel-title"
          >
            {tutorial.title}
          </h2>
          <p className="mt-1 text-sm text-ink-2" data-testid="welcome-panel-intro">
            {tutorial.intro}
          </p>
        </header>

        {/* Core-loop tips. */}
        <ol className="mb-5 flex flex-col gap-3" data-testid="welcome-panel-tips">
          {tutorial.tips.map((tip, i) => (
            <li key={tip.heading} className="flex gap-2" data-testid={`welcome-panel-tip-${i}`}>
              <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-emerald-900/60 text-[10px] font-semibold text-leaf-dark">
                {i + 1}
              </span>
              <div className="flex flex-col gap-0.5">
                <h3 className="text-sm font-semibold text-ink">{tip.heading}</h3>
                <p className="text-xs leading-relaxed text-ink-2">{tip.body}</p>
              </div>
            </li>
          ))}
        </ol>

        {/* Dismiss. */}
        <footer className="flex items-center justify-between gap-2">
          <p className="text-[10px] text-ink-soft" data-testid="welcome-panel-hint">
            Press Esc or click Get Started to dismiss.
          </p>
          <Button
            ref={startRef}
            tone="active"
            onClick={dismiss}
            data-testid="welcome-panel-start"
          >
            Get Started
          </Button>
        </footer>
      </div>
    </div>
  );
}
