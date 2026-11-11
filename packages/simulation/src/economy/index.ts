/**
 * Economy module — public surface (P3a — TDD §10).
 *
 * All economy logic lives here:
 *   - `ledger.ts`: pure functions for account lookups, transfers, transaction
 *     recording, idempotency.
 *   - `authority.ts`: pure functions for the central monetary authority —
 *     CurrencyIssuanceRequest consumption, monetary supply tracking,
 *     issuance policy enforcement.
 *   - `errors.ts`: typed errors thrown by the ledger API.
 *
 * The EconomySystem (`packages/simulation/src/systems/economy.ts`) is the
 * only system that touches `state.economy`; the pure functions take state +
 * params and return new state + events.
 *
 * P3a scope: ledger + transaction system + CurrencyIssuanceRequest
 * consumption. Markets (P3b), PersonalSystem (P3c), and player actions
 * like purchase / pay-expense (P3c) come later.
 *
 * Tests import these directly (`packages/simulation/test/economy.test.ts`)
 * to assert the invariants the GDD and TDD require:
 *   - Transfers correct (source debited, destination credited, transaction
 *     recorded).
 *   - Invalid transactions rejected (insufficient funds, unknown account,
 *     negative amount, non-bigint).
 *   - Issuance counted exactly once even across save/load (idempotency via
 *     requestId).
 *   - No silent money destruction: `sum(balances) + totalSinks === initialSupply
 *     + totalIssued`.
 *   - Determinism: same pendingIssuances + same state → same final state +
 *     transaction log.
 */
export * from './errors.js';
export * from './ledger.js';
export * from './authority.js';
