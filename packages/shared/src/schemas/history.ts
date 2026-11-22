import { z } from 'zod';
import { PROVISIONAL_EVENT_MAX_HISTORY } from '../constants/events.js';

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
  /** P11 (W39 / RV5-F2 follow-up): bounded at parse time to
   *  `PROVISIONAL_EVENT_MAX_HISTORY` (most-recent N kept). `snapshots` is not
   *  populated today (always `[]` — placeholder for future snapshotting), so
   *  this is a forward-defense; `archive` is trimmed each tick by the event
   *  scheduler to the same cap. TRUNCATE (not reject) for backward compat. */
  snapshots: z
    .array(historySnapshotSchema)
    .transform((arr) =>
      arr.length > PROVISIONAL_EVENT_MAX_HISTORY
        ? arr.slice(-PROVISIONAL_EVENT_MAX_HISTORY)
        : arr,
    ),
  // Bounded event log for archive purposes (UI keeps its own short-term log).
  archive: z
    .array(
      z.object({
        at: z.number().int().nonnegative(),
        kind: z.string(),
        payload: z.unknown(),
      }),
    )
    .transform((arr) =>
      arr.length > PROVISIONAL_EVENT_MAX_HISTORY
        ? arr.slice(-PROVISIONAL_EVENT_MAX_HISTORY)
        : arr,
    ),
});
export type HistoricalState = z.infer<typeof historicalStateSchema>;
