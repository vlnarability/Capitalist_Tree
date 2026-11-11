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
 *   3. P3b — update market prices + inflation index. Each tick, all markets'
 *      supply/demand are advanced (refill + decay) and prices are recomputed
 *      from supply/demand + monetary conditions. The inflation index is
 *      derived from the basket of market prices vs their base prices (NOT
 *      applied as a global multiplier — TDD §10.6). Emits one
 *      `market-price-changed` event per market whose price moved.
 *
 * The system is pure: it returns a new state, never mutates the input. The
 * engine wraps every system call in a deepCopy, so even if we returned the
 * same object reference it would be safe — but we always return a fresh
 * object to be defensive.
 *
 * Determinism: same (state, ctx) → same (new state, events). The requestId
 * is derived from `state.metadata.saveId` + `ctx.now` + the queue index,
 * all of which are deterministic given the state. The pricing model uses
 * no randomness — only arithmetic on the current market state.
 *
 * Replaces the P0 stub in `packages/simulation/src/systems/stubs.ts`. The
 * system id `'EconomySystem'` is part of the public interface — downstream
 * agents reference it in tests and event logs. Do NOT rename.
 */
import type { GameState, SimulationEvent } from '@capitalist-tree/shared';
import type { System, SystemResult, SystemContext } from './system.js';
import { drainPendingIssuances, updateMarkets } from '../economy/index.js';
import { DEFAULT_ISSUANCE_POLICY } from '@capitalist-tree/content';
import { PROVISIONAL_STARTING_PERSONAL_CASH_MINOR } from '@capitalist-tree/shared';

export const economySystem: System = {
  id: 'EconomySystem',
  execute(state, ctx: SystemContext): SystemResult {
    const pending = state.originalTree.pendingIssuances;
    const saveId = state.metadata.saveId;
    const events: SimulationEvent[] = [];

    // 1. Drain pending issuances (P3a).
    let next: GameState = state;
    if (pending.length > 0) {
      const issuanceResult = drainPendingIssuances(
        next,
        next.originalTree,
        saveId,
        ctx.now,
        { policy: DEFAULT_ISSUANCE_POLICY },
      );
      next = issuanceResult.state;
      events.push(...issuanceResult.events);
    }

    // 2. Update market prices + inflation index (P3b).
    //    initialSupply is the player's starting cash — a constant for a
    //    given save. PROVISIONAL_STARTING_PERSONAL_CASH_MINOR is the
    //    default (50_000 minor units = $500.00). For saves with a different
    //    starting cash, this should ideally be persisted on EconomyState;
    //    P3b uses the constant default which matches
    //    DEFAULT_GAME_CONFIG.startingPersonalCash. A future refactor will
    //    add an `initialSupply` field to EconomyState.
    const marketResult = updateMarkets(next, {
      now: ctx.now,
      initialSupply: PROVISIONAL_STARTING_PERSONAL_CASH_MINOR.toString(10),
    });
    next = marketResult.state;
    events.push(...marketResult.events);

    if (events.length === 0) {
      // Fast path — no events emitted this tick. Return the state from the
      // market update (which may have changed even without events, e.g.
      // supply/demand values shift slightly).
      return { state: next, events: [] };
    }

    return { state: next, events };
  },
};
