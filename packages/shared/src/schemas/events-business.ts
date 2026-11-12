import { z } from 'zod';
import { environmentalImpactSchema } from './automation.js';

/**
 * Business-related SimulationEvent variants (P8a — TDD §5.7 / §11, GDD §8.1 /
 * §8.2 / §8.3 / §8.4 / §8.5).
 *
 * Added to the `SimulationEvent` discriminated union via
 * `packages/shared/src/schemas/events.ts`. P8a introduces the *schema*
 * layer only; the BusinessSystem that emits these events lands in P8b.
 *
 * Per TDD §11, business accounting is separate from personal accounting and
 * valuation ≠ liquidity. These events are the engine's *output* channel for
 * business activity: they tell the UI / audit layer what the BusinessSystem
 * and the business action handlers decided each tick without handing the
 * rendering layer the authority to run actions (rendering reads only — rule 8).
 *
 *   - `business-purchased`: the `purchase-business` action succeeded — money
 *     moved through the ledger and a new BusinessState was instantiated.
 *   - `business-operated`: a business ran production for a tick. Carries the
 *     production output + revenue + expenses + environmental impact so
 *     consumers can audit the operate step without reaching into state.
 *   - `business-sold`: a business was liquidated — valuation converted to
 *     cash with a haircut (TDD §11). Carries the proceeds, haircut fraction,
 *     settled liability total, and the player's resulting balance.
 *   - `loan-taken`: a Liability was created on a business. Carries the
 *     liability id, principal, interest rate, and dueAt.
 *   - `loan-repaid`: a Liability's principal was reduced. Carries the amount
 *     repaid (interest + principal split) and the remaining principal.
 *   - `business-bankrupt`: a business crossed
 *     `PROVISIONAL_BUSINESS_BANKRUPTCY_THRESHOLD` and the BusinessSystem
 *     flipped it to `bankrupt`. Carries the cash balance that triggered it
 *     and the resulting status.
 *   - `employees-hired` / `employees-laid-off`: headcount changes. Carry the
 *     delta and the new employee count.
 *
 * HOW TO EXTEND: add a new variant with a unique `type` literal. Do NOT
 * loosen the union with a catch-all.
 */

/**
 * `business-purchased` event — the `purchase-business` action succeeded.
 *
 * Emitted by the `purchase-business` action handler (P8b) after it debited
 * `cost` from `player:personal` via `transfer()` and appended a new
 * `BusinessState` to `state.businesses`. `cost` is the bigint minor-units
 * string that moved through the ledger (audit trail — pairs with the
 * `transaction-recorded` event from the underlying `transfer()`).
 *
 * `businessId` is the id of the freshly-instantiated business so the UI can
 * track the spawned entity alongside the purchase.
 */
export const businessPurchasedEventSchema = z.object({
  type: z.literal('business-purchased'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    /** Business type definition id that was purchased. */
    businessTypeId: z.string().min(1),
    /** Id of the business instantiated from the type. */
    businessId: z.string().min(1),
    /** Cost debited from `player:personal` (bigint minor units as string). */
    cost: z.string(),
    /** Player's resulting cash balance (after debit). */
    playerBalanceAfter: z.string(),
  }),
});
export type BusinessPurchasedEvent = z.infer<typeof businessPurchasedEventSchema>;

/**
 * `business-operated` event — a business ran production for a tick (GDD §8.2
 * supply chains, §8.4 growth pressure, §8.5 markets).
 *
 * Emitted by the BusinessSystem (P8b) and the `operate-business` action
 * handler after a production step. Carries the production output (resource
 * id + quantity produced), revenue recognized (sale of output into
 * `marketParticipation` markets), expenses incurred (wages + input costs),
 * and the environmental impact applied this tick (pillar 4). All money
 * amounts are bigint minor-units strings.
 *
 * When the operate step was skipped (status !== 'operating', insufficient
 * inputs, etc.), `operated` is `false` and `reason` carries a machine-
 * readable code (mirrors P6b2's `automation-skipped` reason field). The
 * production / revenue / expenses / environmentalImpact fields default to
 * their zero values in that case.
 */
export const businessOperatedEventSchema = z.object({
  type: z.literal('business-operated'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    /** Id of the business that operated. */
    businessId: z.string().min(1),
    /** Whether production actually ran. False when skipped (see `reason`). */
    operated: z.boolean(),
    /** When `operated === false`, why the operate step was skipped. Absent
     *  when `operated === true`. Mirrors `automation-skipped`'s reason. */
    reason: z
      .enum([
        'idle',
        'bankrupt',
        'liquidating',
        'insufficient-inputs',
        'insufficient-funds',
        'no-employees',
      ])
      .optional(),
    /** Output resource id produced this tick (matches `production.outputResourceId`). */
    outputResourceId: z.string(),
    /** Quantity of output produced this tick. 0 when skipped. */
    outputQuantity: z.number().nonnegative(),
    /** Revenue recognized this tick (bigint minor units as string). */
    revenue: z.string(),
    /** Expenses incurred this tick (bigint minor units as string) — wages + inputs. */
    expenses: z.string(),
    /** Environmental impact applied this tick (pillar 4 — reuses the P6 schema). */
    environmentalImpact: environmentalImpactSchema,
    /** Business cash balance after the operate step. */
    businessCashAfter: z.string(),
  }),
});
export type BusinessOperatedEvent = z.infer<typeof businessOperatedEventSchema>;

/**
 * `business-sold` event — a business was liquidated (TDD §11 — valuation ≠
 * liquidity; GDD §8.1 financial separation).
 *
 * Emitted by the `sell-business` action handler (P8b) after it settled
 * liabilities, applied the haircut, credited the residue to `player:personal`,
 * and removed the business from `state.businesses`. Carries the pre-haircut
 * valuation, the haircut fraction applied, the settled liability total, the
 * net proceeds credited to the player, and the player's resulting balance.
 *
 * All money amounts are bigint minor-units strings.
 */
export const businessSoldEventSchema = z.object({
  type: z.literal('business-sold'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    /** Id of the business that was sold. */
    businessId: z.string().min(1),
    /** Pre-haircut valuation (bigint minor units as string). */
    valuation: z.string(),
    /** Haircut fraction applied (PROVISIONAL_BUSINESS_VALUATION_HAIRCUT). */
    haircut: z.number(),
    /** Total liabilities settled from the proceeds (bigint minor units as string). */
    settledLiabilities: z.string(),
    /** Net proceeds credited to `player:personal` (bigint minor units as string). */
    proceeds: z.string(),
    /** Player's resulting cash balance (after credit). */
    playerBalanceAfter: z.string(),
  }),
});
export type BusinessSoldEvent = z.infer<typeof businessSoldEventSchema>;

/**
 * `loan-taken` event — a Liability was created on a business (GDD §8.4 debt
 * and interest growth pressure).
 *
 * Emitted by the `take-loan` action handler (P8b) after it appended a
 * `Liability` to `business.liabilities` and credited the principal to the
 * business's cash via an authority issuance. Carries the liability id,
 * principal, interest rate, and dueAt so consumers can audit the loan
 * without reaching into state. Pairs with the `transaction-recorded` event
 * from the underlying issuance.
 */
export const loanTakenEventSchema = z.object({
  type: z.literal('loan-taken'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    /** Id of the business that took the loan. */
    businessId: z.string().min(1),
    /** Id of the liability created. */
    liabilityId: z.string().min(1),
    /** Loan principal (bigint minor units as string). */
    principal: z.string(),
    /** Annualized interest rate (fraction). */
    interestRate: z.number(),
    /** Simulation second at which the loan matures. */
    dueAt: z.number().int().nonnegative(),
    /** Business cash balance after the principal was credited. */
    businessCashAfter: z.string(),
  }),
});
export type LoanTakenEvent = z.infer<typeof loanTakenEventSchema>;

/**
 * `loan-repaid` event — a Liability's principal was reduced (GDD §8.4).
 *
 * Emitted by the `repay-loan` action handler (P8b) after it debited the
 * business's cash and sunk the repayment to the authority. Carries the
 * interest portion (paid first), the principal portion, the total repaid,
 * and the remaining principal on the liability. Pairs with the
 * `transaction-recorded` event from the underlying sink.
 */
export const loanRepaidEventSchema = z.object({
  type: z.literal('loan-repaid'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    /** Id of the business that repaid the loan. */
    businessId: z.string().min(1),
    /** Id of the liability repaid. */
    liabilityId: z.string().min(1),
    /** Interest portion of the repayment (bigint minor units as string). */
    interestPaid: z.string(),
    /** Principal portion of the repayment (bigint minor units as string). */
    principalPaid: z.string(),
    /** Total repaid = interestPaid + principalPaid (bigint minor units as string). */
    totalRepaid: z.string(),
    /** Remaining principal on the liability after the repayment. */
    remainingPrincipal: z.string(),
    /** Business cash balance after the debit. */
    businessCashAfter: z.string(),
  }),
});
export type LoanRepaidEvent = z.infer<typeof loanRepaidEventSchema>;

/**
 * `business-bankrupt` event — a business crossed
 * `PROVISIONAL_BUSINESS_BANKRUPTCY_THRESHOLD` (GDD §8.4 growth pressure).
 *
 * Emitted by the BusinessSystem (P8b) when a business's cash drops below the
 * bankruptcy threshold (e.g. wages pushed it negative). The BusinessSystem
 * flips `status` to `'bankrupt'` and emits this event so the UI can surface
 * the failure. A bankrupt business stops producing; the player can either
 * inject capital (a future `transfer` to the business account, P8c+) or
 * liquidate via `sell-business`.
 */
export const businessBankruptEventSchema = z.object({
  type: z.literal('business-bankrupt'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    /** Id of the business that went bankrupt. */
    businessId: z.string().min(1),
    /** Cash balance that triggered the bankruptcy (bigint minor units as string). */
    cashAtBankruptcy: z.string(),
    /** Bankruptcy threshold constant in effect (bigint minor units as string). */
    threshold: z.string(),
    /** Resulting status — always `'bankrupt'`. */
    status: z.literal('bankrupt'),
  }),
});
export type BusinessBankruptEvent = z.infer<typeof businessBankruptEventSchema>;

/**
 * `employees-hired` event — a business's headcount increased (GDD §8.4 labor
 * costs).
 *
 * Emitted by the `hire-employees` action handler (P8b). Carries the delta and
 * the new employee count so consumers can audit the headcount change without
 * reaching into state.
 */
export const employeesHiredEventSchema = z.object({
  type: z.literal('employees-hired'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    /** Id of the business that hired. */
    businessId: z.string().min(1),
    /** Number of employees hired. */
    count: z.number().int().positive(),
    /** Employee count after the hire. */
    employeesAfter: z.number().int().nonnegative(),
  }),
});
export type EmployeesHiredEvent = z.infer<typeof employeesHiredEventSchema>;

/**
 * `employees-laid-off` event — a business's headcount decreased (GDD §8.4).
 *
 * Emitted by the `lay-off-employees` action handler (P8b). Carries the delta
 * (clamped at the pre-existing count — cannot go negative) and the new
 * employee count.
 */
export const employeesLaidOffEventSchema = z.object({
  type: z.literal('employees-laid-off'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    /** Id of the business that laid off. */
    businessId: z.string().min(1),
    /** Number of employees actually laid off (may be less than requested if
     *  the request would have driven the count below 0). */
    count: z.number().int().positive(),
    /** Employee count after the layoff. */
    employeesAfter: z.number().int().nonnegative(),
  }),
});
export type EmployeesLaidOffEvent = z.infer<typeof employeesLaidOffEventSchema>;
