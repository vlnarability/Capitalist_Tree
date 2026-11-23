/**
 * Panel — common container (P5b — GDD §13.1 main game screen surrounds).
 *
 * A bordered, padded card that wraps a section of the dashboard. The main
 * game screen (page.tsx) lays out its surrounds as a grid of Panels; this
 * primitive enforces consistent visual structure (border, radius, padding,
 * optional title + tone).
 *
 * W48 (field journal): re-skinned from dark slate to parchment + ink. The
 * panel is now a cream card with a hairline ink border, a serif small-caps
 * title, and tone-mapped accent colors (leaf for healthy/money, brass for
 * warning/expenses, accent-red for critical/unpaid, sky/teal for weather).
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

// Field-journal tone map: each tone maps to a hairline border + accent text
// color that reads on parchment. `slate` is the neutral ink default.
const BORDER_TONE: Readonly<Record<NonNullable<PanelProps['tone']>, string>> = Object.freeze({
  slate: 'border-ink/25',
  emerald: 'border-leaf/45',
  amber: 'border-brass/45',
  rose: 'border-accent/45',
  sky: 'border-sky-700/45',
  indigo: 'border-ink/35',
  cyan: 'border-teal-700/45',
});

const TEXT_TONE: Readonly<Record<NonNullable<PanelProps['tone']>, string>> = Object.freeze({
  slate: 'text-ink-soft',
  emerald: 'text-leaf-dark',
  amber: 'text-brass-2',
  rose: 'text-accent',
  sky: 'text-sky-800',
  indigo: 'text-ink',
  cyan: 'text-teal-800',
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
        // Parchment card: cream fill, hairline ink border, a faint bottom
        // shadow so it sits on the paper. `rounded-sm` keeps corners tight
        // (field journals are square-cut, not pillowy).
        'rounded-sm border bg-parchment-2/45 p-4 space-y-2 shadow-[0_1px_0_rgba(58,42,26,0.08)]',
        border,
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {title ? (
        <header className="flex items-baseline justify-between gap-2 border-b border-dotted border-ink/20 pb-1">
          <h2 className={`text-[11px] uppercase tracking-[0.15em] smallcaps font-serif flex items-center gap-1.5 ${text}`}>
            {icon ? <span aria-hidden="true">{icon}</span> : null}
            <span>{title}</span>
          </h2>
          {hint ? (
            <span className="text-[10px] text-ink-soft font-journal uppercase tracking-wider">
              {hint}
            </span>
          ) : null}
        </header>
      ) : null}
      <div>{children}</div>
    </section>
  );
}
