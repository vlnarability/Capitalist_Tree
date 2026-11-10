import { z } from 'zod';

/**
 * Transaction record (TDD §10.4).
 *
 * Every currency movement is recorded with source and destination accounts
 * (TDD §10.4). `amount` is bigint minor units serialized as string.
 */
export const transactionRecordSchema = z.object({
  id: z.string().min(1),
  timestamp: z.number().int().nonnegative(),
  sourceAccount: z.string(),
  destinationAccount: z.string(),
  amount: z.string(),
  category: z.string(),
  description: z.string(),
});
export type TransactionRecord = z.infer<typeof transactionRecordSchema>;

export const monetaryAuthorityStateSchema = z.object({
  monetarySupply: z.string(),
  interestRate: z.number(),
  inflationTarget: z.number(),
});
export type MonetaryAuthorityState = z.infer<typeof monetaryAuthorityStateSchema>;

export const marketStateSchema = z.object({
  id: z.string().min(1),
  commodityId: z.string().min(1),
  price: z.string(),
  supply: z.number(),
  demand: z.number(),
});
export type MarketState = z.infer<typeof marketStateSchema>;

/**
 * Economy state (TDD §5.6).
 *
 * All monetary amounts are bigint minor units serialized as string.
 * P0 initializes an empty transaction log and a single starting market for
 * the default currency; later phases populate markets and authority policy.
 */
export const economyStateSchema = z.object({
  monetarySupply: z.string(),
  inflationRate: z.number(),
  interestRate: z.number(),
  monetaryAuthority: monetaryAuthorityStateSchema,
  markets: z.array(marketStateSchema),
  transactions: z.array(transactionRecordSchema),
});
export type EconomyState = z.infer<typeof economyStateSchema>;
