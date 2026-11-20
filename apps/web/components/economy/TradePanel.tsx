/**
 * TradePanel — international trade (P13-B / GAP-24 — GDD §15 long-term
 * economic scope, §13.3 advanced view).
 *
 * The simulation already steps the domestic markets + the
 * `import-commodity` / `export-commodity` actions are wired
 * (`packages/simulation/src/economy/markets.ts` `applyImport` / `applyExport`).
 * Each commodity has a content-defined `foreignPriceMultiplier`
 * (comparative advantage) so the foreign (world) price — `basePrice ×
 * foreignPriceMultiplier` — is INDEPENDENT of the domestic market's
 * supply/demand-driven price. This creates cross-region arbitrage:
 *
 *   - Import when `foreignPrice × (1 + tariffRate) < domestic market price`
 *     (e.g. food at 0.8× base under a 10% tariff costs 0.88× base, beating a
 *     domestic price at base; or any commodity once scarcity has pushed the
 *     domestic price above base).
 *   - Export when `foreignPrice > domestic market price` (e.g. energy at
 *     1.2× base beats a domestic price at base by 20%) — or simply to
 *     liquidate surplus inventory (the domestic markets are buy-side only;
 *     export is the sell-side outlet).
 *
 * The panel surfaces, per commodity:
 *   - Domestic market price (supply/demand-driven).
 *   - Foreign (world) price (base × multiplier) — the import cost / export
 *     revenue unit price.
 *   - The held inventory (export availability).
 *   - A quantity input + Import / Export buttons (dispatch `importCommodity`
 *     / `exportCommodity` through the store).
 *   - The import cost (foreign × qty + tariff) + export revenue (foreign × qty).
 *
 * Architecture mirrors PurchaseControls: narrow selectors, pure action
 * factories, `dispatch` is the only path by which the UI mutates state
 * (rule 6 + TDD §16). Returns `null` until `simState` is published.
 */
'use client';

import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { useGameStore } from '../../stores/game-store';
import { formatMoneyFromStr } from '../../lib/format/money';
import { exportCommodity, importCommodity } from '../../lib/actions';
import { Button } from '../common/Button';
import { Stat } from '../common/Stat';
import {
  ALL_MARKETS,
  computeForeignUnitPrice,
  type MarketDefinition,
} from '@capitalist-tree/content';
import type { MarketState } from '@capitalist-tree/shared';

export interface TradePanelProps {
  /** Optional className applied to the outer wrapper. */
  readonly className?: string;
}

/**
 * Per-market quantity inputs. Defaults to 1 — trade quantities are usually
 * small (a sapling-era player imports food / exports surplus a few units at
 * a time). A record keyed by market id so each row keeps its own input.
 */
type QtyMap = Record<string, number>;

/** Look up a market's runtime state by id. Pure. */
function findMarketState(
  markets: readonly MarketState[],
  marketId: string,
): MarketState | undefined {
  return markets.find((m) => m.id === marketId);
}

/**
 * Render the TradePanel. Subscribes narrowly to economy.markets,
 * player.personalCash, inventory.items, governmentPolicy.tariffRate,
 * clock.elapsedSeconds + dispatch. Returns `null` when simState is null.
 */
export function TradePanel({
  className,
}: TradePanelProps = {}): ReactElement | null {
  const markets = useGameStore((s) => s.simState?.economy.markets ?? null);
  const personalCash = useGameStore(
    (s) => s.simState?.player.personalCash ?? null,
  );
  const inventoryItems = useGameStore(
    (s) => s.simState?.inventory.items ?? null,
  );
  const tariffRate = useGameStore(
    (s) => s.simState?.eventState.global.governmentPolicy.tariffRate ?? null,
  );
  const elapsed = useGameStore((s) => s.simState?.clock.elapsedSeconds ?? 0);
  const dispatch = useGameStore((s) => s.dispatch);

  const [qtys, setQtys] = useState<QtyMap>({});
  const qtyFor = useCallback(
    (marketId: string): number => qtys[marketId] ?? 1,
    [qtys],
  );
  const setQtyFor = useCallback((marketId: string, q: number) => {
    setQtys((prev) => ({ ...prev, [marketId]: Math.max(1, Math.floor(q) || 1) }));
  }, []);

  // Pre-compute the foreign unit price (bigint) per market — content-defined,
  // stable per render. Keyed by market id.
  const foreignUnitById = useMemo(() => {
    const map = new Map<string, bigint>();
    for (const def of ALL_MARKETS) map.set(def.id, computeForeignUnitPrice(def));
    return map;
  }, []);

  if (
    markets === null ||
    personalCash === null ||
    inventoryItems === null ||
    tariffRate === null
  ) {
    return null;
  }

  const playerCash = BigInt(personalCash);

  return (
    <div
      className={`flex flex-col gap-4 ${className ?? ''}`}
      data-testid="trade-panel"
    >
      <div className="grid grid-cols-2 gap-2 text-xs">
        <Stat
          label="Current cash"
          value={formatMoneyFromStr(personalCash)}
          tone="emerald"
          sub="Personal account"
        />
        <Stat
          label="Import tariff"
          value={`${(tariffRate * 100).toFixed(1)}%`}
          tone={tariffRate > 0 ? 'amber' : 'slate'}
          sub="Sunk to authority"
        />
      </div>

      <p className="text-xs text-slate-400" data-testid="trade-summary">
        Foreign (world) prices are independent of the domestic market — import
        when foreign + tariff beats the domestic price; export when foreign
        tops it (or to liquidate surplus).
      </p>

      <ul className="flex flex-col gap-3" data-testid="trade-rows">
        {ALL_MARKETS.map((def) => {
          const marketState = findMarketState(markets, def.id);
          const foreignUnit = foreignUnitById.get(def.id) ?? BigInt(def.basePrice);
          const held =
            inventoryItems.find((i) => i.resourceId === def.commodityId)
              ?.quantity ?? 0;
          const qty = qtyFor(def.id);
          const importBase = foreignUnit * BigInt(qty);
          const importTariff = BigInt(
            Math.floor(Number(importBase) * tariffRate),
          );
          const importCost = importBase + importTariff;
          const exportRevenue = foreignUnit * BigInt(qty);
          const canAffordImport = importCost > 0n && importCost <= playerCash;
          const canExport = held >= qty;
          const domesticPrice = marketState?.price ?? def.basePrice;
          // Spread signal: foreign vs domestic — positive = export-favorable,
          // negative = import-favorable.
          const spreadSign = foreignUnit > BigInt(domesticPrice) ? '+' : '';

          const onImport = () => {
            if (!canAffordImport) return;
            dispatch(importCommodity(def.id, qty, elapsed));
          };
          const onExport = () => {
            if (!canExport) return;
            dispatch(exportCommodity(def.id, qty, elapsed));
          };

          return (
            <TradeRow
              key={def.id}
              def={def}
              domesticPrice={domesticPrice}
              foreignUnit={foreignUnit}
              held={held}
              qty={qty}
              importCost={importCost}
              exportRevenue={exportRevenue}
              canAffordImport={canAffordImport}
              canExport={canExport}
              spreadSign={spreadSign}
              onQty={(q) => setQtyFor(def.id, q)}
              onImport={onImport}
              onExport={onExport}
            />
          );
        })}
      </ul>
    </div>
  );
}

interface TradeRowProps {
  readonly def: MarketDefinition;
  readonly domesticPrice: string;
  readonly foreignUnit: bigint;
  readonly held: number;
  readonly qty: number;
  readonly importCost: bigint;
  readonly exportRevenue: bigint;
  readonly canAffordImport: boolean;
  readonly canExport: boolean;
  readonly spreadSign: string;
  readonly onQty: (q: number) => void;
  readonly onImport: () => void;
  readonly onExport: () => void;
}

function TradeRow({
  def,
  domesticPrice,
  foreignUnit,
  held,
  qty,
  importCost,
  exportRevenue,
  canAffordImport,
  canExport,
  spreadSign,
  onQty,
  onImport,
  onExport,
}: TradeRowProps): ReactElement {
  return (
    <li
      className="flex flex-col gap-2 rounded border border-slate-800/60 bg-slate-900/40 p-2"
      data-testid={`trade-row-${def.id}`}
    >
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-wider text-slate-500">
          {def.id} ({def.unit})
        </span>
        <span className="text-[10px] text-slate-500">
          held {held}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs tabular-nums">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">
            Domestic
          </span>
          <span className="text-slate-300" data-testid={`trade-domestic-${def.id}`}>
            {formatMoneyFromStr(domesticPrice)} / {def.unit}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">
            Foreign (world)
          </span>
          <span className="text-slate-300" data-testid={`trade-foreign-${def.id}`}>
            {formatMoneyFromStr(String(foreignUnit))} / {def.unit}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          min={1}
          step={1}
          value={qty}
          onChange={(e) => onQty(Math.floor(Number(e.target.value) || 1))}
          className="w-20 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100 tabular-nums focus:border-sky-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50"
          data-testid={`trade-qty-${def.id}`}
          aria-label={`${def.id} trade quantity`}
        />
        <span className="text-[10px] uppercase tracking-wider text-slate-500">
          {def.unit}s
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs tabular-nums">
        <span className="text-slate-500">
          Import{' '}
          <span className="text-slate-300" data-testid={`trade-import-cost-${def.id}`}>
            {formatMoneyFromStr(String(importCost))}
          </span>
        </span>
        <span className="text-slate-500">
          Export{' '}
          <span className="text-slate-300" data-testid={`trade-export-rev-${def.id}`}>
            {formatMoneyFromStr(String(exportRevenue))}
          </span>
        </span>
      </div>
      <div className="flex gap-2">
        <Button
          tone="default"
          onClick={onImport}
          disabled={!canAffordImport}
          data-testid={`trade-import-${def.id}`}
        >
          Import {qty}
        </Button>
        <Button
          tone="active"
          onClick={onExport}
          disabled={!canExport}
          data-testid={`trade-export-${def.id}`}
        >
          Export {qty}
        </Button>
      </div>
      {!canAffordImport ? (
        <p className="text-xs text-rose-400/80" data-testid={`trade-import-short-${def.id}`}>
          Insufficient funds to import {qty} {def.unit}.
        </p>
      ) : null}
      {!canExport ? (
        <p className="text-xs text-rose-400/80" data-testid={`trade-export-short-${def.id}`}>
          Held {held} {def.unit} — short for {qty}.
        </p>
      ) : null}
      <span className="sr-only" data-testid={`trade-spread-${def.id}`}>
        {spreadSign}
        {formatMoneyFromStr(String(foreignUnit - BigInt(domesticPrice)))} /{' '}
        {def.unit}
      </span>
    </li>
  );
}
