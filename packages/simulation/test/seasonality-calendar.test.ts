/**
 * Tests for GAP-17 follow-up (b) — the seasonality → season-calendar channel.
 *
 * Pre-GAP-17, `seasonFromDay(day)` was a fixed 4-season quarterly cycle
 * (spring/summer/autumn/winter, 30 days each) regardless of the climate's
 * `seasonality` field (which was data-only). Now `seasonFromDay(day, seasonality)`
 * shapes the calendar by seasonality:
 *
 *   - **four-season**: equal quarters (the historical calendar — preserved).
 *   - **wet-dry**: dry season (winter) LONGER — models the tropical savanna /
 *     desert asymmetry (drought-deciduous trees dormant in the long dry winter).
 *   - **polar**: short growing window + long dormant winter.
 *
 * Covers the unit-level `seasonFromDay` profiles + sim-level integration (the
 * climate shapes `clock.season` at init + as the sim advances).
 */
import { describe, it, expect } from 'vitest';
import { seasonFromDay } from '../src/systems/time-system.js';
import { engine } from '../src/index.js';
import { DEFAULT_GAME_CONFIG } from '../src/initial-state.js';
import { PROVISIONAL_DAYS_PER_YEAR } from '@capitalist-tree/shared';
import type { GameConfig } from '@capitalist-tree/shared';

const SECONDS_PER_DAY = 24 * 60 * 60;

function cfg(climateId: string, startingDay = 0): GameConfig {
  return { ...DEFAULT_GAME_CONFIG, climateId, startingDay, createdAt: 0 };
}

type Seasonality = 'wet-dry' | 'four-season' | 'polar';

/** Count the days in a given season across one year for a seasonality profile. */
function daysInSeason(seasonality: Seasonality, target: string): number {
  let count = 0;
  for (let d = 0; d < PROVISIONAL_DAYS_PER_YEAR; d++) {
    if (seasonFromDay(d, seasonality) === target) count++;
  }
  return count;
}

describe('GAP-17 follow-up (b) — seasonality → season-calendar channel', () => {
  describe('seasonFromDay (climate-aware)', () => {
    it("four-season (default): equal quarters — the historical calendar preserved", () => {
      // The default arg (omitted) must match the historical behavior so existing
      // callers + tests (time-system.test.ts) are unaffected.
      expect(seasonFromDay(0)).toBe('spring');
      expect(seasonFromDay(29)).toBe('spring');
      expect(seasonFromDay(30)).toBe('summer');
      expect(seasonFromDay(60)).toBe('autumn');
      expect(seasonFromDay(90)).toBe('winter');
      expect(seasonFromDay(120)).toBe('spring'); // wraps the year
    });

    it("explicit 'four-season' matches the default for every day of the year", () => {
      for (let d = 0; d < PROVISIONAL_DAYS_PER_YEAR; d++) {
        expect(seasonFromDay(d)).toBe(seasonFromDay(d, 'four-season'));
      }
    });

    it("wet-dry: dry season (winter) longer — spring[0,20) summer[20,50) autumn[50,70) winter[70,120)", () => {
      expect(seasonFromDay(0, 'wet-dry')).toBe('spring');
      expect(seasonFromDay(19, 'wet-dry')).toBe('spring');
      expect(seasonFromDay(20, 'wet-dry')).toBe('summer');
      expect(seasonFromDay(49, 'wet-dry')).toBe('summer');
      expect(seasonFromDay(50, 'wet-dry')).toBe('autumn');
      expect(seasonFromDay(69, 'wet-dry')).toBe('autumn');
      expect(seasonFromDay(70, 'wet-dry')).toBe('winter');
      expect(seasonFromDay(119, 'wet-dry')).toBe('winter'); // winter runs to day 120
      expect(seasonFromDay(120, 'wet-dry')).toBe('spring'); // wraps
    });

    it("polar: short growing window + long winter — spring[0,15) summer[15,45) autumn[45,60) winter[60,120)", () => {
      expect(seasonFromDay(0, 'polar')).toBe('spring');
      expect(seasonFromDay(14, 'polar')).toBe('spring');
      expect(seasonFromDay(15, 'polar')).toBe('summer');
      expect(seasonFromDay(44, 'polar')).toBe('summer');
      expect(seasonFromDay(45, 'polar')).toBe('autumn');
      expect(seasonFromDay(59, 'polar')).toBe('autumn');
      expect(seasonFromDay(60, 'polar')).toBe('winter');
      expect(seasonFromDay(119, 'polar')).toBe('winter'); // winter runs to day 120
      expect(seasonFromDay(120, 'polar')).toBe('spring'); // wraps
    });

    it('the wet-dry + polar winters are longer than the four-season winter', () => {
      expect(daysInSeason('four-season', 'winter')).toBe(30);
      expect(daysInSeason('wet-dry', 'winter')).toBe(50); // dry season outlasts the wet
      expect(daysInSeason('polar', 'winter')).toBe(60); // long dormant winter
    });

    it('the polar growing window (non-winter) is shorter than four-season', () => {
      const growing = (s: Seasonality) => PROVISIONAL_DAYS_PER_YEAR - daysInSeason(s, 'winter');
      expect(growing('four-season')).toBe(90);
      expect(growing('polar')).toBe(60); // the short polar growing window
    });

    it('all three profiles sum to a full year (no gaps, no overlaps)', () => {
      // Every day-of-year maps to exactly one season; the year wraps at 120.
      for (const s of ['four-season', 'wet-dry', 'polar'] as const) {
        for (let d = 0; d < PROVISIONAL_DAYS_PER_YEAR; d++) {
          const season = seasonFromDay(d, s);
          expect(['spring', 'summer', 'autumn', 'winter']).toContain(season);
        }
        // Day 120 wraps to spring (the next year).
        expect(seasonFromDay(PROVISIONAL_DAYS_PER_YEAR, s)).toBe('spring');
      }
    });
  });

  describe('sim-level: the climate shapes clock.season', () => {
    it('a polar climate (ET) at day 60 is winter; temperate at day 60 is autumn', () => {
      const polar = engine.initialize(cfg('climate:et', 60));
      const temperate = engine.initialize(cfg('climate:temperate', 60));
      expect(polar.clock.season).toBe('winter'); // polar winter [60,120)
      expect(temperate.clock.season).toBe('autumn'); // four-season autumn [60,90)
    });

    it('a wet-dry climate (BWh) at day 70 is winter (dry peak); temperate at day 70 is autumn', () => {
      const bwh = engine.initialize(cfg('climate:bwh', 70));
      const temperate = engine.initialize(cfg('climate:temperate', 70));
      expect(bwh.clock.season).toBe('winter'); // wet-dry winter [70,120)
      expect(temperate.clock.season).toBe('autumn'); // four-season autumn [60,90)
    });

    it('advancing a polar game: the long winter spans day 60 → 120', () => {
      let s = engine.initialize(cfg('climate:et', 0));
      expect(s.clock.season).toBe('spring');
      // Day 30 → polar summer [15,45).
      s = engine.advance(s, 30 * SECONDS_PER_DAY).state;
      expect(s.clock.day).toBe(30);
      expect(s.clock.season).toBe('summer');
      // Day 60 → polar winter [60,120) begins.
      s = engine.advance(s, 30 * SECONDS_PER_DAY).state;
      expect(s.clock.day).toBe(60);
      expect(s.clock.season).toBe('winter');
      // Day 90 → still winter (the polar long dormant tail).
      s = engine.advance(s, 30 * SECONDS_PER_DAY).state;
      expect(s.clock.day).toBe(90);
      expect(s.clock.season).toBe('winter');
      // Day 120 → wraps to spring (next year).
      s = engine.advance(s, 30 * SECONDS_PER_DAY).state;
      expect(s.clock.day).toBe(120);
      expect(s.clock.season).toBe('spring');
    });
  });
});
