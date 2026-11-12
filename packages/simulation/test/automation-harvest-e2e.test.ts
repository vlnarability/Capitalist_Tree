/**
 * Automated harvesting end-to-end integration test (P6c — TDD §12, §14.4,
 * §18.1, §18.3; GDD §5.4, §9, §342).
 *
 * Verifies the FULL automated-harvesting pipeline across two simulation
 * steps, exercising every link in the chain that P1/P3a/P6b1/P6b2 built:
 *
 *   tick N (AutomationSystem, registry slot #9):
 *     threshold policy fires
 *       → executeAutomation dispatches the `harvest-leaves` GameAction
 *         through the normal action pipeline (actions/handlers.ts)
 *       → harvestLeavesHandler calls biology/harvest.harvestLeaves
 *       → CurrencyIssuanceRequest queued on originalTree.pendingIssuances
 *       → harvest-completed + automation-triggered events emitted
 *
 *   tick N+1 (EconomySystem, registry slot #6 — runs BEFORE AutomationSystem):
 *     drainPendingIssuances consumes the queued request
 *       → requestIssuance credits player:personal via the ledger
 *       → player.personalCash increases (mirrored from the account balance)
 *       → issuance-authorized + transaction-recorded events emitted
 *       → requestId recorded in economy.processedRequestIds (idempotency)
 *
 * Registry order note: the AutomationSystem (slot #9) runs AFTER the
 * EconomySystem (slot #6) in the same step. So an issuance queued by an
 * automated harvest this tick is NOT drained until the NEXT tick's
 * EconomySystem run — the test advances two steps to observe the full chain.
 *
 * ---------------------------------------------------------------------------
 * CARRY-FORWARD NOTE — two task-description substitutions (documented):
 *
 *   1. Action name. The task brief says `action: 'harvest'`, but the
 *      canonical registered GameAction type is `'harvest-leaves'` (P1 — see
 *      `packages/simulation/src/actions/handlers.ts` `actionHandlers` map +
 *      the automation-policy schema doc in
 *      `packages/shared/src/schemas/automation.ts` which lists
 *      `'harvest-leaves'` as the example action string). The harvester
 *      equipment's `supportedActions` is `['harvest-leaves']`
 *      (`packages/content/src/equipment/harvesting.ts`). No `'harvest'`
 *      alias was added: the schema doc canonically names this action
 *      `'harvest-leaves'`, and a redundant alias would contradict that
 *      documentation. The pipeline has NO registration gap — see the
 *      "pipeline registration" test below which asserts both registrations.
 *
 *   2. Threshold field. The task brief says `field: 'originalTree.maturity'`,
 *      but `TreeState` has no `maturity` field (GDD §17 lists tree-maturity
 *      semantics as unresolved; the harvester equipment's
 *      `unlockRequirements.minTreeMaturity` is content metadata, not a
 *      TreeState field). Adding a `maturity` field would be a schema change,
 *      out of P6c scope ("NO new schemas/systems"). The test uses
 *      `originalTree.foliage.currentLeaves` as the threshold proxy for "the
 *      tree has a mature canopy ready to harvest" — a stable, numeric,
 *      existing field that stays true across ticks (1000 leaves → 990 after
 *      a 10-leaf harvest, still ≥ the 100-leaf threshold).
 *
 * Conservation invariant (TDD §10.4) is checked after every money-moving
 * operation: `sum(balances) + totalSinks === initialSupply + totalIssued`.
 */
import { describe, it, expect } from 'vitest';
import { engine } from '../src/index.js';
import { DEFAULT_GAME_CONFIG } from '../src/initial-state.js';
import { actionHandlers } from '../src/actions/index.js';
import { drainPendingIssuances } from '../src/economy/index.js';
import { conservationDiscrepancy } from '../src/economy/index.js';
import {
  HARVESTER_T1,
  DEFAULT_ISSUANCE_POLICY,
  WHITE_OAK,
} from '@capitalist-tree/content';
import {
  type GameState,
  type GameConfig,
  type AutomationPolicy,
  type SimulationEvent,
  PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
  PROVISIONAL_SIMULATION_STEP_SECONDS as STEP,
} from '@capitalist-tree/shared';

// ---------- helpers ----------

function cfg(seed: number): GameConfig {
  return { ...DEFAULT_GAME_CONFIG, seed, createdAt: 0 };
}

/** Starting cash string ('50000' minor units = $500.00). */
const INITIAL_SUPPLY = DEFAULT_GAME_CONFIG.startingPersonalCash;

/**
 * Build a mature originalTree state for the e2e test.
 *
 * Starts from a real `engine.initialize()` (so rngState, markets, the account
 * ledger, processedRequestIds, and totalIssued/totalSinks are all valid) and
 * fast-forwards the tree to a mature canopy: 1000 leaves, full health, ample
 * reserves/water/nutrients, low stress, and a high branchDevelopment so the
 * BiologySystem's recomputed leafCapacity (200 + branchDevelopment×100) keeps
 * `maxSupportedLeaves` well above 1000 across seasons — the canopy is never
 * senesced below the threshold during the two-tick run.
 *
 * Pure + deterministic given the seed.
 */
function matureState(seed = 42): GameState {
  const state = engine.initialize(cfg(seed));
  const tree = state.originalTree;
  // High branchDevelopment → leafCapacity = 200 + 50×100 = 5200. Even at
  // seasonalCondition 0.2 (deep winter), maxSupportedLeaves = 1040 ≥ 1000.
  tree.structure = {
    ...tree.structure,
    height: 5,
    trunkDiameter: 0.2,
    branchDevelopment: 50,
    structuralIntegrity: 1,
  };
  tree.foliage = {
    ...tree.foliage,
    currentLeaves: 1000,
    leafCapacity: 5200,
    activeLeafArea: 1000 * WHITE_OAK.leafAreaPerLeaf,
    seasonalCondition: 1,
    leafGrowthProgress: 0,
  };
  tree.roots = { ...tree.roots, development: 0.5, absorptionCapacity: 0.5 };
  tree.energy = { ...tree.energy, reserves: 500, production: 0, consumption: 0 };
  tree.water = { stored: 25, capacity: 50 };
  tree.nutrients = { nitrogen: 5, phosphorus: 2, potassium: 4 };
  tree.health = 1;
  tree.stress = 0;
  tree.ageDays = 100;
  tree.damage = [];
  tree.pendingIssuances = [];
  // Ample soil water + nutrients so the tree doesn't drought-stress between
  // ticks (keeps the threshold stable + the tree alive for the 2-step run).
  state.world.environment.soil.soilWater = 100;
  state.world.environment.soil.nutrients = { nitrogen: 50, phosphorus: 50, potassium: 50 };
  return state;
}

/**
 * Threshold policy: harvest `requestedLeaves` when the canopy has at least
 * `value` leaves. Uses `originalTree.foliage.currentLeaves` as the maturity
 * proxy (see the carry-forward note in the file header).
 *
 * `action: 'harvest-leaves'` is the canonical registered GameAction type
 * (P1) — the harvester's `supportedActions` includes it, so
 * `set-automation-policy` accepts the policy.
 */
function harvestThresholdPolicy(value: number, requestedLeaves: number): AutomationPolicy {
  return {
    kind: 'threshold',
    condition: {
      field: 'originalTree.foliage.currentLeaves',
      op: '>=',
      value,
    },
    action: 'harvest-leaves',
    actionParams: { treeId: 'original', requestedLeaves },
  };
}

/**
 * Purchase a harvester targeting the original tree, then attach a threshold
 * policy — mirrors the real player flow (two GameActions through the normal
 * dispatch pipeline, not direct state mutation). Returns the configured
 * state with the harvester automation appended + policy set.
 */
function purchaseAndConfigureHarvester(
  state: GameState,
  policy: AutomationPolicy,
): GameState {
  // 1. purchase-equipment: debits cost, adds an automation with
  //    type = equipment id (so set-automation-policy can resolve + validate).
  const purchased = engine.executeAction(state, {
    type: 'purchase-equipment',
    payload: { equipmentId: HARVESTER_T1.id, targetId: 'original' },
  });
  const automationId =
    purchased.state.automation[purchased.state.automation.length - 1]!.id;
  // 2. set-automation-policy: validates `harvest-leaves` is in the harvester's
  //    supportedActions + `threshold` is in supportedPolicies, then stores it.
  const configured = engine.executeAction(purchased.state, {
    type: 'set-automation-policy',
    payload: { automationId, policy },
  });
  return configured.state;
}

/** Conservation invariant helper (TDD §10.4). */
function assertConservation(state: GameState, message: string): void {
  const disc = conservationDiscrepancy(state, INITIAL_SUPPLY);
  expect(disc, message).toBe(0n);
}

/** Narrow a SimulationEvent to a specific variant by type (TS discriminated
 *  union narrowing — vitest's `expect.toBeDefined()` does not narrow). */
function eventsOfType(events: readonly SimulationEvent[], type: string): SimulationEvent[] {
  return events.filter((e) => e.type === type);
}

// ---------- the full e2e chain ----------

describe('automated harvesting e2e', () => {
  it('full chain: automation fires harvest → issuance queued → next-tick economy drain → player credited', () => {
    const requestedLeaves = 10;
    // leafDenominationMinor = '100' (=$1.00/leaf); 10 leaves → 1000 minor units.
    const expectedIssuance = BigInt(requestedLeaves) * BigInt(WHITE_OAK.leafDenominationMinor);
    const harvesterCost = BigInt(HARVESTER_T1.cost); // 1000 minor units

    // --- setup: mature tree + purchased + configured harvester ---
    let state = matureState();
    const cashStart = BigInt(state.player.personalCash); // 50000
    state = purchaseAndConfigureHarvester(state, harvestThresholdPolicy(100, requestedLeaves));
    const cashAfterPurchase = BigInt(state.player.personalCash); // 49000
    expect(cashStart - cashAfterPurchase).toBe(harvesterCost);
    assertConservation(state, 'purchase preserves conservation');

    // --- tick 1: AutomationSystem (slot #9) fires the harvest ---
    // EconomySystem (slot #6) already ran this tick with an empty queue, so
    // the issuance queued here is NOT drained until tick 2.
    const r1 = engine.advance(state, STEP);
    state = r1.state;

    // automation-triggered: the policy fired.
    const triggered1 = eventsOfType(r1.events, 'automation-triggered');
    expect(triggered1.length).toBe(1);
    expect(triggered1[0]!.payload.actionExecuted).toBe('harvest-leaves');

    // harvest-completed: the dispatched harvest-leaves action ran.
    const harvestCompleted1 = eventsOfType(r1.events, 'harvest-completed');
    expect(harvestCompleted1.length).toBe(1);
    if (harvestCompleted1[0]!.type === 'harvest-completed') {
      expect(harvestCompleted1[0]!.payload.result.leavesHarvested).toBe(requestedLeaves);
      expect(harvestCompleted1[0]!.payload.result.currencyIssuance.amount).toBe(
        expectedIssuance.toString(),
      );
    }

    // CurrencyIssuanceRequest queued on originalTree.pendingIssuances.
    expect(state.originalTree.pendingIssuances.length).toBe(1);
    expect(state.originalTree.pendingIssuances[0]!.amount).toBe(expectedIssuance.toString());
    expect(state.originalTree.pendingIssuances[0]!.source).toBe('harvest-leaves');

    // Player NOT yet credited (issuance pending — EconomySystem drained an
    // empty queue this tick).
    expect(BigInt(state.player.personalCash)).toBe(cashAfterPurchase);

    // No issuance-authorized yet.
    expect(eventsOfType(r1.events, 'issuance-authorized').length).toBe(0);

    // --- tick 2: EconomySystem (slot #6) drains the queued issuance ---
    // Runs BEFORE AutomationSystem, so the tick-1 issuance is drained here.
    const r2 = engine.advance(state, STEP);
    state = r2.state;

    // issuance-authorized: the authority credited the player.
    const authorized = eventsOfType(r2.events, 'issuance-authorized');
    expect(authorized.length).toBe(1);
    if (authorized[0]!.type === 'issuance-authorized') {
      expect(authorized[0]!.payload.amount).toBe(expectedIssuance.toString());
      expect(authorized[0]!.payload.destinationAccount).toBe(
        PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
      );
      expect(authorized[0]!.payload.source).toBe('harvest-leaves');
      // Deterministic requestId: issuance:<saveId>:<simSecond>:<index>.
      // simSecond = 120 (tick 2's ctx.now = 2 × STEP), index = 0.
      expect(authorized[0]!.payload.requestId).toBe(
        `issuance:${state.metadata.saveId}:120:0`,
      );
    }

    // transaction-recorded: the ledger appended the issuance transfer.
    const txns = eventsOfType(r2.events, 'transaction-recorded');
    expect(txns.length).toBeGreaterThanOrEqual(1);

    // Player credited the issuance amount (cash went up by 1000).
    const cashAfterDrain = BigInt(state.player.personalCash);
    expect(cashAfterDrain - cashAfterPurchase).toBe(expectedIssuance);

    // The issuance requestId is recorded in processedRequestIds (idempotency
    // net — a re-processed request would be rejected as duplicate).
    expect(state.economy.processedRequestIds).toContain(
      `issuance:${state.metadata.saveId}:120:0`,
    );
    // totalIssued increased by the issuance amount.
    expect(BigInt(state.economy.totalIssued)).toBe(expectedIssuance);

    // Conservation holds across both ticks.
    assertConservation(state, 'full chain preserves conservation');

    // The tree is still alive (a healthy mature tree survives a 10-leaf harvest).
    expect(state.originalTree.alive).toBe(true);
    // Foliage decreased by the harvested leaves (± BiologySystem growth).
    expect(state.originalTree.foliage.currentLeaves).toBeLessThan(1000);
  });

  // ---------- idempotency ----------

  it('idempotency via cooldown: after firing, a subsequent tick is cooldown-blocked', () => {
    // Cooldown prevents a persistently-true threshold from firing every tick.
    // The automation fires once (tick 1), then on the next tick — threshold
    // still met — it is skipped with reason 'cooldown': no second harvest, no
    // second issuance queued. The EconomySystem still drains the tick-1
    // issuance on tick 2 (it runs at slot #6, before the cooldown-skipped
    // AutomationSystem at slot #9).
    //
    // NOTE on cooldown semantics: evaluatePolicy blocks when
    // `lastRunAt + cooldownSeconds > now`. A freshly-purchased automation has
    // `lastRunAt = 0`, so ANY cooldown > STEP would also block the FIRST tick
    // (the cooldown window starts at game-start time 0, not at a first run).
    // To demonstrate "fires, then cooldown-blocks the next" cleanly, tick 1
    // runs with cooldown=0 (fires, lastRunAt → STEP), then the cooldown is
    // armed between ticks so tick 2 is blocked. Mutating state between
    // advances is valid — the engine is pure (TDD §4.1).
    const requestedLeaves = 10;
    let state = matureState();
    state = purchaseAndConfigureHarvester(state, harvestThresholdPolicy(100, requestedLeaves));
    const automationId = state.automation[state.automation.length - 1]!.id;

    // Tick 1: fires (lastRunAt=0, cooldown=0 → not blocked).
    const r1 = engine.advance(state, STEP);
    expect(eventsOfType(r1.events, 'automation-triggered').length).toBe(1);
    expect(eventsOfType(r1.events, 'harvest-completed').length).toBe(1);
    expect(r1.state.originalTree.pendingIssuances.length).toBe(1);

    // Arm the cooldown between ticks: lastRunAt is now STEP (60); set
    // cooldown = 2×STEP (120) → 60 + 120 = 180 > 120 (tick 2's now) → blocked.
    const tick1State: GameState = {
      ...r1.state,
      automation: r1.state.automation.map((a) =>
        a.id === automationId ? { ...a, cooldownSeconds: 2 * STEP } : a,
      ),
    };

    // Tick 2: EconomySystem drains the tick-1 issuance (slot #6); the
    // AutomationSystem (slot #9) is cooldown-blocked — no second harvest.
    const r2 = engine.advance(tick1State, STEP);
    expect(eventsOfType(r2.events, 'issuance-authorized').length).toBe(1);
    const skipped = r2.events.find(
      (e) => e.type === 'automation-skipped' && e.payload.reason === 'cooldown',
    );
    expect(skipped).toBeDefined();
    expect(eventsOfType(r2.events, 'automation-triggered').length).toBe(0);
    expect(eventsOfType(r2.events, 'harvest-completed').length).toBe(0);
    // No NEW pendingIssuance queued; the tick-1 issuance was drained.
    expect(r2.state.originalTree.pendingIssuances.length).toBe(0);

    // Across both ticks, exactly ONE issuance was ever authorized.
    const allIssuances = [
      ...eventsOfType(r1.events, 'issuance-authorized'),
      ...eventsOfType(r2.events, 'issuance-authorized'),
    ];
    expect(allIssuances.length).toBe(1);

    // Conservation holds.
    assertConservation(r2.state, 'cooldown idempotency preserves conservation');
  });

  it('idempotency via authority dedup: a re-processed issuance is rejected (duplicate-request)', () => {
    // The authority's `processedRequestIds` is the defensive idempotency net
    // (TDD §10.3 — "Currency production must be accounted for exactly once").
    // If the SAME pendingIssuance is re-processed at the SAME simSecond (e.g.
    // a save/load replay where the save landed after the harvest queued the
    // request but before the EconomySystem drained it), the deterministic
    // requestId collides and the second processing is rejected — no money
    // double-issued.
    const requestedLeaves = 10;
    const expectedIssuance = BigInt(requestedLeaves) * BigInt(WHITE_OAK.leafDenominationMinor);

    // Tick 1: automation fires → pendingIssuance queued.
    let state = matureState();
    state = purchaseAndConfigureHarvester(state, harvestThresholdPolicy(100, requestedLeaves));
    const r1 = engine.advance(state, STEP);
    state = r1.state;
    expect(state.originalTree.pendingIssuances.length).toBe(1);
    const queued = state.originalTree.pendingIssuances[0]!;

    // First drain at simSecond = 120 (tick 2's ctx.now): authorizes.
    const saveId = state.metadata.saveId;
    const drain1 = drainPendingIssuances(state, state.originalTree, saveId, 120, {
      policy: DEFAULT_ISSUANCE_POLICY,
    });
    expect(eventsOfType(drain1.events, 'issuance-authorized').length).toBe(1);
    expect(drain1.state.originalTree.pendingIssuances.length).toBe(0);
    const cashAfterDrain1 = BigInt(drain1.state.player.personalCash);
    const issuedAfterDrain1 = BigInt(drain1.state.economy.totalIssued);

    // Simulate a save/load replay: re-queue the SAME issuance (the save
    // captured it before the drain) and re-process at the SAME simSecond.
    const replayed: GameState = {
      ...drain1.state,
      originalTree: { ...drain1.state.originalTree, pendingIssuances: [queued] },
    };
    const drain2 = drainPendingIssuances(replayed, replayed.originalTree, saveId, 120, {
      policy: DEFAULT_ISSUANCE_POLICY,
    });

    // The duplicate requestId is rejected — no money moved, no double-issuance.
    const rejected = drain2.events.find(
      (e) => e.type === 'issuance-rejected' && e.payload.reason === 'duplicate-request',
    );
    expect(rejected).toBeDefined();
    expect(eventsOfType(drain2.events, 'issuance-authorized').length).toBe(0);
    expect(BigInt(drain2.state.player.personalCash)).toBe(cashAfterDrain1);
    expect(BigInt(drain2.state.economy.totalIssued)).toBe(issuedAfterDrain1);

    // The expected issuance was credited exactly once (not doubled).
    expect(issuedAfterDrain1).toBe(expectedIssuance);
    // Conservation holds on the replayed state too.
    assertConservation(drain2.state, 'authority dedup preserves conservation');
  });

  // ---------- determinism ----------

  it('determinism: same seed → same issuance amount + same events', () => {
    const make = (): GameState =>
      purchaseAndConfigureHarvester(matureState(42), harvestThresholdPolicy(100, 10));

    // Advance two steps (harvest on tick 1, economy drain on tick 2).
    const run = (): { state: GameState; events: readonly SimulationEvent[] } => {
      const r1 = engine.advance(make(), STEP);
      const r2 = engine.advance(r1.state, STEP);
      return { state: r2.state, events: [...r1.events, ...r2.events] };
    };
    const a = run();
    const b = run();

    // Deep-equal state + events (determinism — TDD §18.3).
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));

    // Sanity: the chain completed — an issuance was authorized on tick 2.
    const authorized = eventsOfType(a.events, 'issuance-authorized');
    expect(authorized.length).toBe(1);
    // The issuance amount is deterministic: 10 leaves × '100' = '1000'.
    if (authorized[0]!.type === 'issuance-authorized') {
      expect(authorized[0]!.payload.amount).toBe('1000');
    }
  });

  it('input state is never mutated by advance (purity)', () => {
    const state = purchaseAndConfigureHarvester(matureState(42), harvestThresholdPolicy(100, 10));
    const snapshot = structuredClone(state);
    engine.advance(engine.advance(state, STEP).state, STEP);
    expect(JSON.stringify(state)).toBe(JSON.stringify(snapshot));
  });

  // ---------- pipeline registration (carry-forward check #3) ----------

  it('pipeline registration: harvest-leaves is registered as an action AND in the harvester supportedActions', () => {
    // Carry-forward verification (P6c scope item #3):
    //   1. The harvest action is registered in the action dispatch.
    //   2. The harvester equipment's supportedActions includes it.
    // Both hold under the canonical name 'harvest-leaves' (P1). No 'harvest'
    // alias exists or is needed — the schema doc canonically names this
    // action 'harvest-leaves' (see
    // packages/shared/src/schemas/automation.ts action-field doc).
    expect(actionHandlers['harvest-leaves']).toBeDefined();
    expect(HARVESTER_T1.supportedActions).toContain('harvest-leaves');
    // The harvester accepts threshold policies (the kind used in this e2e).
    expect(HARVESTER_T1.supportedPolicies).toContain('threshold');

    // End-to-end dispatchability: a harvest-leaves action routed through the
    // normal dispatch reaches the harvest handler (it queues an issuance
    // rather than throwing UnknownActionError).
    const state = matureState();
    const result = engine.executeAction(state, {
      type: 'harvest-leaves',
      payload: { treeId: 'original', requestedLeaves: 5 },
    });
    expect(eventsOfType(result.events, 'harvest-completed').length).toBe(1);
    expect(result.state.originalTree.pendingIssuances.length).toBe(1);
  });
});
