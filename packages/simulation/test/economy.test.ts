/**
 * Economy unit + integration tests (TDD §18.1, §18.4).
 *
 * Pure-function + system tests asserting the economy invariants the GDD
 * and TDD require (TDD §10.1-§10.4, §18.1):
 *
 *   - Monetary representation: bigint minor units throughout, stored as
 *     strings for safe JSON round-trip (TDD §10.1).
 *   - Ledger + transaction system (TDD §10.4):
 *       * Transfers correct (source debited, destination credited, txn recorded).
 *       * Invalid transactions rejected (insufficient funds, unknown account,
 *         negative amount, non-bigint).
 *       * Idempotency: same requestId never double-processes.
 *       * Money never silently created or destroyed.
 *   - Central monetary authority (TDD §10.3):
 *       * CurrencyIssuanceRequest consumption: drains pendingIssuances,
 *         credits player, records transaction.
 *       * Idempotency across save/load: same requestId never double-issues.
 *       * Distinguishes leaves on tree / issued / in circulation / player-held.
 *   - Conservation invariant:
 *       sum(account.balance) + totalSinks === initialSupply + totalIssued.
 *   - Determinism: same pendingIssuances + same state → same final state +
 *     transaction log (TDD §18.3).
 *   - Migration v4 -> v5: backfills accounts from player.personalCash.
 *
 * These complement the engine integration tests (engine.test.ts,
 * biology-system.test.ts); they exercise the economy module directly +
 * through engine.advance / engine.executeAction('harvest-leaves').
 */
import { describe, it, expect } from 'vitest';
import {
  engine,
  InMemoryStorage,
} from '../src/index.js';
import { DEFAULT_GAME_CONFIG } from '../src/initial-state.js';
import {
  transfer,
  validateAmount,
  parseAmount,
  getBalance,
  findAccount,
  getAccount,
  sumBalances,
  conservationDiscrepancy,
  isRequestProcessed,
  markRequestProcessed,
  transactionId,
  registerAccount,
  requestIssuance,
  drainPendingIssuances,
  issuanceRequestId,
  InsufficientFundsError,
  UnknownAccountError,
  InvalidAmountError,
  SelfTransferError,
} from '../src/economy/index.js';
import { DEFAULT_ISSUANCE_POLICY, authorizeIssuance } from '@capitalist-tree/content';
import {
  type GameState,
  type GameConfig,
  type CurrencyIssuanceRequest,
  PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
  PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
  PROVISIONAL_ECONOMY_EXTERNAL_ACCOUNT_ID,
  PROVISIONAL_ECONOMY_CATEGORY_ISSUANCE,
  PROVISIONAL_ECONOMY_CATEGORY_SINK,
  PROVISIONAL_ECONOMY_CATEGORY_TRANSFER,
  PROVISIONAL_SIMULATION_STEP_SECONDS as STEP,
  CURRENT_SCHEMA_VERSION,
  migrations,
  serialize,
  deserialize,
} from '@capitalist-tree/shared';

function cfg(seed: number): GameConfig {
  return { ...DEFAULT_GAME_CONFIG, seed, createdAt: 0 };
}

function freshState(): GameState {
  return engine.initialize(cfg(42));
}

/** Build a CurrencyIssuanceRequest for testing. */
function issuanceReq(
  treeId: string,
  amount: string,
  source = 'harvest-leaves',
  currencyId = 'currency:leaf-dollar',
): CurrencyIssuanceRequest {
  return { treeId, amount, currencyId, source };
}

const INITIAL_SUPPLY = '50000';

describe('monetary representation (TDD §10.1)', () => {
  it('all monetary fields on EconomyState use bigint-as-string', () => {
    const s = freshState();
    expect(typeof s.economy.monetarySupply).toBe('string');
    expect(typeof s.economy.totalIssued).toBe('string');
    expect(typeof s.economy.totalSinks).toBe('string');
    for (const acc of s.economy.accounts) {
      expect(typeof acc.balance).toBe('string');
    }
  });

  it('TransactionRecord.amount is a string (bigint-as-string)', () => {
    const s = freshState();
    const next = transfer(s, {
      sourceAccount: PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
      destinationAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
      amount: '100',
      category: PROVISIONAL_ECONOMY_CATEGORY_ISSUANCE,
      description: 'test',
      timestamp: 60,
      requestId: 'req-1',
    });
    const record = next.economy.transactions[next.economy.transactions.length - 1]!;
    expect(typeof record.amount).toBe('string');
    expect(record.amount).toBe('100');
  });

  it('player.personalCash and accounts[player:personal].balance are in sync at start', () => {
    const s = freshState();
    const playerAccount = findAccount(s, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID);
    expect(playerAccount?.balance).toBe(s.player.personalCash);
  });
});

describe('ledger — transfers (TDD §10.4)', () => {
  it('transfers correctly: source debited, destination credited, txn recorded', () => {
    const s = freshState();
    const before = getBalance(s, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID);
    const next = transfer(s, {
      sourceAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
      destinationAccount: PROVISIONAL_ECONOMY_EXTERNAL_ACCOUNT_ID,
      amount: '5000',
      category: PROVISIONAL_ECONOMY_CATEGORY_TRANSFER,
      description: 'test transfer',
      timestamp: 60,
    });
    expect(getBalance(next, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID)).toBe(before - 5000n);
    expect(getBalance(next, PROVISIONAL_ECONOMY_EXTERNAL_ACCOUNT_ID)).toBe(5000n);
    expect(next.economy.transactions).toHaveLength(1);
    const record = next.economy.transactions[0]!;
    expect(record.sourceAccount).toBe(PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID);
    expect(record.destinationAccount).toBe(PROVISIONAL_ECONOMY_EXTERNAL_ACCOUNT_ID);
    expect(record.amount).toBe('5000');
    expect(record.category).toBe(PROVISIONAL_ECONOMY_CATEGORY_TRANSFER);
  });

  it('issuance credits destination without debiting a real account (authority is virtual)', () => {
    const s = freshState();
    const before = getBalance(s, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID);
    const next = transfer(s, {
      sourceAccount: PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
      destinationAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
      amount: '1000',
      category: PROVISIONAL_ECONOMY_CATEGORY_ISSUANCE,
      description: 'issuance',
      timestamp: 60,
      requestId: 'req-issuance-1',
    });
    expect(getBalance(next, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID)).toBe(before + 1000n);
    // monetarySupply + totalIssued both incremented
    expect(parseAmount(next.economy.monetarySupply)).toBe(parseAmount(s.economy.monetarySupply) + 1000n);
    expect(parseAmount(next.economy.totalIssued)).toBe(parseAmount(s.economy.totalIssued) + 1000n);
    // totalSinks unchanged
    expect(next.economy.totalSinks).toBe(s.economy.totalSinks);
    // requestId tagged on the record AND added to processedRequestIds
    const record = next.economy.transactions[next.economy.transactions.length - 1]!;
    expect(record.requestId).toBe('req-issuance-1');
    expect(isRequestProcessed(next, 'req-issuance-1')).toBe(true);
  });

  it('sink debits source without crediting a real account (authority is virtual)', () => {
    const s = freshState();
    const before = getBalance(s, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID);
    const next = transfer(s, {
      sourceAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
      destinationAccount: PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
      amount: '3000',
      category: PROVISIONAL_ECONOMY_CATEGORY_SINK,
      description: 'tax',
      timestamp: 60,
      requestId: 'req-sink-1',
    });
    expect(getBalance(next, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID)).toBe(before - 3000n);
    // monetarySupply decremented, totalSinks incremented
    expect(parseAmount(next.economy.monetarySupply)).toBe(parseAmount(s.economy.monetarySupply) - 3000n);
    expect(parseAmount(next.economy.totalSinks)).toBe(parseAmount(s.economy.totalSinks) + 3000n);
    // totalIssued unchanged
    expect(next.economy.totalIssued).toBe(s.economy.totalIssued);
  });

  it('regular transfer does NOT change monetarySupply / totalIssued / totalSinks', () => {
    const s = freshState();
    const next = transfer(s, {
      sourceAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
      destinationAccount: PROVISIONAL_ECONOMY_EXTERNAL_ACCOUNT_ID,
      amount: '1234',
      category: PROVISIONAL_ECONOMY_CATEGORY_TRANSFER,
      description: 'transfer',
      timestamp: 60,
    });
    expect(next.economy.monetarySupply).toBe(s.economy.monetarySupply);
    expect(next.economy.totalIssued).toBe(s.economy.totalIssued);
    expect(next.economy.totalSinks).toBe(s.economy.totalSinks);
  });
});

describe('ledger — invalid transactions rejected (TDD §10.4)', () => {
  it('rejects insufficient funds', () => {
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

  it('rejects unknown source account', () => {
    const s = freshState();
    expect(() =>
      transfer(s, {
        sourceAccount: 'account:does-not-exist',
        destinationAccount: PROVISIONAL_ECONOMY_EXTERNAL_ACCOUNT_ID,
        amount: '100',
        category: PROVISIONAL_ECONOMY_CATEGORY_TRANSFER,
        description: 'unknown source',
        timestamp: 60,
      }),
    ).toThrow(UnknownAccountError);
  });

  it('rejects unknown destination account', () => {
    const s = freshState();
    expect(() =>
      transfer(s, {
        sourceAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
        destinationAccount: 'account:does-not-exist',
        amount: '100',
        category: PROVISIONAL_ECONOMY_CATEGORY_TRANSFER,
        description: 'unknown dest',
        timestamp: 60,
      }),
    ).toThrow(UnknownAccountError);
  });

  it('rejects zero amount', () => {
    const s = freshState();
    expect(() =>
      transfer(s, {
        sourceAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
        destinationAccount: PROVISIONAL_ECONOMY_EXTERNAL_ACCOUNT_ID,
        amount: '0',
        category: PROVISIONAL_ECONOMY_CATEGORY_TRANSFER,
        description: 'zero',
        timestamp: 60,
      }),
    ).toThrow(InvalidAmountError);
  });

  it('rejects negative amount', () => {
    const s = freshState();
    expect(() =>
      transfer(s, {
        sourceAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
        destinationAccount: PROVISIONAL_ECONOMY_EXTERNAL_ACCOUNT_ID,
        amount: '-100',
        category: PROVISIONAL_ECONOMY_CATEGORY_TRANSFER,
        description: 'negative',
        timestamp: 60,
      }),
    ).toThrow(InvalidAmountError);
  });

  it('rejects non-bigint amount string', () => {
    const s = freshState();
    expect(() =>
      transfer(s, {
        sourceAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
        destinationAccount: PROVISIONAL_ECONOMY_EXTERNAL_ACCOUNT_ID,
        amount: 'not-a-bigint',
        category: PROVISIONAL_ECONOMY_CATEGORY_TRANSFER,
        description: 'malformed',
        timestamp: 60,
      }),
    ).toThrow(InvalidAmountError);
  });

  it('rejects self-transfer (source === destination)', () => {
    const s = freshState();
    expect(() =>
      transfer(s, {
        sourceAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
        destinationAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
        amount: '100',
        category: PROVISIONAL_ECONOMY_CATEGORY_TRANSFER,
        description: 'self',
        timestamp: 60,
      }),
    ).toThrow(SelfTransferError);
  });

  it('state is unchanged after a rejected transfer (atomic)', () => {
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
});

describe('ledger — idempotency (TDD §10.3)', () => {
  it('isRequestProcessed / markRequestProcessed round-trip', () => {
    const s = freshState();
    expect(isRequestProcessed(s, 'req-X')).toBe(false);
    const marked = markRequestProcessed(s, 'req-X');
    expect(isRequestProcessed(marked, 'req-X')).toBe(true);
    // Idempotent: marking again returns equivalent state.
    const marked2 = markRequestProcessed(marked, 'req-X');
    expect(marked2).toEqual(marked);
  });

  it('a requestId used in transfer is recorded in processedRequestIds', () => {
    const s = freshState();
    const next = transfer(s, {
      sourceAccount: PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
      destinationAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
      amount: '100',
      category: PROVISIONAL_ECONOMY_CATEGORY_ISSUANCE,
      description: 'issuance',
      timestamp: 60,
      requestId: 'req-Y',
    });
    expect(isRequestProcessed(next, 'req-Y')).toBe(true);
  });

  it('transactionId is deterministic given (timestamp, counter)', () => {
    expect(transactionId(60, 0)).toBe('txn:60:0');
    expect(transactionId(120, 3)).toBe('txn:120:3');
  });
});

describe('authority — CurrencyIssuanceRequest consumption (TDD §10.2, §10.3)', () => {
  it('requestIssuance credits destination and records transaction', () => {
    const s = freshState();
    const req = issuanceReq('original', '1000');
    const result = requestIssuance(s, req, 'req-issue-1', 60, {
      policy: DEFAULT_ISSUANCE_POLICY,
    });
    // Destination credited.
    const player = findAccount(result.state, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID);
    expect(player?.balance).toBe('51000');
    // player.personalCash mirror updated.
    expect(result.state.player.personalCash).toBe('51000');
    // Transaction recorded with requestId + category=issuance.
    const record = result.state.economy.transactions[result.state.economy.transactions.length - 1]!;
    expect(record.category).toBe(PROVISIONAL_ECONOMY_CATEGORY_ISSUANCE);
    expect(record.requestId).toBe('req-issue-1');
    expect(record.sourceAccount).toBe(PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID);
    expect(record.destinationAccount).toBe(PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID);
    // Events emitted.
    const types = result.events.map((e) => e.type);
    expect(types).toContain('issuance-authorized');
    expect(types).toContain('transaction-recorded');
  });

  it('issuanceRequestId is deterministic given (saveId, simSecond, index)', () => {
    expect(issuanceRequestId('save-1', 60, 0)).toBe('issuance:save-1:60:0');
    expect(issuanceRequestId('save-1', 60, 0)).toBe(issuanceRequestId('save-1', 60, 0));
    expect(issuanceRequestId('save-1', 60, 0)).not.toBe(issuanceRequestId('save-1', 60, 1));
    expect(issuanceRequestId('save-1', 60, 0)).not.toBe(issuanceRequestId('save-2', 60, 0));
  });

  it('requestIssuance rejects duplicate requestId with no money movement', () => {
    const s = freshState();
    const req = issuanceReq('original', '1000');
    const first = requestIssuance(s, req, 'req-dup', 60, {
      policy: DEFAULT_ISSUANCE_POLICY,
    });
    expect(first.events.some((e) => e.type === 'issuance-authorized')).toBe(true);

    // Re-process the same requestId on the resulting state — should reject.
    const second = requestIssuance(first.state, req, 'req-dup', 60, {
      policy: DEFAULT_ISSUANCE_POLICY,
    });
    // No money movement — balances unchanged.
    expect(second.state.economy.accounts).toEqual(first.state.economy.accounts);
    expect(second.state.economy.monetarySupply).toBe(first.state.economy.monetarySupply);
    expect(second.state.economy.totalIssued).toBe(first.state.economy.totalIssued);
    expect(second.state.economy.transactions).toHaveLength(first.state.economy.transactions.length);
    // Rejection event emitted.
    const rejected = second.events.find((e) => e.type === 'issuance-rejected');
    expect(rejected).toBeDefined();
    expect(rejected!.type === 'issuance-rejected' && rejected.payload.reason).toBe('duplicate-request');
  });

  it('requestIssuance rejects invalid amount', () => {
    const s = freshState();
    const req = issuanceReq('original', '0');
    const result = requestIssuance(s, req, 'req-zero', 60, {
      policy: DEFAULT_ISSUANCE_POLICY,
    });
    expect(result.state).toBe(s); // unchanged
    const rejected = result.events.find((e) => e.type === 'issuance-rejected');
    expect(rejected).toBeDefined();
    expect(rejected!.type === 'issuance-rejected' && rejected.payload.reason).toBe('invalid-amount');
  });

  it('requestIssuance rejects malformed amount', () => {
    const s = freshState();
    const req = issuanceReq('original', 'not-a-bigint');
    const result = requestIssuance(s, req, 'req-bad', 60, {
      policy: DEFAULT_ISSUANCE_POLICY,
    });
    expect(result.state).toBe(s);
    const rejected = result.events.find((e) => e.type === 'issuance-rejected');
    expect(rejected).toBeDefined();
    expect(rejected!.type === 'issuance-rejected' && rejected.payload.reason).toBe('invalid-amount');
  });

  it('drainPendingIssuances processes the queue and clears it', () => {
    const s = freshState();
    // Manually queue two pending issuances on the original tree.
    const withPending: GameState = {
      ...s,
      originalTree: {
        ...s.originalTree,
        pendingIssuances: [
          issuanceReq('original', '100'),
          issuanceReq('original', '200'),
        ],
      },
    };
    const result = drainPendingIssuances(
      withPending,
      withPending.originalTree,
      'save-test',
      60,
      { policy: DEFAULT_ISSUANCE_POLICY },
    );
    // Queue cleared.
    expect(result.state.originalTree.pendingIssuances).toEqual([]);
    // Player credited by 100 + 200 = 300.
    const player = findAccount(result.state, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID);
    expect(player?.balance).toBe('50300');
    expect(result.state.player.personalCash).toBe('50300');
    // Two transactions recorded.
    expect(result.state.economy.transactions).toHaveLength(2);
    // 2 authorized + 2 transaction-recorded events.
    const authorized = result.events.filter((e) => e.type === 'issuance-authorized');
    const recorded = result.events.filter((e) => e.type === 'transaction-recorded');
    expect(authorized).toHaveLength(2);
    expect(recorded).toHaveLength(2);
  });

  it('drainPendingIssuances is idempotent: re-draining an already-processed queue issues no money', () => {
    const s = freshState();
    const withPending: GameState = {
      ...s,
      originalTree: {
        ...s.originalTree,
        pendingIssuances: [issuanceReq('original', '500')],
      },
    };
    const first = drainPendingIssuances(withPending, withPending.originalTree, 'save-test', 60, {
      policy: DEFAULT_ISSUANCE_POLICY,
    });
    expect(first.state.player.personalCash).toBe('50500');
    // Re-queue the same request on the resulting state and re-drain at the
    // SAME simSecond + index. The requestId will collide → duplicate rejection.
    const reQueued: GameState = {
      ...first.state,
      originalTree: {
        ...first.state.originalTree,
        pendingIssuances: [issuanceReq('original', '500')],
      },
    };
    const second = drainPendingIssuances(reQueued, reQueued.originalTree, 'save-test', 60, {
      policy: DEFAULT_ISSUANCE_POLICY,
    });
    // No money issued — balance unchanged.
    expect(second.state.player.personalCash).toBe('50500');
    expect(second.state.economy.totalIssued).toBe(first.state.economy.totalIssued);
    // Rejection event emitted.
    const rejected = second.events.find((e) => e.type === 'issuance-rejected');
    expect(rejected).toBeDefined();
  });

  it('issuance counted exactly once across save/load (idempotency)', async () => {
    // Queue a pending issuance, run one step (issuing money), save, load,
    // queue the SAME request again at the SAME simSecond, run a step.
    // The reload preserves processedRequestIds so the duplicate is rejected.
    const s = engine.initialize({ ...DEFAULT_GAME_CONFIG, seed: 42, createdAt: 0 });
    const withPending: GameState = {
      ...s,
      originalTree: {
        ...s.originalTree,
        pendingIssuances: [issuanceReq('original', '777')],
      },
    };
    // Advance one step so EconomySystem drains the queue at ctx.now = 60.
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

    // Re-queue the same request and re-advance at the same effective simSecond.
    // Note: after advancing one step, clock.elapsedSeconds === 60. The next
    // advance will run EconomySystem at ctx.now = 120 (60 + STEP). So we
    // need to construct the requestId for simSecond=60 to collide — i.e.
    // process it at the SAME simSecond as before. We simulate this by
    // calling drainPendingIssuances directly with simSecond=60.
    const reQueued: GameState = {
      ...loaded!,
      originalTree: {
        ...loaded!.originalTree,
        pendingIssuances: [issuanceReq('original', '777')],
      },
    };
    const secondResult = drainPendingIssuances(reQueued, reQueued.originalTree, 'save-default', 60, {
      policy: DEFAULT_ISSUANCE_POLICY,
    });
    // No money issued — idempotency held.
    expect(secondResult.state.player.personalCash).toBe('50777');
    expect(secondResult.state.economy.totalIssued).toBe('777');
    const rejected = secondResult.events.find((e) => e.type === 'issuance-rejected');
    expect(rejected).toBeDefined();
  });
});

describe('authority — policy enforcement (TDD §10.3, GDD §6.2)', () => {
  it('authorizeIssuance accepts a valid request under default policy', () => {
    const req = issuanceReq('original', '1000');
    const result = authorizeIssuance(DEFAULT_ISSUANCE_POLICY, req, { totalIssued: '0' });
    expect(result.authorized).toBe(true);
  });

  it('authorizeIssuance rejects invalid amount', () => {
    const req = issuanceReq('original', '0');
    const result = authorizeIssuance(DEFAULT_ISSUANCE_POLICY, req, { totalIssued: '0' });
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe('invalid-amount');
  });

  it('authorizeIssuance rejects per-request cap exceeded', () => {
    const policy = {
      id: 'test-cap',
      maxPerRequest: '100',
      maxTotal: null,
      issuanceFeeFraction: 0,
    };
    const req = issuanceReq('original', '101');
    const result = authorizeIssuance(policy, req, { totalIssued: '0' });
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe('per-request-limit-exceeded');
  });

  it('authorizeIssuance rejects cumulative cap exceeded', () => {
    const policy = {
      id: 'test-cap',
      maxPerRequest: null,
      maxTotal: '1000',
      issuanceFeeFraction: 0,
    };
    const req = issuanceReq('original', '500');
    const result = authorizeIssuance(policy, req, { totalIssued: '700' });
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe('cumulative-limit-exceeded');
  });

  it('requestIssuance enforces per-request cap from policy', () => {
    const s = freshState();
    const req = issuanceReq('original', '5000');
    const result = requestIssuance(s, req, 'req-cap', 60, {
      policy: {
        maxPerRequest: '1000',
        maxTotal: null,
        issuanceFeeFraction: 0,
      },
    });
    expect(result.state).toBe(s); // unchanged
    const rejected = result.events.find((e) => e.type === 'issuance-rejected');
    expect(rejected).toBeDefined();
    expect(rejected!.type === 'issuance-rejected' && rejected.payload.reason).toBe('per-request-limit-exceeded');
  });

  it('requestIssuance enforces cumulative cap from policy', () => {
    const s = freshState();
    // Issue some money first to push totalIssued up.
    const afterFirst = requestIssuance(s, issuanceReq('original', '700'), 'req-A', 60, {
      policy: { maxPerRequest: null, maxTotal: '1000', issuanceFeeFraction: 0 },
    });
    // Now try to issue more — should be rejected.
    const result = requestIssuance(afterFirst.state, issuanceReq('original', '500'), 'req-B', 60, {
      policy: { maxPerRequest: null, maxTotal: '1000', issuanceFeeFraction: 0 },
    });
    const rejected = result.events.find((e) => e.type === 'issuance-rejected');
    expect(rejected).toBeDefined();
    expect(rejected!.type === 'issuance-rejected' && rejected.payload.reason).toBe('cumulative-limit-exceeded');
  });
});

describe('conservation invariant (TDD §10.4 — no silent money destruction)', () => {
  it('holds on a fresh state', () => {
    const s = freshState();
    expect(conservationDiscrepancy(s, INITIAL_SUPPLY)).toBe(0n);
  });

  it('holds after a transfer', () => {
    const s = freshState();
    const next = transfer(s, {
      sourceAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
      destinationAccount: PROVISIONAL_ECONOMY_EXTERNAL_ACCOUNT_ID,
      amount: '12345',
      category: PROVISIONAL_ECONOMY_CATEGORY_TRANSFER,
      description: 'transfer',
      timestamp: 60,
    });
    expect(conservationDiscrepancy(next, INITIAL_SUPPLY)).toBe(0n);
  });

  it('holds after an issuance', () => {
    const s = freshState();
    const result = requestIssuance(s, issuanceReq('original', '1000'), 'req-c-1', 60, {
      policy: DEFAULT_ISSUANCE_POLICY,
    });
    expect(conservationDiscrepancy(result.state, INITIAL_SUPPLY)).toBe(0n);
  });

  it('holds after a sink', () => {
    const s = freshState();
    const next = transfer(s, {
      sourceAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
      destinationAccount: PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
      amount: '3000',
      category: PROVISIONAL_ECONOMY_CATEGORY_SINK,
      description: 'tax',
      timestamp: 60,
    });
    expect(conservationDiscrepancy(next, INITIAL_SUPPLY)).toBe(0n);
  });

  it('holds after mixed operations', () => {
    const s = freshState();
    // Issue some money.
    const s1 = requestIssuance(s, issuanceReq('original', '5000'), 'req-m-1', 60, {
      policy: DEFAULT_ISSUANCE_POLICY,
    }).state;
    // Transfer player -> external.
    const s2 = transfer(s1, {
      sourceAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
      destinationAccount: PROVISIONAL_ECONOMY_EXTERNAL_ACCOUNT_ID,
      amount: '2000',
      category: PROVISIONAL_ECONOMY_CATEGORY_TRANSFER,
      description: 'transfer',
      timestamp: 60,
    });
    // Sink some money (tax).
    const s3 = transfer(s2, {
      sourceAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
      destinationAccount: PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
      amount: '1000',
      category: PROVISIONAL_ECONOMY_CATEGORY_SINK,
      description: 'tax',
      timestamp: 60,
    });
    // Issue more money.
    const s4 = requestIssuance(s3, issuanceReq('original', '300'), 'req-m-2', 60, {
      policy: DEFAULT_ISSUANCE_POLICY,
    }).state;

    expect(conservationDiscrepancy(s4, INITIAL_SUPPLY)).toBe(0n);
    // Sanity: totalIssued = 5000 + 300 = 5300, totalSinks = 1000.
    expect(s4.economy.totalIssued).toBe('5300');
    expect(s4.economy.totalSinks).toBe('1000');
  });
});

describe('determinism (TDD §18.3)', () => {
  it('same pendingIssuances + same state → same final state + transaction log', () => {
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
    const a = drainPendingIssuances(withPending, withPending.originalTree, 'save-default', 60, {
      policy: DEFAULT_ISSUANCE_POLICY,
    });
    const b = drainPendingIssuances(withPending, withPending.originalTree, 'save-default', 60, {
      policy: DEFAULT_ISSUANCE_POLICY,
    });
    expect(a.state).toEqual(b.state);
    expect(a.events).toEqual(b.events);
  });

  it('different saveId → different requestIds → different processedRequestIds', () => {
    const s = freshState();
    const withPending: GameState = {
      ...s,
      originalTree: {
        ...s.originalTree,
        pendingIssuances: [issuanceReq('original', '100')],
      },
    };
    const a = drainPendingIssuances(withPending, withPending.originalTree, 'save-A', 60, {
      policy: DEFAULT_ISSUANCE_POLICY,
    });
    const b = drainPendingIssuances(withPending, withPending.originalTree, 'save-B', 60, {
      policy: DEFAULT_ISSUANCE_POLICY,
    });
    // Final balances the same (same amount issued) but processedRequestIds differ.
    expect(a.state.player.personalCash).toBe(b.state.player.personalCash);
    expect(a.state.economy.processedRequestIds).not.toEqual(b.state.economy.processedRequestIds);
  });
});

describe('EconomySystem — end-to-end via engine (TDD §18.2)', () => {
  it('engine.advance drains pendingIssuances and credits the player', () => {
    const s = engine.initialize(cfg(7));
    const withPending: GameState = {
      ...s,
      originalTree: {
        ...s.originalTree,
        pendingIssuances: [issuanceReq('original', '1234')],
      },
    };
    const result = engine.advance(withPending, STEP);
    expect(result.state.originalTree.pendingIssuances).toEqual([]);
    expect(result.state.player.personalCash).toBe('51234');
    const player = findAccount(result.state, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID);
    expect(player?.balance).toBe('51234');
    // EconomySystem emitted events.
    const types = result.events.map((e) => e.type);
    expect(types).toContain('issuance-authorized');
    expect(types).toContain('transaction-recorded');
    // Conservation invariant holds.
    expect(conservationDiscrepancy(result.state, INITIAL_SUPPLY)).toBe(0n);
  });

  it('engine.advance with no pendingIssuances emits no economy events', () => {
    const s = engine.initialize(cfg(7));
    const result = engine.advance(s, STEP);
    const types = result.events.map((e) => e.type);
    expect(types).not.toContain('issuance-authorized');
    expect(types).not.toContain('transaction-recorded');
    expect(types).not.toContain('issuance-rejected');
  });

  it('harvest-leaves action queues issuance; subsequent advance drains it', () => {
    const s = engine.initialize(cfg(7));
    // Set the tree to a state where it has enough foliage to harvest.
    const ready: GameState = {
      ...s,
      originalTree: {
        ...s.originalTree,
        foliage: {
          ...s.originalTree.foliage,
          currentLeaves: 1000,
          leafCapacity: 5000,
        },
      },
    };
    // Execute the harvest-leaves action — queues a CurrencyIssuanceRequest.
    const afterHarvest = engine.executeAction(ready, {
      type: 'harvest-leaves',
      payload: { treeId: 'original', requestedLeaves: 10 },
    });
    expect(afterHarvest.state.originalTree.pendingIssuances).toHaveLength(1);
    const req = afterHarvest.state.originalTree.pendingIssuances[0]!;
    // 10 leaves * $1 denomination (100 minor units) = 1000 minor units.
    expect(req.amount).toBe('1000');

    // Advance one step — EconomySystem drains the queue.
    const afterStep = engine.advance(afterHarvest.state, STEP);
    expect(afterStep.state.originalTree.pendingIssuances).toEqual([]);
    // Player credited 1000 minor units.
    expect(afterStep.state.player.personalCash).toBe('51000');
    const player = findAccount(afterStep.state, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID);
    expect(player?.balance).toBe('51000');
    // Transaction recorded.
    expect(afterStep.state.economy.transactions).toHaveLength(1);
    expect(afterStep.state.economy.transactions[0]!.category).toBe(PROVISIONAL_ECONOMY_CATEGORY_ISSUANCE);
    // Conservation invariant holds.
    expect(conservationDiscrepancy(afterStep.state, INITIAL_SUPPLY)).toBe(0n);
  });

  it('does not mutate the input state', () => {
    const s = engine.initialize(cfg(7));
    const withPending: GameState = {
      ...s,
      originalTree: {
        ...s.originalTree,
        pendingIssuances: [issuanceReq('original', '100')],
      },
    };
    const snapshot = structuredClone(withPending);
    engine.advance(withPending, STEP);
    expect(withPending).toEqual(snapshot);
  });
});

describe('migration v4 -> v5 (P3a)', () => {
  it('backfills accounts from player.personalCash when missing', () => {
    // Construct a v4-like state by stripping the new fields.
    const v5 = freshState();
    const v4Like = {
      ...v5,
      economy: {
        monetarySupply: v5.economy.monetarySupply,
        inflationRate: v5.economy.inflationRate,
        interestRate: v5.economy.interestRate,
        monetaryAuthority: v5.economy.monetaryAuthority,
        markets: v5.economy.markets,
        transactions: v5.economy.transactions,
        // strip accounts, processedRequestIds, totalIssued, totalSinks
      },
    } as unknown as GameState;
    const migrated = migrations.migrate(v4Like, 4, CURRENT_SCHEMA_VERSION);
    expect(migrated.economy.accounts).toHaveLength(2);
    const player = migrated.economy.accounts.find(
      (a) => a.id === PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
    );
    expect(player?.balance).toBe(v5.player.personalCash);
    const external = migrated.economy.accounts.find(
      (a) => a.id === PROVISIONAL_ECONOMY_EXTERNAL_ACCOUNT_ID,
    );
    expect(external?.balance).toBe('0');
    expect(Array.isArray(migrated.economy.processedRequestIds)).toBe(true);
    expect(migrated.economy.processedRequestIds).toEqual([]);
    expect(migrated.economy.totalIssued).toBe('0');
    expect(migrated.economy.totalSinks).toBe('0');
  });

  it('is idempotent on a current-version save', () => {
    const v = freshState();
    const out = migrations.migrate(v, CURRENT_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION);
    // Identity — no copy when from === target.
    expect(out).toBe(v);
  });

  it('v5 -> v6 migration backfills economy.inflationIndex + markets[*].lastPriceUpdate (P3b)', () => {
    // Construct a v5-like state by stripping the P3b additions.
    const v6 = freshState();
    const v5Like = {
      ...v6,
      economy: {
        ...v6.economy,
        // Strip inflationIndex (P3b) and lastPriceUpdate on each market.
        inflationIndex: undefined,
        markets: v6.economy.markets.map((m) => {
          const { lastPriceUpdate: _lpu, ...rest } = m;
          void _lpu;
          return rest;
        }),
      },
    } as unknown as GameState;
    const migrated = migrations.migrate(v5Like, 5, CURRENT_SCHEMA_VERSION);
    // inflationIndex backfilled to 1.0.
    expect(migrated.economy.inflationIndex).toBe(1.0);
    // Every market has lastPriceUpdate = 0.
    for (const m of migrated.economy.markets) {
      expect(m.lastPriceUpdate).toBe(0);
    }
    // Conservation invariant still holds.
    expect(conservationDiscrepancy(migrated, INITIAL_SUPPLY)).toBe(0n);
  });

  it('v5 -> v6 migration is idempotent on a v6 save (no field changes)', () => {
    const v6 = freshState();
    const out = migrations.migrate(v6, 6, CURRENT_SCHEMA_VERSION);
    // Migration runs but applies no patches (all fields already present).
    // Result is deeply equal to the input.
    expect(out).toEqual(v6);
  });

  it('deserialize round-trips a v5 state', () => {
    const v5 = freshState();
    const env = serialize(v5);
    const back = deserialize(env);
    expect(back).toEqual(v5);
  });

  it('deserialize migrates a v4 envelope to v5', () => {
    const v5 = freshState();
    // Strip the new economy fields to simulate a v4 save.
    const v4Like = {
      ...v5,
      economy: {
        monetarySupply: v5.economy.monetarySupply,
        inflationRate: v5.economy.inflationRate,
        interestRate: v5.economy.interestRate,
        monetaryAuthority: v5.economy.monetaryAuthority,
        markets: v5.economy.markets,
        transactions: v5.economy.transactions,
      },
    } as unknown as GameState;
    const env = { schemaVersion: 4, state: v4Like };
    const back = deserialize(env);
    expect(back.economy.accounts).toHaveLength(2);
    expect(back.economy.processedRequestIds).toEqual([]);
    expect(back.economy.totalIssued).toBe('0');
    expect(back.economy.totalSinks).toBe('0');
    // Conservation invariant holds post-migration.
    expect(conservationDiscrepancy(back, INITIAL_SUPPLY)).toBe(0n);
  });
});

describe('account registry', () => {
  it('registerAccount adds a new account', () => {
    const s = freshState();
    const next = registerAccount(s, {
      id: 'external:supplier:abc',
      type: 'external',
      label: 'Supplier ABC',
      balance: '0',
    });
    expect(findAccount(next, 'external:supplier:abc')).toBeDefined();
  });

  it('registerAccount throws on duplicate id', () => {
    const s = freshState();
    expect(() =>
      registerAccount(s, {
        id: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
        type: 'player',
        label: 'dup',
        balance: '0',
      }),
    ).toThrow(UnknownAccountError);
  });
});

describe('ledger — helpers (TDD §10.4)', () => {
  it('getBalance returns 0n for the virtual authority', () => {
    const s = freshState();
    expect(getBalance(s, PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID)).toBe(0n);
  });

  it('getAccount throws for the virtual authority', () => {
    const s = freshState();
    expect(() => getAccount(s, PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID)).toThrow(UnknownAccountError);
  });

  it('sumBalances returns the total of all account balances', () => {
    const s = freshState();
    expect(sumBalances(s)).toBe(50000n);
  });

  it('parseAmount parses a bigint string', () => {
    expect(parseAmount('12345')).toBe(12345n);
    expect(parseAmount('0')).toBe(0n);
  });

  it('parseAmount throws on empty / non-bigint', () => {
    expect(() => parseAmount('')).toThrow(InvalidAmountError);
    expect(() => parseAmount('abc')).toThrow(InvalidAmountError);
  });

  it('validateAmount rejects non-positive', () => {
    expect(() => validateAmount('0')).toThrow(InvalidAmountError);
    expect(() => validateAmount('-5')).toThrow(InvalidAmountError);
    expect(validateAmount('100')).toBe(100n);
  });
});
