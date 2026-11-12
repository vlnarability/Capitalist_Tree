/**
 * AdvancedViewToggle — switches the dashboard between simplified and
 * advanced view (P5c — GDD §13.3 Advanced View).
 *
 * Subscribes narrowly to `ui.advancedView` (a primitive boolean). Dispatches
 * `setAdvancedView(true/false)` through the store — the mutator replaces the
 * `ui` slice and leaves `simState` referentially unchanged (rule 6: UI reads
 * state, never writes; UI mutators target the `ui` slice only).
 *
 * GDD §13.2 ("Simplified View") — the default. Players see plain-language
 * summaries ("Healthy", "Stressed", "Well-watered") without exposure to
 * nutrient ratios or photosynthetic efficiency. The toggle is the gateway
 * to the §13.3 advanced interface, which surfaces biological formulas,
 * energy allocation breakdowns, soil N/P/K, market transactions, etc.
 *
 * Rule 6 (rendering / UI reads state, never writes): the component reads
 * `ui.advancedView` and dispatches a UI mutator. It never touches
 * `simState` directly — the symmetric rule for UI: UI mutators target the
 * `ui` slice; engine mutators route through `dispatch`.
 *
 * The toggle is small enough to live in the dashboard barrel — it shares
 * the same Panel + Button primitives as SpeedControls and is rendered at
 * the top of the simulation panel.
 */
'use client';

import { useCallback, type ReactElement } from 'react';
import { useGameStore } from '../../stores/game-store';
import { Button } from '../common/Button';

export interface AdvancedViewToggleProps {
  /** Optional className applied to the outer wrapper. */
  readonly className?: string;
}

/**
 * Render the advanced-view toggle. Subscribes narrowly to `ui.advancedView`
 * (a primitive boolean — Zustand skips re-render when the value is the same)
 * and dispatches the matching mutator on click.
 *
 * Returns the toggle always — there's no `simState` dependency (UI-only
 * state). Even before the loop boots, the player can flip the toggle.
 */
export function AdvancedViewToggle({
  className,
}: AdvancedViewToggleProps = {}): ReactElement {
  // Narrow selector: primitive boolean. Zustand's `useSyncExternalStore`
  // bails out when the value is the same reference (which for primitives
  // means the same value) — so an unrelated `simState` commit does NOT
  // re-render this toggle.
  const advancedView = useGameStore((s) => s.ui.advancedView);
  const setAdvancedView = useGameStore((s) => s.setAdvancedView);

  const onToggle = useCallback(() => {
    setAdvancedView(!advancedView);
  }, [advancedView, setAdvancedView]);

  return (
    <div
      className={`flex items-center gap-2 ${className ?? ''}`}
      data-testid="advanced-view-toggle"
    >
      <Button
        tone={advancedView ? 'active' : 'default'}
        icon={advancedView ? '📊' : '🌱'}
        onClick={onToggle}
        data-testid="advanced-view-toggle-button"
        aria-pressed={advancedView}
      >
        {advancedView ? 'Advanced view' : 'Simplified view'}
      </Button>
      <span className="text-xs text-slate-500" data-testid="advanced-view-hint">
        {advancedView
          ? 'Showing biology + economy details (GDD §13.3)'
          : 'Plain-language summaries (GDD §13.2)'}
      </span>
    </div>
  );
}
