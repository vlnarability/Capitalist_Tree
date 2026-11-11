import { z } from 'zod';

/**
 * Living expenses (GDD §7.1, TDD §5.3).
 * Stored in minor currency units (bigint-as-string).
 *
 * Each field is the *monthly* (per billing cycle) amount the player owes for
 * that category. P3c's PersonalSystem schedules a `bill-due` event every
 * PROVISIONAL_PERSONAL_BILLING_INTERVAL_DAYS sim days; when the bill fires,
 * the system attempts to pay each category out of `player:personal` (sinking
 * the cash to the central monetary authority, category `'expense'`).
 */
export const livingExpensesSchema = z.object({
  food: z.string(),
  housing: z.string(),
  utilities: z.string(),
  healthcare: z.string(),
  transportation: z.string(),
});
export type LivingExpenses = z.infer<typeof livingExpensesSchema>;

/**
 * The five living-expense categories (GDD §7.1). Used as the discriminant on
 * `pay-expense` actions and as the key into `LivingExpenses`. Exported as a
 * readonly tuple so consumers can iterate without re-listing.
 */
export const LIVING_EXPENSE_CATEGORIES = [
  'food',
  'housing',
  'utilities',
  'healthcare',
  'transportation',
] as const;
export type LivingExpenseCategory = (typeof LIVING_EXPENSE_CATEGORIES)[number];

export const employmentStateSchema = z.object({
  jobTitle: z.string(),
  employerId: z.string(),
  monthlyIncome: z.string(),
  hoursPerWeek: z.number().nonnegative(),
});
export type EmploymentState = z.infer<typeof employmentStateSchema>;

/**
 * Player personal state (TDD §5.3).
 *
 * Personal and business finances MUST remain separate (GDD §8.1). All money
 * fields are bigint minor units (TDD §10.1) serialized as strings.
 *
 * `health`, `happiness`, `financialSecurity` are derived indicators in
 * [0, 1]. P0 leaves them at neutral values; PersonalSystem (P3c) computes
 * them from underlying drivers each tick (GDD §7.2).
 *
 * P3c additions:
 *   - `unpaidDays`: cumulative counter of unpaid living-expense days. Each
 *     time a bill comes due and the player cannot pay, the counter advances
 *     by `PROVISIONAL_PERSONAL_BILLING_INTERVAL_DAYS` (one full billing
 *     cycle of unpaid living costs). Physical health is derived with a
 *     diminishing-returns penalty from this counter (GDD §7.2, §7.3). The
 *     counter decays slowly when bills are paid on time (recovery).
 */
export const playerStateSchema = z.object({
  // bigint minor units — stored as string for safe JSON round-trip.
  personalCash: z.string(),
  assets: z.string(),
  liabilities: z.string(),
  health: z.number().min(0).max(1),
  happiness: z.number().min(0).max(1),
  financialSecurity: z.number().min(0).max(1),
  livingExpenses: livingExpensesSchema,
  employment: employmentStateSchema.optional(),
  /** P3c: cumulative unpaid living-expense days (health driver). Defaults to
   *  0 for fresh saves + backfilled to 0 by the v6 → v7 migration. */
  unpaidDays: z.number().int().nonnegative().default(0),
});
export type PlayerState = z.infer<typeof playerStateSchema>;
