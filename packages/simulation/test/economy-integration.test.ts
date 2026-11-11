/**
 * Cross-phase economy integration tests (P3d — TDD §18.2, §18.4, GDD §6, §7, §8).
 *
 * This file is referenced in docs/economy.md §11 (test inventory) as the P3d
 * deliverable that exercises end-to-end flows spanning the harvest → issuance →
 * purchase → apply → pay-expense chain. It complements `economy-invariants.test.ts`
 * (named-invariant sweeps) by walking the *full player loop* the GDD §3.1
 * describes, asserting at every step that:
 *
 *   - Money is conserved (`sum(balances) + totalSinks === initialSupply + totalIssued`).
 *   - Player cash never goes negative (overdrafts rejected atomically).
 *   - Harvested leaves produce exactly-once issuance (no double-issue across
 *     save/load).
 *   - Purchases debit the player + credit the market (real→real transfer).
 *   - Apply-water / apply-fertilizer mutate soil state (P2) without touching
 *     money (the purchase already paid for the resource).
 *   - Personal expenses sink money to the authority (real→authority transfer).
 *   - Inflation erodes real purchasing power when the money supply grows.
 *   - Same seed + same actions → byte-identical final state (determinism).
 *
 * Conservation is verified at every step (not just at the end) to catch any
 * silent money creation/destruction at the moment it occurs.
 *
 * References:
 *   - GDD §3.1 (initial gameplay loop), §6 (currency + authority), §7 (personal
 *     expenses + well-being), §8 (markets + inflation), §16.1/16.2 (original
 *     tree invariants).
 *   - TDD §10 (economy), §11 (personal), §14 (persistence), §18.2/§18.3/§18.4
 *     (integration / determinism / invariants).
 *   - docs/economy.md §3.2 (idempotency across save/load) + §11 (test inventory).
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
  drainPendingIssuances,
} from '../src/economy/index.js';
import { buildBillDueEvent } from '../src/personal/index.js';
import { schedule } from '../src/events/scheduler.js';
import { WHITE_OAK } from '@capitalist-tree/content';
import {
  type GameState,
  type GameConfig,
  type CurrencyIssuanceRequest,
  PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
  PROVISIONAL_ECONOMY_MARKET_ACCOUNT_PREFIX,
  PROVISIONAL_ECONOMY_CATEGORY_ISSUANCE,
  PROVISIONAL_ECONOMY_CATEGORY_EXPENSE,
  PROVISIONAL_PERSONAL_BILLING_INTERVAL_SECONDS,
  PROVISIONAL_RESOURCE_SOIL_NUTRIENT_CAPACITY,
  PROVISIONAL_RESOURCE_SOIL_WATER_CAPACITY,
  PROVISIONAL_SIMULATION_STEP_SECONDS as STEP,
} from '@capitalist-tree/shared';

function cfg(seed: number): GameConfig {
  return { ...DEFAULT_GAME_CONFIG, seed, createdAt: 0 };
}

function freshState(): GameState {
  return engine.initialize(cfg(42));
}

const INITIAL_SUPPLY = DEFAULT_GAME_CONFIG.startingPersonalCash; // '50000'

/** Grow a sapling into a mature tree so harvests don't kill it. Mirrors the
 *  helper in biology-system.test.ts so the harvest→issuance chain has real
 *  foliage to work with. */
function makeMature(state: GameState): GameState {
  const next = structuredClone(state);
  const tree = next.originalTree;
  tree.ageDays = WHITE_OAK.matureAgeDays + 1000;
  tree.structure.height = WHITE_OAK.maximumHeight * 0.95;
  tree.structure.trunkDiameter = WHITE_OAK.maximumTrunkDiameter * 0.95;
  tree.structure.branchDevelopment = WHITE_OAK.maximumBranchDevelopment * 0.95;
  tree.foliage.leafCapacity = 5000;
  tree.foliage.currentLeaves = 5000;
  tree.foliage.seasonalCondition = 1;
  tree.energy.reserves = 10000;
  tree.water.stored = 200;
  tree.water.capacity = 500;
  tree.nutrients = { nitrogen: 50, phosphorus: 20, potassium: 40 };
  tree.roots.development = 0.9;
  tree.roots.absorptionCapacity = 0.9;
  tree.stress = 0;
  tree.damage = [];
  tree.alive = true;
  // Mid-summer for full canopy (PROVISIONAL_DAYS_PER_SEASON = 30 → day 60 = summer).
  const SECONDS_PER_DAY = 24 * 60 * 60;
  next.clock.day = 60;
  next.clock.season = 'summer';
  next.clock.timeOfDay = 0.5;
  next.clock.elapsedSeconds = next.clock.day * SECONDS_PER_DAY;
  return next;
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

/** Assert conservation holds on a state. */
function expectConservation(s: GameState, label = ''): void {
  expect(conservationDiscrepancy(s, INITIAL_SUPPLY), `conservation broken: ${label}`).toBe(0n);
}

/** Assert all real-account balances are non-negative. */
function expectNonNegativeBalances(s: GameState, label = ''): void {
  for (const acc of s.economy.accounts) {
    const bal = parseAmount(acc.balance, acc.id);
    expect(bal, `negative balance on ${acc.id} (${label})`).toBeGreaterThanOrEqual(0n);
  }
}

// ============================================================================
// 1. End-to-end: harvest → issuance → buy → apply → pay → conservation.
//    The full player loop described in GDD §3.1, walked one step at a time
//    with conservation verified at every step.
// ============================================================================

describe('cross-phase: harvest → issuance → purchase → apply → pay expense', () => {
  it('walks the full player loop with conservation at every step (GDD §3.1)', () => {
    let s = makeMature(freshState());
    expectConservation(s, 'fresh state');

    // --- 1. Harvest leaves (queues a CurrencyIssuanceRequest). ---
    const beforeHarvest = s.originalTree.foliage.currentLeaves;
    const r1 = engine.executeAction(s, {
      type: 'harvest-leaves',
      payload: { treeId: 'original', requestedLeaves: 100 },
    });
    s = r1.state;
    // No money moved yet — the harvest only queued a pendingIssuance.
    expectConservation(s, 'after harvest-leaves');
    expectNonNegativeBalances(s, 'after harvest-leaves');
    // TDD §18.1: harvesting reduces the leaf count (no negative leaves).
    expect(s.originalTree.foliage.currentLeaves).toBe(beforeHarvest - 100);
    expect(s.originalTree.foliage.currentLeaves).toBeGreaterThanOrEqual(0);
    // Player's cash unchanged (issuance is queued, not yet issued).
    expect(getBalance(s, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID)).toBe(
      parseAmount(INITIAL_SUPPLY, 'initial'),
    );
    // Pending issuance queued for the EconomySystem to drain.
    expect(s.originalTree.pendingIssuances).toHaveLength(1);
    const queuedAmount = parseAmount(
      s.originalTree.pendingIssuances[0]!.amount,
      'pendingIssuance',
    );
    // 100 leaves × $1 (100 minor/leaf) = 10000 minor.
    expect(queuedAmount).toBe(BigInt(100) * BigInt(WHITE_OAK.leafDenominationMinor));

    // --- 2. Advance one tick → EconomySystem drains the queue → player credited. ---
    const r2 = engine.advance(s, STEP);
    s = r2.state;
    expectConservation(s, 'after issuance drain');
    expectNonNegativeBalances(s, 'after issuance drain');
    // Player:personal credited with the issued amount.
    expect(getBalance(s, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID)).toBe(
      parseAmount(INITIAL_SUPPLY, 'initial') + queuedAmount,
    );
    // Pending issuance queue drained.
    expect(s.originalTree.pendingIssuances).toHaveLength(0);
    // totalIssued reflects the drained issuance.
    expect(parseAmount(s.economy.totalIssued, 'totalIssued')).toBe(queuedAmount);
    // An issuance-authorized event was emitted.
    expect(r2.events.some((e) => e.type === 'issuance-authorized')).toBe(true);
    // A transaction-recorded event was emitted.
    expect(r2.events.some((e) => e.type === 'transaction-recorded')).toBe(true);

    // --- 3. Purchase water (player:personal → market:water). ---
    const playerBeforeBuy = getBalance(s, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID);
    const waterQty = 50;
    const r3 = engine.executeAction(s, {
      type: 'purchase',
      payload: { marketId: 'market:water', quantity: waterQty },
    });
    s = r3.state;
    expectConservation(s, 'after purchase water');
    expectNonNegativeBalances(s, 'after purchase water');
    // Player debited; market:water credited (a real→real transfer).
    const waterMarketId = `${PROVISIONAL_ECONOMY_MARKET_ACCOUNT_PREFIX}water`;
    const waterUnitPrice = parseAmount(
      s.economy.markets.find((m) => m.id === 'market:water')!.price,
      'price',
    );
    const totalCost = waterUnitPrice * BigInt(waterQty);
    expect(getBalance(s, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID)).toBe(
      playerBeforeBuy - totalCost,
    );
    expect(getBalance(s, waterMarketId)).toBe(totalCost);
    // monetarySupply unchanged (real→real transfer).
    expect(s.economy.monetarySupply).toBe(
      (parseAmount(INITIAL_SUPPLY, 'initial') + queuedAmount).toString(10),
    );
    // Inventory credited with the commodityId (P3b contract).
    const waterInv = s.inventory.items.find((i) => i.resourceId === 'resource:water');
    expect(waterInv).toBeDefined();
    expect(waterInv!.quantity).toBe(waterQty);

    // --- 4. Apply the water to the soil (P2 action; no money moves). ---
    const soilWaterBefore = s.world.environment.soil.soilWater;
    const r4 = engine.executeAction(s, {
      type: 'apply-water',
      payload: { litres: 20 },
    });
    s = r4.state;
    expectConservation(s, 'after apply-water');
    // Money untouched (the purchase already paid; apply only mutates soil).
    expect(getBalance(s, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID)).toBe(
      playerBeforeBuy - totalCost,
    );
    // Soil water increased by 20 L (capped at capacity, but the default soil
    // is well below capacity so the full 20 L should land).
    expect(s.world.environment.soil.soilWater).toBeGreaterThan(soilWaterBefore);
    // A water-applied event was emitted.
    expect(r4.events.some((e) => e.type === 'water-applied')).toBe(true);

    // --- 5. Pay a personal expense (player:personal → authority sink). ---
    const playerBeforePay = getBalance(s, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID);
    const r5 = engine.executeAction(s, {
      type: 'pay-expense',
      payload: { category: 'food', amount: '1000' },
    });
    s = r5.state;
    expectConservation(s, 'after pay-expense');
    expectNonNegativeBalances(s, 'after pay-expense');
    // Player debited by 1000; totalSinks increased by 1000.
    expect(getBalance(s, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID)).toBe(
      playerBeforePay - 1000n,
    );
    expect(parseAmount(s.economy.totalSinks, 'totalSinks')).toBe(1000n);
    // monetarySupply decreased by 1000 (sink removes money from circulation).
    expect(s.economy.monetarySupply).toBe(
      (parseAmount(INITIAL_SUPPLY, 'initial') + queuedAmount - 1000n).toString(10),
    );
    // An expense-due event with paid=true was emitted.
    const expenseDue = r5.events.find((e) => e.type === 'expense-due');
    expect(expenseDue).toBeDefined();
    if (expenseDue && expenseDue.type === 'expense-due') {
      expect(expenseDue.payload.paid).toBe(true);
      expect(expenseDue.payload.category).toBe('food');
    }

    // --- Final sanity: algebraic conservation identity holds. ---
    const lhs = sumBalances(s) + parseAmount(s.economy.totalSinks, 'sinks');
    const rhs =
      parseAmount(INITIAL_SUPPLY, 'initial') + parseAmount(s.economy.totalIssued, 'issued');
    expect(lhs).toBe(rhs);
  });

  it('purchase fertilizer → apply-fertilizer → soil contamination rises when over-applied', () => {
    // Buy + apply fertilizer end-to-end. The purchase is a real→real transfer
    // (conservation-trivial); the apply mutates soil nutrients + contamination
    // (no money moves). Verifies the purchase→apply chain uses matching ids
    // (P3b contract).
    let s = freshState();
    expectConservation(s, 'fresh state');

    // Saturate soil nutrients so any further application overflows.
    s = {
      ...s,
      world: {
        ...s.world,
        environment: {
          ...s.world.environment,
          soil: {
            ...s.world.environment.soil,
            nutrients: {
              nitrogen: PROVISIONAL_RESOURCE_SOIL_NUTRIENT_CAPACITY,
              phosphorus: PROVISIONAL_RESOURCE_SOIL_NUTRIENT_CAPACITY,
              potassium: PROVISIONAL_RESOURCE_SOIL_NUTRIENT_CAPACITY,
            },
            // Saturated soil → full contamination from overflow.
            soilWater: PROVISIONAL_RESOURCE_SOIL_WATER_CAPACITY,
          },
        },
      },
    };

    // 1. Purchase 5 units of fertilizer.
    const playerBefore = getBalance(s, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID);
    const r1 = engine.executeAction(s, {
      type: 'purchase',
      payload: { marketId: 'market:fertilizer', quantity: 5 },
    });
    s = r1.state;
    expectConservation(s, 'after purchase fertilizer');
    expectNonNegativeBalances(s, 'after purchase fertilizer');
    // Player debited; market:fertilizer credited.
    const fertMarketId = `${PROVISIONAL_ECONOMY_MARKET_ACCOUNT_PREFIX}fertilizer`;
    const fertUnitPrice = parseAmount(
      s.economy.markets.find((m) => m.id === 'market:fertilizer')!.price,
      'price',
    );
    const fertCost = fertUnitPrice * 5n;
    expect(getBalance(s, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID)).toBe(playerBefore - fertCost);
    expect(getBalance(s, fertMarketId)).toBe(fertCost);
    // Inventory credited with the fertilizer commodityId.
    const fertInv = s.inventory.items.find(
      (i) => i.resourceId === 'fertilizer:balanced-10-10-10',
    );
    expect(fertInv).toBeDefined();
    expect(fertInv!.quantity).toBe(5);

    // 2. Apply 5 units → contamination rises (GDD §8.3 over-application harm).
    const contamBefore = s.world.environment.soil.contamination;
    const r2 = engine.executeAction(s, {
      type: 'apply-fertilizer',
      payload: { fertilizerId: 'fertilizer:balanced-10-10-10', units: 5 },
    });
    s = r2.state;
    expectConservation(s, 'after apply-fertilizer');
    // Money untouched by the apply step (purchase already paid).
    expect(getBalance(s, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID)).toBe(playerBefore - fertCost);
    // Contamination increased (soil was saturated → overflow converts to contam).
    expect(s.world.environment.soil.contamination).toBeGreaterThan(contamBefore);
    // A fertilizer-applied event was emitted.
    expect(r2.events.some((e) => e.type === 'fertilizer-applied')).toBe(true);
  });
});

// ============================================================================
// 2. Save/load mid-sequence preserves idempotency (no double-issuance).
//    Mirrors the contract documented in docs/economy.md §3.2.
// ============================================================================

describe('save/load mid-sequence preserves idempotency (TDD §10.3, §14.3)', () => {
  it('re-draining the same pendingIssuance after save/load rejects with duplicate-request', async () => {
    // Queue an issuance, advance one tick (drains it), save, load, re-queue
    // the same request at the same simSecond, re-drain. The reload preserves
    // `processedRequestIds` so the duplicate is rejected.
    const s = makeMature(freshState());
    // makeMature advances the clock to day 60 (mid-summer). After one STEP,
    // ctx.now = 60 * SECONDS_PER_DAY + STEP. The EconomySystem drains the
    // pendingIssuance at that ctx.now, producing the requestId below.
    const simSecondForDrain = s.clock.elapsedSeconds + STEP;
    const afterHarvest = engine.executeAction(s, {
      type: 'harvest-leaves',
      payload: { treeId: 'original', requestedLeaves: 50 },
    });
    const afterStep = engine.advance(afterHarvest.state, STEP);
    expect(afterStep.state.economy.totalIssued).toBe(
      (BigInt(50) * BigInt(WHITE_OAK.leafDenominationMinor)).toString(10),
    );

    // Save + load.
    const storage = new InMemoryStorage();
    await storage.save(afterStep.state);
    const loaded = await storage.load();
    expect(loaded).not.toBeNull();
    // Sanity: processedRequestIds survived the round-trip. The requestId was
    // derived from (saveId, simSecondForDrain, 0) by drainPendingIssuances.
    const issuedReqId = `issuance:${loaded!.metadata.saveId}:${simSecondForDrain}:0`;
    expect(loaded!.economy.processedRequestIds).toContain(issuedReqId);

    // Re-queue the SAME request at the SAME simSecond + index → requestId
    // collides → duplicate rejection.
    const reQueued: GameState = {
      ...loaded!,
      originalTree: {
        ...loaded!.originalTree,
        pendingIssuances: [issuanceReq('original', '5000')],
      },
    };
    const secondResult = drainPendingIssuances(
      reQueued,
      reQueued.originalTree,
      loaded!.metadata.saveId,
      simSecondForDrain,
      { policy: { maxPerRequest: null, maxTotal: null, issuanceFeeFraction: 0 } },
    );
    // No money issued — idempotency held.
    expect(secondResult.state.economy.totalIssued).toBe(afterStep.state.economy.totalIssued);
    expect(secondResult.state.player.personalCash).toBe(afterStep.state.player.personalCash);
    // Rejection event emitted with 'duplicate-request' reason.
    const rejected = secondResult.events.find((e) => e.type === 'issuance-rejected');
    expect(rejected).toBeDefined();
    if (rejected && rejected.type === 'issuance-rejected') {
      expect(rejected.payload.reason).toBe('duplicate-request');
    }
  });

  it('save/load mid-loop preserves conservation + processedRequestIds across the full player loop', async () => {
    // Walk the harvest → advance → buy → apply → pay loop, save at the end,
    // load, and verify conservation still holds + processedRequestIds persist.
    let s = makeMature(freshState());
    s = engine.executeAction(s, {
      type: 'harvest-leaves',
      payload: { treeId: 'original', requestedLeaves: 100 },
    }).state;
    s = engine.advance(s, STEP).state;
    s = engine.executeAction(s, {
      type: 'purchase',
      payload: { marketId: 'market:water', quantity: 10 },
    }).state;
    s = engine.executeAction(s, {
      type: 'apply-water',
      payload: { litres: 5 },
    }).state;
    s = engine.executeAction(s, {
      type: 'pay-expense',
      payload: { category: 'food', amount: '500' },
    }).state;
    expectConservation(s, 'before save');

    const storage = new InMemoryStorage();
    await storage.save(s);
    const loaded = await storage.load();
    expect(loaded).not.toBeNull();
    // Conservation still holds after the round-trip.
    expectConservation(loaded!, 'after load');
    // The processedRequestIds survive the round-trip (idempotency set intact).
    expect(loaded!.economy.processedRequestIds.length).toBeGreaterThan(0);
    // Balances byte-identical.
    expect(loaded!.economy.accounts).toEqual(s.economy.accounts);
    expect(loaded!.economy.totalIssued).toBe(s.economy.totalIssued);
    expect(loaded!.economy.totalSinks).toBe(s.economy.totalSinks);
  });
});

// ============================================================================
// 3. Determinism: same seed + same actions → byte-identical final state.
// ============================================================================

describe('cross-phase determinism (TDD §18.3)', () => {
  it('same seed + same action sequence → identical final state + events', () => {
    function run(): { state: GameState; eventTypes: string[] } {
      let s = makeMature(engine.initialize(cfg(7)));
      const actions: Parameters<typeof engine.executeAction>[1][] = [
        { type: 'harvest-leaves', payload: { treeId: 'original', requestedLeaves: 50 } },
        { type: 'purchase', payload: { marketId: 'market:water', quantity: 5 } },
        { type: 'apply-water', payload: { litres: 5 } },
        { type: 'pay-expense', payload: { category: 'food', amount: '300' } },
      ];
      const eventTypes: string[] = [];
      for (const a of actions) {
        const r = engine.executeAction(s, a);
        s = r.state;
        eventTypes.push(...r.events.map((e) => e.type));
      }
      s = engine.advance(s, STEP).state;
      return { state: s, eventTypes };
    }
    const a = run();
    const b = run();
    expect(a.state).toEqual(b.state);
    expect(a.eventTypes).toEqual(b.eventTypes);
  });

  it('save → load → continue == continue without save/load (cross-phase)', async () => {
    // Run the player loop, save at the midpoint, load, continue; compare to
    // running straight through without save/load.
    function runToMidpoint(): GameState {
      let s = makeMature(engine.initialize(cfg(11)));
      s = engine.executeAction(s, {
        type: 'harvest-leaves',
        payload: { treeId: 'original', requestedLeaves: 80 },
      }).state;
      s = engine.advance(s, STEP).state;
      s = engine.executeAction(s, {
        type: 'purchase',
        payload: { marketId: 'market:water', quantity: 5 },
      }).state;
      return s;
    }

    // Path A: save → load → continue.
    const aMid = runToMidpoint();
    const storage = new InMemoryStorage();
    await storage.save(aMid);
    const aLoaded = await storage.load();
    expect(aLoaded).not.toBeNull();
    const aFinal = engine.advance(aLoaded!, STEP).state;

    // Path B: continue straight through.
    const bMid = runToMidpoint();
    const bFinal = engine.advance(bMid, STEP).state;

    // Both paths converge to the same final state (economy + biology).
    expect(aFinal.economy).toEqual(bFinal.economy);
    expect(aFinal.originalTree.foliage).toEqual(bFinal.originalTree.foliage);
    expect(aFinal.originalTree.water).toEqual(bFinal.originalTree.water);
    expect(aFinal.rngStreams).toEqual(bFinal.rngStreams);
  });
});

// ============================================================================
// 4. Inflation erodes real purchasing power (GDD §6.3, §7.3).
//    Issuing money grows monetarySupply → markets' monetary-conditions factor
//    pushes prices up → inflationIndex rises → realPurchasingPowerMinor <
//    nominalCashMinor (the player's banknotes buy less).
// ============================================================================

describe('inflation erodes real purchasing power (GDD §6.3, §7.3)', () => {
  it('issuing money raises prices and lowers real purchasing power', () => {
    let s = freshState();
    const initialRealPurchasingPower = Number(s.player.personalCash) / s.economy.inflationIndex;
    expect(s.economy.inflationIndex).toBeCloseTo(1.0, 6);

    // Issue a large amount of currency (simulate many harvests). This grows
    // monetarySupply; the markets' monetary-conditions factor pushes prices up.
    const issueAmount = 5_000_000n; // 50x the starting supply.
    s = transfer(s, {
      sourceAccount: 'authority',
      destinationAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
      amount: issueAmount.toString(10),
      category: PROVISIONAL_ECONOMY_CATEGORY_ISSUANCE,
      description: 'large issuance for inflation test',
      timestamp: 60,
      requestId: 'req-inflation-test',
    });
    // Conservation holds even with the large issuance.
    expectConservation(s, 'after large issuance');
    // monetarySupply grew.
    expect(parseAmount(s.economy.monetarySupply, 'monetarySupply')).toBe(
      parseAmount(INITIAL_SUPPLY, 'initial') + issueAmount,
    );

    // Run several market updates so prices converge toward the new equilibrium.
    for (let i = 0; i < 30; i++) {
      s = engine.advance(s, STEP).state;
    }
    expectConservation(s, 'after market updates');

    // The inflation index should have risen: prices climbed because the
    // monetary-conditions factor (1 + 0.5 × (supply/initial - 1)) is now
    // far above 1.0.
    expect(s.economy.inflationIndex).toBeGreaterThan(1.0);

    // Real purchasing power (nominal / index) is now less than nominal.
    const nominalCash = Number(getBalance(s, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID));
    const realPurchasingPower = nominalCash / s.economy.inflationIndex;
    expect(realPurchasingPower).toBeLessThan(nominalCash);
    // And it's significantly less than the initial real purchasing power
    // would have been (the player has more nominal cash but the inflation
    // eats a chunk of the gain — GDD §6.3 "Increasing the number of banknotes
    // does not necessarily increase real wealth").
    // Sanity: realPurchasingPower grew (because nominal grew 100x), but less
    // than proportionally with nominal (inflation ate some).
    const nominalGrowthRatio =
      nominalCash / Number(parseAmount(INITIAL_SUPPLY, 'initial'));
    const realGrowthRatio = realPurchasingPower / initialRealPurchasingPower;
    expect(realGrowthRatio).toBeLessThan(nominalGrowthRatio);
  });
});

// ============================================================================
// 5. Auto-bill flow + conservation across many sim days.
//    Engine.advance drives the PersonalSystem's auto-bill flow over a long
//    enough run to fire at least one bill cycle, verifying conservation holds
//    through the schedule → fire → pay (or unpaid) → cancel cycle.
// ============================================================================

describe('auto-bill flow across many ticks (PersonalSystem + EconomySystem + Ledger)', () => {
  it('schedules, fires, pays, and cancels a bill with conservation at every tick', () => {
    // Start from a state where the player can afford the bill. We schedule
    // the bill at sim second = STEP (the first tick after game start) by
    // building the bill-due event directly. The PersonalSystem then:
    //   1. detects the due bill,
    //   2. processes each of the 5 categories (auto-pay),
    //   3. cancels the fired event from the scheduler.
    let s = freshState();
    s = schedule(s, buildBillDueEvent(s, STEP));

    const playerBefore = getBalance(s, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID);
    expectConservation(s, 'before bill fires');

    // Advance one step — the bill fires.
    const r = engine.advance(s, STEP);
    s = r.state;
    expectConservation(s, 'after bill fires');
    expectNonNegativeBalances(s, 'after bill fires');

    // Player was debited (5 categories paid in full — player had $500, bill is
    // $240 total = 24000 minor).
    const after = getBalance(s, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID);
    expect(after).toBeLessThan(playerBefore);
    // 5 expense-due events emitted (one per category, all paid=true).
    const expenseDueEvents = r.events.filter((e) => e.type === 'expense-due');
    expect(expenseDueEvents).toHaveLength(5);
    for (const ev of expenseDueEvents) {
      if (ev.type === 'expense-due') {
        expect(ev.payload.paid).toBe(true);
        expect(ev.payload.source).toBe('auto-bill');
      }
    }
    // 5 expense transactions recorded with category 'expense'.
    const expenseTxns = s.economy.transactions.filter(
      (t) => t.category === PROVISIONAL_ECONOMY_CATEGORY_EXPENSE,
    );
    expect(expenseTxns).toHaveLength(5);

    // The fired bill-due event was cancelled from the scheduler.
    const remainingBills = s.scheduler.events.filter((e) => e.kind === 'bill-due');
    // The PersonalSystem should have scheduled the NEXT bill (it always
    // ensures one is queued for the future).
    expect(remainingBills.length).toBeGreaterThanOrEqual(1);
    // The cancelled bill id is no longer present.
    const cancelledId = `bill-due:${s.metadata.saveId}:${Math.floor(STEP / PROVISIONAL_PERSONAL_BILLING_INTERVAL_SECONDS)}`;
    expect(remainingBills.find((b) => b.id === cancelledId)).toBeUndefined();
  });

  it('unpaid bills preserve conservation (no money moves; unpaidDays grows)', () => {
    // Player is broke. The bill fires, each category goes unpaid, no money
    // moves, conservation trivially holds, unpaidDays grows.
    let s = freshState();
    // Drain the player's cash.
    s = transfer(s, {
      sourceAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
      destinationAccount: 'external:default',
      amount: s.player.personalCash,
      category: 'transfer',
      description: 'drain for broke-player test',
      timestamp: 0,
    });
    expect(getBalance(s, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID)).toBe(0n);
    expectConservation(s, 'after drain');

    // Schedule a bill to fire on the first tick.
    s = schedule(s, buildBillDueEvent(s, STEP));
    const r = engine.advance(s, STEP);
    s = r.state;
    // No money moved — conservation trivially holds.
    expectConservation(s, 'after unpaid bill');
    expectNonNegativeBalances(s, 'after unpaid bill');
    // unpaidDays incremented by 5 × BILLING_INTERVAL_DAYS (one per category).
    expect(s.player.unpaidDays).toBeGreaterThan(0);
    // No expense transactions recorded (money didn't move).
    expect(
      s.economy.transactions.filter((t) => t.category === PROVISIONAL_ECONOMY_CATEGORY_EXPENSE),
    ).toHaveLength(0);
    // 5 expense-due events with paid=false.
    const unpaid = r.events.filter((e) => e.type === 'expense-due' && e.payload.paid === false);
    expect(unpaid).toHaveLength(5);
  });
});
