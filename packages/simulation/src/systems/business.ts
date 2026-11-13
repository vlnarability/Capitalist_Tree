/**
 * BusinessSystem (TDD §4.2, §5.7 Business State, §11 Personal and Business
 * Accounting; GDD §8 Business and Economic Simulation, §8.2 Supply Chains,
 * §8.4 Growth Pressure, §8.5 Market Simulation).
 *
 * Replaces the P0 stub at registry slot #8. Runs once per simulation step
 * AFTER EconomySystem (slot #6, drains pendingIssuances + records
 * transactions) and PersonalSystem (slot #7, expenses/well-being), and
 * BEFORE AutomationSystem (slot #9) and EnvironmentSystem (slot #10). The
 * BusinessSystem applies each business's environmental impact onto
 * `state.world.environment` (via the centralized `applyEnvironmentalImpact`
 * helper, pro-rated by the step fraction — invoked inside `operateBusiness`)
 * so the EnvironmentSystem at slot #10 consumes the mutated env state — same
 * pattern as the AutomationSystem (slot #9) applies automation impacts.
 *
 * Each step, for each business in `state.businesses` (in array order):
 *   1. Accrue interest on every liability (GDD §8.4 debt and interest growth
 *      pressure) — `accrueDebtInterest` (P8c: accrues into `accruedInterest`,
 *      NOT principal — resolves P8b carry-forward #3).
 *   2. Run one production cycle via the shared `operateBusiness` helper
 *      (resolve inputs → run production → resolve outputs → move money via
 *      `executeMarketTransaction` (P8c carry-forward #1: revenue from market
 *      sale, not authority issuance) → apply environmental impact → emit
 *      `business-operated`). Skipped businesses (idle / bankrupt / liquidating
 *      / no-employees / insufficient-inputs / insufficient-funds) emit a
 *      `business-operated` event with `operated: false` + a `reason`.
 *   3. Check bankruptcy — if `business.cash < PROVISIONAL_BUSINESS_
 *      BANKRUPTCY_THRESHOLD`, flip `status` to `'bankrupt'` and emit
 *      `business-bankrupt` (only on the fresh transition, not if already
 *      bankrupt).
 *   4. Periodically recompute valuation — when
 *      `(now − lastValuationTick) >= BUSINESS_VALUATION_INTERVAL_SECONDS`
 *      (one sim day), call `recomputeValuation` (TDD §11 — valuation ≠
 *      liquidity; recomputed on a slower cadence than per-tick cash moves).
 *
 * P8c growth-pressure (GDD §8.4), applied AFTER the per-business loop so they
 * reflect this tick's activity:
 *   - `clearMarkets(state, now)` runs FIRST (before the loop) so businesses
 *     see current clearing prices. Ensures the 8 GDD §8.5 commodity markets
 *     are live + advances each market's price toward the supply/demand
 *     equilibrium (bounded by PROVISIONAL_BUSINESS_MARKET_PRICE_VOLATILITY).
 *   - `applyInflationPressure(businesses, inflationIndex, dtSeconds, now)` —
 *     operating costs (wageRate) rise with the economy's inflationIndex.
 *   - `applyShareholderExpectations(businesses, dtSeconds, now)` —
 *     corporations underperforming → notification + valuation reduction.
 *   - `applyCompetitionPressure(businesses, dtSeconds, now)` — inefficient
 *     businesses lose production rate when multiple share an output market.
 * (Debt interest accrual runs per-business in step 1, before production.)
 *
 * RNG fork DEFERRED — R-P8-1 (matching the R-P7-1 precedent for the
 * EnvironmentSystem + the PersonalSystem no-fork decision). The
 * BusinessSystem's transforms are fully deterministic (production /
 * accounting / valuation / interest are pure arithmetic — no stochastic
 * failure modes yet), so it does NOT call `ctx.rng.fork('BusinessSystem')`.
 * `Rng.fork()` advances the shared root RNG by exactly one draw BY DESIGN;
 * the BusinessSystem runs at slot #8, BEFORE AutomationSystem (slot #9) and
 * EnvironmentSystem (slot #10), both of which fork per-step — adding a fork
 * here would advance the root at slot #8, shifting the child seeds those
 * downstream systems derive and breaking the calibrated mortality / catch-up
 * death sequences pinned by the P7d determinism tests (verified empirically
 * for the analogous slot #10 case in P7d). The fork lands when (a)
 * stochastic business events arrive (equipment breakdown rolls, market
 * shocks) AND (b) the downstream RNG sequences are retuned, OR `fork()` is
 * refactored to a non-advancing sub-stream derivation. A determinism test in
 * `business.test.ts` pins the no-fork behaviour: the root RNG state is
 * unchanged across a BusinessSystem.execute when no businesses are present,
 * and the AutomationSystem/EnvironmentSystem RNG sequences are unaffected.
 *
 * The system is pure: it deep-copies the input state, mutates the copy, and
 * returns the new state. The input is NEVER mutated (TDD §4.1, §18.4).
 *
 * Rendering reads only — the rendering layer MUST NOT execute business
 * operations independently. This system is the single engine-side driver of
 * business production; the UI dispatches business actions to configure
 * businesses, but never runs them.
 */
import type { GameState, SimulationEvent } from '@capitalist-tree/shared';
import { PROVISIONAL_BUSINESS_BANKRUPTCY_THRESHOLD } from '@capitalist-tree/shared';
import type { System, SystemContext, SystemResult } from './system.js';
import { deepCopy } from '../deep-copy.js';
import { getBusinessTypeById } from '@capitalist-tree/content';
import { operateBusiness } from '../business/production.js';
import { checkBankruptcy } from '../business/accounting.js';
import { clearMarkets } from '../business/market.js';
import {
  applyInflationPressure,
  accrueDebtInterest,
  applyShareholderExpectations,
  applyCompetitionPressure,
} from '../business/growth-pressure.js';
import {
  recomputeValuation,
  shouldRecomputeValuation,
} from '../business/valuation.js';

export const businessSystem: System = {
  id: 'BusinessSystem',
  execute(state: GameState, ctx: SystemContext): SystemResult {
    let next: GameState = deepCopy(state);
    const events: SimulationEvent[] = [];

    // P8c: clearMarkets FIRST (before business operations) so businesses see
    // current clearing prices. Ensures all 8 GDD §8.5 commodity markets
    // (water, fertilizer, seeds, equipment, food, energy, labor, land) have
    // live MarketState entries + advances each market's price toward the
    // supply/demand equilibrium, bounded by
    // PROVISIONAL_BUSINESS_MARKET_PRICE_VOLATILITY per tick (GDD §8.5).
    // Emits one `market-price-changed` event per market whose price moved.
    // Even with zero businesses this runs so the market basket stays live
    // (the EconomySystem at slot #6 also updates markets; clearMarkets adds
    // the three P3b-deferred markets + the business-driven drift).
    const cleared = clearMarkets(next, ctx.now);
    next = cleared.state;
    events.push(...cleared.events);

    // Fast path — no businesses. clearMarkets above still ran (so the
    // deferred markets are registered + prices advance). Growth-pressure
    // helpers are no-ops on an empty businesses array. (Also pins the
    // no-fork contract: with no businesses the system consumes zero root
    // RNG draws, so the downstream AutomationSystem/EnvironmentSystem
    // sequences are unaffected.)
    if (next.businesses.length === 0) {
      return { state: next, events };
    }

    const dtSeconds = ctx.stepSeconds;
    const inflationIndex = next.economy.inflationIndex;

    // Iterate over a snapshot of the businesses array. operateBusiness does
    // NOT remove businesses (only the sell-business action does, which is an
    // action, not a system call), so the array identity is stable across the
    // loop. We re-fetch each business after every mutation (interest accrual,
    // operate, bankruptcy, valuation) so we always operate on fresh data.
    const snapshot = [...next.businesses];
    for (const business of snapshot) {
      // 1. Accrue interest on liabilities (GDD §8.4). Applied BEFORE
      //    production so this tick's bankruptcy check sees the grown
      //    accruedInterest. P8c: delegates to accrueDebtInterest (which
      //    accrues into `accruedInterest`, NOT principal — resolves P8b
      //    carry-forward #3). Pure: returns a new businesses array; we
      //    splice the liabilities onto the business only if something
      //    actually changed.
      const current0 = next.businesses.find((b) => b.id === business.id) ?? business;
      if (current0.liabilities.length > 0) {
        const accrued = accrueDebtInterest([current0], dtSeconds);
        const newLiabilities = accrued[0]!.liabilities;
        const changed =
          newLiabilities.length !== current0.liabilities.length ||
          newLiabilities.some((l, i) => l !== current0.liabilities[i]);
        if (changed) {
          next = {
            ...next,
            businesses: next.businesses.map((b) =>
              b.id === current0.id ? { ...b, liabilities: newLiabilities } : b,
            ),
          };
        }
      }

      // 2. Resolve the business type (content gate — a manually-constructed
      //    business whose `type` is not a registered definition skips
      //    production with a system event, degrading gracefully instead of
      //    crashing the tick).
      const current1 = next.businesses.find((b) => b.id === business.id) ?? business;
      const definition = getBusinessTypeById(current1.type);
      if (!definition) {
        events.push({
          type: 'system',
          at: ctx.now,
          payload: {
            systemId: 'BusinessSystem',
            message: `Business "${current1.id}" has unregistered type "${current1.type}" — skipped.`,
            data: { businessId: current1.id, typeId: current1.type },
          },
        });
        continue;
      }

      // 3. Run one production cycle (the shared orchestration). operateBusiness
      //    applies inputs/outputs/money/environmental impact onto the state
      //    and returns a new state + the business-operated event(s).
      const operated = operateBusiness(next, current1, definition, {
        now: ctx.now,
        dtSeconds,
      });
      next = operated.state;
      events.push(...operated.events);

      // 4. Check bankruptcy (TDD §5.7 / GDD §8.4). Re-fetch the business
      //    after production (cash may have moved). Emit business-bankrupt
      //    only on the fresh transition (pre-status !== 'bankrupt').
      const current2 = next.businesses.find((b) => b.id === business.id) ?? current1;
      const preStatus = current2.status;
      const bankruptcy = checkBankruptcy(current2);
      if (bankruptcy.bankrupt) {
        next = {
          ...next,
          businesses: next.businesses.map((b) =>
            b.id === current2.id ? bankruptcy.business : b,
          ),
        };
        if (preStatus !== 'bankrupt') {
          events.push({
            type: 'business-bankrupt',
            at: ctx.now,
            payload: {
              businessId: current2.id,
              cashAtBankruptcy: bankruptcy.business.cash,
              threshold: PROVISIONAL_BUSINESS_BANKRUPTCY_THRESHOLD,
              status: 'bankrupt',
            },
          });
        }
      }

      // 5. Periodically recompute valuation (TDD §11).
      const current3 = next.businesses.find((b) => b.id === business.id) ?? current2;
      if (shouldRecomputeValuation(current3, ctx.now)) {
        const revalued = recomputeValuation(current3, ctx.now);
        next = {
          ...next,
          businesses: next.businesses.map((b) =>
            b.id === current3.id ? revalued : b,
          ),
        };
      }
    }

    // P8c: apply growth-pressure mechanics AFTER the per-business production
    // loop so they reflect this tick's activity (GDD §8.4 Growth Pressure).
    //   - Inflation: operating costs (wageRate) rise with the economy's
    //     inflationIndex (read-only by business — TDD §10.6).
    //   - Shareholder expectations: corporations underperforming →
    //     notification + valuation reduction.
    //   - Competition: less-efficient businesses lose production rate when
    //     multiple businesses share an output market.
    // (Debt interest accrual is applied per-business in step 1 above, BEFORE
    // production, so the bankruptcy check sees the grown accruedInterest.)
    const inflationResult = applyInflationPressure(
      next.businesses,
      inflationIndex,
      dtSeconds,
      ctx.now,
    );
    next = { ...next, businesses: inflationResult.businesses };
    events.push(...inflationResult.events);

    const shareholderResult = applyShareholderExpectations(
      next.businesses,
      dtSeconds,
      ctx.now,
    );
    next = { ...next, businesses: shareholderResult.businesses };
    events.push(...shareholderResult.events);

    const competitionResult = applyCompetitionPressure(
      next.businesses,
      dtSeconds,
      ctx.now,
    );
    next = { ...next, businesses: competitionResult.businesses };
    events.push(...competitionResult.events);

    return { state: next, events };
  },
};
