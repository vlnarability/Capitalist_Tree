/**
 * ObjectivesPanel — DR-8 (docs/reviews/DECISIONS.md).
 *
 * Shows the six GDD §12 "endings" objectives (Wealthiest-Being, Great-
 * Restoration, Last-Tree, Natural-Balance, Industrial-Empire, Generational-
 * Legacy) with live progress + completion status. Pre-DR-8 the objectives
 * were EVALUATED + PERSISTED (`eventState.objectives.completed`, W8) but had
 * no UI surface — a player could pursue an objective with no visible goal or
 * feedback. This panel closes that gap.
 *
 * Each objective shows:
 *   - a short title + the GDD §12 description,
 *   - a progress bar (0–100%, from `evaluateObjectives(state)`),
 *   - a status badge: Completed (in `eventState.objectives.completed` or
 *     achieved this tick) / In Progress (progress > 0) / Available (progress
 *     = 0 — not yet started).
 *
 * Read-only. Reads `simState` via a narrow Zustand selector; calls
 * `evaluateObjectives` (a pure read-only function) each render. Never touches
 * the simulation directly (rule 6). Objectives are passive — the player works
 * toward them through normal play; the panel provides direction + recognition
 * without dictating how to play (DR-8: "objectives should not turn the game
 * into a linear checklist").
 */
import { type ReactElement } from 'react';
import { evaluateObjectives, OBJECTIVE_IDS, type ObjectiveId } from '@capitalist-tree/simulation';
import { useGameStore } from '../../stores/game-store';

/** Short display titles for each objective (the descriptions are long-form). */
const OBJECTIVE_NAMES: Readonly<Record<ObjectiveId, string>> = {
  'wealthiest-being': 'Wealthiest Being',
  'great-restoration': 'Great Restoration',
  'last-tree': 'Last Tree Standing',
  'natural-balance': 'Natural Balance',
  'industrial-empire': 'Industrial Empire',
  'generational-legacy': 'Generational Legacy',
};

type ObjectiveStatus = 'completed' | 'in-progress' | 'available';

const STATUS_LABEL: Readonly<Record<ObjectiveStatus, string>> = {
  completed: 'Completed',
  'in-progress': 'In Progress',
  available: 'Available',
};

const STATUS_TONE: Readonly<Record<ObjectiveStatus, string>> = {
  completed: 'bg-emerald-100 text-emerald-800',
  'in-progress': 'bg-amber-100 text-amber-800',
  available: 'bg-slate-100 text-ink-2',
};

export interface ObjectivesPanelProps {
  className?: string;
}

export function ObjectivesPanel({ className }: ObjectivesPanelProps = {}): ReactElement | null {
  const simState = useGameStore((s) => s.simState);

  if (!simState) return null;

  const map = evaluateObjectives(simState);
  const completed = new Set(simState.eventState.objectives.completed);

  return (
    <div className={className} data-testid="objectives-panel">
      <p className="mb-3 text-xs text-ink-soft">
        Six long-term endings (GDD §12). Pursue any through play — completed
        objectives persist across save/load.
      </p>
      <ul className="space-y-3">
        {OBJECTIVE_IDS.map((id) => {
          const result = map[id];
          const isCompleted = completed.has(id) || result.achieved;
          const status: ObjectiveStatus = isCompleted
            ? 'completed'
            : result.progress > 0
              ? 'in-progress'
              : 'available';
          const pct = Math.round(result.progress * 100);
          return (
            <li
              key={id}
              data-testid={`objective-${id}`}
              className="rounded-md border border-slate-200 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-800">
                  {OBJECTIVE_NAMES[id]}
                </h3>
                <span
                  data-testid={`objective-${id}-status`}
                  className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_TONE[status]}`}
                >
                  {STATUS_LABEL[status]}
                </span>
              </div>
              <p className="mt-1 text-xs text-ink-soft">{result.description}</p>
              {/* Progress bar — 0% to 100%. Completed objectives render full. */}
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  data-testid={`objective-${id}-progress`}
                  className={`h-full rounded-full ${isCompleted ? 'bg-emerald-500' : 'bg-amber-500'}`}
                  style={{ width: `${isCompleted ? 100 : pct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
