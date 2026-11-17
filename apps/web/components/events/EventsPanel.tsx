/**
 * EventsPanel — P11-E (Phase 6 game-loop gap): event orchestration verbs.
 *
 * Bridges the previously-unreachable schedule-event / cancel-event /
 * trigger-event / resolve-event GameActions to the UI. Pre-P11-E Phase 6
 * event orchestration was entirely unwired (the player couldn't trigger,
 * schedule, or resolve events manually).
 *
 * Three sections:
 *   - **Trigger**: pick an event type + severity, fire immediately
 *     (dispatches `trigger-event`).
 *   - **Schedule**: pick an event type + a delay (sim days), queue it
 *     (dispatches `schedule-event`).
 *   - **Active / Scheduled**: list active events (Resolve button →
 *     `resolve-event`) + scheduled events (Cancel button → `cancel-event`).
 *
 * Advanced-view only (Phase 6 is sandbox/debug-leaning). Reads `simState` +
 * `dispatch` via narrow Zustand selectors; never touches the simulation
 * directly (rule 6).
 */
import { useState, type ReactElement } from 'react';
import { EVENT_DEFINITIONS } from '@capitalist-tree/content';
import { useGameStore } from '../../stores/game-store';
import { scheduleEvent, cancelEvent, triggerEvent, resolveEvent } from '../../lib/actions';
import { Button } from '../common/Button';
import type { EventSeverity } from '@capitalist-tree/shared';

const SEVERITIES: readonly EventSeverity[] = ['minor', 'moderate', 'severe', 'catastrophic'];
const SIM_SECONDS_PER_DAY = 86400;

export interface EventsPanelProps {
  className?: string;
}

/** Look up an event definition name by id (fallback to the id). */
function eventName(id: string): string {
  return EVENT_DEFINITIONS.find((e) => e.id === id)?.name ?? id;
}

export function EventsPanel({ className }: EventsPanelProps = {}): ReactElement | null {
  const simState = useGameStore((s) => s.simState);
  const dispatch = useGameStore((s) => s.dispatch);

  const [triggerTypeId, setTriggerTypeId] = useState(EVENT_DEFINITIONS[0]?.id ?? '');
  const [triggerSeverity, setTriggerSeverity] = useState<EventSeverity>('moderate');
  const [scheduleTypeId, setScheduleTypeId] = useState(EVENT_DEFINITIONS[0]?.id ?? '');
  const [scheduleDelayDays, setScheduleDelayDays] = useState('1');

  if (!simState) return null;

  const nowTick = simState.clock.elapsedSeconds;
  const scheduler = simState.eventState.scheduler;
  const active = scheduler.active;
  const scheduled = scheduler.scheduled;

  const onTrigger = () => {
    if (!triggerTypeId) return;
    dispatch(triggerEvent(triggerTypeId, nowTick, triggerSeverity));
  };
  const onSchedule = () => {
    if (!scheduleTypeId) return;
    const days = Number(scheduleDelayDays);
    if (!Number.isFinite(days) || days < 0) return;
    dispatch(scheduleEvent(scheduleTypeId, nowTick + days * SIM_SECONDS_PER_DAY, nowTick));
  };
  const onCancel = (eventId: string) => dispatch(cancelEvent(eventId, nowTick));
  const onResolve = (eventId: string) => dispatch(resolveEvent(eventId, nowTick));

  return (
    <section
      className={`rounded-lg border border-slate-700 bg-slate-900/60 p-4 ${className ?? ''}`}
      aria-labelledby="events-panel-title"
    >
      <h2 id="events-panel-title" className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
        Events
      </h2>

      {/* Trigger */}
      <div className="mb-4">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Trigger Now</h3>
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            value={triggerTypeId}
            onChange={(e) => setTriggerTypeId(e.target.value)}
            className="max-w-[10rem] rounded border border-slate-600 bg-slate-900 px-1.5 py-0.5 text-xs text-slate-200"
          >
            {EVENT_DEFINITIONS.map((def) => (
              <option key={def.id} value={def.id}>
                {def.name}
              </option>
            ))}
          </select>
          <select
            value={triggerSeverity}
            onChange={(e) => setTriggerSeverity(e.target.value as EventSeverity)}
            className="rounded border border-slate-600 bg-slate-900 px-1.5 py-0.5 text-xs text-slate-200"
          >
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <Button tone="warning" onClick={onTrigger}>
            Trigger
          </Button>
        </div>
      </div>

      {/* Schedule */}
      <div className="mb-4">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Schedule</h3>
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            value={scheduleTypeId}
            onChange={(e) => setScheduleTypeId(e.target.value)}
            className="max-w-[10rem] rounded border border-slate-600 bg-slate-900 px-1.5 py-0.5 text-xs text-slate-200"
          >
            {EVENT_DEFINITIONS.map((def) => (
              <option key={def.id} value={def.id}>
                {def.name}
              </option>
            ))}
          </select>
          <label className="text-[0.65rem] text-slate-500">in</label>
          <input
            type="number"
            min="0"
            step="1"
            value={scheduleDelayDays}
            onChange={(e) => setScheduleDelayDays(e.target.value)}
            className="w-16 rounded border border-slate-600 bg-slate-900 px-1.5 py-0.5 text-xs tabular-nums text-slate-200"
          />
          <span className="text-[0.65rem] text-slate-500">sim days</span>
          <Button onClick={onSchedule}>Schedule</Button>
        </div>
      </div>

      {/* Active */}
      <div className="mb-4">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
          Active {active.length > 0 && <span className="text-slate-400">({active.length})</span>}
        </h3>
        {active.length === 0 ? (
          <p className="text-xs text-slate-500">No active events.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {active.map((ev) => (
              <li
                key={ev.id}
                className="flex items-center justify-between gap-2 rounded border border-slate-700/60 bg-slate-800/40 px-3 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-slate-200">{eventName(ev.type)}</span>
                  <span className="text-xs tabular-nums text-slate-400">{ev.remaining}s remaining</span>
                </div>
                <Button tone="warning" onClick={() => onResolve(ev.id)}>
                  Resolve
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Scheduled */}
      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
          Scheduled {scheduled.length > 0 && <span className="text-slate-400">({scheduled.length})</span>}
        </h3>
        {scheduled.length === 0 ? (
          <p className="text-xs text-slate-500">No scheduled events.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {scheduled.map((ev) => {
              const delayDays = Math.max(0, (ev.scheduledAt - nowTick) / SIM_SECONDS_PER_DAY);
              return (
                <li
                  key={ev.id}
                  className="flex items-center justify-between gap-2 rounded border border-slate-700/60 bg-slate-800/40 px-3 py-1.5"
                >
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-slate-200">{eventName(ev.type)}</span>
                    <span className="text-xs tabular-nums text-slate-400">in {delayDays.toFixed(1)} sim days</span>
                  </div>
                  <Button tone="warning" onClick={() => onCancel(ev.id)}>
                    Cancel
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
