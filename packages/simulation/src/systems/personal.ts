/**
 * PersonalSystem (TDD §4.2, §11; GDD §7).
 *
 * Per-tick responsibility:
 *   1. **Ensure the next bill is scheduled.** If no `bill-due` event exists
 *      in the scheduler for a future sim second, schedule one at the next
 *      `PROVISIONAL_PERSONAL_BILLING_INTERVAL_SECONDS` boundary. This uses
 *      P0's event scheduler (TDD §6.4) — bills fire at the right sim time,
 *      not every tick.
 *   2. **Process due bills.** For each `bill-due` scheduled event whose
 *      `at <= ctx.now`, attempt to pay each of the 5 living-expense
 *      categories out of `player:personal` (sinking the cash to the
 *      authority, category `'expense'`). If the player can't afford a
 *      category, increment `player.unpaidDays` by
 *      `PROVISIONAL_PERSONAL_BILLING_INTERVAL_DAYS` (one full cycle of
 *      unpaid living costs) and emit an `expense-due` event with
 *      `paid: false`. Cancel the fired scheduled event from the scheduler
 *      (it's been processed — leaving it would cause `due()` to re-emit it
 *      as a `scheduled-event` SimulationEvent next tick).
 *   3. **Derive well-being indicators.** Recompute `player.health`,
 *      `player.happiness`, and `player.financialSecurity` from underlying
 *      drivers (real wealth via the inflation index, unpaidDays counter).
 *      Implements the diminishing-returns function on wealth (GDD §7.3) via
 *      the pure `deriveWellBeing()` helper.
 *   4. **Decay unpaidDays counter (recovery).** If no bill was due this
 *      tick (or all bills were paid), decay `player.unpaidDays` by
 *      `PROVISIONAL_WELL_BEING_UNPAID_RECOVERY_PER_TICK` (asymptotic — the
 *      counter approaches 0 but never goes negative).
 *   5. **Low-funds notification.** If `player:personal` balance is below
 *      `PROVISIONAL_PERSONAL_LOW_FUNDS_THRESHOLD_MINOR`, emit a `notification`
 *      event with code `'low-funds'`, severity `'warning'`. Emitted once
 *      per tick the balance is low (the UI can debounce).
 *
 * The system is pure: it returns a new state, never mutates the input. The
 * engine wraps every system call in a deepCopy, so even if we returned the
 * same object reference it would be safe — but we always return a fresh
 * object to be defensive.
 *
 * Determinism: same (state, ctx) → same (new state, events). The system
 * uses no randomness — only arithmetic on the current state. Bill ids are
 * derived deterministically from (saveId, simSecond, cycle) so the same
 * scheduled bill always has the same id across save/load.
 *
 * The system does NOT fork the RNG (it doesn't draw any random values).
 * This is intentional — forking would advance the root RNG by one draw,
 * shifting the sequences of downstream systems (BusinessSystem is the next
 * non-stub; P7+). Skipping the fork keeps PersonalSystem pure arithmetic.
 *
 * Replaces the P0 stub in `packages/simulation/src/systems/stubs.ts`. The
 * system id `'PersonalSystem'` is part of the public interface — downstream
 * agents reference it in tests and event logs. Do NOT rename.
 */
import type { GameState, SimulationEvent } from '@capitalist-tree/shared';
import {
  PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
  PROVISIONAL_PERSONAL_LOW_FUNDS_THRESHOLD_MINOR,
  PROVISIONAL_WELL_BEING_UNPAID_RECOVERY_PER_TICK,
} from '@capitalist-tree/shared';
import type { System, SystemResult, SystemContext } from './system.js';
import {
  deriveWellBeing,
} from '../personal/well-being.js';
import {
  ensureNextBillScheduled,
  dueBills,
  processFiredBill,
} from '../personal/expenses.js';
import { getBalance, parseAmount } from '../economy/ledger.js';

export const personalSystem: System = {
  id: 'PersonalSystem',
  execute(state, ctx: SystemContext): SystemResult {
    let next: GameState = state;
    const events: SimulationEvent[] = [];

    // 1. Ensure the next bill is scheduled (no-op if one is already queued
    //    for a future sim second).
    next = ensureNextBillScheduled(next, ctx.now);

    // 2. Process due bills (auto-pay or record unpaid).
    const fired = dueBills(next, ctx.now);
    let hadUnpaidThisTick = false;
    for (const bill of fired) {
      const result = processFiredBill(next, bill, ctx.now);
      next = result.state;
      events.push(...result.events);
      // Track whether any category went unpaid this tick — used below to
      // decide whether to decay the unpaidDays counter (we don't decay on
      // ticks where new unpaid bills accumulate).
      if (
        result.events.some(
          (e) => e.type === 'expense-due' && e.payload.paid === false,
        )
      ) {
        hadUnpaidThisTick = true;
      }
    }

    // 3. Decay unpaidDays counter (recovery) when no new unpaid bills
    //    accumulated this tick. The decay is asymptotic — the counter
    //    approaches 0 but never goes negative. floor() keeps the counter
    //    an integer (avoid floating-point drift across many ticks).
    if (!hadUnpaidThisTick && next.player.unpaidDays > 0) {
      const decayed = Math.floor(
        next.player.unpaidDays * (1 - PROVISIONAL_WELL_BEING_UNPAID_RECOVERY_PER_TICK),
      );
      const nextUnpaid = Math.max(0, decayed);
      if (nextUnpaid !== next.player.unpaidDays) {
        next = {
          ...next,
          player: { ...next.player, unpaidDays: nextUnpaid },
        };
      }
    }

    // 4. Derive well-being indicators (financial security, physical health,
    //    happiness) from underlying drivers. Writes the derived values to
    //    state.player.{health, happiness, financialSecurity}.
    const wellBeing = deriveWellBeing(next);
    next = {
      ...next,
      player: {
        ...next.player,
        health: wellBeing.physicalHealth,
        happiness: wellBeing.happiness,
        financialSecurity: wellBeing.financialSecurity,
      },
    };

    // 5. Low-funds notification — when player:personal balance is below
    //    the threshold, emit a warning. Emitted once per tick (the UI can
    //    debounce). Skipped if the balance is exactly at the threshold
    //    (strictly less-than to avoid flapping at the boundary).
    const balance = getBalance(next, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID);
    const threshold = parseAmount(
      PROVISIONAL_PERSONAL_LOW_FUNDS_THRESHOLD_MINOR,
      'lowFundsThreshold',
    );
    if (balance < threshold) {
      events.push({
        type: 'notification',
        at: ctx.now,
        payload: {
          severity: 'warning',
          code: 'low-funds',
          message: `Personal cash (${balance.toString(10)}) is below the low-funds threshold (${PROVISIONAL_PERSONAL_LOW_FUNDS_THRESHOLD_MINOR}). Pay a bill or harvest leaves to recover.`,
        },
      });
    }

    if (events.length === 0) {
      // Fast path — no events emitted this tick. Return state from the
      // well-being update (which always recomputes the indicators even
      // without events).
      return { state: next, events: [] };
    }

    return { state: next, events };
  },
};
