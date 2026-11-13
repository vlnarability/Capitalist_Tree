/**
 * Business growth-pressure mechanics (P8c — TDD §11 Personal and Business
 * Accounting; GDD §8.4 Growth Pressure: inflation, debt/interest,
 * shareholder expectations, competition, valuation, market demand, labor
 * costs, investment).
 *
 * Four pure helpers, each driving one GDD §8.4 growth-pressure axis:
 *
 *   - `applyInflationPressure(businesses, inflationIndex, dtSeconds)`:
 *     operating costs rise with inflation — the business's `wageRate` grows
 *     by `floor(wageRate × (inflationIndex - 1) ×
 *     PROVISIONAL_BUSINESS_INFLATION_WAGE_PASS_THROUGH × dtFraction)` per
 *     tick (GDD §8.4 inflation + labor costs). The economy's
 *     `inflationIndex` is READ-ONLY by business (TDD §10.6 — the
 *     EconomySystem derives it from the basket of market prices).
 *
 *   - `accrueDebtInterest(businesses, dtSeconds)`: liabilities accrue
 *     interest each tick (into the `accruedInterest` field, NOT compounded
 *     into principal — P8c resolution of P8b carry-forward #3). Delegates to
 *     `accrueInterest` (accounting.ts) per business. The `repay-loan` action
 *     pays `accruedInterest` FIRST, then reduces `principal`.
 *
 *   - `applyShareholderExpectations(businesses, dtSeconds, now)`: for
 *     corporations (`ownership.structure === 'corporation'`), if the
 *     per-tick revenue growth falls below
 *     `PROVISIONAL_BUSINESS_SHAREHOLDER_EXPECTED_GROWTH_RATE`, emit a
 *     `shareholder-pressure` notification + reduce the valuation by the
 *     shortfall scaled by the penalty factor (TDD §11 — valuation reflects
 *     expected future performance; GDD §8.4 shareholder expectations).
 *
 *   - `applyCompetitionPressure(businesses, dtSeconds)`: when multiple
 *     businesses sell to the same market (same `outputResourceId`), market
 *     share erodes for less efficient ones. The less-efficient business's
 *     `production.rate` is reduced by `floor(rate ×
 *     PROVISIONAL_BUSINESS_COMPETITION_EROSION_RATE × (avgEfficiency -
 *     businessEfficiency))` per tick (GDD §8.4 competition).
 *
 * All functions are pure: they return new arrays + events; the input is
 * NEVER mutated (TDD §4.1, §18.4). Deterministic given the inputs.
 *
 * @provisional (GDD §17: market simulation / shareholder expectations /
 * competition model) — every constant is in
 * `packages/shared/src/constants/business.ts` under the `PROVISIONAL_BUSINESS_*`
 * prefix. The models are intentionally simple starters; P5+ tuning will
 * calibrate from playtest data.
 */
import type { BusinessState, SimulationEvent } from '@capitalist-tree/shared';
import {
  PROVISIONAL_BUSINESS_INFLATION_WAGE_PASS_THROUGH,
  PROVISIONAL_BUSINESS_SHAREHOLDER_EXPECTED_GROWTH_RATE,
  PROVISIONAL_BUSINESS_SHAREHOLDER_VALUATION_PENALTY,
  PROVISIONAL_BUSINESS_COMPETITION_EROSION_RATE,
  PROVISIONAL_BUSINESS_OPERATING_MARGIN,
} from '@capitalist-tree/shared';
import { accrueInterest, parseBusinessAmount } from './accounting.js';

/** SECONDS_PER_DAY — used to pro-rate per-day quantities to per-step. */
const SECONDS_PER_DAY = 24 * 60 * 60;

/** Result of an apply* helper. */
export interface ApplyGrowthPressureResult {
  businesses: BusinessState[];
  events: SimulationEvent[];
}

/**
 * Apply inflation pressure to operating costs (GDD §8.4 inflation + labor
 * costs).
 *
 * For each operating business, the `wageRate` grows by
 * `floor(wageRate × (inflationIndex - 1) ×
 * PROVISIONAL_BUSINESS_INFLATION_WAGE_PASS_THROUGH × dtFraction)` per tick.
 * The `inflationIndex` is READ from the economy (TDD §10.6 — derived by the
 * EconomySystem from the basket of market prices; business NEVER mutates
 * it). When `inflationIndex <= 1.0` (no inflation), the wageRate is
 * unchanged.
 *
 * Only `status === 'operating'` businesses are affected (idle / bankrupt /
 * liquidating businesses don't pay wages this tick).
 *
 * Pure: returns a NEW businesses array + events (one `system` event per
 * business whose wageRate changed, for the audit trail).
 *
 * @provisional (GDD §17: inflation / wage-price spiral) — the full
 * pass-through is a starter; a future phase may add wage stickiness.
 */
export function applyInflationPressure(
  businesses: readonly BusinessState[],
  inflationIndex: number,
  dtSeconds: number,
  now: number,
): ApplyGrowthPressureResult {
  if (inflationIndex <= 1.0 || businesses.length === 0) {
    return { businesses: [...businesses], events: [] };
  }
  const dtFraction = dtSeconds / SECONDS_PER_DAY;
  const inflationDelta = inflationIndex - 1.0;
  const events: SimulationEvent[] = [];
  const newBusinesses = businesses.map((b) => {
    if (b.status !== 'operating') return b;
    const wageRate = parseBusinessAmount(b.wageRate, 'wageRate');
    if (wageRate <= 0n) return b;
    const increase = BigInt(
      Math.floor(
        Number(wageRate) *
          inflationDelta *
          PROVISIONAL_BUSINESS_INFLATION_WAGE_PASS_THROUGH *
          dtFraction,
      ),
    );
    if (increase <= 0n) return b;
    const newWageRate = wageRate + increase;
    events.push({
      type: 'system',
      at: now,
      payload: {
        systemId: 'BusinessSystem',
        message: `Inflation pressure: ${b.id} wageRate ${b.wageRate} → ${newWageRate.toString(10)} (+${increase.toString(10)}).`,
        data: {
          businessId: b.id,
          kind: 'inflation-pressure',
          oldWageRate: b.wageRate,
          newWageRate: newWageRate.toString(10),
          inflationIndex,
        },
      },
    });
    return { ...b, wageRate: newWageRate.toString(10) };
  });
  return { businesses: newBusinesses, events };
}

/**
 * Accrue debt interest on every liability of every business (GDD §8.4 debt
 * and interest; resolves P8b carry-forward #3).
 *
 * Delegates to `accrueInterest` (accounting.ts) per business. Interest
 * accrues into the liability's `accruedInterest` field (NOT compounded into
 * `principal` — the P8c resolution). The `repay-loan` action pays
 * `accruedInterest` FIRST, then reduces `principal`.
 *
 * Pure: returns a NEW businesses array; the input is never mutated. No
 * events (interest accrual is a silent balance-sheet update; the
 * `loan-repaid` event carries the split when repayment happens).
 */
export function accrueDebtInterest(
  businesses: readonly BusinessState[],
  dtSeconds: number,
): BusinessState[] {
  if (businesses.length === 0) return [...businesses];
  return businesses.map((b) => {
    if (b.liabilities.length === 0) return b;
    const newLiabilities = accrueInterest(b.liabilities, dtSeconds);
    const changed =
      newLiabilities.length !== b.liabilities.length ||
      newLiabilities.some((l, i) => l !== b.liabilities[i]);
    return changed ? { ...b, liabilities: newLiabilities } : b;
  });
}

/**
 * Apply shareholder expectations to corporations (GDD §8.4 shareholder
 * expectations + corporate valuation).
 *
 * For each corporation (`ownership.structure === 'corporation'`):
 *   - Compute the per-tick revenue growth proxy: `revenue / max(revenue +
 *     expenses, 1)` (a simple profitability proxy; @provisional — a future
 *     phase tracks a revenue trajectory).
 *   - If the proxy is below
 *     `PROVISIONAL_BUSINESS_SHAREHOLDER_EXPECTED_GROWTH_RATE`, emit a
 *     `shareholder-pressure` notification (warning severity) and reduce the
 *     valuation by `floor(shortfall ×
 *     PROVISIONAL_BUSINESS_SHAREHOLDER_VALUATION_PENALTY ×
 *     PROVISIONAL_BUSINESS_OPERATING_MARGIN)`, floored at 0.
 *
 * Pure: returns a NEW businesses array + events (one `notification` event
 * per underperforming corporation).
 *
 * @provisional (GDD §17: shareholder expectations / corporate governance) —
 * the per-tick revenue growth proxy is a starter; a future phase tracks a
 * multi-tick revenue trajectory for a smoother signal.
 */
export function applyShareholderExpectations(
  businesses: readonly BusinessState[],
  dtSeconds: number,
  now: number,
): ApplyGrowthPressureResult {
  if (businesses.length === 0) return { businesses: [...businesses], events: [] };
  const events: SimulationEvent[] = [];
  const newBusinesses = businesses.map((b) => {
    if (b.ownership.structure !== 'corporation') return b;
    if (b.status !== 'operating') return b;
    const revenue = parseBusinessAmount(b.revenue, 'revenue');
    const expenses = parseBusinessAmount(b.expenses, 'expenses');
    // Per-tick revenue growth proxy: revenue / (revenue + expenses).
    // A profitable business has a proxy near 1.0; an unprofitable one near 0.
    const denom = revenue + expenses;
    const growthProxy = denom > 0n ? Number(revenue) / Number(denom) : 0;
    const expected = PROVISIONAL_BUSINESS_SHAREHOLDER_EXPECTED_GROWTH_RATE;
    if (growthProxy >= expected) return b;
    const shortfall = expected - growthProxy;
    const valuation = parseBusinessAmount(b.valuation, 'valuation');
    const penalty = BigInt(
      Math.floor(
        Number(valuation) *
          shortfall *
          PROVISIONAL_BUSINESS_SHAREHOLDER_VALUATION_PENALTY *
          PROVISIONAL_BUSINESS_OPERATING_MARGIN,
      ),
    );
    if (penalty <= 0n) return b;
    const newValuation = valuation - penalty;
    events.push({
      type: 'notification',
      at: now,
      payload: {
        severity: 'warning',
        message: `Shareholder pressure: corporation ${b.id} underperformed (growth proxy ${growthProxy.toFixed(4)} < expected ${expected}). Valuation reduced by ${penalty.toString(10)}.`,
        code: 'shareholder-pressure',
      },
    });
    return { ...b, valuation: newValuation > 0n ? newValuation.toString(10) : '0' };
  });
  return { businesses: newBusinesses, events };
}

/**
 * Apply competition pressure (GDD §8.4 competition).
 *
 * When multiple operating businesses sell to the same market (same
 * `production.outputResourceId`), market share erodes for less efficient
 * ones. For each business whose efficiency is below the average efficiency
 * of businesses sharing its output resource, the `production.rate` is
 * reduced by `floor(rate ×
 * PROVISIONAL_BUSINESS_COMPETITION_EROSION_RATE × (avgEfficiency -
 * businessEfficiency))` per tick (a small drift;floored at 0 — a business
 * never goes negative rate).
 *
 * Pure: returns a NEW businesses array + events (one `system` event per
 * business whose rate eroded, for the audit trail).
 *
 * @provisional (GDD §17: competition / market share model) — the
 * efficiency-gap erosion is a starter; a future phase may model market share
 * explicitly (per-business share of the market's demand).
 */
export function applyCompetitionPressure(
  businesses: readonly BusinessState[],
  dtSeconds: number,
  now: number,
): ApplyGrowthPressureResult {
  if (businesses.length === 0) return { businesses: [...businesses], events: [] };
  void dtSeconds; // competition pressure is per-tick (not pro-rated by dt) for now

  // Group operating businesses by outputResourceId.
  const groups = new Map<string, BusinessState[]>();
  for (const b of businesses) {
    if (b.status !== 'operating') continue;
    const key = b.production.outputResourceId;
    const arr = groups.get(key);
    if (arr) arr.push(b);
    else groups.set(key, [b]);
  }

  const events: SimulationEvent[] = [];
  const erosionByBusinessId = new Map<string, bigint>();

  for (const [, group] of groups) {
    if (group.length < 2) continue; // no competition if only one business
    const avgEfficiency =
      group.reduce((sum, b) => sum + b.production.efficiency, 0) / group.length;
    for (const b of group) {
      if (b.production.efficiency >= avgEfficiency) continue; // only less-efficient erode
      const gap = avgEfficiency - b.production.efficiency;
      const rate = b.production.rate;
      const erosion = BigInt(
        Math.floor(
          rate *
            PROVISIONAL_BUSINESS_COMPETITION_EROSION_RATE *
            gap,
        ),
      );
      if (erosion <= 0n) continue;
      erosionByBusinessId.set(b.id, erosion);
      events.push({
        type: 'system',
        at: now,
        payload: {
          systemId: 'BusinessSystem',
          message: `Competition pressure: ${b.id} rate ${rate} → ${Math.max(0, rate - Number(erosion))} (-${erosion.toString(10)}, efficiency ${b.production.efficiency.toFixed(3)} < avg ${avgEfficiency.toFixed(3)}).`,
          data: {
            businessId: b.id,
            kind: 'competition-pressure',
            oldRate: rate,
            erosion: erosion.toString(10),
            efficiency: b.production.efficiency,
            avgEfficiency,
          },
        },
      });
    }
  }

  if (erosionByBusinessId.size === 0) {
    return { businesses: [...businesses], events: [] };
  }

  const newBusinesses = businesses.map((b) => {
    const erosion = erosionByBusinessId.get(b.id);
    if (!erosion) return b;
    const newRate = Math.max(0, b.production.rate - Number(erosion));
    return { ...b, production: { ...b.production, rate: newRate } };
  });
  return { businesses: newBusinesses, events };
}
