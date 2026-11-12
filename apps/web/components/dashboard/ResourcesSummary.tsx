/**
 * ResourcesSummary — soil + water + tree reserves (P5b — GDD §13.1).
 *
 * Subscribes narrowly to:
 *
 *   - `simState.world.environment.soil.health` (number in [0, 1]) — drives
 *     the soil-health ProgressBar.
 *   - `simState.world.environment.soil.soilWater` (number, litres) — current
 *     soil moisture.
 *   - `simState.originalTree.water.stored` + `water.capacity` — tree water
 *     reserves, drives a "tree hydration" ProgressBar.
 *
 * Per GDD §13.2 (simplified view), the helper exposes these as plain-language
 * summaries ("Soil Moisture", "Tree Hydration") with ProgressBars. It does
 * NOT expose nutrient concentrations (N / P / K) — those land in P5c's
 * advanced view. Same for pH, compaction, microbial activity — they exist on
 * the schema as extension points but are not surfaced here.
 *
 * Rule 6 (rendering / UI reads state, never writes): no engine calls, no
 * dispatches. The engine owns the resource balance; this component renders.
 */
'use client';

import type { ReactElement } from 'react';
import { useGameStore } from '../../stores/game-store';
import { clampProgress } from '../../lib/format/tree';
import { ProgressBar } from '../common/ProgressBar';
import { Stat } from '../common/Stat';

export interface ResourcesSummaryProps {
  /** Optional className applied to the outer wrapper. */
  readonly className?: string;
}

/**
 * Coarse moisture-tier label for the soil-water ProgressBar tone. Maps a
 * fraction of `treeWater.stored / treeWater.capacity` (or soil water
 * absolute) to a tone + short label so the player can read the bar at a
 * glance without knowing the underlying numbers.
 */
function moistureTone(fraction: number): {
  tone: 'emerald' | 'amber' | 'rose';
  label: string;
} {
  const v = clampProgress(fraction);
  if (v >= 0.6) return { tone: 'emerald', label: 'Well-watered' };
  if (v >= 0.25) return { tone: 'amber', label: 'Getting dry' };
  return { tone: 'rose', label: 'Critically low' };
}

/**
 * Render the resources summary. Subscribes narrowly to the soil + tree-water
 * slices. Returns `null` when `simState` is null (loop hasn't booted).
 */
export function ResourcesSummary({
  className,
}: ResourcesSummaryProps = {}): ReactElement | null {
  const soilHealth = useGameStore((s) => s.simState?.world.environment.soil.health ?? null);
  const soilWater = useGameStore((s) => s.simState?.world.environment.soil.soilWater ?? null);
  const treeWaterStored = useGameStore((s) => s.simState?.originalTree.water.stored ?? null);
  const treeWaterCapacity = useGameStore((s) => s.simState?.originalTree.water.capacity ?? null);

  if (
    soilHealth === null ||
    soilWater === null ||
    treeWaterStored === null ||
    treeWaterCapacity === null
  ) {
    return null;
  }

  const soilHealthClamped = clampProgress(soilHealth);
  const soilTone =
    soilHealthClamped >= 0.7
      ? ('emerald' as const)
      : soilHealthClamped >= 0.3
        ? ('amber' as const)
        : ('rose' as const);
  const soilLabel =
    soilTone === 'emerald' ? 'Healthy soil' : soilTone === 'amber' ? 'Degraded soil' : 'Poor soil';

  const treeWaterFraction =
    treeWaterCapacity > 0 ? treeWaterStored / treeWaterCapacity : 0;
  const treeMoisture = moistureTone(treeWaterFraction);

  return (
    <div className={`flex flex-col gap-3 ${className ?? ''}`} data-testid="resources-summary">
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">
            Soil Health
          </span>
          <span className="text-xs tabular-nums text-slate-400">
            {Math.round(soilHealthClamped * 100)}% · {soilLabel}
          </span>
        </div>
        <ProgressBar
          value={soilHealthClamped}
          label="Soil health"
          tone={soilTone}
        />
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">
            Tree Hydration
          </span>
          <span className="text-xs tabular-nums text-slate-400">
            {Math.round(clampProgress(treeWaterFraction) * 100)}% · {treeMoisture.label}
          </span>
        </div>
        <ProgressBar
          value={treeWaterFraction}
          label="Tree hydration"
          tone={treeMoisture.tone}
        />
      </div>

      <Stat
        label="Soil Moisture"
        value={`${Math.round(soilWater).toLocaleString()} L`}
        sub="Current soil water content"
      />
    </div>
  );
}
