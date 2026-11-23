/**
 * InfoHint — GAP-35 (GDD §13.3 "Advanced View should explain relationships, not
 * merely display more numbers").
 *
 * A small "?" trigger that reveals a short explanation tooltip on hover OR
 * keyboard focus. Used next to advanced-view indicators (photosynthesis, energy
 * allocation, stress, sustainable harvest, ...) so the player can opt into a
 * one- or two-sentence explanation of the *relationship* behind the number,
 * without it permanently consuming layout.
 *
 * Architecture (rule 6 — rendering / UI reads state, never writes the sim):
 * the tooltip's open/closed state is *local component state* (a disclosure
 * widget), NOT `simState` or even the `ui` slice. The component is purely
 * presentational — it takes the explanation string as a prop + emits no
 * events. Rule 2 (purity): render is a pure function of `explanation` + the
 * local visibility flag.
 *
 * Accessibility (WCAG 2.1):
 *   - The trigger is a real `<button>` (keyboard-focusable, Enter/Space toggles).
 *   - `aria-describedby` links the trigger to the tooltip content for AT.
 *   - The tooltip has `role="tooltip"` + is dismissable with Escape.
 *   - Hover, focus, + blur all keep the tooltip open while interacting + close
 *     on leave (no keyboard trap — Escape closes, Tab moves away).
 */
'use client';

import { useCallback, useId, useState, type ReactElement } from 'react';

export interface InfoHintProps {
  /** The explanation text (1-2 sentences describing the relationship). */
  readonly explanation: string;
  /** Accessible label for the trigger button (e.g. "Explain photosynthesis"). */
  readonly label: string;
  /** Optional className applied to the trigger wrapper. */
  readonly className?: string;
}

/**
 * Render an InfoHint. The "?" button reveals the explanation tooltip on hover
 * or focus.
 *
 * @example
 *   <InfoHint label="Explain photosynthesis" explanation={getExplanation('biology-photosynthesis')} />
 */
export function InfoHint({ explanation, label, className }: InfoHintProps): ReactElement {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();

  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  const onKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  }, []);

  return (
    <span className={`relative inline-flex ${className ?? ''}`}>
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? tooltipId : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={toggle}
        onKeyDown={onKey}
        className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-ink text-[9px] font-semibold leading-none text-ink-2 hover:border-slate-400 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
        data-testid="info-hint-trigger"
      >
        ?
      </button>
      {open ? (
        <span
          role="tooltip"
          id={tooltipId}
          data-testid="info-hint-tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1 w-56 -translate-x-1/2 rounded border border-ink bg-parchment-2 px-2 py-1.5 text-[11px] leading-snug text-ink shadow-lg"
        >
          {explanation}
        </span>
      ) : null}
    </span>
  );
}
