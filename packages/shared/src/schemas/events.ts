import { z } from 'zod';
import {
  harvestCompletedEventSchema,
  treeDiedEventSchema,
  defoliationEventSchema,
  biologyNotificationEventSchema,
} from './events-biology.js';
import {
  weatherDamageEventSchema,
  waterAppliedEventSchema,
  fertilizerAppliedEventSchema,
  resourceNotificationEventSchema,
} from './events-resources.js';
import {
  transactionRecordedEventSchema,
  issuanceAuthorizedEventSchema,
  issuanceRejectedEventSchema,
  purchaseCompletedEventSchema,
  marketPriceChangedEventSchema,
  expenseDueEventSchema,
  transferCompletedEventSchema,
} from './events-economy.js';

/**
 * SimulationEvent — discriminated union emitted by systems during `advance`.
 *
 * P0 channels:
 *   - `tick`: emitted once per fixed simulation step. Payload: { step, day, timeOfDay }.
 *   - `season-changed`: emitted when the day-of-year rolls into a new season.
 *   - `weather-changed`: stub (P2 will emit real weather transitions).
 *   - `scheduled-event`: emitted when a scheduled event from the scheduler fires.
 *   - `notification`: human-readable actionable event (GDD §13.5).
 *   - `system`: generic channel for systems that need ad-hoc events.
 *
 * Every event carries `at` (the simulation time at which it was emitted).
 *
 * HOW TO EXTEND (P1/P2/P3/...): add a new variant with a unique `type`
 * literal. Do NOT loosen the union with a catch-all. Consumers should
 * switch on `event.type` and the TypeScript exhaustiveness check will catch
 * missing cases.
 */
export const tickEventSchema = z.object({
  type: z.literal('tick'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    step: z.number().int().nonnegative(),
    day: z.number().int().nonnegative(),
    timeOfDay: z.number(),
  }),
});

export const seasonChangedEventSchema = z.object({
  type: z.literal('season-changed'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    from: z.string(),
    to: z.string(),
    day: z.number().int().nonnegative(),
  }),
});

export const weatherChangedEventSchema = z.object({
  type: z.literal('weather-changed'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    from: z.string().nullable(),
    to: z.string(),
  }),
});

export const scheduledEventFiredSchema = z.object({
  type: z.literal('scheduled-event'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    eventId: z.string(),
    kind: z.string(),
    data: z.unknown(),
  }),
});

export const notificationEventSchema = z.object({
  type: z.literal('notification'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    severity: z.enum(['info', 'warning', 'critical']),
    message: z.string(),
    code: z.string(),
  }),
});

export const systemEventSchema = z.object({
  type: z.literal('system'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    systemId: z.string(),
    message: z.string(),
    data: z.unknown().optional(),
  }),
});

export const simulationEventSchema = z.discriminatedUnion('type', [
  tickEventSchema,
  seasonChangedEventSchema,
  weatherChangedEventSchema,
  scheduledEventFiredSchema,
  notificationEventSchema,
  systemEventSchema,
  harvestCompletedEventSchema,
  treeDiedEventSchema,
  defoliationEventSchema,
  biologyNotificationEventSchema,
  weatherDamageEventSchema,
  waterAppliedEventSchema,
  fertilizerAppliedEventSchema,
  resourceNotificationEventSchema,
  transactionRecordedEventSchema,
  issuanceAuthorizedEventSchema,
  issuanceRejectedEventSchema,
  purchaseCompletedEventSchema,
  marketPriceChangedEventSchema,
  expenseDueEventSchema,
  transferCompletedEventSchema,
]);
export type SimulationEvent = z.infer<typeof simulationEventSchema>;

// Re-export biology event variants so consumers can import them from
// @capitalist-tree/shared without reaching into the biology submodule.
export * from './events-biology.js';
// Re-export resource + weather event variants so consumers can import them
// from @capitalist-tree/shared without reaching into the resources submodule.
export * from './events-resources.js';
// Re-export economy event variants so consumers can import them from
// @capitalist-tree/shared without reaching into the economy submodule.
export * from './events-economy.js';
