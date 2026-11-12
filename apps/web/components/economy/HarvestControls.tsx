/**
 * HarvestControls — manual harvest UI (P5c — GDD §5.4 Harvesting, §13.3).
 *
 * GDD §5.4: "The game should expose an estimated sustainable harvest level
 * without forcing the player to follow it." This component shows the
 * sustainable-harvest estimate (re-derived from P1's
 * `estimateSustainableHarvest`) and lets the player harvest leaves manually.
 *
 * The estimate is a soft guideline — the player can:
 *   - Accept the recommended amount (default button).
 *   - Override by typing a different number into the input.
 *
 * Dispatches the `harvest-leaves` action via the store's `dispatch`. The
 * action factory `harvest(treeId, requestedLeaves)` lives in `lib/actions.ts`
 * — the engine caps the actual harvest by available foliage AND the
 * species' `maximumHarvestFraction` (so a request for 1000 leaves on a
 * 50-leaf sapling yields at most 25 leaves).
 *
 * Architecture:
 *
 *   - Rule 6 (rendering / UI reads state, never writes): the component
 *     reads tree + clock + environment slices, computes the estimate via
 *     the pure `estimateSustainableHarvest`, and dispatches a `harvest`
 *     action through the store. The engine owns the foliage mutation.
 *   - Rule 2 (purity): `estimateSustainableHarvest` is pure (P1 biology
 *     module). The BiologyContext built here is a fresh 1-day-step context
 *     (mirrors BiologyPanel) so the estimate is per-day.
 *   - TDD §16 selective UI updates: narrow selectors per slice.
 *
 * Returns `null` until `simState` is published (loop hasn't booted).
 */
'use client';

import { useCallback, useMemo, useState, type ReactElement } from 'react';
import type {
  BiologyContext,
  TreeSpecies,
} from '@capitalist-tree/simulation';
import { estimateSustainableHarvest } from '@capitalist-tree/simulation';
import type {
  EnvironmentState,
  SimulationClock,
} from '@capitalist-tree/shared';
import { findSpeciesById } from '@capitalist-tree/content';
import { useGameStore } from '../../stores/game-store';
import { harvest } from '../../lib/actions';
import { describeHarvestRecommendation } from '../../lib/format/describe';
import { Button } from '../common/Button';

const SECONDS_PER_DAY = 24 * 60 * 60;

export interface HarvestControlsProps {
  /** Optional className applied to the outer wrapper. */
  readonly className?: string;
}

/**
 * Build a per-day BiologyContext for `estimateSustainableHarvest`. The
 * function divides `maintenanceForStep(tree, ctx)` by `ctx.stepDays`, so
 * a 1-day step makes the per-day math meaningful (mirrors BiologyPanel's
 * `buildDailyContext`).
 */
function buildDailyContext(
  clock: SimulationClock,
  environment: EnvironmentState,
  species: TreeSpecies,
): BiologyContext {
  return {
    now: clock.elapsedSeconds,
    stepSeconds: SECONDS_PER_DAY,
    stepDays: 1,
    season: clock.season,
    timeOfDay: clock.timeOfDay,
    species,
    environment,
  };
}

/**
 * Render the HarvestControls. Subscribes narrowly to tree + clock +
 * environment + tree.speciesId slices. Returns `null` when simState is
 * null.
 */
export function HarvestControls({
  className,
}: HarvestControlsProps = {}): ReactElement | null {
  const tree = useGameStore((s) => s.simState?.originalTree ?? null);
  const clock = useGameStore((s) => s.simState?.clock ?? null);
  const environment = useGameStore((s) => s.simState?.world.environment ?? null);
  const dispatch = useGameStore((s) => s.dispatch);

  const speciesId = tree?.speciesId ?? null;
  const species = useMemo<TreeSpecies | null>(() => {
    if (!speciesId) return null;
    return findSpeciesById(speciesId) ?? null;
  }, [speciesId]);

  // Re-derive the sustainable estimate whenever the input slices change.
  // Pure: `estimateSustainableHarvest` is a pure biology function —
  // given (tree, ctx) it returns the same estimate for the same inputs.
  const estimate = useMemo(() => {
    if (!tree || !clock || !environment || !species) return null;
    const ctx = buildDailyContext(clock, environment, species);
    return estimateSustainableHarvest(tree, ctx);
  }, [tree, clock, environment, species]);

  // Local input state — the player's chosen harvest amount. Defaults to
  // the recommended amount; updates if the estimate changes (e.g. the
  // tree grew, conditions improved) as long as the player hasn't typed an
  // override.
  const recommended = estimate?.leavesPerDay ?? 0;
  const [override, setOverride] = useState<string | null>(null);

  // Re-sync the input to the recommended amount whenever the estimate
  // changes AND the player hasn't typed an override. We compare against
  // the parsed override (if non-null + non-empty + parses to a number, the
  // player owns the field; otherwise we mirror the estimate).
  const inputValue = useMemo(() => {
    if (override !== null && override !== '' && /^\d+$/.test(override)) {
      return override;
    }
    return String(recommended);
  }, [override, recommended]);

  // Clear the override when the estimate changes drastically (e.g. tree
  // grew substantially, dropping the recommended by half). This is purely
  // a UX nicety — the player still has the input + Accept button to
  // re-override.
  // (Implemented as: when `recommended` changes, the input re-renders
  // with the new value if the override is empty. We don't forcibly clear
  // a typed override — that would feel jarring.)

  const requestedNumber = (() => {
    const n = Number.parseInt(inputValue, 10);
    if (!Number.isInteger(n) || n < 0) return 0;
    return n;
  })();

  const recommendation = describeHarvestRecommendation(requestedNumber, recommended);

  const onAcceptRecommended = useCallback(() => {
    setOverride(String(recommended));
  }, [recommended]);

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setOverride(e.target.value);
    },
    [],
  );

  const onHarvest = useCallback(() => {
    if (!tree) return;
    // Engine caps to foliage + species.maximumHarvestFraction, so a request
    // for more than possible yields the actual harvested count. Safe to
    // dispatch the player's full request.
    if (requestedNumber <= 0) return;
    dispatch(harvest(tree.id, requestedNumber));
    // Reset the override after a successful dispatch so the input snaps
    // back to the recommended amount for the next harvest.
    setOverride(null);
  }, [dispatch, requestedNumber, tree]);

  if (tree === null || clock === null || environment === null) return null;
  if (!species || !estimate) {
    return (
      <div className={className ?? ''} data-testid="harvest-controls">
        <p className="text-xs text-slate-500">Harvest estimate unavailable.</p>
      </div>
    );
  }

  const maxHarvest = Math.floor(
    tree.foliage.currentLeaves * species.maximumHarvestFraction,
  );

  return (
    <div
      className={`flex flex-col gap-3 ${className ?? ''}`}
      data-testid="harvest-controls"
    >
      <div
        className="rounded border border-emerald-800/40 bg-emerald-900/10 p-3"
        data-testid="harvest-recommendation"
      >
        <span className="text-[10px] uppercase tracking-wider text-slate-500">
          Sustainable estimate (GDD §5.4)
        </span>
        <div className="mt-1 flex items-baseline justify-between">
          <span className="text-2xl font-bold tabular-nums text-emerald-300" data-testid="harvest-recommended">
            {recommended}
          </span>
          <span className="text-xs text-slate-500">leaves / day</span>
        </div>
        <p className="mt-1 text-xs text-slate-400" data-testid="harvest-recommendation-summary">
          {recommendation.summary}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="harvest-amount"
          className="text-[10px] uppercase tracking-wider text-slate-500"
        >
          Harvest amount (leaves)
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="harvest-amount"
            type="number"
            min={0}
            max={maxHarvest}
            step={1}
            value={inputValue}
            onChange={onInputChange}
            className="w-32 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100 tabular-nums focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50"
            data-testid="harvest-input"
          />
          <Button
            tone="default"
            onClick={onAcceptRecommended}
            data-testid="harvest-accept-recommended"
          >
            Accept recommended
          </Button>
        </div>
        <p className="text-[11px] text-slate-500">
          Max per harvest: {maxHarvest} leaves (50% of current foliage). Engine caps higher requests.
        </p>
      </div>

      <Button
        tone="active"
        icon="🍃"
        onClick={onHarvest}
        disabled={!tree.alive || requestedNumber <= 0}
        data-testid="harvest-button"
      >
        Harvest {requestedNumber > 0 ? requestedNumber : ''} leaves
      </Button>

      {!tree.alive ? (
        <p className="text-xs text-rose-400/80" data-testid="harvest-dead-warning">
          A dead tree has no live leaves to harvest.
        </p>
      ) : null}

      <p className="text-xs text-slate-500" data-testid="harvest-hint">
        Each harvested leaf carries its species denomination
        ({species.leafDenominationMinor} minor units) and induces a small
        stress bump. Repeated severe defoliation raises mortality risk
        (GDD §5.6).
      </p>
    </div>
  );
}
