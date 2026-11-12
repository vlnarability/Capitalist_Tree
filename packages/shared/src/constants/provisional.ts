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
// At 1x speed:
//   1 real second  = 1 simulation minute (= 60 sim seconds)
//   1 real minute  = 1 simulation hour
//   1 real hour    = 1 simulation day (24 sim hours)
//   1 real day     = 1 simulation month (30 sim days)
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
export const CURRENT_SCHEMA_VERSION = 8;

// Used by migration tests to exercise the v0 -> v1 path. Real saves are
// always written at CURRENT_SCHEMA_VERSION.
export const LEGACY_SCHEMA_VERSION_FOR_TESTS = 0;
