/**
 * Economy module — public surface (P3a + P3b — TDD §10).
 *
 * All economy logic lives here:
 *   - `ledger.ts`: pure functions for account lookups, transfers, transaction
 *     recording, idempotency (P3a).
 *   - `authority.ts`: pure functions for the central monetary authority —
 *     CurrencyIssuanceRequest consumption, monetary supply tracking,
 *     issuance policy enforcement (P3a).
 *   - `markets.ts`: pure functions for market pricing, inflation index, and
 *     the purchase action (P3b — TDD §10.5, §10.6, GDD §8.5, §6.3).
 *   - `errors.ts`: typed errors thrown by the ledger + markets APIs.
 *
 * The EconomySystem (`packages/simulation/src/systems/economy.ts`) is the
 * only system that touches `state.economy`; the pure functions take state +
 * params and return new state + events.
 *
 * P3a scope: ledger + transaction system + CurrencyIssuanceRequest
 * consumption. P3b scope: markets + pricing + inflation index + purchase
 * action. PersonalSystem (P3c), pay-expense / transfer / sell-tree actions
 * (P3c/P3d) come later.
 *
 * Tests import these directly (`packages/simulation/test/economy.test.ts`,
 * `packages/simulation/test/markets.test.ts`) to assert the invariants the
 * GDD and TDD require:
 *   - Transfers correct (source debited, destination credited, transaction
 *     recorded).
 *   - Invalid transactions rejected (insufficient funds, unknown account,
 *     negative amount, non-bigint).
 *   - Issuance counted exactly once even across save/load (idempotency via
 *     requestId).
 *   - No silent money destruction: `sum(balances) + totalSinks === initialSupply
 *     + totalIssued`.
 *   - Markets: price shifts with supply/demand; inflation index tracks
 *     price changes; conservation invariant holds after purchase.
 *   - Determinism: same inputs → same outputs.
 */
export * from './errors.js';
export * from './ledger.js';
export * from './authority.js';
export * from './markets.js';
export * from './actions.js';
