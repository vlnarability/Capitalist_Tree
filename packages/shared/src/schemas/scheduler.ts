import { z } from 'zod';

/**
 * Scheduled events for the event scheduler (TDD §6.4).
 *
 * The scheduler is a serializable priority queue keyed by simulation time
 * (`at`, in sim seconds). Events fire when `clock.elapsedSeconds >= at`.
 *
 * `payload` is an opaque discriminated union (P0 stubs). Later phases
 * (P2/P3/P5) will add concrete payload kinds (season-transition, bill-due,
 * loan-payment, maintenance, market-review, scheduled-harvest).
 */
export const scheduledEventKindSchema = z.enum([
  'season-transition',
  'bill-due',
  'loan-payment',
  'maintenance',
  'market-review',
  'scheduled-harvest',
  // Reserved for future kinds — kept open to avoid churn later.
  'custom',
]);
export type ScheduledEventKind = z.infer<typeof scheduledEventKindSchema>;

export const scheduledEventSchema = z.object({
  id: z.string().min(1),
  // Absolute simulation seconds at which the event fires.
  at: z.number().int().nonnegative(),
  kind: scheduledEventKindSchema,
  // Opaque payload. Concrete shapes are defined per-kind by later phases.
  payload: z.unknown(),
});
export type ScheduledEvent = z.infer<typeof scheduledEventSchema>;

export const schedulerStateSchema = z.object({
  events: z.array(scheduledEventSchema),
});
export type SchedulerState = z.infer<typeof schedulerStateSchema>;
