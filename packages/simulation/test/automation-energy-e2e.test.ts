/**
 * Automation energy end-to-end integration tests (P7c — TDD §12, §18.1, §18.3,
 * §18.4; GDD §9, §9.1, §28, §59–67; resolves R-P6-3 / R-P6-6).
 *
 * Exercises the FULL energy-pool chain the P7c wiring connects:
 *
 *   solar-panel automation (enabled)
 *     → AutomationSystem pre-pass banks passive generation into energy.stored
 *       (slot #9, every tick — generation is continuous, not on the fire
 *       cadence)
 *     → energy-hungry automation fires (threshold met + pool covers the draw)
 *       → executeAutomation debits the per-fire draw from energy.stored
 *     → when the pool drops below the per-fire draw, the hungry automation is
 *       skipped with reason `insufficient-resources` (the frozen reason enum
 *       has no `insufficient-energy` variant — energy IS a resource),
 *       `lastRunAt` NOT advanced (retries when the pool is replenished)
 *
 * The solar-generation magnitude depends on the WeatherSystem's just-rolled
 * condition (lightFactorMultiplier), which is stochastic per tick — so the
 * solar assertion uses a WITH-vs-WITHOUT control comparison (the weather +
 * baseline cancel in the delta, leaving purely the solar contribution, which
 * is > 0 for any daytime non-zero-light condition). The fire→debit→deplete→
 * skip chain is driven on a pre-charged pool (no solar) so it is fully
 * deterministic + observable in three ticks.
 *
 * Also covers the resourceConsumption derivation (R-P6-6): purchasing
 * irrigation / fertilization / harvesting / energy / monitoring equipment
 * derives the array from `supportedActions` (irrigation → resource:water,
 * fertilization → resource:fertilizer, the rest → []).
 *
 * Conservation invariant (TDD §10.4) is checked after every money-moving
 * operation. Determinism (TDD §18.3) + purity (TDD §4.1) asserted at the end.
 */
import { describe, it, expect } from 'vitest';
import { engine } from '../src/index.js';
import { DEFAULT_GAME_CONFIG } from '../src/initial-state.js';
import { conservationDiscrepancy } from '../src/economy/index.js';
import {
  SPRINKLER_T1,
  SPREADER_T1,
  HARVESTER_T1,
  SOLAR_PANEL,
  SOIL_SENSOR,
} from '@capitalist-tree/content';
import {
  type GameState,
  type GameConfig,
  type AutomationState,
  type AutomationPolicy,
  type SimulationEvent,
  PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
  PROVISIONAL_ENERGY_SOLAR_GENERATION_RATE,
  PROVISIONAL_SIMULATION_STEP_SECONDS as STEP,
} from '@capitalist-tree/shared';

const SECONDS_PER_DAY = 24 * 60 * 60;
const INITIAL_SUPPLY = DEFAULT_GAME_CONFIG.startingPersonalCash;

// ---------- helpers ----------

function cfg(seed: number): GameConfig {
  return { ...DEFAULT_GAME_CONFIG, seed, createdAt: 0 };
}

function freshState(seed = 42): GameState {
  return engine.initialize(cfg(seed));
}

/** Build an AutomationState with sensible test defaults. */
function makeAutomation(overrides: Partial<AutomationState> & { id: string }): AutomationState {
  return {
    type: 'test-automation',
    enabled: true,
    targetId: 'original',
    schedule: { kind: 'interval', value: STEP },
    resourceConsumption: [],
    energyConsumption: 0,
    maintenanceCost: '0',
    environmentalImpact: {
      carbonEmissions: 0,
      waterConsumption: 0,
      soilDegradation: 0,
      pollution: 0,
      landDisturbance: 0,
      biodiversityImpact: 0,
    },
    ...overrides,
  };
}

/** Threshold policy that fires every tick (clock.elapsedSeconds > 0 after the
 *  first TimeSystem step). Deterministic + independent of biology / weather /
 *  soil water, so the energy chain is observable in isolation. action='no-op'
 *  (registered handler) — the hungry automation does nothing but fire + debit. */
function alwaysFiresPolicy(action: string): AutomationPolicy {
  return {
    kind: 'threshold',
    condition: { field: 'clock.elapsedSeconds', op: '>', value: 0 },
    action,
    actionParams: {},
  };
}

function setEnergy(state: GameState, stored: number, capacity = 100): GameState {
  const next = structuredClone(state);
  next.world.environment.energy = {
    ...next.world.environment.energy,
    stored,
    capacity,
  };
  return next;
}

function addAutomation(state: GameState, automation: AutomationState): GameState {
  return { ...state, automation: [...state.automation, automation] };
}

function purchaseEquipment(
  state: GameState,
  equipmentId: string,
): { state: GameState; automationId: string } {
  const result = engine.executeAction(state, {
    type: 'purchase-equipment',
    payload: { equipmentId, targetId: 'original' },
  });
  const automationId = result.state.automation[result.state.automation.length - 1]!.id;
  return { state: result.state, automationId };
}

function assertConservation(state: GameState, message: string): void {
  expect(conservationDiscrepancy(state, INITIAL_SUPPLY), message).toBe(0n);
}

function eventsOfType(events: readonly SimulationEvent[], type: string): SimulationEvent[] {
  return events.filter((e) => e.type === type);
}

// ---------------------------------------------------------------------------
// resourceConsumption derivation (R-P6-6)
// ---------------------------------------------------------------------------

describe('resourceConsumption derivation at purchase (R-P6-6)', () => {
  it('irrigation equipment → resource:water', () => {
    const { state } = purchaseEquipment(freshState(), SPRINKLER_T1.id);
    const automation = state.automation[state.automation.length - 1]!;
    expect(automation.resourceConsumption).toEqual([
      { resourceId: 'resource:water', amount: 5 },
    ]);
  });

  it('fertilization equipment → resource:fertilizer', () => {
    const { state } = purchaseEquipment(freshState(), SPREADER_T1.id);
    const automation = state.automation[state.automation.length - 1]!;
    expect(automation.resourceConsumption).toEqual([
      { resourceId: 'resource:fertilizer', amount: 1 },
    ]);
  });

  it('harvesting equipment → [] (produces currency, consumes no inventory resource)', () => {
    const { state } = purchaseEquipment(freshState(), HARVESTER_T1.id);
    const automation = state.automation[state.automation.length - 1]!;
    expect(automation.resourceConsumption).toEqual([]);
  });

  it('energy + monitoring equipment (empty supportedActions) → []', () => {
    const solar = purchaseEquipment(freshState(), SOLAR_PANEL.id).state;
    expect(solar.automation[solar.automation.length - 1]!.resourceConsumption).toEqual([]);
    const sensor = purchaseEquipment(freshState(), SOIL_SENSOR.id).state;
    expect(sensor.automation[sensor.automation.length - 1]!.resourceConsumption).toEqual([]);
  });

  it('purchase preserves conservation (money sinks to authority)', () => {
    const { state } = purchaseEquipment(freshState(), SPRINKLER_T1.id);
    assertConservation(state, 'sprinkler purchase preserves conservation');
  });
});

// ---------------------------------------------------------------------------
// solar generation e2e (control comparison — deterministic sign)
// ---------------------------------------------------------------------------

describe('solar generation e2e (AutomationSystem pre-pass)', () => {
  it('an enabled solar-panel banks generation each tick (delta vs a no-solar control > 0)', () => {
    // Both states start with stored=50 so the EnvironmentSystem baseline debit
    // (same for both) cancels in the delta. ctx.now = STEP = 60 → daytime
    // (60 % 86400 < 43200); every weather condition has lightFactor > 0, so the
    // solar contribution is strictly positive regardless of the WeatherSystem's
    // just-rolled condition.
    const baseNoSolar = setEnergy(freshState(), 50);
    const baseWithSolar = addAutomation(
      setEnergy(freshState(), 50),
      makeAutomation({ id: 'solar-panel-1', type: SOLAR_PANEL.id }),
    );

    const without = engine.advance(baseNoSolar, STEP);
    const withSolar = engine.advance(baseWithSolar, STEP);

    const delta =
      withSolar.state.world.environment.energy.stored -
      without.state.world.environment.energy.stored;
    // The delta is purely the solar generation this tick (> 0 daytime).
    expect(delta).toBeGreaterThan(0);
    // Upper bound: 1 panel × rate × dtDays × max daylightFactor (1.0).
    const upperBound = PROVISIONAL_ENERGY_SOLAR_GENERATION_RATE * 1 * (STEP / SECONDS_PER_DAY) * 1.0;
    expect(delta).toBeLessThanOrEqual(upperBound + 1e-9);
  });
});

// ---------------------------------------------------------------------------
// energy debit → deplete → skip chain (deterministic, pre-charged pool)
// ---------------------------------------------------------------------------

describe('energy-hungry automation: fire → debit → deplete → skip (R-P6-3)', () => {
  it('fires + debits while the pool covers the draw, then skips when depleted', () => {
    // Pre-charge the pool to 3.0 (simulating prior solar generation). The
    // hungry automation draws 1.0/fire (energyConsumption=1440/day × 60/86400).
    // No solar panels → no generation → the pool only drains. The chain:
    //   tick 1: stored 3.0 → fires, debits 1.0 → ~1.99 (after baseline)
    //   tick 2: stored ~1.99 → fires, debits 1.0 → ~0.99 (after baseline)
    //   tick 3: stored ~0.99 < 1.0 draw → skipped (insufficient-resources)
    const hungry = makeAutomation({
      id: 'hungry',
      energyConsumption: 1440, // per-fire draw = 1.0
      policy: alwaysFiresPolicy('no-op'),
    });
    let state = addAutomation(setEnergy(freshState(), 3.0), hungry);

    // --- tick 1: fires (stored 3.0 ≥ 1.0) ---
    const r1 = engine.advance(state, STEP);
    state = r1.state;
    const t1 = eventsOfType(r1.events, 'automation-triggered');
    const s1 = r1.events.find(
      (e) => e.type === 'automation-skipped' && e.payload.reason === 'insufficient-resources',
    );
    expect(t1.length).toBe(1);
    expect(s1).toBeUndefined();
    expect(state.world.environment.energy.stored).toBeLessThan(3.0); // debited
    expect(state.world.environment.energy.stored).toBeGreaterThan(1.0); // still enough for next

    // --- tick 2: fires again (stored ~1.99 ≥ 1.0) ---
    const r2 = engine.advance(state, STEP);
    state = r2.state;
    const t2 = eventsOfType(r2.events, 'automation-triggered');
    expect(t2.length).toBe(1);
    expect(state.world.environment.energy.stored).toBeLessThan(1.0); // now depleted below the draw

    // --- tick 3: depleted → skipped (insufficient-resources), lastRunAt NOT
    //     advanced on the skipped tick (it WAS advanced on ticks 1+2) ---
    const lastRunAtAfterTick2 = state.automation.find((a) => a.id === 'hungry')!.lastRunAt;
    const r3 = engine.advance(state, STEP);
    state = r3.state;
    const t3 = eventsOfType(r3.events, 'automation-triggered');
    const s3 = r3.events.find(
      (e) => e.type === 'automation-skipped' && e.payload.reason === 'insufficient-resources',
    );
    expect(t3.length).toBe(0); // did NOT fire
    expect(s3).toBeDefined(); // skipped for energy
    // lastRunAt unchanged from tick 2 (the skip does not advance it).
    expect(state.automation.find((a) => a.id === 'hungry')!.lastRunAt).toBe(lastRunAtAfterTick2);
  });

  it('a depleted hungry automation resumes firing once the pool is recharged', () => {
    // Recharging simulates solar banking energy: manually top up the pool mid-
    // run (the engine is pure — mutating state between advances is valid,
    // TDD §4.1, mirroring the harvest e2e's cooldown-arming pattern).
    const hungry = makeAutomation({
      id: 'hungry-resume',
      energyConsumption: 1440,
      policy: alwaysFiresPolicy('no-op'),
    });
    let state = addAutomation(setEnergy(freshState(), 0.5), hungry); // below the 1.0 draw

    // Tick 1: depleted → skipped.
    const r1 = engine.advance(state, STEP);
    state = r1.state;
    expect(eventsOfType(r1.events, 'automation-triggered').length).toBe(0);
    expect(
      r1.events.find(
        (e) => e.type === 'automation-skipped' && e.payload.reason === 'insufficient-resources',
      ),
    ).toBeDefined();

    // Recharge the pool (as if solar banked surplus).
    state = setEnergy(state, 5.0);

    // Tick 2: pool covers the draw → fires again.
    const r2 = engine.advance(state, STEP);
    expect(eventsOfType(r2.events, 'automation-triggered').length).toBe(1);
    expect(
      r2.events.find(
        (e) => e.type === 'automation-skipped' && e.payload.reason === 'insufficient-resources',
      ),
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// full chain: solar generates + hungry consumes (control comparison)
// ---------------------------------------------------------------------------

describe('full chain: solar generation offsets hungry consumption', () => {
  it('a solar-panel + hungry automation run banks more energy than a hungry-only run', () => {
    // Both runs carry the same hungry automation. The with-solar run ALSO has
    // a solar-panel. The with-solar run's stored is higher (solar generation
    // offsets some of the hungry debit) — the delta is the net solar
    // contribution (> 0 daytime). The weather + baseline cancel in the delta.
    const hungry = makeAutomation({
      id: 'hungry-chain',
      energyConsumption: 1440, // 1.0/fire
      policy: alwaysFiresPolicy('no-op'),
    });
    const baseHungryOnly = addAutomation(setEnergy(freshState(), 50), hungry);
    const baseWithSolar = addAutomation(
      addAutomation(setEnergy(freshState(), 50), hungry),
      makeAutomation({ id: 'solar-chain', type: SOLAR_PANEL.id }),
    );

    const rHungry = engine.advance(baseHungryOnly, STEP);
    const rSolar = engine.advance(baseWithSolar, STEP);

    // Both runs fired the hungry automation (pool 50 >> 1.0 draw).
    expect(eventsOfType(rHungry.events, 'automation-triggered').length).toBeGreaterThanOrEqual(1);
    expect(eventsOfType(rSolar.events, 'automation-triggered').length).toBeGreaterThanOrEqual(1);

    // The with-solar run retained more energy (solar offset the hungry debit).
    expect(rSolar.state.world.environment.energy.stored).toBeGreaterThan(
      rHungry.state.world.environment.energy.stored,
    );
  });
});

// ---------------------------------------------------------------------------
// determinism + purity
// ---------------------------------------------------------------------------

describe('determinism + purity', () => {
  it('same seed → same energy state + events across the chain', () => {
    const make = (): GameState => {
      const hungry = makeAutomation({
        id: 'det-hungry',
        energyConsumption: 1440,
        policy: alwaysFiresPolicy('no-op'),
      });
      return addAutomation(setEnergy(freshState(42), 3.0), hungry);
    };
    const run = (): { state: GameState; events: readonly SimulationEvent[] } => {
      const r1 = engine.advance(make(), STEP);
      const r2 = engine.advance(r1.state, STEP);
      return { state: r2.state, events: [...r1.events, ...r2.events] };
    };
    const a = run();
    const b = run();
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
  });

  it('input state is never mutated by advance (purity, TDD §4.1)', () => {
    const hungry = makeAutomation({
      id: 'nomut-hungry',
      energyConsumption: 1440,
      policy: alwaysFiresPolicy('no-op'),
    });
    const state = addAutomation(setEnergy(freshState(), 3.0), hungry);
    const snapshot = structuredClone(state);
    engine.advance(engine.advance(state, STEP).state, STEP);
    expect(JSON.stringify(state)).toBe(JSON.stringify(snapshot));
  });
});
