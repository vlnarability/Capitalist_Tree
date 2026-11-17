/**
 * ProgressionPanel — P11-E (Phase 5 game-loop gap).
 *
 * Bridges the previously-unreachable `unlock-research` / `activate-trait` /
 * `deactivate-trait` / `prestige-reset` GameActions to the UI. Pre-P11-E
 * Phase 5 "Generational Progression" was entirely unwired (genetic-legacy
 * points accrued but couldn't be spent; traits couldn't be toggled; prestige
 * couldn't be triggered).
 *
 * Three sections:
 *   - **Status**: genetic-legacy points + current generation.
 *   - **Research**: lists `RESEARCH_NODES` with cost + Unlock button
 *     (dispatches `unlock-research`). Disabled when prerequisites aren't met
 *     or the player can't afford the cost.
 *   - **Traits**: lists active traits with Deactivate + available traits with
 *     Activate (dispatches `activate-trait` / `deactivate-trait`).
 *   - **Prestige**: a button to start a new generation (dispatches
 *     `prestige-reset` with the current species).
 *
 * Advanced-view only (Phase 5 is endgame). Reads `simState` + `dispatch` via
 * narrow Zustand selectors; never touches the simulation directly (rule 6).
 */
import { type ReactElement } from 'react';
import { RESEARCH_NODES, GENETIC_TRAITS } from '@capitalist-tree/content';
import { useGameStore } from '../../stores/game-store';
import {
  unlockResearch,
  activateTrait,
  deactivateTrait,
  prestigeReset,
} from '../../lib/actions';
import { Button } from '../common/Button';

export interface ProgressionPanelProps {
  className?: string;
}

export function ProgressionPanel({ className }: ProgressionPanelProps = {}): ReactElement | null {
  const simState = useGameStore((s) => s.simState);
  const dispatch = useGameStore((s) => s.dispatch);

  if (!simState) return null;

  const { progression } = simState;
  const legacyPoints = BigInt(progression.prestige.geneticLegacyPoints);
  const generation = progression.prestige.currentGeneration;
  const nowTick = simState.clock.elapsedSeconds;

  // Research node state lookup (which nodes are unlocked).
  const nodeState = new Map(progression.research.nodes.map((n) => [n.id, n]));
  // Acquired traits (in activeTraits) — `active` toggles expression.
  const acquiredTraits = new Map(progression.genetics.activeTraits.map((t) => [t.traitId, t]));
  const availableTraits = progression.genetics.availableTraits;

  const onUnlock = (nodeId: string, cost: string) => {
    if (BigInt(cost) > legacyPoints) return;
    dispatch(unlockResearch(nodeId, nowTick));
  };
  const onActivate = (traitId: string) => {
    dispatch(activateTrait(traitId));
  };
  const onDeactivate = (traitId: string) => {
    dispatch(deactivateTrait(traitId));
  };
  const onPrestige = () => {
    // Start a new generation with the same species (a future UI could let the
    // player pick a new species reward).
    dispatch(prestigeReset(simState.originalTree.speciesId, nowTick));
  };

  return (
    <section
      className={`rounded-lg border border-slate-700 bg-slate-900/60 p-4 ${className ?? ''}`}
      aria-labelledby="progression-panel-title"
    >
      <h2 id="progression-panel-title" className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
        Progression
      </h2>

      {/* Status */}
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <p className="text-xs text-slate-500">Genetic Legacy</p>
          <p className="text-lg font-semibold tabular-nums text-emerald-400">{legacyPoints.toString()}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-500">Generation</p>
          <p className="text-lg font-semibold tabular-nums text-slate-200">{generation}</p>
        </div>
      </div>

      {/* Research */}
      <div className="mb-4">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Research</h3>
        <ul className="flex flex-col gap-1.5">
          {RESEARCH_NODES.map((def) => {
            const state = nodeState.get(def.id);
            const unlocked = state?.unlocked ?? false;
            const cost = BigInt(def.cost);
            const affordable = legacyPoints >= cost;
            const prereqMet = (def.prerequisites ?? []).every(
              (p) => nodeState.get(p)?.unlocked ?? false,
            );
            const canUnlock = !unlocked && affordable && prereqMet;
            return (
              <li
                key={def.id}
                className="flex items-center justify-between gap-2 rounded border border-slate-700/60 bg-slate-800/40 px-3 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-200">{def.name}</span>
                  <span className="text-xs tabular-nums text-slate-400">
                    {unlocked ? '✓ Unlocked' : `Cost ${def.cost}`}
                  </span>
                </div>
                {!unlocked && (
                  <Button tone={canUnlock ? 'active' : 'default'} disabled={!canUnlock} onClick={() => onUnlock(def.id, def.cost)}>
                    Unlock
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {/* Traits */}
      <div className="mb-4">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Traits</h3>
        <ul className="flex flex-col gap-1.5">
          {GENETIC_TRAITS.map((def) => {
            const acquired = acquiredTraits.get(def.id);
            const isAvailable = availableTraits.includes(def.id) || acquired !== undefined;
            if (!isAvailable) return null;
            const isActive = acquired?.active ?? false;
            return (
              <li
                key={def.id}
                className="flex items-center justify-between gap-2 rounded border border-slate-700/60 bg-slate-800/40 px-3 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-200">{def.name}</span>
                  <span className="text-xs text-slate-400">{isActive ? 'Active' : 'Available'}</span>
                </div>
                {isActive ? (
                  <Button tone="warning" onClick={() => onDeactivate(def.id)}>
                    Deactivate
                  </Button>
                ) : (
                  <Button tone="active" onClick={() => onActivate(def.id)}>
                    Activate
                  </Button>
                )}
              </li>
            );
          })}
          {GENETIC_TRAITS.every((def) => !availableTraits.includes(def.id) && !activeTraitIds.has(def.id)) && (
            <li className="text-xs text-slate-500">No traits acquired yet. Unlock research to acquire traits.</li>
          )}
        </ul>
      </div>

      {/* Prestige */}
      <div className="border-t border-slate-700/60 pt-3">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">New Generation</h3>
        <p className="mb-2 text-xs text-slate-500">
          Start a new generation: convert progress into genetic-legacy points + carry acquired traits forward.
        </p>
        <Button tone="warning" onClick={onPrestige}>
          Prestige (New Generation)
        </Button>
      </div>
    </section>
  );
}
