import { z } from 'zod';

/**
 * Historical state (TDD §5.1).
 *
 * Long-term records: snapshots, transaction history summaries, season/year
 * summaries. P0 keeps an empty history. Persisted history is essential for
 * offline catch-up and prestige (GDD §11.2).
 */
export const historySnapshotSchema = z.object({
  at: z.number().int().nonnegative(),
  day: z.number().int().nonnegative(),
  summary: z.record(z.string(), z.unknown()),
});
export type HistorySnapshot = z.infer<typeof historySnapshotSchema>;

export const historicalStateSchema = z.object({
  snapshots: z.array(historySnapshotSchema),
  // Bounded event log for archive purposes (UI keeps its own short-term log).
  archive: z.array(
    z.object({
      at: z.number().int().nonnegative(),
      kind: z.string(),
      payload: z.unknown(),
    }),
  ),
});
export type HistoricalState = z.infer<typeof historicalStateSchema>;
