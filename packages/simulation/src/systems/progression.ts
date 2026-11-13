/**
 * ProgressionSystem (TDD §4.2, §5.7 Progression State, line 199; GDD §11
 * Progression and Generations, §12 Player Objectives).
 *
 * Replaces the P0 stub at registry slot #11. Runs once per simulation step
 * AFTER every gameplay system (TimeSystem #1 → EnvironmentSystem #10) and
 * BEFORE the EventSystem (#12, currently a no-op stub). Slot #11 was reserved
 * for "research/achievements; depends on everything" (registry.ts) — the
 * achievement evaluation reads across many systems (cash, biodiversity,
 * forestCoverage, generation count, business ownership), so it runs last
 * among the gameplay systems to see the fully-updated state for the step.
 *
 * Each step:
 *   1. Seed `progression.achievements.tracked` if empty (idempotent — one
 *      AchievementState record per known AchievementDefinition).
 *   2. Throttled achievement check — only every
 *      `PROVISIONAL_ACHIEVEMENT_CHECK_INTERVAL_TICKS` ticks (the evaluation
 *      reads across many systems, so running it every tick is wasteful —
 *      GDD §17). The throttle is `tickIndex % interval === 0` where
 *      `tickIndex = floor(now / stepSeconds)`. On the first tick (when
 *      `tracked` is empty) the check runs regardless so a player who already
 *      meets a criterion gets the achievement promptly.
 *   3. For each tracked achievement not yet unlocked, recompute its `progress`
 *      (0–1) against the current game state; when `progress` reaches 1, flip
 *      `unlocked: true` + stamp `unlockedAt`, emit `achievement-unlocked`.
 *      Delegates to the pure `checkAchievements` helper.
 *
 * RNG fork DEFERRED — R-P9-1 (matching the R-P7-1 / R-P8-1 precedent for the
 * EnvironmentSystem + BusinessSystem no-fork decisions). The
 * ProgressionSystem's transforms are fully deterministic (research /
 * achievement / prestige arithmetic is pure — no stochastic failure modes
 * yet), so it does NOT call `ctx.rng.fork('ProgressionSystem')`.
 *
 * WHY DEFERRED (the cross-tick accumulation effect — the subtle case the
 * slot-#11 / no-op-EventSystem reasoning misses): `Rng.fork()` advances the
 * shared root RNG by exactly one draw BY DESIGN. The persisted
 * `GameState.rngState` is the root state AFTER all per-step forks
 * (`simulation.ts` runOneStep persists `rng.getState()` after the system
 * loop). So at step N+1, every system that forks (BiologySystem #3,
 * AutomationSystem #9) rebuilds its child seed from a root state that
 * includes step N's fork count. Adding a ProgressionSystem fork at #11 adds
 * one draw per step to that accumulated root state, which shifts the child
 * seeds BiologySystem + AutomationSystem derive at every subsequent tick —
 * breaking the calibrated mortality / catch-up death sequences pinned by the
 * P7d / P8b determinism tests (the crippled-tree "starved tree still dies"
 * test at environment.test.ts:984 is calibrated to the current 2-fork-per-step
 * root sequence and flips dies → survives if a third per-step fork lands).
 *
 * The slot-#11 / no-op-EventSystem reasoning holds only WITHIN a single tick
 * (ProgressionSystem's fork cannot shift a downstream forking system in the
 * SAME tick, because EventSystem #12 is a no-op). But ACROSS ticks the
 * accumulated root state shifts every downstream forker's child seed — that
 * is the perturbation R-P9-1 avoids.
 *
 * The fork lands when (a) P9c's stochastic mechanics (trait-inheritance
 * rolls, prestige-reset variance) arrive AND (b) the downstream RNG sequences
 * (BiologySystem mortality, AutomationSystem catch-up) are retuned for the
 * shifted sequence, OR `fork()` is refactored to a non-advancing sub-stream
 * derivation. A determinism test in `progression.test.ts` pins the no-fork
 * behaviour: the root RNG state is unchanged across a ProgressionSystem.execute
 * when the achievement check is throttled off, and the BiologySystem /
 * AutomationSystem RNG sequences are unaffected.
 *
 * The system is pure: it deep-copies the input state, mutates the copy, and
 * returns the new state. The input is NEVER mutated (TDD §4.1, §18.4).
 *
 * Rendering reads only — the rendering layer MUST NOT evaluate achievements
 * independently. This system is the single engine-side driver of achievement
 * unlocking; the UI dispatches progression actions (unlock-research,
 * activate-trait, prestige-reset, …) but never runs achievement evaluation.
 */
import type { GameState, SimulationEvent } from '@capitalist-tree/shared';
import { PROVISIONAL_ACHIEVEMENT_CHECK_INTERVAL_TICKS } from '@capitalist-tree/shared';
import type { System, SystemContext, SystemResult } from './system.js';
import { deepCopy } from '../deep-copy.js';
import { checkAchievements } from '../progression/achievements.js';

/**
 * The throttle gate — true when the current tick index is a multiple of
 * PROVISIONAL_ACHIEVEMENT_CHECK_INTERVAL_TICKS. Mirrors
 * `shouldCheckAchievements` in the achievements helper but reads the
 * SystemContext directly. Deterministic given `ctx`.
 */
function shouldCheckAchievementsTick(ctx: SystemContext): boolean {
  if (ctx.stepSeconds <= 0) return false;
  const tickIndex = Math.floor(ctx.now / ctx.stepSeconds);
  return tickIndex % PROVISIONAL_ACHIEVEMENT_CHECK_INTERVAL_TICKS === 0;
}

export const progressionSystem: System = {
  id: 'ProgressionSystem',
  execute(state: GameState, ctx: SystemContext): SystemResult {
    // Deep-copy on entry — never mutate the input (TDD §4.1, §18.4).
    let next: GameState = deepCopy(state);
    const events: SimulationEvent[] = [];

    // @provisional RNG fork DEFERRED — see R-P9-1 in the file-level doc. The
    // ProgressionSystem does NOT call `ctx.rng.fork('ProgressionSystem')`.
    // `Rng.fork()` advances the shared root RNG by one draw BY DESIGN, and the
    // persisted `rngState` accumulates every per-step fork — so a fork here
    // would shift the BiologySystem (#3) + AutomationSystem (#9) child seeds
    // at every subsequent tick (they fork BEFORE ProgressionSystem in the
    // registry, but their child seeds depend on the root state, which is the
    // accumulated fork count from prior ticks). That breaks the calibrated
    // mortality / catch-up death sequences pinned by the P7d / P8b determinism
    // tests. The fork lands in P9c alongside its stochastic mechanics (trait-
    // inheritance rolls, prestige-reset variance) once the downstream
    // sequences are retuned. P9b's transforms are fully deterministic —
    // research / achievement / prestige arithmetic is pure — so no fork is
    // needed for correctness. A determinism test pins the zero-root-draw
    // behaviour.

    // Throttled achievement check. On the first tick (tracked empty) the
    // check runs regardless so achievements seed + evaluate promptly; on
    // later ticks it runs every PROVISIONAL_ACHIEVEMENT_CHECK_INTERVAL_TICKS.
    const trackedEmpty =
      next.progression.achievements.tracked.length === 0;
    const shouldCheck = trackedEmpty || shouldCheckAchievementsTick(ctx);
    if (!shouldCheck) {
      return { state: next, events };
    }

    // ctx.now is the new clock time for this step (the TimeSystem already
    // advanced it). Achievements stamp `unlockedAt` against this tick.
    const result = checkAchievements(next, ctx.now);
    next = result.state;
    events.push(...result.events);

    return { state: next, events };
  },
};
