/**
 * Personal module — public surface (P3c — TDD §11, GDD §7).
 *
 * All PersonalSystem logic lives here:
 *   - `expenses.ts`: pure functions for scheduling recurring bills via the
 *     event scheduler, processing fired bills (pay or record unpaid), and
 *     handling manual `pay-expense` actions.
 *   - `well-being.ts`: pure functions for deriving the three primary
 *     well-being indicators (financial security, physical health, happiness)
 *     from underlying drivers. Implements the diminishing-returns function
 *     on wealth (GDD §7.3) and exposes nominal vs real purchasing power
 *     via P3b's inflation index.
 *
 * The PersonalSystem (`packages/simulation/src/systems/personal.ts`) is the
 * only system that touches `state.player.{health, happiness,
 * financialSecurity, unpaidDays}`; the pure functions take state + params
 * and return new state + events.
 *
 * P3c scope: recurring living expenses (food, housing, utilities,
 * healthcare, transportation) as scheduled events; auto-pay or unpaid-bill
 * accounting; well-being derivation; financial-event notifications.
 * P3d will add the docs/economy.md + final integration tests.
 *
 * Tests import these directly (`packages/simulation/test/personal.test.ts`)
 * to assert the invariants the GDD and TDD require:
 *   - Bills scheduled at the right sim time and fire when due.
 *   - Pay-expense transfers money correctly (player debited, authority
 *     credited via sink, transaction recorded).
 *   - Insufficient funds handled gracefully (unpaid-day counter increments,
 *     health impacted, action does NOT throw).
 *   - Diminishing-returns curve shape (happiness/financialSecurity vs
 *     wealth — poverty→security gap substantially larger than
 *     wealthy→extraordinarily-wealthy gap).
 *   - Conservation invariant still holds (sum(balances) + totalSinks ===
 *     initialSupply + totalIssued).
 *   - Determinism: same (state, scheduled events) → same final state.
 */
export * from './expenses.js';
export * from './well-being.js';
