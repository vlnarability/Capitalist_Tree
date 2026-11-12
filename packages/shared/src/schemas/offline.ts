import { z } from 'zod';

/**
 * Offline catch-up types (P6a — TDD §14.4, GDD §4.2).
 *
 * `OfflineSummary` is the typed "while you were away" report produced by the
 * catch-up processor in `packages/simulation/src/offline/catch-up.ts`. It
 * captures the biological / economic / environmental deltas a returning
 * player cares about — enough to render a "while you were away" panel
 * (P6d) without re-deriving from before/after snapshots.
 *
 * `OfflineCatchUpStartedEvent` and `OfflineCatchUpCompletedEvent` are the
 * two event variants emitted by the processor itself. They are NOT
 * emitted by `engine.advance` (the engine is offline-agnostic and pure);
 * the processor appends them to the result's `events` array so consumers
 * (UI, audit log) can see the catch-up as a discrete operation in the
 * event stream. They are added to the `SimulationEvent` discriminated
 * union via `packages/shared/src/schemas/events.ts`.
 *
 * P6a scope: catch-up only. No automation (P6b), no UI (P6d). The summary
 * is pure data — the UI turns it into a panel later.
 */

/**
 * Numeric delta between before/after states. `delta === after - before`.
 * Used for biological and environmental fields where the player wants to
 * see how much a quantity changed during their absence.
 */
export const offlineSummaryDeltaSchema = z.object({
  before: z.number(),
  after: z.number(),
  delta: z.number(),
});
export type OfflineSummaryDelta = z.infer<typeof offlineSummaryDeltaSchema>;

/**
 * Boolean delta — used for `alive` (tree can die while the player is away).
 * No `delta` field (boolean difference is meaningless); the UI shows
 * "your tree died" when `before && !after`.
 */
export const offlineBooleanDeltaSchema = z.object({
  before: z.boolean(),
  after: z.boolean(),
});
export type OfflineBooleanDelta = z.infer<typeof offlineBooleanDeltaSchema>;

/**
 * String delta — used for bigint-as-string money fields
 * (`player.personalCash`, `economy.monetarySupply`, `economy.totalIssued`).
 * The UI formats `before`/`after` with the currency formatter; the delta
 * is derived by the consumer via `BigInt(after) - BigInt(before)` (kept
 * out of the summary so the schema stays JSON-safe — bigint isn't
 * directly JSON-serializable).
 */
export const offlineStringDeltaSchema = z.object({
  before: z.string(),
  after: z.string(),
});
export type OfflineStringDelta = z.infer<typeof offlineStringDeltaSchema>;

/**
 * Biological deltas — the original tree's primary biological attributes
 * (GDD §5.1). The player returning after a long absence cares most about:
 *   - Did the tree grow? (`height`, `trunkDiameter`)
 *   - Did it lose / gain leaves? (`currentLeaves`)
 *   - Did reserves build up or deplete? (`energyReserves`, `waterStored`)
 *   - Did its health decline or recover? (`health`, `stress`)
 *   - Is it still alive? (`alive`)
 *
 * `seasonalCondition` is omitted — it's a per-tick derived indicator that
 * the renderer cares about, not a long-term-trend quantity.
 */
export const offlineBiologicalSummarySchema = z.object({
  height: offlineSummaryDeltaSchema,
  trunkDiameter: offlineSummaryDeltaSchema,
  currentLeaves: offlineSummaryDeltaSchema,
  energyReserves: offlineSummaryDeltaSchema,
  waterStored: offlineSummaryDeltaSchema,
  health: offlineSummaryDeltaSchema,
  stress: offlineSummaryDeltaSchema,
  alive: offlineBooleanDeltaSchema,
});
export type OfflineBiologicalSummary = z.infer<typeof offlineBiologicalSummarySchema>;

/**
 * Economic deltas — the player's personal cash, the money supply, the
 * inflation index, and the cumulative issuance counters (TDD §10.4
 * conservation invariant). Plus a count of new transactions recorded
 * during the absence (the UI can show "X transactions happened while you
 * were away").
 *
 * `personalCash`, `monetarySupply`, `totalIssued` are bigint-as-string
 * (TDD §10.1). `inflationIndex` is a plain number (Laspeyres basket
 * index, P3b). `transactionsCount` is a count delta (always >= 0 —
 * transactions are append-only).
 */
export const offlineEconomicSummarySchema = z.object({
  personalCash: offlineStringDeltaSchema,
  monetarySupply: offlineStringDeltaSchema,
  inflationIndex: offlineSummaryDeltaSchema,
  totalIssued: offlineStringDeltaSchema,
  transactionsCount: offlineSummaryDeltaSchema,
});
export type OfflineEconomicSummary = z.infer<typeof offlineEconomicSummarySchema>;

/**
 * Environmental deltas — the world's environmental indicators (TDD §8.3,
 * GDD §10). The player cares about:
 *   - Did the soil dry out? (`soilWater`)
 *   - Did freshwater reserves change? (`freshwaterAvailability`)
 *   - Did biodiversity / forest coverage decline? (`biodiversityIndex`,
 *     `forestCoverage`)
 *   - Did the climate shift? (`globalTemperature`, `co2Concentration`)
 *
 * `co2Concentration` is included because long absences (30 real days ≈ 6
 * sim years) can produce visible CO2 drift from emissions/sequestration.
 */
export const offlineEnvironmentalSummarySchema = z.object({
  soilWater: offlineSummaryDeltaSchema,
  freshwaterAvailability: offlineSummaryDeltaSchema,
  biodiversityIndex: offlineSummaryDeltaSchema,
  forestCoverage: offlineSummaryDeltaSchema,
  globalTemperature: offlineSummaryDeltaSchema,
  co2Concentration: offlineSummaryDeltaSchema,
});
export type OfflineEnvironmentalSummary = z.infer<typeof offlineEnvironmentalSummarySchema>;

/**
 * "While you were away" summary — the typed report produced by the
 * catch-up processor. Pure data; the consumer (apps/web P6d) renders it
 * into a panel.
 *
 * Fields:
 *   - `requestedRealMs`: elapsed real-world ms the processor was asked
 *     to cover (after the backwards-clock tolerance check, before the cap).
 *   - `cappedRealMs`: ms actually simulated (after capping at
 *     `PROVISIONAL_OFFLINE_MAX_REAL_INTERVAL_MS`). Equals `requestedRealMs`
 *     unless `capped === true`.
 *   - `simElapsedSeconds`: total simulation seconds actually processed
 *     (= `chunksRun × chunkSimSeconds`). Always a multiple of the chunk
 *     size; any remainder from the real→sim conversion is dropped,
 *     matching `engine.advance`'s step-rounding behaviour.
 *   - `chunksRun`: number of `engine.advance(chunk)` calls made.
 *   - `capped`: true if the requested interval exceeded the max.
 *   - `clockTampered`: always `false` on a returned summary — a tampered
 *     clock throws `OfflineClockTamperedError` and no summary is produced.
 *     The field exists so consumers switching on summary shape have a
 *     complete view; future hardening may return a summary + warning
 *     rather than throwing.
 *   - `fromSimSeconds` / `toSimSeconds`: simulation time bounds of the
 *     catch-up, in elapsed sim seconds (matches `clock.elapsedSeconds`).
 *   - `fromDay` / `toDay`: in-game day bounds (matches `clock.day`).
 *   - `biological` / `economic` / `environmental`: per-domain deltas
 *     between the before/after states.
 */
export const offlineSummarySchema = z.object({
  requestedRealMs: z.number().int().nonnegative(),
  cappedRealMs: z.number().int().nonnegative(),
  simElapsedSeconds: z.number().int().nonnegative(),
  chunksRun: z.number().int().nonnegative(),
  capped: z.boolean(),
  clockTampered: z.boolean(),
  fromSimSeconds: z.number().int().nonnegative(),
  toSimSeconds: z.number().int().nonnegative(),
  fromDay: z.number().int().nonnegative(),
  toDay: z.number().int().nonnegative(),
  biological: offlineBiologicalSummarySchema,
  economic: offlineEconomicSummarySchema,
  environmental: offlineEnvironmentalSummarySchema,
});
export type OfflineSummary = z.infer<typeof offlineSummarySchema>;

/**
 * `offline-catch-up-started` event — emitted by the catch-up processor at
 * the simulation time the catch-up began (the pre-catch-up
 * `clock.elapsedSeconds`). Carries the planned workload so the UI can show
 * a progress indicator while the processor runs. Only emitted when at
 * least one chunk will run (a 0-chunk catch-up is a silent no-op).
 *
 * This event is appended to the result's `events` array; it does NOT flow
 * back into `engine.advance` (the engine is pure and offline-agnostic).
 */
export const offlineCatchUpStartedEventSchema = z.object({
  type: z.literal('offline-catch-up-started'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    requestedRealMs: z.number().int().nonnegative(),
    simElapsedSecondsPlanned: z.number().int().nonnegative(),
    chunksPlanned: z.number().int().nonnegative(),
    capped: z.boolean(),
  }),
});
export type OfflineCatchUpStartedEvent = z.infer<typeof offlineCatchUpStartedEventSchema>;

/**
 * `offline-catch-up-completed` event — emitted by the catch-up processor
 * at the simulation time the catch-up ended (the post-catch-up
 * `clock.elapsedSeconds`). Carries the full `OfflineSummary` so the UI
 * can render the "while you were away" panel directly from the event
 * payload without reaching into state. Only emitted when at least one
 * chunk ran.
 */
export const offlineCatchUpCompletedEventSchema = z.object({
  type: z.literal('offline-catch-up-completed'),
  at: z.number().int().nonnegative(),
  payload: z.object({
    summary: offlineSummarySchema,
  }),
});
export type OfflineCatchUpCompletedEvent = z.infer<typeof offlineCatchUpCompletedEventSchema>;
