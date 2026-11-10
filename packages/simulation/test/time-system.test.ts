import { describe, it, expect } from 'vitest';
import {
  seasonFromDay,
  timeOfDayFraction,
  SECONDS_PER_DAY,
} from '../src/systems/time-system.js';
import {
  PROVISIONAL_DAYS_PER_SEASON,
  PROVISIONAL_DAYS_PER_YEAR,
} from '@capitalist-tree/shared';
import { engine } from '../src/index.js';
import { DEFAULT_GAME_CONFIG } from '../src/initial-state.js';

describe('seasonFromDay', () => {
  it('day 0 is spring', () => {
    expect(seasonFromDay(0)).toBe('spring');
  });

  it('season transitions occur at the right day-of-year', () => {
    expect(seasonFromDay(0)).toBe('spring');
    expect(seasonFromDay(PROVISIONAL_DAYS_PER_SEASON - 1)).toBe('spring');
    expect(seasonFromDay(PROVISIONAL_DAYS_PER_SEASON)).toBe('summer');
    expect(seasonFromDay(2 * PROVISIONAL_DAYS_PER_SEASON)).toBe('autumn');
    expect(seasonFromDay(3 * PROVISIONAL_DAYS_PER_SEASON)).toBe('winter');
    expect(seasonFromDay(4 * PROVISIONAL_DAYS_PER_SEASON)).toBe('spring');
  });

  it('wraps around the year boundary', () => {
    expect(seasonFromDay(PROVISIONAL_DAYS_PER_YEAR)).toBe('spring');
    expect(seasonFromDay(2 * PROVISIONAL_DAYS_PER_YEAR + 5)).toBe(
      seasonFromDay(5),
    );
  });
});

describe('timeOfDayFraction', () => {
  it('0 seconds -> 0 (midnight)', () => {
    expect(timeOfDayFraction(0)).toBe(0);
  });

  it('midday (43200 seconds) -> 0.5', () => {
    expect(timeOfDayFraction(SECONDS_PER_DAY / 2)).toBeCloseTo(0.5, 5);
  });

  it('wraps past one day', () => {
    expect(timeOfDayFraction(SECONDS_PER_DAY + 3600)).toBeCloseTo(
      3600 / SECONDS_PER_DAY,
      5,
    );
  });
});

describe('TimeSystem end-to-end via engine.advance', () => {
  it('emits a tick per step', () => {
    const s = engine.initialize({ ...DEFAULT_GAME_CONFIG, seed: 1 });
    const r = engine.advance(s, 60); // 1 step
    expect(r.events.filter((e) => e.type === 'tick').length).toBe(1);
  });

  it('emits season-changed when crossing a season boundary', () => {
    // Start at the last day of spring; advancing one day should flip season.
    const startDay = PROVISIONAL_DAYS_PER_SEASON - 1;
    const s = engine.initialize({
      ...DEFAULT_GAME_CONFIG,
      seed: 1,
      startingDay: startDay,
    });
    expect(s.clock.season).toBe('spring');
    // Advance 1 full day = 86400 seconds = 1440 steps.
    const r = engine.advance(s, SECONDS_PER_DAY);
    const seasonEvents = r.events.filter((e) => e.type === 'season-changed');
    expect(seasonEvents.length).toBeGreaterThan(0);
    const last = seasonEvents[seasonEvents.length - 1];
    if (last && last.type === 'season-changed') {
      expect(last.payload.to).toBe('summer');
    }
  });

  it('day advances correctly across many steps', () => {
    const s = engine.initialize({ ...DEFAULT_GAME_CONFIG, seed: 1 });
    const r = engine.advance(s, SECONDS_PER_DAY * 3); // 3 days
    expect(r.state.clock.day).toBe(3);
  });
});
