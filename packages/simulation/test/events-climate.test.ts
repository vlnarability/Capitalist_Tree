/**
 * P10c climate feedback loop tests (GDD §10.3 Environmental Feedback, lines
 * 650-665; TDD Milestone 9: Climate feedback). Asserts:
 *   - atmosphericCarbon / globalTemperature high → regional temperature
 *     baselines rise (P7↔P10 bridge).
 *   - environmental feedback chains: deforestation → erosion → soilHealth
 *     drop; water scarcity → commodity-basket index lift; biodiversity loss →
 *     resilience drop.
 *   - species extinction irreversible below
 *     PROVISIONAL_SPECIES_EXTINCTION_THRESHOLD (floored, no recovery via the
 *     secondary chain).
 */
import { describe, it, expect } from 'vitest';
import { engine, SECONDS_PER_DAY } from '../src/index.js';
import {
  applyClimateFeedback,
  applyEnvironmentalFeedback,
  environmentalEventProbabilityMultiplier,
  seedDefaultRegions,
  CLIMATE_CONSTANTS,
} from '../src/index.js';
import { DEFAULT_GAME_CONFIG } from '../src/initial-state.js';
import type { GameState, GameConfig } from '@capitalist-tree/shared';

function cfg(seed: number): GameConfig {
  return { ...DEFAULT_GAME_CONFIG, seed };
}
function freshState(seed = 42): GameState {
  return seedDefaultRegions(engine.initialize(cfg(seed)));
}
const STEP = 60; // PROVISIONAL_SIMULATION_STEP_SECONDS

describe('P10c climate feedback — applyClimateFeedback', () => {
  it('drifts regional temperature baselines toward an elevated global temperature (P7↔P10 bridge)', () => {
    const base = freshState();
    // Elevate the P7 global temperature to +4 °C warming.
    const warmed: GameState = {
      ...base,
      world: {
        ...base.world,
        environment: {
          ...base.world.environment,
          globalTemperature: 18, // +4 °C above the 14 °C baseline
          atmosphere: {
            ...base.world.environment.atmosphere,
            co2Concentration: 450,
          },
        },
      },
    };
    const before = warmed.eventState.global.regions[0]!.climate.temperatureBaseline;
    const result = applyClimateFeedback(warmed, 365 * 24 * 60 * 60); // one sim year
    const after = result.state.eventState.global.regions[0]!.climate.temperatureBaseline;
    expect(after).toBeGreaterThan(before);
    // Purity — input not mutated.
    expect(warmed.eventState.global.regions[0]!.climate.temperatureBaseline).toBe(before);
  });

  it('lowers precipitation baselines proportional to warming (drought risk)', () => {
    const base = freshState();
    const warmed: GameState = {
      ...base,
      world: {
        ...base.world,
        environment: {
          ...base.world.environment,
          globalTemperature: 16,
        },
      },
    };
    const before = warmed.eventState.global.regions[0]!.climate.precipitationBaseline;
    const result = applyClimateFeedback(warmed, 365 * 24 * 60 * 60);
    const after = result.state.eventState.global.regions[0]!.climate.precipitationBaseline;
    expect(after).toBeLessThan(before);
  });

  it('is a no-op with no warming (anomaly ≈ 0)', () => {
    const base = freshState();
    // Force the global temperature to the preindustrial baseline so the
    // warming anomaly is zero (the engine default is warmer).
    const noWarm: GameState = {
      ...base,
      world: {
        ...base.world,
        environment: { ...base.world.environment, globalTemperature: 14 },
      },
    };
    const result = applyClimateFeedback(noWarm, 365 * 24 * 60 * 60);
    expect(result.state).toBe(noWarm);
    expect(result.events).toEqual([]);
  });

  it('environmentalEventProbabilityMultiplier scales with warming', () => {
    const base = freshState();
    const noWarm: GameState = {
      ...base,
      world: {
        ...base.world,
        environment: { ...base.world.environment, globalTemperature: 14 },
      },
    };
    expect(environmentalEventProbabilityMultiplier(noWarm)).toBe(1);
    const warmed: GameState = {
      ...base,
      world: {
        ...base.world,
        environment: { ...base.world.environment, globalTemperature: 16 },
      },
    };
    // +2 °C → 1 + 0.5*2 = 2.0
    expect(environmentalEventProbabilityMultiplier(warmed)).toBeCloseTo(2.0, 5);
  });
});

describe('P10c environmental feedback — applyEnvironmentalFeedback secondary chains', () => {
  it('deforestation (low forestCoverage) → erosion → soilHealth drop', () => {
    const base = freshState();
    // Make one region deforested.
    const regions = base.eventState.global.regions.map((r, i) =>
      i === 0 ? { ...r, forestCoverage: 0.05, climate: { ...r.climate }, pollution: { ...r.pollution } } : r,
    );
    const state: GameState = {
      ...base,
      eventState: { ...base.eventState, global: { ...base.eventState.global, regions } },
    };
    const before = state.eventState.global.regions[0]!.soilHealth;
    const result = applyEnvironmentalFeedback(state, SECONDS_PER_DAY);
    const after = result.state.eventState.global.regions[0]!.soilHealth;
    expect(after).toBeLessThan(before);
  });

  it('water scarcity lifts the commodity-basket market index (higher resource prices)', () => {
    const base = freshState();
    const regions = base.eventState.global.regions.map((r, i) =>
      i === 0 ? { ...r, waterAvailability: 0.1, climate: { ...r.climate }, pollution: { ...r.pollution } } : r,
    );
    const state: GameState = {
      ...base,
      eventState: { ...base.eventState, global: { ...base.eventState.global, regions } },
    };
    const result = applyEnvironmentalFeedback(state, SECONDS_PER_DAY);
    const idx =
      result.state.eventState.global.globalMarketIndices[CLIMATE_CONSTANTS.COMMODITY_BASKET_INDEX_ID] ??
      100;
    expect(idx).toBeGreaterThan(100);
  });

  it('biodiversity loss reduces global ecosystem resilience', () => {
    const base = freshState();
    const regions = base.eventState.global.regions.map((r) => ({
      ...r,
      biodiversity: 0.1,
      climate: { ...r.climate },
      pollution: { ...r.pollution },
    }));
    const state: GameState = {
      ...base,
      eventState: { ...base.eventState, global: { ...base.eventState.global, regions } },
    };
    const before = state.eventState.global.aggregatedIndicators.ecosystemResilience;
    const result = applyEnvironmentalFeedback(state, SECONDS_PER_DAY);
    const after = result.state.eventState.global.aggregatedIndicators.ecosystemResilience;
    expect(after).toBeLessThan(before);
  });

  it('species extinction below threshold is irreversible — biodiversity floored + extinction rate ratcheted', () => {
    const base = freshState();
    // Push every region below the extinction threshold.
    const regions = base.eventState.global.regions.map((r) => ({
      ...r,
      biodiversity: 0.1,
      climate: { ...r.climate },
      pollution: { ...r.pollution },
    }));
    const state: GameState = {
      ...base,
      eventState: { ...base.eventState, global: { ...base.eventState.global, regions } },
    };
    const beforeRate = state.eventState.global.aggregatedIndicators.speciesExtinctionRate;
    const result = applyEnvironmentalFeedback(state, SECONDS_PER_DAY);
    const afterRate = result.state.eventState.global.aggregatedIndicators.speciesExtinctionRate;
    // Biodiversity is NOT lifted above the threshold by the secondary chain.
    for (const r of result.state.eventState.global.regions) {
      expect(r.biodiversity).toBeLessThanOrEqual(0.2);
    }
    expect(afterRate).toBeGreaterThan(beforeRate);
    // Emits a critical species-extinction notification.
    expect(
      result.events.some(
        (e) => e.type === 'notification' && (e.payload as { code: string }).code === 'species-extinction-collapse',
      ),
    ).toBe(true);
  });

  // --------------------------------------------------------------------------
  // P11 (RV4-F-H2) regression: the 1440× too-fast bug. Pre-fix,
  // `applyEnvironmentalFeedback` applied the full per-day rate every tick
  // with no `dtSeconds` scaling. At a 60-second step (the default
  // PROVISIONAL_SIMULATION_STEP_SECONDS), one tick applied 1/1440 of a day
  // but the FULL day's erosion — so soil health crashed to 0 in ~1 day of
  // sim time (1440 ticks × full daily rate). The fix scales every rate by
  // `days = dtSeconds / SECONDS_PER_DAY`.
  // --------------------------------------------------------------------------
  it('a single 60-second tick erodes soilHealth by ~1/1440 of a day (RV4-F-H2)', () => {
    const base = freshState();
    // Fully deforested region — maximum erosion pressure.
    const regions = base.eventState.global.regions.map((r, i) =>
      i === 0 ? { ...r, forestCoverage: 0, climate: { ...r.climate }, pollution: { ...r.pollution } } : r,
    );
    const state: GameState = {
      ...base,
      eventState: { ...base.eventState, global: { ...base.eventState.global, regions } },
    };
    const before = state.eventState.global.regions[0]!.soilHealth;

    // One 60-second tick (the default simulation step).
    const STEP_SECONDS = 60;
    const tickResult = applyEnvironmentalFeedback(state, STEP_SECONDS);
    const afterOneTick = tickResult.state.eventState.global.regions[0]!.soilHealth;
    const tickErosion = before - afterOneTick;

    // One full day (86400s) of erosion — the reference.
    const dayResult = applyEnvironmentalFeedback(state, SECONDS_PER_DAY);
    const afterOneDay = dayResult.state.eventState.global.regions[0]!.soilHealth;
    const dayErosion = before - afterOneDay;

    // The tick erosion should be ~1/1440 of the day erosion (within 1e-9 for
    // float rounding). Pre-fix, both were identical (the 1440× bug).
    expect(dayErosion).toBeGreaterThan(0);
    expect(tickErosion / dayErosion).toBeCloseTo(STEP_SECONDS / SECONDS_PER_DAY, 6);
  });

  it('soilHealth does NOT crash to 0 in one day of 60-second ticks (RV4-F-H2)', () => {
    // The headline symptom: pre-fix, 1440 ticks (= 1 day) at full daily rate
    // each eroded soilHealth to 0 almost immediately. Post-fix, 1440 ticks
    // each applying 1/1440 of the daily rate leaves soilHealth where one
    // `applyEnvironmentalFeedback(state, SECONDS_PER_DAY)` call would —
    // materially lower, but NOT zero.
    const base = freshState();
    const regions = base.eventState.global.regions.map((r) => ({
      ...r,
      forestCoverage: 0, // max erosion
      climate: { ...r.climate },
      pollution: { ...r.pollution },
    }));
    let state: GameState = {
      ...base,
      eventState: { ...base.eventState, global: { ...base.eventState.global, regions } },
    };
    const before = state.eventState.global.regions[0]!.soilHealth;

    // Run 1440 ticks of 60s each (= one sim day).
    const STEP_SECONDS = 60;
    for (let i = 0; i < SECONDS_PER_DAY / STEP_SECONDS; i++) {
      state = applyEnvironmentalFeedback(state, STEP_SECONDS).state;
    }
    const after = state.eventState.global.regions[0]!.soilHealth;

    // Soil health dropped (erosion happened) but is NOT near zero. Pre-fix it
    // would have hit 0 within the first few ticks. The daily erosion rate is
    // 0.002 × missingForest(=1) = 0.002/day, so after 1 day soilHealth ≈
    // before − 0.002 (a small, sane drop — NOT a crash).
    expect(after).toBeGreaterThan(0);
    expect(after).toBeGreaterThan(before - 0.01); // < 1% drop in one day
    // And materially: it actually moved (sanity that the loop ran).
    expect(after).toBeLessThan(before);
  });

  it('a zero dtSeconds is a no-op (defensive guard)', () => {
    const base = freshState();
    const regions = base.eventState.global.regions.map((r) => ({
      ...r,
      forestCoverage: 0,
      climate: { ...r.climate },
      pollution: { ...r.pollution },
    }));
    const state: GameState = {
      ...base,
      eventState: { ...base.eventState, global: { ...base.eventState.global, regions } },
    };
    const result = applyEnvironmentalFeedback(state, 0);
    // No-op: state returned unchanged, no events.
    expect(result.state).toBe(state);
    expect(result.events).toHaveLength(0);
  });

  it('purity — input is not mutated (freeze test)', () => {
    const base = freshState();
    const warmed: GameState = {
      ...base,
      world: {
        ...base.world,
        environment: { ...base.world.environment, globalTemperature: 18 },
      },
    };
    Object.freeze(warmed);
    Object.freeze(warmed.eventState);
    Object.freeze(warmed.eventState.global);
    for (const r of warmed.eventState.global.regions) {
      Object.freeze(r);
      Object.freeze(r.climate);
    }
    // Should not throw — applyClimateFeedback deep-copies before mutating.
    expect(() => applyClimateFeedback(warmed, 365 * 24 * 60 * 60)).not.toThrow();
    expect(() => applyEnvironmentalFeedback(warmed, SECONDS_PER_DAY)).not.toThrow();
  });
});
