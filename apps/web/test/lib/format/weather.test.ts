/**
 * Tests for `lib/format/weather.ts` (P5b).
 *
 * Covers:
 *   - `labelForWeather` returns a label + icon + tone for each of the nine
 *     `WeatherCondition` values.
 *   - `labelForSeason` returns a label + icon + tone for each `Season`.
 *   - `formatTemperature` rounds to whole degrees + handles NaN.
 *   - `formatTimeOfDay` formats the [0, 1) fraction as `HH:MM`.
 *   - `formatElapsed` formats seconds as `Day N, HH:MM`.
 */
import { describe, it, expect } from 'vitest';
import {
  labelForWeather,
  labelForSeason,
  formatTemperature,
  formatTimeOfDay,
  formatElapsed,
} from '../../../lib/format/weather';
import { WEATHER_CONDITIONS } from '@capitalist-tree/shared';
import type { WeatherCondition, Season } from '@capitalist-tree/shared';

describe('labelForWeather — exhaustive coverage of all WeatherCondition values', () => {
  // The sim's `WEATHER_CONDITIONS` array is the authoritative list — the UI
  // helper must handle every one of them. If a new condition is added to
  // the sim without a row here, this test fails on the lookup.
  for (const c of WEATHER_CONDITIONS) {
    it(`returns a label for "${c}"`, () => {
      const l = labelForWeather(c as WeatherCondition);
      expect(l.label.length).toBeGreaterThan(0);
      expect(l.icon.length).toBeGreaterThan(0);
      expect(l.tone.length).toBeGreaterThan(0);
      expect(l.hint.length).toBeGreaterThan(0);
    });
  }

  it('returns the expected label + icon for sunny', () => {
    expect(labelForWeather('sunny').label).toBe('Sunny');
    expect(labelForWeather('sunny').icon).toBe('☀');
    expect(labelForWeather('sunny').tone).toBe('amber');
  });

  it('returns the expected label for heavy-rain', () => {
    expect(labelForWeather('heavy-rain').label).toBe('Heavy Rain');
  });

  it('returns the expected label for severe-storm', () => {
    expect(labelForWeather('severe-storm').label).toBe('Severe Storm');
    expect(labelForWeather('severe-storm').tone).toBe('indigo');
  });
});

describe('labelForSeason — all four seasons', () => {
  const seasons: Season[] = ['spring', 'summer', 'autumn', 'winter'];
  for (const s of seasons) {
    it(`returns a label for "${s}"`, () => {
      const l = labelForSeason(s);
      expect(l.label.length).toBeGreaterThan(0);
      expect(l.icon.length).toBeGreaterThan(0);
      expect(l.tone.length).toBeGreaterThan(0);
    });
  }

  it('uses title-case labels', () => {
    expect(labelForSeason('spring').label).toBe('Spring');
    expect(labelForSeason('summer').label).toBe('Summer');
    expect(labelForSeason('autumn').label).toBe('Autumn');
    expect(labelForSeason('winter').label).toBe('Winter');
  });
});

describe('formatTemperature — whole-degree Celsius', () => {
  it('formats 0 as 0°C', () => {
    expect(formatTemperature(0)).toBe('0°C');
  });

  it('formats positive whole degrees', () => {
    expect(formatTemperature(18)).toBe('18°C');
    expect(formatTemperature(35)).toBe('35°C');
  });

  it('rounds to whole degrees (half-away-from-zero)', () => {
    expect(formatTemperature(18.4)).toBe('18°C');
    expect(formatTemperature(18.5)).toBe('19°C');
    expect(formatTemperature(18.6)).toBe('19°C');
  });

  it('handles negatives', () => {
    expect(formatTemperature(-3.7)).toBe('-4°C');
    // Math.round(-0.5) === 0 (rounds half-toward-positive-infinity).
    expect(formatTemperature(-0.5)).toBe('0°C');
    expect(formatTemperature(-1.5)).toBe('-1°C');
  });

  it('returns —°C for NaN (defensive — no crash)', () => {
    expect(formatTemperature(Number.NaN)).toBe('—°C');
  });

  it('returns —°C for Infinity (defensive — no crash)', () => {
    expect(formatTemperature(Number.POSITIVE_INFINITY)).toBe('—°C');
    expect(formatTemperature(Number.NEGATIVE_INFINITY)).toBe('—°C');
  });
});

describe('formatTimeOfDay — [0, 1) → HH:MM', () => {
  it('formats 0.0 as 00:00 (midnight)', () => {
    expect(formatTimeOfDay(0)).toBe('00:00');
  });

  it('formats 0.25 as 06:00 (dawn)', () => {
    expect(formatTimeOfDay(0.25)).toBe('06:00');
  });

  it('formats 0.5 as 12:00 (noon)', () => {
    expect(formatTimeOfDay(0.5)).toBe('12:00');
  });

  it('formats 0.75 as 18:00 (dusk)', () => {
    expect(formatTimeOfDay(0.75)).toBe('18:00');
  });

  it('formats a near-end-of-day value as 23:59', () => {
    // 0.9999 = 23:59:6 → 23:59.
    expect(formatTimeOfDay(0.9999)).toBe('23:59');
  });

  it('wraps values outside [0, 1) modulo 1 (no crash)', () => {
    expect(formatTimeOfDay(1.25)).toBe('06:00');
    expect(formatTimeOfDay(-0.75)).toBe('06:00'); // -0.75 % 1 + 1 = 0.25
  });

  it('returns --:-- for NaN (defensive — no crash)', () => {
    expect(formatTimeOfDay(Number.NaN)).toBe('--:--');
  });
});

describe('formatElapsed — seconds → Day N, HH:MM', () => {
  it('formats 0 seconds as Day 0, 00:00', () => {
    expect(formatElapsed(0)).toBe('Day 0, 00:00');
  });

  it('formats one step (60 sim seconds) as Day 0, 00:01', () => {
    expect(formatElapsed(60)).toBe('Day 0, 00:01');
  });

  it('formats one hour (3600 sim seconds) as Day 0, 01:00', () => {
    expect(formatElapsed(3600)).toBe('Day 0, 01:00');
  });

  it('formats one day (86400 sim seconds) as Day 1, 00:00', () => {
    expect(formatElapsed(86400)).toBe('Day 1, 00:00');
  });

  it('formats a multi-day elapsed as Day N, HH:MM', () => {
    // 3 days + 4h + 30m = 259200 + 14400 + 1800 = 275400
    expect(formatElapsed(275_400)).toBe('Day 3, 04:30');
  });

  it('handles negative + NaN defensively (returns Day 0, 00:00)', () => {
    expect(formatElapsed(-100)).toBe('Day 0, 00:00');
    expect(formatElapsed(Number.NaN)).toBe('Day 0, 00:00');
  });
});
