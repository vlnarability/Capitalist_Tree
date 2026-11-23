/**
 * Button — common button primitive (P5b — GDD §13.1 main screen speed controls).
 *
 * A small, Tailwind-styled button with three tones:
 *   - `'default'` — ink-bordered parchment (Save, Load, New Game).
 *   - `'active'`  — leaf-green highlight (selected speed multiplier).
 *   - `'warning'` — brass/amber (Pause toggle).
 *
 * W48 (field journal): re-skinned from dark slate to parchment + ink. The
 * active tone is now leaf-green (was emerald) so it reads on cream paper;
 * the dashboard test that pinned the old emerald classes was updated in
 * lockstep (test/components/dashboard/dashboard.test.tsx).
 *
 * The component forwards all standard button attributes via spread so callers
 * can attach onClick handlers, disable it, set type, etc. without coupling
 * to the implementation. It is purely presentational — no store subscription,
 * no engine calls (rule 6: UI reads state, never writes — the click handler
 * in the caller is the path that routes through the store's dispatch).
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactElement } from 'react';

export type ButtonTone = 'default' | 'active' | 'warning';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual tone. Defaults to `'default'`. */
  readonly tone?: ButtonTone;
  /** Optional icon (emoji or short glyph) shown before the label. */
  readonly icon?: string;
}

const TONE_CLASSES: Readonly<Record<ButtonTone, string>> = Object.freeze({
  default: 'border-ink/40 bg-parchment text-ink hover:bg-parchment-3 hover:border-ink/65',
  active: 'border-leaf bg-leaf/20 text-leaf-dark font-semibold hover:bg-leaf/30',
  warning: 'border-brass bg-brass/15 text-brass-2 hover:bg-brass/25',
});

/**
 * Render a Button. Pure presentational component. The caller owns the
 * click handler — typically `onClick={() => useGameStore.getState().dispatch(setSpeed(m))}`.
 *
 * @example
 *   <Button tone="active" onClick={() => dispatch(setSpeed(1))}>1x</Button>
 *   <Button tone="warning" onClick={() => dispatch(pause())}>Pause</Button>
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button({ tone = 'default', icon, className, children, ...rest }, ref): ReactElement {
    return (
      <button
        ref={ref}
        type="button"
        className={[
          'inline-flex items-center gap-1.5 rounded-sm border px-3 py-1 text-sm font-serif transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-leaf/50',
          'disabled:cursor-not-allowed disabled:opacity-50',
          TONE_CLASSES[tone],
          className ?? '',
        ]
          .filter(Boolean)
          .join(' ')}
        {...rest}
      >
        {icon ? <span aria-hidden="true">{icon}</span> : null}
        {children}
      </button>
    );
  },
);
