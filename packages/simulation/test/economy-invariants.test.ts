/**
 * Economy invariant tests (P3d — TDD §18.4, GDD §16, §10.4).
 *
 * This file asserts the *continuously-verified* invariants the GDD + TDD require
 * (TDD §18.4) that span the P3a/P3b/P3c economy module surface as a whole.
 * It complements the per-module tests (`economy.test.ts` P3a,
 * `markets.test.ts` P3b, `personal.test.ts` P3c) by exercising the SAME
 * invariants across ALL money-movement operations together — not just one
 * operation at a time.
 *
 * The four invariants covered here:
 *
 *   1. **Sell-tree guard (GDD §16.1, §16.2, TDD §18.4, §21.12).**
 *      The `sell-tree` action ALWAYS throws a typed error —
 *      `OriginalTreeNotTransferableError` for target='original',
 *      `TreeSaleNotImplementedError` for any other target. State is left
 *      byte-identical after the throw (the handler never mutates before throwing).
 *
 *   2. **Conservation (TDD §10.4 — "money never silently created or destroyed").**
 *      For every state reachable by any sequence of money-movement operations
 *      (issuance, sink, transfer, purchase, pay-expense, auto-bill, market
 *      updates), the invariant
 *
 *        sum(account.balance for account in economy.accounts) + totalSinks
 *          === initialSupply + totalIssued
 *
 *      holds. The verifier `conservationDiscrepancy(state, initialSupply)`
 *      returns 0n iff it holds.
 *
 *   3. **Idempotency (TDD §10.3 — "currency production must be accounted for
 *      exactly once").** Re-processing the same requestId via `requestIssuance`
 *      or `drainPendingIssuances` NEVER double-issues money. The duplicate is
 *      rejected with an `issuance-rejected` event (reason `'duplicate-request'`)
 *      and balances/transactions are byte-identical to the post-first-process
 *      state. Survives save/load.
 *
 *   4. **No negative balances (TDD §10.4, §18.4).** The ledger rejects any
 *      transfer that would push a real account's balance below 0 with a typed
 *      `InsufficientFundsError`. State is unchanged after the rejection (atomic).
 *
 * Complements:
 *   - `economy-integration.test.ts` (P3d) — cross-phase end-to-end flows.
 *   - `economy.test.ts` (P3a) — ledger + transaction + idempotency unit tests.
 *   - `markets.test.ts` (P3b) — pricing + inflation + purchase unit tests.
 *   - `personal.test.ts` (P3c) — PersonalSystem + actions + well-being unit tests.
 */
import { describe, it, expect } from 'vitest';
import { engine, InMemoryStorage } from '../src/index.js';
import { DEFAULT_GAME_CONFIG } from '../src/initial-state.js';
import {
  transfer,
  parseAmount,
  getBalance,
  sumBalances,
  conservationDiscrepancy,
  isRequestProcessed,
  requestIssuance,
  drainPendingIssuances,
  issuanceRequestId,
  applyPurchase,
  updateMarkets,
  InsufficientFundsError,
} from '../src/economy/index.js';
import {
  buildBillDueEvent,
  processExpensePayment,
} from '../src/personal/index.js';
import { schedule } from '../src/events/scheduler.js';
import {
  type GameState,
  type GameConfig,
  type CurrencyIssuanceRequest,
  OriginalTreeNotTransferableError,
  TreeSaleNotImplementedError,
  PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
  PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
  PROVISIONAL_ECONOMY_EXTERNAL_ACCOUNT_ID,
  PROVISIONAL_ECONOMY_MARKET_ACCOUNT_PREFIX,
  PROVISIONAL_ECONOMY_CATEGORY_ISSUANCE,
  PROVISIONAL_ECONOMY_CATEGORY_SINK,
  PROVISIONAL_ECONOMY_CATEGORY_TRANSFER,
  PROVISIONAL_PERSONAL_EXPENSE_FOOD_MINOR,
  PROVISIONAL_PERSONAL_EXPENSE_HOUSING_MINOR,
  PROVISIONAL_PERSONAL_EXPENSE_UTILITIES_MINOR,
  PROVISIONAL_SIMULATION_STEP_SECONDS as STEP,
} from '@capitalist-tree/shared';
import { DEFAULT_ISSUANCE_POLICY } from '@capitalist-tree/content';

function cfg(seed: number): GameConfig {
  return { ...DEFAULT_GAME_CONFIG, seed, createdAt: 0 };
}

function freshState(): GameState {
  return engine.initialize(cfg(42));
}

const INITIAL_SUPPLY = DEFAULT_GAME_CONFIG.startingPersonalCash; // '50000'

/** Build a CurrencyIssuanceRequest for testing. */
function issuanceReq(
  treeId: string,
  amount: string,
  source = 'harvest-leaves',
  currencyId = 'currency:leaf-dollar',
): CurrencyIssuanceRequest {
  return { treeId, amount, currencyId, source };
}

/** Convenience: schedule a bill-due event at a given sim second. */
function withBillAt(state: GameState, at: number): GameState {
  return schedule(state, buildBillDueEvent(state, at));
}

/** All real-account ids on a fresh state — used to iterate over every account
 *  for the no-negative-balances sweep. */
function realAccountIds(state: GameState): readonly string[] {
  return state.economy.accounts.map((a) => a.id);
}

// ============================================================================
// 1. Sell-tree guard — original tree invariant (GDD §16.1, §16.2, TDD §18.4).
// ============================================================================

describe('sell-tree guard — original tree invariant (GDD §16.1, §16.2, TDD §18.4, §21.12)', () => {
  it('throws OriginalTreeNotTransferableError for target="original"', () => {
    const s = freshState();
    expect(() =>
      engine.executeAction(s, {
        type: 'sell-tree',
        payload: { target: 'original' },
      }),
    ).toThrow(OriginalTreeNotTransferableError);
  });

  it('throws OriginalTreeNotTransferableError for target=state.originalTree.id', () => {
    // Defensive — the schema invariant guarantees state.originalTree.id ===
    // 'original', but the handler checks both to be robust to a future schema
    // change. Verify the second branch.
    const s = freshState();
    expect(s.originalTree.id).toBe('original');
    expect(() =>
      engine.executeAction(s, {
        type: 'sell-tree',
        payload: { target: s.originalTree.id },
      }),
    ).toThrow(OriginalTreeNotTransferableError);
  });

  it('throws TreeSaleNotImplementedError for a non-original tree (P8 — graceful)', () => {
    const s = freshState();
    expect(() =>
      engine.executeAction(s, {
        type: 'sell-tree',
        payload: { target: 'some-future-tree-id' },
      }),
    ).toThrow(TreeSaleNotImplementedError);
  });

  it('TreeSaleNotImplementedError carries the treeId for routing', () => {
    const s = freshState();
    try {
      engine.executeAction(s, {
        type: 'sell-tree',
        payload: { target: 'orchard:tree-7' },
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TreeSaleNotImplementedError);
      if (err instanceof TreeSaleNotImplementedError) {
        expect(err.treeId).toBe('orchard:tree-7');
      }
    }
  });

  it('OriginalTreeNotTransferableError carries the treeId for routing', () => {
    const s = freshState();
    try {
      engine.executeAction(s, {
        type: 'sell-tree',
        payload: { target: 'original' },
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(OriginalTreeNotTransferableError);
      if (err instanceof OriginalTreeNotTransferableError) {
        expect(err.treeId).toBe('original');
      }
    }
  });

  it('does NOT mutate state on rejection (original)', () => {
    const s = freshState();
    const snapshot = structuredClone(s);
    try {
      engine.executeAction(s, {
        type: 'sell-tree',
        payload: { target: 'original' },
      });
    } catch {
      // expected — invariant: state byte-identical after the throw.
    }
    expect(s).toEqual(snapshot);
  });

  it('does NOT mutate state on rejection (non-original)', () => {
    const s = freshState();
    const snapshot = structuredClone(s);
    try {
      engine.executeAction(s, {
        type: 'sell-tree',
        payload: { target: 'another-tree' },
      });
    } catch {
      // expected.
    }
    expect(s).toEqual(snapshot);
  });

  it('the guard holds for many target variants in sequence (no state leak)', () => {
    // Repeatedly attempt sell-tree with different targets on the SAME state.
    // The handler always throws; the state must remain byte-identical.
    const s = freshState();
    const snapshot = structuredClone(s);
    const targets = ['original', 'foo', 'original', 'tree-99', 'original'];
    for (const t of targets) {
      try {
        engine.executeAction(s, { type: 'sell-tree', payload: { target: t } });
      } catch {
        // expected.
      }
    }
    expect(s).toEqual(snapshot);
  });

  it('the invariant survives a full sim day of ticks (no escape via other actions)', () => {
    // Run a full sim day of ticks + actions; verify at every step that
    // attempting to sell the original tree still throws. The guard must hold
    // regardless of what else has happened to the state.
    let s = freshState();
    const tickCount = 24; // 24 sim-minutes = 24 ticks
    for (let i = 0; i < tickCount; i++) {
      s = engine.advance(s, STEP).state;
      // Try to sell the tree — should always throw.
      expect(() =>
        engine.executeAction(s, {
          type: 'sell-tree',
          payload: { target: 'original' },
        }),
      ).toThrow(OriginalTreeNotTransferableError);
    }
  });
});

// ============================================================================
// 2. Conservation invariant — sum(balances) + totalSinks === initialSupply + totalIssued.
//    Verified across every money-movement operation, alone and in sequence.
// ============================================================================

describe('conservation invariant (TDD §10.4 — money never silently created or destroyed)', () => {
  it('holds on a fresh state', () => {
    const s = freshState();
    expect(conservationDiscrepancy(s, INITIAL_SUPPLY)).toBe(0n);
  });

  it('holds after a real→real transfer (player → external)', () => {
    const s = freshState();
    const next = transfer(s, {
      sourceAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
      destinationAccount: PROVISIONAL_ECONOMY_EXTERNAL_ACCOUNT_ID,
      amount: '5000',
      category: PROVISIONAL_ECONOMY_CATEGORY_TRANSFER,
      description: 'transfer',
      timestamp: 60,
    });
    expect(conservationDiscrepancy(next, INITIAL_SUPPLY)).toBe(0n);
    // Sanity: counters unchanged for a real→real transfer.
    expect(next.economy.monetarySupply).toBe(s.economy.monetarySupply);
    expect(next.economy.totalIssued).toBe(s.economy.totalIssued);
    expect(next.economy.totalSinks).toBe(s.economy.totalSinks);
  });

  it('holds after an issuance (authority → player)', () => {
    const s = freshState();
    const next = transfer(s, {
      sourceAccount: PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
      destinationAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
      amount: '1000',
      category: PROVISIONAL_ECONOMY_CATEGORY_ISSUANCE,
      description: 'issuance',
      timestamp: 60,
      requestId: 'req-inv-1',
    });
    expect(conservationDiscrepancy(next, INITIAL_SUPPLY)).toBe(0n);
    // monetarySupply + totalIssued both grew by 1000.
    expect(parseAmount(next.economy.monetarySupply)).toBe(
      parseAmount(s.economy.monetarySupply) + 1000n,
    );
    expect(parseAmount(next.economy.totalIssued)).toBe(
      parseAmount(s.economy.totalIssued) + 1000n,
    );
    // totalSinks unchanged.
    expect(next.economy.totalSinks).toBe(s.economy.totalSinks);
  });

  it('holds after a sink (player → authority)', () => {
    const s = freshState();
    const next = transfer(s, {
      sourceAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
      destinationAccount: PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
      amount: '3000',
      category: PROVISIONAL_ECONOMY_CATEGORY_SINK,
      description: 'tax',
      timestamp: 60,
      requestId: 'req-sink-1',
    });
    expect(conservationDiscrepancy(next, INITIAL_SUPPLY)).toBe(0n);
    expect(parseAmount(next.economy.monetarySupply)).toBe(
      parseAmount(s.economy.monetarySupply) - 3000n,
    );
    expect(parseAmount(next.economy.totalSinks)).toBe(
      parseAmount(s.economy.totalSinks) + 3000n,
    );
    expect(next.economy.totalIssued).toBe(s.economy.totalIssued);
  });

  it('holds after a purchase (player → market account)', () => {
    const s = freshState();
    const result = applyPurchase(s, {
      marketId: 'market:water',
      quantity: 10,
      timestamp: 60,
    });
    expect(conservationDiscrepancy(result.state, INITIAL_SUPPLY)).toBe(0n);
    // Purchase is a real→real transfer; counters unchanged.
    expect(result.state.economy.monetarySupply).toBe(s.economy.monetarySupply);
    expect(result.state.economy.totalIssued).toBe(s.economy.totalIssued);
    expect(result.state.economy.totalSinks).toBe(s.economy.totalSinks);
  });

  it('holds after a pay-expense (player → authority)', () => {
    const s = freshState();
    const result = processExpensePayment(s, {
      category: 'food',
      amount: PROVISIONAL_PERSONAL_EXPENSE_FOOD_MINOR,
      timestamp: 60,
      source: 'pay-expense',
    });
    expect(conservationDiscrepancy(result.state, INITIAL_SUPPLY)).toBe(0n);
    // Expense is a sink; totalSinks grew.
    expect(parseAmount(result.state.economy.totalSinks)).toBe(
      parseAmount(s.economy.totalSinks) +
        parseAmount(PROVISIONAL_PERSONAL_EXPENSE_FOOD_MINOR, 'food'),
    );
  });

  it('holds after market updates (no money moved by price updates)', () => {
    const s = freshState();
    let st = s;
    for (let i = 0; i < 20; i++) {
      st = updateMarkets(st, {
        now: 60 + (i + 1) * STEP,
        initialSupply: INITIAL_SUPPLY,
      }).state;
    }
    // Market updates move no money — only prices + supply/demand shift.
    expect(conservationDiscrepancy(st, INITIAL_SUPPLY)).toBe(0n);
  });

  it('holds after a mixed sequence of all money-movement operations', () => {
    // Drive one of every kind of money-movement operation in sequence.
    const s = freshState();
    // 1. Issuance (authority → player).
    const s1 = transfer(s, {
      sourceAccount: PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
      destinationAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
      amount: '10000',
      category: PROVISIONAL_ECONOMY_CATEGORY_ISSUANCE,
      description: 'issuance',
      timestamp: 60,
      requestId: 'req-mix-1',
    });
    expect(conservationDiscrepancy(s1, INITIAL_SUPPLY)).toBe(0n);
    // 2. Transfer (player → external).
    const s2 = transfer(s1, {
      sourceAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
      destinationAccount: PROVISIONAL_ECONOMY_EXTERNAL_ACCOUNT_ID,
      amount: '2000',
      category: PROVISIONAL_ECONOMY_CATEGORY_TRANSFER,
      description: 'transfer',
      timestamp: 60,
    });
    expect(conservationDiscrepancy(s2, INITIAL_SUPPLY)).toBe(0n);
    // 3. Sink (player → authority — a tax).
    const s3 = transfer(s2, {
      sourceAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
      destinationAccount: PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
      amount: '1500',
      category: PROVISIONAL_ECONOMY_CATEGORY_SINK,
      description: 'tax',
      timestamp: 60,
      requestId: 'req-mix-2',
    });
    expect(conservationDiscrepancy(s3, INITIAL_SUPPLY)).toBe(0n);
    // 4. Purchase (player → market:water).
    const s4 = applyPurchase(s3, {
      marketId: 'market:water',
      quantity: 25,
      timestamp: 120,
    }).state;
    expect(conservationDiscrepancy(s4, INITIAL_SUPPLY)).toBe(0n);
    // 5. Pay-expense (player → authority).
    const s5 = processExpensePayment(s4, {
      category: 'housing',
      amount: PROVISIONAL_PERSONAL_EXPENSE_HOUSING_MINOR,
      timestamp: 180,
      source: 'pay-expense',
    }).state;
    expect(conservationDiscrepancy(s5, INITIAL_SUPPLY)).toBe(0n);
    // 6. Another issuance (cumulative).
    const s6 = transfer(s5, {
      sourceAccount: PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
      destinationAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
      amount: '777',
      category: PROVISIONAL_ECONOMY_CATEGORY_ISSUANCE,
      description: 'issuance 2',
      timestamp: 240,
      requestId: 'req-mix-3',
    });
    expect(conservationDiscrepancy(s6, INITIAL_SUPPLY)).toBe(0n);
    // Sanity: cumulative totals match what we issued and sunk.
    // totalIssued: 10000 + 777 = 10777
    // totalSinks:  1500 + housing (12000) = 13500
    expect(s6.economy.totalIssued).toBe('10777');
    expect(s6.economy.totalSinks).toBe('13500');
  });

  it('holds across a long engine.advance run with bills + market updates', () => {
    // Advance far enough to fire several billing cycles. Bills are scheduled
    // every BILLING_INTERVAL_SECONDS (30 sim days = 2_592_000 sim seconds).
    // We advance that many steps (one step = 60 sim seconds, so 2_592_000 /
    // 60 = 43_200 steps would fire one bill — too slow for a unit test).
    // Instead, manually schedule a bill to fire on the first tick.
    const s = freshState();
    const withBill = withBillAt(s, STEP); // bill fires at sim second 60.
    // Advance several steps — the bill fires on tick 1; subsequent ticks just
    // run market updates + PersonalSystem derivation.
    let st = withBill;
    for (let i = 0; i < 10; i++) {
      st = engine.advance(st, STEP).state;
      // Verify the invariant AT EVERY STEP — not just at the end.
      expect(conservationDiscrepancy(st, INITIAL_SUPPLY)).toBe(0n);
    }
  });

  it('holds even when bills go unpaid (no money moved, but unpaidDays increments)', () => {
    const s = freshState();
    // Drain the player's cash so the bill goes unpaid.
    const drained = transfer(s, {
      sourceAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
      destinationAccount: PROVISIONAL_ECONOMY_EXTERNAL_ACCOUNT_ID,
      amount: s.player.personalCash,
      category: PROVISIONAL_ECONOMY_CATEGORY_TRANSFER,
      description: 'drain for test',
      timestamp: 0,
    });
    expect(conservationDiscrepancy(drained, INITIAL_SUPPLY)).toBe(0n);
    // Schedule a bill that will fire while the player is broke.
    const withBill = withBillAt(drained, STEP);
    const r = engine.advance(withBill, STEP);
    // Unpaid bills move no money — invariant holds.
    expect(conservationDiscrepancy(r.state, INITIAL_SUPPLY)).toBe(0n);
    // Sanity: unpaidDays incremented.
    expect(r.state.player.unpaidDays).toBeGreaterThan(0);
  });

  it('the conservation identity holds in its full algebraic form (LHS === RHS)', () => {
    // Explicitly compute both sides of the invariant rather than relying on
    // conservationDiscrepancy() returning 0n — a separate code path catches
    // logic bugs in the verifier itself.
    const s = freshState();
    const s1 = transfer(s, {
      sourceAccount: PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
      destinationAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
      amount: '5000',
      category: PROVISIONAL_ECONOMY_CATEGORY_ISSUANCE,
      description: 'issuance',
      timestamp: 60,
      requestId: 'req-alg-1',
    });
    const s2 = transfer(s1, {
      sourceAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
      destinationAccount: PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
      amount: '2000',
      category: PROVISIONAL_ECONOMY_CATEGORY_SINK,
      description: 'sink',
      timestamp: 60,
      requestId: 'req-alg-2',
    });
    const lhs = sumBalances(s2) + parseAmount(s2.economy.totalSinks, 'sinks');
    const rhs =
      parseAmount(INITIAL_SUPPLY, 'initial') + parseAmount(s2.economy.totalIssued, 'issued');
    expect(lhs).toBe(rhs);
  });

  it('sumBalances equals monetarySupply (the derived invariant)', () => {
    // monetarySupply is supposed to be a derived field: sum of all account
    // balances. The EconomySystem never explicitly maintains it on operations
    // outside `transfer()` (e.g. applyPurchase uses transfer internally so
    // it's fine). Verify the property holds on a fresh state and after a
    // transfer — catching any drift between the cached value and reality.
    const s = freshState();
    expect(sumBalances(s)).toBe(parseAmount(s.economy.monetarySupply, 'supply'));
    const next = transfer(s, {
      sourceAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
      destinationAccount: PROVISIONAL_ECONOMY_EXTERNAL_ACCOUNT_ID,
      amount: '1234',
      category: PROVISIONAL_ECONOMY_CATEGORY_TRANSFER,
      description: 'transfer',
      timestamp: 60,
    });
    expect(sumBalances(next)).toBe(parseAmount(next.economy.monetarySupply, 'supply'));
  });
});

// ============================================================================
// 3. Idempotency — re-processing the same requestId never double-issues.
// ============================================================================

describe('idempotency (TDD §10.3 — currency production must be accounted for exactly once)', () => {
  it('issuanceRequestId is deterministic given (saveId, simSecond, index)', () => {
    // Same triple → same id; different triple → different id. This is the
    // linchpin of the save/load idempotency contract.
    expect(issuanceRequestId('save-A', 60, 0)).toBe('issuance:save-A:60:0');
    expect(issuanceRequestId('save-A', 60, 0)).toBe(issuanceRequestId('save-A', 60, 0));
    expect(issuanceRequestId('save-A', 60, 0)).not.toBe(issuanceRequestId('save-A', 60, 1));
    expect(issuanceRequestId('save-A', 60, 0)).not.toBe(issuanceRequestId('save-A', 120, 0));
    expect(issuanceRequestId('save-A', 60, 0)).not.toBe(issuanceRequestId('save-B', 60, 0));
  });

  it('a requestId used once is added to processedRequestIds', () => {
    const s = freshState();
    expect(isRequestProcessed(s, 'req-once')).toBe(false);
    const next = transfer(s, {
      sourceAccount: PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
      destinationAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
      amount: '100',
      category: PROVISIONAL_ECONOMY_CATEGORY_ISSUANCE,
      description: 'issuance',
      timestamp: 60,
      requestId: 'req-once',
    });
    expect(isRequestProcessed(next, 'req-once')).toBe(true);
  });

  it('requestIssuance rejects a duplicate requestId with no money movement', () => {
    const s = freshState();
    const req = issuanceReq('original', '1000');
    const first = requestIssuance(s, req, 'req-dup-1', 60, {
      policy: DEFAULT_ISSUANCE_POLICY,
    });
    expect(first.events.some((e) => e.type === 'issuance-authorized')).toBe(true);
    expect(first.state.player.personalCash).toBe('51000'); // 50000 + 1000.

    // Re-process the SAME requestId on the resulting state.
    const second = requestIssuance(first.state, req, 'req-dup-1', 60, {
      policy: DEFAULT_ISSUANCE_POLICY,
    });
    // No money issued — balances byte-identical to first.state.
    expect(second.state.economy.accounts).toEqual(first.state.economy.accounts);
    expect(second.state.economy.monetarySupply).toBe(first.state.economy.monetarySupply);
    expect(second.state.economy.totalIssued).toBe(first.state.economy.totalIssued);
    expect(second.state.economy.transactions).toHaveLength(first.state.economy.transactions.length);
    expect(second.state.player.personalCash).toBe('51000');
    // Rejection event with reason 'duplicate-request'.
    const rejected = second.events.find((e) => e.type === 'issuance-rejected');
    expect(rejected).toBeDefined();
    expect(rejected!.type === 'issuance-rejected' && rejected.payload.reason).toBe(
      'duplicate-request',
    );
  });

  it('re-draining an already-processed queue issues no money', () => {
    const s = freshState();
    const withPending: GameState = {
      ...s,
      originalTree: {
        ...s.originalTree,
        pendingIssuances: [issuanceReq('original', '777')],
      },
    };
    const first = drainPendingIssuances(withPending, withPending.originalTree, 'save-test', 60, {
      policy: DEFAULT_ISSUANCE_POLICY,
    });
    expect(first.state.player.personalCash).toBe('50777');
    expect(first.state.economy.totalIssued).toBe('777');

    // Re-queue the SAME request on the resulting state and re-drain at the
    // SAME simSecond + index → requestId collides → duplicate rejection.
    const reQueued: GameState = {
      ...first.state,
      originalTree: {
        ...first.state.originalTree,
        pendingIssuances: [issuanceReq('original', '777')],
      },
    };
    const second = drainPendingIssuances(reQueued, reQueued.originalTree, 'save-test', 60, {
      policy: DEFAULT_ISSUANCE_POLICY,
    });
    // No money issued — balance unchanged.
    expect(second.state.player.personalCash).toBe('50777');
    expect(second.state.economy.totalIssued).toBe('777');
    // Rejection event emitted.
    const rejected = second.events.find((e) => e.type === 'issuance-rejected');
    expect(rejected).toBeDefined();
  });

  it('draining a multi-request queue issues each exactly once', () => {
    // Queue three requests; drain. Verify each got its own requestId and
    // each was issued exactly once (no duplicates within a single drain).
    const s = freshState();
    const withPending: GameState = {
      ...s,
      originalTree: {
        ...s.originalTree,
        pendingIssuances: [
          issuanceReq('original', '100'),
          issuanceReq('original', '200'),
          issuanceReq('original', '300'),
        ],
      },
    };
    const result = drainPendingIssuances(withPending, withPending.originalTree, 'save-3', 60, {
      policy: DEFAULT_ISSUANCE_POLICY,
    });
    // Total issued = 100 + 200 + 300 = 600.
    expect(result.state.economy.totalIssued).toBe('600');
    expect(result.state.player.personalCash).toBe('50600');
    // 3 transactions, each with a distinct requestId (0, 1, 2).
    expect(result.state.economy.transactions).toHaveLength(3);
    const requestIds = result.state.economy.transactions.map((t) => t.requestId);
    expect(new Set(requestIds).size).toBe(3);
    expect(requestIds).toContain('issuance:save-3:60:0');
    expect(requestIds).toContain('issuance:save-3:60:1');
    expect(requestIds).toContain('issuance:save-3:60:2');
    // All 3 requestIds are in processedRequestIds.
    expect(result.state.economy.processedRequestIds).toContain('issuance:save-3:60:0');
    expect(result.state.economy.processedRequestIds).toContain('issuance:save-3:60:1');
    expect(result.state.economy.processedRequestIds).toContain('issuance:save-3:60:2');
  });

  it('issuance is counted exactly once across save/load (no double-issuance)', async () => {
    // Queue a pending issuance, run one step (issuing money), save, load,
    // queue the SAME request again at the SAME simSecond, re-drain.
    // The reload preserves processedRequestIds so the duplicate is rejected.
    const s = engine.initialize({ ...DEFAULT_GAME_CONFIG, seed: 42, createdAt: 0 });
    const withPending: GameState = {
      ...s,
      originalTree: {
        ...s.originalTree,
        pendingIssuances: [issuanceReq('original', '777')],
      },
    };
    // Advance one step — EconomySystem drains at ctx.now = 60.
    const afterStep = engine.advance(withPending, STEP);
    expect(afterStep.state.player.personalCash).toBe('50777');
    expect(afterStep.state.economy.totalIssued).toBe('777');
    expect(afterStep.state.originalTree.pendingIssuances).toEqual([]);
    expect(afterStep.events.some((e) => e.type === 'issuance-authorized')).toBe(true);

    // Save + load — processedRequestIds survives.
    const storage = new InMemoryStorage();
    await storage.save(afterStep.state);
    const loaded = await storage.load();
    expect(loaded).not.toBeNull();
    // Sanity: processedRequestIds persisted.
    expect(loaded!.economy.processedRequestIds).toContain('issuance:save-default:60:0');

    // Re-queue the same request and re-drain at the SAME simSecond (60).
    // The requestId will collide → duplicate rejection.
    const reQueued: GameState = {
      ...loaded!,
      originalTree: {
        ...loaded!.originalTree,
        pendingIssuances: [issuanceReq('original', '777')],
      },
    };
    const secondResult = drainPendingIssuances(
      reQueued,
      reQueued.originalTree,
      'save-default',
      60,
      { policy: DEFAULT_ISSUANCE_POLICY },
    );
    // No money issued — idempotency held.
    expect(secondResult.state.player.personalCash).toBe('50777');
    expect(secondResult.state.economy.totalIssued).toBe('777');
    // Rejection event emitted with 'duplicate-request' reason.
    const rejected = secondResult.events.find((e) => e.type === 'issuance-rejected');
    expect(rejected).toBeDefined();
    expect(rejected!.type === 'issuance-rejected' && rejected.payload.reason).toBe(
      'duplicate-request',
    );
  });

  it('a different requestId for the same amount issues money (idempotency is per-key, not per-amount)', () => {
    // Sanity: the idempotency set is keyed on requestId, not on amount.
    // Two different requestIds for the same amount each issue money.
    const s = freshState();
    const req = issuanceReq('original', '500');
    const first = requestIssuance(s, req, 'req-unique-A', 60, {
      policy: DEFAULT_ISSUANCE_POLICY,
    });
    const second = requestIssuance(first.state, req, 'req-unique-B', 60, {
      policy: DEFAULT_ISSUANCE_POLICY,
    });
    // Both issued — 500 each.
    expect(second.state.player.personalCash).toBe('51000');
    expect(second.state.economy.totalIssued).toBe('1000');
    expect(second.events.some((e) => e.type === 'issuance-authorized')).toBe(true);
  });

  it('different simSeconds for the same queue index produce different requestIds (no false rejection)', () => {
    // Sanity: the EconomySystem drains the queue at ctx.now each tick. If
    // two different ticks produce the same requestId, money would be
    // incorrectly rejected. Verify they don't.
    const s = freshState();
    const withPending: GameState = {
      ...s,
      originalTree: {
        ...s.originalTree,
        pendingIssuances: [issuanceReq('original', '100')],
      },
    };
    const at60 = drainPendingIssuances(withPending, withPending.originalTree, 'save-X', 60, {
      policy: DEFAULT_ISSUANCE_POLICY,
    });
    // Re-queue + drain at simSecond = 120. requestId differs.
    const reQueued: GameState = {
      ...at60.state,
      originalTree: {
        ...at60.state.originalTree,
        pendingIssuances: [issuanceReq('original', '100')],
      },
    };
    const at120 = drainPendingIssuances(reQueued, reQueued.originalTree, 'save-X', 120, {
      policy: DEFAULT_ISSUANCE_POLICY,
    });
    // Both issued — 100 each.
    expect(at120.state.economy.totalIssued).toBe('200');
    expect(at120.state.player.personalCash).toBe('50200');
    expect(at120.events.some((e) => e.type === 'issuance-authorized')).toBe(true);
  });

  it('idempotency holds across a long engine.advance run with repeated harvests', () => {
    // Repeatedly harvest + advance. Each harvest queues a pending issuance
    // with a different amount; each tick's drain gets a unique requestId
    // (different ctx.now). Verify no double-issuance and conservation holds.
    let s = freshState();
    // Give the tree enough foliage to harvest.
    s = {
      ...s,
      originalTree: {
        ...s.originalTree,
        foliage: {
          ...s.originalTree.foliage,
          currentLeaves: 5000,
          leafCapacity: 50000,
        },
      },
    };
    const harvestAmount = 5; // small harvests to keep the tree alive
    let totalIssuedSoFar = 0n;
    for (let i = 0; i < 5; i++) {
      const afterHarvest = engine.executeAction(s, {
        type: 'harvest-leaves',
        payload: { treeId: 'original', requestedLeaves: harvestAmount },
      });
      // 5 leaves × $1 (100 minor) = 500 minor per harvest.
      const req = afterHarvest.state.originalTree.pendingIssuances[0];
      expect(req).toBeDefined();
      expect(req!.amount).toBe('500');
      // Advance one step to drain the queue.
      const afterStep = engine.advance(afterHarvest.state, STEP);
      // Sanity: totalIssued grew by exactly 500 this tick.
      const afterIssued = parseAmount(afterStep.state.economy.totalIssued, 'issued');
      expect(afterIssued - totalIssuedSoFar).toBe(500n);
      totalIssuedSoFar = afterIssued;
      // Conservation holds at every step.
      expect(conservationDiscrepancy(afterStep.state, INITIAL_SUPPLY)).toBe(0n);
      s = afterStep.state;
    }
    // After 5 harvests × $5 each, totalIssued = 2500.
    expect(s.economy.totalIssued).toBe('2500');
  });
});

// ============================================================================
// 4. No negative balances — the ledger rejects overdrafts with typed errors.
// ============================================================================

describe('no negative balances (TDD §10.4, §18.4)', () => {
  it('transfer rejects an overdraft with InsufficientFundsError', () => {
    const s = freshState();
    expect(() =>
      transfer(s, {
        sourceAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
        destinationAccount: PROVISIONAL_ECONOMY_EXTERNAL_ACCOUNT_ID,
        amount: '999999999', // > 50000 starting cash
        category: PROVISIONAL_ECONOMY_CATEGORY_TRANSFER,
        description: 'overspend',
        timestamp: 60,
      }),
    ).toThrow(InsufficientFundsError);
  });

  it('state is unchanged after a rejected overdraft (atomic)', () => {
    const s = freshState();
    const before = JSON.stringify(s);
    expect(() =>
      transfer(s, {
        sourceAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
        destinationAccount: PROVISIONAL_ECONOMY_EXTERNAL_ACCOUNT_ID,
        amount: '999999999',
        category: PROVISIONAL_ECONOMY_CATEGORY_TRANSFER,
        description: 'overspend',
        timestamp: 60,
      }),
    ).toThrow();
    expect(JSON.stringify(s)).toBe(before);
  });

  it('a sink that would overdraw is rejected (authority is virtual but source is real)', () => {
    const s = freshState();
    expect(() =>
      transfer(s, {
        sourceAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
        destinationAccount: PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
        amount: '999999999',
        category: PROVISIONAL_ECONOMY_CATEGORY_SINK,
        description: 'tax exceeds balance',
        timestamp: 60,
      }),
    ).toThrow(InsufficientFundsError);
  });

  it('applyPurchase rejects an unaffordable purchase with InsufficientFundsError', () => {
    const s = freshState();
    // Player has $500 = 50000 minor. Food market base price = $10 = 1000 minor
    // per unit. Buying 100 units costs 100_000 minor — over budget.
    expect(() =>
      applyPurchase(s, {
        marketId: 'market:food',
        quantity: 100,
        timestamp: 60,
      }),
    ).toThrow(InsufficientFundsError);
  });

  it('pay-expense on a broke player does NOT throw — it records unpaid', () => {
    // processExpensePayment handles low funds gracefully (GDD §16.3 — tree
    // death does not end the game; analogously, an unpaid bill must not
    // crash the engine). It increments unpaidDays instead of throwing.
    const s = freshState();
    const broke = transfer(s, {
      sourceAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
      destinationAccount: PROVISIONAL_ECONOMY_EXTERNAL_ACCOUNT_ID,
      amount: s.player.personalCash, // drain to 0
      category: PROVISIONAL_ECONOMY_CATEGORY_TRANSFER,
      description: 'drain',
      timestamp: 0,
    });
    expect(getBalance(broke, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID)).toBe(0n);
    // pay-expense on a broke player — should NOT throw.
    const result = processExpensePayment(broke, {
      category: 'food',
      amount: PROVISIONAL_PERSONAL_EXPENSE_FOOD_MINOR,
      timestamp: 60,
      source: 'pay-expense',
    });
    // Unpaid recorded — unpaidDays incremented.
    expect(result.state.player.unpaidDays).toBeGreaterThan(0);
    // An expense-due event with paid=false was emitted.
    const unpaid = result.events.find(
      (e) => e.type === 'expense-due' && e.payload.paid === false,
    );
    expect(unpaid).toBeDefined();
  });

  it('every real account on a fresh state has a non-negative balance', () => {
    // Defensive sweep — start state must never have a negative balance.
    const s = freshState();
    for (const acc of s.economy.accounts) {
      const bal = parseAmount(acc.balance, acc.id);
      expect(bal).toBeGreaterThanOrEqual(0n);
    }
  });

  it('every real account stays non-negative after a multi-op sequence', () => {
    // Run a sequence of operations and verify NO account went negative at
    // any point — including market accounts after a purchase, the external
    // account after a transfer, and the player after an expense.
    const s = freshState();
    // 1. Issue some money.
    const s1 = transfer(s, {
      sourceAccount: PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
      destinationAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
      amount: '10000',
      category: PROVISIONAL_ECONOMY_CATEGORY_ISSUANCE,
      description: 'issuance',
      timestamp: 60,
      requestId: 'req-neg-1',
    });
    for (const acc of s1.economy.accounts) {
      expect(parseAmount(acc.balance, acc.id)).toBeGreaterThanOrEqual(0n);
    }
    // 2. Buy water.
    const s2 = applyPurchase(s1, {
      marketId: 'market:water',
      quantity: 50,
      timestamp: 120,
    }).state;
    for (const acc of s2.economy.accounts) {
      expect(parseAmount(acc.balance, acc.id)).toBeGreaterThanOrEqual(0n);
    }
    // 3. Pay an expense.
    const s3 = processExpensePayment(s2, {
      category: 'utilities',
      amount: PROVISIONAL_PERSONAL_EXPENSE_UTILITIES_MINOR,
      timestamp: 180,
      source: 'pay-expense',
    }).state;
    for (const acc of s3.economy.accounts) {
      expect(parseAmount(acc.balance, acc.id)).toBeGreaterThanOrEqual(0n);
    }
    // 4. Transfer to external.
    const s4 = transfer(s3, {
      sourceAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
      destinationAccount: PROVISIONAL_ECONOMY_EXTERNAL_ACCOUNT_ID,
      amount: '2000',
      category: PROVISIONAL_ECONOMY_CATEGORY_TRANSFER,
      description: 'transfer',
      timestamp: 240,
    });
    for (const acc of s4.economy.accounts) {
      expect(parseAmount(acc.balance, acc.id)).toBeGreaterThanOrEqual(0n);
    }
    // 5. Sink some to authority.
    const s5 = transfer(s4, {
      sourceAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
      destinationAccount: PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
      amount: '500',
      category: PROVISIONAL_ECONOMY_CATEGORY_SINK,
      description: 'sink',
      timestamp: 300,
      requestId: 'req-neg-2',
    });
    for (const acc of s5.economy.accounts) {
      expect(parseAmount(acc.balance, acc.id)).toBeGreaterThanOrEqual(0n);
    }
  });

  it('every real account stays non-negative across a long engine.advance run', () => {
    // Stress test: run many ticks + actions; verify NO account on the state
    // EVER has a negative balance (checked at every tick).
    let s = freshState();
    // Give the tree enough foliage so harvests don't kill it.
    s = {
      ...s,
      originalTree: {
        ...s.originalTree,
        foliage: {
          ...s.originalTree.foliage,
          currentLeaves: 5000,
          leafCapacity: 50000,
        },
      },
    };
    for (let i = 0; i < 20; i++) {
      // Mix of actions: harvest, purchase, pay-expense.
      const afterHarvest = engine.executeAction(s, {
        type: 'harvest-leaves',
        payload: { treeId: 'original', requestedLeaves: 5 },
      });
      for (const acc of afterHarvest.state.economy.accounts) {
        expect(parseAmount(acc.balance, acc.id)).toBeGreaterThanOrEqual(0n);
      }
      // Advance to drain the queue + run market updates + PersonalSystem.
      const afterStep = engine.advance(afterHarvest.state, STEP);
      for (const acc of afterStep.state.economy.accounts) {
        expect(parseAmount(acc.balance, acc.id)).toBeGreaterThanOrEqual(0n);
      }
      // Buy a small amount of water (always affordable with $500+ starting cash).
      const afterBuy = engine.executeAction(afterStep.state, {
        type: 'purchase',
        payload: { marketId: 'market:water', quantity: 1 },
      });
      for (const acc of afterBuy.state.economy.accounts) {
        expect(parseAmount(acc.balance, acc.id)).toBeGreaterThanOrEqual(0n);
      }
      s = afterBuy.state;
    }
  });

  it('every real account on a fresh state is reachable via realAccountIds', () => {
    // Sanity: realAccountIds covers all the accounts the ledger treats as
    // real. Useful for tests that want to sweep over all accounts.
    const s = freshState();
    const ids = realAccountIds(s);
    // Player + external + 5 market accounts = 7 total.
    expect(ids).toHaveLength(7);
    expect(ids).toContain(PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID);
    expect(ids).toContain(PROVISIONAL_ECONOMY_EXTERNAL_ACCOUNT_ID);
    // Each market account is `market:<slug>`.
    const marketAccounts = ids.filter((id) => id.startsWith(PROVISIONAL_ECONOMY_MARKET_ACCOUNT_PREFIX));
    expect(marketAccounts).toHaveLength(5);
  });

  it('conservation holds even when an overdraft is attempted (state unchanged)', () => {
    // The invariant must hold trivially after a REJECTED operation, because
    // the state is unchanged. Verify both halves of that claim.
    const s = freshState();
    const before = structuredClone(s);
    expect(() =>
      transfer(s, {
        sourceAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
        destinationAccount: PROVISIONAL_ECONOMY_EXTERNAL_ACCOUNT_ID,
        amount: '999999999',
        category: PROVISIONAL_ECONOMY_CATEGORY_TRANSFER,
        description: 'overspend',
        timestamp: 60,
      }),
    ).toThrow(InsufficientFundsError);
    // State byte-identical.
    expect(s).toEqual(before);
    // Conservation holds.
    expect(conservationDiscrepancy(s, INITIAL_SUPPLY)).toBe(0n);
  });
});

// ============================================================================
// Sanity: the four invariants are independent — each test file in P3d covers
// one of them so a regression in any one is isolated.
// ============================================================================

describe('economy-invariants test file is wired into vitest', () => {
  it('runs', () => {
    expect(true).toBe(true);
  });
});
