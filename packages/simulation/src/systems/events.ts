/**
 * EventSystem (TDD §4.2, §6.4 Event Scheduling, line 200 "EventSystem —
 * Simulation events and consequences"; GDD §10 Environment and Climate,
 * §148-152 influence over regional/global markets/governments/regulations,
 * §404-408 monetary authority; TDD Milestone 9: Regional environments,
 * Governments, Monetary policy, Global markets, Climate feedback, Global
 * objectives).
 *
 * Replaces the P0 stub at registry slot #12 — the LAST system. Runs once per
 * simulation step AFTER every gameplay system (TimeSystem #1 →
 * ProgressionSystem #11) so it sees the fully-updated state for the step
 * (registry.ts: "EventSystem — scheduled events; runs last so it sees the
 * full tick"). Slot #12 was reserved for "scheduled events; runs last"
 * (registry.ts).
 *
 * Each step:
 *   1. Seed `eventState.global.regions` with the @provisional default biomes
 *      if empty (first tick — the v13 migration leaves `regions` empty;
 *      `initial-state.ts` documents this).
 *   2. `processScheduledEvents` (self-throttled by
 *      `PROVISIONAL_EVENT_CHECK_INTERVAL_TICKS`) — fire due scheduled events
 *      into `active`, apply their effects, decrement active events'
 *      `remaining`, retire concluded events to `history`. Emits
 *      `event-triggered` / `event-expired`.
 *   3. `evolveRegions` (every tick) — drift each region's indicators
 *      (pollution accumulates from industrialActivity + decays; soil / water
 *      / forest / biodiversity recover at `PROVISIONAL_EVENT_RECOVERY_RATE`
 *      minus pollution stress; biodiversity below
 *      `PROVISIONAL_SPECIES_EXTINCTION_THRESHOLD` collapses irreversibly +
 *      ratchets `speciesExtinctionRate`). Emits `regional-condition-shifted`
 *      for threshold crossings.
 *   4. `aggregateGlobalIndicators` (every tick) — recompute the global
 *      averages from regional conditions (population-weighted) + track min
 *      regional values (GDD §10.2 — a healthy global average must not
 *      conceal a collapsing local ecosystem).
 *   5. `updateGovernmentPolicy` (self-throttled by
 *      `PROVISIONAL_GOVERNMENT_POLICY_INTERVAL_DAYS`) — government tightens
 *      environmental regulations + carbon tax based on degradation. Emits
 *      `government-policy-changed`.
 *   6. `updateMonetaryPolicy` (self-throttled by
 *      `PROVISIONAL_MONETARY_POLICY_INTERVAL_DAYS`) — central bank adjusts
 *      interest rate / inflation target / money-supply growth based on the
 *      commodity-basket market index. Emits `monetary-policy-changed`.
 *
 * RNG fork DEFERRED — R-P10-N (matching the R-P7-1 / R-P8-1 / R-P9-1
 * precedent for the EnvironmentSystem + BusinessSystem + ProgressionSystem
 * no-fork decisions). The EventSystem's transforms are fully deterministic
 * (event scheduling + regional drift + aggregation + policy reactions are
 * pure arithmetic — no stochastic failure modes in P10b), so it does NOT
 * call `ctx.rng.fork('EventSystem')`.
 *
 * WHY DEFERRED (the cross-tick accumulation effect — the subtle case the
 * "slot #12 is LAST" reasoning misses): `Rng.fork()` advances the shared
 * root RNG by exactly one draw BY DESIGN. The persisted `GameState.rngState`
 * is the root state AFTER all per-step forks (`simulation.ts` runOneStep
 * persists `rng.getState()` after the system loop). So at step N+1, every
 * system that forks (BiologySystem #3, AutomationSystem #9) rebuilds its
 * child seed from a root state that includes step N's fork count. Adding an
 * EventSystem fork at #12 adds one draw per step to that accumulated root
 * state, which shifts the child seeds BiologySystem + AutomationSystem derive
 * at every subsequent tick — breaking the calibrated mortality / catch-up
 * death sequences pinned by the P7d / P8b determinism tests (the crippled-
 * tree "starved tree still dies" test at environment.test.ts:984 is
 * calibrated to the current 2-fork-per-step root sequence and flips dies →
 * survives if a third per-step fork lands).
 *
 * The "slot #12 is LAST" reasoning holds only WITHIN a single tick
 * (EventSystem's fork cannot shift a downstream forking system in the SAME
 * tick, because there is no downstream system). But ACROSS ticks the
 * accumulated root state shifts every downstream forker's child seed — that
 * is the perturbation R-P10-N avoids. This is the SAME mechanism documented
 * for the ProgressionSystem at slot #11 (R-P9-1); the EventSystem at slot #12
 * is not exempt just because it is last.
 *
 * The fork lands when (a) P10c's stochastic mechanics (random event rolling
 * via `PROVISIONAL_EVENT_BASE_PROBABILITY`, random severity / duration rolls,
 * climate feedback variance) arrive AND (b) the downstream RNG sequences
 * (BiologySystem mortality, AutomationSystem catch-up) are retuned for the
 * shifted sequence, OR `fork()` is refactored to a non-advancing sub-stream
 * derivation. A determinism test in `events.test.ts` pins the no-fork
 * behaviour: the root RNG state is unchanged across an EventSystem.execute,
 * and the BiologySystem / AutomationSystem RNG sequences are unaffected.
 *
 * P10b SCOPE — what is DEFERRED to P10c (global markets / climate feedback /
 * end-game objectives):
 *   - Random event rolling (`PROVISIONAL_EVENT_BASE_PROBABILITY` per check)
 *     — P10b fires only events explicitly scheduled via `schedule-event` or
 *     forced via `trigger-event`. Random rolling needs the RNG fork (R-P10-N).
 *   - Global market index evolution per tick (the EconomySystem P10c update
 *     of `globalMarketIndices`). P10b only reads / mutates the indices as
 *     event effects + as the central-bank recession / boom signal.
 *   - Climate feedback loops (GHG → temperature → drought/heat/extreme
 *     weather). P10b preserves `atmosphericCarbon` / `globalTemperature` from
 *     the P7 EnvironmentSystem and does NOT close the climate feedback loop.
 *   - End-game objectives (GDD §12). P10b surfaces regional collapse via
 *     `regional-condition-shifted` but does NOT evaluate win/loss conditions.
 *
 * The system is pure: it deep-copies the input state, mutates the copy, and
 * returns the new state. The input is NEVER mutated (TDD §4.1, §18.4).
 *
 * Rendering reads only — the rendering layer MUST NOT evaluate events or
 * policy independently. This system is the single engine-side driver of
 * scheduled-event firing + regional evolution + policy reaction; the UI
 * dispatches event actions (schedule-event, trigger-event, set-government-
 * policy, …) but never runs event processing.
 */
import type { GameState, SimulationEvent } from '@capitalist-tree/shared';
import type { System, SystemContext, SystemResult } from './system.js';
import { deepCopy } from '../deep-copy.js';
import {
  processScheduledEvents,
  evolveRegions,
  aggregateGlobalIndicators,
  updateGovernmentPolicy,
  updateMonetaryPolicy,
  seedDefaultRegions,
  applyClimateFeedback,
  applyEnvironmentalFeedback,
  evolveGlobalMarketIndices,
  rollRandomEvents,
  evaluateObjectives,
  diffObjectives,
} from '../events/index.js';
import {
  PROVISIONAL_SIMULATION_STEP_SECONDS,
} from '@capitalist-tree/shared';

export const eventSystem: System = {
  id: 'EventSystem',
  execute(state: GameState, ctx: SystemContext): SystemResult {
    // Deep-copy on entry — never mutate the input (TDD §4.1, §18.4).
    let next: GameState = deepCopy(state);
    const events: SimulationEvent[] = [];

    // @provisional RNG fork DEFERRED — see R-P10-N in the file-level doc.
    // The EventSystem does NOT call `ctx.rng.fork('EventSystem')`. P10c's
    // stochastic event rolling (`rollRandomEvents`) uses a SEEDED sub-RNG
    // derived from a hash of (state.rngState, currentTick, 'events') — ZERO
    // root draws (R-P10-N resolved; see events/random.ts).

    // 0. Evaluate end-game objectives on the INPUT state (before the tick's
    //    transforms) so the post-tick diff can emit `objective-achieved`
    //    notifications for objectives that flip false → true this tick.
    const objectivesBefore = evaluateObjectives(state);

    // 1. Seed regions on the first tick (idempotent — a non-empty regions
    //    list is preserved). The v13 migration leaves `regions` empty; the
    //    EventSystem seeds the @provisional default biomes so the regional
    //    drift + aggregation have meaningful input from tick one.
    if (next.eventState.global.regions.length === 0) {
      next = seedDefaultRegions(next);
    }

    // 2. rollRandomEvents (self-throttled by
    //    PROVISIONAL_EVENT_CHECK_INTERVAL_TICKS) — stochastic event rolling
    //    via a SEEDED sub-RNG (zero root draws — R-P10-N resolved). Rolls
    //    eligible events weighted by probabilityWeight × triggerConditions,
    //    schedules them to fire next tick.
    const currentTick = Math.floor(ctx.now / PROVISIONAL_SIMULATION_STEP_SECONDS);
    const rollResult = rollRandomEvents(next, currentTick);
    next = rollResult.state;
    events.push(...rollResult.events);

    // 3. processScheduledEvents (self-throttled by
    //    PROVISIONAL_EVENT_CHECK_INTERVAL_TICKS) — fire due scheduled events,
    //    apply their effects, retire concluded active events.
    const schedulerResult = processScheduledEvents(next, ctx.now);
    next = schedulerResult.state;
    events.push(...schedulerResult.events);

    // 4. evolveRegions (every tick) — drift regional indicators.
    const evolveResult = evolveRegions(next, ctx.stepSeconds);
    next = evolveResult.state;
    events.push(...evolveResult.events);

    // 5. applyClimateFeedback (every tick) — the P7↔P10 bridge: GHG →
    //    temperature → regional climate baseline drift → increased
    //    extreme-weather event probability (read by rollRandomEvents next
    //    tick). Reads P7's globalTemperature + atmosphericCarbon.
    const climateResult = applyClimateFeedback(next, ctx.stepSeconds);
    next = climateResult.state;
    events.push(...climateResult.events);

    // 6. applyEnvironmentalFeedback (every tick) — GDD §10.3 secondary
    //    consequences: deforestation → erosion → soilHealth; soil degradation
    //    → reduced productivity; water scarcity → higher resource prices;
    //    biodiversity loss → reduced resilience; species extinction
    //    irreversible below threshold.
    const envFeedbackResult = applyEnvironmentalFeedback(next);
    next = envFeedbackResult.state;
    events.push(...envFeedbackResult.events);

    // 7. evolveGlobalMarketIndices (every tick) — per-tick global market-index
    //    evolution (mean-reversion + supply/monetary/policy/active-event
    //    pressure). GDD §563 markets at global scale.
    const marketResult = evolveGlobalMarketIndices(next, ctx.stepSeconds);
    next = marketResult.state;
    events.push(...marketResult.events);

    // 8. aggregateGlobalIndicators (every tick) — recompute global averages
    //    from regional conditions.
    const aggregateResult = aggregateGlobalIndicators(next);
    next = aggregateResult.state;
    events.push(...aggregateResult.events);

    // 9. updateGovernmentPolicy (self-throttled by
    //    PROVISIONAL_GOVERNMENT_POLICY_INTERVAL_DAYS).
    const govResult = updateGovernmentPolicy(next, ctx.now);
    next = govResult.state;
    events.push(...govResult.events);

    // 10. updateMonetaryPolicy (self-throttled by
    //     PROVISIONAL_MONETARY_POLICY_INTERVAL_DAYS).
    const monetaryResult = updateMonetaryPolicy(next, ctx.now);
    next = monetaryResult.state;
    events.push(...monetaryResult.events);

    // 11. evaluateObjectives (read-only) on the post-tick state + diff against
    //     the pre-tick map → emit `objective-achieved` notifications for
    //     objectives that flipped false → true this tick (GDD §12 endings).
    const objectivesAfter = evaluateObjectives(next);
    for (const id of diffObjectives(objectivesBefore, objectivesAfter)) {
      events.push({
        type: 'notification',
        at: ctx.now,
        payload: {
          severity: 'critical',
          code: 'objective-achieved',
          message: `Objective achieved: ${objectivesAfter[id].description}`,
        },
      });
    }

    return { state: next, events };
  },
};
