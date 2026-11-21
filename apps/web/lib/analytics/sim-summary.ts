/**
 * GAP-31 Phase 2 (DR-13) — Periodic sim-state aggregation.
 *
 * Design §3: "Aggregate recurring simulation metrics periodically (e.g. a
 * tree-growth summary every N ticks or every sim-day — height/diameter/health
 * snapshot — rather than every incremental change)." Recording every tick would
 * drown the signal + grow storage unbounded; a once-per-sim-day snapshot gives
 * the development + balancing signal needed for playtesting (design §1).
 *
 * Pure: takes a GameState, returns a plain-object snapshot. The caller
 * (`recordSimSummaryIfDue` in `analytics.ts`) gates the cadence + emits.
 */
import type { GameState } from '@capitalist-tree/shared';

/** Cadence: one sim-summary per sim-day (86_400 sim-seconds). The game clock
 *  runs 1:1 with real time (PROVISIONAL_REAL_TO_SIM_SECONDS = 60), so this is
 *  once per real day at 1× speed — a comfortable snapshot rate for a long-running
 *  game. Tunable in a future observability panel (design §3). */
export const SIM_SUMMARY_CADENCE_SECONDS = 24 * 60 * 60; // 86400

/**
 * Extract a compact sim-state snapshot for analytics. Captures the high-value
 * balancing signal: tree growth (height/diameter), vitality (health/reserves/
 * alive/age), the two long-horizon environmental indicators, + the cumulative
 * currency issued (a single bigint-as-string reflecting the economy's growth).
 *
 * Kept deliberately small — the observability panel (Phase 3) reads the LIVE
 * simState for full detail; this snapshot is for trend analysis across a long
 * game + for export diagnostics.
 */
export function extractSimSummary(state: GameState): Record<string, unknown> {
  const tree = state.originalTree;
  const env = state.world.environment;
  return {
    elapsedSeconds: state.clock.elapsedSeconds,
    tree: {
      alive: tree.alive,
      ageDays: tree.ageDays,
      height: tree.structure.height,
      trunkDiameter: tree.structure.trunkDiameter,
      health: tree.health,
      energyReserves: tree.energy.reserves,
    },
    environment: {
      airQuality: env.airQuality,
      oceanHealth: env.oceanHealth,
    },
    economy: {
      totalIssued: state.economy.totalIssued,
    },
  };
}

/**
 * Decide whether a sim-summary is due. Returns true when at least
 * `cadenceSeconds` of sim time has elapsed since `lastSummarySeconds`. A
 * backward clock (newGame / load) resets the cadence without emitting.
 */
export function isSimSummaryDue(
  elapsedSeconds: number,
  lastSummarySeconds: number | null,
  cadenceSeconds: number = SIM_SUMMARY_CADENCE_SECONDS,
): boolean {
  if (lastSummarySeconds === null) return false; // first commit seeds, doesn't emit
  if (elapsedSeconds < lastSummarySeconds) return false; // clock reset — re-seed
  return elapsedSeconds - lastSummarySeconds >= cadenceSeconds;
}
