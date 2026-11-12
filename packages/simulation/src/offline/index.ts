/**
 * Offline catch-up module (P6a — TDD §14.4, GDD §4.2).
 *
 * Public surface:
 *   - `runOfflineCatchUp(state, nowMs)` — execute the catch-up (chunked
 *     `engine.advance`), returning the advanced state + `OfflineSummary` +
 *     the full event stream.
 *   - `planOfflineCatchUp(state, nowMs)` — pure, non-executing planner.
 *     Returns the planned chunks/sim seconds/cap flag without running any
 *     chunks. Used to test the cap safeguard without a 30-real-day execution,
 *     and (in P6d) to preview the catch-up size before running it.
 *
 * The `OfflineSummary` / event types the processor produces live in
 * `@capitalist-tree/shared` (they are wired into the `SimulationEvent` union
 * there).
 */
export {
  runOfflineCatchUp,
  planOfflineCatchUp,
  type OfflineCatchUpResult,
  type OfflineCatchUpPlan,
} from './catch-up.js';
