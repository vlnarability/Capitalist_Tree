/**
 * PurchaseControls — buy water/fertilizer from markets + apply to tree
 * (P5c — GDD §13.3 advanced view, GDD §8.5 markets, TDD §10.5 purchase).
 *
 * The advanced view (GDD §13.3) calls out "Economic transactions" and
 * "Production efficiency" — this panel exposes both: the player can buy
 * irrigation water or balanced NPK fertilizer from the registered
 * markets (GDD §8.5). Each purchase:
 *
 *   1. Dispatches the `purchase` GameAction — cash flows from
 *      `player:personal` to the market's account; inventory is credited
 *      with the commodity (`resource:water` or
 *      `fertilizer:balanced-10-10-10`).
 *   2. Dispatches the matching `apply-water` / `apply-fertilizer` action
 *      so the purchased resource immediately affects the tree's soil
 *      (the engine's apply-* handlers don't yet deduct inventory — that
 *      wiring lands in P3c per the economy README, but the UI flow is
 *      complete + the player sees the immediate effect).
 *
 * The panel surfaces:
 *
 *   - Current market price (bigint formatted via `formatMoneyFromStr`).
 *   - Player's current cash (so the player sees whether they can afford).
 *   - Quantity selector (input + quick buttons for 1 / 10 / 100).
 *   - Buy buttons per market (water + fertilizer).
 *
 * Architecture:
 *
 *   - Rule 6 (rendering / UI reads state, never writes): the panel reads
 *     the economy slice + dispatches actions through the store's dispatch.
 *     The engine owns the cash / inventory / soil mutation.
 *   - Rule 2 (purity): the action factories `purchase` /
 *     `applyWater` / `applyFertilizer` from `lib/actions.ts` are pure —
 *     they validate inputs and return plain action objects.
 *   - TDD §16 selective UI updates: narrow selectors per slice.
 *
 * Returns `null` until `simState` is published (loop hasn't booted).
 */
'use client';

import { useCallback, useState, type ReactElement } from 'react';
import { useGameStore } from '../../stores/game-store';
import { formatMoneyFromStr } from '../../lib/format/money';
import { applyFertilizer, applyWater, purchase } from '../../lib/actions';
import { Button } from '../common/Button';
import { Stat } from '../common/Stat';
import type { MarketState } from '@capitalist-tree/shared';

export interface PurchaseControlsProps {
  /** Optional className applied to the outer wrapper. */
  readonly className?: string;
}

/**
 * Market id for water — matches the content registry (P3b WATER_MARKET.id).
 * Kept as a local constant (not imported from `@capitalist-tree/content`)
 * so the panel doesn't pull in the full content package — the ids are
 * stable, and the content module is already loaded by the simulation.
 */
const WATER_MARKET_ID = 'market:water';
/**
 * Market id for fertilizer — matches FERTILIZER_MARKET.id.
 */
const FERTILIZER_MARKET_ID = 'market:fertilizer';
/**
 * Commodity id for the fertilizer sold by `market:fertilizer`. Used to
 * look up the fertilizer content entry (for the apply-fertilizer action).
 */
const FERTILIZER_COMMODITY_ID = 'fertilizer:balanced-10-10-10';

/**
 * Find a market by id in the economy's markets array. Pure — returns
 * `undefined` if the market isn't registered.
 */
function findMarket(
  markets: readonly MarketState[],
  marketId: string,
): MarketState | undefined {
  return markets.find((m) => m.id === marketId);
}

/**
 * Format the unit price of a market as `$X.XX` per unit. Defensive —
 * returns `'$—'` if the market is missing or its price is malformed.
 */
function formatUnitPrice(market: MarketState | undefined, unit: string): string {
  if (!market) return `$— / ${unit}`;
  return `${formatMoneyFromStr(market.price)} / ${unit}`;
}

/**
 * Compute the total cost of buying `quantity` units at the market's current
 * price. Returns a bigint (TDD §10.1 — money is bigint minor units). Returns
 * 0n if the market is missing or the price is malformed.
 */
function computeTotalCost(market: MarketState | undefined, quantity: number): bigint {
  if (!market) return 0n;
  try {
    return BigInt(market.price) * BigInt(quantity);
  } catch {
    return 0n;
  }
}

/**
 * Render the PurchaseControls. Subscribes narrowly to the economy markets +
 * player.personalCash slices + dispatch. Returns `null` when simState is
 * null.
 */
export function PurchaseControls({
  className,
}: PurchaseControlsProps = {}): ReactElement | null {
  const markets = useGameStore((s) => s.simState?.economy.markets ?? null);
  const personalCash = useGameStore(
    (s) => s.simState?.player.personalCash ?? null,
  );
  const treeId = useGameStore((s) => s.simState?.originalTree.id ?? null);
  const dispatch = useGameStore((s) => s.dispatch);

  // Local state: per-market quantity inputs. Default 1 — a sapling-era
  // player buys in small quantities; quick buttons provide 10 / 100.
  const [waterQty, setWaterQty] = useState(1);
  const [fertQty, setFertQty] = useState(1);

  const onBuyWater = useCallback(() => {
    if (!treeId || waterQty < 1) return;
    // 1. Purchase — credits inventory with `resource:water` (qty L).
    // 2. Apply — adds `waterQty` L to the soil water pool (capped at
    //    PROVISIONAL_RESOURCE_SOIL_WATER_CAPACITY; excess becomes runoff).
    dispatch(purchase(WATER_MARKET_ID, waterQty));
    dispatch(applyWater(waterQty, treeId));
  }, [dispatch, treeId, waterQty]);

  const onBuyFertilizer = useCallback(() => {
    if (!treeId || fertQty < 1) return;
    // 1. Purchase — credits inventory with `fertilizer:balanced-10-10-10`.
    // 2. Apply — adds N/P/K to the soil nutrient pool + contamination if
    //    over-applied (GDD §8.3).
    dispatch(purchase(FERTILIZER_MARKET_ID, fertQty));
    dispatch(applyFertilizer(FERTILIZER_COMMODITY_ID, fertQty, treeId));
  }, [dispatch, treeId, fertQty]);

  if (markets === null || personalCash === null || treeId === null) return null;

  const waterMarket = findMarket(markets, WATER_MARKET_ID);
  const fertMarket = findMarket(markets, FERTILIZER_MARKET_ID);
  const waterCost = computeTotalCost(waterMarket, waterQty);
  const fertCost = computeTotalCost(fertMarket, fertQty);
  const playerCash = BigInt(personalCash);

  const canAffordWater = waterCost > 0n && waterCost <= playerCash;
  const canAffordFert = fertCost > 0n && fertCost <= playerCash;

  return (
    <div
      className={`flex flex-col gap-4 ${className ?? ''}`}
      data-testid="purchase-controls"
    >
      <Stat
        label="Current cash"
        value={formatMoneyFromStr(personalCash)}
        tone="emerald"
        sub="Personal account"
      />

      <section className="flex flex-col gap-2" data-testid="purchase-water">
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">
            Water market ({WATER_MARKET_ID})
          </span>
          <span className="text-xs tabular-nums text-slate-300">
            {formatUnitPrice(waterMarket, 'litre')}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            min={1}
            step={1}
            value={waterQty}
            onChange={(e) => setWaterQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            className="w-24 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100 tabular-nums focus:border-sky-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50"
            data-testid="purchase-water-qty"
            aria-label="Water quantity (litres)"
          />
          <span className="text-[10px] uppercase tracking-wider text-slate-500">
            L
          </span>
          <div className="flex gap-1">
            {[1, 10, 100].map((n) => (
              <Button
                key={n}
                tone={waterQty === n ? 'active' : 'default'}
                onClick={() => setWaterQty(n)}
                data-testid={`purchase-water-qty-${n}`}
              >
                {n}
              </Button>
            ))}
          </div>
        </div>
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-slate-500">Cost</span>
          <span className="tabular-nums text-slate-300" data-testid="purchase-water-cost">
            {formatMoneyFromStr(String(waterCost))}
          </span>
        </div>
        <Button
          tone="active"
          icon="💧"
          onClick={onBuyWater}
          disabled={!canAffordWater}
          data-testid="purchase-water-buy"
        >
          Buy {waterQty} L · Apply
        </Button>
        {!canAffordWater ? (
          <p className="text-xs text-rose-400/80" data-testid="purchase-water-insufficient">
            Insufficient funds for {waterQty} L.
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-2" data-testid="purchase-fertilizer">
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">
            Fertilizer market ({FERTILIZER_MARKET_ID})
          </span>
          <span className="text-xs tabular-nums text-slate-300">
            {formatUnitPrice(fertMarket, 'unit')}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            min={1}
            step={1}
            value={fertQty}
            onChange={(e) => setFertQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            className="w-24 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100 tabular-nums focus:border-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50"
            data-testid="purchase-fertilizer-qty"
            aria-label="Fertilizer quantity (units)"
          />
          <span className="text-[10px] uppercase tracking-wider text-slate-500">
            units
          </span>
          <div className="flex gap-1">
            {[1, 5, 10].map((n) => (
              <Button
                key={n}
                tone={fertQty === n ? 'active' : 'default'}
                onClick={() => setFertQty(n)}
                data-testid={`purchase-fertilizer-qty-${n}`}
              >
                {n}
              </Button>
            ))}
          </div>
        </div>
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-slate-500">Cost</span>
          <span className="tabular-nums text-slate-300" data-testid="purchase-fertilizer-cost">
            {formatMoneyFromStr(String(fertCost))}
          </span>
        </div>
        <Button
          tone="active"
          icon="🌱"
          onClick={onBuyFertilizer}
          disabled={!canAffordFert}
          data-testid="purchase-fertilizer-buy"
        >
          Buy {fertQty} unit{fertQty === 1 ? '' : 's'} · Apply
        </Button>
        {!canAffordFert ? (
          <p className="text-xs text-rose-400/80" data-testid="purchase-fertilizer-insufficient">
            Insufficient funds for {fertQty} unit{fertQty === 1 ? '' : 's'}.
          </p>
        ) : null}
      </section>

      <p className="text-xs text-slate-500" data-testid="purchase-hint">
        Each purchase credits your inventory with the commodity and
        immediately applies it to the soil. P3c will wire the inventory
        deduction for apply-water / apply-fertilizer; until then the apply
        is a free transfer (tracked separately).
      </p>
    </div>
  );
}
