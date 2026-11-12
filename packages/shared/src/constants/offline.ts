/**
 * Offline catch-up provisional constants (P6a — TDD §14.4, GDD §4.2).
 *
 * The offline catch-up processor (`packages/simulation/src/offline/catch-up.ts`)
 * runs when a save is loaded and `metadata.lastSimulatedAt` is older than
 * "now". It does NOT multiply production rates by elapsed time (GDD §4.2 —
 * "Offline progression must not simply multiply production rates by elapsed
 * time"). Instead, it breaks the elapsed real-world interval into 1-sim-day
 * chunks and runs `engine.advance` per chunk — biological, environmental, and
 * economic events all fire through the normal simulation pipeline.
 *
 * CONVENTION: `PROVISIONAL_OFFLINE_*` prefix + a `// PROVISIONAL (GDD §17:
 * <item>)` comment pointing at the GDD entry the value resolves. When a value
 * is promoted from "provisional" to "decided" via playtesting, move it to a
 * sibling `decided.ts` and drop the prefix.
 */

// PROVISIONAL (GDD §4.2 / TDD §14.4: Offline Progression safeguards)
//
// Maximum real-world elapsed time the catch-up processor will simulate. TDD
// §14.4 step 4: "Determine the maximum allowed catch-up interval (safeguard)."
//
// 30 real days. A player returning after a longer break sees their away-time
// capped at this many real-world milliseconds; the rest is dropped and the
// summary records `capped: true` so the UI can warn them their absence was
// only partially honoured.
//
// Conversion math (at PROVISIONAL_REAL_TO_SIM_SECONDS = 60 — 1 real sec =
// 60 sim sec; factor 60, NOT 24):
//   1 real second  = 60 sim seconds   (1 sim minute)
//   1 real minute  = 3_600 sim sec    (1 sim hour)
//   1 real hour    = 216_000 sim sec  (2.5 sim days ≈ 2 chunks)
//   1 real day     = 5_184_000 sim sec (60 sim days = 2 sim months)
//   30 real days   = 155_520_000 sim sec = 1_800 sim days = 1_800 chunks
//                  ≈ 15 sim years (at 120 sim days/year)
//
// 1_800 chunks × 1_440 steps/sim-day = ~2.59M fixed-step (60s) updates
// worst-case — bounded so the browser/UI thread doesn't lock up. The chunk
// count (1_800 chunks of 1 sim day each) keeps per-chunk event accumulation
// from blowing up memory (1 sim day produces O(100) events at the current
// system density). The previous draft of this comment used factor 24
// (1 real hour = 1 sim day, 720 chunks) which is inconsistent with the
// actual factor 60 above; the VALUES were always correct, only the comment
// math was wrong.
export const PROVISIONAL_OFFLINE_MAX_REAL_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

// PROVISIONAL (GDD §4.2: Offline Progression must not multiply production rates)
//
// Chunk size (in simulation seconds) used by the catch-up processor. Each
// chunk is a single `engine.advance(state, chunkSimSeconds)` call. The
// engine internally breaks this into `floor(chunkSimSeconds / STEP)` fixed
// 60-sim-second steps (1_440 steps per chunk at this size).
//
// 1 sim day was chosen so:
//   - Each chunk represents a meaningful biological unit (a full day/night
//     cycle, season-aware photosynthesis, daily water/nutrient uptake).
//   - The worst-case 30-real-day catch-up runs ~1_800 chunks (not millions of
//     steps) — keeping wall-clock time bounded for the consumer. (At factor
//     60: 30 real days × 86_400 real sec/day × 60 sim sec/real sec =
//     155_520_000 sim sec ÷ 86_400 sim sec/chunk = 1_800 chunks.)
//   - Per-chunk event accumulation stays small enough to hold in memory
//     without streaming (the consumer can drop `tick` events if it wants
//     a smaller payload).
//
// The chunk size MUST be a positive integer multiple of
// `PROVISIONAL_SIMULATION_STEP_SECONDS` (60) so `engine.advance` consumes
// the whole chunk with no remainder. 86_400 = 60 × 1_440 — verified.
export const PROVISIONAL_OFFLINE_CHUNK_SIM_SECONDS = 24 * 60 * 60; // 86_400

// PROVISIONAL (GDD §17: safeguards against unreasonable system clock changes)
//
// Tolerance (in ms) for detecting backwards clock changes. If
// `nowMs - state.metadata.lastSimulatedAt` is negative but within this
// tolerance, the processor treats the elapsed time as zero and produces an
// empty summary (no chunks run, no events). A larger backwards jump (a
// manual clock change, a system restore from backup, an NTP step backwards)
// triggers `OfflineClockTamperedError` so the UI can warn the player
// rather than silently producing nonsense.
//
// 1_000 ms is enough to absorb `Date.now()` rounding and small NTP
// adjustments without false positives; tight enough to catch a real
// tamper attempt (e.g. setting the clock back by a minute to farm leaves).
export const PROVISIONAL_OFFLINE_BACKWARDS_CLOCK_TOLERANCE_MS = 1000;

// PROVISIONAL (GDD §17: Offline Progression must not multiply production rates)
//
// Tolerance for the divergence assertion `chunked ≈ fine-step`. The engine
// is pure and deterministic — `chunked advance` (N × `engine.advance(chunk)`)
// produces results bit-identical to a single `engine.advance(N × chunk)` run
// (splittability invariant, TDD §18.3, tested in
// `packages/simulation/test/engine.test.ts`). So the *expected* divergence
// is 0.
//
// The tolerance is a safety margin for any future floating-point drift
// (e.g. if a system introduces a per-step `Math.random()` call accidentally,
// or a different IEEE-754 rounding on a different platform). Kept non-zero
// so the catch-up divergence test doesn't become brittle on platforms with
// different float behaviour, but tight enough to catch a real divergence
// bug (1e-9 relative — well below any meaningful gameplay value).
export const PROVISIONAL_OFFLINE_DIVERGENCE_TOLERANCE = 1e-9;
