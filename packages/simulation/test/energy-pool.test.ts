/**
 * Energy pool wiring tests (P7c — TDD §18.1, §18.4; GDD §9.1, §28, §59–67;
 * resolves R-P6-3 from docs/offline-automation.md §6.3).
 *
 * Three layers:
 *
 *   1. Pure-helper tests — `computeEnergyDebit` / `hasEnergy` / `debitEnergy` /
 *      `daylightFactor` / `generateSolarEnergy` / `deriveEnergyCapacity` /
 *      `applyBaselineEnergyConsumption` (packages/simulation/src/environment/
 *      energy.ts). Pins the energy-pool math + clamping + daylight/day-night
 *      cycle in isolation.
 *   2. executeAutomation wiring — on-fire energy debit (stored decreases by
 *      the per-tick draw); insufficient pool → `automation-skipped` reason
 *      `insufficient-resources` (the frozen enum has no `insufficient-energy`
 *      variant), `lastRunAt` NOT advanced, stored unchanged.
 *   3. System integration (engine.advance) — the AutomationSystem solar
 *      pre-pass banks generation (compared against a no-solar control so the
 *      baseline consumption cancels); the EnvironmentSystem derives capacity
 *      from active batteries + applies the baseline ambient draw.
 *
 * Conservation: energy is never created from nothing — a no-solar, no-automation
 * pool with stored=0 stays at 0 (baseline clamps at 0); generation is bounded
 * by the panel count × daylight factor; storage is capped at capacity.
 */
import { describe, it, expect } from 'vitest';
import {
  engine,
  executeAutomation,
  computeEnergyDebit,
  hasEnergy,
  debitEnergy,
  daylightFactor,
  generateSolarEnergy,
  deriveEnergyCapacity,
  applyBaselineEnergyConsumption,
} from '../src/index.js';
import { DEFAULT_GAME_CONFIG } from '../src/initial-state.js';
import { Rng } from '../src/rng.js';
import { SOLAR_PANEL, BATTERY } from '@capitalist-tree/content';
import {
  type GameState,
  type GameConfig,
  type AutomationState,
  type AutomationPolicy,
  type EnvironmentalImpact,
  type EnvironmentState,
  type WeatherState,
  PROVISIONAL_ENERGY_BASELINE_CONSUMPTION,
  PROVISIONAL_ENERGY_SOLAR_GENERATION_RATE,
  PROVISIONAL_ENERGY_BATTERY_CAPACITY_DEFAULT,
  PROVISIONAL_SIMULATION_STEP_SECONDS as STEP,
} from '@capitalist-tree/shared';

const SECONDS_PER_DAY = 24 * 60 * 60;

// ---------- helpers ----------

function cfg(seed: number): GameConfig {
  return { ...DEFAULT_GAME_CONFIG, seed, createdAt: 0 };
}

function freshState(): GameState {
  return engine.initialize(cfg(42));
}

/** Build an AutomationState with sensible test defaults (mirrors automation.test.ts). */
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
    condition: { field: 'world.environment.soil.soilWater', op: '<', value },
    action: 'apply-water',
    actionParams: { litres },
  };
}

function setSoilWater(state: GameState, litres: number): GameState {
  const next = structuredClone(state);
  next.world.environment.soil.soilWater = litres;
  return next;
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

/** A minimal EnvironmentState fragment for the pure-helper energy tests. */
function envWith(stored: number, capacity = 100): EnvironmentState {
  // Only the energy field is exercised by the energy helpers; the rest can be
  // any schema-valid defaults. Reuse freshState's env as a base.
  const base = freshState().world.environment;
  return { ...base, energy: { ...base.energy, stored, capacity } };
}

function weather(condition: WeatherState['condition']): WeatherState {
  return { condition, temperature: 18, intensity: 0.5, prevCondition: null, daysInCondition: 0 };
}

// ---------------------------------------------------------------------------
// 1. Pure-helper tests
// ---------------------------------------------------------------------------

describe('computeEnergyDebit', () => {
  it('pro-rates the daily rate by the step fraction of a sim day', () => {
    // 1440/day × 60s/86400s = 1.0 energy-unit drawn this fire.
    expect(computeEnergyDebit(1440, 60)).toBeCloseTo(1.0, 10);
    // A full-day step draws the full daily rate.
    expect(computeEnergyDebit(10, SECONDS_PER_DAY)).toBeCloseTo(10, 10);
  });

  it('returns 0 for equipment that does not consume (energyConsumption <= 0)', () => {
    expect(computeEnergyDebit(0, STEP)).toBe(0);
    expect(computeEnergyDebit(-1, STEP)).toBe(0);
  });
});

describe('hasEnergy', () => {
  it('true when stored covers the per-fire draw', () => {
    expect(hasEnergy(envWith(10), 1440, 60)).toBe(true); // 10 >= 1.0
  });

  it('false when stored is short of the per-fire draw', () => {
    expect(hasEnergy(envWith(0.5), 1440, 60)).toBe(false); // 0.5 < 1.0
  });

  it('always true when the automation has no energy consumption', () => {
    expect(hasEnergy(envWith(0), 0, STEP)).toBe(true);
  });
});

describe('debitEnergy', () => {
  it('debits the per-fire draw, clamped at 0', () => {
    expect(debitEnergy(envWith(10), 1440, 60)).toBeCloseTo(9.0, 10); // 10 - 1.0
    // Cannot go negative.
    expect(debitEnergy(envWith(0.5), 1440, 60)).toBe(0); // 0.5 - 1.0 → clamped
  });

  it('no debit when energyConsumption <= 0', () => {
    expect(debitEnergy(envWith(10), 0, STEP)).toBe(10);
  });
});

describe('daylightFactor', () => {
  it('sunny daytime → full sun (1.0)', () => {
    // elapsedSeconds=0 → timeOfDay=0 < 43200 → daytime; sunny lightFactor=1.0.
    expect(daylightFactor(weather('sunny'), 0)).toBeCloseTo(1.0, 10);
  });

  it('cloudy daytime → reduced sun (0.6)', () => {
    expect(daylightFactor(weather('cloudy'), 0)).toBeCloseTo(0.6, 10);
  });

  it('night → 0 (no solar generation)', () => {
    // elapsedSeconds=43200 → timeOfDay=43200, not < 43200 → night.
    expect(daylightFactor(weather('sunny'), SECONDS_PER_DAY / 2)).toBe(0);
  });

  it('daytime sunny > daytime cloudy > daytime rain', () => {
    expect(daylightFactor(weather('sunny'), 0)).toBeGreaterThan(daylightFactor(weather('cloudy'), 0));
    expect(daylightFactor(weather('cloudy'), 0)).toBeGreaterThan(daylightFactor(weather('rain'), 0));
  });

  it('result is in [0, 1]', () => {
    for (const cond of ['sunny', 'cloudy', 'rain', 'heavy-rain', 'severe-storm'] as const) {
      const f = daylightFactor(weather(cond), 0);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  });
});

describe('generateSolarEnergy', () => {
  it('banks generation pro-rated by dtDays × daylightFactor, capped at capacity', () => {
    // 1 panel, sunny day, full day → gen = 5 × 1 × 1 × 1 = 5. stored 0 → 5.
    expect(generateSolarEnergy(envWith(0, 100), 1, weather('sunny'), 0, SECONDS_PER_DAY)).toBeCloseTo(5, 10);
  });

  it('caps stored at capacity (surplus wasted until more batteries)', () => {
    // stored=98, 1 panel, sunny, full day → 98 + 5 = 103, capped at 100.
    expect(generateSolarEnergy(envWith(98, 100), 1, weather('sunny'), 0, SECONDS_PER_DAY)).toBe(100);
  });

  it('night → no generation (stored unchanged)', () => {
    expect(generateSolarEnergy(envWith(10, 100), 1, weather('sunny'), SECONDS_PER_DAY / 2, SECONDS_PER_DAY)).toBe(10);
  });

  it('cloudy generates less than sunny', () => {
    const sunny = generateSolarEnergy(envWith(0, 100), 1, weather('sunny'), 0, SECONDS_PER_DAY);
    const cloudy = generateSolarEnergy(envWith(0, 100), 1, weather('cloudy'), 0, SECONDS_PER_DAY);
    expect(sunny).toBeGreaterThan(cloudy);
  });

  it('scales with panel count', () => {
    const one = generateSolarEnergy(envWith(0, 100), 1, weather('sunny'), 0, SECONDS_PER_DAY);
    const three = generateSolarEnergy(envWith(0, 1000), 3, weather('sunny'), 0, SECONDS_PER_DAY);
    expect(three).toBeCloseTo(one * 3, 10);
  });

  it('no panels → stored unchanged', () => {
    expect(generateSolarEnergy(envWith(7, 100), 0, weather('sunny'), 0, SECONDS_PER_DAY)).toBe(7);
  });
});

describe('deriveEnergyCapacity', () => {
  it('base capacity with no batteries', () => {
    expect(deriveEnergyCapacity(0)).toBe(PROVISIONAL_ENERGY_BATTERY_CAPACITY_DEFAULT);
  });

  it('each active battery raises the ceiling by one default-capacity', () => {
    expect(deriveEnergyCapacity(1)).toBe(PROVISIONAL_ENERGY_BATTERY_CAPACITY_DEFAULT * 2);
    expect(deriveEnergyCapacity(2)).toBe(PROVISIONAL_ENERGY_BATTERY_CAPACITY_DEFAULT * 3);
  });
});

describe('applyBaselineEnergyConsumption', () => {
  it('debits the ambient draw pro-rated by dtDays, clamped at 0', () => {
    // stored=10, 60s → debit = 10/day × 60/86400 ≈ 0.00694.
    const dtDays = 60 / SECONDS_PER_DAY;
    const expected = 10 - PROVISIONAL_ENERGY_BASELINE_CONSUMPTION * dtDays;
    expect(applyBaselineEnergyConsumption(envWith(10), 60)).toBeCloseTo(expected, 10);
  });

  it('clamps at 0 (an empty pool cannot go negative)', () => {
    expect(applyBaselineEnergyConsumption(envWith(0), STEP)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. executeAutomation wiring (on-fire debit + insufficient-energy skip)
// ---------------------------------------------------------------------------

describe('executeAutomation — energy debit on fire (R-P6-3)', () => {
  it('debits the per-fire draw from environment.energy.stored on a successful fire', () => {
    let state = freshState();
    state = setSoilWater(state, 20); // threshold met (soil water < 50)
    state = setEnergy(state, 10); // stored = 10
    state = addAutomation(
      state,
      makeAutomation({
        id: 'energy-consumer',
        energyConsumption: 1440, // per-tick draw = 1.0
        policy: soilThresholdPolicy(50, 5),
      }),
    );
    const result = executeAutomation(state, state.automation[0]!, {
      now: STEP,
      stepSeconds: STEP,
      rng: Rng.fromSeed(1),
    });
    // Automation fired (action ran + triggered emitted).
    expect(result.events.some((e) => e.type === 'automation-triggered')).toBe(true);
    expect(result.events.some((e) => e.type === 'water-applied')).toBe(true);
    // lastRunAt advanced.
    expect(result.state.automation[0]!.lastRunAt).toBe(STEP);
    // Energy debited: 10 - 1.0 = 9.
    expect(result.state.world.environment.energy.stored).toBeCloseTo(9.0, 10);
    // Input not mutated.
    expect(state.world.environment.energy.stored).toBe(10);
  });

  it('skips with insufficient-resources when the pool is short, lastRunAt NOT advanced, stored unchanged', () => {
    let state = freshState();
    state = setSoilWater(state, 20); // threshold met
    state = setEnergy(state, 0.5); // stored = 0.5 < 1.0 draw
    state = addAutomation(
      state,
      makeAutomation({
        id: 'energy-starved',
        energyConsumption: 1440, // per-tick draw = 1.0
        policy: soilThresholdPolicy(50, 5),
      }),
    );
    const result = executeAutomation(state, state.automation[0]!, {
      now: STEP,
      stepSeconds: STEP,
      rng: Rng.fromSeed(1),
    });
    // Skipped with the resources reason (the frozen enum has no
    // insufficient-energy variant — energy IS a resource).
    const skipped = result.events.find((e) => e.type === 'automation-skipped');
    expect(skipped).toBeDefined();
    expect(skipped!.type === 'automation-skipped' && skipped!.payload.reason).toBe(
      'insufficient-resources',
    );
    // lastRunAt NOT advanced (retries next tick when the pool is replenished).
    expect(result.state.automation[0]!.lastRunAt).toBe(0);
    // No automation-triggered / water-applied (action did not run).
    expect(result.events.some((e) => e.type === 'automation-triggered')).toBe(false);
    expect(result.events.some((e) => e.type === 'water-applied')).toBe(false);
    // Stored unchanged (no debit on a skipped fire).
    expect(result.state.world.environment.energy.stored).toBeCloseTo(0.5, 10);
  });

  it('equipment with energyConsumption <= 0 never hits the energy gate (fires normally)', () => {
    // A harvester-style automation (energyConsumption=0) fires even with an
    // empty pool — the energy gate only applies to positive consumers.
    let state = freshState();
    state = setSoilWater(state, 20);
    state = setEnergy(state, 0); // empty pool
    state = addAutomation(
      state,
      makeAutomation({
        id: 'no-energy',
        energyConsumption: 0,
        policy: soilThresholdPolicy(50, 5),
      }),
    );
    const result = executeAutomation(state, state.automation[0]!, {
      now: STEP,
      stepSeconds: STEP,
      rng: Rng.fromSeed(1),
    });
    expect(result.events.some((e) => e.type === 'automation-triggered')).toBe(true);
    expect(result.events.some((e) => e.type === 'automation-skipped')).toBe(false);
    // Stored unchanged (no debit).
    expect(result.state.world.environment.energy.stored).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. System integration (engine.advance)
// ---------------------------------------------------------------------------

describe('AutomationSystem solar pre-pass (passive generation, R-P6-3)', () => {
  it('an enabled solar-panel banks generation each tick (vs a no-solar control)', () => {
    // Both states start with stored=50 so the EnvironmentSystem baseline debit
    // (same for both) cancels in the difference — the delta is purely solar.
    const baseNoSolar = setEnergy(freshState(), 50);
    const solarAutomation = makeAutomation({ id: 'solar-1', type: SOLAR_PANEL.id });
    const baseWithSolar = addAutomation(setEnergy(freshState(), 50), solarAutomation);

    const without = engine.advance(baseNoSolar, STEP);
    const withSolar = engine.advance(baseWithSolar, STEP);

    // The with-solar run banked generation on top of the same baseline debit.
    const delta = withSolar.state.world.environment.energy.stored - without.state.world.environment.energy.stored;
    // Expected gen = PROVISIONAL_ENERGY_SOLAR_GENERATION_RATE × 1 panel × (60/86400) × daylightFactor.
    // ctx.now = STEP = 60 → daytime; default weather is sunny → daylightFactor = 1.0.
    const expectedGen =
      PROVISIONAL_ENERGY_SOLAR_GENERATION_RATE * 1 * (STEP / SECONDS_PER_DAY) * 1.0;
    expect(delta).toBeCloseTo(expectedGen, 8);
    expect(delta).toBeGreaterThan(0);
  });

  it('solar generation scales with panel count', () => {
    const onePanel = addAutomation(setEnergy(freshState(), 50), makeAutomation({ id: 's1', type: SOLAR_PANEL.id }));
    const threePanels = addAutomation(
      addAutomation(
        addAutomation(setEnergy(freshState(), 50), makeAutomation({ id: 's1', type: SOLAR_PANEL.id })),
        makeAutomation({ id: 's2', type: SOLAR_PANEL.id }),
      ),
      makeAutomation({ id: 's3', type: SOLAR_PANEL.id }),
    );
    const r1 = engine.advance(onePanel, STEP);
    const r3 = engine.advance(threePanels, STEP);
    const delta1 = r1.state.world.environment.energy.stored - 50; // vs baseline-only
    const delta3 = r3.state.world.environment.energy.stored - 50;
    // 3 panels bank ~3× the generation of 1 (baseline cancels in both).
    expect(delta3).toBeGreaterThan(delta1);
    expect(delta3).toBeCloseTo(delta1 * 3, 6);
  });
});

describe('EnvironmentSystem — battery capacity + baseline consumption (R-P6-3)', () => {
  it('an active battery raises environment.energy.capacity', () => {
    const baseNoBattery = freshState();
    const withBattery = addAutomation(
      freshState(),
      makeAutomation({ id: 'bat-1', type: BATTERY.id }),
    );
    const rNo = engine.advance(baseNoBattery, STEP);
    const rWith = engine.advance(withBattery, STEP);
    // No battery → base capacity; 1 battery → 2× base.
    expect(rNo.state.world.environment.energy.capacity).toBe(
      PROVISIONAL_ENERGY_BATTERY_CAPACITY_DEFAULT,
    );
    expect(rWith.state.world.environment.energy.capacity).toBe(
      PROVISIONAL_ENERGY_BATTERY_CAPACITY_DEFAULT * 2,
    );
  });

  it('applies the baseline ambient consumption each tick (stored decreases)', () => {
    // No automations → no solar, no on-fire debit. The only stored mutation is
    // the EnvironmentSystem baseline debit.
    const state = setEnergy(freshState(), 50);
    const result = engine.advance(state, STEP);
    const storedAfter = result.state.world.environment.energy.stored;
    const expectedDebit = PROVISIONAL_ENERGY_BASELINE_CONSUMPTION * (STEP / SECONDS_PER_DAY);
    expect(storedAfter).toBeCloseTo(50 - expectedDebit, 10);
    expect(storedAfter).toBeLessThan(50);
  });

  it('a disabled battery does NOT raise capacity (only active equipment counts)', () => {
    const withDisabledBattery = addAutomation(
      freshState(),
      makeAutomation({ id: 'bat-off', type: BATTERY.id, enabled: false }),
    );
    const result = engine.advance(withDisabledBattery, STEP);
    expect(result.state.world.environment.energy.capacity).toBe(
      PROVISIONAL_ENERGY_BATTERY_CAPACITY_DEFAULT,
    );
  });
});
