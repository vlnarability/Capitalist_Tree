/**
 * Business valuation (P8b — TDD §11 Personal and Business Accounting; GDD §8.1
 * Financial Separation, §8.4 Growth Pressure).
 *
 * Pure helper that recomputes a business's `valuation` from its balance
 * sheet + profitability. Per TDD §11, valuation considers assets,
 * liabilities, profitability, cash flow, expected future performance, and
 * market conditions. P8b's provisional model folds these into:
 *
 *   valuation = assetsTotal
 *             + profitabilityTerm
 *             - liabilitiesTotal
 *
 * where:
 *   - `assetsTotal`      = sum of `business.assets[].value` (book value of
 *     held assets — equipment, land, inventory the business owns).
 *   - `profitabilityTerm` = `(revenue - expenses) × operatingMarginFactor`.
 *     The operating margin factor scales the cumulative profit into a
 *     valuation contribution (a profitable business is worth more than its
 *     assets alone; an unprofitable one is worth less). Uses
 *     `PROVISIONAL_BUSINESS_OPERATING_MARGIN` as the reference margin.
 *   - `liabilitiesTotal`  = sum of `business.liabilities[].principal`
 *     (outstanding debt reduces the net valuation).
 *
 * Valuation floored at 0 (a business cannot be worth negative money — its
 * owners would simply walk away / liquidate; the bankruptcy path handles
 * insolvency). Cash is NOT added to valuation directly — cash is already
 * spendable (TDD §11: valuation ≠ liquidity; the player cannot spend
 * valuation without selling/borrowing). Cash IS part of the consolidated net
 * worth but it is tracked separately on `business.cash` (and the economy
 * account) so the two never blur.
 *
 * The valuation is recomputed on a SLOWER cadence than per-tick cash moves
 * (TDD §11 — "valuation must not be confused with liquidity"; recomputing it
 * every tick would make it flicker with every wage payment). The
 * BusinessSystem recomputes when `(now - lastValuationTick) >=
 * VALUATION_INTERVAL_SECONDS`. `recomputeValuation` is a pure helper; the
 * cadence decision is the system's.
 *
 * Pure: returns a NEW BusinessState with the recomputed `valuation` +
 * `lastValuationTick`; the input is never mutated (TDD §4.1, §18.4).
 *
 * @provisional (GDD §17: corporate valuation / business valuation model) —
 * the assets + profitability − liabilities model is a starter; a future
 * phase adds cash-flow / expected-future-performance / market-conditions
 * terms. The operating margin factor is `PROVISIONAL_BUSINESS_OPERATING_MARGIN`.
 */
import type { BusinessState } from '@capitalist-tree/shared';
import { PROVISIONAL_BUSINESS_OPERATING_MARGIN } from '@capitalist-tree/shared';
import { sumAssets, sumLiabilities, parseBusinessAmount } from './accounting.js';

/**
 * Cadence on which the BusinessSystem recomputes valuation, in simulation
 * seconds. One sim day (86400 s) — valuation refreshes once per in-game day,
 * not every tick, so it does not flicker with per-tick wage/input payments
 * (TDD §11). @provisional — tunable; promote to a shared PROVISIONAL_
 * constant once playtesting calibrates it.
 */
export const BUSINESS_VALUATION_INTERVAL_SECONDS = 24 * 60 * 60;

/**
 * Recompute a business's valuation from its balance sheet + profitability.
 *
 * See the module doc for the formula. `marketConditions` is an optional
 * future hook (TDD §11 lists "market conditions" as a valuation input) — P8b
 * does not yet use it (P8c market simulation will). The valuation is floored
 * at 0.
 *
 * Pure: returns a NEW BusinessState with `valuation` + `lastValuationTick`
 * updated; the input is never mutated.
 *
 * @param business The business to revalue.
 * @param now      The simulation second at which the revaluation runs
 *                 (recorded on `lastValuationTick`).
 * @param marketConditions  Optional market-conditions term (UNUSED in P8b —
 *                 reserved for P8c). Defaults to 0.
 */
export function recomputeValuation(
  business: BusinessState,
  now: number,
  marketConditions = 0,
): BusinessState {
  const assetsTotal = sumAssets(business);
  const liabilitiesTotal = sumLiabilities(business);
  const revenue = parseBusinessAmount(business.revenue, 'revenue');
  const expenses = parseBusinessAmount(business.expenses, 'expenses');
  const profit = revenue - expenses;

  // Profitability term: cumulative profit scaled by the operating margin
  // factor. A business with positive cumulative profit is worth more than its
  // net assets; one with losses is worth less. Use Number for the margin
  // multiplication (the margin is a small fraction); safe for P8b magnitudes.
  const profitabilityTerm = BigInt(
    Math.floor(Number(profit) * PROVISIONAL_BUSINESS_OPERATING_MARGIN),
  );

  // marketConditions is a future hook — reserved for P8c (a multiplier on
  // valuation from market scarcity / demand). P8b passes 0. Reference it so
  // the parameter is not flagged unused.
  void marketConditions;

  const raw = assetsTotal + profitabilityTerm - liabilitiesTotal;
  const valuation = raw > 0n ? raw : 0n;

  return {
    ...business,
    valuation: valuation.toString(10),
    lastValuationTick: now,
  };
}

/**
 * Should the BusinessSystem recompute this business's valuation this tick?
 *
 * `true` iff `(now - lastValuationTick) >=
 * BUSINESS_VALUATION_INTERVAL_SECONDS`. Pure.
 */
export function shouldRecomputeValuation(business: BusinessState, now: number): boolean {
  return now - business.lastValuationTick >= BUSINESS_VALUATION_INTERVAL_SECONDS;
}
