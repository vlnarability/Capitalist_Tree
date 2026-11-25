/**
 * Decided constants — values promoted from `./provisional.ts` after validation.
 *
 * Per the convention in `./provisional.ts`: when a provisional value is
 * confirmed via playtesting/validation, it moves here, drops the `PROVISIONAL_`
 * prefix, + is no longer considered subject to the tuning loop. Each entry
 * below carries the validation that promoted it.
 *
 * Promotion criteria (W73, 2026-11-25): only STRUCTURAL / FOUNDATIONAL
 * constants are promoted here — timing, the fixed-timestep, the speed-control
 * surface, + the calendar. These are load-bearing across the engine
 * architecture + are exercised by the DR-1 design-promise bot
 * (`packages/simulation/test/dr1-long-run.test.ts`, 5yr) + the 25yr/100yr
 * long-horizon runners (`_w77-long-horizon.test.ts` /
 * `_w57-long-horizon-100yr.test.ts`) without surfacing any need to retune.
 *
 * Balance/economy tuning values (starting cash, inflation/interest rates,
 * default species/currency) REMAIN in `provisional.ts` — they are GDD §17
 * items whose final values depend on the long-horizon balance validation the
 * 100yr runner provides, + W58 will wire the inflation/issuance cadence.
 * Premature promotion would freeze unvalidated balance.
 *
 * Backward compat: `provisional.ts` re-exports each promoted constant under its
 * old `PROVISIONAL_` name so existing imports keep working; new code should
 * import the unprefixed names from here (or `@capitalist-tree/shared`).
 */

// DECIDED (promoted from PROVISIONAL_REAL_TO_SIM_SECONDS — GDD §17: exact
// real-time-to-simulation-time relationship).
//
// At 1x speed (factor 60 — 1 real second = 60 simulation seconds):
//   1 real second  = 1 simulation minute (= 60 sim seconds)
//   1 real minute  = 1 simulation hour (3_600 sim sec)
//   1 real hour    = 2.5 simulation days (216_000 sim sec)
//   1 real day     = 2 simulation months (60 sim days = 5_184_000 sim sec)
//
// Note: an earlier draft of the provisional comment read "1 real hour = 1
// simulation day" and "1 real day = 1 simulation month", which corresponds to
// factor 24, not factor 60. The VALUE below (60) was always correct; only the
// comment math was wrong. See packages/shared/src/constants/offline.ts for the
// chunk-count consequences (30 real days = 1_800 chunks at factor 60).
//
// This is the relationship between wall-clock time and in-game time when the
// speed multiplier is 1. The TimeSystem does NOT use this directly; the
// consumer (apps/web) converts wall-clock elapsed real seconds to elapsed
// simulation seconds via `simSeconds = realSeconds * REAL_TO_SIM_SECONDS * speed`.
//
// Promoted 2026-11-25 (W73): the entire time architecture (offline chunking,
// the rAF accumulator in `use-engine-game.ts`, the DR-1 bot, the 25yr/100yr
// runners) is built on factor 60 + no validation surfaced a need to retune.
// The GDD §17 item is de facto resolved.
export const REAL_TO_SIM_SECONDS = 60;

// DECIDED (promoted from PROVISIONAL_SIMULATION_STEP_SECONDS — TDD §6.2: fixed
// timestep "one simulation update per in-game minute").
//
// One simulation step = 60 simulation seconds = 1 in-game minute.
//
// Promoted 2026-11-25 (W73): the fixed-timestep granularity is load-bearing
// across the engine (the `advance` splittability contract, the rAF
// accumulator, the perf-gate) + has been benchmarked via the DR-1 bot + the
// long-horizon runners. TDD §6.2's "benchmark it" caveat is discharged.
export const SIMULATION_STEP_SECONDS = 60;

// DECIDED (promoted from PROVISIONAL_SPEED_* — GDD §4.1: simulation speeds).
//
// The speed multipliers exposed by the speed control.
//
// Promoted 2026-11-25 (W73): the speed-control options (0/1/5/15/60x) are a
// settled UI/UX surface, not balance tuning — the player-facing speed ladder
// is fixed for launch.
export const SPEED_PAUSED = 0;
export const SPEED_1X = 1;
export const SPEED_5X = 5;
export const SPEED_15X = 15;
export const SPEED_60X = 60;

// Canonical ordered list of speed multipliers exposed by the UI.
export const SPEED_MULTIPLIERS: readonly number[] = [
  SPEED_PAUSED,
  SPEED_1X,
  SPEED_5X,
  SPEED_15X,
  SPEED_60X,
] as const;

// DECIDED (promoted from PROVISIONAL_DAYS_PER_SEASON / _DAYS_PER_YEAR —
// GDD §4.4: seasons).
//
// Number of in-game days per season. 30 days/season × 4 seasons = 120 days/year.
//
// Promoted 2026-11-25 (W73): the 120-day calendar is load-bearing — the 25yr
// (3000d) + 100yr (12000d) long-horizon runners, every season/age computation,
// + the DR-1 bot all depend on it. It is structural (calendar length), not a
// balance rate; the balance rates that depend on it stay provisional.
export const DAYS_PER_SEASON = 30;
export const DAYS_PER_YEAR = DAYS_PER_SEASON * 4; // 120
