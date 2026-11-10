import { z } from 'zod';

/**
 * Living expenses (GDD §7.1, TDD §5.3).
 * Stored in minor currency units (bigint-as-string).
 */
export const livingExpensesSchema = z.object({
  food: z.string(),
  housing: z.string(),
  utilities: z.string(),
  healthcare: z.string(),
  transportation: z.string(),
});
export type LivingExpenses = z.infer<typeof livingExpensesSchema>;

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
 * [0, 1]. P0 leaves them at neutral values; PersonalSystem (P3) computes
 * them from underlying drivers.
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
});
export type PlayerState = z.infer<typeof playerStateSchema>;
