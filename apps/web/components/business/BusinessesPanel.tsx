/**
 * BusinessesPanel — P11-E (Phase 3 game-loop gap).
 *
 * Bridges the previously-unreachable `purchase-business` / `operate-business` /
 * `sell-business` GameActions to the UI. Pre-P11-E these actions had handlers
 * but zero UI dispatchers (Phase 3 "Expansion" was entirely unwired per the
 * game-loop audit).
 *
 * Two sections:
 *   - **Acquire**: lists all `BUSINESS_TYPES` from content with their
 *     `baseCost` + a Purchase button (dispatches `purchase-business`). The
 *     button is disabled when the player can't afford the cost.
 *   - **Owned**: lists `state.businesses` with their cash/valuation/status +
 *     Operate (dispatches `operate-business`) + Sell (dispatches
 *     `sell-business`) buttons.
 *
 * Advanced-view only (matches AutomationPanel's gating — Phase 3 is midgame).
 * Reads `simState` + `dispatch` via narrow Zustand selectors; never touches
 * the simulation directly (rule 6).
 */
import { type ReactElement } from 'react';
import { BUSINESS_TYPES } from '@capitalist-tree/content';
import { useGameStore } from '../../stores/game-store';
import { purchaseBusiness, operateBusiness, sellBusiness } from '../../lib/actions';
import { formatMoneyFromStr } from '../../lib/format/money';
import { Button } from '../common/Button';
import { BusinessControls } from './BusinessControls';
import type { BusinessState } from '@capitalist-tree/shared';

export interface BusinessesPanelProps {
  className?: string;
}

/** Tier label for the supply-chain level (0=extraction … 5=retail). */
const TIER_LABELS = ['Extraction', 'Processing', 'Manufacturing', 'Distribution', 'Retail', 'Application'];

export function BusinessesPanel({ className }: BusinessesPanelProps = {}): ReactElement | null {
  const simState = useGameStore((s) => s.simState);
  const dispatch = useGameStore((s) => s.dispatch);

  if (!simState) return null;

  const playerCash = BigInt(simState.player.personalCash);
  const owned = simState.businesses;

  const onPurchase = (businessTypeId: string) => {
    dispatch(purchaseBusiness(businessTypeId));
  };
  const onOperate = (businessId: string) => {
    dispatch(operateBusiness(businessId));
  };
  const onSell = (businessId: string) => {
    dispatch(sellBusiness(businessId));
  };

  return (
    <section
      className={`rounded-lg border border-slate-700 bg-slate-900/60 p-4 ${className ?? ''}`}
      aria-labelledby="businesses-panel-title"
    >
      <h2 id="businesses-panel-title" className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
        Businesses
      </h2>

      {/* Acquire */}
      <div className="mb-4">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Acquire</h3>
        <p className="mb-2 text-xs text-slate-500">
          Cash: <span className="tabular-nums text-slate-300">{formatMoneyFromStr(simState.player.personalCash)}</span>
        </p>
        <ul className="flex flex-col gap-1.5">
          {BUSINESS_TYPES.map((def) => {
            const cost = BigInt(def.baseCost);
            const affordable = playerCash >= cost;
            const tier = TIER_LABELS[def.supplyChainLevel] ?? `Tier ${def.supplyChainLevel}`;
            return (
              <li
                key={def.id}
                className="flex items-center justify-between gap-2 rounded border border-slate-700/60 bg-slate-800/40 px-3 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium text-slate-200">{def.name}</span>
                    <span className="shrink-0 text-[0.65rem] uppercase tracking-wide text-slate-500">{tier}</span>
                  </div>
                  <span className="text-xs tabular-nums text-slate-400">{formatMoneyFromStr(def.baseCost)}</span>
                </div>
                <Button
                  tone={affordable ? 'active' : 'default'}
                  disabled={!affordable}
                  onClick={() => onPurchase(def.id)}
                >
                  Buy
                </Button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Owned */}
      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
          Owned {owned.length > 0 && <span className="text-slate-400">({owned.length})</span>}
        </h3>
        {owned.length === 0 ? (
          <p className="text-xs text-slate-500">No businesses yet. Acquire one above to start producing.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {owned.map((b: BusinessState) => (
              <li
                key={b.id}
                className="rounded border border-slate-700/60 bg-slate-800/40 px-3 py-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-sm font-medium text-slate-200">{b.name}</span>
                      <span className="shrink-0 text-[0.65rem] uppercase tracking-wide text-slate-500">{b.status}</span>
                    </div>
                    <span className="text-xs tabular-nums text-slate-400">
                      Cash {formatMoneyFromStr(b.cash)} · Val {formatMoneyFromStr(b.valuation)}
                      {b.employees > 0 && ` · ${b.employees} emp`}
                    </span>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button tone="active" onClick={() => onOperate(b.id)}>
                      Operate
                    </Button>
                    <Button tone="warning" onClick={() => onSell(b.id)}>
                      Sell
                    </Button>
                  </div>
                </div>
                {/* P11-E: loan / employee / status management verbs. */}
                <BusinessControls business={b} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
