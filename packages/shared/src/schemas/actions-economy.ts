/**
 * Economy-related GameAction variants (TDD §10.4, GDD §6).
 *
 * P3a: NO actions yet. The ledger + transaction system + CurrencyIssuanceRequest
 * consumption is built as system-internal logic — the only money movement in
 * P3a is the authority's issuance driven by `tree.pendingIssuances`, which
 * does not require a player action (it's the system's per-tick job).
 *
 * P3c will add player actions here, including:
 *   - `purchase`: buy a good from a market (debits `player:personal`, credits
 *     `external:supplier`, records a `purchase` transaction).
 *   - `pay-expense`: pay a living expense (debits `player:personal`, sinks
 *     to the authority, records an `expense`/`sink` transaction).
 *   - `sell-tree`: P3d guard — refuses to sell the original tree
 *     (GDD §16.1/16.2).
 *
 * HOW TO EXTEND (P3c): add a new variant with a unique `type` literal and
 * register a handler in `packages/simulation/src/actions/handlers.ts`. The
 * handler signature is `(state, action) => { state, events }`. Keep actions
 * pure — never mutate input state. Reject unknown action types with
 * `UnknownActionError` (handled centrally by `executeAction`).
 *
 * File exists as a placeholder so the directory structure matches the
 * eventual P3c layout. It exports nothing yet — when P3c adds the first
 * action schema here, also re-export it from `actions.ts`.
 */
export {};
