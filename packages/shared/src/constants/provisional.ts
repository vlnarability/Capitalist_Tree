/**
 * Centralized provisional constants.
 *
 * Every value in this file corresponds to (or stands in for) an unresolved
 * design decision listed in GDD section 17. They live here, in a single file,
 * so they can be tuned in one place during playtesting rather than scattered
 * as magic numbers across the engine.
 *
 * CONVENTION FOR FUTURE AGENTS:
 *   - When you need a provisional tuning value, declare it here with the
 *     `PROVISIONAL_` prefix and a `// PROVISIONAL (GDD §17: <item>)` comment
 *     pointing at the GDD entry it resolves.
 *   - Do not introduce new magic numbers inside systems. Import them from here.
 *   - When a value is promoted from "provisional" to "decided" via
 *     playtesting, move it to a new `decided.ts` sibling and remove the
 *     PROVISIONAL_ prefix. Leave a comment so the migration is traceable.
 */

// PROVISIONAL (GDD §17: Exact real-time-to-simulation-time relationship)
//
// At 1x speed (factor 60 — 1 real second = 60 simulation seconds):
//   1 real second  = 1 simulation minute (= 60 sim seconds)
//   1 real minute  = 1 simulation hour (3_600 sim sec)
//   1 real hour    = 2.5 simulation days (216_000 sim sec)
//   1 real day     = 2 simulation months (60 sim days = 5_184_000 sim sec)
//
// Note: an earlier draft of this comment read "1 real hour = 1 simulation
// day" and "1 real day = 1 simulation month", which corresponds to factor
// 24, not factor 60. The VALUE below (60) was always correct; only the
// comment math was wrong. See packages/shared/src/constants/offline.ts for
// the chunk-count consequences (30 real days = 1_800 chunks at factor 60).
//
// This is the relationship between wall-clock time and in-game time when the
// speed multiplier is 1. The TimeSystem does NOT use this directly; it is the
// consumer (apps/web) that converts wall-clock elapsed real seconds to
// elapsed simulation seconds via `simSeconds = realSeconds * REAL_TO_SIM_SECONDS * speed`.
//
// Marked provisional because GDD §17 lists this as unresolved.
export const PROVISIONAL_REAL_TO_SIM_SECONDS = 60;

// PROVISIONAL (TDD §6.2: fixed timestep "one simulation update per in-game minute")
//
// One simulation step = 60 simulation seconds = 1 in-game minute.
// TDD §6.2 calls this "a reasonable starting point" and asks that it be
// benchmarked, so it is provisional.
export const PROVISIONAL_SIMULATION_STEP_SECONDS = 60;

// PROVISIONAL (GDD §4.1: simulation speeds)
//
// The speed multipliers exposed by the speed control. TDD/GDD call these
// "initial configuration options, not final balance decisions," so they are
// provisional.
export const PROVISIONAL_SPEED_PAUSED = 0;
export const PROVISIONAL_SPEED_1X = 1;
export const PROVISIONAL_SPEED_5X = 5;
export const PROVISIONAL_SPEED_15X = 15;
export const PROVISIONAL_SPEED_60X = 60;

// Canonical ordered list of speed multipliers exposed by the UI.
export const PROVISIONAL_SPEED_MULTIPLIERS: readonly number[] = [
  PROVISIONAL_SPEED_PAUSED,
  PROVISIONAL_SPEED_1X,
  PROVISIONAL_SPEED_5X,
  PROVISIONAL_SPEED_15X,
  PROVISIONAL_SPEED_60X,
] as const;

// PROVISIONAL (GDD §17: starting currency and initial living expenses)
//
// Starting personal cash in minor currency units. Money is stored as bigint
// minor units (TDD §10.1). $500.00 = 50000 minor units.
export const PROVISIONAL_STARTING_PERSONAL_CASH_MINOR: bigint = 50_000n;

// PROVISIONAL (GDD §17: initial tree species)
//
// Default species id used when the player starts a new game with no species
// selection. P1 ships the White Oak (Quercus alba) as the first playable
// species — see packages/content/src/species/white-oak.ts. The choice is
// documented in docs/biology.md.
export const PROVISIONAL_DEFAULT_SPECIES_ID = 'species:white-oak';

// PROVISIONAL (GDD §17: initial leaf denomination and production rules)
//
// Currency code for the in-game currency. Cosmetic currency selection is a
// later-phase feature; P0 uses a single fixed currency id.
export const PROVISIONAL_DEFAULT_CURRENCY_ID = 'currency:leaf-dollar';

// PROVISIONAL (GDD §4.4: seasons)
//
// Number of in-game days per season. With 30 days/season * 4 seasons = 120
// days/year. Picked so that a full year completes inside a reasonable
// playtest window. Marked provisional — final value depends on tuning.
export const PROVISIONAL_DAYS_PER_SEASON = 30;
export const PROVISIONAL_DAYS_PER_YEAR = PROVISIONAL_DAYS_PER_SEASON * 4; // 120

// PROVISIONAL (GDD §4.1: day/night)
//
// Day starts at hour 6 (06:00) and ends at hour 18 (18:00). Expressed as
// fractions of a 24-hour day. Tunable.
export const PROVISIONAL_DAY_START_FRACTION = 0.25; // 06:00
export const PROVISIONAL_DAY_END_FRACTION = 0.75; // 18:00
export const PROVISIONAL_DAWN_WINDOW_FRACTION = 1 / 24; // ±1 hour around sunrise
export const PROVISIONAL_DUSK_WINDOW_FRACTION = 1 / 24; // ±1 hour around sunset

// PROVISIONAL (GDD §17: exact inflation model)
//
// Initial inflation rate (annual fraction). 0 = no inflation. P0 keeps this
// at zero; the EconomySystem will eventually compute it from a price index
// (TDD §10.6) rather than a flat multiplier.
export const PROVISIONAL_INITIAL_INFLATION_RATE = 0;

// PROVISIONAL (GDD §17: exact inflation model / currency issuance mechanics)
//
// Initial central-bank interest rate (annual fraction). 0 = no interest.
export const PROVISIONAL_INITIAL_INTEREST_RATE = 0;

// Initial schema version for serialized saves. Increment when the GameState
// shape changes; register a migration in packages/shared/src/migrations.
//
// v2 (P1): added `originalTree.pendingIssuances: CurrencyIssuanceRequest[]`
// — a queue of currency-issuance requests produced by `harvest-leaves` and
// drained by P3's EconomySystem. Migration v1 -> v2 backfills the field with
// an empty array.
//
// v3 (P1): added `originalTree.foliage.leafGrowthProgress: number` — an
// accumulator for fractional leaf growth so per-step energy allocation isn't
// wasted when it's too small to grow a whole leaf. Migration v2 -> v3
// backfills the field with 0.
//
// v4 (P2): added three new GameState shapes:
//   - `world.weather: WeatherState` — current condition, temperature,
//     intensity, prev condition, days-in-condition. Produced by the
//     WeatherSystem (Markov chain over per-season transition matrices).
//   - `rngStreams.weather: RngState` — persisted RNG sub-stream for the
//     WeatherSystem so its Markov sequence survives save/load (TDD §18.3).
//   - `world.environment.soil.soilWater: number` — soil water content (L)
//     for the water-balance model.
//   - `world.environment.soil.{ph, compaction, microbialActivity}: number`
//     — extension-point stubs for the soil health derivation (TDD §8.3).
// Migration v3 -> v4 backfills all new fields with neutral defaults so
// older saves load cleanly. The migration is pure and does not touch
// `originalTree.id` or `originalTree.isOriginal`.
//
// v5 (P3a): added four new fields to EconomyState for the ledger + transaction
// system (TDD §10.3, §10.4):
//   - `economy.accounts: AccountState[]` — explicit account ledger. The
//     central monetary authority is virtual (the "mint") — its net position
//     is implied by `totalIssued - totalSinks`. P3a seeds two accounts:
//     `player:personal` (carrying the existing `player.personalCash` balance)
//     and `external:default` (balance 0). P3b will add per-market external
//     accounts; P3c may add business accounts.
//   - `economy.processedRequestIds: string[]` — idempotency set for currency
//     issuance. Every fulfilled or rejected CurrencyIssuanceRequest has its
//     deterministic requestId recorded here so a re-processed request never
//     double-issues money, even across save/load.
//   - `economy.totalIssued: string` — cumulative currency ever issued by the
//     authority (bigint minor units as string). Monotonically non-decreasing.
//   - `economy.totalSinks: string` — cumulative currency removed from
//     circulation via explicit monetary operations (taxes, fees, central-bank
//     interventions). Monotonically non-decreasing.
//
// TransactionRecord also gains an optional `requestId: string` field for
// audit trail — older saves don't have it; the schema accepts its absence.
//
// Migration v4 -> v5 backfills `accounts` from the player's existing
// `personalCash` so the conservation invariant
// (`sum(accounts.balance) + totalSinks === initialSupply + totalIssued`)
// holds for legacy saves with `initialSupply = totalIssued = totalSinks = 0 +
// player.personalCash`. The migration is pure and does NOT touch
// `originalTree.id` or `originalTree.isOriginal`.
//
// v6 (P3b): added two new EconomyState shapes for the market pricing + inflation
// index (TDD §10.6, GDD §8.5, §6.3):
//   - `economy.inflationIndex: number` — Laspeyres-style basket index of
//     current market prices vs their base prices. `1.0` at game start;
//     rises when prices rise. P5's UI divides nominal currency amounts by
//     this index to display "real" purchasing power. Defaults to `1.0`.
//   - `economy.markets[*].lastPriceUpdate: number` — simulation second at
//     which a market's `price` was last recomputed by the EconomySystem.
//     Defaults to `0` (game start).
//
// Both fields have Zod defaults, so v5 saves parse cleanly under v6, but the
// v5 → v6 migration backfills them explicitly so consumers can rely on the
// fields being present (not the zod default fallback). The migration is pure
// and does NOT touch `originalTree.id` or `originalTree.isOriginal`.
//
// v7 (P3c): added one new PlayerState shape for the PersonalSystem (TDD §11,
// GDD §7):
//   - `player.unpaidDays: number` — cumulative counter of unpaid
//     living-expense days. Each time a bill comes due and the player cannot
//     pay, the counter advances by PROVISIONAL_PERSONAL_BILLING_INTERVAL_DAYS
//     (one full billing cycle of unpaid living costs). Physical health is
//     derived with a diminishing-returns penalty from this counter (GDD §7.2,
//     §7.3). The counter decays slowly when bills are paid on time (recovery).
//
// The field has a Zod `.default(0)`, so v6 saves parse cleanly under v7, but
// the v6 → v7 migration backfills it explicitly so consumers can rely on the
// field being present. The migration is pure and does NOT touch
// `originalTree.id` or `originalTree.isOriginal`.
//
// v8 (P6b1): extended `AutomationState` with three optional fields for the
// condition-based automation engine (TDD §12, GDD §9):
//   - `automation[*].policy: AutomationPolicy` — an optional discriminated-
//     union trigger (`threshold` | `event` | `schedule`) that selects *when*
//     an automation runs, beyond the P0 `schedule` (interval/at) cadence.
//     Absent on P0–P6a interval-only automations; present when the automation
//     reacts to thresholds or events.
//   - `automation[*].lastRunAt: number` — simulation seconds of the last
//     execution. The AutomationSystem (P6b2) uses it with `cooldownSeconds`
//     to skip runs that would fire too soon.
//   - `automation[*].cooldownSeconds: number` — minimum gap (sim seconds)
//     between two executions. Prevents a persistently-true threshold from
//     firing every tick.
//
// All three fields are optional (no Zod default) so P0–P6a interval-only
// automations parse cleanly under v8. The v7 → v8 migration backfills
// `lastRunAt: 0` and `cooldownSeconds: 0` on each existing automation entry
// explicitly (so consumers can rely on their presence without re-running the
// zod pipeline) and leaves `policy` absent when missing — a discriminated
// union has no natural default, and `policy: undefined` serializes to absent
// in JSON anyway. The migration is idempotent and does NOT touch
// `originalTree.id` or `originalTree.isOriginal` (GDD §16.1/16.2).
//
// v9 (P7a): extended `EnvironmentState` with the energy pool, land-use
// accumulators, the other major GHGs/aerosols, and the derived climate /
// sea-level fields for the EnvironmentSystem (TDD §13, §5.5, §9.2; GDD §10,
// §28, §59–67, §170; resolves R-P6-3 / R-P6-4 from
// docs/offline-automation.md §6.3 / §6.4):
//   - `atmosphere.methaneConcentration`, `atmosphere.nitrousOxideConcentration`,
//     `atmosphere.aerosols: number` — the other major GHGs + aerosols for a
//     richer climate model (GDD §170). Methane/N2O are potent GHGs; aerosols
//     are net-cooling (negative = cooling). Defaults 1.9 / 0.33 / 0.
//   - `climateForcing: number` — net radiative forcing in W/m^2, derived by
//     the EnvironmentSystem (P7b) from the GHG concentrations. Default 0.
//   - `seaLevelRise: number` — mm above baseline, long-term consequence of
//     warming (GDD §170). Default 0.
//   - `energy: { stored, capacity, generationRate, consumptionRate }` — the
//     energy pool P6 lacked (R-P6-3). The `solar-panel`/`battery` equipment
//     (P6b1) generates into / raises capacity for this pool; automation
//     `energyConsumption` debits `stored` (wired in P7c). Default
//     `{ stored: 0, capacity: PROVISIONAL_ENERGY_BATTERY_CAPACITY_DEFAULT,
//     generationRate: 0, consumptionRate: 0 }`.
//   - `landUse: { developed, degraded, protected }` — land-use accumulators
//     (R-P6-4) so `landDisturbance` has a target field. Defaults all 0.
//
// All v9 fields have Zod `.default(...)` so v8 saves parse cleanly under v9
// even without re-running the migration, and the v8 → v9 migration backfills
// them explicitly so consumers can rely on their presence (matching the
// v3 → v4 / v5 → v6 / v6 → v7 convention). The migration is idempotent and
// does NOT touch `originalTree.id` or `originalTree.isOriginal`
// (GDD §16.1/16.2).
//
// v10 (P8a): extended `BusinessState` with nine operational fields for the
// BusinessSystem (TDD §5.7 / §11, GDD §8.2 supply chains, §8.3 economic
// organizations, §8.4 growth pressure, §8.5 market simulation):
//   - `businesses[*].status: 'operating' | 'idle' | 'bankrupt' | 'liquidating'`
//     — operational state. Default `'operating'`.
//   - `businesses[*].lastOperatedAt: number` — sim seconds of last operate
//     step. Default `0`.
//   - `businesses[*].supplyChainLevel: number` — position in the supply chain
//     (GDD §8.2). 0=extraction ... 5=application. Default `0`.
//   - `businesses[*].upstreamSupplierIds: string[]` — business ids this one
//     buys inputs from (vertical integration). Default `[]`.
//   - `businesses[*].downstreamCustomerIds: string[]` — business ids this one
//     sells outputs to. Default `[]`.
//   - `businesses[*].environmentalImpact: EnvironmentalImpact` — per-business
//     impact (reuses the P6 `environmentalImpactSchema` — pillar 4).
//     Default all-zero.
//   - `businesses[*].wageRate: string` — bigint minor-units wage per employee
//     per pay period. Default `'0'`.
//   - `businesses[*].marketParticipation: string[]` — which commodity markets
//     this business buys/sells in (GDD §8.5). Default `[]`.
//   - `businesses[*].lastValuationTick: number` — sim seconds of last
//     valuation recompute (TDD §11 — valuation ≠ liquidity). Default `0`.
//
// Also widens the `OwnershipState.structure` enum with `'sustainable-enterprise'`
// (GDD §8.3 — the P0 enum was missing it). Zod enum widening is backward-
// compatible: existing saves with the old enum value parse cleanly because
// every old value is still a member of the widened enum.
//
// All v10 fields have Zod `.default(...)` so v9 saves parse cleanly under v10
// even without re-running the migration, and the v9 → v10 migration backfills
// them explicitly so consumers can rely on their presence without re-running
// the zod default pipeline (matching the v3 → v4 / v5 → v6 / v6 → v7 / v8 → v9
// convention). The migration is idempotent and is a defensive no-op when
// `state.businesses` is absent or empty (the P0 case — fresh games start with
// `businesses: []`). The migration does NOT touch `originalTree.id` or
// `originalTree.isOriginal` (GDD §16.1/16.2).
//
// v11 (P8c): extends `BusinessState` and `Liability` for the market simulation
// + growth pressure + per-business inventory work (TDD §11, GDD §8.4 Growth
// Pressure, §8.5 Market Simulation; resolves the P8b carry-forwards):
//   - `businesses[*].inventory: Array<{ resourceId, quantity }>` — per-business
//     resource stocks (GDD §8.2 supply chains). P8b used the shared
//     `state.inventory` pool as a workaround; P8c gives each business its own
//     inventory so production consumes from / credits to the business's stock.
//     Default `[]`.
//   - `businesses[*].liabilities[*].accruedInterest: string` — accrued-but-
//     unpaid interest, tracked SEPARATELY from `principal` (GDD §8.4 debt and
//     interest). P8b compounded interest into `principal`; P8c accrues into
//     this field and the `repay-loan` action pays it FIRST, then reduces
//     `principal`. Default `'0'`.
//
// Both v11 fields have Zod `.default(...)`, so v10 saves already parse cleanly
// under v11, but the migration backfills them explicitly so consumers can rely
// on the fields being present without re-running through zod's default
// pipeline (matching the v3 → v4 / v5 → v6 / v6 → v7 / v8 → v9 / v9 → v10
// convention). Each field is backfilled only if missing — fields already
// present on a v11 save (or a v10 save hand-patched with any of these values)
// are left untouched. This makes the migration idempotent under repeated
// application (defensive — the framework doesn't re-run migrations, but tests
// do). The migration is a defensive no-op when `state.businesses` is absent or
// empty (the P0 case — fresh games start with `businesses: []`). The migration
// does NOT touch `originalTree.id` or `originalTree.isOriginal`
// (GDD §16.1/16.2).
//
// v12 (P9a): REPLACES the P0 progression stub with the full ProgressionState
// shape required by GDD §11 (Progression and Generations) and §12 (Player
// Objectives) — TDD §5.1 (`progression: ProgressionState`), TDD line 199
// (ProgressionSystem: research, genetics, achievements). The P0 stub was
// `{ research: [{id, completedAt}], achievements: [{id, completedAt}],
// geneticLegacy: number }`; v12 is:
//   - `research: { nodes: ResearchNodeState[], totalSpent: string }` — per-save
//     research unlock records + cumulative genetic-legacy points spent.
//   - `genetics: { activeTraits: GeneticTraitState[], availableTraits: string[],
//     originalLineageId: string }` — expressed + reserve traits, unlocked-but-
//     unacquired trait ids, and the ORIGINAL TREE'S permanent genetic identity
//     (GDD §11.2 — original tree's lineage remains identifiable; defaults to
//     `'original'` matching `originalTree.id`).
//   - `achievements: { tracked: AchievementState[] }` — per-save achievement
//     tracking records (GDD §12 — objectives tracked independently).
//   - `prestige: { geneticLegacyPoints, totalGenerations, currentGeneration,
//     prestigeMultiplier, historicalRecords }` — the prestige currency +
//     generation counters (GDD §11.2 Genetic Legacy is a prestige currency;
//     §11.3 Prestige is generational progress, NOT a numerical multiplier).
//   - `generationHistory: GenerationHistoryEntry[]` — per-generation history
//     (GDD §11.3 — original tree permanently represented in history).
//
// This is a STRUCTURAL migration (not a simple field backfill): the v11
// `research` / `achievements` arrays and `geneticLegacy` number are replaced
// by the v12 nested-object shape. The migration restructures the entire
// `progression` field. Because the ProgressionSystem was a no-op stub through
// v11, no real v11 save has non-empty research / achievements / geneticLegacy
// (they were always `[]` / `[]` / `0` at init), so the restructure discards
// no player data — it upgrades the empty stub to the empty v12 defaults.
//
// All v12 fields have Zod `.default(...)`, so once the migration restructures
// the progression field, the v12 schema validates cleanly. The migration is
// idempotent: a v12-shaped progression (already restructured) is left
// untouched (the migration detects the v12 `research` object shape and
// skips). It is a defensive no-op when `state.progression` is absent or
// non-object (lets strict validation report the malformation downstream). The
// migration is pure and does NOT touch `originalTree.id` or
// `originalTree.isOriginal` (GDD §16.1/16.2).
//
// v13 (P10a): adds the top-level `eventState: EventState` field for the
// EventSystem (slot #12 — TDD line 200 "EventSystem: Simulation events and
// consequences"; GDD §10 Environment and Climate, §148-152 influence over
// regional/global markets/governments/regulations/environmental conditions,
// §404-408 monetary authority; TDD §6.4 Event Scheduling; TDD Milestone 9:
// Regional environments, Industrial systems, Governments, Monetary policy,
// Global markets, Climate feedback, Global objectives). `eventState` composes:
//   - `scheduler: EventSchedulerState` — the EventSystem scheduler (scheduled
//     / active / history / nextEventId). DISTINCT from the P0 `scheduler`
//     field (the simple priority queue used by the PersonalSystem for
//     `bill-due` events): the EventSystem scheduler additionally tracks
//     active (in-progress) events + a history of resolved/expired events,
//     keyed by event *type* ids from content (`packages/content/src/events/`).
//   - `global: GlobalState` — the regional breakdown + aggregated indicators
//     derived from regional conditions (GDD §10.2 — "A healthy global average
//     must not conceal a collapsing local ecosystem") + government policy +
//     monetary policy + global market indices. EXTENDS P7's `EnvironmentState`
//     (which already models atmosphericCarbon/globalTemperature/soil.health/
//     biodiversity/forestCoverage/ecosystemResilience as a single global
//     block) with a regional breakdown; does NOT duplicate P7's globals.
//
// P10a ships the schema + content + migration only; the EventSystem
// implementation lands in P10b (the stub in
// `packages/simulation/src/systems/stubs.ts` stays a no-op).
//
// All v13 fields have Zod `.default(...)`, so v12 saves already parse cleanly
// under v13, but the migration backfills `eventState` explicitly so consumers
// can rely on the field being present without re-running through zod's default
// pipeline (matching the v3 -> v4 / ... / v11 -> v12 convention). The
// migration is idempotent (a v13 save with `eventState` already present is
// left untouched) and is a defensive no-op when the state is malformed (lets
// strict validation report the malformation downstream). The migration seeds
// `eventState.global.aggregatedIndicators` from the save's existing P7
// `EnvironmentState` globals (atmosphericCarbon from
// `atmosphere.co2Concentration`, globalTemperature from
// `environment.globalTemperature`, avgSoilHealth from `soil.health`,
// avgBiodiversity from `biodiversity.index`, avgForestCoverage from
// `forestCoverage`, ecosystemResilience from `ecosystemResilience,
// speciesExtinctionRate 0) so a migrated save starts consistent. The
// migration is pure and does NOT touch `originalTree.id` or
// `originalTree.isOriginal` (GDD §16.1/16.2).
export const CURRENT_SCHEMA_VERSION = 13;

// Used by migration tests to exercise the v0 -> v1 path. Real saves are
// always written at CURRENT_SCHEMA_VERSION.
export const LEGACY_SCHEMA_VERSION_FOR_TESTS = 0;
