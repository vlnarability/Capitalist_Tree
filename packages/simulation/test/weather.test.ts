/**
 * Weather module unit tests (TDD §18.1, §18.3; GDD §4.3, §4.4).
 *
 * Pure-function + integration tests asserting the weather invariants:
 *
 *   - Markov chain picks a valid next condition from the matrix row.
 *   - Staleness bias reduces the "stay" probability after MAX_DAYS_IN_CONDITION.
 *   - Local temperature = climate baseline + per-condition delta × intensity scale.
 *   - Rainfall scales with intensity.
 *   - Damage severity is 0 below threshold, scales above.
 *   - Per-season transition matrices produce sensible distributions over
 *     5 sim years (e.g., summer has more sunny than winter, winter has more
 *     frost than summer, severe storms are rare).
 *   - WeatherSystem is deterministic (same seed → identical sequence).
 *   - WeatherSystem RNG state persists across save/load.
 */
import { describe, it, expect } from 'vitest';
import { pickNextCondition } from '../src/weather/markov.js';
import {
  computeLocalTemperature,
  computeRainfall,
  computeDamageSeverity,
  shouldEmitDamage,
  computeEvaporationRate,
} from '../src/weather/effects.js';
import {
  WEATHER_EVENT_MAP,
  TEMPERATE_CLIMATE,
  findTransitionMatrix,
  findClimateById,
  findWeatherEvent,
} from '@capitalist-tree/content';
import {
  WEATHER_CONDITIONS,
  PROVISIONAL_WEATHER_DEFAULT_CLIMATE_ID,
  PROVISIONAL_WEATHER_DAMAGE_INTENSITY_THRESHOLD,
  PROVISIONAL_WEATHER_MAX_DAYS_IN_CONDITION,
  PROVISIONAL_WEATHER_TEMP_DELTAS_C,
  PROVISIONAL_DAYS_PER_YEAR,
  PROVISIONAL_SIMULATION_STEP_SECONDS as STEP,
} from '@capitalist-tree/shared';
import { engine, Rng, InMemoryStorage } from '../src/index.js';
import { DEFAULT_GAME_CONFIG } from '../src/initial-state.js';
import type { GameConfig, WeatherCondition, Season } from '@capitalist-tree/shared';

const SECONDS_PER_DAY = 24 * 60 * 60;

function cfg(seed: number): GameConfig {
  return { ...DEFAULT_GAME_CONFIG, seed, createdAt: 0 };
}

function emptyTally(): Record<WeatherCondition, number> {
  const out = {} as Record<WeatherCondition, number>;
  for (const c of WEATHER_CONDITIONS) out[c] = 0;
  return out;
}

describe('Markov chain — pickNextCondition (TDD §9.1)', () => {
  it('always returns a valid WeatherCondition', () => {
    const matrix = findTransitionMatrix(PROVISIONAL_WEATHER_DEFAULT_CLIMATE_ID, 'summer')!;
    const rng = Rng.fromSeed(42);
    for (let i = 0; i < 1000; i++) {
      const next = pickNextCondition(matrix, 'sunny', 0, rng);
      expect(WEATHER_CONDITIONS).toContain(next);
    }
  });

  it('returns the current condition when "stay" probability is 1.0', () => {
    const matrix = {
      season: 'summer' as Season,
      transitions: {
        sunny: { sunny: 1, cloudy: 0, rain: 0, 'heavy-rain': 0, drought: 0, frost: 0, 'heat-wave': 0, wind: 0, 'severe-storm': 0 },
        cloudy: { sunny: 0, cloudy: 1, rain: 0, 'heavy-rain': 0, drought: 0, frost: 0, 'heat-wave': 0, wind: 0, 'severe-storm': 0 },
        rain: { sunny: 0, cloudy: 0, rain: 1, 'heavy-rain': 0, drought: 0, frost: 0, 'heat-wave': 0, wind: 0, 'severe-storm': 0 },
        'heavy-rain': { sunny: 0, cloudy: 0, rain: 0, 'heavy-rain': 1, drought: 0, frost: 0, 'heat-wave': 0, wind: 0, 'severe-storm': 0 },
        drought: { sunny: 0, cloudy: 0, rain: 0, 'heavy-rain': 0, drought: 1, frost: 0, 'heat-wave': 0, wind: 0, 'severe-storm': 0 },
        frost: { sunny: 0, cloudy: 0, rain: 0, 'heavy-rain': 0, drought: 0, frost: 1, 'heat-wave': 0, wind: 0, 'severe-storm': 0 },
        'heat-wave': { sunny: 0, cloudy: 0, rain: 0, 'heavy-rain': 0, drought: 0, frost: 0, 'heat-wave': 1, wind: 0, 'severe-storm': 0 },
        wind: { sunny: 0, cloudy: 0, rain: 0, 'heavy-rain': 0, drought: 0, frost: 0, 'heat-wave': 0, wind: 1, 'severe-storm': 0 },
        'severe-storm': { sunny: 0, cloudy: 0, rain: 0, 'heavy-rain': 0, drought: 0, frost: 0, 'heat-wave': 0, wind: 0, 'severe-storm': 1 },
      },
    };
    const rng = Rng.fromSeed(42);
    for (const cond of WEATHER_CONDITIONS) {
      const next = pickNextCondition(matrix, cond, 0, rng);
      expect(next).toBe(cond);
    }
  });

  it('staleness bias reduces "stay" probability after MAX_DAYS_IN_CONDITION', () => {
    const matrix = findTransitionMatrix(PROVISIONAL_WEATHER_DEFAULT_CLIMATE_ID, 'summer')!;
    const rng1 = Rng.fromSeed(42);
    const rng2 = Rng.fromSeed(42);

    // Below the staleness threshold — no bias.
    const freshCount = { sunny: 0, other: 0 };
    for (let i = 0; i < 1000; i++) {
      const next = pickNextCondition(matrix, 'sunny', 0, rng1);
      if (next === 'sunny') freshCount.sunny++;
      else freshCount.other++;
    }

    // Above the staleness threshold — bias applied. The "stay" column is
    // reduced, so we should see fewer "sunny → sunny" transitions.
    const staleCount = { sunny: 0, other: 0 };
    for (let i = 0; i < 1000; i++) {
      const next = pickNextCondition(matrix, 'sunny', PROVISIONAL_WEATHER_MAX_DAYS_IN_CONDITION + 1, rng2);
      if (next === 'sunny') staleCount.sunny++;
      else staleCount.other++;
    }
    expect(staleCount.sunny).toBeLessThan(freshCount.sunny);
    expect(staleCount.other).toBeGreaterThan(freshCount.other);
  });

  it('is deterministic given the same RNG state', () => {
    const matrix = findTransitionMatrix(PROVISIONAL_WEATHER_DEFAULT_CLIMATE_ID, 'summer')!;
    const rng1 = Rng.fromSeed(123);
    const rng2 = Rng.fromSeed(123);
    for (let i = 0; i < 100; i++) {
      const a = pickNextCondition(matrix, 'sunny', 0, rng1);
      const b = pickNextCondition(matrix, 'sunny', 0, rng2);
      expect(a).toBe(b);
    }
  });
});

describe('weather effects — computeLocalTemperature (TDD §9.1)', () => {
  it('baseline temperature + condition delta × intensity scale', () => {
    const climate = TEMPERATE_CLIMATE;
    const eventDef = WEATHER_EVENT_MAP['heat-wave'];
    // At intensity = 1, intensityScale = 1.0 → delta = full.
    const t = computeLocalTemperature(climate, 'summer', 'heat-wave', 1, eventDef);
    expect(t).toBe(climate.seasonalBaseTemp.summer + PROVISIONAL_WEATHER_TEMP_DELTAS_C['heat-wave']);
  });

  it('at intensity = 0, intensityScale = 0.5 → delta halved', () => {
    const climate = TEMPERATE_CLIMATE;
    const eventDef = WEATHER_EVENT_MAP['heat-wave'];
    const t = computeLocalTemperature(climate, 'summer', 'heat-wave', 0, eventDef);
    expect(t).toBe(climate.seasonalBaseTemp.summer + PROVISIONAL_WEATHER_TEMP_DELTAS_C['heat-wave'] * 0.5);
  });

  it('frost in winter drops temperature below baseline', () => {
    const climate = TEMPERATE_CLIMATE;
    const eventDef = WEATHER_EVENT_MAP.frost;
    const t = computeLocalTemperature(climate, 'winter', 'frost', 1, eventDef);
    expect(t).toBeLessThan(climate.seasonalBaseTemp.winter);
  });

  it('sunny in summer warms above baseline', () => {
    const climate = TEMPERATE_CLIMATE;
    const eventDef = WEATHER_EVENT_MAP.sunny;
    const t = computeLocalTemperature(climate, 'summer', 'sunny', 1, eventDef);
    expect(t).toBeGreaterThan(climate.seasonalBaseTemp.summer);
  });
});

describe('weather effects — rainfall + evaporation (TDD §9.1, §8.1)', () => {
  it('rainfall scales with intensity', () => {
    const eventDef = WEATHER_EVENT_MAP.rain;
    const low = computeRainfall(eventDef, 0.1, 1);
    const high = computeRainfall(eventDef, 1.0, 1);
    expect(high).toBeGreaterThan(low);
    expect(high).toBeCloseTo(eventDef.rainfallLPerDay, 5);
  });

  it('sunny/cloudy/wind/drought/frost/heat-wave produce no rainfall', () => {
    for (const cond of ['sunny', 'cloudy', 'wind', 'drought', 'frost', 'heat-wave'] as const) {
      const eventDef = WEATHER_EVENT_MAP[cond];
      expect(eventDef.rainfallLPerDay).toBe(0);
    }
  });

  it('heavy-rain and severe-storm produce rainfall', () => {
    expect(WEATHER_EVENT_MAP['heavy-rain'].rainfallLPerDay).toBeGreaterThan(0);
    expect(WEATHER_EVENT_MAP['severe-storm'].rainfallLPerDay).toBeGreaterThan(0);
    // Severe storm dumps more than heavy rain.
    expect(WEATHER_EVENT_MAP['severe-storm'].rainfallLPerDay).toBeGreaterThan(
      WEATHER_EVENT_MAP['heavy-rain'].rainfallLPerDay,
    );
  });

  it('evaporation scales with temperature', () => {
    const eventDef = WEATHER_EVENT_MAP.sunny;
    const base = computeEvaporationRate(eventDef, 15, 0.02, 15);
    const warm = computeEvaporationRate(eventDef, 30, 0.02, 15);
    expect(warm).toBeGreaterThan(base);
    expect(base).toBe(0); // at base temp → tempFactor = 0
  });

  it('drought has higher evaporation multiplier than sunny', () => {
    expect(WEATHER_EVENT_MAP.drought.evaporationMultiplier).toBeGreaterThan(
      WEATHER_EVENT_MAP.sunny.evaporationMultiplier,
    );
  });
});

describe('weather effects — damage (TDD §9.3, GDD §4.3)', () => {
  it('non-damaging conditions never emit damage', () => {
    for (const cond of ['sunny', 'cloudy', 'rain', 'heavy-rain'] as const) {
      const eventDef = WEATHER_EVENT_MAP[cond];
      expect(shouldEmitDamage(eventDef, 1.0)).toBe(false);
      expect(computeDamageSeverity(eventDef, 1.0)).toBe(0);
    }
  });

  it('damage-capable conditions emit damage only above threshold', () => {
    const eventDef = WEATHER_EVENT_MAP['severe-storm'];
    expect(shouldEmitDamage(eventDef, PROVISIONAL_WEATHER_DAMAGE_INTENSITY_THRESHOLD - 0.01)).toBe(false);
    expect(shouldEmitDamage(eventDef, PROVISIONAL_WEATHER_DAMAGE_INTENSITY_THRESHOLD)).toBe(true);
    expect(shouldEmitDamage(eventDef, 1.0)).toBe(true);
  });

  it('damage severity scales with intensity (above threshold)', () => {
    const eventDef = WEATHER_EVENT_MAP.frost;
    const low = computeDamageSeverity(eventDef, PROVISIONAL_WEATHER_DAMAGE_INTENSITY_THRESHOLD);
    const high = computeDamageSeverity(eventDef, 1.0);
    expect(high).toBeGreaterThan(low);
    expect(low).toBeGreaterThan(0);
  });

  it('each damage-capable condition has a damageType', () => {
    for (const cond of WEATHER_CONDITIONS) {
      const eventDef = WEATHER_EVENT_MAP[cond];
      if (eventDef.canDamage) {
        expect(eventDef.damageType).toBeDefined();
      }
    }
  });
});

describe('content registry — climate + transition matrices', () => {
  it('TEMPERATE_CLIMATE is registered and findable by id', () => {
    expect(findClimateById(PROVISIONAL_WEATHER_DEFAULT_CLIMATE_ID)).toBeDefined();
    expect(TEMPERATE_CLIMATE.id).toBe(PROVISIONAL_WEATHER_DEFAULT_CLIMATE_ID);
  });

  it('every season has a transition matrix for the temperate climate', () => {
    for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) {
      const m = findTransitionMatrix(PROVISIONAL_WEATHER_DEFAULT_CLIMATE_ID, season);
      expect(m).toBeDefined();
      expect(m!.season).toBe(season);
    }
  });

  it('every weather condition has an event definition', () => {
    for (const cond of WEATHER_CONDITIONS) {
      const def = findWeatherEvent(cond);
      expect(def).toBeDefined();
      expect(def!.condition).toBe(cond);
    }
  });

  it('every transition matrix row sums to ~1.0 (validated at module load)', () => {
    for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) {
      const m = findTransitionMatrix(PROVISIONAL_WEATHER_DEFAULT_CLIMATE_ID, season)!;
      for (const [from, row] of Object.entries(m.transitions)) {
        const sum = Object.values(row).reduce((a, b) => a + b, 0);
        expect(sum).toBeCloseTo(1.0, 5);
        void from;
      }
    }
  });

  it('climate has the climateShiftHook extension point for P6', () => {
    expect(TEMPERATE_CLIMATE.climateShiftHook).toBeDefined();
    expect(TEMPERATE_CLIMATE.climateShiftHook.baselineTempC).toBeGreaterThan(0);
    expect(TEMPERATE_CLIMATE.climateShiftHook.tempShiftPerDegreeC).toBeGreaterThan(0);
  });
});

describe('WeatherSystem integration — seasonal distribution sanity (5 sim years)', () => {
  // Advance 5 sim years, tallying the weather condition at the end of each
  // sim day. Asserts the distributions match the design intent in the
  // transition matrices:
  //   - Every condition appears at least once (rare events occur).
  //   - Summer has more sunny than winter.
  //   - Winter has more frost than summer.
  //   - Severe storms are rare (< 10% of any season).
  //   - Autumn has more rain than summer.
  //
  // Single 5-year simulation, multiple assertions — minimizes wall-clock
  // (5 sim years takes ~60s on a sapling).

  const years = 5;
  const totalSeconds = years * PROVISIONAL_DAYS_PER_YEAR * SECONDS_PER_DAY;
  const daySeconds = SECONDS_PER_DAY;

  let tallied: Record<Season, Record<WeatherCondition, number>> | null = null;

  function tally(): Record<Season, Record<WeatherCondition, number>> {
    if (tallied) return tallied;
    const out: Record<Season, Record<WeatherCondition, number>> = {
      spring: emptyTally(),
      summer: emptyTally(),
      autumn: emptyTally(),
      winter: emptyTally(),
    };
    let s = engine.initialize(cfg(42));
    const totalDays = Math.floor(totalSeconds / daySeconds);
    for (let d = 0; d < totalDays; d++) {
      const r = engine.advance(s, daySeconds);
      s = r.state;
      out[s.clock.season][s.world.weather.condition]++;
    }
    tallied = out;
    return out;
  }

  it('every condition appears at least once across 5 sim years', () => {
    const t = tally();
    const total = emptyTally();
    for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) {
      for (const cond of WEATHER_CONDITIONS) {
        total[cond] += t[season][cond];
      }
    }
    for (const cond of WEATHER_CONDITIONS) {
      expect(total[cond], `condition ${cond} should appear at least once`).toBeGreaterThan(0);
    }
  }, 120_000);

  it('summer has more sunny than winter (per design intent)', () => {
    const t = tally();
    expect(t.summer.sunny).toBeGreaterThan(t.winter.sunny);
  }, 120_000);

  it('winter has more frost than summer (per design intent)', () => {
    const t = tally();
    expect(t.winter.frost).toBeGreaterThan(t.summer.frost);
  }, 120_000);

  it('severe-storm is rare (< 10% of any season)', () => {
    const t = tally();
    for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) {
      const seasonTotal = Object.values(t[season]).reduce((a, b) => a + b, 0);
      const stormFrac = t[season]['severe-storm'] / Math.max(1, seasonTotal);
      expect(stormFrac, `season ${season} storm fraction`).toBeLessThan(0.10);
    }
  }, 120_000);

  it('autumn has more rain than summer (per design intent)', () => {
    const t = tally();
    expect(t.autumn.rain + t.autumn['heavy-rain']).toBeGreaterThan(
      t.summer.rain + t.summer['heavy-rain'],
    );
  }, 120_000);
});

describe('WeatherSystem determinism (TDD §18.3)', () => {
  it('same seed → identical weather sequence (1000 steps)', () => {
    const a0 = engine.initialize(cfg(42));
    const a1 = engine.advance(a0, 1000 * STEP);

    const b0 = engine.initialize(cfg(42));
    const b1 = engine.advance(b0, 1000 * STEP);

    expect(a1.state.world.weather).toEqual(b1.state.world.weather);
    expect(a1.state.rngStreams.weather).toEqual(b1.state.rngStreams.weather);
  });

  it('weather-changed events are emitted when the condition changes', () => {
    const initial = engine.initialize(cfg(42));
    const r = engine.advance(initial, 100 * STEP);
    const weatherChanged = r.events.filter((e) => e.type === 'weather-changed');
    // We can't guarantee a specific count (depends on the seed), but over
    // 100 steps there should be at least one condition change.
    expect(weatherChanged.length).toBeGreaterThan(0);
  });

  it('weather-damage events are emitted for severe conditions (3 sim years)', () => {
    const initial = engine.initialize(cfg(42));
    // Advance 3 sim years — we should see at least one weather-damage event
    // (severe storm / frost / heat wave / wind / drought above threshold).
    const r = engine.advance(initial, 3 * PROVISIONAL_DAYS_PER_YEAR * SECONDS_PER_DAY);
    const damage = r.events.filter((e) => e.type === 'weather-damage');
    expect(damage.length).toBeGreaterThan(0);
  }, 120_000);
});

describe('WeatherSystem RNG-state persistence across save/load (TDD §18.3)', () => {
  it('save->load->advance 1000 == advance 2000 from start (weather)', async () => {
    const a0 = engine.initialize(cfg(42));
    const a1 = engine.advance(a0, 1000 * STEP);

    const storage = new InMemoryStorage();
    await storage.save(a1.state);
    const loaded = await storage.load();
    expect(loaded).not.toBeNull();
    const a2 = engine.advance(loaded!, 1000 * STEP);

    const b0 = engine.initialize(cfg(42));
    const b2 = engine.advance(b0, 2000 * STEP);

    // The weather state at step 2000 must be identical whether we saved/loaded
    // at step 1000 or ran straight through.
    expect(a2.state.world.weather).toEqual(b2.state.world.weather);
    expect(a2.state.rngStreams.weather).toEqual(b2.state.rngStreams.weather);

    // Events from the second 1000-step advance must equal events
    // [1000..1999] of the unified 2000-step run (modulo non-weather events
    // that we don't care about for this assertion).
    const a2WeatherEvents = a2.events.filter(
      (e) => e.type === 'weather-changed' || e.type === 'weather-damage',
    );
    const b2TailWeatherEvents = b2.events.slice(a1.events.length).filter(
      (e) => e.type === 'weather-changed' || e.type === 'weather-damage',
    );
    expect(a2WeatherEvents).toEqual(b2TailWeatherEvents);
  });

  it('fresh game has rngStreams.weather initialized (non-zero after first tick)', () => {
    const initial = engine.initialize(cfg(42));
    // Weather RNG is forked at game start; state is non-zero.
    const initialStream = initial.rngStreams.weather;
    expect(initialStream).toBeDefined();
    expect(initialStream.some((v) => v !== 0)).toBe(true);

    // After one tick, the stream advances.
    const r = engine.advance(initial, STEP);
    expect(r.state.rngStreams.weather).toBeDefined();
    expect(r.state.rngStreams.weather).not.toEqual(initialStream);
  });

  it('weather RNG advances each step (state changes)', () => {
    const initial = engine.initialize(cfg(42));
    const r1 = engine.advance(initial, STEP);
    const r2 = engine.advance(r1.state, STEP);
    expect(r1.state.rngStreams.weather).not.toEqual(initial.rngStreams.weather);
    expect(r2.state.rngStreams.weather).not.toEqual(r1.state.rngStreams.weather);
  });
});
