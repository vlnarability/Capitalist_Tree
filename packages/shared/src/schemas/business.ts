import { z } from 'zod';

export const ownershipStateSchema = z.object({
  ownerId: z.string().min(1),
  // PROVISIONAL: organizational structure (GDD §8.3). P0 only supports
  // sole proprietorships. P7 will expand to corporation/coop/etc.
  structure: z.enum(['sole-proprietorship', 'corporation', 'cooperative', 'non-profit', 'state-owned']),
  share: z.number().min(0).max(1),
});
export type OwnershipState = z.infer<typeof ownershipStateSchema>;

export const businessAssetSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  value: z.string(),
});
export type BusinessAsset = z.infer<typeof businessAssetSchema>;

export const liabilitySchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  principal: z.string(),
  interestRate: z.number(),
  dueAt: z.number().int().nonnegative(),
});
export type Liability = z.infer<typeof liabilitySchema>;

export const productionStateSchema = z.object({
  inputResourceIds: z.array(z.string()),
  outputResourceId: z.string(),
  rate: z.number().nonnegative(),
  efficiency: z.number().min(0).max(1),
});
export type ProductionState = z.infer<typeof productionStateSchema>;

/**
 * Business state (TDD §5.7).
 *
 * Business cash/assets/liabilities are bigint minor units (string).
 * Valuation is separate from cash (TDD §5.7): an increase in asset valuation
 * does NOT automatically generate spendable money.
 */
export const businessStateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.string().min(1),
  ownership: ownershipStateSchema,
  cash: z.string(),
  assets: z.array(businessAssetSchema),
  liabilities: z.array(liabilitySchema),
  revenue: z.string(),
  expenses: z.string(),
  valuation: z.string(),
  employees: z.number().int().nonnegative(),
  production: productionStateSchema,
});
export type BusinessState = z.infer<typeof businessStateSchema>;
