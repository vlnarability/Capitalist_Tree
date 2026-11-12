/**
 * AutomationSystem (TDD §4.2, §12; GDD §9, §9.1, §95 pillar 4).
 *
 * Replaces the P0 stub at registry slot #9. Runs once per simulation step
 * AFTER EconomySystem (slot #6) and PersonalSystem (slot #7) so automation-
 * triggered actions see the up-to-date economy + player state, and BEFORE
 * EnvironmentSystem (slot #10) so environmental impacts accumulated here are
 * visible to it (when it leaves stub status in P6+).
 *
 * Each step:
 *   1. Fork a deterministic sub-stream `'AutomationSystem'` from `ctx.rng`.
 *      The root RNG is shared; the fork gives the automation path an
 *      independent sub-stream so its draws — reserved for future stochastic
 *      failure modes like equipment breakdown — don't shift other systems'
 *      sequences. The sub-stream is NOT persisted on `rngStreams` because the
 *      schema has no `automation` slot and P6b2 is out of scope for a schema
 *      change; the fork is therefore stateless per-step, like BiologySystem's
 *      fork. @provisional — persisting it would need a `rngStreams.automation`
 *      field (GDD §17).
 *   2. For each automation in `state.automation` (in array order):
 *      a. `evaluatePolicy(state, automation, ctx.now, tickEvents)`.
 *      b. If `shouldRun`, `executeAutomation(state, automation, params)`.
 *         Otherwise emit `automation-skipped` with the reason.
 *      c. Accumulate the new state + events (each automation sees the effects
 *         of the ones before it this tick).
 *
 * @provisional Event-triggered policies: the engine does not pass the in-step
 * events to systems (`SystemContext` has no events field), so the
 * AutomationSystem cannot observe what other systems emitted this tick.
 * `event` policies therefore always evaluate to `condition-not-met` in this
 * revision. Wiring this requires extending `SystemContext` (or having the
 * engine thread events through), which is out of P6b2 scope — left as a
 * TODO for a follow-up that touches the engine + system interface.
 *
 * The system is pure: it deep-copies the input state, mutates the copy, and
 * returns the new state. The input is NEVER mutated (TDD §4.1).
 *
 * Rendering reads only — the rendering layer MUST NOT execute automation
 * independently (TDD §12). This system is the single engine-side driver of
 * automation; the UI dispatches `enable/disable/set-policy/purchase-equipment`
 * actions to configure automations, but never runs them.
 */
import type { GameState, SimulationEvent } from '@capitalist-tree/shared';
import type { System, SystemContext, SystemResult } from './system.js';
import { deepCopy } from '../deep-copy.js';
import { evaluatePolicy, executeAutomation } from '../automation/index.js';

export const automationSystem: System = {
  id: 'AutomationSystem',
  execute(state: GameState, ctx: SystemContext): SystemResult {
    const next = deepCopy(state);
    const events: SimulationEvent[] = [];

    // No automations — fast path.
    if (next.automation.length === 0) {
      return { state: next, events };
    }

    // Fork the deterministic sub-stream for the automation path. Currently
    // unused by the deterministic execution, but reserved for future
    // stochastic failure modes (equipment breakdown rolls). The fork keeps
    // the automation path's draws independent of other systems' sequences.
    const rng = ctx.rng.fork('AutomationSystem');

    // @provisional: event-triggered policies (see module doc). The engine
    // does not thread in-step events to systems, so this is empty and `event`
    // policies always evaluate to condition-not-met for now.
    const tickEvents: readonly string[] = [];

    // Iterate over a snapshot of the automation array — executeAutomation may
    // append to `next.automation` (e.g. a purchase-equipment action spawned by
    // an automation), and we do not want to evaluate freshly-spawned
    // automations in the same tick (they start with lastRunAt=0 + cooldown=0,
    // which could cause them to fire immediately and recurse). The snapshot
    // keeps the per-tick evaluation set stable.
    const snapshot = [...next.automation];
    for (const automation of snapshot) {
      // Re-fetch the current automation from `next.automation` in case an
      // earlier automation's action mutated it (e.g. enabled flag). Falls
      // back to the snapshot entry if it was removed (defensive).
      const current = next.automation.find((a) => a.id === automation.id) ?? automation;
      const decision = evaluatePolicy(next, current, ctx.now, tickEvents);
      if (decision.shouldRun) {
        const result = executeAutomation(next, current, {
          now: ctx.now,
          stepSeconds: ctx.stepSeconds,
          rng,
        });
        next = result.state;
        events.push(...result.events);
      } else {
        events.push({
          type: 'automation-skipped',
          at: ctx.now,
          payload: {
            automationId: current.id,
            reason: decision.reason ?? 'condition-not-met',
          },
        });
      }
    }

    return { state: next, events };
  },
};
