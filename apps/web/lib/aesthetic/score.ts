import type { GameState } from '@capitalist-tree/shared';

/**
 * W51 — the sustainability score (0–10, integer) that drives the dynamic
 * aesthetic. It is a STEWARDSHIP-BALANCE metric, not a raw ecology-quality
 * metric: a pristine untouched sapling = 5 (balanced midpoint — the player
 * has done nothing yet), growing the canopy toward full raises it to 10
 * (stewardship), over-harvesting + ecological degradation lower it to 0
 * (exploitation).
 *
 * The sim starts PRISTINE (health 1, ecosystemResilience 0.8, biodiversity
 * 0.8, soil 1, airQuality 1, 50 leaves, zero extraction) — a naive
 * ecology-quality average would start at ~0.9 (score ~9), NOT 5. So each
 * term is anchored to the pristine baseline (current / pristine_start) so
 * that the untouched start produces EXACTLY 5, + only DEVIATIONS from the
 * baseline move the score. No baseline snapshot is needed — the start
 * values are constants (initial-state.ts).
 *
 * Composition (clamped to [0,10], rounded to an integer):
 *   score = 5
 *         + canopyGrowthBonus      // +0..5: leaves grown beyond the sapling start
 *         - canopyLossPenalty       // -0..2.5: leaves harvested below the start
 *         - ecoDamagePenalty        // -0..2.5: health / soil / air / biodiversity loss
 *
 * Integer rounding means the aesthetic shifts in 11 discrete steps (0..10)
 * and the hook only re-writes CSS vars when the integer score actually
 * changes (not on every tick). The palette module interpolates linearly on
 * the integer score.
 */

/** The sapling's starting leaf count (initial-state.ts:222 — `currentLeaves: 50`). */
const SAPLING_START_LEAVES = 50;

/** Ecology "healthy" threshold: resilience / biodiversity / soil.health above
 *  this incur NO penalty. The sim's seeded pristine values (0.8 / 0.8 / 1.0)
 *  settle to a lower equilibrium (~0.55 / 0.68 / 0.64) after the first tick —
 *  ALL still above 0.5, so the settled start produces score 5 (no penalty).
 *  Only severe degradation below 0.5 penalizes. This makes the anchor robust to
 *  the sim's start-time drift without hardcoding the emergent equilibrium. */
const ECO_THRESHOLD = 0.5;

/**
 * Compute the sustainability score (0–10, integer) for a game state. Pure —
 * no side effects, deterministic. Returns 5 for the pristine initial state.
 */
export function computeSustainabilityScore(state: GameState): number {
  const tree = state.originalTree;
  const env = state.world.environment;
  const leaves = tree.foliage.currentLeaves;
  // Guard against species whose capacity is near the sapling start.
  const capacity = Math.max(tree.foliage.leafCapacity, SAPLING_START_LEAVES + 1);

  // --- stewardship: canopy grown beyond the sapling start → up to +5 ---
  const growthRange = capacity - SAPLING_START_LEAVES;
  const canopyGrowth = clamp((leaves - SAPLING_START_LEAVES) / growthRange, 0, 1);
  const canopyGrowthBonus = canopyGrowth * 5;

  // --- exploitation: canopy harvested below the sapling start → up to -2.5 ---
  const canopyLoss = clamp((SAPLING_START_LEAVES - leaves) / SAPLING_START_LEAVES, 0, 1);
  const canopyLossPenalty = canopyLoss * 2.5;

  // --- exploitation: ecological degradation → up to -2.5.
  // resilience / biodiversity / soil.health incur NO penalty while above
  // ECO_THRESHOLD (0.5) — the settled pristine start (~0.55 / 0.68 / 0.64) sits
  // above it, so the start = 0 penalty → score 5. Only severe degradation below
  // 0.5 penalizes. airQuality (1 = clean), contamination, + degraded land are
  // direct exploitation-footprint signals (zero at the pristine start). The
  // over-harvest signal is captured by the canopy terms above; `tree.health` is
  // excluded (it's DERIVED each tick from foliage/stress/reserves, so it drifts
  // at start + double-counts the canopy). Sum clamped to [0,1] then ×2.5.
  const ecoDamageRaw =
    clamp((ECO_THRESHOLD - env.ecosystemResilience) / ECO_THRESHOLD, 0, 1) * 0.5 +
    clamp((ECO_THRESHOLD - env.biodiversity.index) / ECO_THRESHOLD, 0, 1) * 0.5 +
    clamp((ECO_THRESHOLD - env.soil.health) / ECO_THRESHOLD, 0, 1) * 0.5 +
    (1 - env.airQuality) * 0.5 +
    clamp(env.soil.contamination, 0, 1) * 0.5 +
    clamp(env.landUse.degraded, 0, 1) * 0.5;
  const ecoDamagePenalty = clamp(ecoDamageRaw, 0, 1) * 2.5;

  const score = 5 + canopyGrowthBonus - canopyLossPenalty - ecoDamagePenalty;
  return clamp(Math.round(score), 0, 10);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
