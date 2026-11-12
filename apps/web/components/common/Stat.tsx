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

const TEXT_TONE: Readonly<Record<NonNullable<StatProps['tone']>, string>> = Object.freeze({
  slate: 'text-slate-100',
  emerald: 'text-emerald-300',
  amber: 'text-amber-300',
  rose: 'text-rose-300',
  sky: 'text-sky-300',
  indigo: 'text-indigo-300',
  cyan: 'text-cyan-300',
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
      <span className="text-[10px] uppercase tracking-wider text-slate-500">{label}</span>
      <span className={`text-lg font-semibold tabular-nums ${TEXT_TONE[tone]}`}>{value}</span>
      {sub ? <span className="text-xs text-slate-500">{sub}</span> : null}
    </div>
  );
}
