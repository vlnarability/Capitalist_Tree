/**
 * EquipmentCard — presentational shop item for one `EquipmentDefinition`
 * (P6d1 — GDD §9 "Automation and Technology", TDD §12).
 *
 * Renders the equipment's name, description, tier, one-time cost (formatted
 * money), energy / maintenance / environmental-impact summary, and a Purchase
 * button. The button is disabled when `affordable` is false (the caller
 * pre-flights affordability via `getAffordableEquipment`); the engine re-checks
 * at dispatch time, so this is purely a UX gate.
 *
 * The card is purely presentational — it does NOT subscribe to the store and
 * does NOT dispatch. The parent `AutomationPanel` owns the dispatch + the
 * affordability computation; the card just renders + calls `onPurchase` when
 * the button is clicked (rule 6: UI reads state, never writes — the click
 * routes through the parent's dispatch).
 */
import type { ReactElement } from 'react';
import type { EquipmentDefinition } from '@capitalist-tree/shared';
import { formatMoneyFromStr } from '../../lib/format/money';
import { Button } from '../common/Button';

export interface EquipmentCardProps {
  /** The equipment definition to render. */
  readonly equipment: EquipmentDefinition;
  /** Whether the player can afford the one-time cost right now. */
  readonly affordable: boolean;
  /** Called when the Purchase button is clicked. Receives the equipment id. */
  readonly onPurchase: (equipmentId: string) => void;
}

/** Tier label fragment (e.g. tier 1 → "Tier 1 · entry"). */
function tierLabel(tier: number): string {
  const name = tier === 1 ? 'entry' : tier === 2 ? 'improved' : 'industrial';
  return `Tier ${tier} · ${name}`;
}

/**
 * Compact environmental-impact summary. Shows the two impact axes a player is
 * most likely to care about (carbon + water) plus a flag if any other axis is
 * non-zero. Pure.
 */
function envSummary(e: EquipmentDefinition): string {
  const env = e.baseEnvironmentalImpact;
  const parts: string[] = [`CO₂ ${env.carbonEmissions.toFixed(2)}`, `Water ${env.waterConsumption.toFixed(2)}`];
  const other =
    env.soilDegradation +
    env.pollution +
    env.landDisturbance +
    env.biodiversityImpact;
  if (other > 0) parts.push('other impact');
  return parts.join(' · ');
}

/**
 * Render an EquipmentCard. Pure presentational component.
 */
export function EquipmentCard({
  equipment,
  affordable,
  onPurchase,
}: EquipmentCardProps): ReactElement {
  return (
    <li
      className="flex flex-col gap-1.5 rounded border border-slate-800/60 bg-slate-900/40 p-3"
      data-testid={`equipment-card-${equipment.id}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span
          className="text-sm font-semibold text-slate-100"
          data-testid={`equipment-card-${equipment.id}-name`}
        >
          {equipment.name}
        </span>
        <span
          className="text-[10px] uppercase tracking-wider text-slate-500"
          data-testid={`equipment-card-${equipment.id}-tier`}
        >
          {tierLabel(equipment.tier)}
        </span>
      </div>
      <p
        className="text-xs text-slate-400"
        data-testid={`equipment-card-${equipment.id}-description`}
      >
        {equipment.description}
      </p>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
        <span data-testid={`equipment-card-${equipment.id}-cost`}>
          Cost {formatMoneyFromStr(equipment.cost)}
        </span>
        <span data-testid={`equipment-card-${equipment.id}-energy`}>
          Energy {equipment.baseEnergyConsumption.toFixed(2)} kWh/day
        </span>
        <span data-testid={`equipment-card-${equipment.id}-maintenance`}>
          Maint {formatMoneyFromStr(equipment.baseMaintenanceCost)}/day
        </span>
      </div>
      <p
        className="text-[11px] text-slate-500"
        data-testid={`equipment-card-${equipment.id}-env`}
      >
        Env: {envSummary(equipment)}
      </p>
      <div className="mt-1 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-slate-600">
          {equipment.category}
        </span>
        <Button
          tone="active"
          icon="🛒"
          disabled={!affordable}
          onClick={() => onPurchase(equipment.id)}
          data-testid={`equipment-card-${equipment.id}-purchase`}
          aria-label={`Purchase ${equipment.name}`}
        >
          Purchase
        </Button>
      </div>
      {!affordable ? (
        <p
          className="text-[11px] text-rose-400/80"
          data-testid={`equipment-card-${equipment.id}-insufficient`}
        >
          Insufficient funds.
        </p>
      ) : null}
    </li>
  );
}
