/**
 * Business module — public surface (P8b — TDD §5.7 Business State, §11
 * Personal and Business Accounting; GDD §8 Business and Economic Simulation).
 *
 * All business logic lives here:
 *   - `errors.ts`:        typed errors thrown by the business action handlers
 *     (UnknownBusinessTypeError / UnknownBusinessError /
 *     UnsupportedBusinessActionError / UnknownLiabilityError /
 *     InvalidBusinessStatusError). Mirrors the economy/automation error
 *     pattern — runtime-only signals, NOT part of the saved GameState.
 *   - `accounting.ts`:    pure helpers for bigint string arithmetic,
 *     revenue/expenses application, interest accrual, bankruptcy check.
 *   - `valuation.ts`:     pure helper that recomputes a business's valuation
 *     from its balance sheet + profitability (TDD §11 — valuation ≠
 *     liquidity).
 *   - `supply-chain.ts`:  pure helpers that resolve where a business's
 *     inputs come from (upstream / inventory / market) and where its outputs
 *     go (downstream / market / stockpile) — GDD §8.2 vertical integration.
 *   - `production.ts`:    the pure production calculation (`runProduction`)
 *     + the per-step orchestration (`operateBusiness`) used by the
 *     BusinessSystem and the operate-business action handler.
 *   - `actions.ts`:       the eight business action handlers
 *     (purchase/operate/sell-business, take/repay-loan,
 *     hire/lay-off-employees, set-business-status) +
 *     `createBusinessFromDefinition`.
 *
 * The BusinessSystem (`packages/simulation/src/systems/business.ts`) is the
 * only system that touches `state.businesses`; the pure functions take state
 * + params and return new state + events.
 *
 * Tests import these directly (`packages/simulation/test/business.test.ts`)
 * to assert the invariants the GDD and TDD require:
 *   - Production: inputs consumed, output produced at
 *     rate × efficiency × dt; vertical-integration bonus; insufficient
 *     inputs → reduced/zero output.
 *   - Accounting: revenue increases cash, expenses decrease cash (both via
 *     transactions); bankruptcy triggers below threshold; valuation NOT
 *     added to cash.
 *   - Valuation: recomputed periodically (not every tick); assets +
 *     profitability − liabilities; valuation ≠ cash.
 *   - Supply chain: upstream suppliers provide inputs; downstream customers
 *     receive outputs; market fallback.
 *   - Actions: purchase deducts cash + creates business; sell credits
 *     valuation × (1 − haircut); take-loan creates liability + credits cash;
 *     repay-loan reduces liability + debits cash; hire/layoff adjust
 *     employees; set-status changes status.
 *   - Conservation: every revenue/expense/loan/sale is a transaction;
 *     liabilities + cash balance after loan/repay.
 *   - originalTree never touched by any business action.
 *   - Determinism: same (state, ctx) → same (new state, events).
 *   - Purity: input not mutated (freeze test).
 */
export * from './errors.js';
export * from './accounting.js';
export * from './valuation.js';
export * from './supply-chain.js';
export * from './production.js';
export * from './market.js';
export * from './growth-pressure.js';
export * from './actions.js';
