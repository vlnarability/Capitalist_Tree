/**
 * Stat — single labeled value display (P5b — GDD §13.1 dashboard surrounds).
 *
 * Used inside a `<Panel>` to show one labeled value (e.g. `'Soil Health'` →
 * `'82%'`). Purely presentational — accepts a label + value + optional tone
 * for colouring. Used by ResourcesSummary, ExpensesSummary, etc.
 *
 * Rule 6 (rendering / UI reads state, never writes): no store subscription,
 * no engine calls. The caller passes the formatted value as a string; this
 * component just renders it.
 */
import type { ReactElement, ReactNode } from 'react';

export interface StatProps {
  /** Label shown above the value, small + muted. */
  readonly label: string;
  /** The value (already-formatted string is preferred, but accepts ReactNode). */
  readonly value: ReactNode;
  /** Optional Tailwind tone fragment applied to the value text.
   *  Defaults to `'slate'`. Used by TreeConditionSummary to tint the value
   *  to match the tier (emerald/amber/rose/slate). */
  readonly tone?: 'slate' | 'emerald' | 'amber' | 'rose' | 'sky' | 'indigo' | 'cyan';
  /** Optional sub-value shown below the value (smaller, muted). */
  readonly sub?: string;
}

// W48 (field journal): tone map re-skinned to read on parchment. The bright
// light-tone text (emerald-300 etc.) was tuned for dark slate; on cream paper
// it blows out. Darker, ink-leaning variants preserve the tone semantics
// (leaf=healthy, brass=warning, accent=critical) at readable contrast.
const TEXT_TONE: Readonly<Record<NonNullable<StatProps['tone']>, string>> = Object.freeze({
  slate: 'text-ink',
  emerald: 'text-leaf-dark',
  amber: 'text-brass-2',
  rose: 'text-accent',
  sky: 'text-sky-800',
  indigo: 'text-ink',
  cyan: 'text-teal-800',
});

/**
 * Render a Stat. Pure presentational component.
 *
 * @example
 *   <Stat label="Soil Health" value="82%" tone="emerald" sub="Rich, well-drained" />
 */
export function Stat({ label, value, tone = 'slate', sub }: StatProps): ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-ink-soft font-serif">{label}</span>
      <span className={`text-lg font-semibold tabular-nums font-serif ${TEXT_TONE[tone]}`}>{value}</span>
      {sub ? <span className="text-xs text-ink-soft font-serif italic">{sub}</span> : null}
    </div>
  );
}
