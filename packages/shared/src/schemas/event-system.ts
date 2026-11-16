import { z } from 'zod';

/**
 * EventSystem state schemas (P10a — TDD §6.4 Event Scheduling, TDD line 200
 * "EventSystem — Simulation events and consequences", GDD §10 Environment and
 * Climate, GDD §148-152 influence over regional/global markets/governments/
 * regulations/environmental conditions/objectives; TDD Milestone 9: Regional
 * environments, Industrial systems, Governments, Monetary policy, Global
 * markets, Climate feedback, Global objectives).
 *
 * P10a introduces the *schema* layer only — the EventSystem implementation
 * (slot #12, currently a no-op stub in `packages/simulation/src/systems/
 * stubs.ts`) lands in P10b. This file defines:
 *
 *   1. The EventSystem scheduler state — a richer sibling of the P0
 *      `SchedulerState` (in `./scheduler.js`). The P0 scheduler is a simple
 *      time-keyed priority queue (`GameState.scheduler`) used by the
 *      PersonalSystem for `bill-due` events; the EventSystem scheduler
 *      additionally tracks *active* (in-progress) events and a *history* of
 *      resolved/expired events, keyed by event *type* ids from content
 *      (`packages/content/src/events/`). The two schedulers coexist: the P0
 *      one for engine-internal timed callbacks, the EventSystem one for
 *      gameplay events with durations + consequences (GDD §10.3 environmental
 *      feedback, TDD §6.4 discrete scheduled events).
 *
 *   2. The regional + global state (GDD §10.2 Regional Environments, §10.1
 *      Global Indicators). This EXTENDS P7's `EnvironmentState` (which already
 *      models `atmosphericCarbon`/`globalTemperature`/`soil.health`/
 *      `biodiversity`/`forestCoverage`/`ecosystemResilience` as a single
 *      global block) with a *regional breakdown*: each region carries its own
 *      climate/soil/water/biodiversity/forest/industry/pollution/
 *      vulnerabilities, and the global `aggregatedIndicators` are derived from
 *      the regional conditions (GDD §10.2 — "A healthy global average must not
 *      conceal a collapsing local ecosystem"). P7's single-block globals are
 *      NOT duplicated here; the EventSystem (P10b) will fold the P7 globals
 *      into the regional aggregation.
 *
 *   3. The `EventDefinition` content schema (pure data — rule 5) consumed by
 *      `packages/content/src/events/`.
 *
 * NAMING NOTE: the EventSystem's queued-event schema is named
 * `scheduledEventInstanceSchema` (type `ScheduledEventInstance`) rather than
 * `scheduledEventSchema` because the P0 `./scheduler.js` already exports a
 * `scheduledEventSchema` / `ScheduledEvent` (the simple priority-queue entry)
 * that is firmly in use by `GameState.scheduler`, the PersonalSystem
 * (`bill-due` events), and `packages/simulation/src/events/scheduler.ts`.
 * Re-using the name would create an ambiguous `export *` collision in the
 * schema barrel and break every existing consumer. The two concepts are
 * genuinely different (P0: opaque `{id, at, kind, payload}`; EventSystem:
 * typed `{id, type, scheduledAt, payload, resolved, resolvedAt, priority}`),
 * so the distinct name is also more accurate.
 *
 * All new fields have Zod `.default(...)` so v12 saves parse cleanly under v13
 * even without re-running the migration, and the v12 -> v13 migration
 * backfills them explicitly so consumers can rely on their presence (matching
 * the v3 -> v4 / v5 -> v6 / ... / v11 -> v12 convention). The top-level
 * `eventState` field on `GameState` (added in game-state.ts) likewise has a
 * `.default(...)` so a v12 save that somehow bypasses the migration still
 * loads.
 */

// ---------------------------------------------------------------------------
// Shared enums
// ---------------------------------------------------------------------------

/**
 * Event priority — ordering used by the EventSystem scheduler when multiple
 * events are due in the same tick (TDD §6.4). `critical` fires before
 * `high` before `normal` before `low`. PROVISIONAL ordering — final tie-break
 * (e.g. insertion order vs. type id) is a P10b decision.
 */
export const eventPrioritySchema = z.enum(['low', 'normal', 'high', 'critical']);
export type EventPriority = z.infer<typeof eventPrioritySchema>;

/**
 * Event severity — the magnitude band of an active event's effect (GDD §10.3
 * environmental feedback; "some losses, particularly species extinction, are
 * irreversible"). The EventSystem (P10b) maps a drawn severity onto the
 * event definition's `effects` deltas. `catastrophic` events can trigger
 * irreversible consequences (e.g. species extinction once biodiversity crosses
 * `PROVISIONAL_SPECIES_EXTINCTION_THRESHOLD`).
 */
export const eventSeveritySchema = z.enum(['minor', 'moderate', 'severe', 'catastrophic']);
export type EventSeverity = z.infer<typeof eventSeveritySchema>;

/**
 * Event outcome — how an active event left the scheduler (recorded in
 * `eventSchedulerStateSchema.history`). `resolved` = the event ran its full
 * duration or was manually resolved; `expired` = the event's duration elapsed
 * without mitigation; `mitigated` = a player/system action reduced the
 * event's severity before its natural end (GDD §10.3 — recovery is possible
 * but costly).
 */
export const eventOutcomeSchema = z.enum(['resolved', 'expired', 'mitigated']);
export type EventOutcome = z.infer<typeof eventOutcomeSchema>;

/**
 * Event category — groups event definitions for the UI / scheduler weighting
 * (GDD §10 environmental, GDD §8 economic, GDD §6 policy, GDD §5 biological).
 * Matches the categories used in `packages/content/src/events/event-types.ts`.
 */
export const eventCategorySchema = z.enum([
  'environmental',
  'economic',
  'policy',
  'biological',
]);
export type EventCategory = z.infer<typeof eventCategorySchema>;

// ---------------------------------------------------------------------------
// EventSystem scheduler state (TDD §6.4 — discrete scheduled events)
// ---------------------------------------------------------------------------

/**
 * A queued EventSystem event — an instance of an `EventDefinition` (from
 * content) scheduled to fire at a future simulation tick.
 *
 * Distinct from the P0 `ScheduledEvent` (`./scheduler.js`) which is a simple
 * time-keyed opaque payload for engine-internal callbacks. This entry is
 * *typed*: `type` references an `EventDefinition.id` from
 * `packages/content/src/events/`, `payload` carries the drawn severity /
 * region / magnitude, and `resolved`/`resolvedAt` track whether the event has
 * already fired (so a re-loaded save does not re-fire a past event —
 * determinism, TDD §18.3).
 *
 * `scheduledAt` is a simulation tick (the EventSystem checks the queue every
 * `PROVISIONAL_EVENT_CHECK_INTERVAL_TICKS` ticks and fires events whose
 * `scheduledAt <= currentTick`). `priority` breaks ties when several events
 * are due in the same check.
 *
 * All optional fields have `.default(...)` so partially-formed entries parse
 * cleanly; the v12 -> v13 migration backfills the whole scheduler from
 * empty defaults.
 */
export const scheduledEventInstanceSchema = z.object({
  /** Deterministic event id (e.g. `evt-0`, `evt-1`, ... from `nextEventId`). */
  id: z.string().min(1),
  /** EventDefinition.id from `packages/content/src/events/` (the event type). */
  type: z.string().min(1),
  /** Simulation tick at which the event fires. */
  scheduledAt: z.number().int().nonnegative(),
  /**
   * Drawn event parameters (severity band, target region id, magnitude
   * multiplier, etc.). Shape is event-type specific; the EventSystem (P10b)
   * interprets it per `EventDefinition`. Opaque to the schema.
   */
  payload: z.record(z.string(), z.unknown()).default({}),
  /** Whether the event has already fired (persisted across save/load). */
  resolved: z.boolean().default(false),
  /** Tick at which the event fired (0 until it does). */
  resolvedAt: z.number().int().nonnegative().default(0),
  /** Firing priority when several events are due in the same check. */
  priority: eventPrioritySchema.default('normal'),
});
export type ScheduledEventInstance = z.infer<typeof scheduledEventInstanceSchema>;

/**
 * An active (in-progress) EventSystem event — one that has fired and is now
 * exerting its `effects` on regional/global state for `duration` ticks
 * (GDD §10.3 — environmental damage creates secondary consequences that
 * persist). The EventSystem (P10b) decrements `remaining` each tick; when it
 * hits 0 the event moves to `history` with `outcome: 'resolved'` (or
 * `'expired'`).
 *
 * `severity` is the drawn band (mapped from `EventDefinition.severityRange`
 * scaled by `PROVISIONAL_EVENT_SEVERITY_SCALING` against global degradation).
 */
export const activeEventSchema = z.object({
  /** Event id (matches the originating `ScheduledEventInstance.id`). */
  id: z.string().min(1),
  /** EventDefinition.id (the event type). */
  type: z.string().min(1),
  /** Tick at which the event became active (fired). */
  startedAt: z.number().int().nonnegative(),
  /** Total duration in ticks the event will remain active. */
  duration: z.number().int().nonnegative(),
  /** Ticks remaining until the event naturally ends. */
  remaining: z.number().int().nonnegative(),
  /** Drawn event parameters (severity band, region, magnitude, etc.). */
  payload: z.record(z.string(), z.unknown()).default({}),
  /** Drawn severity band (drives the magnitude of `effects`). */
  severity: eventSeveritySchema.default('moderate'),
});
export type ActiveEvent = z.infer<typeof activeEventSchema>;

/**
 * A historical record of an EventSystem event that has concluded (kept for the
 * UI / audit log + for achievement evaluation in P9b's ProgressionSystem).
 *
 * `outcome` records how it ended; `description` is a human-readable summary
 * (the event type's name + severity + affected region) for the audit log.
 */
export const eventHistoryEntrySchema = z.object({
  /** Event id (matches the originating scheduled/active event id). */
  id: z.string().min(1),
  /** EventDefinition.id (the event type). */
  type: z.string().min(1),
  /** Tick at which the event occurred (fired). */
  occurredAt: z.number().int().nonnegative(),
  /** Tick at which the event concluded (0 if it has not). */
  resolvedAt: z.number().int().nonnegative(),
  /** Drawn severity band. */
  severity: eventSeveritySchema.default('moderate'),
  /** How the event concluded. */
  outcome: eventOutcomeSchema.default('resolved'),
  /** Human-readable summary for the UI / audit log. */
  description: z.string().default(''),
});
export type EventHistoryEntry = z.infer<typeof eventHistoryEntrySchema>;

/**
 * EventSystem scheduler state — the persisted queue of scheduled events, the
 * list of currently-active events, the history of concluded events, and a
 * monotonic id counter for new event ids (deterministic — TDD §18.3).
 *
 * This is the EventSystem's half of `EventState` (`eventState.scheduler`).
 * Distinct from the P0 `SchedulerState` (`GameState.scheduler`): the P0 one
 * is a simple priority queue for engine-internal callbacks; this one tracks
 * gameplay events with durations + consequences (TDD §6.4 discrete scheduled
 * events vs. continuous processes, handled separately).
 */
export const eventSchedulerStateSchema = z.object({
  /** Events queued to fire at future ticks. */
  scheduled: z.array(scheduledEventInstanceSchema).default([]),
  /** Events currently firing (exerting effects for their duration). */
  active: z.array(activeEventSchema).default([]),
  /** Concluded events (audit log + achievement evaluation input). */
  history: z.array(eventHistoryEntrySchema).default([]),
  /** Monotonic counter for the next scheduled-event id (deterministic). */
  nextEventId: z.number().int().nonnegative().default(0),
});
export type EventSchedulerState = z.infer<typeof eventSchedulerStateSchema>;

// ---------------------------------------------------------------------------
// Regional + global state (GDD §10.2 Regional Environments, §10.1 Global
// Indicators — EXTENDS P7's EnvironmentState with a regional breakdown)
// ---------------------------------------------------------------------------

/**
 * Climate baseline for a region (GDD §10.2 — regions have their own climate).
 * These are the long-run averages the EventSystem (P10b) perturbs with
 * environmental events (heat-wave raises effective temperature, drought
 * lowers effective precipitation, etc.). The P7 `EnvironmentState` global
 * temperature is the population-weighted average of regional baselines +
 * perturbations.
 */
export const regionClimateSchema = z.object({
  /** Long-run average temperature (°C). */
  temperatureBaseline: z.number(),
  /** Long-run average annual precipitation (mm). */
  precipitationBaseline: z.number(),
  /** Long-run average relative humidity (0-1). */
  humidityBaseline: z.number(),
});
export type RegionClimate = z.infer<typeof regionClimateSchema>;

/**
 * Per-region pollution loads (GDD §10.2 — regions have their own pollution;
 * GDD §10.3 — pollution creates secondary consequences). Each is a raw load
 * (not a 0-1 fraction) the EventSystem accumulates from regional industrial
 * activity + event effects; it feeds back into soil/water/biodiversity/health.
 */
export const regionPollutionSchema = z.object({
  /** Air pollution load (smog, particulates, GHG co-emissions). */
  air: z.number(),
  /** Water pollution load (effluent, nutrient runoff — GDD §10.1). */
  water: z.number(),
  /** Soil pollution load (contamination, heavy metals). */
  soil: z.number(),
});
export type RegionPollution = z.infer<typeof regionPollutionSchema>;

/**
 * Regional environment state (GDD §10.2 — regions have their own climate,
 * soil, water, biodiversity, forest, industry, pollution, vulnerabilities).
 *
 * Each 0-1 indicator is the regional analogue of P7's global
 * `EnvironmentState` fields; the global `aggregatedIndicators` are derived
 * from these (population- or area-weighted via
 * `PROVISIONAL_REGIONAL_AGGREGATION_WEIGHTS`). `industrialActivity` is the
 * pollution-output driver (GDD §28 industrial production); `population` sizes
 * the regional labor market + tax base (GDD §148-152 influence over
 * governments/markets).
 *
 * `vulnerabilities` is a list of content-defined vulnerability tags (e.g.
 * `'drought-prone'`, `'flood-risk'`, `'biodiversity-fragile'`) that the
 * EventSystem (P10b) consults when rolling event probability + severity for
 * the region (GDD §10.2 — "A healthy global average must not conceal a
 * collapsing local ecosystem").
 */
export const regionStateSchema = z.object({
  /** Unique region id (e.g. `region:temperate-lowlands`). */
  id: z.string().min(1),
  /** Human-readable region name. */
  name: z.string().min(1),
  /** Long-run climate baselines for the region. */
  climate: regionClimateSchema,
  /** Soil health (0-1; 1 = pristine). */
  soilHealth: z.number().min(0).max(1),
  /** Water availability (0-1; 1 = abundant). */
  waterAvailability: z.number().min(0).max(1),
  /** Biodiversity (0-1; 1 = rich). */
  biodiversity: z.number().min(0).max(1),
  /** Forest coverage (0-1; 1 = fully forested). */
  forestCoverage: z.number().min(0).max(1),
  /** Industrial activity (0-1; pollution output driver — GDD §28). */
  industrialActivity: z.number().min(0).max(1),
  /** Per-medium pollution loads. */
  pollution: regionPollutionSchema,
  /** Content-defined vulnerability tags (event probability/severity modifiers). */
  vulnerabilities: z.array(z.string().min(1)).default([]),
  /** Population (labor market + tax base sizing — nonnegative). */
  population: z.number().int().nonnegative().default(0),
});
export type RegionState = z.infer<typeof regionStateSchema>;

/**
 * Global aggregated indicators (GDD §10.1 — derived from regional conditions).
 *
 * These mirror the GDD §10.1 table. P7's `EnvironmentState` already models
 * `atmosphericCarbon` (as `atmosphere.co2Concentration`), `globalTemperature`,
 * `soil.health`, `biodiversity.index`, `forestCoverage`, `ecosystemResilience`
 * as a single global block; P10 does NOT duplicate those — instead the
 * EventSystem (P10b) keeps this aggregation in sync with the regional
 * breakdown (and with P7's globals) so a healthy global average cannot conceal
 * a collapsing local ecosystem (GDD §10.2). `speciesExtinctionRate` is the
 * additional GDD §10.1 indicator whose losses are irreversible (GDD §10.3) —
 * once biodiversity drops below `PROVISIONAL_SPECIES_EXTINCTION_THRESHOLD` the
 * EventSystem ratchets this up permanently.
 *
 * All fields have `.default(...)` so a partially-formed global block parses
 * cleanly; the v12 -> v13 migration seeds them from P7's existing
 * `EnvironmentState` globals (so a migrated save starts consistent).
 */
export const globalAggregatedIndicatorsSchema = z.object({
  /** Atmospheric carbon (ppm CO2 — mirrors `environment.atmosphere.co2Concentration`). */
  atmosphericCarbon: z.number().default(410),
  /** Global mean temperature (°C — mirrors `environment.globalTemperature`). */
  globalTemperature: z.number().default(14),
  /** Population-weighted average regional soil health (0-1). */
  avgSoilHealth: z.number().min(0).max(1).default(0.5),
  /** Population-weighted average regional biodiversity (0-1). */
  avgBiodiversity: z.number().min(0).max(1).default(0.5),
  /** Population-weighted average regional forest coverage (0-1). */
  avgForestCoverage: z.number().min(0).max(1).default(0.3),
  /** Global ecosystem resilience (0-1; derived from biodiversity + habitat). */
  ecosystemResilience: z.number().min(0).max(1).default(0.5),
  /** Species extinction rate (irreversible accumulator — GDD §10.1/§10.3). */
  speciesExtinctionRate: z.number().nonnegative().default(0),
});
export type GlobalAggregatedIndicators = z.infer<typeof globalAggregatedIndicatorsSchema>;

/**
 * Government policy state (GDD §148-152 — influence over governments,
 * regulations; GDD §6 monetary authority; TDD Milestone 9: Governments).
 *
 * The EventSystem (P10b) updates these on the
 * `PROVISIONAL_GOVERNMENT_POLICY_INTERVAL_DAYS` cadence, reacting to
 * aggregated environmental + economic conditions (e.g. tightening regulations
 * when pollution rises, introducing a carbon tax when atmospheric carbon
 * crosses a threshold). Player actions (`set-government-policy`) can override.
 *
 * `environmentalRegulations` (0-1) is the stringency of environmental law
 * (caps industrial pollution output); `carbonTaxRate` (0-1) is the marginal
 * tax on carbon emissions; `subsidies` is a list of active subsidy programs
 * (type + rate) the EconomySystem (P10b) applies to affected markets.
 */
export const governmentPolicySchema = z.object({
  /** Environmental regulation stringency (0 = none, 1 = strictest). */
  environmentalRegulations: z.number().min(0).max(1).default(0.3),
  /** Carbon tax rate (0 = none, 1 = confiscatory). */
  carbonTaxRate: z.number().min(0).max(1).default(0),
  /** Active subsidy programs (type id + rate 0-1). */
  subsidies: z
    .array(
      z.object({
        /** Subsidy program type id (e.g. `subsidy:renewable-energy`). */
        type: z.string().min(1),
        /** Subsidy rate (0-1 fraction of cost rebated). */
        rate: z.number().min(0).max(1),
      }),
    )
    .default([]),
});
export type GovernmentPolicy = z.infer<typeof governmentPolicySchema>;

/**
 * Monetary policy state (GDD §404-408 monetary authority + monetary policy
 * tools; TDD Milestone 9: Monetary policy). The EventSystem (P10b) updates
 * these on the `PROVISIONAL_MONETARY_POLICY_INTERVAL_DAYS` cadence, reacting
 * to inflation + growth. Player actions (`set-monetary-policy`) can override.
 *
 * `interestRate` is the central-bank policy rate (annual fraction);
 * `inflationTarget` is the target inflation rate the authority defends;
 * `moneySupplyGrowth` is the target growth rate of the money supply.
 */
export const monetaryPolicySchema = z.object({
  /** Central-bank policy interest rate (annual fraction). */
  interestRate: z.number().default(0.05),
  /** Target inflation rate the authority defends (annual fraction). */
  inflationTarget: z.number().default(0.02),
  /** Target money-supply growth rate (annual fraction). */
  moneySupplyGrowth: z.number().default(0.03),
});
export type MonetaryPolicy = z.infer<typeof monetaryPolicySchema>;

/**
 * Global state — the regional breakdown, the aggregated indicators derived
 * from it, the government + monetary policy, and a map of global market
 * indices (GDD §563 markets at regional and global scales; TDD Milestone 9:
 * Global markets). `globalMarketIndices` maps a market-index id (e.g.
 * `index:commodity-basket`, `index:equities`) to its current level; the
 * EconomySystem (P10b) updates these.
 */
export const globalStateSchema = z.object({
  /** Regional environments (GDD §10.2). Empty until the EventSystem seeds them. */
  regions: z.array(regionStateSchema).default([]),
  /** Global indicators derived from regional conditions (GDD §10.1). */
  aggregatedIndicators: globalAggregatedIndicatorsSchema.default(() => ({
    atmosphericCarbon: 410,
    globalTemperature: 14,
    avgSoilHealth: 0.5,
    avgBiodiversity: 0.5,
    avgForestCoverage: 0.3,
    ecosystemResilience: 0.5,
    speciesExtinctionRate: 0,
  })),
  /** Government policy (regulations, carbon tax, subsidies). */
  governmentPolicy: governmentPolicySchema.default(() => ({
    environmentalRegulations: 0.3,
    carbonTaxRate: 0,
    subsidies: [],
  })),
  /** Monetary policy (interest rate, inflation target, money-supply growth). */
  monetaryPolicy: monetaryPolicySchema.default(() => ({
    interestRate: 0.05,
    inflationTarget: 0.02,
    moneySupplyGrowth: 0.03,
  })),
  /** Global market-index levels (market-index id -> level). */
  globalMarketIndices: z.record(z.string(), z.number()).default({}),
});
export type GlobalState = z.infer<typeof globalStateSchema>;

// ---------------------------------------------------------------------------
// Top-level EventState (slot #12)
// ---------------------------------------------------------------------------

/**
 * EventState — the top-level state owned by the EventSystem (slot #12, TDD
 * line 200). Added to `GameState` as `eventState` in P10a (v13).
 *
 * Composed of:
 *   - `scheduler` — the EventSystem scheduler (scheduled / active / history /
 *     nextEventId). Distinct from the P0 `GameState.scheduler`.
 *   - `global` — the regional breakdown + aggregated indicators + government
 *     + monetary policy + global market indices.
 *
 * The EventSystem (P10b) reads + writes this each tick: it fires due
 * scheduled events into `active`, applies their `effects` to `global.regions`
 * / `global.aggregatedIndicators`, decrements `remaining`, retires concluded
 * events to `history`, and periodically updates government / monetary policy
 * + global market indices. P10a ships the schema + content + migration only;
 * the stub in `packages/simulation/src/systems/stubs.ts` stays a no-op until
 * P10b.
 */
export const eventStateSchema = z.object({
  /** EventSystem scheduler (scheduled / active / history / nextEventId). */
  scheduler: eventSchedulerStateSchema.default(() => ({
    scheduled: [],
    active: [],
    history: [],
    nextEventId: 0,
  })),
  /** Regional + global state (regions, aggregatedIndicators, policies, indices). */
  global: globalStateSchema.default(() => ({
    regions: [],
    aggregatedIndicators: {
      atmosphericCarbon: 410,
      globalTemperature: 14,
      avgSoilHealth: 0.5,
      avgBiodiversity: 0.5,
      avgForestCoverage: 0.3,
      ecosystemResilience: 0.5,
      speciesExtinctionRate: 0,
    },
    governmentPolicy: {
      environmentalRegulations: 0.3,
      carbonTaxRate: 0,
      subsidies: [],
    },
    monetaryPolicy: {
      interestRate: 0.05,
      inflationTarget: 0.02,
      moneySupplyGrowth: 0.03,
    },
    globalMarketIndices: {},
  })),
});
export type EventState = z.infer<typeof eventStateSchema>;

// ---------------------------------------------------------------------------
// EventDefinition — content schema (pure data, rule 5)
// ---------------------------------------------------------------------------

/**
 * Static event definition — pure data (P10a — GDD §10.3 environmental
 * feedback, §8 economic events, §6 policy, §5 biological; TDD §6.4 event
 * scheduling). Lives in `packages/content/src/events/event-types.ts`; the
 * EventSystem (P10b) reads a definition via `getEventDefinitionById` to
 * resolve an event's `type`, roll its severity within `severityRange`, roll
 * its duration within `durationRange`, and apply its `effects` deltas to the
 * target region's state.
 *
 * `effects` is a record of regional/global state field path -> delta (e.g.
 * `{ 'waterAvailability': -0.3, 'temperature': +5 }`); the sign is the
 * direction of change. `triggerConditions` is a list of descriptive condition
 * strings the EventSystem (P10b) evaluates against regional/global state to
 * decide whether the event can occur. `probabilityWeight` is the base
 * probability weight (relative to other eligible events) the scheduler uses
 * when rolling random events.
 *
 * PROVISIONAL per GDD §17 (event balance, regional granularity, recovery
 * timescales). Values are tuning data; add an event by appending to its
 * category array + to `EVENT_DEFINITIONS` in
 * `packages/content/src/events/event-types.ts`.
 */
export const eventDefinitionSchema = z.object({
  /** Unique event id, e.g. `event:drought`. */
  id: z.string().min(1),
  /** Human-readable name for the UI. */
  name: z.string().min(1),
  /** Short description for the UI / docs. */
  description: z.string(),
  /** Event category (environmental / economic / policy / biological). */
  category: eventCategorySchema,
  /** [minSeverity, maxSeverity] the EventSystem rolls within (inclusive). */
  severityRange: z.tuple([eventSeveritySchema, eventSeveritySchema]),
  /** [minDuration, maxDuration] in ticks the EventSystem rolls within (inclusive). */
  durationRange: z
    .tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])
    .refine(([min, max]) => min <= max, {
      message: 'durationRange[0] (min) must be <= durationRange[1] (max)',
    }),
  /** State field path -> delta applied to the target region/global state. */
  effects: z.record(z.string(), z.number()).default({}),
  /** Descriptive condition strings the EventSystem evaluates for eligibility. */
  triggerConditions: z.array(z.string()).default([]),
  /** Base probability weight (relative to other eligible events). */
  probabilityWeight: z.number().nonnegative().default(1),
});
export type EventDefinition = z.infer<typeof eventDefinitionSchema>;
