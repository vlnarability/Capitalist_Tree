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
import { engine } from '../src/index.js';
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
    // globalTemperature defaults to ~14 (baseline) → no drift.
    const result = applyClimateFeedback(base, 365 * 24 * 60 * 60);
    expect(result.state).toBe(base);
    expect(result.events).toEqual([]);
  });

  it('environmentalEventProbabilityMultiplier scales with warming', () => {
    const base = freshState();
    expect(environmentalEventProbabilityMultiplier(base)).toBe(1);
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
    const result = applyEnvironmentalFeedback(state);
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
    const result = applyEnvironmentalFeedback(state);
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
    const result = applyEnvironmentalFeedback(state);
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
    const result = applyEnvironmentalFeedback(state);
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
    expect(() => applyEnvironmentalFeedback(warmed)).not.toThrow();
  });
});
