import { z } from 'zod';
import { businessStatusSchema } from './business.js';

/**
 * Business-related GameAction variants (P8a — TDD §5.7 / §11, GDD §8.1 / §8.2 /
 * §8.3 / §8.4 / §8.5).
 *
 * Added to the `GameAction` discriminated union via
 * `packages/shared/src/schemas/actions.ts`. P8a introduces the *schema*
 * layer only; the action handlers + BusinessSystem land in P8b. The variants:
 *
 *   - `purchase-business`: instantiate a business from a BusinessTypeDefinition
 *     (content gate). Debits the base cost from `player:personal` via P3a's
 *     `transfer()` (category `'business-purchase'`) — money moves through the
 *     economy ledger (pillar 1: spending moves money, it doesn't vanish).
 *   - `operate-business`: run production for one tick. Resolves inputs (from
 *     inventory / upstream suppliers), applies wages + expenses, produces
 *     output, records revenue, applies environmental impact. Pure transform;
 *     the BusinessSystem (P8b) is the canonical per-tick driver but this
 *     action lets the player manually trigger an operate step.
 *   - `sell-business`: liquidate a business — valuation converts to cash with
 *     a haircut (PROVISIONAL_BUSINESS_VALUATION_HAIRCUT, TDD §11 — valuation
 *     ≠ liquidity; you get a fraction of the valuation in spendable cash).
 *     Remaining liabilities are settled from the proceeds before the player
 *     receives the residue.
 *   - `take-loan`: create a Liability on a business (GDD §8.4 debt/interest
 *     growth pressure). The principal is credited to the business's cash via
 *     an authority issuance (the loan principal is new money — the
 *     conservation invariant still holds because the Liability offsets it on
 *     the balance sheet).
 *   - `repay-loan`: reduce a Liability's principal (debit business cash,
 *     sink to the authority). The `amount` is capped at the outstanding
 *     principal.
 *   - `hire-employees` / `lay-off-employees`: adjust the business's
 *     `employees` count. Hiring raises the production capacity but raises
 *     the wage bill (GDD §8.4 labor costs); laying off reduces both.
 *   - `set-business-status`: flip a business between `operating` and `idle`
 *     (player-chosen pause). Setting `bankrupt` / `liquidating` via this
 *     action is rejected — those transitions are system-internal (the
 *     BusinessSystem flips to `bankrupt` when cash crosses
 *     PROVISIONAL_BUSINESS_BANKRUPTCY_THRESHOLD; `sell-business` flips to
 *     `liquidating` during wind-down).
 *
 * All money movements use bigint minor-units strings (TDD §10.1) — money is
 * bigint, never floating point.
 *
 * HOW TO EXTEND: add a new variant with a unique `type` literal. Register a
 * handler in `packages/simulation/src/actions/handlers.ts`. Keep actions pure
 * — never mutate input state. Reject unknown action types with
 * `UnknownActionError` (handled centrally by `executeAction`).
 *
 * Re-exported from `packages/shared/src/schemas/actions.ts` so consumers can
 * `import { PurchaseBusinessAction } from '@capitalist-tree/shared'`.
 */

/**
 * `purchase-business` action — buy a business type and instantiate it.
 *
 * The handler (P8b):
 *   1. Resolves the business type by `businessTypeId` via `getBusinessTypeById`
 *      (content gate — unknown id raises `UnknownBusinessTypeError`).
 *   2. Debits `definition.baseCost` from `player:personal` via P3a's
 *      `transfer()` (category `'business-purchase'`) — money moves through
 *      the ledger, never destroyed (pillar 1).
 *   3. Derives a `BusinessState` from the definition: `supplyChainLevel`,
 *      `production`, `wageRate`, `environmentalImpact`, `marketParticipation`
 *      come from the definition; `cash` starts at 0 (the purchase price went
 *      to the seller, not the business); `employees` starts at
 *      `definition.baseEmployees`; P8a operational fields (`status`,
 *      `lastOperatedAt`, `upstreamSupplierIds`, `downstreamCustomerIds`,
 *      `lastValuationTick`) start at their defaults.
 *   4. Appends the new BusinessState to `state.businesses` with a
 *      deterministic id.
 *   5. Emits a `business-purchased` event carrying the cost + the new
 *      business id.
 *
 * `ownership.structure` defaults to `'sole-proprietorship'` (the player owns
 * 100% via `player:personal`); `share` is `1.0`. Future actions (P8c+) will
 * let the player restructure ownership (GDD §8.3 — corporation / cooperative
 * / sustainable-enterprise / non-profit / state-owned).
 */
export const purchaseBusinessActionSchema = z.object({
  type: z.literal('purchase-business'),
  payload: z.object({
    /** Business type id (must be registered in `packages/content/src/businesses/`). */
    businessTypeId: z.string().min(1),
    /** Optional override for the instantiated business's display name. The
     *  handler defaults to the definition's `name` if omitted. */
    name: z.string().min(1).optional(),
  }),
});
export type PurchaseBusinessAction = z.infer<typeof purchaseBusinessActionSchema>;

/**
 * `operate-business` action — run production for one tick (GDD §8.2 supply
 * chains, §8.4 growth pressure, §8.5 markets).
 *
 * The handler (P8b) performs the production transform: resolves inputs (from
 * the business's own inventory, from `upstreamSupplierIds`, or from the
 * commodity markets), pays wages (debit business cash, sink to authority for
 * external labor / credit to `player:personal` for owner-employed labor),
 * produces the `outputResourceId` at `production.rate * efficiency` (scaled
 * by `PROVISIONAL_BUSINESS_EMPLOYEE_PRODUCTIVITY` and the employee count),
 * records revenue from selling output into `marketParticipation` markets,
 * and applies the per-business environmental impact (reusing the P6
 * environmentalImpactSchema — pillar 4).
 *
 * The action is a no-op if `status !== 'operating'` (the handler emits a
 * `business-operated` event with `operated: false` and a `reason` code in
 * that case, mirroring P6b2's graceful `automation-skipped` pattern).
 *
 * `tick` is the simulation second at which the operate step runs — explicit
 * so the action payload fully describes the result (determinism — TDD §18.3).
 */
export const operateBusinessActionSchema = z.object({
  type: z.literal('operate-business'),
  payload: z.object({
    /** Id of the business to operate (must exist in `state.businesses`). */
    businessId: z.string().min(1),
    /** Simulation second at which the operate step runs. */
    tick: z.number().int().nonnegative(),
  }),
});
export type OperateBusinessAction = z.infer<typeof operateBusinessActionSchema>;

/**
 * `sell-business` action — liquidate a business (TDD §11 — valuation ≠
 * liquidity; GDD §8.1 financial separation).
 *
 * The handler (P8b):
 *   1. Looks up the business by `businessId`; rejects the original tree's
 *      owner-business (if any) with `OriginalTreeNotTransferableError`
 *      (GDD §16.1/16.2 — invariant). For P8a the original tree is not a
 *      business, so this guard is defensive.
 *   2. Flips `status` to `'liquidating'`.
 *   3. Settles outstanding liabilities from `cash` + the liquidation
 *      proceeds (debited first, sink to authority for the principal; interest
 *      accrual handled by the BusinessSystem).
 *   4. Computes the haircut: `proceeds = valuation * (1 -
 *      PROVISIONAL_BUSINESS_VALUATION_HAIRCUT)`. The haircut reflects the
 *      illiquidity discount — you cannot spend valuation directly (TDD §11);
 *      liquidating converts it to cash at a loss.
 *   5. Credits the residue (proceeds minus settled liabilities) to
 *      `player:personal` via `transfer()` (category `'business-sale'`).
 *   6. Removes the business from `state.businesses`.
 *   7. Emits a `business-sold` event carrying the proceeds, haircut, settled
 *      liability total, and the player's resulting balance.
 */
export const sellBusinessActionSchema = z.object({
  type: z.literal('sell-business'),
  payload: z.object({
    /** Id of the business to liquidate. */
    businessId: z.string().min(1),
    /** Simulation second at which the sale runs (deterministic event `at`). */
    tick: z.number().int().nonnegative(),
  }),
});
export type SellBusinessAction = z.infer<typeof sellBusinessActionSchema>;

/**
 * `take-loan` action — create a Liability on a business (GDD §8.4 debt and
 * interest growth pressure).
 *
 * The handler (P8b) appends a `Liability` to `business.liabilities` with the
 * given `principal`, `interestRate`, and `dueAt`. The `principal` is credited
 * to the business's `cash` via an authority issuance (the loan is new money
 * — the conservation invariant holds because the Liability offsets it on the
 * balance sheet: `assets - liabilities` is unchanged by the issuance). The
 * BusinessSystem accrues interest each tick (GDD §8.4).
 *
 * `principal` is a positive bigint minor-units string. `interestRate` is an
 * annualized fraction (e.g. 0.05 = 5% / year); the handler defaults it to
 * `PROVISIONAL_BUSINESS_LOAN_DEFAULT_RATE` if omitted — but the schema
 * requires the caller to be explicit (determinism — TDD §18.3). `dueAt` is
 * the simulation second at which the loan matures.
 */
export const takeLoanActionSchema = z.object({
  type: z.literal('take-loan'),
  payload: z.object({
    /** Id of the business taking the loan. */
    businessId: z.string().min(1),
    /** Loan principal (bigint minor units as string, > 0). */
    principal: z.string().min(1),
    /** Annualized interest rate (fraction). */
    interestRate: z.number(),
    /** Simulation second at which the loan matures. */
    dueAt: z.number().int().nonnegative(),
    /** Optional human-readable label for the liability record. */
    label: z.string().min(1).optional(),
  }),
});
export type TakeLoanAction = z.infer<typeof takeLoanActionSchema>;

/**
 * `repay-loan` action — reduce a Liability's principal (GDD §8.4).
 *
 * The handler (P8b) debits `amount` from the business's `cash` (capped at the
 * outstanding principal — overpayment is rejected with
 * `InsufficientFundsError` if the business cannot cover the requested
 * amount, or silently capped at the outstanding principal if `amount` exceeds
 * it). The debited amount is sunk to the authority (the loan principal was
 * issued money; repaying destroys it, mirroring P3c's expense sink). Interest
 * accrued to date is paid first, then principal.
 *
 * `liabilityId` MUST match an entry in `business.liabilities`; an unknown id
 * raises `UnknownLiabilityError` (P8b).
 */
export const repayLoanActionSchema = z.object({
  type: z.literal('repay-loan'),
  payload: z.object({
    /** Id of the business repaying the loan. */
    businessId: z.string().min(1),
    /** Id of the liability being repaid (must exist on the business). */
    liabilityId: z.string().min(1),
    /** Amount to repay (bigint minor units as string, > 0). */
    amount: z.string().min(1),
    /** Simulation second at which the repayment runs (deterministic event `at`). */
    tick: z.number().int().nonnegative(),
  }),
});
export type RepayLoanAction = z.infer<typeof repayLoanActionSchema>;

/**
 * `hire-employees` action — increase a business's `employees` count (GDD §8.4
 * labor costs).
 *
 * The handler (P8b) increments `business.employees` by `count`. Hiring raises
 * the production capacity (the BusinessSystem scales output by
 * `PROVISIONAL_BUSINESS_EMPLOYEE_PRODUCTIVITY * employees`) but also raises
 * the wage bill (debit business cash each pay period by
 * `wageRate * employees`). The handler does NOT pre-check solvency — the
 * BusinessSystem flips the business to `bankrupt` if wages push cash below
 * `PROVISIONAL_BUSINESS_BANKRUPTCY_THRESHOLD` (graceful failure, mirrors
 * P3c's unpaid-expense handling, GDD §16.3).
 */
export const hireEmployeesActionSchema = z.object({
  type: z.literal('hire-employees'),
  payload: z.object({
    /** Id of the business hiring. */
    businessId: z.string().min(1),
    /** Number of employees to hire (>= 1). */
    count: z.number().int().positive(),
  }),
});
export type HireEmployeesAction = z.infer<typeof hireEmployeesActionSchema>;

/**
 * `lay-off-employees` action — decrease a business's `employees` count.
 *
 * The handler (P8b) decrements `business.employees` by `count`, clamped at 0
 * (cannot go negative). Laying off reduces both production capacity and the
 * wage bill. The handler does NOT charge severance in P8a — that is a
 * provisional tuning decision deferred to P8c (GDD §17 — labor model).
 */
export const layOffEmployeesActionSchema = z.object({
  type: z.literal('lay-off-employees'),
  payload: z.object({
    /** Id of the business laying off. */
    businessId: z.string().min(1),
    /** Number of employees to lay off (>= 1). */
    count: z.number().int().positive(),
  }),
});
export type LayOffEmployeesAction = z.infer<typeof layOffEmployeesActionSchema>;

/**
 * `set-business-status` action — flip a business between `operating` and
 * `idle` (player-chosen pause).
 *
 * The handler (P8b) sets `business.status` to the requested value. Only
 * `operating` and `idle` are accepted here — `bankrupt` and `liquidating`
 * are system-internal transitions (the BusinessSystem flips to `bankrupt`
 * when cash crosses the bankruptcy threshold; `sell-business` flips to
 * `liquidating` during wind-down). Requesting either of those via this
 * action raises `InvalidBusinessStatusError` (P8b).
 *
 * Idempotent — setting `status` to its current value is a no-op (the handler
 * emits no event in that case, mirroring P6b2's `enable-automation` /
 * `disable-automation` idempotency).
 */
export const setBusinessStatusActionSchema = z.object({
  type: z.literal('set-business-status'),
  payload: z.object({
    /** Id of the business to reconfigure. */
    businessId: z.string().min(1),
    /** New status. Only `operating` and `idle` are valid via this action. */
    status: businessStatusSchema,
  }),
});
export type SetBusinessStatusAction = z.infer<typeof setBusinessStatusActionSchema>;
