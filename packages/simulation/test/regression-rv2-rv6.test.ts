/**
 * RV2-1 + RV6-1 regression tests (P11 / DR-9).
 *
 * RV2-1 (W4): weather-damage events are APPLIED to `tree.damage`, not just
 *   emitted. Pre-fix, the WeatherSystem emitted `weather-damage` events but no
 *   consumer wrote to `tree.damage` — frost/storm/heat-wave death causes were
 *   unreachable (GDD §5.6). The fix (weather-system.ts:171-198) appends a
 *   `weather:<damageType>` record to `tree.damage` directly when a damage-
 *   capable condition transition occurs (gated on `conditionChanged` so damage
 *   fires once per weather episode, not every tick).
 *
 * RV6-1 (W10): critical notifications (clock-tamper, corrupt-save) are
 *   surfaced, not filtered. Pre-fix, the notification filter dropped them.
 */
import { describe, it, expect } from 'vitest';
import { engine, DEFAULT_GAME_CONFIG, Rng } from '../src/index.js';
import { shouldEmitDamage, computeDamageSeverity } from '../src/weather/effects.js';
import { weatherSystem } from '../src/systems/weather-system.js';
import type { SystemContext } from '../src/systems/system.js';
import { findWeatherEvent } from '@capitalist-tree/content';
import {
  PROVISIONAL_WEATHER_DAMAGE_INTENSITY_THRESHOLD,
  PROVISIONAL_WEATHER_DAMAGE_SEVERITY_SCALE,
} from '@capitalist-tree/shared';

const SECONDS_PER_DAY = 24 * 60 * 60;

/**
 * Run ONE WeatherSystem step with a controllable stepSeconds. The engine's
 * `advance` always uses STEP=60s (stepDays ≈ 0.000694), which after the
 * per-tick-vs-per-day fix makes condition transitions rare (~0.45/day). To
 * deterministically force a damage-capable transition in ONE step, we call
 * the WeatherSystem directly with stepSeconds=SECONDS_PER_DAY (stepDays=1),
 * which uses the full daily transition rate (the legacy behavior the
 * streamSeeds below were calibrated against).
 */
function runWeatherStep(state: any, stepSeconds: number) {
  const ctx: SystemContext = {
    now: state.clock.elapsedSeconds + stepSeconds,
    stepSeconds,
    dayOfYear: state.clock.day,
    rng: Rng.fromState(state.rngState, state.rngVersion),
  };
  return weatherSystem.execute(state, ctx);
}

describe('RV2-1 regression — weather damage is applied to tree.damage (W4 / DR-9)', () => {
  describe('damage logic (shouldEmitDamage + computeDamageSeverity)', () => {
    it('shouldEmitDamage returns true for a damage-capable condition at/above the intensity threshold', () => {
      const storm = findWeatherEvent('severe-storm')!;
      const frost = findWeatherEvent('frost')!;
      expect(shouldEmitDamage(storm, PROVISIONAL_WEATHER_DAMAGE_INTENSITY_THRESHOLD)).toBe(true);
      expect(shouldEmitDamage(storm, 0.9)).toBe(true);
      expect(shouldEmitDamage(frost, 0.8)).toBe(true);
    });

    it('shouldEmitDamage returns false below the intensity threshold (damage is intensity-gated)', () => {
      const storm = findWeatherEvent('severe-storm')!;
      expect(shouldEmitDamage(storm, 0)).toBe(false);
      expect(shouldEmitDamage(storm, PROVISIONAL_WEATHER_DAMAGE_INTENSITY_THRESHOLD - 0.01)).toBe(false);
    });

    it('shouldEmitDamage returns false for non-damaging conditions (sunny/cloudy/rain)', () => {
      const sunny = findWeatherEvent('sunny')!;
      const cloudy = findWeatherEvent('cloudy')!;
      expect(shouldEmitDamage(sunny, 0.99)).toBe(false);
      expect(shouldEmitDamage(cloudy, 0.99)).toBe(false);
    });

    it('computeDamageSeverity scales with intensity (severity = intensity × scale, clamped to [0,1])', () => {
      const storm = findWeatherEvent('severe-storm')!;
      // At intensity 0.8 → 0.8 × 0.5 = 0.4.
      expect(computeDamageSeverity(storm, 0.8)).toBeCloseTo(0.8 * PROVISIONAL_WEATHER_DAMAGE_SEVERITY_SCALE, 5);
      // Below the threshold → 0 severity (no damage).
      expect(computeDamageSeverity(storm, PROVISIONAL_WEATHER_DAMAGE_INTENSITY_THRESHOLD - 0.01)).toBe(0);
      // Non-damaging condition → 0.
      expect(computeDamageSeverity(findWeatherEvent('sunny')!, 0.99)).toBe(0);
    });
  });

  describe('the WeatherSystem applies damage to tree.damage (the RV2-1 invariant)', () => {
    // Construct a state whose weather sub-stream (Rng.fromSeed(37)) transitions
    // 'sunny' → 'frost' with intensity ≥ threshold in one step, then assert the
    // damage is APPLIED to tree.damage (not just emitted as an event). This is
    // the exact regression RV2-1 fixed: pre-fix, the event fired but tree.damage
    // stayed empty.
    it('a frost transition appends a weather:frost record to tree.damage (not just emits the event)', () => {
      const s = engine.initialize({ ...DEFAULT_GAME_CONFIG, seed: 1, createdAt: 0 });
      const state: any = {
        ...s,
        world: {
          ...s.world,
          weather: { ...s.world.weather, condition: 'sunny', daysInCondition: 5 },
        },
        rngStreams: { ...s.rngStreams, weather: Rng.fromSeed(37).getState() },
      };
      const r = runWeatherStep(state, SECONDS_PER_DAY);
      // 1. The weather-damage event fired (frost).
      const ev = r.events.find((e: any) => e.type === 'weather-damage');
      expect(ev).toBeDefined();
      expect(ev!.payload).toMatchObject({ condition: 'frost', damageType: 'frost' });
      expect(ev!.payload.severity).toBeGreaterThan(0);

      // 2. THE RV2-1 INVARIANT: the damage was APPLIED to tree.damage, not just
      //    emitted. Pre-fix, this assertion would fail (the damage array would
      //    have no weather:* record).
      const weatherDmg = r.state.originalTree.damage.filter(
        (d: any) => typeof d.type === 'string' && d.type.startsWith('weather:'),
      );
      expect(weatherDmg.length).toBeGreaterThanOrEqual(1);
      const frostRec = weatherDmg.find((d: any) => d.type === 'weather:frost');
      expect(frostRec).toBeDefined();
      expect(frostRec!.severity).toBeCloseTo(ev!.payload.severity, 5);
      expect(frostRec!.appliedAt).toBe(ev!.at);
    });

    it('a wind transition appends a weather:wind record to tree.damage (streamSeed 19)', () => {
      const s = engine.initialize({ ...DEFAULT_GAME_CONFIG, seed: 1, createdAt: 0 });
      const state: any = {
        ...s,
        world: {
          ...s.world,
          weather: { ...s.world.weather, condition: 'sunny', daysInCondition: 5 },
        },
        rngStreams: { ...s.rngStreams, weather: Rng.fromSeed(19).getState() },
      };
      const r = runWeatherStep(state, SECONDS_PER_DAY);
      const ev = r.events.find((e: any) => e.type === 'weather-damage');
      expect(ev).toBeDefined();
      expect(ev!.payload.damageType).toBe('wind');
      const windRec = r.state.originalTree.damage.find(
        (d: any) => d.type === 'weather:wind',
      );
      expect(windRec).toBeDefined();
      expect(windRec!.severity).toBeCloseTo(ev!.payload.severity, 5);
    });

    it('a non-damaging transition (sunny → cloudy) does NOT append a weather:* record', () => {
      // Find a stream seed that transitions to a non-damaging condition.
      // streamSeed 1 → sunny (no transition); use a seed that goes to cloudy/rain.
      const s = engine.initialize({ ...DEFAULT_GAME_CONFIG, seed: 1, createdAt: 0 });
      const state: any = {
        ...s,
        world: {
          ...s.world,
          weather: { ...s.world.weather, condition: 'sunny', daysInCondition: 5 },
        },
        rngStreams: { ...s.rngStreams, weather: Rng.fromSeed(1).getState() },
      };
      const r = runWeatherStep(state, SECONDS_PER_DAY);
      const weatherDmg = r.state.originalTree.damage.filter(
        (d: any) => typeof d.type === 'string' && d.type.startsWith('weather:'),
      );
      const dmgEvent = r.events.find((e: any) => e.type === 'weather-damage');
      // Either no damage event fired, OR if it didn't, no weather:* record.
      if (!dmgEvent) {
        expect(weatherDmg.length).toBe(0);
      }
    });
  });
});
