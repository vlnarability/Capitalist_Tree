/**
 * OfflineDeltaRow — presentational row for a single before → after delta
 * (P6d2 — TDD §14.4, GDD §4.2 "While You Were Away").
 *
 * Renders one line of the OfflineModal's biological / environmental / economic
 * delta tables: a human label, the before value, an arrow, the after value,
 * and a coloured delta badge (green for positive growth/health, red for
 * decline, neutral for no change). Pure presentational — no store
 * subscription, no engine calls (rule 6: UI reads state, never writes).
 *
 * The caller owns the formatting:
 *   - `before` / `after` — already-formatted display strings (e.g.
 *     `formatMoneyFromStr(...)` for cash, `42.0` for height, `82%` for health).
 *   - `deltaText` — already-formatted delta string (e.g. `+12.3`, `-$5.00`).
 *     The badge's sign is derived from `delta` (the raw number) so the colour
 *     logic stays with the row, not the caller.
 *   - `tone` — `'auto'` (default) derives the colour from `delta`'s sign;
 *     `'good'` / `'bad'` / `'neutral'` force it (used by `stress` where a
 *     positive delta is bad, and by the special "tree died" row).
 *
 * `goodTone` semantics: for most biological fields a positive delta is good
 * (growth). For `stress` a positive delta is BAD (more stress). The caller
 * passes `goodTone='inverted'` to flip the colour mapping. Defaults to
 * `'normal'` (positive = good).
 */
import type { ReactElement } from 'react';

export interface OfflineDeltaRowProps {
  /** Human-readable label for the row (e.g. "Height", "Personal Cash"). */
  readonly label: string;
  /** Formatted before value (e.g. "12.0 m", "$500.00", "82%"). */
  readonly before: string;
  /** Formatted after value. */
  readonly after: string;
  /** Formatted delta string shown in the badge (e.g. "+12.3", "-$5.00"). */
  readonly deltaText: string;
  /**
   * Raw numeric delta (`after - before`). Used to pick the badge colour. Pass
   * `0` for a no-change row; pass `NaN` only when the delta is genuinely
   * uncomputable (rare — string-delta fields pass `0` and rely on `tone`).
   */
  readonly delta: number;
  /**
   * Colour mapping. `'auto'` (default): positive delta → emerald (good),
   * negative → rose (bad), zero → slate (neutral). `'good'` / `'bad'` /
   * `'neutral'` force the colour regardless of sign (used by the special
   * "tree died" row and by fields where the sign semantics are inverted —
   * the caller computes the intended tone and passes it explicitly).
   */
  readonly tone?: 'auto' | 'good' | 'bad' | 'neutral';
  /**
   * Sign semantics for `'auto'`. `'normal'` (default): positive delta is good
   * (growth, health, cash up). `'inverted'`: positive delta is bad (stress,
   * pollution, temperature up). Ignored when `tone !== 'auto'`.
   */
  readonly goodTone?: 'normal' | 'inverted';
}

const TONE_TEXT: Readonly<Record<'good' | 'bad' | 'neutral', string>> = Object.freeze({
  good: 'text-emerald-300',
  bad: 'text-rose-300',
  neutral: 'text-slate-400',
});

const TONE_BADGE: Readonly<Record<'good' | 'bad' | 'neutral', string>> = Object.freeze({
  good: 'border-emerald-700/60 bg-emerald-500/10 text-emerald-200',
  bad: 'border-rose-700/60 bg-rose-500/10 text-rose-200',
  neutral: 'border-slate-700/60 bg-slate-700/20 text-slate-300',
});

/**
 * Resolve the effective tone from `tone` + `delta` + `goodTone`. Pure.
 */
function resolveTone(
  tone: NonNullable<OfflineDeltaRowProps['tone']>,
  delta: number,
  goodTone: NonNullable<OfflineDeltaRowProps['goodTone']>,
): 'good' | 'bad' | 'neutral' {
  if (tone !== 'auto') return tone;
  if (!Number.isFinite(delta) || delta === 0) return 'neutral';
  const positive = delta > 0;
  if (goodTone === 'inverted') return positive ? 'bad' : 'good';
  return positive ? 'good' : 'bad';
}

/**
 * Render an OfflineDeltaRow. Pure presentational component.
 *
 * @example
 *   <OfflineDeltaRow label="Height" before="12.0 m" after="14.3 m"
 *     deltaText="+2.3 m" delta={2.3} />
 *   <OfflineDeltaRow label="Stress" before="0.20" after="0.55"
 *     deltaText="+0.35" delta={0.35} goodTone="inverted" />
 */
export function OfflineDeltaRow({
  label,
  before,
  after,
  deltaText,
  delta,
  tone = 'auto',
  goodTone = 'normal',
}: OfflineDeltaRowProps): ReactElement {
  const resolved = resolveTone(tone, delta, goodTone);
  return (
    <li
      className="flex items-center justify-between gap-3 py-1 text-sm"
      data-testid={`offline-delta-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
    >
      <span className="text-slate-300">{label}</span>
      <span className="flex items-center gap-2 tabular-nums">
        <span className="text-slate-400">{before}</span>
        <span aria-hidden="true" className="text-slate-600">→</span>
        <span className={TONE_TEXT[resolved]}>{after}</span>
        <span
          className={`inline-flex min-w-[3.5rem] justify-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${TONE_BADGE[resolved]}`}
          data-testid={`offline-delta-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-badge`}
        >
          {deltaText}
        </span>
      </span>
    </li>
  );
}
