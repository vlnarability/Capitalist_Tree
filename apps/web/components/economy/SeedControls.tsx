/**
 * SeedControls — the seed production → planting UI (GAP-19 / GDD §11.2 Genetic
 * Legacy). Shows the tree's accumulated seed count + the lineage's genetic-
 * legacy points (the prestige currency funding `unlock-research`), + a button to
 * plant a seed (consume one → credit `PROGRESSION_LEGACY_POINTS_PER_SEED`
 * points).
 *
 * The seed PRODUCTION (seed-dispersed, fed by `alloc.reproduction`, gated on the
 * fruiting age) is driven by the BiologySystem; this component is the PLANTING
 * half — the player spends accumulated seeds for mid-generation genetic-legacy
 * points (a supplement to the generation-end prestige bonus from prestige-reset).
 *
 * Architecture: Rule 6 (rendering / UI reads state, never writes) — reads the
 * tree + progression + clock slices, dispatches a `plant-seed` action through
 * the store. The engine owns the seed-decrement + points-credit. Returns null
 * until simState is published.
 *
 * @see reproduction.test.ts (seed production) + plant-seed-action.test.ts (the
 *      action handler this component dispatches).
 */
'use client';

import { useCallback, type ReactElement } from 'react';
import { useGameStore } from '../../stores/game-store';
import { plantSeed } from '../../lib/actions';
import { Button } from '../common/Button';

export interface SeedControlsProps {
  /** Optional className applied to the outer wrapper. */
  readonly className?: string;
}

/**
 * Render the SeedControls. Subscribes narrowly to tree + progression.prestige +
 * clock.elapsedSeconds slices. Returns `null` when simState is null.
 */
export function SeedControls({ className }: SeedControlsProps = {}): ReactElement | null {
  const tree = useGameStore((s) => s.simState?.originalTree ?? null);
  const geneticLegacyPoints = useGameStore(
    (s) => s.simState?.progression.prestige.geneticLegacyPoints ?? '0',
  );
  const elapsed = useGameStore((s) => s.simState?.clock.elapsedSeconds ?? 0);
  const dispatch = useGameStore((s) => s.dispatch);

  const onPlant = useCallback(() => {
    if (!tree) return;
    dispatch(plantSeed(tree.id, elapsed));
  }, [dispatch, tree, elapsed]);

  if (!tree) return null;

  const seeds = tree.seeds;

  return (
    <div className={`flex flex-col gap-3 ${className ?? ''}`} data-testid="seed-controls">
      <div className="rounded border border-amber-800/40 bg-amber-900/10 p-3">
        <span className="text-[10px] uppercase tracking-wider text-ink-soft">
          Seeds · Genetic legacy (GDD §11.2)
        </span>
        <div className="mt-1 flex items-baseline justify-between">
          <span className="text-2xl font-bold tabular-nums text-brass-2" data-testid="seed-count">
            {seeds}
          </span>
          <span className="text-xs text-ink-soft">seeds ready to plant</span>
        </div>
        <p className="mt-1 text-xs text-ink-2" data-testid="seed-legacy-balance">
          Genetic-legacy points: {geneticLegacyPoints}
        </p>
      </div>

      <Button
        tone="active"
        icon="🌰"
        onClick={onPlant}
        disabled={seeds < 1}
        data-testid="plant-seed-button"
      >
        Plant a seed
      </Button>

      {seeds < 1 ? (
        <p className="text-xs text-ink-soft" data-testid="seed-empty-hint">
          The tree has no seeds yet. A tree past its fruiting age produces seeds
          over time (the BiologySystem seed-dispersed flow, fed by
          alloc.reproduction) — wait for it to mature + fruit.
        </p>
      ) : (
        <p className="text-xs text-ink-soft" data-testid="seed-hint">
          Planting a seed consumes one + grants genetic-legacy points (the
          prestige currency that funds unlock-research). A dead tree&apos;s stored
          seeds remain plantable — the genetic legacy persists.
        </p>
      )}
    </div>
  );
}
