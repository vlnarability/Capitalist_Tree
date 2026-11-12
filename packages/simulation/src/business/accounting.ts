/**
 * Business accounting (P8b — TDD §5.7 Business State, §11 Personal and
 * Business Accounting; GDD §8.1 Financial Separation, §8.4 Growth Pressure).
 *
 * Pure helpers for the financial side of a business:
 *   - `parseBusinessAmount`: parse a business cash/revenue/expenses/
 *     valuation bigint string (mirrors `economy/ledger.ts` `parseAmount` but
 *     local — the business module owns its own parse so tests don't need to
 *     reach into the economy ledger).
 *   - `addAmount` / `subAmount`: bigint string arithmetic returning a new
 *     bigint string (never mutate; never produce NaN — a malformed input
 *     throws `InvalidAmountError`).
 *   - `sumLiabilities`: total outstanding principal on a business.
 *   - `applyRevenue` / `applyExpenses`: update `business.cash` +
 *     `business.revenue` / `business.expenses` accumulators. These return a
 *     NEW BusinessState — the actual money movement (the ledger `transfer()`
 *     call) is the BusinessSystem's / action handler's job; these helpers
 *     only recompute the business-side denormalized fields after the transfer
 *     landed. TDD §11 — valuation ≠ liquidity: revenue increases cash
 *     (spendable), expenses decrease cash; valuation is NOT touched here.
 *   - `accrueInterest`: advance each liability's principal by the annualized
 *     interest × the step fraction (GDD §8.4 debt and interest growth
 *     pressure). Pure — returns a new liabilities array.
 *   - `checkBankruptcy`: if `business.cash < PROVISIONAL_BUSINESS_BANKRUPTCY_THRESHOLD`,
 *     the business transitions to `status: 'bankrupt'` (TDD §5.7 / GDD §8.4).
 *     Returns `{ bankrupt: boolean, state: BusinessState }` so the caller can
 *     emit the `business-bankrupt` event when the transition fires.
 *
 * All monetary amounts are bigint minor units serialized as string (TDD §10.1)
 * — money is bigint, never floating point. Revenue / expenses are
 * denormalized on the BusinessState for the UI / audit trail; the economy
 * ledger (`economy.accounts[<businessId>]`) is the source of truth for the
 * cash balance, mirrored onto `business.cash` by the BusinessSystem after
 * each transfer (same coupling as `player.personalCash`).
 *
 * Pure: every helper returns a new value / new BusinessState; the input is
 * NEVER mutated (TDD §4.1, §18.4).
 */
import type { BusinessState, Liability } from '@capitalist-tree/shared';
import { PROVISIONAL_BUSINESS_BANKRUPTCY_THRESHOLD } from '@capitalist-tree/shared';
import { InvalidAmountError } from '../economy/errors.js';

/** Parse a business monetary field (cash / revenue / expenses / valuation /
 *  wageRate / liability principal) as bigint. Throws `InvalidAmountError` on
 *  a malformed string. Negative values are permitted (cash can overdraft up
 *  to the bankruptcy threshold; expenses/revenue are non-negative in
 *  practice but the parse does not enforce a sign — the ledger does). */
export function parseBusinessAmount(amount: string, field = 'amount'): bigint {
  if (typeof amount !== 'string' || amount.length === 0) {
    throw new InvalidAmountError(
      String(amount),
      `${field} must be a non-empty bigint string`,
    );
  }
  try {
    return BigInt(amount);
  } catch {
    throw new InvalidAmountError(
      String(amount),
      `${field} is not a valid bigint string`,
    );
  }
}

/** bigint string addition: `(a + b)` as a base-10 string. */
export function addAmount(a: string, b: string): string {
  return (parseBusinessAmount(a, 'a') + parseBusinessAmount(b, 'b')).toString(10);
}

/** bigint string subtraction: `(a - b)` as a base-10 string. May go negative
 *  (cash can overdraft). */
export function subAmount(a: string, b: string): string {
  return (parseBusinessAmount(a, 'a') - parseBusinessAmount(b, 'b')).toString(10);
}

/** Sum of all liability principals on a business, as a bigint. */
export function sumLiabilities(business: BusinessState): bigint {
  return business.liabilities.reduce(
    (sum, l) => sum + parseBusinessAmount(l.principal, 'principal'),
    0n,
  );
}

/** Sum of all asset values on a business, as a bigint. */
export function sumAssets(business: BusinessState): bigint {
  return business.assets.reduce(
    (sum, a) => sum + parseBusinessAmount(a.value, 'value'),
    0n,
  );
}

/**
 * Apply recognized revenue to a business's accounting fields.
 *
 * Increases `business.cash` and `business.revenue` by `amount`. Does NOT
 * touch `business.valuation` — valuation is recomputed on a slower cadence by
 * `valuation.ts` (TDD §11 — valuation ≠ liquidity; an increase in revenue
 * does NOT automatically generate spendable money beyond the cash the
 * transfer already credited).
 *
 * Returns a NEW BusinessState. The caller is responsible for the actual
 * money movement (the `transfer()` that credited the business's cash account);
 * this helper only re-syncs the denormalized BusinessState fields to match
 * the post-transfer ledger balance.
 *
 * Pure: the input business is never mutated.
 */
export function applyRevenue(business: BusinessState, amount: bigint): BusinessState {
  if (amount === 0n) return business;
  const delta = amount.toString(10);
  return {
    ...business,
    cash: addAmount(business.cash, delta),
    revenue: addAmount(business.revenue, delta),
  };
}

/**
 * Apply incurred expenses to a business's accounting fields.
 *
 * Decreases `business.cash` and increases `business.expenses` by `amount`.
 * Cash may go negative (overdraft up to the bankruptcy threshold — the
 * BusinessSystem checks `checkBankruptcy` after expenses land). Does NOT
 * touch `business.valuation`.
 *
 * Returns a NEW BusinessState. The caller is responsible for the actual
 * money movement (the `transfer()` that debited the business's cash account).
 *
 * Pure: the input business is never mutated.
 */
export function applyExpenses(business: BusinessState, amount: bigint): BusinessState {
  if (amount === 0n) return business;
  const delta = amount.toString(10);
  return {
    ...business,
    cash: subAmount(business.cash, delta),
    expenses: addAmount(business.expenses, delta),
  };
}

/**
 * Accrue interest on every liability for one step (GDD §8.4 debt and interest
 * growth pressure).
 *
 * P8c (resolves P8b carry-forward #3): interest accrues SEPARATELY into the
 * liability's `accruedInterest` field — it is NO LONGER compounded into
 * `principal`. The `repay-loan` action pays `accruedInterest` FIRST, then
 * reduces `principal`. This matches the schema doc's contract ("interest
 * accrued to date is paid first, then principal").
 *
 * For each liability, the accrued interest grows by `principal × interestRate
 * × dtFraction`, where `dtFraction = dtSeconds / SECONDS_PER_YEAR` (the
 * interestRate is annualized). Uses bigint floor addition for the accrued
 * interest (no fractional currency — TDD §10.1). Liabilities with
 * `interestRate === 0` are unchanged. A liability whose per-tick accrual
 * rounds down to 0 (small principal × small rate × short step) accrues
 * nothing this tick — @provisional, a fractional accumulator would smooth
 * this, but the per-tick floor is the starter model.
 *
 * Pure: returns a NEW liabilities array; the input is never mutated.
 *
 * @provisional (GDD §17: debt and interest model) — the simple-interest
 * accrual into a separate `accruedInterest` field is a starter model; a
 * future phase may compound unpaid accrued interest (add accrued to principal
 * when it crosses a threshold).
 */
export function accrueInterest(
  liabilities: readonly Liability[],
  dtSeconds: number,
): Liability[] {
  const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;
  const dtFraction = dtSeconds / SECONDS_PER_YEAR;
  if (liabilities.length === 0) return [...liabilities];
  return liabilities.map((l) => {
    if (l.interestRate === 0) return l;
    const principal = parseBusinessAmount(l.principal, 'principal');
    const alreadyAccrued = parseBusinessAmount(l.accruedInterest, 'accruedInterest');
    // Accrued interest = principal × rate × dtFraction, floored to minor units.
    // Use Number for the rate × dtFraction product (small fraction), then
    // multiply back into bigint via BigInt(Math.floor(...)). Safe for P8c
    // magnitudes (principals well under 2^53 minor units).
    const accrualFraction = l.interestRate * dtFraction;
    const accruedThisTick = BigInt(
      Math.floor(Number(principal) * accrualFraction),
    );
    if (accruedThisTick <= 0n) return l;
    return {
      ...l,
      accruedInterest: (alreadyAccrued + accruedThisTick).toString(10),
    };
  });
}

/**
 * Check whether a business has crossed the bankruptcy threshold.
 *
 * `bankrupt` iff `business.cash < PROVISIONAL_BUSINESS_BANKRUPTCY_THRESHOLD`
 * (e.g. cash < -1000 minor = -$10.00 overdraft tolerance). When bankrupt,
 * the returned BusinessState has `status: 'bankrupt'` (a bankrupt business
 * stops producing until the player injects capital or liquidates it). A
 * business already `bankrupt` stays bankrupt; a `liquidating` business is
 * never flipped to bankrupt here (the sale flow owns that status).
 *
 * Returns `{ bankrupt, business }`:
 *   - `bankrupt: true` + the business with `status: 'bankrupt'` when the
 *     threshold was crossed AND the business was not already bankrupt /
 *     liquidating. (`bankrupt: true` also when already bankrupt — the caller
 *     emits the event only on the fresh transition, which it can detect by
 *     comparing the pre-status.)
 *   - `bankrupt: false` + the business unchanged otherwise.
 *
 * Pure: the input business is never mutated.
 */
export function checkBankruptcy(
  business: BusinessState,
): { bankrupt: boolean; business: BusinessState } {
  const threshold = parseBusinessAmount(
    PROVISIONAL_BUSINESS_BANKRUPTCY_THRESHOLD,
    'bankruptcyThreshold',
  );
  const cash = parseBusinessAmount(business.cash, 'cash');
  if (cash < threshold) {
    // Don't flip a liquidating business to bankrupt (the sale owns that status).
    if (business.status === 'liquidating') {
      return { bankrupt: false, business };
    }
    return { bankrupt: true, business: { ...business, status: 'bankrupt' } };
  }
  return { bankrupt: false, business };
}
