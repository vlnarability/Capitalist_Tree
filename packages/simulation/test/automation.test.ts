/**
 * Automation system + action handler tests (P6b2 — TDD §12, §18.1, §18.3,
 * §18.4; GDD §9, §9.1, §95 pillar 4).
 *
 * Asserts the invariants the GDD and TDD require:
 *
 *   - evaluatePolicy: threshold met/not-met, cooldown blocks, disabled
 *     blocks, schedule interval fires on boundary, schedule `at` one-shot
 *     fires once.
 *   - executeAutomation: action dispatched, lastRunAt advanced,
 *     resourceConsumption applied, environmentalImpact accumulated,
 *     maintenanceCost moved via the ledger (transaction recorded),
 *     automation-triggered event emitted.
 *   - Insufficient resources → automation-skipped event, lastRunAt NOT
 *     advanced (retries next tick).
 *   - purchaseEquipmentHandler: money moved, new automation added,
 *     equipment-purchased event, idempotency (same requestId → no
 *     double-charge).
 *   - Integration: a full sim tick with an enabled threshold-policy
 *     sprinkler auto-waters when soil drops below threshold.
 *   - Determinism: same seed → same automation decisions/events.
 *   - originalTree guard: an automation targeting originalTree for
 *     sell-tree is rejected (the action layer enforces this from P3c — the
 *     automation path does NOT bypass it).
 *
 * Conservation invariant (TDD §10.4) is checked after every money-moving
 * operation: `sum(balances) + totalSinks === initialSupply + totalIssued`.
 */
import { describe, it, expect } from 'vitest';
import { engine, defaultRegistry } from '../src/index.js';
import { DEFAULT_GAME_CONFIG } from '../src/initial-state.js';
import {
  evaluatePolicy,
  executeAutomation,
  resolveNumericPath,
  applyThresholdOp,
  setAutomationPolicyHandler,
  enableAutomationHandler,
  disableAutomationHandler,
  purchaseEquipmentHandler,
  UnknownAutomationError,
  UnknownEquipmentError,
  UnsupportedPolicyError,
  CATEGORY_MAINTENANCE,
} from '../src/automation/index.js';
import {
  transfer,
  getBalance,
  sumBalances,
  conservationDiscrepancy,
  isRequestProcessed,
  parseAmount,
} from '../src/economy/index.js';
import { SPRINKLER_T1 } from '@capitalist-tree/content';
import {
  type GameState,
  type GameConfig,
  type AutomationState,
  type AutomationPolicy,
  type EnvironmentalImpact,
  PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
  PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
  PROVISIONAL_SIMULATION_STEP_SECONDS as STEP,
  PROVISIONAL_STARTING_PERSONAL_CASH_MINOR,
  OriginalTreeNotTransferableError,
} from '@capitalist-tree/shared';
import { Rng } from '../src/rng.js';

// ---------- helpers ----------

function cfg(seed: number): GameConfig {
  return { ...DEFAULT_GAME_CONFIG, seed, createdAt: 0 };
}

function freshState(): GameState {
  return engine.initialize(cfg(42));
}

const INITIAL_SUPPLY = DEFAULT_GAME_CONFIG.startingPersonalCash; // '50000'

/** Build an AutomationState with sensible test defaults. */
function makeAutomation(overrides: Partial<AutomationState> & { id: string }): AutomationState {
  const baseImpact: EnvironmentalImpact = {
    carbonEmissions: 0,
    waterConsumption: 0,
    soilDegradation: 0,
    pollution: 0,
    landDisturbance: 0,
    biodiversityImpact: 0,
  };
  return {
    type: 'test-automation',
    enabled: true,
    targetId: 'original',
    schedule: { kind: 'interval', value: STEP },
    resourceConsumption: [],
    energyConsumption: 0,
    maintenanceCost: '0',
    environmentalImpact: baseImpact,
    lastRunAt: 0,
    cooldownSeconds: 0,
    ...overrides,
  };
}

/** A threshold policy that fires apply-water when soil water < value. */
function soilThresholdPolicy(value: number, litres: number): AutomationPolicy {
  return {
    kind: 'threshold',
    condition: {
      field: 'world.environment.soil.soilWater',
      op: '<',
      value,
    },
    action: 'apply-water',
    actionParams: { litres },
  };
}

function setSoilWater(state: GameState, litres: number): GameState {
  const next = structuredClone(state);
  next.world.environment.soil.soilWater = litres;
  return next;
}

function setHealth(state: GameState, health: number): GameState {
  const next = structuredClone(state);
  next.originalTree.health = health;
  return next;
}

function addAutomation(state: GameState, automation: AutomationState): GameState {
  return { ...state, automation: [...state.automation, automation] };
}

function setInventory(state: GameState, items: { resourceId: string; quantity: number }[]): GameState {
  return { ...state, inventory: { items } };
}

function assertConservation(state: GameState, message: string): void {
  const disc = conservationDiscrepancy(state, INITIAL_SUPPLY);
  expect(disc, message).toBe(0n);
}

// ---------- evaluatePolicy ----------

describe('evaluatePolicy', () => {
  it('threshold met → shouldRun', () => {
    let state = freshState();
    state = setSoilWater(state, 20); // below 50
    const automation = makeAutomation({
      id: 'a1',
      policy: soilThresholdPolicy(50, 5),
    });
    const result = evaluatePolicy(state, automation, STEP);
    expect(result.shouldRun).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('threshold not met → condition-not-met', () => {
    let state = freshState();
    state = setSoilWater(state, 80); // above 50
    const automation = makeAutomation({
      id: 'a2',
      policy: soilThresholdPolicy(50, 5),
    });
    const result = evaluatePolicy(state, automation, STEP);
    expect(result.shouldRun).toBe(false);
    expect(result.reason).toBe('condition-not-met');
  });

  it('disabled → disabled', () => {
    const state = freshState();
    const automation = makeAutomation({
      id: 'a3',
      enabled: false,
      policy: soilThresholdPolicy(50, 5),
    });
    const result = evaluatePolicy(state, automation, STEP);
    expect(result.shouldRun).toBe(false);
    expect(result.reason).toBe('disabled');
  });

  it('cooldown blocks when lastRunAt + cooldown > now', () => {
    const state = freshState();
    // lastRunAt=120, cooldown=300 → 120+300=420 > 60 (now). Blocked.
    const automation = makeAutomation({
      id: 'a4',
      lastRunAt: 120,
      cooldownSeconds: 300,
      policy: soilThresholdPolicy(50, 5),
    });
    const result = evaluatePolicy(state, automation, 60);
    expect(result.shouldRun).toBe(false);
    expect(result.reason).toBe('cooldown');
  });

  it('cooldown does not block once elapsed', () => {
    const state = freshState();
    // lastRunAt=60, cooldown=60 → 60+60=120. now=120 → not > 120 → OK.
    const automation = makeAutomation({
      id: 'a5',
      lastRunAt: 60,
      cooldownSeconds: 60,
      policy: soilThresholdPolicy(50, 5),
    });
    const result = evaluatePolicy(state, automation, 120);
    expect(result.shouldRun).toBe(true);
  });

  it('schedule interval fires on boundary', () => {
    const state = freshState();
    // No policy — legacy schedule. interval=60. now=60, lastRunAt=0.
    const automation = makeAutomation({
      id: 'a6',
      schedule: { kind: 'interval', value: 60 },
    });
    expect(evaluatePolicy(state, automation, 60).shouldRun).toBe(true);
    // Off-boundary → not met.
    expect(evaluatePolicy(state, automation, 90).shouldRun).toBe(false);
    // Boundary but elapsed since last run < value → not met (lastRunAt=60).
    expect(evaluatePolicy(state, { ...automation, lastRunAt: 60 } as AutomationState, 120).shouldRun).toBe(true);
  });

  it('schedule `at` one-shot fires once then never again', () => {
    const state = freshState();
    const automation = makeAutomation({
      id: 'a7',
      schedule: { kind: 'at', value: 60 },
    });
    // Before the target time → not met.
    expect(evaluatePolicy(state, automation, 30).shouldRun).toBe(false);
    // At the target time, not yet fired → fires.
    expect(evaluatePolicy(state, automation, 60).shouldRun).toBe(true);
    // After firing (lastRunAt=60 >= value=60) → never fires again.
    expect(
      evaluatePolicy(state, { ...automation, lastRunAt: 60 } as AutomationState, 120).shouldRun,
    ).toBe(false);
  });

  it('threshold on originalTree.health resolves + compares', () => {
    let state = freshState();
    state = setHealth(state, 0.3);
    const automation = makeAutomation({
      id: 'a8',
      policy: {
        kind: 'threshold',
        condition: { field: 'originalTree.health', op: '<', value: 0.5 },
        action: 'no-op',
        actionParams: {},
      },
    });
    expect(evaluatePolicy(state, automation, STEP).shouldRun).toBe(true);
  });

  it('non-numeric / missing field path → condition-not-met', () => {
    const state = freshState();
    const automation = makeAutomation({
      id: 'a9',
      policy: {
        kind: 'threshold',
        condition: { field: 'does.not.exist', op: '<', value: 1 },
        action: 'no-op',
        actionParams: {},
      },
    });
    const result = evaluatePolicy(state, automation, STEP);
    expect(result.shouldRun).toBe(false);
    expect(result.reason).toBe('condition-not-met');
  });

  it('resolveNumericPath + applyThresholdOp unit checks', () => {
    const state = freshState();
    expect(resolveNumericPath(state, 'world.environment.soil.soilWater')).toBe(
      state.world.environment.soil.soilWater,
    );
    expect(resolveNumericPath(state, 'missing.path')).toBeUndefined();
    expect(applyThresholdOp(5, '<', 10)).toBe(true);
    expect(applyThresholdOp(15, '<', 10)).toBe(false);
    expect(applyThresholdOp(10, '>=', 10)).toBe(true);
    expect(applyThresholdOp(10, '==', 10)).toBe(true);
    expect(applyThresholdOp(11, '<=', 10)).toBe(false);
  });
});

// ---------- executeAutomation ----------

describe('executeAutomation', () => {
  it('dispatches the action, advances lastRunAt, emits automation-triggered', () => {
    let state = freshState();
    state = setSoilWater(state, 20);
    state = addAutomation(
      state,
      makeAutomation({ id: 'x1', policy: soilThresholdPolicy(50, 10) }),
    );
    const rng = Rng.fromSeed(1);
    const result = executeAutomation(state, state.automation[0]!, {
      now: STEP,
      stepSeconds: STEP,
      rng,
    });
    // water-applied event from the dispatched apply-water action.
    const waterApplied = result.events.find((e) => e.type === 'water-applied');
    expect(waterApplied).toBeDefined();
    // automation-triggered event.
    const triggered = result.events.find((e) => e.type === 'automation-triggered');
    expect(triggered).toBeDefined();
    expect(triggered!.type === 'automation-triggered' && triggered!.payload.actionExecuted).toBe(
      'apply-water',
    );
    // lastRunAt advanced to `now`.
    expect(result.state.automation[0]!.lastRunAt).toBe(STEP);
    // soil water increased (apply-water added 10 L).
    expect(result.state.world.environment.soil.soilWater).toBeGreaterThan(
      state.world.environment.soil.soilWater,
    );
    // Input not mutated.
    expect(state.automation[0]!.lastRunAt).toBe(0);
  });

  it('applies resourceConsumption (deducts from inventory)', () => {
    let state = freshState();
    state = setInventory(state, [{ resourceId: 'resource:water', quantity: 10 }]);
    state = addAutomation(
      state,
      makeAutomation({
        id: 'x2',
        resourceConsumption: [{ resourceId: 'resource:water', amount: 3 }],
        policy: soilThresholdPolicy(50, 5),
      }),
    );
    const result = executeAutomation(state, state.automation[0]!, {
      now: STEP,
      stepSeconds: STEP,
      rng: Rng.fromSeed(1),
    });
    const water = result.state.inventory.items.find((i) => i.resourceId === 'resource:water');
    expect(water?.quantity).toBe(7);
  });

  it('accumulates environmentalImpact onto environment accumulators', () => {
    let state = freshState();
    const emissionsBefore = state.world.environment.atmosphere.emissions;
    state = addAutomation(
      state,
      makeAutomation({
        id: 'x3',
        policy: soilThresholdPolicy(50, 1),
        environmentalImpact: {
          carbonEmissions: 1.0, // per sim day
          waterConsumption: 0,
          soilDegradation: 0,
          pollution: 0,
          landDisturbance: 0,
          biodiversityImpact: 0,
        },
      }),
    );
    state = setSoilWater(state, 20);
    const result = executeAutomation(state, state.automation[0]!, {
      now: STEP,
      stepSeconds: STEP,
      rng: Rng.fromSeed(1),
    });
    const emissionsAfter = result.state.world.environment.atmosphere.emissions;
    // Pro-rated: 1.0 * (60/86400) > 0.
    expect(emissionsAfter).toBeGreaterThan(emissionsBefore);
  });

  it('moves maintenanceCost via the ledger (transaction recorded, conservation holds)', () => {
    let state = freshState();
    const balanceBefore = getBalance(state, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID);
    const sinksBefore = parseAmount(state.economy.totalSinks, 'totalSinks');
    const txnsBefore = state.economy.transactions.length;
    // maintenanceCost='1440' → per tick = 1440*60/86400 = 1 minor unit.
    state = addAutomation(
      state,
      makeAutomation({
        id: 'x4',
        maintenanceCost: '1440',
        policy: soilThresholdPolicy(50, 1),
      }),
    );
    state = setSoilWater(state, 20);
    const result = executeAutomation(state, state.automation[0]!, {
      now: STEP,
      stepSeconds: STEP,
      rng: Rng.fromSeed(1),
    });
    const balanceAfter = getBalance(result.state, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID);
    const sinksAfter = parseAmount(result.state.economy.totalSinks, 'totalSinks');
    // Player debited 1 minor unit.
    expect(balanceBefore - balanceAfter).toBe(1n);
    // Sunk to authority.
    expect(sinksAfter - sinksBefore).toBe(1n);
    // A transaction was recorded with category 'maintenance'.
    const newTxns = result.state.economy.transactions.slice(txnsBefore);
    const maintenanceTxn = newTxns.find((t) => t.category === CATEGORY_MAINTENANCE);
    expect(maintenanceTxn).toBeDefined();
    expect(maintenanceTxn!.amount).toBe('1');
    expect(maintenanceTxn!.requestId).toBeDefined();
    // Conservation invariant holds.
    assertConservation(result.state, 'maintenance transfer preserves conservation');
    // player.personalCash mirrors the account balance.
    expect(result.state.player.personalCash).toBe(balanceAfter.toString(10));
  });

  it('skips maintenance transfer when per-tick cost rounds to 0', () => {
    let state = freshState();
    const txnsBefore = state.economy.transactions.length;
    // maintenanceCost='5' → per tick = 5*60/86400 = 0 (bigint floor). Skipped.
    state = addAutomation(
      state,
      makeAutomation({
        id: 'x5',
        maintenanceCost: '5',
        policy: soilThresholdPolicy(50, 1),
      }),
    );
    state = setSoilWater(state, 20);
    const result = executeAutomation(state, state.automation[0]!, {
      now: STEP,
      stepSeconds: STEP,
      rng: Rng.fromSeed(1),
    });
    // No new transaction (per-tick maintenance rounded to 0).
    expect(result.state.economy.transactions.length).toBe(txnsBefore);
    // But the automation still ran (lastRunAt advanced, triggered emitted).
    expect(result.state.automation[0]!.lastRunAt).toBe(STEP);
    expect(result.events.some((e) => e.type === 'automation-triggered')).toBe(true);
  });

  it('insufficient resources → automation-skipped, lastRunAt NOT advanced', () => {
    let state = freshState();
    state = setInventory(state, []); // no water
    state = addAutomation(
      state,
      makeAutomation({
        id: 'x6',
        resourceConsumption: [{ resourceId: 'resource:water', amount: 5 }],
        policy: soilThresholdPolicy(50, 5),
      }),
    );
    state = setSoilWater(state, 20);
    const result = executeAutomation(state, state.automation[0]!, {
      now: STEP,
      stepSeconds: STEP,
      rng: Rng.fromSeed(1),
    });
    const skipped = result.events.find((e) => e.type === 'automation-skipped');
    expect(skipped).toBeDefined();
    expect(
      skipped!.type === 'automation-skipped' && skipped!.payload.reason,
    ).toBe('insufficient-resources');
    // lastRunAt NOT advanced.
    expect(result.state.automation[0]!.lastRunAt).toBe(0);
    // No automation-triggered event.
    expect(result.events.some((e) => e.type === 'automation-triggered')).toBe(false);
    // No water-applied event (action did not run).
    expect(result.events.some((e) => e.type === 'water-applied')).toBe(false);
  });

  it('action dispatch throwing → automation-skipped, lastRunAt NOT advanced (graceful)', () => {
    let state = freshState();
    // A sell-tree action targeting the original tree throws
    // OriginalTreeNotTransferableError — the automation path must catch it
    // and emit automation-skipped rather than crashing.
    state = addAutomation(
      state,
      makeAutomation({
        id: 'x7',
        policy: {
          kind: 'threshold',
          condition: { field: 'originalTree.health', op: '>', value: 0 },
          action: 'sell-tree',
          actionParams: { target: 'original' },
        },
      }),
    );
    const result = executeAutomation(state, state.automation[0]!, {
      now: STEP,
      stepSeconds: STEP,
      rng: Rng.fromSeed(1),
    });
    const skipped = result.events.find((e) => e.type === 'automation-skipped');
    expect(skipped).toBeDefined();
    expect(result.state.automation[0]!.lastRunAt).toBe(0);
    // originalTree untouched.
    expect(result.state.originalTree.id).toBe('original');
    expect(result.state.originalTree.isOriginal).toBe(true);
  });
});

// ---------- purchaseEquipmentHandler ----------

describe('purchaseEquipmentHandler', () => {
  it('moves money, adds automation, emits equipment-purchased', () => {
    const state = freshState();
    const balanceBefore = getBalance(state, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID);
    const sinksBefore = parseAmount(state.economy.totalSinks, 'totalSinks');
    const automationBefore = state.automation.length;

    const result = purchaseEquipmentHandler(state, {
      type: 'purchase-equipment',
      payload: { equipmentId: SPRINKLER_T1.id, targetId: 'original' },
    });

    // Money moved: player debited the cost, sunk to authority.
    const cost = parseAmount(SPRINKLER_T1.cost, 'cost');
    expect(balanceBefore - getBalance(result.state, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID)).toBe(
      cost,
    );
    expect(
      parseAmount(result.state.economy.totalSinks, 'totalSinks') - sinksBefore,
    ).toBe(cost);
    // Automation added.
    expect(result.state.automation.length).toBe(automationBefore + 1);
    const automation = result.state.automation[result.state.automation.length - 1]!;
    expect(automation.type).toBe(SPRINKLER_T1.id);
    expect(automation.enabled).toBe(true);
    expect(automation.targetId).toBe('original');
    expect(automation.energyConsumption).toBe(SPRINKLER_T1.baseEnergyConsumption);
    expect(automation.maintenanceCost).toBe(SPRINKLER_T1.baseMaintenanceCost);
    expect(automation.lastRunAt).toBe(0);
    expect(automation.cooldownSeconds).toBe(0);
    // equipment-purchased event.
    const purchased = result.events.find((e) => e.type === 'equipment-purchased');
    expect(purchased).toBeDefined();
    expect(
      purchased!.type === 'equipment-purchased' && purchased!.payload.equipmentId,
    ).toBe(SPRINKLER_T1.id);
    expect(
      purchased!.type === 'equipment-purchased' && purchased!.payload.cost,
    ).toBe(SPRINKLER_T1.cost);
    // transaction-recorded event.
    expect(result.events.some((e) => e.type === 'transaction-recorded')).toBe(true);
    // Conservation holds.
    assertConservation(result.state, 'equipment purchase preserves conservation');
    // player.personalCash mirrors.
    expect(result.state.player.personalCash).toBe(
      getBalance(result.state, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID).toString(10),
    );
  });

  it('throws UnknownEquipmentError for an unknown equipment id', () => {
    const state = freshState();
    expect(() =>
      purchaseEquipmentHandler(state, {
        type: 'purchase-equipment',
        payload: { equipmentId: 'equipment:does-not-exist', targetId: 'original' },
      }),
    ).toThrow(UnknownEquipmentError);
  });

  it('idempotency: a replayed purchase (requestId already processed) → no double-charge', () => {
    const state = freshState();
    // First purchase — full success.
    const r1 = purchaseEquipmentHandler(state, {
      type: 'purchase-equipment',
      payload: { equipmentId: SPRINKLER_T1.id, targetId: 'original' },
    });
    const txnsAfterR1 = r1.state.economy.transactions.length;
    const automationAfterR1 = r1.state.automation.length;
    const balanceAfterR1 = getBalance(r1.state, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID);

    // Simulate a crash mid-action: the transfer + requestId landed in
    // processedRequestIds, but the automation append was lost (reset the
    // automation array to the pre-purchase value). Re-running the handler
    // derives the SAME requestId (same index) and must no-op.
    const replayed: GameState = {
      ...r1.state,
      automation: state.automation, // pre-purchase array → index 0 again
    };
    // Sanity: the requestId is indeed marked processed.
    const saveId = state.metadata.saveId;
    const expectedRequestId = `equipment:${saveId}:${SPRINKLER_T1.id}:original:0`;
    expect(isRequestProcessed(replayed, expectedRequestId)).toBe(true);

    const r2 = purchaseEquipmentHandler(replayed, {
      type: 'purchase-equipment',
      payload: { equipmentId: SPRINKLER_T1.id, targetId: 'original' },
    });

    // No new transaction, no new automation, no event, no extra charge.
    expect(r2.state.economy.transactions.length).toBe(txnsAfterR1);
    expect(r2.state.automation.length).toBe(automationAfterR1 - 1); // back to pre-purchase
    expect(r2.events).toEqual([]);
    expect(getBalance(r2.state, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID)).toBe(balanceAfterR1);
  });

  it('throws InsufficientFundsError when the player cannot afford the equipment', () => {
    let state = freshState();
    // Drain the player's cash to below the sprinkler cost.
    state = transfer(state, {
      sourceAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
      destinationAccount: PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
      amount: PROVISIONAL_STARTING_PERSONAL_CASH_MINOR.toString(10),
      category: 'transfer',
      description: 'drain for test',
      timestamp: 0,
    });
    expect(() =>
      purchaseEquipmentHandler(state, {
        type: 'purchase-equipment',
        payload: { equipmentId: SPRINKLER_T1.id, targetId: 'original' },
      }),
    ).toThrow();
  });
});

// ---------- set/enable/disable automation handlers ----------

describe('set/enable/disable automation handlers', () => {
  it('set-automation-policy stores the policy + validates against equipment supportedActions', () => {
    // Purchase a sprinkler first (its type === equipment id, resolvable).
    const s0 = freshState();
    const purchased = purchaseEquipmentHandler(s0, {
      type: 'purchase-equipment',
      payload: { equipmentId: SPRINKLER_T1.id, targetId: 'original' },
    });
    const automationId = purchased.state.automation[0]!.id;

    // Valid policy: sprinkler supports 'threshold' + 'apply-water'.
    const validPolicy: AutomationPolicy = {
      kind: 'threshold',
      condition: { field: 'world.environment.soil.soilWater', op: '<', value: 30 },
      action: 'apply-water',
      actionParams: { litres: 5 },
    };
    const r = setAutomationPolicyHandler(purchased.state, {
      type: 'set-automation-policy',
      payload: { automationId, policy: validPolicy },
    });
    expect(r.state.automation[0]!.policy).toEqual(validPolicy);

    // Invalid policy: action not in supportedActions → throws.
    expect(() =>
      setAutomationPolicyHandler(purchased.state, {
        type: 'set-automation-policy',
        payload: {
          automationId,
          policy: {
            kind: 'threshold',
            condition: { field: 'world.environment.soil.soilWater', op: '<', value: 30 },
            action: 'harvest-leaves', // sprinkler doesn't support this
            actionParams: { treeId: 'original', requestedLeaves: 1 },
          },
        },
      }),
    ).toThrow(UnsupportedPolicyError);

    // Invalid policy kind → throws.
    expect(() =>
      setAutomationPolicyHandler(purchased.state, {
        type: 'set-automation-policy',
        payload: {
          automationId,
          policy: {
            kind: 'event', // sprinkler-t1 doesn't support event policies
            condition: { eventType: 'weather-damage' },
            action: 'apply-water',
            actionParams: { litres: 5 },
          },
        },
      }),
    ).toThrow(UnsupportedPolicyError);
  });

  it('set-automation-policy throws UnknownAutomationError for unknown id', () => {
    const state = freshState();
    expect(() =>
      setAutomationPolicyHandler(state, {
        type: 'set-automation-policy',
        payload: {
          automationId: 'no-such-automation',
          policy: soilThresholdPolicy(30, 5),
        },
      }),
    ).toThrow(UnknownAutomationError);
  });

  it('enable/disable flip enabled and are idempotent', () => {
    let state = freshState();
    state = addAutomation(state, makeAutomation({ id: 'e1', enabled: true }));

    // Disable.
    const r1 = disableAutomationHandler(state, {
      type: 'disable-automation',
      payload: { automationId: 'e1' },
    });
    expect(r1.state.automation[0]!.enabled).toBe(false);
    expect(r1.events.length).toBeGreaterThan(0);

    // Disable again → idempotent (no change, no event).
    const r2 = disableAutomationHandler(r1.state, {
      type: 'disable-automation',
      payload: { automationId: 'e1' },
    });
    expect(r2.state.automation[0]!.enabled).toBe(false);
    expect(r2.events).toEqual([]);

    // Enable.
    const r3 = enableAutomationHandler(r2.state, {
      type: 'enable-automation',
      payload: { automationId: 'e1' },
    });
    expect(r3.state.automation[0]!.enabled).toBe(true);
    expect(r3.events.length).toBeGreaterThan(0);

    // Enable again → idempotent.
    const r4 = enableAutomationHandler(r3.state, {
      type: 'enable-automation',
      payload: { automationId: 'e1' },
    });
    expect(r4.state.automation[0]!.enabled).toBe(true);
    expect(r4.events).toEqual([]);
  });
});

// ---------- integration: full sim tick ----------

describe('AutomationSystem integration (engine.advance)', () => {
  it('a threshold-policy sprinkler auto-waters when soil drops below threshold', () => {
    // Two identical states; one carries an enabled threshold-policy
    // sprinkler automation, the other is the control.
    const baseNoAuto = setSoilWater(freshState(), 20);

    const sprinkler = makeAutomation({
      id: 'sprinkler-auto',
      type: SPRINKLER_T1.id,
      maintenanceCost: '0',
      policy: soilThresholdPolicy(30, 10),
      cooldownSeconds: 0,
    });
    const baseWithAuto = addAutomation(baseNoAuto, sprinkler);

    // Advance one step (60 sim seconds).
    const withResult = engine.advance(baseWithAuto, STEP);
    const withoutResult = engine.advance(baseNoAuto, STEP);

    // The automation fired: water-applied + automation-triggered present.
    const waterApplied = withResult.events.find((e) => e.type === 'water-applied');
    const triggered = withResult.events.find((e) => e.type === 'automation-triggered');
    expect(waterApplied).toBeDefined();
    expect(triggered).toBeDefined();

    // The control run emitted no automation-triggered / water-applied events.
    expect(withoutResult.events.some((e) => e.type === 'automation-triggered')).toBe(false);
    expect(withoutResult.events.some((e) => e.type === 'water-applied')).toBe(false);

    // The with-automation run added water to the soil — its soil water is
    // higher than the control's (the automation's 10 L applied at slot #9,
    // after ResourceSystem ran at slot #4 this tick, so the added water is
    // present in the end-of-tick state).
    expect(
      withResult.state.world.environment.soil.soilWater,
    ).toBeGreaterThan(withoutResult.state.world.environment.soil.soilWater);

    // lastRunAt advanced.
    const autoAfter = withResult.state.automation.find((a) => a.id === 'sprinkler-auto');
    expect(autoAfter?.lastRunAt).toBe(STEP);

    // Conservation holds across the tick.
    assertConservation(withResult.state, 'integration tick preserves conservation');
  });

  it('disabled automation does not fire (automation-skipped emitted)', () => {
    const state = setSoilWater(freshState(), 20);
    const sprinkler = makeAutomation({
      id: 'sprinkler-off',
      enabled: false,
      policy: soilThresholdPolicy(30, 10),
    });
    const result = engine.advance(addAutomation(state, sprinkler), STEP);
    expect(result.events.some((e) => e.type === 'automation-skipped')).toBe(true);
    expect(result.events.some((e) => e.type === 'automation-triggered')).toBe(false);
    expect(result.events.some((e) => e.type === 'water-applied')).toBe(false);
  });

  it('the AutomationSystem is registered at slot #9 in the default registry', () => {
    const ids = defaultRegistry.ids();
    expect(ids[8]).toBe('AutomationSystem');
    expect(defaultRegistry.all()[8]!.id).toBe('AutomationSystem');
  });
});

// ---------- determinism ----------

describe('determinism', () => {
  it('same seed → same automation decisions + events', () => {
    const make = (): GameState => {
      let s = freshState();
      s = setSoilWater(s, 20);
      s = addAutomation(
        s,
        makeAutomation({
          id: 'det-auto',
          maintenanceCost: '1440',
          policy: soilThresholdPolicy(30, 7),
        }),
      );
      return s;
    };
    const a = engine.advance(make(), STEP);
    const b = engine.advance(make(), STEP);
    // Deep-equal state.
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    // Deep-equal events.
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
  });

  it('input state is never mutated by advance', () => {
    const state = setSoilWater(freshState(), 20);
    const sprinkler = makeAutomation({
      id: 'nomut',
      policy: soilThresholdPolicy(30, 5),
    });
    const withAuto = addAutomation(state, sprinkler);
    const snapshot = structuredClone(withAuto);
    engine.advance(withAuto, STEP);
    expect(JSON.stringify(withAuto)).toBe(JSON.stringify(snapshot));
  });
});

// ---------- originalTree guard ----------

describe('originalTree guard', () => {
  it('an automation targeting originalTree for sell-tree is rejected (no bypass)', () => {
    // Direct handler check: the action layer (P3c) throws
    // OriginalTreeNotTransferableError for sell-tree on 'original'. The
    // automation path calls dispatch, which routes to the same handler, so
    // the guard is enforced.
    let state = freshState();
    state = addAutomation(
      state,
      makeAutomation({
        id: 'sell-guard',
        policy: {
          kind: 'threshold',
          condition: { field: 'originalTree.health', op: '>', value: 0 },
          action: 'sell-tree',
          actionParams: { target: 'original' },
        },
      }),
    );
    const result = executeAutomation(state, state.automation[0]!, {
      now: STEP,
      stepSeconds: STEP,
      rng: Rng.fromSeed(1),
    });
    // The automation was skipped (graceful), not triggered.
    expect(result.events.some((e) => e.type === 'automation-skipped')).toBe(true);
    expect(result.events.some((e) => e.type === 'automation-triggered')).toBe(false);
    // The original tree is untouched.
    expect(result.state.originalTree.id).toBe('original');
    expect(result.state.originalTree.isOriginal).toBe(true);
    // lastRunAt NOT advanced (so it retries, but will keep being rejected).
    expect(result.state.automation[0]!.lastRunAt).toBe(0);
  });

  it('sell-tree action on original throws OriginalTreeNotTransferableError (action-layer invariant)', () => {
    const state = freshState();
    expect(() =>
      engine.executeAction(state, {
        type: 'sell-tree',
        payload: { target: 'original' },
      }),
    ).toThrow(OriginalTreeNotTransferableError);
  });
});
