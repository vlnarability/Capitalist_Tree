/**
 * TreeConditionSummary — plain-language tree health (P5b — GDD §13.1, §13.2).
 *
 * Subscribes narrowly to the slices of `simState.originalTree` that drive
 * the simplified dashboard:
 *
 *   - `originalTree.alive` (boolean) — authoritative death signal.
 *   - `originalTree.stress` (number in [0, 1]) — drives the tier via
 *     `tierFromStress` (mirror of `tierFromHealth`).
 *   - `originalTree.foliage.currentLeaves` + `foliage.leafCapacity` — drives
 *     the foliage-density ProgressBar (visual cue the player can read at a
 *     glance, no need to know the underlying biology — GDD §13.2).
 *   - `originalTree.ageDays` — shown as a `Maturing`/`Mature`/`Ancient`
 *     summary line.
 *
 * Uses `labelForTree` (lib/format/tree.ts) to derive the plain-language
 * Healthy/Stressed/Critical/Dead tier + Tailwind tone fragment, then renders
 * the tier label + a one-line hint + a ProgressBar for foliage density. The
 * tier label doubles as the Panel's tone on the main page so the whole
 * Tree panel turns emerald / amber / rose based on condition.
 *
 * Rule 6 (rendering / UI reads state, never writes): no engine calls, no
 * dispatches. The component reads + renders; the engine owns all biological
 * decisions.
 */
'use client';

import type { ReactElement } from 'react';
import { useGameStore } from '../../stores/game-store';
import { labelForTree, clampProgress } from '../../lib/format/tree';
import { ProgressBar } from '../common/ProgressBar';
import type { Tone } from '../../lib/format/tree';

export interface TreeConditionSummaryProps {
  /** Optional className applied to the outer wrapper. */
  readonly className?: string;
}

// Tone fragment reused by Panel — we mirror the type from lib/format/tree.ts
// so the tone chain (Panel → Stat → ProgressBar) stays type-safe end-to-end.
type PanelTone = Tone;

/**
 * Coarse age-tier label for the simplified view (GDD §13.2). The age is in
 * simulated days (PROVISIONAL_DAYS_PER_YEAR = 120 sim days). The thresholds
 * are PROVISIONAL pending playtesting.
 *
 *   - < 1 sim year (120 days) → `'Sapling'` (with hint)
 *   - < 5 sim years (600 days) → `'Young'`
 *   - < 50 sim years (6000 days) → `'Maturing'`
 *   - else → `'Mature'`
 */
function ageLabel(ageDays: number): { label: string; sub: string } {
  if (!Number.isFinite(ageDays) || ageDays < 0) {
    return { label: '—', sub: '' };
  }
  const years = ageDays / 120; // PROVISIONAL_DAYS_PER_YEAR = 120
  if (years < 1) return { label: 'Sapling', sub: `${Math.floor(ageDays)} days old` };
  if (years < 5) return { label: 'Young', sub: `${years.toFixed(1)} years old` };
  if (years < 50) return { label: 'Maturing', sub: `${years.toFixed(0)} years old` };
  return { label: 'Mature', sub: `${Math.floor(years)} years old` };
}

/**
 * Render the tree-condition summary. Subscribes narrowly to the four
 * sub-slices that drive this view. Returns `null` when `simState` is null
 * (loop hasn't booted).
 */
export function TreeConditionSummary({
  className,
}: TreeConditionSummaryProps = {}): ReactElement | null {
  const alive = useGameStore((s) => s.simState?.originalTree.alive ?? null);
  const stress = useGameStore((s) => s.simState?.originalTree.stress ?? null);
  const currentLeaves = useGameStore((s) => s.simState?.originalTree.foliage.currentLeaves ?? null);
  const leafCapacity = useGameStore((s) => s.simState?.originalTree.foliage.leafCapacity ?? null);
  const ageDays = useGameStore((s) => s.simState?.originalTree.ageDays ?? null);

  // The component is mounted only when simState exists; null until then.
  if (
    alive === null ||
    stress === null ||
    currentLeaves === null ||
    leafCapacity === null ||
    ageDays === null
  ) {
    return null;
  }

  const condition = labelForTree(alive, stress);
  const density = clampProgress(
    leafCapacity > 0 ? currentLeaves / leafCapacity : 0,
  );
  const age = ageLabel(ageDays);
  // The tone propagates to the ProgressBar's fill so the bar + label agree.
  const tone = condition.tone as PanelTone;

  return (
    <div className={`flex flex-col gap-3 ${className ?? ''}`} data-testid="tree-condition">
      <div className="flex items-baseline justify-between gap-2">
        <span
          className={`text-2xl font-bold ${textClassForTone(tone)}`}
          data-testid="tree-condition-tier"
        >
          {condition.label}
        </span>
        <span className="text-xs text-slate-500">{age.label}</span>
      </div>

      <p className="text-xs text-slate-400" data-testid="tree-condition-hint">
        {condition.hint}
      </p>

      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">
            Canopy Density
          </span>
          <span className="text-xs tabular-nums text-slate-400">
            {Math.round(density * 100)}%
          </span>
        </div>
        <ProgressBar
          value={density}
          label="Tree canopy density"
          tone={tone === 'slate' ? 'slate' : tone}
        />
      </div>

      <div className="flex items-baseline justify-between text-xs">
        <span className="text-slate-500">Leaves</span>
        <span className="tabular-nums text-slate-300">
          {currentLeaves.toLocaleString()} / {leafCapacity.toLocaleString()}
        </span>
      </div>

      <div className="flex items-baseline justify-between text-xs">
        <span className="text-slate-500">Age</span>
        <span className="tabular-nums text-slate-300">{age.sub}</span>
      </div>
    </div>
  );
}

/** Map a Tone fragment to a Tailwind text colour class. */
function textClassForTone(tone: PanelTone): string {
  switch (tone) {
    case 'emerald':
      return 'text-emerald-300';
    case 'amber':
      return 'text-amber-300';
    case 'rose':
      return 'text-rose-300';
    case 'slate':
      return 'text-slate-300';
  }
}

/**
 * Convenience export: derive the tree tone for the parent Panel. The main
 * page uses this so the whole Tree panel tints to match the condition tier
 * without duplicating the derivation.
 */
export function useTreeConditionTone(): PanelTone | null {
  const alive = useGameStore((s) => s.simState?.originalTree.alive ?? null);
  const stress = useGameStore((s) => s.simState?.originalTree.stress ?? null);
  if (alive === null || stress === null) return null;
  return labelForTree(alive, stress).tone as PanelTone;
}
