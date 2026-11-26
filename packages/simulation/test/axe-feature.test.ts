/**
 * W-axe feature tests — buy an axe, then cut down the original tree for timber.
 *
 * Covers the three pieces:
 *   - `buy-tool`: debits the cost (sink), credits `inventory.items`, money
 *     conservation holds; rejects unknown tools + insufficient funds.
 *   - `cut-down-tree`: graceful-rejects (no axe / already dead); with an axe,
 *     kills the tree, maxes exploitation (regional trashing), sells the wood
 *     (issuance), axe is NOT consumed, conservation holds.
 *   - `computeTimberYield`: a mature tree yields more than a sapling.
 *
 * Money conservation is asserted after every money-moving action via
 * `conservationDiscrepancy(state, INITIAL_SUPPLY) === 0n` — both flows go
 * through `transfer()` (axe-buy = sink, wood-sell = issuance), so the
 * invariant holds by construction.
 */
import { describe, it, expect } from 'vitest';
import { engine } from '../src/index.js';
import { DEFAULT_GAME_CONFIG } from '../src/initial-state.js';
import { conservationDiscrepancy } from '../src/economy/index.js';
import { computeTimberYield, getSpeciesOrFail } from '../src/biology/index.js';
import {
  type GameState,
  type GameConfig,
  PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
  PROVISIONAL_BIOLOGY_WEAR_DEATH_THRESHOLD,
} from '@capitalist-tree/shared';
import { AXE_TOOL_ID } from '@capitalist-tree/content';

const INITIAL_SUPPLY = '50000';

function cfg(seed: number): GameConfig {
  return { ...DEFAULT_GAME_CONFIG, seed, createdAt: 0 };
}
function freshState(): GameState {
  return engine.initialize(cfg(42));
}

/** Override the original tree to a mature, healthy state (so wood yield > 0). */
function withMatureTree(state: GameState): GameState {
  const species = getSpeciesOrFail(state.originalTree.speciesId);
  return {
    ...state,
    originalTree: {
      ...state.originalTree,
      alive: true,
      ageDays: 365 * 5,
      health: 0.9,
      stress: 0.1,
      wear: 0.5,
      structure: {
        ...state.originalTree.structure,
        height: species.maximumHeight * 0.7,
        trunkDiameter: species.maximumTrunkDiameter * 0.7,
        branchDevelopment: species.maximumBranchDevelopment * 0.7,
        structuralIntegrity: 0.9,
      },
      foliage: { ...state.originalTree.foliage, currentLeaves: 1000 },
    },
  };
}

/** Give the player one axe in inventory. */
function withAxe(state: GameState): GameState {
  return {
    ...state,
    inventory: {
      ...state.inventory,
      items: [...state.inventory.items, { resourceId: AXE_TOOL_ID, quantity: 1 }],
    },
  };
}

/** Drain the player's cash + account balance to `minor` (for the insufficient-funds test). */
function withPlayerCash(state: GameState, minor: string): GameState {
  return {
    ...state,
    economy: {
      ...state.economy,
      accounts: state.economy.accounts.map((a) =>
        a.id === PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID ? { ...a, balance: minor } : a,
      ),
    },
    player: { ...state.player, personalCash: minor },
  };
}

describe('W-axe: buy-tool action', () => {
  it('buys the axe: debits the cost, credits inventory, conservation holds', () => {
    const s = freshState();
    const cashBefore = BigInt(s.player.personalCash);
    const result = engine.executeAction(s, {
      type: 'buy-tool',
      payload: { toolId: AXE_TOOL_ID },
    });
    const after = result.state;
    // Cost debited (axe costs 2000 minor = 20.00 currency).
    expect(BigInt(after.player.personalCash)).toBe(cashBefore - 2000n);
    // Inventory now holds the axe.
    const axe = after.inventory.items.find((i) => i.resourceId === AXE_TOOL_ID);
    expect(axe?.quantity).toBe(1);
    // Money conservation holds (sink: money left circulation).
    expect(conservationDiscrepancy(after, INITIAL_SUPPLY)).toBe(0n);
    // A transaction-recorded event + a tool-purchased notification.
    expect(result.events.some((e) => e.type === 'transaction-recorded')).toBe(true);
    expect(
      result.events.some(
        (e) => e.type === 'notification' && (e as { payload: { code: string } }).payload.code === 'tool-purchased',
      ),
    ).toBe(true);
  });

  it('throws UnknownToolError for an unknown tool id', () => {
    const s = freshState();
    expect(() =>
      engine.executeAction(s, { type: 'buy-tool', payload: { toolId: 'tool:nonexistent' } }),
    ).toThrowError(/Unknown tool/);
  });

  it('throws InsufficientFundsError if the player cannot afford it', () => {
    const s = withPlayerCash(freshState(), '100'); // axe costs 2000.
    expect(() =>
      engine.executeAction(s, { type: 'buy-tool', payload: { toolId: AXE_TOOL_ID } }),
    ).toThrowError(/insufficient/i);
  });
});

describe('W-axe: cut-down-tree action', () => {
  it('graceful-rejects if the player owns no axe (state unchanged)', () => {
    const s = withMatureTree(freshState());
    const result = engine.executeAction(s, {
      type: 'cut-down-tree',
      payload: { treeId: s.originalTree.id, tick: 100 },
    });
    // Tree still alive, no money moved.
    expect(result.state.originalTree.alive).toBe(true);
    expect(result.state.player.personalCash).toBe(s.player.personalCash);
    // A no-axe biology-notification was emitted.
    const notif = result.events.find((e) => e.type === 'biology-notification') as
      | { payload: { code: string } }
      | undefined;
    expect(notif?.payload.code).toBe('no-axe');
  });

  it('graceful-rejects on an already-dead tree', () => {
    const s = withAxe({ ...withMatureTree(freshState()), originalTree: { ...withMatureTree(freshState()).originalTree, alive: false } });
    const result = engine.executeAction(s, {
      type: 'cut-down-tree',
      payload: { treeId: s.originalTree.id, tick: 100 },
    });
    const notif = result.events.find((e) => e.type === 'biology-notification') as
      | { payload: { code: string } }
      | undefined;
    expect(notif?.payload.code).toBe('cut-dead-tree');
  });

  it('with an axe: kills the tree, maxes exploitation, sells wood, axe not consumed, conservation holds', () => {
    const s = withAxe(withMatureTree(freshState()));
    const cashBefore = BigInt(s.player.personalCash);
    const result = engine.executeAction(s, {
      type: 'cut-down-tree',
      payload: { treeId: s.originalTree.id, tick: 100 },
    });
    const after = result.state;

    // The tree is dead + fully exploited.
    expect(after.originalTree.alive).toBe(false);
    expect(after.originalTree.stress).toBe(1);
    expect(after.originalTree.health).toBe(0);
    expect(after.originalTree.wear).toBeGreaterThan(PROVISIONAL_BIOLOGY_WEAR_DEATH_THRESHOLD);
    expect(after.originalTree.damage.some((d) => d.type === 'axed')).toBe(true);
    expect(after.originalTree.foliage.currentLeaves).toBe(0);

    // The wood was sold — player cash increased (mature tree yields > 0).
    expect(BigInt(after.player.personalCash)).toBeGreaterThan(cashBefore);

    // The axe is NOT consumed (reusable).
    const axe = after.inventory.items.find((i) => i.resourceId === AXE_TOOL_ID);
    expect(axe?.quantity).toBe(1);

    // Money conservation holds (issuance: money entered circulation).
    expect(conservationDiscrepancy(after, INITIAL_SUPPLY)).toBe(0n);

    // Events: a transaction-recorded + a tree-cut-down notification.
    expect(result.events.some((e) => e.type === 'transaction-recorded')).toBe(true);
    const notif = result.events.find((e) => e.type === 'biology-notification') as
      | { payload: { code: string } }
      | undefined;
    expect(notif?.payload.code).toBe('tree-cut-down');
  });

  it('a sapling still dies (the axe kills it regardless of yield); yields less than a mature tree', () => {
    // Fresh sapling — small biomassScore → small yield, but the tree still dies.
    const s = withAxe(freshState());
    const result = engine.executeAction(s, {
      type: 'cut-down-tree',
      payload: { treeId: s.originalTree.id, tick: 100 },
    });
    const after = result.state;
    // The tree still dies (the axe kills it regardless of yield).
    expect(after.originalTree.alive).toBe(false);
    // Money conservation holds (issuance for the small yield).
    expect(conservationDiscrepancy(after, INITIAL_SUPPLY)).toBe(0n);

    // The sapling's yield is smaller than a mature tree's yield.
    const species = getSpeciesOrFail(s.originalTree.speciesId);
    const saplingYield = computeTimberYield(s.originalTree, species);
    const matureYield = computeTimberYield(withMatureTree(freshState()).originalTree, species);
    expect(Number(saplingYield.amountMinor)).toBeLessThan(Number(matureYield.amountMinor));
  });
});

describe('W-axe: computeTimberYield', () => {
  it('a mature tree yields more wood than a sapling', () => {
    const s = freshState();
    const species = getSpeciesOrFail(s.originalTree.speciesId);
    const mature = computeTimberYield(withMatureTree(s).originalTree, species);
    const sapling = computeTimberYield(s.originalTree, species);
    expect(Number(mature.amountMinor)).toBeGreaterThan(Number(sapling.amountMinor));
    expect(mature.woodUnits).toBeGreaterThan(sapling.woodUnits);
    expect(mature.qualityFactor).toBeGreaterThan(0);
    expect(mature.qualityFactor).toBeLessThanOrEqual(1);
  });

  it('amountMinor is a non-negative integer string', () => {
    const s = withMatureTree(freshState());
    const species = getSpeciesOrFail(s.originalTree.speciesId);
    const y = computeTimberYield(s.originalTree, species);
    expect(() => BigInt(y.amountMinor)).not.toThrow();
    expect(BigInt(y.amountMinor)).toBeGreaterThanOrEqual(0n);
  });
});
