# Global & EventSystem (P10 — final)

**Status:** Source-of-truth contract for the P10 Global & EventSystem
(P10a–P10d) implementation. Built on `docs/GDD.txt` §10 (Environment and
Climate — §10.1 Global Indicators, §10.2 Regional Environments, §10.3
Environmental Feedback), §12 (Player Objectives — six end-game objectives
tracked independently, may overlap, no mandatory ending), §148-152
(influence over regional/global markets/governments/regulations/
environmental conditions), §404-408 (monetary authority + monetary policy
tools), and line 563 (markets at regional and global scales); and
`docs/TDD.txt` §6.4 (Event Scheduling — discrete scheduled events use an
event scheduler), line 200 ("EventSystem — Simulation events and
consequences"), and Milestone 9 (Regional environments, Industrial systems,
Governments, Monetary policy, Global markets, Climate feedback, Global
objectives).

P10 is the last sub-task of Phase 10 and the LAST system phase. It
supersedes the P0 stub in `packages/simulation/src/systems/stubs.ts` — the
`EventSystem` is now a real, pure, deterministic system (P10b core +
P10c climate feedback + markets + stochastic rolling + objectives) at
registry **slot #12, the LAST system**. P10a added the `eventStateSchema`
(`scheduler` + `global`) + 6 EventSystem action schemas + 7 EventSystem
event variants + the content registry (15 `EventDefinition`s across 4
categories) + 8 `PROVISIONAL_EVENT_*` / `PROVISIONAL_GOVERNMENT_*` /
`PROVISIONAL_MONETARY_*` / `PROVISIONAL_REGIONAL_*` / `PROVISIONAL_SPECIES_*`
constants + the v12→v13 migration; P10b built the EventSystem + the pure
scheduler / regional / global-event-effect helpers + the 6 action handlers +
the typed-error surface; P10c closed the climate feedback loop (the P7↔P10
bridge), added the global market-index evolution layer, the stochastic event
rolling (via a seeded FNV-1a sub-RNG — R-P10-N RESOLVED, zero root draws),
and the six end-game objective evaluators; and applied a performance fix
replacing per-helper full-state `structuredClone` with targeted clones of
only the `eventState.*` sub-paths each helper touches. With P10d (this
document) all 12 systems are real — no stubs remain.

This document is paired with `docs/GDD.txt` and `docs/TDD.txt`. Where this
document and the GDD/TDD disagree, the GDD/TDD win and a fix must be filed
against this document.

> **Scope flag.** Every `@provisional` constant in this document corresponds
> to (or stands in for) an unresolved design decision listed in `GDD §17`
> (Climate model sensitivity, Regional simulation granularity, Environmental
> recovery timescales, Currency issuance mechanics and monetary policy,
> Influence over governments + regulations, Event balance, Endings tuning,
> Economic tuning, Detailed resource simulation equations). They live in
> `packages/shared/src/constants/events.ts` under the
> `PROVISIONAL_EVENT_*` / `PROVISIONAL_GOVERNMENT_*` / `PROVISIONAL_MONETARY_*`
> / `PROVISIONAL_REGIONAL_*` / `PROVISIONAL_SPECIES_*` prefixes, plus a set
> of local `@provisional` constants inside the EventSystem helper modules
> (`packages/simulation/src/events/*.ts`) — the regional drift rates
> (R-P10-1), the government/central-bank reaction rates (R-P10-2), the
> climate-feedback magnitudes (R-P10-4), the market mean-reversion +
> sensitivities (R-P10-5), and the objective thresholds (R-P10-3). P10+
> playtesting will calibrate them; until then the engine NEVER hardcodes
> tuning numbers, only imports.

---

## 1. Public interfaces at a glance

| Surface | Location | P10 phase |
|---|---|---|
| `EventState` schema (`scheduler` + `global` — regions, aggregatedIndicators, governmentPolicy, monetaryPolicy, globalMarketIndices) | `packages/shared/src/schemas/event-system.ts` | P0 stub + P10a |
| EventSystem action schemas (6 variants) | `packages/shared/src/schemas/actions-events.ts` | P10a |
| EventSystem event schemas (7 variants) | `packages/shared/src/schemas/events-events.ts` | P10a |
| EventSystem constants (`PROVISIONAL_EVENT_*`, `PROVISIONAL_GOVERNMENT_*`, `PROVISIONAL_MONETARY_*`, `PROVISIONAL_REGIONAL_*`, `PROVISIONAL_SPECIES_*`) | `packages/shared/src/constants/events.ts` | P10a |
| Migration v12→v13 (add `eventState: EventState` + seed aggregatedIndicators from P7 globals) | `packages/shared/src/migrations/defaults.ts` (`v12ToV13`) | P10a |
| EventSystem content — 15 event definitions (5 environmental / 4 economic / 3 policy / 3 biological) | `packages/content/src/events/event-types.ts` | P10a |
| `scheduler.ts` — `scheduleEvent` / `cancelScheduledEvent` / `triggerEventImmediate` / `resolveActiveEvent` / `processScheduledEvents` (+ P0 `schedule`/`due`/`cancel`) | `packages/simulation/src/events/scheduler.ts` | P10b |
| `regional.ts` — `seedDefaultRegions` + `evolveRegions` + `aggregateGlobalIndicators` + `minRegionalIndicators` | `packages/simulation/src/events/regional.ts` | P10b |
| `global.ts` — `applyEventEffects` + `updateGovernmentPolicy` + `updateMonetaryPolicy` + `severityMultiplier` | `packages/simulation/src/events/global.ts` | P10b |
| `climate.ts` — `applyClimateFeedback` + `applyEnvironmentalFeedback` + `environmentalEventProbabilityMultiplier` | `packages/simulation/src/events/climate.ts` | P10c |
| `markets.ts` — `evolveGlobalMarketIndices` + `getGlobalMarketIndex` | `packages/simulation/src/events/markets.ts` | P10c |
| `random.ts` — `rollRandomEvents` + `collectEligibleEvents` + `globalDegradation` + `createEventSubRng` (seeded FNV-1a sub-RNG) | `packages/simulation/src/events/random.ts` | P10c |
| `objectives.ts` — `evaluateObjectives` + `diffObjectives` + 6 objective evaluators | `packages/simulation/src/events/objectives.ts` | P10c |
| `actions.ts` — 6 action handlers | `packages/simulation/src/events/actions.ts` | P10b |
| `errors.ts` — 3 typed errors | `packages/simulation/src/events/errors.ts` | P10b |
| `systems/events.ts` — `EventSystem` (registry slot #12, LAST system) | `packages/simulation/src/systems/events.ts` | P10b/P10c |

The `engine.executeAction` dispatch table
(`packages/simulation/src/actions/handlers.ts`) registers these P10b
actions:

| Action | Handler | P10 phase | Notes |
|---|---|---|---|
| `schedule-event` | `scheduleEventHandler` | P10b | Delegates to `scheduleEvent`. Resolves `eventTypeId` via `getEventDefinitionById` (unknown → `UnknownEventDefinitionError`), allocates a deterministic id `evt-N` from `eventState.scheduler.nextEventId` (and increments the counter), appends a `ScheduledEventInstance` to `eventState.scheduler.scheduled`, emits `event-scheduled`. `payload` may carry drawn severity / region / magnitude (optional — the EventSystem can roll at fire time); `priority` defaults to `'normal'`; `tick` is the action's sim second used for the emitted event's `at`. |
| `cancel-event` | `cancelEventHandler` | P10b | Delegates to `cancelScheduledEvent` — removes the matching `ScheduledEventInstance` from `scheduled`. Idempotent no-op on a missing id (mirrors P6b2's enable/disable-automation idempotency). Emits NO event (the cancellation is reflected in the scheduler state). |
| `trigger-event` | `triggerEventHandler` | P10b | Delegates to `triggerEventImmediate` — bypasses the `scheduledAt` gate, resolves severity (explicit `severity` wins; else `'moderate'`), resolves duration (explicit `payload.duration` wins; else the midpoint of the definition's `durationRange`), builds an `ActiveEvent` (`startedAt` = tick index of `now`), applies effects via `applyEventEffects`, appends to `active`, emits `event-triggered`. Merges `regionId` + `severity` into the event `payload`. |
| `resolve-event` | `resolveEventHandler` | P10b | Delegates to `resolveActiveEvent` — finds the active event by id (unknown → `UnknownActiveEventError`), retires it to `history` with `outcome: 'mitigated'`, emits `event-resolved`. Does NOT revert the applied effects (recovery is gradual via `evolveRegions`'s `PROVISIONAL_EVENT_RECOVERY_RATE`). |
| `set-government-policy` | `setGovernmentPolicyHandler` | P10b | Merges a partial `GovernmentPolicy` into `eventState.global.governmentPolicy` (shallow merge — only supplied fields overwritten; `subsidies` replaced wholesale when supplied). Emits `government-policy-changed` carrying the resulting full policy. |
| `set-monetary-policy` | `setMonetaryPolicyHandler` | P10b | Merges a partial `MonetaryPolicy` into `eventState.global.monetaryPolicy` (shallow merge). Emits `monetary-policy-changed` carrying the resulting full policy. |

---

## 2. Event state (TDD §6.4 / line 200 — the slot-#12 slice)

`EventState` (`packages/shared/src/schemas/event-system.ts`) is the single
EventSystem slice on `GameState`, added as `eventState` in P10a (v13). The
P0 stub had no `eventState` field; P10a introduces the full shape required by
GDD §10 (Regional Environments + Global Indicators + Environmental Feedback),
§148-152 (governments/regulations), §404-408 (monetary authority), and line
563 (global markets). The v12→v13 migration adds the field + seeds
`aggregatedIndicators` from the save's existing P7 `EnvironmentState` globals
so a migrated save starts consistent. The full shape:

```typescript
interface EventState {                       // P10a
  scheduler: EventSchedulerState;            //   the EventSystem scheduler (TDD §6.4)
  global: GlobalState;                       //   regional breakdown + aggregated indicators +
                                             //   government + monetary policy + global market indices
}

interface EventSchedulerState {              // P10a
  scheduled: ScheduledEventInstance[];       //   events queued to fire at future ticks
  active: ActiveEvent[];                     //   events currently firing (exerting effects for their duration)
  history: EventHistoryEntry[];              //   concluded events (audit log + achievement-evaluation input)
  nextEventId: number;                       //   monotonic counter for the next scheduled-event id (deterministic)
}

interface ScheduledEventInstance {           // P10a — a queued EventSystem event
  id: string;                                //   deterministic event id (e.g. `evt-0`, `evt-1`, ... from `nextEventId`)
  type: string;                              //   EventDefinition.id from `packages/content/src/events/` (the event type)
  scheduledAt: number;                       //   simulation tick at which the event fires
  payload: Record<string, unknown>;          //   drawn event parameters (severity band, target region id, magnitude, etc.)
  resolved: boolean;                         //   whether the event has already fired (persisted across save/load)
  resolvedAt: number;                        //   tick at which the event fired (0 until it does)
  priority: EventPriority;                   //   firing priority when several events are due in the same check
}

interface ActiveEvent {                      // P10a — an in-progress EventSystem event
  id: string;                                //   event id (matches the originating ScheduledEventInstance.id)
  type: string;                              //   EventDefinition.id (the event type)
  startedAt: number;                         //   tick at which the event became active (fired)
  duration: number;                          //   total duration in ticks the event will remain active
  remaining: number;                         //   ticks remaining until the event naturally ends
  payload: Record<string, unknown>;          //   drawn event parameters (severity band, region, magnitude, etc.)
  severity: EventSeverity;                   //   drawn severity band (drives the magnitude of `effects`)
}

interface EventHistoryEntry {                // P10a — a concluded EventSystem event (audit log)
  id: string;                                //   event id (matches the originating scheduled/active event id)
  type: string;                              //   EventDefinition.id (the event type)
  occurredAt: number;                        //   tick at which the event occurred (fired)
  resolvedAt: number;                        //   tick at which the event concluded (0 if it has not)
  severity: EventSeverity;                   //   drawn severity band
  outcome: EventOutcome;                     //   how the event concluded ('resolved' | 'expired' | 'mitigated')
  description: string;                       //   human-readable summary for the UI / audit log
}
```

The shared enums backing these interfaces (all in
`packages/shared/src/schemas/event-system.ts`):

```typescript
type EventPriority = 'low' | 'normal' | 'high' | 'critical';   // scheduler tie-break ordering (TDD §6.4)
type EventSeverity = 'minor' | 'moderate' | 'severe' | 'catastrophic'; // magnitude band of an active event's effect (GDD §10.3)
type EventOutcome = 'resolved' | 'expired' | 'mitigated';       // how an active event left the scheduler
type EventCategory = 'environmental' | 'economic' | 'policy' | 'biological'; // groups event definitions (GDD §10/§8/§6/§5)
```

`GlobalState` carries the regional breakdown + the derived global indicators
+ the policy blocks + the market indices:

```typescript
interface GlobalState {                     // P10a
  regions: RegionState[];                   //   regional environments (GDD §10.2) — empty until the EventSystem seeds them
  aggregatedIndicators: GlobalAggregatedIndicators; // GDD §10.1 — derived from regional conditions
  governmentPolicy: GovernmentPolicy;       //   GDD §148-152 — regulations / carbon tax / subsidies
  monetaryPolicy: MonetaryPolicy;           //   GDD §404-408 — interest rate / inflation target / money-supply growth
  globalMarketIndices: Record<string, number>; // GDD line 563 — market-index id -> level (baseline 100)
}

interface RegionState {                     // P10a — GDD §10.2 regional environment
  id: string;                               //   unique region id (e.g. `region:temperate-lowlands`)
  name: string;                             //   human-readable region name
  climate: RegionClimate;                   //   long-run climate baselines for the region
  soilHealth: number;                       //   0-1; 1 = pristine
  waterAvailability: number;                //   0-1; 1 = abundant
  biodiversity: number;                     //   0-1; 1 = rich
  forestCoverage: number;                   //   0-1; 1 = fully forested
  industrialActivity: number;               //   0-1; pollution-output driver (GDD §28 industrial production)
  pollution: RegionPollution;               //   per-medium pollution loads (air / water / soil — raw, not 0-1)
  vulnerabilities: string[];                //   content-defined vulnerability tags (event probability/severity modifiers)
  population: number;                       //   labor market + tax base sizing (nonnegative) — sizes `'population'` aggregation weighting
}

interface RegionClimate {                   // P10a — long-run averages the EventSystem perturbs
  temperatureBaseline: number;              //   °C
  precipitationBaseline: number;            //   mm (0-1 normalized in content baselines)
  humidityBaseline: number;                 //   0-1
}

interface RegionPollution {                 // P10a — raw pollution loads (not 0-1)
  air: number;                              //   smog, particulates, GHG co-emissions
  water: number;                            //   effluent, nutrient runoff (GDD §10.1)
  soil: number;                             //   contamination, heavy metals
}

interface GlobalAggregatedIndicators {      // P10a — GDD §10.1 table
  atmosphericCarbon: number;                //   ppm CO2 — mirrors `environment.atmosphere.co2Concentration`
  globalTemperature: number;                //   °C — mirrors `environment.globalTemperature`
  avgSoilHealth: number;                    //   0-1 — population-weighted average regional soil health
  avgBiodiversity: number;                  //   0-1 — population-weighted average regional biodiversity
  avgForestCoverage: number;                //   0-1 — population-weighted average regional forest coverage
  ecosystemResilience: number;              //   0-1 — derived composite (0.5*biodiversity + 0.3*forestCoverage + 0.2*soilHealth)
  speciesExtinctionRate: number;            //   irreversible accumulator — GDD §10.1/§10.3 (losses below threshold are permanent)
}

interface GovernmentPolicy {                // P10a — GDD §148-152
  environmentalRegulations: number;         //   0 = none, 1 = strictest (caps industrial pollution output)
  carbonTaxRate: number;                    //   0 = none, 1 = confiscatory (marginal tax on carbon emissions)
  subsidies: { type: string; rate: number }[]; // active subsidy programs (type id + 0-1 fraction of cost rebated)
}

interface MonetaryPolicy {                  // P10a — GDD §404-408
  interestRate: number;                     //   central-bank policy interest rate (annual fraction)
  inflationTarget: number;                  //   target inflation rate the authority defends (annual fraction)
  moneySupplyGrowth: number;                //   target money-supply growth rate (annual fraction)
}
```

### The P0 scheduler vs the EventSystem scheduler

The EventSystem's queued-event schema is named `scheduledEventInstanceSchema`
(type `ScheduledEventInstance`) rather than `scheduledEventSchema` because
the P0 `./scheduler.js` already exports a `scheduledEventSchema` /
`ScheduledEvent` (the simple priority-queue entry) that is firmly in use by
`GameState.scheduler`, the PersonalSystem (`bill-due` events), and
`packages/simulation/src/events/scheduler.ts` (the P0 `schedule`/`due`/
`cancel` helpers). The two concepts are genuinely different — P0: opaque
`{id, at, kind, payload}` for engine-internal callbacks; EventSystem: typed
`{id, type, scheduledAt, payload, resolved, resolvedAt, priority}` plus
`active` + `history` for gameplay events with durations + consequences — so
the distinct name avoids an ambiguous `export *` collision and is also more
accurate.

### P7 relationship (EXTENDS, does not duplicate)

P7's `EnvironmentState` already models `atmosphericCarbon` (as
`atmosphere.co2Concentration`), `globalTemperature`, `soil.health`,
`biodiversity.index`, `forestCoverage`, `ecosystemResilience` as a single
global block. P10 does NOT duplicate those — instead the EventSystem keeps
`eventState.global.aggregatedIndicators` in sync with the regional breakdown
AND with P7's globals (the v12→v13 migration seeds the aggregated block from
P7's existing values so a migrated save starts consistent; P10c's
`applyClimateFeedback` reads P7's `globalTemperature` + `co2Concentration`
to drive regional climate drift — the P7↔P10 bridge, §5). The regional
breakdown is the NEW layer P10 adds on top of P7's globals.

`CURRENT_SCHEMA_VERSION = 13` (P10a; declared in
`packages/shared/src/constants/provisional.ts:397`). Every new field carries
a Zod `.default(...)` AND an explicit backfill in `v12ToV13`, so v12 saves
parse cleanly under v13 and a hand-constructed v13 state with a partial
`eventState` still validates. The `eventState` top-level field on
`GameState` likewise has a `.default(...)` so a v12 save that bypasses the
migration still loads.

---

## 3. Event scheduler (TDD §6.4 — discrete scheduled events)

**File:** `packages/simulation/src/events/scheduler.ts` (pure helpers) +
the `eventSchedulerStateSchema` in
`packages/shared/src/schemas/event-system.ts` (state).

TDD §6.4 distinguishes discrete scheduled events (which use an event
scheduler) from continuous processes (handled by the per-tick systems). The
EventSystem scheduler is the discrete-event half of `EventState`: it tracks
three queues keyed by event *type* ids from content
(`packages/content/src/events/`):

- **`scheduled`** — events queued to fire at a future `scheduledAt` tick.
  `scheduleEvent` appends here; `processScheduledEvents` moves due ones to
  `active`.
- **`active`** — events currently firing (exerting their `effects` for
  `duration` ticks). Each carries a `remaining` counter the scheduler
  decrements each check; when it reaches 0 the event retires to `history`.
- **`history`** — concluded events (audit log + achievement-evaluation
  input in P9b's `ProgressionSystem`). Each carries the `outcome`
  (`'resolved'` / `'expired'` / `'mitigated'`).

`nextEventId` is a monotonic counter for deterministic id allocation
(`evt-0`, `evt-1`, …) so a re-loaded save does not re-fire a past event
(determinism — TDD §18.3: `resolved` / `resolvedAt` are persisted).

### Time model + throttle

`scheduledAt` / `startedAt` / `occurredAt` / `resolvedAt` / `duration` /
`remaining` on the EventSystem scheduler entries are **tick indices** (one
tick = `PROVISIONAL_SIMULATION_STEP_SECONDS` = 60 sim seconds). The helpers
take `now` in **sim seconds** (the `SystemContext.now` / action `payload.tick`
value, consistent with every other system's event `at`) and derive the tick
index internally via `Math.floor(now / PROVISIONAL_SIMULATION_STEP_SECONDS)`
so the emitted `SimulationEvent.at` stays in sim seconds (uniform with the
rest of the engine) while the persisted scheduler fields stay in tick
indices.

`processScheduledEvents` self-throttles: it is a no-op when the current tick
index is NOT a multiple of `PROVISIONAL_EVENT_CHECK_INTERVAL_TICKS` (60 ≈
once per in-game hour). The EventSystem calls it every tick; the throttle
gate skips the work on off-cadence ticks (TDD §6.4 — discrete scheduled
events are checked on a cadence, not every tick). When it runs, it
decrements each already-active event's `remaining` by the interval (the
number of ticks elapsed since the last check) so an event whose `duration`
is D ticks survives roughly D ticks of wall time despite the throttled check
cadence. Events fired THIS check are added with `remaining = duration` and
are NOT decremented this check (they get their first decrement at the next
check).

### `scheduleEvent` — queue a scheduled event

`scheduleEvent(state, type, scheduledAt, payload, priority, now)` is pure:
returns a new state + an `event-scheduled` event.

1. **Content gate** — resolve the event type via `getEventDefinitionById`;
   unknown id throws `UnknownEventDefinitionError`.
2. **Allocate id** — `evt-${scheduler.nextEventId}` from
   `eventState.scheduler.nextEventId`; increment the counter.
3. **Append** a `ScheduledEventInstance` (`{id, type, scheduledAt, payload,
   resolved:false, resolvedAt:0, priority}`) to
   `eventState.scheduler.scheduled`.
4. **Emit** `event-scheduled` carrying the allocated id + fire tick + priority.

`scheduledAt` is a tick index; `now` is the sim second used for the emitted
event's `at` (determinism — TDD §18.3).

### `cancelScheduledEvent` — remove before it fires

`cancelScheduledEvent(state, id)` removes the matching
`ScheduledEventInstance` from `scheduled`. Idempotent: a missing id is a
no-op (returns the input state unchanged + no events), mirroring P6b2's
enable/disable-automation idempotency. Emits NO event — the cancellation is
reflected in the scheduler state. `UnknownScheduledEventError` is exported
for admin/test code that prefers a thrown signal over the idempotent no-op
the `cancel-event` action handler uses.

### `triggerEventImmediate` — bypass the queue

`triggerEventImmediate(state, type, payload, now)` bypasses the
`scheduledAt` gate (testing / admin — TDD §6.4). It resolves the event type
(`UnknownEventDefinitionError` on unknown id), resolves severity (explicit
`payload.severity` wins; else `'moderate'`), resolves duration (explicit
`payload.duration` wins; else the midpoint of the definition's
`durationRange` — random rolling is P10c's domain via `rollRandomEvents`),
allocates an id, builds an `ActiveEvent` (`startedAt` = tick index of `now`,
`remaining = duration`), appends to `active`, applies the event's effects
via `applyEventEffects`, and emits `event-triggered`.

### `resolveActiveEvent` — mitigate early

`resolveActiveEvent(state, id, now)` manually resolves an active event early
(player mitigates an ongoing crisis — GDD §10.3 recovery is possible but
costly). Finds the active event by id (`UnknownActiveEventError` if not
found), removes it from `active`, retires it to `history` with `outcome:
'mitigated'` + a human-readable `description`, emits `event-resolved`
(outcome `'mitigated'`). Does NOT revert the applied effects — recovery is
gradual via `evolveRegions`'s `PROVISIONAL_EVENT_RECOVERY_RATE` (GDD §10.3 —
damage lingers).

### `processScheduledEvents` — the per-tick scheduler tick

`processScheduledEvents(state, now)` is the per-tick scheduler tick. Pure:
returns a new state + events. Self-throttles (no-op off-cadence). When it
runs:

1. **EXPIRE phase** — for each event already active, decrement `remaining`
   by the check interval; retire those whose `remaining` reaches <= 0 to
   `history` with `outcome: 'expired'` + emit `event-expired`. P10b has no
   mitigation mechanic, so all natural ends are `'expired'`; the
   `resolve-event` action path produces `'mitigated'`.
2. **FIRE phase** — for each scheduled event whose `scheduledAt <=
   tickIndex`, resolve its type + severity + (midpoint) duration, build an
   `ActiveEvent` (`startedAt` = tickIndex), apply its effects via
   `applyEventEffects`, move it from `scheduled` → `active`, emit
   `event-triggered`. Newly-fired events are NOT decremented this check.
   Due events are sorted by priority (`critical` → `high` → `normal` →
   `low`) then by `scheduledAt` for deterministic firing order within a
   check. An unknown type in the queue (a stale id from a re-loaded save)
   is gracefully dropped — the scheduler does not crash.

Effects are NOT reverted at expiry — recovery is gradual via `evolveRegions`
(GDD §10.3 — recovery is costly; damage lingers). The FIRE phase threads the
accumulated `eventState.global` through the loop: each `applyEventEffects`
call reads the current global and returns a new state with the effects
applied, so concurrent due events compound their regional/global effects
within the same check.

---

## 4. Regional environments (GDD §10.2 Regional Environments, §10.1 Global Indicators)

**File:** `packages/simulation/src/events/regional.ts` (pure helpers) +
`regionStateSchema` / `globalAggregatedIndicatorsSchema` in
`packages/shared/src/schemas/event-system.ts` (state).

GDD §10.2 is explicit: regions have their own climate, soil, water,
biodiversity, forest, industry, pollution, and vulnerabilities — and "A
healthy global average must not conceal a collapsing local ecosystem." P10
extends P7's single-block globals with a regional breakdown; the global
`aggregatedIndicators` are DERIVED from the regional conditions each tick.

### `seedDefaultRegions` — the @provisional default biomes

`seedDefaultRegions(state)` populates `eventState.global.regions` with a
small @provisional set of four representative biomes on the first EventSystem
tick (the v13 migration leaves `regions` empty; the EventSystem seeds it —
`packages/simulation/src/initial-state.ts` documents this). Idempotent: a
non-empty `regions` list is preserved verbatim. The four biomes span the
climate + industry + vulnerability space so the regional drift + aggregation
have meaningful input from tick one (exposed as `DEFAULT_REGION_IDS` for
tests):

| Region id | Name | Climate (temp/precip/humidity) | Industry | Vulnerabilities | Population |
|---|---|---|---|---|---|
| `region:temperate-lowlands` | Temperate Lowlands | 12 °C / 0.6 / 0.6 | 0.5 | `flood-risk` | 10,000,000 |
| `region:tropical-rainforest` | Tropical Rainforest | 26 °C / 0.9 / 0.8 | 0.3 | `biodiversity-fragile`, `flood-risk` | 5,000,000 |
| `region:arid-highlands` | Arid Highlands | 18 °C / 0.2 / 0.3 | 0.4 | `drought-prone` | 3,000,000 |
| `region:boreal-taiga` | Boreal Taiga | 2 °C / 0.4 / 0.5 | 0.2 | `biodiversity-fragile` | 2,000,000 |

P10c may replace this with a content registry of regions (mirroring the
businesses / fertilizers / weather content pattern); until then these
@provisional defaults live in `regional.ts` (rule 10).

### `evolveRegions` — per-tick regional drift (GDD §10.3)

`evolveRegions(state, dtSeconds)` drifts each region's indicators over
`dtSeconds`. Pure: returns a new state + `regional-condition-shifted` events
for threshold crossings. The drift model (@provisional — GDD §17):

- **Pollution accumulates** from `industrialActivity` at
  `PROVISIONAL_EVENT_POLLUTION_RATE` (10) per sim day, split air (full) /
  water (half) / soil (third), and **decays naturally** at
  `PROVISIONAL_EVENT_POLLUTION_DECAY_RATE` (0.05) per sim day (the
  environment's own assimilation capacity). Decay is exponential:
  `load * (1 - decayRate)^days`.
- **`soilHealth` / `waterAvailability` / `forestCoverage`** recover toward
  baseline (1.0) at `PROVISIONAL_EVENT_RECOVERY_RATE` (0.01) per sim day,
  minus pollution-driven stress (`totalPollution /
  PROVISIONAL_EVENT_POLLUTION_STRESS_SCALE` (200) × days). Soil takes full
  stress; water takes half; forest takes a third.
- **`biodiversity`** recovers the same way ABOVE
  `PROVISIONAL_SPECIES_EXTINCTION_THRESHOLD` (0.2); BELOW the threshold it
  does NOT recover (irreversible collapse — GDD §10.3) and the global
  `speciesExtinctionRate` ratchets up by
  `PROVISIONAL_EVENT_EXTINCTION_RATE` (0.01) per sim day in collapse.

A no-op when `dtSeconds <= 0` or `regions` is empty. Deterministic given
`(state, dtSeconds)` — no RNG (R-P10-N resolved via the seeded sub-RNG in
`random.ts`, used only by `rollRandomEvents`).

### `regional-condition-shifted` — surfacing local collapse (GDD §10.2)

`evolveRegions` emits a `regional-condition-shifted` event whenever a
regional indicator (`soilHealth` / `waterAvailability` / `biodiversity` /
`forestCoverage`) crosses one of the `REGIONAL_THRESHOLDS` (`[0.2, 0.3, 0.5,
0.7]`); biodiversity additionally checks
`PROVISIONAL_SPECIES_EXTINCTION_THRESHOLD` (0.2). The event carries the
region id, the field path, the old + new values, and a snapshot of the
region state — so the UI / audit layer can surface a collapsing local
ecosystem even when the global average is healthy (GDD §10.2). This is the
engine-side guard against the "healthy average conceals local collapse"
failure mode.

### `aggregateGlobalIndicators` — population-weighted averages + min tracking

`aggregateGlobalIndicators(state)` recomputes the global
`aggregatedIndicators` averages from regional conditions each tick (GDD
§10.1 — global indicators derived from regional). Pure: returns a new state
+ events + the min regional values alongside the averages. Weighting
(`PROVISIONAL_REGIONAL_AGGREGATION_WEIGHTS = 'population'`): each region
weighted by its `population` (a populous region's collapsing ecosystem weighs
heavily on the global average — GDD §10.2). The `'area'` alternative falls
back to equal weighting (one region, one vote) because `RegionState` has no
`area` field. All-zero populations (or area fallback) also fall back to
equal weighting.

It recomputes `avgSoilHealth` / `avgBiodiversity` / `avgForestCoverage` +
`ecosystemResilience` (the @provisional composite
`0.5*biodiversity + 0.3*forestCoverage + 0.2*soilHealth`, exposed as
`ECOSYSTEM_RESILIENCE_WEIGHTS`). It PRESERVES `atmosphericCarbon` +
`globalTemperature` (P7 EnvironmentSystem / P10c climate-feedback domain —
§5) and `speciesExtinctionRate` (the irreversible accumulator updated by
`evolveRegions`).

### `minRegionalIndicators` — the local-collapse guard

`minRegionalIndicators(state)` computes the MIN regional indicator values
across all regions (`soilHealth` / `waterAvailability` / `biodiversity` /
`forestCoverage`), returned alongside the averages as a `RegionalMinima`.
Returns `null` when there are no regions. This is the data the rendering +
audit layer reads to surface local collapse (a min of 0.05 biodiversity
alongside a healthy 0.6 average means one region is collapsing — GDD §10.2).
The min-tracking is the structural complement to the population-weighted
average: the average can hide collapse, the min cannot.

---

## 5. Climate feedback loop (GDD §10.3 Environmental Feedback — the P7↔P10 bridge)

**File:** `packages/simulation/src/events/climate.ts` (pure helpers).

This module is the P7↔P10 bridge: it closes the climate feedback loop by
reading P7's EnvironmentSystem globals
(`state.world.environment.atmosphere.co2Concentration` +
`globalTemperature` — the EnvironmentSystem at slot #10 already advances
these from emissions vs sequestration) and perturbing the P10 regional
climate baselines + applying the GDD §10.3 secondary-consequence chains.

### `applyClimateFeedback` — GHG → temperature → regional climate drift

`applyClimateFeedback(state, dtSeconds)` closes the climate feedback loop
(GDD §10.3: "climate → drought/heat/extreme weather"). Pure: returns a new
state + `notification` events (code `climate-baseline-shifted`) for regions
whose temperature baseline moved materially (> 0.05 °C). For each P10 region:

- **Drift `climate.temperatureBaseline`** toward the warmed global
  temperature at `PROVISIONAL_CLIMATE_BASELINE_DRIFT_RATE` (0.1) per sim
  year — secular convergence, so regional climates track the global mean.
  `temperatureBaseline += (globalTemperature - temperatureBaseline) *
  (0.1 * years)`.
- **Lower `climate.precipitationBaseline`** proportional to the warming
  anomaly at `PROVISIONAL_PRECIPITATION_WARMING_PENALTY` (0.02) per degree
  per sim year — a hotter atmosphere shifts rainfall patterns (net drying
  on average — GDD §10.3 drought risk). A +2 °C anomaly drains 4% of the
  precipitation baseline per sim year.

The elevated baselines are READ by `rollRandomEvents` (random.ts), which
scales environmental-event probability by the warming anomaly + regional
climate stress via `environmentalEventProbabilityMultiplier`. There is no
schema field for "event probability multiplier" (P10a froze the schemas);
the feedback is realized through the state the roller reads — this is the
documented P7↔P10 bridge. A no-op when `dtSeconds <= 0`, there are no
regions, or the warming anomaly is ~0 (the baselines hold). The reference
baseline is `PREINDUSTRIAL_BASELINE_TEMP_C = 14` (matches P7's
`PROVISIONAL_ENV_BASELINE_TEMP_C`).

### `applyEnvironmentalFeedback` — GDD §10.3 secondary-consequence chains

`applyEnvironmentalFeedback(state)` applies the GDD §10.3
secondary-consequence chains (environmental damage creates secondary
consequences; recovery is costly; species extinction is irreversible). Pure:
returns a new state + `notification` events for material secondary damage.
The chains applied per region per call (rates are per sim day; the helper is
called once per EventSystem tick with the tick's `dtSeconds` baked into the
magnitude via the @provisional rates — the magnitudes are small per-tick so
a single call does not overshoot):

1. **DEFORESTATION → EROSION**: low `forestCoverage` (missing canopy →
   exposed soil) reduces `soilHealth` at
   `PROVISIONAL_DEFORESTATION_EROSION_RATE` (0.002) per unit of missing
   coverage per sim day. A region at forestCoverage 0.1 loses ~0.0018
   soilHealth per sim day to erosion.
2. **SOIL DEGRADATION → REDUCED PRODUCTIVITY**: low `soilHealth` reduces
   `industrialActivity` at `PROVISIONAL_SOIL_PRODUCTIVITY_PENALTY` (0.001)
   per unit of soil-health deficit per sim day (GDD §10.3 "soil degradation
   → reduced productivity").
3. **WATER SCARCITY → HIGHER PRICES**: low `waterAvailability` raises the
   `index:commodity-basket` global market index at
   `PROVISIONAL_WATER_SCARCITY_PRICE_LIFT` (0.0008) per unit of water
   deficit, population-weighted so a populous parched region lifts the
   global price more (GDD §10.3 "water scarcity → higher prices").
4. **BIODIVERSITY LOSS → REDUCED RESILIENCE**: low `biodiversity` pulls the
   global `ecosystemResilience` down at
   `PROVISIONAL_BIODIVERSITY_RESILIENCE_PENALTY` (0.01) per unit of
   deficit.
5. **SPECIES EXTINCTION (irreversible — GDD §10.3)**: if a region's
   `biodiversity` is below `PROVISIONAL_SPECIES_EXTINCTION_THRESHOLD`
   (0.2), it is FLOORED at its current value here (the
   secondary-consequence guard — a downstream secondary effect cannot lift
   biodiversity back above the threshold once collapse has begun) and the
   global `speciesExtinctionRate` is ratcheted up + a `notification`
   (code `species-extinction-collapse`, severity `critical`) is emitted.

The primary recovery floor + rate ratchet live in `evolveRegions`
(regional.ts); this helper reinforces the irreversibility so the secondary
chains cannot reverse collapse. A no-op when there are no regions.
Deterministic given `state` — no RNG.

### `environmentalEventProbabilityMultiplier` — the warming signal for the roller

`environmentalEventProbabilityMultiplier(state)` is a pure read returning the
warming-driven environmental-event probability multiplier used by
`rollRandomEvents`. Reads P7's `globalTemperature` (the climate feedback
signal). A +2 °C anomaly doubles environmental-event probability; a +4 °C
anomaly triples it: `1 + 0.5 * warmingAnomaly` (@provisional — GDD §10.3 /
§17). Returns 1 when there is no warming. This is how the climate feedback
loop reaches the stochastic roller without a schema field: the elevated
baselines + this multiplier shift the probability `rollRandomEvents` reads.

---

## 6. Global markets (GDD line 563 — markets at regional and global scales)

**File:** `packages/simulation/src/events/markets.ts` (pure helpers).

This is the GLOBAL market index layer — macro indicators like
`index:commodity-basket`, `index:energy`, `index:food`, `index:materials`
that influence regional prices + the central bank's recession / boom signal
(global.ts `updateMonetaryPolicy`). It does NOT replace P8's BusinessSystem
per-business commodity market simulation; it sits ABOVE it as the macro
index layer the EventSystem evolves each tick.

### `evolveGlobalMarketIndices` — mean-reversion + supply/monetary/policy/event pressure

`evolveGlobalMarketIndices(state, dtSeconds)` evolves
`eventState.global.globalMarketIndices` (a record of market-index id →
level, baseline 100) over `dtSeconds`. Pure: returns a new state (emits no
SimulationEvents — the central bank's `monetary-policy-changed` surfaces
material index moves on its own cadence). Each index mean-reverts toward a
pressure-shifted baseline at `PROVISIONAL_MARKET_MEAN_REVERSION_RATE` (0.02)
per sim day. The shifted baseline (around 100) is computed by
`shiftedBaseline(indexId, state, aggregateActivity)`:

- **Monetary policy** affects ALL indices (investment cost of capital): the
  baseline shifts by `-rateDeviation *
  PROVISIONAL_INTEREST_RATE_INDEX_SENSITIVITY` (200) where `rateDeviation =
  interestRate - 0.05` (the `NEUTRAL_INTEREST_RATE`). A rate of 0.07 drags
  every index baseline by -4 points.
- **`index:materials`** — high aggregate regional industrialActivity lifts
  materials demand: `baseline += aggregateActivity *
  PROVISIONAL_MATERIALS_SUPPLY_PRESSURE` (10).
- **`index:commodity-basket`** — oversupply from high activity softens
  commodity prices: `baseline -= aggregateActivity *
  PROVISIONAL_COMMODITY_OVERSUPPLY_DRAG` (5).
- **`index:energy`** — a carbon tax raises energy costs:
  `baseline += carbonTaxRate *
  PROVISIONAL_CARBON_TAX_ENERGY_LIFT` (30).
- **`index:food`** — food tracks ecosystem resilience (low resilience →
  scarce food → higher prices): `baseline += (1 - ecosystemResilience) *
  10`.
- **Active events** — an active `event:market-crash` subtracts
  `PROVISIONAL_ACTIVE_EVENT_INDEX_SWING` (20) × severity scale from every
  index per active tick; an active `event:boom` adds it; an active
  `event:resource-scarcity` adds half to commodity + food; an active
  `event:recession` subtracts half from all. Severity scale is
  catastrophic=2×, severe=1.5×, moderate=1×, minor=0.5×.

`aggregateIndustrialActivity(state)` computes the population-weighted
average regional `industrialActivity` — the global supply signal. If
`globalMarketIndices` is empty, the helper seeds a @provisional default set
of macro indices (`DEFAULT_MARKET_INDICES`: commodity-basket / energy / food
/ materials) at the 100 baseline so the central bank + downstream consumers
have a signal from tick one. Mean reversion is exponential:
`level + (baseline - level) * (1 - (1 - 0.02)^days)`. Indices are clamped
nonnegative. A no-op when `dtSeconds <= 0`. Deterministic — no RNG.

### `getGlobalMarketIndex` — read a specific index

`getGlobalMarketIndex(state, marketName)` reads a specific global market
index by id, defaulting to the 100 baseline when the index is absent. Pure +
read-only.

The `index:commodity-basket` is the central-bank recession / boom signal
(`COMMODITY_BASKET_INDEX_ID` in global.ts); `updateMonetaryPolicy` reads it
to decide whether to cut or raise rates (§7).

---

## 7. Government & monetary policy (GDD §148-152, §404-408 — Milestone 9)

**File:** `packages/simulation/src/events/global.ts` (pure helpers).

### `updateGovernmentPolicy` — throttled government reaction (GDD §148-152)

`updateGovernmentPolicy(state, now)` is the government's periodic adjustment
of environmental regulations / carbon tax / subsidies based on aggregated
environmental degradation. Pure: returns a new state +
`government-policy-changed`. Self-throttles: a no-op when the current sim
day is NOT a multiple of
`PROVISIONAL_GOVERNMENT_POLICY_INTERVAL_DAYS` (30 ≈ one season — a typical
policy decision cycle). It also skips day 0 (a deterministic gate — let the
regional indicators settle one cycle before the government reacts, so a
freshly-seeded world isn't immediately regulated). When it runs:

- `degradation = 1 - ecosystemResilience + min(0.3, speciesExtinctionRate *
  0.1)` — a collapsing environment raises degradation; irreversible species
  loss adds a permanent penalty (capped at 0.3) so the government keeps
  tightening.
- `environmentalRegulations` tightened by `degradation *
  PROVISIONAL_POLICY_ADJUSTMENT_RATE` (0.05).
- `carbonTaxRate` raised by `degradation * 0.05 * 0.5`.
- If `degradation > 0.4`, a `subsidy:sustainable-industry` subsidy is added
  or reinforced (rate = `degradation * 0.3`) — subsidies shift to favor
  sustainable industries (GDD §148-152).

Player `set-government-policy` actions can override at any time (the next
throttled update re-reacts to the current degradation from the overridden
baseline).

### `updateMonetaryPolicy` — throttled central-bank reaction (GDD §404-408)

`updateMonetaryPolicy(state, now)` is the central bank's periodic adjustment
of the policy interest rate / inflation target / money-supply growth based on
economic conditions. Pure: returns a new state + `monetary-policy-changed`.
Self-throttles: a no-op when the current sim day is NOT a multiple of
`PROVISIONAL_MONETARY_POLICY_INTERVAL_DAYS` (30). It also skips day 0. When
it runs:

- Reads the `index:commodity-basket` global market index (default 100 if
  absent) as the recession / boom signal.
- `deviation = (marketIndex - 100) / 100`. If `deviation <=
  PROVISIONAL_RECESSION_THRESHOLD` (-0.1, a 10% drop) → recession → cut the
  policy rate by `PROVISIONAL_RATE_ADJUSTMENT` (0.01 = 100 bps), floored at
  `PROVISIONAL_RATE_FLOOR` (0.005); lower the inflation target (floor
  0.005); loosen money-supply growth (ceiling 0.08). If `deviation >=
  PROVISIONAL_BOOM_THRESHOLD` (0.1, a 10% rise) → boom → raise the rate
  (ceiling `PROVISIONAL_RATE_CEILING` 0.15); raise the inflation target
  (ceiling 0.05); tighten money-supply growth (floor 0.01).
- No market signal (deviation within the band) → policy holds (no change,
  no event).

P10b reads the market index as set by event effects (market-crash /
resource-scarcity / boom); P10c's `evolveGlobalMarketIndices` drives per-tick
market index evolution so the central bank sees a continuously-moving
signal. Player `set-monetary-policy` actions can override at any time.

### `severityMultiplier` — deterministic severity → magnitude mapping

`severityMultiplier(severity)` maps a severity band to a 0–2 magnitude
multiplier applied to the content `effects` deltas (used by
`applyEventEffects` in §3 / `processScheduledEvents`'s FIRE phase, and
inlined in markets.ts `severityScale`). `minor` = 0.5, `moderate` = 1.0,
`severe` = 1.5, `catastrophic` = 2.0. @provisional tuning (GDD §17 — event
balance). Exported for tests + future tuning.

### `applyEventEffects` — the content `effects` deltas applied to state

`applyEventEffects(state, event)` applies an active event's
`EventDefinition.effects` deltas to regional / global state (GDD §10.3 —
environmental damage creates secondary consequences). Pure: returns a new
state (emits NO events — the caller emits `event-triggered`; the next
throttled `updateGovernmentPolicy` emits `government-policy-changed` if the
policy moved further). Effect scaling: each content delta is multiplied by
`severityMultiplier(severity) * (1 + degradation *
PROVISIONAL_EVENT_SEVERITY_SCALING)` where `degradation = 1 -
ecosystemResilience` (a collapsing world amplifies event severity — GDD
§10.3 feedback, `PROVISIONAL_EVENT_SEVERITY_SCALING` = 1.0). Effect path
resolution:

- `globalMarketIndices.<indexId>` → `eventState.global.globalMarketIndices[indexId]`.
- An `aggregatedIndicators` field (`atmosphericCarbon` / `globalTemperature`
  / `avgSoilHealth` / `avgBiodiversity` / `avgForestCoverage` /
  `ecosystemResilience` / `speciesExtinctionRate`) → the corresponding
  `aggregatedIndicators` field (`speciesExtinctionRate` is clamped
  nonnegative — the irreversible accumulator).
- `climate.<field>` / `pollution.<field>` → the target region's nested
  field (`temperatureBaseline` / `precipitationBaseline` /
  `humidityBaseline`; `air` / `water` / `soil`).
- A top-level region field (`waterAvailability` / `soilHealth` /
  `biodiversity` / `forestCoverage` / `industrialActivity`) → the target
  region's field (the 0-1 indicators + industrialActivity are clamped to
  [0,1]).

Region targeting: if `payload.regionId` is set, region-targeted effects
apply to that region only; otherwise to ALL regions (a "global" event).
Global effects (`globalMarketIndices` / `aggregatedIndicators`) apply
regardless of `payload.regionId`. If `payload.regionId` is set but the
region does not exist, region-targeted effects are skipped (the global
effects still apply). Policy-category events additionally nudge
`governmentPolicy` via `applyPolicyNudge` (carbon-tax-introduced → higher
`carbonTaxRate`; environmental-regulation-tightened → stricter
`environmentalRegulations`; subsidy-granted → a
`subsidy:sustainable-industry` subsidy) — the nudge is keyed off the event
type id because content authors expressed the policy intent via the event
category + id rather than a `governmentPolicy.*` effect path (@provisional
mapping — R-P10-2).

---

## 8. Stochastic event rolling (R-P10-N RESOLVED — seeded FNV-1a sub-RNG, zero root draws)

**File:** `packages/simulation/src/events/random.ts` (pure helpers).

This module adds the stochastic event rolling P10b deferred. Each scheduler
check (throttled by `PROVISIONAL_EVENT_CHECK_INTERVAL_TICKS`) rolls a base
probability (`PROVISIONAL_EVENT_BASE_PROBABILITY` = 0.02) scaled by global
degradation (worse environment → more events) and, if triggered, picks an
eligible event type weighted by `probabilityWeight × triggerConditions`,
rolls a random severity within the definition's `severityRange`, rolls a
random duration within the `durationRange`, and schedules it to fire next
tick.

### The RNG resolution — R-P10-N RESOLVED

P10b deferred random rolling because `Rng.fork()` advances the shared root
RNG by exactly one draw BY DESIGN (`packages/simulation/src/rng.ts` —
`fork()` calls `this.next()` to seed the child). The persisted
`GameState.rngState` is the root state AFTER all per-step forks
(`simulation.ts` runOneStep persists `rng.getState()` after the system
loop). Adding a per-step EventSystem fork at slot #12 would shift the
BiologySystem (#3) + AutomationSystem (#9) child seeds at every subsequent
tick — breaking the calibrated mortality / catch-up death sequences pinned
by the P7d / P8b determinism tests (the crippled-tree "starved tree still
dies" test is calibrated to the current 2-fork-per-step root sequence and
flips dies → survives if a third per-step fork lands).

P10c resolves this with a SEEDED sub-RNG that does NOT touch the root RNG.
`createEventSubRng(state, currentTick)` derives a 32-bit seed via an
FNV-1a-style hash (`hashStringAndNumbers`) of (`state.rngState` (the 4-tuple)
+ `currentTick` + `'events'`), then constructs a fresh `Rng.fromSeed(seed)`.
The root `Rng` is NEVER advanced — the sub-RNG draws come from a
hash-derived seed, not from `rng.next()`. This matches the R-P9-1 precedent
(the ProgressionSystem at slot #11 also avoids a root fork; P9c's
`mutateTraitMagnitude` uses the same FNV-1a approach) and the R-P7-1 /
R-P8-1 no-fork precedent for the EnvironmentSystem + BusinessSystem.

Determinism preserved: same `rngState` + same `currentTick` → same hash →
same sub-seed → same event sequence. Root RNG unchanged across an
`EventSystem.execute` (the determinism test in `events.test.ts` pins this —
`rollRandomEvents` never calls `ctx.rng.next()` / `ctx.rng.fork()`). The
FNV-1a hash returns a nonzero 32-bit unsigned int (`h || 1`).

### `rollRandomEvents` — the per-check stochastic roll

`rollRandomEvents(state, currentTick)` is the per-check stochastic event
roll. Pure: returns a new state + `event-scheduled` events for the rolled
events. Self-throttles to the check cadence (`currentTick %
PROVISIONAL_EVENT_CHECK_INTERVAL_TICKS !== 0` → no-op). When it runs:

1. **Collect eligible candidates** — `collectEligibleEvents(state)` returns
   every `(definition, region)` pair whose `triggerConditions` all pass
   (§trigger-conditions below). No candidates → no-op.
2. **Build the seeded sub-RNG** — `createEventSubRng(state, currentTick)`
   (zero root draws — R-P10-N resolved).
3. **Compute the probability multiplier** — `multiplier = 1 + degradation *
   PROVISIONAL_EVENT_SEVERITY_SCALING`; `baseProb =
   PROVISIONAL_EVENT_BASE_PROBABILITY * multiplier`. `degradation =
   globalDegradation(state)`.
4. **Roll up to `PROVISIONAL_MAX_RANDOM_EVENTS_PER_CHECK` (2) events** —
   each attempt draws `roll = subRng.next()`; if `roll >= baseProb` skip;
   otherwise pick a candidate weighted by `definition.probabilityWeight`
   (cumulative draw), roll a severity within `severityRange` (weighted
   `[4,3,2,1]` toward minor), roll a duration within `durationRange`
   (`rng.nextInt(min, max)`), build a payload `{regionId, severity,
   duration}`, and `scheduleEvent` it to fire at `currentTick +
   FIRE_NEXT_TICK_OFFSET` (1 — fires on the NEXT check to avoid re-entrancy
   with this check's firing phase).

### `globalDegradation` — the probability multiplier signal

`globalDegradation(state)` is a pure read returning a [0,1] scalar that
drives the probability multiplier. `degradation = 1 - ecosystemResilience +
min(0.3, speciesExtinctionRate * 0.1) + min(0.3, (warming / 4) * 0.3)` where
`warming = max(0, globalTemperature - 14)`. A collapsing environment
(ecosystemResilience low) + irreversible species loss + climate warming all
raise degradation → more events fire → more severe events (the GDD §10.3
feedback: "climate disruption increases drought, heat, and extreme weather
risks").

### `collectEligibleEvents` + the trigger-condition evaluator

`collectEligibleEvents(state)` iterates `EVENT_DEFINITIONS` × regions and
returns every `(definition, region)` pair whose `triggerConditions` all
pass. The condition evaluator (`evaluateCondition`) supports the descriptive
patterns used in the content event definitions (rule 5 — content is data;
the *evaluation* logic lives here, reading the relevant live state per
condition):

- `season == summer` / `season in (spring, summer)` — season derived from
  `state.clock.day` (day-of-year modulo 365).
- `recession active` — true if an `event:recession` is in
  `eventState.scheduler.active`.
- `vulnerabilities contains "flood-risk"` — region's `vulnerabilities`
  list.
- `globalTemperature > baseline + 1` — P7's `globalTemperature` vs 14 +
  N.
- `atmosphericCarbon > 430` — P7's `atmosphere.co2Concentration`.
- `environmentalRegulations < 0.5` / `interestRate > 0.07` /
  `moneySupplyGrowth > 0.04` — policy fields.
- `globalMarketIndices["index:commodity-basket"] above 100` /
  `above trend` / `below trend` — market-index levels.
- `<field> above/below regional average` — the region's value vs the
  cross-region mean (top-level + `climate.` / `pollution.` nested fields).
- `<field> above/below threshold` — fixed thresholds (`pollution.air` →
  30, `pollution.water` → 20, else 0.5).
- `<field> <op> <number>` — generic comparison on a regional field.

Unknown patterns default to `true` (defensive, @provisional).

---

## 9. End-game objectives (GDD §12 — six objectives, tracked independently)

**File:** `packages/simulation/src/events/objectives.ts` (pure READ-ONLY
helpers).

GDD §12 lists six end-game objectives (the "endings" layer). They "are
tracked independently and may overlap; no mandatory ending" — a player can
pursue several in the same playthrough. The 6 objectives (`OBJECTIVE_IDS`):

| Objective id | Category | Completion criteria (descriptive) | Thresholds |
|---|---|---|---|
| `wealthiest-being` | wealth | personalCash ≥ 1 billion + significant global-economy influence | `PROVISIONAL_WEALTHIEST_BEING_CASH_MINOR` = 1e11 minor; `PROVISIONAL_WEALTHIEST_BEING_INFLUENCE` = 0.1 |
| `great-restoration` | restoration | biodiversity + forestCoverage + ecosystemResilience all > 0.8 (global AND every region) | `PROVISIONAL_RESTORATION_THRESHOLD` = 0.8 |
| `last-tree` | destruction | biodiversity < 0.2 + forestCoverage < 0.2 + aggregate industrialActivity ≥ 0.6 | `PROVISIONAL_DESTRUCTION_THRESHOLD` = 0.2 |
| `natural-balance` | balance | financialSecurity > 0.8 + ecosystemResilience > 0.8 | `PROVISIONAL_FINANCIAL_INDEPENDENCE` = 0.8 |
| `industrial-empire` | industrial | own businesses across all 6 supply-chain levels (0-5) | `SUPPLY_CHAIN_LEVEL_COUNT` = 6 |
| `generational-legacy` | generational | totalGenerations ≥ 3 | `PROVISIONAL_GENERATIONAL_LEGACY_GENERATIONS` = 3 |

### `evaluateObjectives` — the read-only map

`evaluateObjectives(state)` evaluates all six objectives against the current
game state. Pure + READ-ONLY: returns an `ObjectiveMap` (objective id →
`{id, achieved, progress, description}`); mutates nothing. Each objective is
tracked independently (may overlap; no mandatory ending — GDD §12).
`progress` is a continuous [0,1] fraction the UI reads for progress bars;
the `wealthiest-being` progress is the min of the cash progress + the
influence progress; the `great-restoration` progress is the min of the three
global indicators / threshold (capped at 1); the `last-tree` progress is how
far below 0.2 the most-degraded indicator has fallen (the less-destroyed one
gates); `natural-balance` is the min of the two; `industrial-empire` is the
distinct supply-chain level count / 6; `generational-legacy` is
min(1, totalGenerations / 3).

The `great-restoration` evaluator enforces the GDD §10.2 local-collapse
guard: the global aggregated indicators must clear the 0.8 bar AND every
region must too (`regions.every(r => r.biodiversity >= 0.8 &&
r.forestCoverage >= 0.8)`) — a healthy global average cannot conceal a
collapsing local ecosystem. The `wealthiest-being` evaluator reads
`state.player.personalCash` (bigint minor-units string — TDD §10.1 precision)
+ the sum of `globalMarketIndices` deviations from the 100 baseline as the
global-economy-influence proxy. The `industrial-empire` evaluator reads
`state.businesses` (the distinct `supplyChainLevel` values). The
`generational-legacy` evaluator reads `state.progression.prestige.
totalGenerations`.

### `diffObjectives` — first-achievement emission

`diffObjectives(before, after)` computes the set of objective ids that
flipped false → true between a `before` map and an `after` map. Pure. The
EventSystem computes `evaluateObjectives` on the pre-tick state (step 0) and
the post-tick state (step 11) each tick and emits a `notification` (code
`objective-achieved`, severity `critical`) for each newly-achieved objective
— the message carries the objective's `description`. This reuses the
existing `notification` SimulationEvent variant (P10a froze the shared
schemas, so no new `objective-achieved` event type is added; the `code`
field carries the signal). @provisional — a future schema may add a persisted
`objectives` block + a dedicated `objective-achieved` event type (R-P10-3).

### Objectives NOT persisted (R-P10-3)

The objectives are NOT persisted on `GameState` — they are recomputed each
tick from the live state (`evaluateObjectives` is read-only). The
first-achievement signal is the `notification` event emitted within the
tick the objective flips false → true; a re-loaded save recomputes the map
fresh (there is no persisted "already achieved" flag). This is a deliberate
consequence of P10a freezing the schemas — a persisted objectives block would
need a schema addition. R-P10-3 carries this forward.

### Relationship to P9b achievements

GDD §12: the ProgressionSystem (P9b) already tracks 12 achievements; the 6
end-game objectives here are the GDD §12 "endings" layer on TOP of
achievements. They may overlap with achievements (e.g.
`achievement:wealthiest-being` vs the `wealthiest-being` objective) but are
evaluated separately — this module does NOT read the achievements list.

---

## 10. EventSystem per-tick contract (slot #12 — the LAST system)

`EventSystem` (`packages/simulation/src/systems/events.ts`) replaces the P0
stub at **registry slot #12 — the LAST system**. It runs once per simulation
step AFTER every gameplay system (TimeSystem #1 → ProgressionSystem #11) so
it sees the fully-updated state for the step (registry.ts: "EventSystem —
scheduled events; runs last so it sees the full tick"). Slot #12 was
reserved for "scheduled events; runs last" (registry.ts).

```text
execute(state, ctx):
  0. Deep-copy the input state (TDD §4.1, §18.4 — never mutate the input).
     Evaluate end-game objectives on the INPUT state (before the tick's
     transforms) so the post-tick diff can emit `objective-achieved`
     notifications for objectives that flip false → true this tick.
  1. Seed `eventState.global.regions` with the @provisional default biomes
     if empty (idempotent — the v13 migration leaves `regions` empty).
  2. rollRandomEvents (self-throttled by
     PROVISIONAL_EVENT_CHECK_INTERVAL_TICKS) — stochastic event rolling
     via a SEEDED sub-RNG (zero root draws — R-P10-N resolved). Rolls
     eligible events weighted by probabilityWeight × triggerConditions,
     schedules them to fire next tick.
  3. processScheduledEvents (self-throttled) — fire due scheduled events
     into `active`, apply their effects, decrement active events'
     `remaining`, retire concluded events to `history`. Emits
     `event-triggered` / `event-expired`.
  4. evolveRegions (every tick) — drift each region's indicators (pollution
     accumulates from industrialActivity + decays; soil / water / forest /
     biodiversity recover at PROVISIONAL_EVENT_RECOVERY_RATE minus pollution
     stress; biodiversity below PROVISIONAL_SPECIES_EXTINCTION_THRESHOLD
     collapses irreversibly + ratchets speciesExtinctionRate). Emits
     `regional-condition-shifted` for threshold crossings.
  5. applyClimateFeedback (every tick) — the P7↔P10 bridge: GHG →
     temperature → regional climate baseline drift → increased
     extreme-weather event probability (read by rollRandomEvents next tick).
  6. applyEnvironmentalFeedback (every tick) — GDD §10.3 secondary
     consequences: deforestation → erosion → soilHealth; soil degradation →
     reduced productivity; water scarcity → higher resource prices;
     biodiversity loss → reduced resilience; species extinction irreversible
     below threshold.
  7. evolveGlobalMarketIndices (every tick) — per-tick global market-index
     evolution (mean-reversion + supply/monetary/policy/active-event
     pressure). GDD line 563 markets at global scale.
  8. aggregateGlobalIndicators (every tick) — recompute global averages
     from regional conditions (population-weighted) + track min regional
     values.
  9. updateGovernmentPolicy (self-throttled by
     PROVISIONAL_GOVERNMENT_POLICY_INTERVAL_DAYS) — government tightens
     environmental regulations + carbon tax based on degradation. Emits
     `government-policy-changed`.
  10. updateMonetaryPolicy (self-throttled by
      PROVISIONAL_MONETARY_POLICY_INTERVAL_DAYS) — central bank adjusts
      interest rate / inflation target / money-supply growth based on the
      commodity-basket market index. Emits `monetary-policy-changed`.
  11. evaluateObjectives (read-only) on the post-tick state + diff against
      the pre-tick map → emit `objective-achieved` notifications for
      objectives that flipped false → true this tick (GDD §12 endings).
```

The system is pure: it deep-copies the input state on entry (TDD §4.1,
§18.4), mutates the copy via the pure helpers, and returns the new state +
events. The input is NEVER mutated. Each helper does a **targeted clone** of
only the `eventState.*` sub-path it touches (P10c perf — avoids a full
`structuredClone` per tick; the inline `// Targeted clone (P10c perf — …)`
comments in `scheduler.ts` / `regional.ts` / `global.ts` / `climate.ts` /
`markets.ts` / `actions.ts` document each). Rendering reads only — the
rendering layer MUST NOT evaluate events or policy independently. This
system is the single engine-side driver of scheduled-event firing + regional
evolution + climate feedback + market evolution + policy reaction +
objective evaluation; the UI dispatches event actions (schedule-event,
trigger-event, set-government-policy, …) but never runs event processing.

The RNG fork is NOT called — `ctx.rng.fork('EventSystem')` is never invoked.
The stochastic rolling (step 2) uses the seeded FNV-1a sub-RNG (§12); every
other step is pure arithmetic. A determinism test in `events.test.ts` pins
the no-fork behaviour: the root RNG state is unchanged across an
`EventSystem.execute`, and the BiologySystem / AutomationSystem RNG
sequences are unaffected.

---

## 11. The six action handlers (P10b — TDD §6.4 / §11)

**File:** `packages/simulation/src/events/actions.ts` (registered in
`packages/simulation/src/actions/handlers.ts`).

| Handler | Action | Effect |
|---|---|---|
| `scheduleEventHandler` | `schedule-event` | Delegates to `scheduleEvent(state, eventTypeId, scheduledAt, payload, priority, tick)`. Resolves the type via `getEventDefinitionById` (unknown → `UnknownEventDefinitionError`), allocates `evt-N` from `nextEventId`, appends the `ScheduledEventInstance`, emits `event-scheduled`. |
| `cancelEventHandler` | `cancel-event` | Delegates to `cancelScheduledEvent(state, eventId)`. Idempotent no-op on a missing id. Emits NO event (the cancellation is reflected in the scheduler state). |
| `triggerEventHandler` | `trigger-event` | Merges `regionId` + `severity` into the event `payload`, delegates to `triggerEventImmediate(state, eventTypeId, mergedPayload, tick)`. Resolves severity (explicit wins; else `'moderate'`), resolves duration (explicit wins; else the `durationRange` midpoint), builds the `ActiveEvent`, applies effects via `applyEventEffects`, emits `event-triggered`. |
| `resolveEventHandler` | `resolve-event` | Delegates to `resolveActiveEvent(state, eventId, tick)`. Finds the active event (unknown → `UnknownActiveEventError`), retires it to `history` with `outcome: 'mitigated'`, emits `event-resolved`. Does NOT revert applied effects (recovery is gradual). |
| `setGovernmentPolicyHandler` | `set-government-policy` | Merges a partial `GovernmentPolicy` into `eventState.global.governmentPolicy` (shallow merge — `subsidies` replaced wholesale when supplied). Emits `government-policy-changed` carrying the resulting full policy. |
| `setMonetaryPolicyHandler` | `set-monetary-policy` | Merges a partial `MonetaryPolicy` into `eventState.global.monetaryPolicy` (shallow merge). Emits `monetary-policy-changed` carrying the resulting full policy. |

All handlers are pure: they return a new state + events without mutating the
input. Deterministic given `(state, action)` (TDD §18.3). `tick` (the
action's sim second) is passed through to the pure helpers as `now` and used
as the emitted event's `at` for determinism. Each handler does a targeted
clone of only the `eventState.*` sub-path it touches (P10c perf).

### The typed errors (errors.ts)

Three real `class` errors (runtime-only signals, NOT part of the saved
`GameState` — mirroring `progression/errors.ts` + `business/errors.ts` +
`automation/errors.ts`):

- `UnknownEventDefinitionError` — a `schedule-event` / `trigger-event`
  action referenced an unknown `eventTypeId` (no `EventDefinition` with that
  id registered in `packages/content/src/events/event-types.ts`). Mirrors
  `UnknownResearchNodeError` + `UnknownBusinessTypeError`.
- `UnknownActiveEventError` — a `resolve-event` action targeted an event id
  that is neither in `active` nor in `scheduled` (it was never scheduled, or
  it already concluded). Mirrors `TraitNotAcquiredError`'s "nothing to act
  on" rejection.
- `UnknownScheduledEventError` — a `cancel-event` action targeted a
  scheduled-event id not in `scheduled`. Exported for admin/test code that
  prefers a thrown signal; the `cancel-event` action handler itself does NOT
  throw (it mirrors P6b2's enable/disable-automation idempotency).

@provisional — a future phase that promotes EventSystem errors to the shared
package (so the web app imports them from `@capitalist-tree/shared`) would
move these classes verbatim. P10a froze the shared error surface
(`packages/shared/` is read-only per the P10b task contract), so P10b keeps
them in the simulation package. The `name` strings are part of the public
interface — do NOT rename.

---

## 12. Determinism contract (TDD §18.3 — R-P10-N RESOLVED)

Given the same initial state, seed, player actions, and duration, the
EventSystem + the event action handlers produce the same final state +
events. The module upholds this by construction:

- The scheduler transforms are pure arithmetic on the current eventState
  (no randomness in `processScheduledEvents` / `scheduleEvent` /
  `cancelScheduledEvent` / `triggerEventImmediate` / `resolveActiveEvent`).
- The regional drift (`evolveRegions`) + global aggregation
  (`aggregateGlobalIndicators`) + policy reactions
  (`updateGovernmentPolicy` / `updateMonetaryPolicy`) + climate feedback
  (`applyClimateFeedback` / `applyEnvironmentalFeedback`) + market evolution
  (`evolveGlobalMarketIndices`) are pure arithmetic — no RNG.
- The stochastic rolling (`rollRandomEvents`) uses a SEEDED sub-RNG derived
  from a deterministic FNV-1a hash of `(rngState, currentTick, 'events')`
  — zero root RNG draws. Same `rngState` + same `currentTick` → same hash →
  same sub-seed → same event sequence.
- `tick` is an explicit action payload field on every event action
  (`schedule-event`, `cancel-event`, `trigger-event`, `resolve-event`,
  `set-government-policy`, `set-monetary-policy`) so the emitted event `at`
  + state stamps are deterministic given `(state, action)` (TDD §18.3 — the
  save fully describes the result).
- The scheduler + policy throttles are deterministic given `(now,
  stepSeconds)` — no persisted last-checked field (the schema has no such
  field; P10a froze the schema). `processScheduledEvents` throttles on
  `tickIndex % PROVISIONAL_EVENT_CHECK_INTERVAL_TICKS`; the policy helpers
  throttle on `currentDay % PROVISIONAL_POLICY_INTERVAL_DAYS` (both skip day
  0 / tick 0 deterministically).
- The `eventState.scheduler.nextEventId` counter is monotonic + persisted,
  so a re-loaded save allocates the next id deterministically.

Save/load preserves all `eventState` fields via the v12→v13 migration + Zod
defaults. The migration is idempotent: a v13 save with `eventState` already
present is rebuilt with the same nested values (missing sub-fields
backfilled), so the result deep-equals the input. Verified in
`events.test.ts` (determinism: same seed → same event state; purity: input
not mutated) + the climate / markets / random / objectives test files.

### The RNG fork — R-P10-N RESOLVED (was deferred in P10b)

The EventSystem does NOT call `ctx.rng.fork('EventSystem')`. `Rng.fork()`
advances the shared root RNG by exactly one draw **by design**
(`packages/simulation/src/rng.ts`: `fork()` calls `this.next()` to seed the
child — "the parent advances by exactly one draw to seed the fork"). The
persisted `GameState.rngState` is the root state AFTER all per-step forks
(`simulation.ts` runOneStep persists `rng.getState()` after the system loop).
So at step N+1, every system that forks (BiologySystem #3, AutomationSystem
#9) rebuilds its child seed from a root state that includes step N's fork
count. Adding an EventSystem fork at #12 adds one draw per step to that
accumulated root state, which shifts the child seeds BiologySystem +
AutomationSystem derive at every subsequent tick — breaking the calibrated
mortality / catch-up death sequences pinned by the P7d / P8b determinism
tests.

The "slot #12 is LAST" reasoning holds only WITHIN a single tick
(EventSystem's fork cannot shift a downstream forking system in the SAME
tick, because there is no downstream system). But ACROSS ticks the
accumulated root state shifts every downstream forker's child seed — that is
the perturbation R-P10-N avoids. This is the SAME mechanism documented for
the ProgressionSystem at slot #11 (R-P9-1); the EventSystem at slot #12 is
not exempt just because it is last.

P10c resolves this WITHOUT a root fork: `rollRandomEvents` derives its
sub-RNG from `createEventSubRng(state, currentTick)` — a 32-bit FNV-1a hash
of `(state.rngState, currentTick, 'events')` → `Rng.fromSeed(seed)`. The
root RNG is NEVER advanced; the sub-RNG draws come from the hash-derived
seed. Matches the R-P9-1 precedent (the ProgressionSystem at slot #11 also
avoids a root fork; P9c's `mutateTraitMagnitude` uses the same FNV-1a
approach). Determinism preserved: same `rngState` + same `currentTick` →
same hash → same sub-seed → same event sequence.

Three determinism tests in `events.test.ts` pin the no-fork contract: the
root RNG state is unchanged across an `EventSystem.execute`, a full
`engine.advance` persists the same root RNG whether or not the EventSystem
runs, and the BiologySystem / AutomationSystem RNG sequences are unaffected.
**Status: RESOLVED in P10c.** The seeded sub-RNG is the resolution; a future
refactor of `fork()` to a non-advancing sub-stream derivation would let the
EventSystem use `fork()` directly (a deeper change that retunes every
system's sequence — out of P10d scope).

---

## 13. Carry-forward / known gaps (R-P10 items)

P10 surfaced seven carry-forward items. The frozen-schema constraint (P10a
froze `packages/shared`) shapes several of them; each is flagged in the
source with a `// R-P10-N:` comment at the relevant file:line (documentation
comments only — no logic changes).

### R-P10-N: RNG fork — RESOLVED via seeded FNV-1a sub-RNG (zero root draws)

The EventSystem at slot #12 does NOT call `ctx.rng.fork('EventSystem')`.
Same root cause as R-P7-1 (EnvironmentSystem) + R-P8-1 (BusinessSystem) +
R-P9-1 (ProgressionSystem): `fork()` advances the root RNG by one draw by
design (`packages/simulation/src/rng.ts`); the persisted `rngState`
accumulates every per-step fork, so a fork here would shift the
BiologySystem (#3) + AutomationSystem (#9) child seeds at every subsequent
tick and break the calibrated mortality / catch-up death sequences pinned by
the P7d / P8b determinism tests. P10c resolves this WITHOUT a root fork:
`rollRandomEvents` (random.ts) derives its sub-RNG from
`createEventSubRng(state, currentTick)` — a 32-bit FNV-1a hash
(`hashStringAndNumbers`) of `(state.rngState, currentTick, 'events')` →
`Rng.fromSeed(seed)`. The root RNG is NEVER advanced; the sub-RNG draws come
from the hash-derived seed. **Status: RESOLVED in P10c.** References:
`random.ts` (file doc + `createEventSubRng` / `hashStringAndNumbers` docs),
`systems/events.ts` (file doc + inline `@provisional RNG fork DEFERRED`
comment + step-2 doc), `scheduler.ts` (file doc + R-P10-N deferral notes).
Three determinism tests pin it.

### R-P10-1: Regional drift rates are local PROVISIONAL constants

The regional drift rates (`PROVISIONAL_EVENT_POLLUTION_RATE` = 10,
`PROVISIONAL_EVENT_POLLUTION_DECAY_RATE` = 0.05,
`PROVISIONAL_EVENT_POLLUTION_STRESS_SCALE` = 200,
`PROVISIONAL_EVENT_EXTINCTION_RATE` = 0.01, plus the `REGIONAL_THRESHOLDS`
list) live as local `@provisional` constants in `regional.ts`, NOT promoted
to `packages/shared/src/constants/events.ts` (P10a froze the shared file at
the 8 cadence / threshold / recovery / aggregation constants). They are pure
data — promote them to shared (dropping the local prefix) once playtesting
settles the drift model. Exposed read-only as `REGIONAL_DRIFT_CONSTANTS` for
tests + future tuning promotion. Reference: `regional.ts` local-constants
section header (R-P10-1).

### R-P10-2: Policy reaction rates are local PROVISIONAL constants

The government + central-bank reaction rates
(`PROVISIONAL_POLICY_ADJUSTMENT_RATE` = 0.05,
`PROVISIONAL_RECESSION_THRESHOLD` = -0.1, `PROVISIONAL_BOOM_THRESHOLD` =
0.1, `PROVISIONAL_RATE_ADJUSTMENT` = 0.01, `PROVISIONAL_RATE_FLOOR` = 0.005,
`PROVISIONAL_RATE_CEILING` = 0.15) live as local `@provisional` constants in
`global.ts`, NOT promoted to `packages/shared/src/constants/events.ts`. They
are pure data — promote them to shared once playtesting settles the reaction
functions. Exposed read-only as `POLICY_CONSTANTS`. Reference: `global.ts`
local-constants section header (R-P10-2).

### R-P10-3: Objectives NOT persisted (recomputed each tick)

The end-game objectives (objectives.ts) are NOT persisted on `GameState` —
they are recomputed each tick from the live state via `evaluateObjectives`
(read-only). The first-achievement signal is a `notification` event (code
`objective-achieved`) emitted within the tick an objective flips false →
true (`diffObjectives` before/after). This reuses the existing
`notification` SimulationEvent variant because P10a froze the shared schemas
— a persisted objectives block + a dedicated `objective-achieved` event type
would need a schema addition. A future schema may add a persisted
`objectives` block (so the UI can show "already achieved" across save/load)
+ a dedicated `objective-achieved` event variant. Reference: `objectives.ts`
file doc (R-P10-3) + `systems/events.ts` step-11 doc.

### R-P10-4: Climate feedback local constants

The climate-feedback magnitudes
(`PROVISIONAL_CLIMATE_BASELINE_DRIFT_RATE` = 0.1,
`PROVISIONAL_PRECIPITATION_WARMING_PENALTY` = 0.02,
`PROVISIONAL_DEFORESTATION_EROSION_RATE` = 0.002,
`PROVISIONAL_SOIL_PRODUCTIVITY_PENALTY` = 0.001,
`PROVISIONAL_WATER_SCARCITY_PRICE_LIFT` = 0.0008,
`PROVISIONAL_BIODIVERSITY_RESILIENCE_PENALTY` = 0.01) live as local
`@provisional` constants in `climate.ts`, NOT promoted to shared. They are
pure data — promote them once playtesting settles the climate feedback
magnitudes. Exposed read-only as `CLIMATE_CONSTANTS`. Reference: `climate.ts`
local-constants section header (R-P10-4).

### R-P10-5: Global market local constants

The global market tuning constants
(`PROVISIONAL_MARKET_MEAN_REVERSION_RATE` = 0.02,
`PROVISIONAL_MATERIALS_SUPPLY_PRESSURE` = 10,
`PROVISIONAL_COMMODITY_OVERSUPPLY_DRAG` = 5,
`PROVISIONAL_INTEREST_RATE_INDEX_SENSITIVITY` = 200,
`PROVISIONAL_CARBON_TAX_ENERGY_LIFT` = 30,
`PROVISIONAL_ACTIVE_EVENT_INDEX_SWING` = 20, `NEUTRAL_INTEREST_RATE` = 0.05)
+ the `DEFAULT_MARKET_INDICES` set live as local `@provisional` constants in
`markets.ts`, NOT promoted to shared. They are pure data — promote them once
playtesting settles the macro index model. Exposed read-only as
`MARKET_CONSTANTS`. Reference: `markets.ts` local-constants section header
(R-P10-5).

### R-P10-6: 7 other systems still do per-tick full-state deepCopy in execute()

The targeted-clone perf fix applied to the EventSystem's pure helpers
(scheduler.ts / regional.ts / global.ts / climate.ts / markets.ts /
actions.ts — each clones only the `eventState.*` sub-path it touches, with
inline `// Targeted clone (P10c perf — avoids a full structuredClone per
tick)` comments) is NOT yet applied to the other 7 systems. Those systems —
environment (slot #7), biology (#3), weather (#4), resource (#8), progression
(#11), business (#6), automation (#9) — still do a per-tick full-state
`deepCopy(state)` in their `execute()` (and their internal helpers operate
on the full copy) where targeted clones of only the sub-paths they touch
would suffice. The full suite completes but runs slower than ideal. Applying
the targeted-clone pattern to those 7 systems' helpers is a follow-up
optimization (the EventSystem's perf fix is the template: spread-clone only
the modified `eventState.*` levels, share the rest by reference — pure: the
frozen input is never touched, new objects only at every modified level).
Reference: the `// Targeted clone (P10c perf — …)` comments throughout
`packages/simulation/src/events/*.ts`; the 7 systems' `execute()` deepCopy
calls in `packages/simulation/src/systems/{environment,biology-system,
weather-system,resource-system,progression,business,automation}.ts`.

---

## 14. @provisional constants (GDD §17 pointers)

All EventSystem tuning constants live in
`packages/shared/src/constants/events.ts` (the shared
`PROVISIONAL_EVENT_*` / `PROVISIONAL_GOVERNMENT_*` / `PROVISIONAL_MONETARY_*`
/ `PROVISIONAL_REGIONAL_*` / `PROVISIONAL_SPECIES_*`) plus local
`@provisional` constants inside the helper modules
(`packages/simulation/src/events/*.ts`). Each shared constant is marked with
a `// PROVISIONAL (GDD §17: <item>)` comment.

### Shared constants (`packages/shared/src/constants/events.ts`)

| Constant | Value | Resolves (GDD §17) |
|---|---|---|
| `PROVISIONAL_EVENT_CHECK_INTERVAL_TICKS` | 60 | Regional simulation granularity — scheduler check cadence (TDD §6.4) |
| `PROVISIONAL_EVENT_BASE_PROBABILITY` | 0.02 | Regional simulation granularity — base random-event probability per check |
| `PROVISIONAL_EVENT_SEVERITY_SCALING` | 1.0 | Environmental recovery timescales — global-degradation severity amplification |
| `PROVISIONAL_EVENT_RECOVERY_RATE` | 0.01 | Environmental recovery timescales — fraction of damage recovered per sim day |
| `PROVISIONAL_GOVERNMENT_POLICY_INTERVAL_DAYS` | 30 | Currency issuance mechanics and monetary policy — government re-evaluation cadence |
| `PROVISIONAL_MONETARY_POLICY_INTERVAL_DAYS` | 30 | Currency issuance mechanics and monetary policy — central-bank re-evaluation cadence |
| `PROVISIONAL_REGIONAL_AGGREGATION_WEIGHTS` | `'population'` | Regional simulation granularity — regional → global aggregation weighting scheme |
| `PROVISIONAL_SPECIES_EXTINCTION_THRESHOLD` | 0.2 | Environmental recovery timescales — biodiversity below which species loss is irreversible (GDD §10.3) |

### Local @provisional constants (helper modules)

| Constant | Value | Location | Resolves (GDD §17) |
|---|---|---|---|
| `PROVISIONAL_EVENT_POLLUTION_RATE` (R-P10-1) | 10 | `regional.ts` | Regional simulation granularity — pollution accumulation per unit industrialActivity per day |
| `PROVISIONAL_EVENT_POLLUTION_DECAY_RATE` (R-P10-1) | 0.05 | `regional.ts` | Environmental recovery timescales — natural pollution decay per day |
| `PROVISIONAL_EVENT_POLLUTION_STRESS_SCALE` (R-P10-1) | 200 | `regional.ts` | Environmental recovery timescales — total pollution at which stress ≈ 1/day |
| `PROVISIONAL_EVENT_EXTINCTION_RATE` (R-P10-1) | 0.01 | `regional.ts` | Environmental recovery timescales — species-extinction-rate increment per day in collapse |
| `PROVISIONAL_POLICY_ADJUSTMENT_RATE` (R-P10-2) | 0.05 | `global.ts` | Influence over governments + regulations — policy move per cycle per unit degradation |
| `PROVISIONAL_RECESSION_THRESHOLD` (R-P10-2) | -0.1 | `global.ts` | Currency issuance mechanics and monetary policy — market deviation below which the central bank cuts rates |
| `PROVISIONAL_BOOM_THRESHOLD` (R-P10-2) | 0.1 | `global.ts` | Currency issuance mechanics and monetary policy — market deviation above which the central bank raises rates |
| `PROVISIONAL_RATE_ADJUSTMENT` (R-P10-2) | 0.01 | `global.ts` | Currency issuance mechanics and monetary policy — absolute rate change per decision |
| `PROVISIONAL_RATE_FLOOR` (R-P10-2) | 0.005 | `global.ts` | Currency issuance mechanics and monetary policy — central-bank rate floor |
| `PROVISIONAL_RATE_CEILING` (R-P10-2) | 0.15 | `global.ts` | Currency issuance mechanics and monetary policy — central-bank rate ceiling |
| `PROVISIONAL_CLIMATE_BASELINE_DRIFT_RATE` (R-P10-4) | 0.1 | `climate.ts` | Climate model sensitivity (GDD §10.3) — regional temperature convergence per year |
| `PROVISIONAL_PRECIPITATION_WARMING_PENALTY` (R-P10-4) | 0.02 | `climate.ts` | Climate model sensitivity (GDD §10.3) — precipitation reduction per degree warming per year |
| `PROVISIONAL_DEFORESTATION_EROSION_RATE` (R-P10-4) | 0.002 | `climate.ts` | Detailed resource simulation equations (GDD §10.3) — erosion per unit missing forestCoverage per day |
| `PROVISIONAL_SOIL_PRODUCTIVITY_PENALTY` (R-P10-4) | 0.001 | `climate.ts` | Detailed resource simulation equations (GDD §10.3) — industrialActivity penalty per unit soil deficit per day |
| `PROVISIONAL_WATER_SCARCITY_PRICE_LIFT` (R-P10-4) | 0.0008 | `climate.ts` | Economic tuning (GDD §10.3) — commodity-basket lift per unit water deficit per day |
| `PROVISIONAL_BIODIVERSITY_RESILIENCE_PENALTY` (R-P10-4) | 0.01 | `climate.ts` | Environmental recovery timescales (GDD §10.3) — resilience penalty per unit biodiversity deficit |
| `PROVISIONAL_MARKET_MEAN_REVERSION_RATE` (R-P10-5) | 0.02 | `markets.ts` | Economic tuning (GDD §8.5) — index mean-reversion per day |
| `PROVISIONAL_MATERIALS_SUPPLY_PRESSURE` (R-P10-5) | 10 | `markets.ts` | Economic tuning (GDD §8.5) — materials index lift per unit industrialActivity |
| `PROVISIONAL_COMMODITY_OVERSUPPLY_DRAG` (R-P10-5) | 5 | `markets.ts` | Economic tuning (GDD §8.5) — commodity-basket drag per unit industrialActivity |
| `PROVISIONAL_INTEREST_RATE_INDEX_SENSITIVITY` (R-P10-5) | 200 | `markets.ts` | Currency issuance mechanics and monetary policy — index sensitivity per unit rate deviation |
| `PROVISIONAL_CARBON_TAX_ENERGY_LIFT` (R-P10-5) | 30 | `markets.ts` | Influence over governments + regulations — energy index lift per unit carbonTaxRate |
| `PROVISIONAL_ACTIVE_EVENT_INDEX_SWING` (R-P10-5) | 20 | `markets.ts` | Economic tuning (GDD §8.5) — index swing per active market event |
| `PROVISIONAL_MAX_RANDOM_EVENTS_PER_CHECK` (R-P10-N) | 2 | `random.ts` | Event balance — cap on random events per scheduler check |
| `PROVISIONAL_WEALTHIEST_BEING_CASH_MINOR` (R-P10-3) | `100_000_000_000n` | `objectives.ts` | Endings tuning (GDD §12) — Wealthiest-Being personal-cash threshold (1e11 minor = 1 billion) |
| `PROVISIONAL_RESTORATION_THRESHOLD` (R-P10-3) | 0.8 | `objectives.ts` | Endings tuning (GDD §12) — Great-Restoration indicator threshold |
| `PROVISIONAL_DESTRUCTION_THRESHOLD` (R-P10-3) | 0.2 | `objectives.ts` | Endings tuning (GDD §12) — Last-Tree destruction threshold |
| `PROVISIONAL_GENERATIONAL_LEGACY_GENERATIONS` (R-P10-3) | 3 | `objectives.ts` | Endings tuning (GDD §12) — Generational-Legacy generation count |
| `PROVISIONAL_FINANCIAL_INDEPENDENCE` (R-P10-3) | 0.8 | `objectives.ts` | Endings tuning (GDD §12) — Natural-Balance financial-independence proxy |
| `PROVISIONAL_WEALTHIEST_BEING_INFLUENCE` (R-P10-3) | 0.1 | `objectives.ts` | Endings tuning (GDD §12) — Wealthiest-Being global-economy-influence fraction |

When a value is promoted from "provisional" to "decided" via playtesting,
move it to a sibling `decided.ts` and drop the `PROVISIONAL_` prefix
(matching the convention in `packages/shared/src/constants/`).

---

## 15. Test inventory (post-P10d)

102 EventSystem tests across 5 files.

| File | Phase | Scope |
|---|---|---|
| `packages/simulation/test/events.test.ts` | P10b | 68 tests: scheduler (`scheduleEvent` — content gate, id allocation, appends to scheduled, emits `event-scheduled`; `cancelScheduledEvent` — removes by id, idempotent no-op on missing id; `triggerEventImmediate` — severity/duration resolution, applies effects, emits `event-triggered`; `resolveActiveEvent` — finds active, retires to history with `outcome: 'mitigated'`, emits `event-resolved`, `UnknownActiveEventError` on missing; `processScheduledEvents` — throttle gate, EXPIRE phase decrements + retires to history with `outcome: 'expired'` + emits `event-expired`, FIRE phase fires due events sorted by priority then scheduledAt, threads accumulated effects, drops unknown types gracefully); regional (`seedDefaultRegions` idempotent, 4 default biomes; `evolveRegions` — pollution accumulates + decays, indicators recover minus stress, biodiversity irreversible below threshold + ratchets speciesExtinctionRate, emits `regional-condition-shifted` for threshold crossings; `aggregateGlobalIndicators` — population-weighted averages, ecosystem-resilience composite, min tracking, preserves atmosphericCarbon/globalTemperature/speciesExtinctionRate; `minRegionalIndicators`); global (`applyEventEffects` — severity × degradation scaling, globalMarketIndices/aggregatedIndicators/climate./pollution./region-field path resolution, regionId targeting, policy nudge; `updateGovernmentPolicy` — throttle, degradation reaction, sustainable-industry subsidy; `updateMonetaryPolicy` — throttle, recession/boom bands, rate floor/ceiling; `severityMultiplier` mapping); the 6 action handlers; the 3 typed errors; determinism (same seed → same state, RNG zero root draws, full-advance RNG unchanged, BiologySystem/AutomationSystem sequences unaffected); purity (input not mutated). |
| `packages/simulation/test/events-climate.test.ts` | P10c | 9 tests: `applyClimateFeedback` — drifts temperatureBaseline toward globalTemperature at the drift rate, lowers precipitationBaseline by warming penalty, no-op on no warming / no regions / dtSeconds<=0, emits `climate-baseline-shifted` notifications for material shifts; `applyEnvironmentalFeedback` — deforestation→erosion chain, soil-degradation→productivity chain, water-scarcity→price-lift chain, biodiversity-loss→resilience chain, species-extinction floor + ratchet, no-op on no regions; `environmentalEventProbabilityMultiplier` — 1 + 0.5 per degree warming, 1 on no warming; purity. |
| `packages/simulation/test/events-markets.test.ts` | P10c | 6 tests: `evolveGlobalMarketIndices` — seeds default indices when empty, mean-reverts toward shifted baseline, materials/commodity-basket/energy/food baseline shifts, active-event pressure (market-crash drops, boom raises, resource-scarcity lifts commodity+food, recession drops), no-op on dtSeconds<=0; `getGlobalMarketIndex` — returns level or 100 baseline; purity. |
| `packages/simulation/test/events-random.test.ts` | P10c | 9 tests: `createEventSubRng` — deterministic given (rngState, currentTick), zero root draws (R-P10-N resolved); `rollRandomEvents` — throttle gate, eligibility gating, probability × degradation scaling, weighted pick, severity/duration rolls, schedules to fire next tick; `collectEligibleEvents` — (definition, region) pairs whose triggerConditions all pass; `globalDegradation` — [0,1] scalar from resilience + extinction + warming; trigger-condition evaluator (season, recession active, vulnerabilities, globalTemperature, atmosphericCarbon, policy fields, market indices, regional average, threshold, comparison); purity. |
| `packages/simulation/test/events-objectives.test.ts` | P10c | 10 tests: `evaluateObjectives` — all 6 objectives evaluated independently; wealthiest-being (cash + influence), great-restoration (global + every-region guard), last-tree (destruction + high extraction), natural-balance (financialSecurity + resilience), industrial-empire (6 supply-chain levels), generational-legacy (3 generations); progress fractions; `diffObjectives` — false→true flips; read-only (no state mutation); purity. |

The determinism tests in `events.test.ts` pin the R-P10-N resolution: the
EventSystem consumes zero root RNG draws (no fork; `rollRandomEvents` uses
the seeded FNV-1a sub-RNG), a full `engine.advance` persists the same root
RNG whether or not the EventSystem runs, and the BiologySystem /
AutomationSystem RNG sequences are unaffected.

---

## 16. File map

```
packages/
├── shared/src/
│   ├── constants/
│   │   └── events.ts                   # NEW (P10a) — 8 PROVISIONAL_EVENT_* / PROVISIONAL_GOVERNMENT_* /
│   │                                   #   PROVISIONAL_MONETARY_* / PROVISIONAL_REGIONAL_* /
│   │                                   #   PROVISIONAL_SPECIES_* constants
│   ├── schemas/
│   │   ├── event-system.ts             # NEW (P10a) — EventState, EventSchedulerState,
│   │   │                              #   ScheduledEventInstance, ActiveEvent, EventHistoryEntry,
│   │   │                              #   GlobalState, RegionState, RegionClimate, RegionPollution,
│   │   │                              #   GlobalAggregatedIndicators, GovernmentPolicy, MonetaryPolicy,
│   │   │                              #   EventDefinition + EventPriority/EventSeverity/EventOutcome/
│   │   │                              #   EventCategory enums
│   │   ├── actions-events.ts           # NEW (P10a) — 6 EventSystem action variants
│   │   └── events-events.ts            # NEW (P10a) — 7 EventSystem event variants
│   └── migrations/
│       └── defaults.ts                 # MODIFIED (P10a) — v12→v13 (add eventState: EventState +
│                                       #   seed aggregatedIndicators from P7 EnvironmentState globals)
└── simulation/src/
    ├── events/                         # NEW (P10b/P10c) — pure EventSystem helpers
    │   ├── errors.ts                   #   3 typed errors (UnknownEventDefinitionError,
    │   │                              #     UnknownActiveEventError, UnknownScheduledEventError)
    │   ├── scheduler.ts                #   P0 schedule/due/cancel + P10b scheduleEvent /
    │   │                              #     cancelScheduledEvent / triggerEventImmediate /
    │   │                              #     resolveActiveEvent / processScheduledEvents
    │   ├── regional.ts                 #   seedDefaultRegions + evolveRegions +
    │   │                              #     aggregateGlobalIndicators + minRegionalIndicators (R-P10-1)
    │   ├── global.ts                   #   applyEventEffects + updateGovernmentPolicy +
    │   │                              #     updateMonetaryPolicy + severityMultiplier (R-P10-2)
    │   ├── climate.ts                  #   applyClimateFeedback + applyEnvironmentalFeedback +
    │   │                              #     environmentalEventProbabilityMultiplier — P7↔P10 bridge (R-P10-4)
    │   ├── markets.ts                  #   evolveGlobalMarketIndices + getGlobalMarketIndex —
    │   │                              #     macro index layer above P8's per-business markets (R-P10-5)
    │   ├── random.ts                   #   rollRandomEvents + collectEligibleEvents + globalDegradation +
    │   │                              #     createEventSubRng — seeded FNV-1a sub-RNG (R-P10-N resolved)
    │   ├── objectives.ts               #   evaluateObjectives + diffObjectives + 6 objective evaluators
    │   │                              #     (R-P10-3 — objectives NOT persisted)
    │   ├── actions.ts                  #   6 action handlers
    │   └── index.ts                    #   public surface
    ├── systems/
    │   ├── events.ts                   # REPLACES STUB (P10b/P10c) — registry slot #12, LAST system
    │   │                              #   (R-P10-N RNG fork resolved via seeded sub-RNG)
    │   └── index.ts                   # MODIFIED — imports eventSystem
    ├── actions/
    │   └── handlers.ts                # MODIFIED (P10b) — registers the 6 EventSystem action handlers
    └── test/
        ├── events.test.ts              # NEW (P10b) — 68 tests
        ├── events-climate.test.ts      # NEW (P10c) — 9 tests
        ├── events-markets.test.ts      # NEW (P10c) — 6 tests
        ├── events-random.test.ts       # NEW (P10c) — 9 tests
        └── events-objectives.test.ts   # NEW (P10c) — 10 tests
```

`docs/global.md` (this file) is the human-readable model documentation; the
source-of-truth for invariants is the test suite. The paired carry-forward
records are the R-P10 items in §13 (flagged in source with `// R-P10-N:`
comments at the file:line references listed there). With P10d, all 12
systems are real — no stubs remain in `packages/simulation/src/systems/`.
