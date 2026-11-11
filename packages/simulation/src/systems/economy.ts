/**
 * EconomySystem (TDD §4.2, §10; GDD §6).
 *
 * Per-tick responsibility:
 *   1. Drain `originalTree.pendingIssuances` — for each CurrencyIssuanceRequest
 *      queued by the `harvest-leaves` action handler (P1), call the monetary
 *      authority's `requestIssuance()` with a deterministic requestId derived
 *      from (saveId, simSecond, queueIndex). Credit the player's personal
 *      account, record an `issuance` transaction, emit `issuance-authorized`
 *      and `transaction-recorded` events.
 *   2. Idempotency: if a requestId is already in `economy.processedRequestIds`
 *      (e.g. the same step was processed before a save/load), the duplicate
 *      is rejected and NO money is issued. This guarantees currency
 *      production is accounted for exactly once (TDD §10.3 — "Currency
 *      production must be accounted for exactly once").
 *
 * Markets (P3b), PersonalSystem (P3c), and player actions like purchase /
 * pay-expense (P3c) come later. For P3a, the system just handles issuance +
 * transaction recording.
 *
 * The system is pure: it returns a new state, never mutates the input. The
 * engine wraps every system call in a deepCopy, so even if we returned the
 * same object reference it would be safe — but we always return a fresh
 * object to be defensive.
 *
 * Determinism: same (state, ctx) → same (new state, events). The requestId
 * is derived from `state.metadata.saveId` + `ctx.now` + the queue index,
 * all of which are deterministic given the state.
 *
 * Replaces the P0 stub in `packages/simulation/src/systems/stubs.ts`. The
 * system id `'EconomySystem'` is part of the public interface — downstream
 * agents reference it in tests and event logs. Do NOT rename.
 */
import type { System, SystemResult, SystemContext } from './system.js';
import { drainPendingIssuances } from '../economy/index.js';
import { DEFAULT_ISSUANCE_POLICY } from '@capitalist-tree/content';

export const economySystem: System = {
  id: 'EconomySystem',
  execute(state, ctx: SystemContext): SystemResult {
    const pending = state.originalTree.pendingIssuances;
    if (pending.length === 0) {
      // Fast path — nothing to issue this tick. No state change, no events.
      return { state, events: [] };
    }

    const saveId = state.metadata.saveId;
    const result = drainPendingIssuances(
      state,
      state.originalTree,
      saveId,
      ctx.now,
      {
        policy: DEFAULT_ISSUANCE_POLICY,
      },
    );
    return { state: result.state, events: [...result.events] };
  },
};
