/**
 * ActiveAutomationRow — presentational row for one active automation entry
 * (P6d1 — TDD §12, GDD §9).
 *
 * Renders the automation's equipment name (looked up by the parent via
 * `getEquipmentById`), target, enabled toggle (dispatches
 * `enable-automation` / `disable-automation`), policy summary, last-run
 * stamp, cooldown remaining, and an expandable "Configure Policy" section
 * that mounts the `PolicyConfigurator`.
 *
 * The row is presentational: it receives pre-formatted strings (policy
 * summary, last-run label, cooldown remaining) + callbacks for the actions
 * it can trigger. The parent `AutomationPanel` owns the dispatch + the
 * selector-derived data (rule 6: UI reads state, never writes — the row's
 * clicks route through the parent's callbacks).
 */
'use client';

import { useState, type ReactElement } from 'react';
import type { AutomationState, EquipmentDefinition } from '@capitalist-tree/shared';
import type { AutomationPolicy } from '@capitalist-tree/shared';
import { Button } from '../common/Button';
import { PolicyConfigurator } from './PolicyConfigurator';

export interface ActiveAutomationRowProps {
  /** The automation state entry. */
  readonly automation: AutomationState;
  /** The automation's underlying equipment (undefined for legacy entries). */
  readonly equipment: EquipmentDefinition | undefined;
  /** Pre-formatted one-line policy summary (from `formatPolicySummary`). */
  readonly policySummary: string;
  /** Pre-formatted last-run label (e.g. "Day 2, 01:00" or "Never"). */
  readonly lastRunLabel: string;
  /** Cooldown remaining in sim seconds (0 when ready). */
  readonly cooldownRemaining: number;
  /** Called when the player toggles enabled. Receives (id, newEnabled). */
  readonly onToggleEnabled: (automationId: string, enabled: boolean) => void;
  /** Called when the player saves a new policy. */
  readonly onSetPolicy: (automationId: string, policy: AutomationPolicy) => void;
}

/**
 * Render an ActiveAutomationRow. Local state only for the expand/collapse of
 * the Configure Policy section.
 */
export function ActiveAutomationRow({
  automation,
  equipment,
  policySummary,
  lastRunLabel,
  cooldownRemaining,
  onToggleEnabled,
  onSetPolicy,
}: ActiveAutomationRowProps): ReactElement {
  const [configuring, setConfiguring] = useState(false);

  const name = equipment?.name ?? automation.type;
  const supportsPolicyConfig =
    equipment === undefined || equipment.supportedPolicies.length > 0;

  return (
    <li
      className="flex flex-col gap-1.5 rounded border border-slate-800/60 bg-slate-900/40 p-3"
      data-testid={`automation-row-${automation.id}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span
            className="text-sm font-semibold text-slate-100"
            data-testid={`automation-row-${automation.id}-name`}
          >
            {name}
          </span>
          {equipment ? (
            <span className="text-[10px] uppercase tracking-wider text-slate-500">
              {equipment.category} · tier {equipment.tier}
            </span>
          ) : (
            <span className="text-[10px] uppercase tracking-wider text-amber-400/70">
              unknown equipment
            </span>
          )}
        </div>
        <Button
          tone={automation.enabled ? 'active' : 'warning'}
          onClick={() => onToggleEnabled(automation.id, !automation.enabled)}
          data-testid={`automation-row-${automation.id}-toggle`}
          aria-pressed={automation.enabled}
          aria-label={automation.enabled ? 'Pause automation' : 'Enable automation'}
        >
          {automation.enabled ? 'Enabled' : 'Paused'}
        </Button>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
        <span data-testid={`automation-row-${automation.id}-target`}>
          Target {automation.targetId}
        </span>
        <span data-testid={`automation-row-${automation.id}-policy`}>
          {policySummary}
        </span>
        <span data-testid={`automation-row-${automation.id}-lastrun`}>
          Last run {lastRunLabel}
        </span>
        <span data-testid={`automation-row-${automation.id}-cooldown`}>
          Cooldown {cooldownRemaining}s
        </span>
      </div>

      {supportsPolicyConfig ? (
        <div className="mt-1">
          {configuring ? (
            <PolicyConfigurator
              automation={automation}
              equipment={equipment}
              onSubmit={(id, policy) => {
                onSetPolicy(id, policy);
                setConfiguring(false);
              }}
              onCancel={() => setConfiguring(false)}
            />
          ) : (
            <Button
              tone="default"
              onClick={() => setConfiguring(true)}
              data-testid={`automation-row-${automation.id}-configure`}
            >
              Configure Policy
            </Button>
          )}
        </div>
      ) : null}
    </li>
  );
}
