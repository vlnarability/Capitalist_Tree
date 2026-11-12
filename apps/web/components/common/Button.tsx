/**
 * Button — common button primitive (P5b — GDD §13.1 main screen speed controls).
 *
 * A small, Tailwind-styled button with three tones:
 *   - `'default'` — neutral slate (Save, Load, New Game).
 *   - `'active'` — emerald highlight (selected speed multiplier).
 *   - `'warning'` — amber (Pause toggle).
 *
 * The component forwards all standard button attributes via spread so callers
 * can attach onClick handlers, disable it, set type, etc. without coupling
 * to the implementation. It is purely presentational — no store subscription,
 * no engine calls (rule 6: UI reads state, never writes — the click handler
 * in the caller is the path that routes through the store's dispatch).
 */
import type { ButtonHTMLAttributes, ReactElement } from 'react';

export type ButtonTone = 'default' | 'active' | 'warning';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual tone. Defaults to `'default'`. */
  readonly tone?: ButtonTone;
  /** Optional icon (emoji or short glyph) shown before the label. */
  readonly icon?: string;
}

const TONE_CLASSES: Readonly<Record<ButtonTone, string>> = Object.freeze({
  default: 'border-slate-700 bg-slate-900 text-slate-200 hover:border-slate-600 hover:bg-slate-800',
  active: 'border-emerald-500 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20',
  warning: 'border-amber-500 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20',
});

/**
 * Render a Button. Pure presentational component. The caller owns the
 * click handler — typically `onClick={() => useGameStore.getState().dispatch(setSpeed(m))}`.
 *
 * @example
 *   <Button tone="active" onClick={() => dispatch(setSpeed(1))}>1x</Button>
 *   <Button tone="warning" onClick={() => dispatch(pause())}>Pause</Button>
 */
export function Button({ tone = 'default', icon, className, children, ...rest }: ButtonProps): ReactElement {
  return (
    <button
      type="button"
      className={[
        'inline-flex items-center gap-1.5 rounded border px-3 py-1 text-sm font-medium transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50',
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
}
