/**
 * AutomationPanel — main automation UI (P6d1 — GDD §9 "Automation and
 * Technology", TDD §12 "Automation engine").
 *
 * Two sections:
 *
 *   1. **Equipment Shop** — lists every registered `EquipmentDefinition`
 *      (from `@capitalist-tree/content`'s `EQUIPMENT`) grouped by category
 *      (irrigation / fertilization / harvesting / monitoring / energy — GDD
 *      §9). Each item renders via `EquipmentCard`; the Purchase button
 *      dispatches `purchase-equipment` with `targetId = originalTree.id`.
 *      Affordability is pre-flighted via `getAffordableEquipment` (the engine
 *      re-checks at dispatch time).
 *
 *   2. **Active Automations** — lists `state.automation` entries joined with
 *      their equipment via `getAutomationWithEquipment`. Each renders via
 *      `ActiveAutomationRow` (equipment name, target, enabled toggle, policy
 *      summary, last-run, cooldown, Configure Policy). Toggles dispatch
 *      `enable-automation` / `disable-automation`; the policy configurator
 *      dispatches `set-automation-policy`.
 *
 * Empty state: when `state.automation` is empty, the Active Automations
 * section shows "No automation purchased yet. Buy equipment from the shop
 * above."
 *
 * Architecture:
 *   - Rule 6 (TDD §15.1, GDD §6.1): rendering / UI reads state, NEVER writes.
 *     The panel reads `state.automation` + `state.player.personalCash` +
 *     `state.originalTree.id` + `state.clock` via narrow Zustand selectors
 *     and dispatches actions only through `useGameStore.getState().dispatch`.
 *     It NEVER runs simulation logic directly — the AutomationSystem (P6b2)
 *     owns policy evaluation + execution (TDD §12: "rendering layer should
 *     not execute automation independently").
 *   - Rule 2 (purity): the selector helpers in `lib/selectors/automation.ts`
 *     are pure; the panel's render is a pure function of its subscribed
 *     slices.
 *   - TDD §16 selective UI updates: narrow selectors per slice.
 *
 * Returns `null` until `simState` is published (loop hasn't booted).
 */
'use client';

import { useCallback, useMemo, type ReactElement } from 'react';
import type { EquipmentCategory, EquipmentDefinition } from '@capitalist-tree/shared';
import { EQUIPMENT } from '@capitalist-tree/content';
import { useGameStore } from '../../stores/game-store';
import {
  disableAutomation,
  enableAutomation,
  purchaseEquipment,
  setAutomationPolicy,
} from '../../lib/actions';
import {
  formatMoneyFromStr,
} from '../../lib/format/money';
import {
  formatPolicySummary,
  getAffordableEquipment,
  getAutomationWithEquipment,
  getCooldownRemaining,
} from '../../lib/selectors/automation';
import { EquipmentCard } from './EquipmentCard';
import { ActiveAutomationRow } from './ActiveAutomationRow';

/** Category display order (GDD §9 initial → advanced → energy). */
const CATEGORY_ORDER: readonly EquipmentCategory[] = [
  'irrigation',
  'fertilization',
  'harvesting',
  'monitoring',
  'energy',
];

/** Human label for a category header. */
const CATEGORY_LABEL: Readonly<Record<EquipmentCategory, string>> = Object.freeze({
  irrigation: 'Irrigation',
  fertilization: 'Fertilization',
  harvesting: 'Harvesting',
  monitoring: 'Monitoring',
  energy: 'Energy',
});

const SECONDS_PER_DAY = 24 * 60 * 60;

/**
 * Format a last-run sim-seconds stamp as "Day N, HH:MM" (or "Never" when 0).
 * Mirrors the TransactionsPanel's sim-day stamp derivation. Pure.
 */
function formatLastRun(lastRunAt: number | undefined): string {
  if (lastRunAt === undefined || lastRunAt <= 0) return 'Never';
  const day = Math.floor(lastRunAt / SECONDS_PER_DAY) + 1;
  const secondsInDay = lastRunAt % SECONDS_PER_DAY;
  const hours = Math.floor(secondsInDay / 3600);
  const minutes = Math.floor((secondsInDay % 3600) / 60);
  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  return `Day ${day}, ${hh}:${mm}`;
}

export interface AutomationPanelProps {
  /** Optional className applied to the outer wrapper. */
  readonly className?: string;
}

/**
 * Render the AutomationPanel. Subscribes narrowly to automation + cash +
 * tree id + clock + dispatch. Returns `null` when `simState` is null.
 */
export function AutomationPanel({
  className,
}: AutomationPanelProps = {}): ReactElement | null {
  const automation = useGameStore((s) => s.simState?.automation ?? null);
  const personalCash = useGameStore(
    (s) => s.simState?.player.personalCash ?? null,
  );
  const treeId = useGameStore((s) => s.simState?.originalTree.id ?? null);
  const clock = useGameStore((s) => s.simState?.clock ?? null);
  const dispatch = useGameStore((s) => s.dispatch);

  // Equipment grouped by category — memoised so a cash change (which flips
  // affordability) doesn't re-group. The grouping depends only on `EQUIPMENT`
  // (static content), so it's stable across renders.
  const grouped = useMemo(() => {
    const map = new Map<EquipmentCategory, EquipmentDefinition[]>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const e of EQUIPMENT) {
      const list = map.get(e.category);
      if (list) list.push(e);
    }
    return map;
  }, []);

  // Affordable set — re-derived whenever personalCash changes. Pure selector.
  const affordableIds = useMemo(() => {
    if (personalCash === null) return new Set<string>();
    const state = {
      player: { personalCash },
    } as unknown as Parameters<typeof getAffordableEquipment>[0];
    return new Set(getAffordableEquipment(state).map((e) => e.id));
  }, [personalCash]);

  // Joined automation + equipment — re-derived whenever automation changes.
  const joined = useMemo(() => {
    if (automation === null) return [];
    const state = { automation } as unknown as Parameters<
      typeof getAutomationWithEquipment
    >[0];
    return getAutomationWithEquipment(state);
  }, [automation]);

  const onPurchase = useCallback(
    (equipmentId: string) => {
      if (!treeId) return;
      dispatch(purchaseEquipment(equipmentId, treeId));
    },
    [dispatch, treeId],
  );

  const onToggleEnabled = useCallback(
    (automationId: string, enabled: boolean) => {
      dispatch(enabled ? enableAutomation(automationId) : disableAutomation(automationId));
    },
    [dispatch],
  );

  const onSetPolicy = useCallback(
    (automationId: string, policy: Parameters<typeof setAutomationPolicy>[1]) => {
      dispatch(setAutomationPolicy(automationId, policy));
    },
    [dispatch],
  );

  if (automation === null || personalCash === null || treeId === null || clock === null) {
    return null;
  }

  return (
    <div
      className={`flex flex-col gap-4 ${className ?? ''}`}
      data-testid="automation-panel"
    >
      {/* Equipment shop. */}
      <section className="flex flex-col gap-2" data-testid="automation-shop">
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">
            Equipment shop ({EQUIPMENT.length})
          </span>
          <span className="text-xs tabular-nums text-slate-300" data-testid="automation-cash">
            Cash {formatMoneyFromStr(personalCash)}
          </span>
        </div>
        {CATEGORY_ORDER.map((cat) => {
          const items = grouped.get(cat) ?? [];
          if (items.length === 0) return null;
          return (
            <div key={cat} className="flex flex-col gap-1.5" data-testid={`automation-shop-${cat}`}>
              <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                {CATEGORY_LABEL[cat]}
              </span>
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {items.map((e) => (
                  <EquipmentCard
                    key={e.id}
                    equipment={e}
                    affordable={affordableIds.has(e.id)}
                    onPurchase={onPurchase}
                  />
                ))}
              </ul>
            </div>
          );
        })}
      </section>

      {/* Active automations. */}
      <section className="flex flex-col gap-2" data-testid="automation-active">
        <span className="text-[10px] uppercase tracking-wider text-slate-500">
          Active automations ({joined.length})
        </span>
        {joined.length === 0 ? (
          <p
            className="text-xs text-slate-500"
            data-testid="automation-empty"
          >
            No automation purchased yet. Buy equipment from the shop above.
          </p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="automation-list">
            {joined.map(({ automation: a, equipment: eq }) => (
              <ActiveAutomationRow
                key={a.id}
                automation={a}
                equipment={eq}
                policySummary={a.policy ? formatPolicySummary(a.policy) : 'No policy set'}
                lastRunLabel={formatLastRun(a.lastRunAt)}
                cooldownRemaining={getCooldownRemaining(a, clock)}
                onToggleEnabled={onToggleEnabled}
                onSetPolicy={onSetPolicy}
              />
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-slate-500" data-testid="automation-hint">
        Purchasing debits your personal cash and instantiates an automation.
        Policies describe <em>when</em> the automation fires — the engine
        evaluates them each tick (TDD §12). The UI never runs automation
        directly.
      </p>
    </div>
  );
}
