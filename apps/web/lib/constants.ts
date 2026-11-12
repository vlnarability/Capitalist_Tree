/**
 * UI provisional constants (P5a — TDD §16 State Management, GDD §13 UI).
 *
 * Every value here corresponds to (or stands in for) an unresolved UI /
 * presentation design decision listed in GDD §13 (User Interface and
 * Presentation), §14 (Monetization and Cosmetics), and §17 (Unresolved Design
 * Decisions). They live in `apps/web/lib/constants.ts` — NOT in
 * `packages/shared/src/constants/` — because they are pure UI concerns
 * (rule 6 + TDD §3 import boundary: the core packages must not import UI
 * code, so UI constants must live on the web-app side).
 *
 * CONVENTION: every constant in this file is `@provisional`. Use the
 * `PROVISIONAL_UI_*` prefix. When a value is promoted from "provisional" to
 * "decided" via playtesting, move it to a sibling `decided.ts` and remove
 * the `PROVISIONAL_` prefix. Leave a comment so the migration is traceable.
 *
 * P5a introduces these as the inputs to the Zustand store + simulation-loop
 * hook. P5b/P5c/P5d (panels, advanced view, notifications UI) consume them.
 * None of these constants MUST leak into the simulation engine — they are
 * presentation / UX tuning only (rule 6).
 */

// PROVISIONAL (GDD §17: dashboard refresh cadence).
//
// How often (in real-time milliseconds) the dashboard panel should re-read
// its derived metrics from the store. The simulation loop publishes a fresh
// `simState` snapshot every step (multiple times per second at high speed);
// the dashboard can refresh less often to avoid re-computing expensive
// derived values (purchasing power, net worth, etc.). The hook itself does
// NOT throttle commits — it relies on Zustand selectors for fine-grained
// subscriptions. This constant is for consumers that want a coarse refresh.
export const PROVISIONAL_UI_DASHBOARD_REFRESH_INTERVAL_MS = 250;

// PROVISIONAL (GDD §13.5: Notifications).
//
// Maximum number of UI notifications retained in the store's
// `ui.notifications` ring buffer. Older entries are dropped FIFO. Kept small
// so the notifications panel doesn't grow unbounded; the underlying
// SimulationEvent log (separate) retains the full event history for the
// dev console.
export const PROVISIONAL_UI_MAX_NOTIFICATIONS = 20;

// PROVISIONAL (GDD §13: default speed).
//
// The default speed multiplier applied when a new game boots. Matches
// `PROVISIONAL_SPEED_1X` from `@capitalist-tree/shared`. Re-declared here
// (rather than re-exported) so the UI layer owns its own default — future
// playtesting might prefer a different starting speed (e.g. 5x) independent
// of the engine's provisional speed list.
export const PROVISIONAL_UI_DEFAULT_SPEED = 1;

// PROVISIONAL (GDD §13.5: Notifications — event log bound).
//
// Maximum number of SimulationEvents retained in the store's `events` ring
// buffer (the recent-event log the UI displays). Mirrors the P0
// `use-engine-game.ts` `MAX_LOG = 50`. Kept at 50 so the dev event log on
// the main page remains readable.
export const PROVISIONAL_UI_MAX_EVENT_LOG = 50;

// PROVISIONAL (GDD §13.1: Main Game Screen — tab ordering).
//
// The default tab selected when the game first boots. P5b's panel layout
// will define the full tab list; P5a only needs the default for the UI
// state seed.
export const PROVISIONAL_UI_DEFAULT_TAB = 'overview';

// PROVISIONAL (GDD §14 + §6.1: cosmetics — default currency visual).
//
// The default currency cosmetic id selected when the game boots. Matches
// `PROVISIONAL_DEFAULT_CURRENCY_ID` from `@capitalist-tree/shared`. The id
// is used by the rendering package to resolve a `CurrencyVisual` via
// `findCurrencyVisual(id)`. Selecting a cosmetic MUST NOT modify the
// underlying monetary value (TDD §15.4 — currency cosmetics are pure
// visual data).
export const PROVISIONAL_UI_DEFAULT_CURRENCY_VISUAL_ID = 'currency:leaf-dollar';

// PROVISIONAL (GDD §17: loop frame dt cap).
//
// Upper bound on the wall-clock delta (ms) applied to a single rAF tick in
// the simulation loop. A long tab-suspend (e.g. laptop sleep) would
// otherwise advance the simulation by an arbitrary amount; capping at 250ms
// keeps the per-frame advance bounded. Mirrors the P4d TreeView's
// `MAX_FRAME_DT_MS = 250` — both loops use the same convention.
export const PROVISIONAL_UI_LOOP_FRAME_DT_MAX_MS = 250;

// PROVISIONAL (GDD §17: simulation-step commit cadence).
//
// Minimum real-time interval (ms) between `simState` snapshots published
// by the simulation loop. Set to `0` for P5a — the loop commits every step
// (relying on Zustand selectors to prevent excessive re-renders). P5b+ may
// tune this to e.g. 100ms if profiling shows selector-level updates are
// still too frequent at 60x speed.
export const PROVISIONAL_UI_COMMIT_THROTTLE_MS = 0;

// PROVISIONAL (GDD §4.2 + §17: Offline Progression safeguards).
//
// Real-world elapsed-ms threshold below which the offline catch-up
// processor is NOT run on save load (P6d2 — TDD §14.4). A save loaded
// within this window of its `metadata.lastSimulatedAt` is treated as
// "fresh": the live rAF loop simply resumes, no "while you were away"
// modal is shown. Above the threshold, `useSimulationLoop` invokes
// `runOfflineCatchUp(state, nowMs)` (P6a); if the resulting summary has
// `chunksRun > 0`, the summary is parked on the UI slice and the
// OfflineModal renders.
//
// 60 real seconds was chosen so:
//   - Brief tab-switches / window-blurs (a few seconds) don't trigger a
//     modal — the player just keeps playing.
//   - A real-world minute is the smallest gap a returning player would
//     notice as "I was away"; below that, the catch-up would produce 0
//     chunks anyway (60 real s × 60 sim s/real s = 3_600 sim s < the
//     86_400-sim-s chunk size), so the threshold also saves a wasted
//     `planOfflineCatchUp` call.
//   - A longer absence (a real hour → 2 chunks, a real day → 60 chunks)
//     crosses the threshold and the modal surfaces the deltas.
//
// When this is promoted from "provisional" to "decided" via playtesting,
// move it to a sibling `decided.ts` and drop the `PROVISIONAL_` prefix.
export const PROVISIONAL_OFFLINE_PROMPT_THRESHOLD_MS = 60_000;
