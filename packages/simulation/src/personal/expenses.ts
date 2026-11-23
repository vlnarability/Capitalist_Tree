/**
 * Recurring living expenses (P3c — TDD §11, GDD §7.1).
 *
 * Pure functions for:
 *   - Building the `bill-due` scheduled event payload (one per cycle).
 *   - Looking up the configured monthly amount for a given category from
 *     `player.livingExpenses`.
 *   - Scheduling the next bill at the right sim time (every
 *     `PROVISIONAL_PERSONAL_BILLING_INTERVAL_DAYS` sim days).
 *   - Processing a fired `bill-due` event: pay each category out of
 *     `player:personal` (sink to authority, category `'expense'`) OR record
 *     it as unpaid (increment `player.unpaidDays`).
 *
 * The PersonalSystem calls these each tick. The `pay-expense` action handler
 * (P3c) calls `processExpensePayment` to handle manual payments.
 *
 * All functions are pure: they return new state + events, never mutate
 * input. Deterministic: same (state, params) → same output. No randomness.
 *
 * Money NEVER silently created or destroyed (TDD §10.4): paid expenses are
 * `transfer()` calls with `destinationAccount = authority` (a sink —
 * `monetarySupply` decreases, `totalSinks` increases). Unpaid expenses
 * move no money; the only state change is incrementing the `unpaidDays`
 * counter.
 *
 * The conservation invariant
 * (`sum(accounts.balance) + totalSinks === initialSupply + totalIssued`)
 * holds for paid expenses by construction (the `transfer()` function
 * preserves it). Unpaid expenses trivially preserve it (no money moved).
 */
import type {
  GameState,
  LivingExpenseCategory,
  ScheduledEvent,
  SimulationEvent,
  TransactionRecord,
} from '@capitalist-tree/shared';
import {
  LIVING_EXPENSE_CATEGORIES,
  PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
  PROVISIONAL_ECONOMY_CATEGORY_EXPENSE,
  PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
  PROVISIONAL_PERSONAL_BILLING_INTERVAL_SECONDS,
  PROVISIONAL_PERSONAL_EXPENSE_FOOD_MINOR,
  PROVISIONAL_PERSONAL_EXPENSE_HOUSING_MINOR,
  PROVISIONAL_PERSONAL_EXPENSE_HEALTHCARE_MINOR,
  PROVISIONAL_PERSONAL_EXPENSE_TRANSPORTATION_MINOR,
  PROVISIONAL_PERSONAL_EXPENSE_UTILITIES_MINOR,
  PROVISIONAL_PERSONAL_FIRST_BILL_DELAY_SECONDS,
} from '@capitalist-tree/shared';
import { transfer, getBalance, parseAmount } from '../economy/ledger.js';
import { schedule, cancel } from '../events/scheduler.js';
import { unpaidDaysIncrementForOneUnpaidBill } from './well-being.js';

/**
 * Lookup table for the default monthly amount per category. Used at game
 * start (initial-state.ts) and for any category the player hasn't
 * customized. Future phases may let the player configure their own
 * `livingExpenses` values (P5+ lifestyle upgrades — bigger house, better
 * food, etc.).
 */
export const DEFAULT_EXPENSE_AMOUNTS: Readonly<Record<LivingExpenseCategory, string>> = {
  food: PROVISIONAL_PERSONAL_EXPENSE_FOOD_MINOR,
  housing: PROVISIONAL_PERSONAL_EXPENSE_HOUSING_MINOR,
  utilities: PROVISIONAL_PERSONAL_EXPENSE_UTILITIES_MINOR,
  healthcare: PROVISIONAL_PERSONAL_EXPENSE_HEALTHCARE_MINOR,
  transportation: PROVISIONAL_PERSONAL_EXPENSE_TRANSPORTATION_MINOR,
};

/**
 * Get the configured monthly amount for a category. Falls back to the
 * default constant if `player.livingExpenses[category]` is `'0'` or missing
 * (which is the case for fresh saves — `initializeState()` seeds all 5 to
 * `'0'`, and the PersonalSystem populates them lazily on the first bill
 * cycle, OR the player can set them explicitly via a future `set-budget`
 * action).
 *
 * Pure: deterministic given (state, category).
 */
export function getExpenseAmount(
  state: GameState,
  category: LivingExpenseCategory,
): string {
  const configured = state.player.livingExpenses[category];
  // '0' or empty → use the default. Otherwise, honour the player's
  // customized value (e.g. an upgrade action raised their housing budget).
  if (!configured || configured === '0') {
    return DEFAULT_EXPENSE_AMOUNTS[category];
  }
  return configured;
}

/**
 * Build the deterministic scheduled-event id for a bill at a given sim second.
 * Same (saveId, atSimSecond) pair always produces the same id — this is the
 * scheduling idempotency key. `schedule` dedupes by id, so re-scheduling the
 * same bill (same `at`, e.g. after a save/load) is a no-op; bills at DIFFERENT
 * sim seconds get distinct ids + can coexist in the scheduler.
 *
 * W46 (inert-expenses fix): pre-W46 the id was `bill-due:${saveId}:${cycle}`
 * where `cycle = floor(at / INTERVAL)`. This assumed one bill per cycle at
 * `N × INTERVAL`, so two bills in the same cycle (e.g. a test's manual bill at
 * sim second 60 + the auto-scheduled first bill at FIRST_BILL_DELAY = 86_400,
 * both `cycle 0`) collided on the id + the second was silently deduped by
 * `schedule`. With the first bill now at FIRST_BILL_DELAY (not `0 × INTERVAL`),
 * the cycle number no longer uniquely identifies a bill, so the id encodes the
 * full `at` sim second. Re-scheduling the same `at` is still idempotent; the
 * `cycle` field on the payload (for display/debug) is unchanged.
 */
export function billDueEventId(
  saveId: string,
  atSimSecond: number,
): string {
  return `bill-due:${saveId}:${atSimSecond}`;
}

/**
 * Build a `bill-due` ScheduledEvent for the given sim second. The payload
 * is the list of (category, amount) pairs the PersonalSystem will attempt
 * to pay when the event fires.
 *
 * The payload shape is documented in `scheduler.ts` as opaque
 * (`z.unknown()`); P3c narrows it to a typed `BillDuePayload` here. The
 * PersonalSystem reads `event.payload` as `BillDuePayload` — a runtime
 * guard would be defensive but skipped for simplicity (the scheduler is
 * internal state, not user input).
 */
export interface BillDuePayload {
  /** The cycle index (0 = first bill, 1 = second, ...). Used for the
   *  idempotency check via `billDueEventId`. */
  cycle: number;
  /** Snapshot of the 5 categories + their amounts at the time the bill
   *  was scheduled. The PersonalSystem reads this when the bill fires to
   *  know what to pay. (If the player upgrades their lifestyle mid-cycle,
   *  the next bill's snapshot reflects the new amounts.) */
  items: ReadonlyArray<{ category: LivingExpenseCategory; amount: string }>;
}

/**
 * Build a `bill-due` scheduled event for the given sim second + the
 * player's current expense configuration. Pure: deterministic given the
 * inputs.
 */
export function buildBillDueEvent(
  state: GameState,
  atSimSecond: number,
): ScheduledEvent {
  const cycle = Math.floor(atSimSecond / PROVISIONAL_PERSONAL_BILLING_INTERVAL_SECONDS);
  const items = LIVING_EXPENSE_CATEGORIES.map((category) => ({
    category,
    amount: getExpenseAmount(state, category),
  }));
  return {
    id: billDueEventId(state.metadata.saveId, atSimSecond),
    at: atSimSecond,
    kind: 'bill-due',
    payload: {
      cycle,
      items,
    } satisfies BillDuePayload,
  };
}

/**
 * Schedule the next bill if none is currently scheduled for the future.
 *
 * Called by the PersonalSystem each tick. If the scheduler has no `bill-due`
 * event with `at > ctx.now`, schedule the next one. The scheduled `at` is:
 *   - `PROVISIONAL_PERSONAL_FIRST_BILL_DELAY_SECONDS` (day 1) for the FIRST
 *     bill ever (detected via `player.lastBillAt === 0` + `now < DELAY`).
 *   - The next `N × BILLING_INTERVAL_SECONDS` boundary (day 30, 60, ...) for
 *     all subsequent bills.
 *
 * W46 (inert-expenses fix): pre-W46 the first bill fired at the full
 * BILLING_INTERVAL (day 30), leaving a 30-day dead zone with zero expense
 * activity. With the defaults now seeded (so the UI shows real amounts from
 * tick 0) + the first bill at day 1, the player encounters the expense system
 * within ~24 min of play at 1× speed instead of ~12 hours.
 *
 * The `lastBillAt === 0` signal cleanly distinguishes "fresh game, no bill
 * has fired" from "a bill already fired + was cancelled" (cancelled bills are
 * gone from the scheduler, so the scheduler state alone can't tell). Once the
 * first bill fires, `processFiredBill` sets `lastBillAt`, so subsequent calls
 * fall through to the cycle-boundary path. The `now < DELAY` guard prevents
 * re-scheduling a stale day-1 slot if the sim was paused/resumed past day 1
 * without the first bill firing.
 *
 * Pure: returns new state, never mutates input. If a future bill is already
 * scheduled, returns state unchanged.
 */
export function ensureNextBillScheduled(
  state: GameState,
  now: number,
): GameState {
  // Is there already a bill-due event scheduled for the future?
  const hasFutureBill = state.scheduler.events.some(
    (e) => e.kind === 'bill-due' && e.at > now,
  );
  if (hasFutureBill) return state;

  // Is there a bill-due event already due (at <= now) but not yet processed?
  // `ensureNextBillScheduled` runs BEFORE `dueBills` in the PersonalSystem, so
  // at the tick a bill fires it is still in the scheduler as a due (not
  // future) event. If we ignored this, `isFirstBillEver` (which checks
  // `lastBillAt === 0`) would re-schedule another first bill — the due bill
  // hasn't set `lastBillAt` yet. Falling through to the cycle boundary here
  // queues the next bill correctly; `dueBills` then processes + cancels the
  // due one + sets `lastBillAt`.
  const hasDueBill = state.scheduler.events.some(
    (e) => e.kind === 'bill-due' && e.at <= now,
  );

  // W46: first bill ever fires at FIRST_BILL_DELAY (day 1); subsequent bills
  // at the regular cycle boundary (day 30, 60, ...). The cycle id
  // (`floor(at / INTERVAL)`) is 0 for the first bill + 1, 2, ... after, so
  // the deterministic id stays stable across save/load.
  const isFirstBillEver =
    state.player.lastBillAt === 0 &&
    now < PROVISIONAL_PERSONAL_FIRST_BILL_DELAY_SECONDS &&
    !hasDueBill;
  const nextAt = isFirstBillEver
    ? PROVISIONAL_PERSONAL_FIRST_BILL_DELAY_SECONDS
    : (Math.floor(now / PROVISIONAL_PERSONAL_BILLING_INTERVAL_SECONDS) + 1) *
      PROVISIONAL_PERSONAL_BILLING_INTERVAL_SECONDS;
  const event = buildBillDueEvent(state, nextAt);
  return schedule(state, event);
}

/**
 * Result of processing one expense payment (paid or unpaid). Used by the
 * PersonalSystem (for the per-tick auto-pay flow) and by the `pay-expense`
 * action handler.
 */
export interface ProcessExpenseResult {
  state: GameState;
  events: SimulationEvent[];
}

/**
 * Process a single expense payment.
 *
 * Tries to debit `player:personal` by `amount` and sink it to the central
 * monetary authority (category `'expense'`). If the player can't afford
 * it, increments `player.unpaidDays` by the per-bill increment (one full
 * billing cycle of unpaid living costs) and emits an `expense-due` event
 * with `paid: false`.
 *
 * **The function never throws** for insufficient funds — that's the whole
 * point (GDD §16.3, TDD §11 — unpaid bills must not crash the engine).
 * Other errors (invalid amount, unknown account) propagate as typed
 * errors from the underlying `transfer()`.
 *
 * `source` discriminates whether this is the PersonalSystem's auto-bill
 * flow (`'auto-bill'`) or a manual `pay-expense` action (`'pay-expense'`).
 *
 * Pure: returns new state + events, never mutates input. Deterministic
 * given (state, params).
 */
export function processExpensePayment(
  state: GameState,
  params: {
    category: LivingExpenseCategory;
    amount: string;
    timestamp: number;
    source: 'auto-bill' | 'pay-expense';
  },
): ProcessExpenseResult {
  const amount = parseAmount(params.amount, 'amount');
  const balance = getBalance(state, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID);

  // Case 1: amount is 0 (or negative after parse) — nothing to pay. Emit
  // a paid=true expense-due with no transaction. Defensive — the schema
  // requires positive amounts for the pay-expense action, but the
  // auto-bill flow may produce 0 if the player has customized their
  // budget to 0 for some category.
  if (amount <= 0n) {
    return {
      state,
      events: [
        {
          type: 'expense-due',
          at: params.timestamp,
          payload: {
            category: params.category,
            amount: params.amount,
            paid: true,
            source: params.source,
            playerBalanceAfter: balance.toString(10),
            unpaidDaysAfter: state.player.unpaidDays,
          },
        },
      ],
    };
  }

  // Case 2: insufficient funds — record as unpaid.
  if (balance < amount) {
    const increment = unpaidDaysIncrementForOneUnpaidBill();
    const next: GameState = {
      ...state,
      player: {
        ...state.player,
        unpaidDays: state.player.unpaidDays + increment,
      },
    };
    const expenseDueEvent: SimulationEvent = {
      type: 'expense-due',
      at: params.timestamp,
      payload: {
        category: params.category,
        amount: params.amount,
        paid: false,
        source: params.source,
        playerBalanceAfter: balance.toString(10),
        unpaidDaysAfter: next.player.unpaidDays,
      },
    };
    const lowFundsNotification: SimulationEvent = {
      type: 'notification',
      at: params.timestamp,
      payload: {
        severity: 'warning',
        code: 'low-funds',
        message: `Insufficient funds to pay ${params.category} expense (${params.amount} needed, ${balance.toString(10)} available). Unpaid days: ${next.player.unpaidDays}.`,
      },
    };
    return { state: next, events: [expenseDueEvent, lowFundsNotification] };
  }

  // Case 3: sufficient funds — pay the bill. Transfer the amount from
  // player:personal to the authority (a sink). transfer() records the
  // transaction, decrements monetarySupply, increments totalSinks.
  let nextState = transfer(state, {
    sourceAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
    destinationAccount: PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
    amount: params.amount,
    category: PROVISIONAL_ECONOMY_CATEGORY_EXPENSE,
    description: `Living expense: ${params.category} (${params.source})`,
    timestamp: params.timestamp,
  });

  // Mirror the new player balance to player.personalCash (the same coupling
  // P3a's requestIssuance uses). The EconomySystem also does this for
  // market purchases; here we do it for expense payments. P3d may refactor
  // this coupling.
  const newPlayerBalance = nextState.economy.accounts.find(
    (a) => a.id === PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
  )?.balance;
  if (
    newPlayerBalance !== undefined &&
    newPlayerBalance !== nextState.player.personalCash
  ) {
    nextState = {
      ...nextState,
      player: { ...nextState.player, personalCash: newPlayerBalance },
    };
  }

  // The new transaction is the last entry in nextState.economy.transactions.
  const record: TransactionRecord =
    nextState.economy.transactions[nextState.economy.transactions.length - 1]!;

  const events: SimulationEvent[] = [
    {
      type: 'transaction-recorded',
      at: params.timestamp,
      payload: { record },
    },
    {
      type: 'expense-due',
      at: params.timestamp,
      payload: {
        category: params.category,
        amount: params.amount,
        paid: true,
        source: params.source,
        playerBalanceAfter: newPlayerBalance ?? nextState.player.personalCash,
        unpaidDaysAfter: nextState.player.unpaidDays,
        transactionId: record.id,
      },
    },
  ];

  return { state: nextState, events };
}

/**
 * Process a fired `bill-due` scheduled event.
 *
 * For each (category, amount) pair in the bill's payload, calls
 * `processExpensePayment` with `source: 'auto-bill'`. Returns the
 * accumulated state + events. The PersonalSystem then cancels the fired
 * event from the scheduler (it's been processed — leaving it would cause
 * `due()` to re-emit it as a `scheduled-event` SimulationEvent on the
 * next tick).
 *
 * Pure: returns new state + events, never mutates input. Deterministic
 * given (state, event, timestamp).
 */
export function processFiredBill(
  state: GameState,
  event: ScheduledEvent,
  timestamp: number,
): ProcessExpenseResult {
  if (event.kind !== 'bill-due') {
    // Defensive — caller should filter to bill-due events before calling.
    return { state, events: [] };
  }
  const payload = event.payload as BillDuePayload;
  let next: GameState = state;
  const events: SimulationEvent[] = [];

  for (const item of payload.items) {
    const result = processExpensePayment(next, {
      category: item.category,
      amount: item.amount,
      timestamp,
      source: 'auto-bill',
    });
    next = result.state;
    events.push(...result.events);
  }

  // Cancel the fired event from the scheduler (it's been processed).
  next = cancel(next, event.id);

  // W46 (inert-expenses fix): record the sim second of this fired bill so
  // `ensureNextBillScheduled` can distinguish "first bill ever" (lastBillAt
  // === 0 → schedule at FIRST_BILL_DELAY) from "a bill already fired"
  // (lastBillAt > 0 → schedule at the cycle boundary). Set after the
  // processExpensePayment loop so this fires whether the bill was paid or
  // unpaid — either way the bill came due + was processed, which is the
  // signal we need.
  if (next.player.lastBillAt !== event.at) {
    next = {
      ...next,
      player: { ...next.player, lastBillAt: event.at },
    };
  }

  return { state: next, events };
}

/**
 * Find all `bill-due` scheduled events whose `at <= now` (i.e. due).
 *
 * Used by the PersonalSystem to discover which bills to process this tick.
 * Pure: returns a list, does not modify state.
 */
export function dueBills(state: GameState, now: number): ScheduledEvent[] {
  return state.scheduler.events.filter(
    (e) => e.kind === 'bill-due' && e.at <= now,
  );
}
