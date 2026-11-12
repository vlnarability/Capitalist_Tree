/**
 * ProgressBar — value-driven progress bar (P5b — GDD §13.1 dashboard).
 *
 * Renders a horizontal bar with a filled portion scaled to the `value` prop
 * (in [0, 1]). Used by TreeConditionSummary (foliage density + tree health)
 * and ResourcesSummary (soil water, soil health) to show continuous metrics
 * without exposing raw numbers (GDD §13.2 — simplified view).
 *
 * The bar's filled portion is tinted by the `tone` prop so the dashboard can
 * colour health bars emerald, stress bars amber, etc. without owning the
 * colour logic — the caller picks the tone based on the value's tier.
 *
 * Accessibility: the bar carries `role="progressbar"` + `aria-valuenow` /
 * `aria-valuemin` / `aria-valuemax` so screen readers announce the value.
 * The label is provided via `aria-label` so the bar is self-describing.
 *
 * Rule 6 (rendering / UI reads state, never writes): no store subscription,
 * no engine calls. Pure presentational component.
 */
import type { ReactElement } from 'react';
import { clampProgress } from '../../lib/format/tree';

export interface ProgressBarProps {
  /** Value in [0, 1]. Clamped + NaN-safe (see {@link clampProgress}). */
  readonly value: number;
  /** Accessible label — required for screen readers. */
  readonly label: string;
  /** Tailwind tone fragment for the filled portion. Defaults to `'slate'`. */
  readonly tone?: 'slate' | 'emerald' | 'amber' | 'rose' | 'sky' | 'indigo' | 'cyan';
  /** Optional className applied to the outer wrapper. */
  readonly className?: string;
}

const FILL_TONE: Readonly<Record<NonNullable<ProgressBarProps['tone']>, string>> = Object.freeze({
  slate: 'bg-slate-500',
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  sky: 'bg-sky-500',
  indigo: 'bg-indigo-500',
  cyan: 'bg-cyan-500',
});

/**
 * Render a ProgressBar. Pure presentational component.
 *
 * @example
 *   <ProgressBar value={0.82} label="Soil Health" tone="emerald" />
 */
export function ProgressBar({ value, label, tone = 'slate', className }: ProgressBarProps): ReactElement {
  const clamped = clampProgress(value);
  const percent = Math.round(clamped * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      className={[
        'h-2 w-full overflow-hidden rounded-full bg-slate-800/80',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-300 ${FILL_TONE[tone]}`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
