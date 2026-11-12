/**
 * Panel — common container (P5b — GDD §13.1 main game screen surrounds).
 *
 * A bordered, padded, rounded card that wraps a section of the dashboard.
 * The main game screen (page.tsx) lays out its surrounds as a grid of
 * Panels; this primitive enforces consistent visual structure (border,
 * radius, padding, optional title + tone).
 *
 * Rule 6 (rendering / UI reads state, never writes): pure presentational
 * component. No store subscription, no engine calls — just a styled wrapper.
 */
import type { ReactElement, ReactNode } from 'react';

export interface PanelProps {
  /** Optional heading shown in small uppercase above the body. */
  readonly title?: string;
  /** Optional hint shown beside the title (smaller, muted). */
  readonly hint?: string;
  /** Optional icon (emoji or short glyph) shown before the title. */
  readonly icon?: string;
  /** Children rendered inside the panel's padded body. */
  readonly children: ReactNode;
  /** Extra Tailwind classes for the outer wrapper (e.g. layout overrides). */
  readonly className?: string;
  /** Optional Tailwind tone fragment applied to the title + left border.
   *  Defaults to `'slate'`. Used by TreeConditionSummary / WeatherDisplay
   *  to tint the panel to match the tier / weather tone. */
  readonly tone?: 'slate' | 'emerald' | 'amber' | 'rose' | 'sky' | 'indigo' | 'cyan';
}

const BORDER_TONE: Readonly<Record<NonNullable<PanelProps['tone']>, string>> = Object.freeze({
  slate: 'border-slate-800',
  emerald: 'border-emerald-800/60',
  amber: 'border-amber-800/60',
  rose: 'border-rose-800/60',
  sky: 'border-sky-800/60',
  indigo: 'border-indigo-800/60',
  cyan: 'border-cyan-800/60',
});

const TEXT_TONE: Readonly<Record<NonNullable<PanelProps['tone']>, string>> = Object.freeze({
  slate: 'text-slate-400',
  emerald: 'text-emerald-300',
  amber: 'text-amber-300',
  rose: 'text-rose-300',
  sky: 'text-sky-300',
  indigo: 'text-indigo-300',
  cyan: 'text-cyan-300',
});

/**
 * Render a Panel. Pure presentational component — no state, no effects.
 *
 * @example
 *   <Panel title="Money" icon="💰">
 *     <MoneyDisplay />
 *   </Panel>
 */
export function Panel({
  title,
  hint,
  icon,
  children,
  className,
  tone = 'slate',
}: PanelProps): ReactElement {
  const border = BORDER_TONE[tone];
  const text = TEXT_TONE[tone];
  return (
    <section
      className={[
        'rounded-lg border bg-slate-950/40 p-4 space-y-2 backdrop-blur-sm',
        border,
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {title ? (
        <header className="flex items-baseline justify-between gap-2">
          <h2 className={`text-xs uppercase tracking-wider flex items-center gap-1.5 ${text}`}>
            {icon ? <span aria-hidden="true">{icon}</span> : null}
            <span>{title}</span>
          </h2>
          {hint ? (
            <span className="text-[10px] text-slate-500 font-mono uppercase">{hint}</span>
          ) : null}
        </header>
      ) : null}
      <div>{children}</div>
    </section>
  );
}
