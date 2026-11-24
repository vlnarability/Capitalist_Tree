'use client';
import type { ReactElement } from 'react';
import { useGameStore, selectSustainabilityScore } from '../../stores/game-store';
import { fontTierForScore, TIER_LABELS } from '../../lib/aesthetic/fonts';

/**
 * W51 — the stewardship meter. A compact readout in the page header showing
 * the sustainability score (0–10) as 10 pips + a numeric `score/10` + the tier
 * label (Exploitation / Balanced / Sustainability). The pip + number color
 * follows `--ct-steward` (piecewise red → brass → green), so the meter is the
 * single place the stewardship signal is visible — the rest of the app re-
 * themes via the parchment/ink/leaf vars.
 *
 * Returns `null` before boot (simState null) so the header layout is stable
 * during the loading state.
 */
export function AestheticMeter(): ReactElement | null {
  const score = useGameStore(selectSustainabilityScore);
  if (score == null) return null;
  const tier = fontTierForScore(score);
  return (
    <div
      data-testid="aesthetic-meter"
      data-aesthetic-tier={tier}
      className="flex flex-col items-end gap-1"
      title={`Stewardship ${score}/10 — ${TIER_LABELS[tier]}`}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-journal uppercase tracking-wider text-ink-soft smallcaps">
          Stewardship
        </span>
        <span className="font-journal text-sm font-bold text-steward tabular-nums">
          {score}/10
        </span>
      </div>
      {/* 10 pips — filled up to `score`, colored by the steward var. */}
      <div
        className="flex items-center gap-0.5"
        role="img"
        aria-label={`Stewardship score ${score} of 10`}
      >
        {Array.from({ length: 10 }, (_, i) => (
          <span
            key={i}
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              i < score ? 'bg-steward' : 'bg-ink/20'
            }`}
          />
        ))}
      </div>
      <span className="text-[10px] font-journal uppercase tracking-wider text-ink-soft">
        {TIER_LABELS[tier]}
      </span>
    </div>
  );
}
