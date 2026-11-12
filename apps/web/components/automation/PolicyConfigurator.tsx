/**
 * PolicyConfigurator — sub-form for editing an automation's policy
 * (P6d1 — TDD §12, GDD §9).
 *
 * A pure component that manages local form state for the two configurable
 * policy kinds the spec calls out:
 *   - `threshold`: field input + op select + value input.
 *   - `schedule`: interval (sim seconds) input.
 *
 * Event policies are not editable here (the `eventType` is content-driven);
 * the configurator only renders threshold / schedule forms based on the
 * equipment's `supportedPolicies`.
 *
 * On submit, the configurator builds an `AutomationPolicy` and calls
 * `onSubmit(automationId, policy)` — the parent dispatches the
 * `set-automation-policy` action. The configurator never dispatches directly
 * (rule 6: UI reads state, never writes — the parent owns the dispatch path).
 *
 * The form is deliberately minimal: field is a free-text dotted path (the
 * AutomationSystem resolves it), op is a select over the schema's operator
 * enum, value is a number. Validation is boundary-level (non-empty field,
 * parseable value); the engine re-validates via the schema + content gate.
 */
'use client';

import { useState, type ReactElement } from 'react';
import type {
  AutomationPolicy,
  AutomationState,
  EquipmentDefinition,
} from '@capitalist-tree/shared';
import type { AutomationThresholdOperator } from '@capitalist-tree/shared';
import { Button } from '../common/Button';

export interface PolicyConfiguratorProps {
  /** The automation being configured. */
  readonly automation: AutomationState;
  /** The automation's underlying equipment (may be undefined for legacy). */
  readonly equipment: EquipmentDefinition | undefined;
  /** Called with the new policy on submit. */
  readonly onSubmit: (automationId: string, policy: AutomationPolicy) => void;
  /** Called when the player cancels editing. */
  readonly onCancel: () => void;
}

const OPERATORS: readonly AutomationThresholdOperator[] = ['<', '<=', '>', '>=', '=='];

const SECONDS_PER_DAY = 24 * 60 * 60;

/**
 * Default field path for a threshold policy on irrigation / fertilization
 * equipment. Falls back to a generic soil-water path. Pure heuristic — the
 * player can override.
 */
function defaultField(equipment: EquipmentDefinition | undefined): string {
  if (!equipment) return 'world.environment.soil.soilWater';
  if (equipment.category === 'fertilization') {
    return 'world.environment.soil.nutrients.nitrogen';
  }
  return 'world.environment.soil.soilWater';
}

/** Default action for an equipment category (matches supportedActions[0]). */
function defaultAction(equipment: EquipmentDefinition | undefined): string {
  if (equipment && equipment.supportedActions.length > 0) {
    return equipment.supportedActions[0]!;
  }
  return 'apply-water';
}

/**
 * Render the PolicyConfigurator. Local state initialises from the automation's
 * existing policy (if any) so editing is non-destructive.
 */
export function PolicyConfigurator({
  automation,
  equipment,
  onSubmit,
  onCancel,
}: PolicyConfiguratorProps): ReactElement {
  const existing = automation.policy;
  const supported = equipment?.supportedPolicies ?? ['threshold', 'schedule'];

  // Pick the initial kind: the existing policy's kind if supported, else the
  // first supported kind (prefer threshold, then schedule).
  const initialKind: 'threshold' | 'schedule' =
    existing?.kind === 'threshold' && supported.includes('threshold')
      ? 'threshold'
      : existing?.kind === 'schedule' && supported.includes('schedule')
        ? 'schedule'
        : supported.includes('threshold')
          ? 'threshold'
          : 'schedule';

  const [kind, setKind] = useState<'threshold' | 'schedule'>(initialKind);

  // Threshold form state.
  const [field, setField] = useState<string>(
    existing?.kind === 'threshold' ? existing.condition.field : defaultField(equipment),
  );
  const [op, setOp] = useState<AutomationThresholdOperator>(
    existing?.kind === 'threshold' ? existing.condition.op : '<',
  );
  const [valueStr, setValueStr] = useState<string>(
    existing?.kind === 'threshold' ? String(existing.condition.value) : '0.3',
  );

  // Schedule form state (interval seconds; default 1 sim day).
  const [intervalStr, setIntervalStr] = useState<string>(
    existing?.kind === 'schedule' && existing.condition.kind === 'interval'
      ? String(existing.condition.value)
      : String(SECONDS_PER_DAY),
  );

  const action = existing?.action ?? defaultAction(equipment);
  const actionParams = existing?.actionParams ?? {};

  const canSubmitThreshold = field.trim().length > 0 && /^-?\d+(\.\d+)?$/.test(valueStr);
  const canSubmitSchedule = /^\d+$/.test(intervalStr) && Number.parseInt(intervalStr, 10) > 0;

  const handleSubmit = (): void => {
    if (kind === 'threshold') {
      if (!canSubmitThreshold) return;
      const value = Number.parseFloat(valueStr);
      const policy: AutomationPolicy = {
        kind: 'threshold',
        condition: { field: field.trim(), op, value },
        action,
        actionParams,
      };
      onSubmit(automation.id, policy);
    } else {
      if (!canSubmitSchedule) return;
      const value = Number.parseInt(intervalStr, 10);
      const policy: AutomationPolicy = {
        kind: 'schedule',
        condition: { kind: 'interval', value },
        action,
        actionParams,
      };
      onSubmit(automation.id, policy);
    }
  };

  return (
    <div
      className="mt-2 flex flex-col gap-2 rounded border border-slate-800/60 bg-slate-950/40 p-3"
      data-testid={`policy-configurator-${automation.id}`}
    >
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-wider text-slate-500">
          Configure policy
        </span>
        <div className="flex gap-1">
          {supported.includes('threshold') ? (
            <Button
              tone={kind === 'threshold' ? 'active' : 'default'}
              onClick={() => setKind('threshold')}
              data-testid={`policy-kind-threshold-${automation.id}`}
            >
              Threshold
            </Button>
          ) : null}
          {supported.includes('schedule') ? (
            <Button
              tone={kind === 'schedule' ? 'active' : 'default'}
              onClick={() => setKind('schedule')}
              data-testid={`policy-kind-schedule-${automation.id}`}
            >
              Schedule
            </Button>
          ) : null}
        </div>
      </div>

      {kind === 'threshold' ? (
        <div className="flex flex-col gap-1.5" data-testid={`policy-threshold-form-${automation.id}`}>
          <label className="text-[10px] uppercase tracking-wider text-slate-500">
            Field (dotted state path)
          </label>
          <input
            type="text"
            value={field}
            onChange={(e) => setField(e.target.value)}
            className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100 focus:border-sky-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50"
            data-testid={`policy-field-${automation.id}`}
          />
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-[10px] uppercase tracking-wider text-slate-500">Op</label>
            <select
              value={op}
              onChange={(e) => setOp(e.target.value as AutomationThresholdOperator)}
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100 focus:border-sky-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50"
              data-testid={`policy-op-${automation.id}`}
            >
              {OPERATORS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            <label className="text-[10px] uppercase tracking-wider text-slate-500">Value</label>
            <input
              type="number"
              step="any"
              value={valueStr}
              onChange={(e) => setValueStr(e.target.value)}
              className="w-28 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100 tabular-nums focus:border-sky-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50"
              data-testid={`policy-value-${automation.id}`}
            />
          </div>
          <p className="text-[11px] text-slate-500">
            Fractional values in (0, 1] render as a percentage in the summary.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5" data-testid={`policy-schedule-form-${automation.id}`}>
          <label className="text-[10px] uppercase tracking-wider text-slate-500">
            Interval (sim seconds; 86400 = 1 sim day)
          </label>
          <input
            type="number"
            min={1}
            step={1}
            value={intervalStr}
            onChange={(e) => setIntervalStr(e.target.value)}
            className="w-32 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100 tabular-nums focus:border-sky-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50"
            data-testid={`policy-interval-${automation.id}`}
          />
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button tone="default" onClick={onCancel} data-testid={`policy-cancel-${automation.id}`}>
          Cancel
        </Button>
        <Button
          tone="active"
          onClick={handleSubmit}
          disabled={kind === 'threshold' ? !canSubmitThreshold : !canSubmitSchedule}
          data-testid={`policy-submit-${automation.id}`}
        >
          Save policy
        </Button>
      </div>
    </div>
  );
}
