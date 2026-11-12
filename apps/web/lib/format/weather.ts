/**
 * Weather + season formatting helpers (P5b — GDD §13.1 main screen).
 *
 * Pure functions that translate the simulation's `WeatherCondition` +
 * `Season` enums into the plain-language, icon-bearing summaries the
 * simplified dashboard shows. Per GDD §13.2 ("players should not need to
 * understand ... to play"), the helpers expose:
 *
 *   - `labelForWeather(condition)` — plain-language label + emoji icon for
 *     each of the nine `WeatherCondition` values from the sim.
 *   - `toneForWeather(condition)` — Tailwind colour fragment for the
 *     weather chip on the dashboard (cool greys for clouds, blue for rain,
 *     amber for heat-wave, etc.).
 *   - `labelForSeason(season)` — title-case label + emoji for the four
 *     `Season` values.
 *   - `formatTemperature(celsius)` — `${celsius}°C` rounded to a whole
 *     degree (the renderer's seasonal overlay doesn't need decimal
 *     precision).
 *   - `formatTimeOfDay(fraction)` — `HH:MM` 24-hour clock string derived
 *     from the [0, 1) fraction on `clock.timeOfDay`.
 *   - `formatElapsed(seconds)` — `Day N, HH:MM` summary line.
 *
 * Why local (not imported from the simulation / rendering packages)?
 *   - The sim owns biological meaning; the renderer owns visual rendering.
 *   The plain-language *label + emoji* mapping is a UI concern, so it lives
 *   in the web app. Importing from rendering would couple wording to render
 *   tuning; importing from simulation would leak UI concerns into the
 *   engine (rule 6 + TDD §3 import boundary).
 *
 * Rule 6 (rendering / UI reads state, never writes): every function here
 * reads an enum + returns a string / icon / tone, and never calls into the
 * engine. They are pure + total.
 */
import type { Season, WeatherCondition } from '@capitalist-tree/shared';

// ----------------------------------------------------------------------------
// Weather → label + tone + icon.
// ----------------------------------------------------------------------------

export interface WeatherLabel {
  /** Plain-language label, e.g. `'Sunny'`, `'Heavy Rain'`. */
  readonly label: string;
  /** Single-emoji icon for the dashboard chip (kept short for monospace). */
  readonly icon: string;
  /** Tailwind tone fragment (see {@link Tone} in `lib/format/tree.ts`). */
  readonly tone: 'amber' | 'slate' | 'sky' | 'indigo' | 'rose' | 'cyan';
  /**
   * Short hint shown when the player hovers / expands the weather chip.
   * Helps the player understand what each condition does without reading
   * the manual. The hint is plain-language (GDD §13.2 — no nutrient ratios
   * or photosynthetic flux).
   */
  readonly hint: string;
}

const WEATHER_LABELS: Readonly<Record<WeatherCondition, WeatherLabel>> = Object.freeze({
  sunny: {
    label: 'Sunny',
    icon: '☀',
    tone: 'amber',
    hint: 'Clear skies — full sunlight, no rainfall.',
  },
  cloudy: {
    label: 'Cloudy',
    icon: '☁',
    tone: 'slate',
    hint: 'Overcast — reduced sunlight, no rainfall.',
  },
  rain: {
    label: 'Rain',
    icon: '🌧',
    tone: 'sky',
    hint: 'Light rain — waters the soil; low evaporation.',
  },
  'heavy-rain': {
    label: 'Heavy Rain',
    icon: '🌧',
    tone: 'sky',
    hint: 'Heavy rainfall — saturates soil; runoff possible.',
  },
  drought: {
    label: 'Drought',
    icon: '🥵',
    tone: 'amber',
    hint: 'Prolonged dryness — soil dries, tree stress rises.',
  },
  frost: {
    label: 'Frost',
    icon: '❄',
    tone: 'cyan',
    hint: 'Below-freezing — buds and young leaves at risk.',
  },
  'heat-wave': {
    label: 'Heat Wave',
    icon: '🔥',
    tone: 'rose',
    hint: 'Extreme heat — water loss spikes; tree stress rises.',
  },
  wind: {
    label: 'Windy',
    icon: '🌬',
    tone: 'slate',
    hint: 'Strong wind — increases evaporation; minor limb risk.',
  },
  'severe-storm': {
    label: 'Severe Storm',
    icon: '⛈',
    tone: 'indigo',
    hint: 'Damaging storm — risk of defoliation and limb damage.',
  },
});

/**
 * Resolve the plain-language {@link WeatherLabel} for the given condition.
 * Throws on an unknown condition — the schema guarantees one of the nine
 * values, so an unknown value indicates a desync between the UI's type
 * knowledge and the sim's output. Defensive: the dashboard catches and
 * degrades, but this helper surfaces the bug.
 */
export function labelForWeather(condition: WeatherCondition): WeatherLabel {
  const label = WEATHER_LABELS[condition];
  if (!label) {
    // Exhaustiveness guard — if a new condition is added to the sim's enum
    // without a row here, this throws at the first render. We don't silently
    // fall back because that would hide a real schema/UI drift.
    throw new Error(`labelForWeather: unknown WeatherCondition "${String(condition)}".`);
  }
  return label;
}

// ----------------------------------------------------------------------------
// Season → label + icon.
// ----------------------------------------------------------------------------

export interface SeasonLabel {
  /** Title-case label, e.g. `'Spring'`. */
  readonly label: string;
  /** Single-emoji icon for the dashboard chip. */
  readonly icon: string;
  /** Tailwind tone fragment matching the season's palette. */
  readonly tone: 'emerald' | 'amber' | 'orange' | 'cyan';
}

const SEASON_LABELS: Readonly<Record<Season, SeasonLabel>> = Object.freeze({
  spring: { label: 'Spring', icon: '🌱', tone: 'emerald' },
  summer: { label: 'Summer', icon: '☀', tone: 'amber' },
  autumn: { label: 'Autumn', icon: '🍂', tone: 'orange' },
  winter: { label: 'Winter', icon: '❄', tone: 'cyan' },
});

/**
 * Resolve the plain-language {@link SeasonLabel} for the given season.
 * Throws on an unknown season — schema guarantees one of the four values.
 */
export function labelForSeason(season: Season): SeasonLabel {
  const label = SEASON_LABELS[season];
  if (!label) {
    throw new Error(`labelForSeason: unknown Season "${String(season)}".`);
  }
  return label;
}

// ----------------------------------------------------------------------------
// Numeric formatters — temperature + time-of-day + elapsed.
// ----------------------------------------------------------------------------

/**
 * Format a Celsius temperature as a rounded whole-degree string
 * (e.g. `18` → `'18°C'`, `-3.7` → `'-4°C'`). Uses `Math.round` (round
 * half-toward-positive-infinity — `0.5°C` reads `1°C`, `-0.5°C` reads `0°C`).
 * NaN / Infinity produce `'—°C'` (defensive — never crash the dashboard).
 */
export function formatTemperature(celsius: number): string {
  if (!Number.isFinite(celsius)) return '—°C';
  const rounded = Math.round(celsius);
  return `${rounded}°C`;
}

/**
 * Format a [0, 1) time-of-day fraction as a 24-hour `HH:MM` string.
 *
 * `0.0` → `'00:00'`, `0.25` → `'06:00'`, `0.5` → `'12:00'`, `0.75` → `'18:00'`.
 * Inputs outside [0, 1) are wrapped modulo 1 so a transient bad value
 * doesn't crash the dashboard.
 */
export function formatTimeOfDay(fraction: number): string {
  if (!Number.isFinite(fraction)) return '--:--';
  const wrapped = ((fraction % 1) + 1) % 1;
  const totalMinutes = Math.floor(wrapped * 24 * 60);
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Format an elapsed-seconds value as a `Day N, HH:MM` summary.
 *
 * Days are 24 sim hours = 86_400 sim seconds. Used by the dashboard's
 * clock strip to summarise the simulation clock without exposing the raw
 * `elapsedSeconds` integer.
 */
export function formatElapsed(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return 'Day 0, 00:00';
  const days = Math.floor(seconds / 86_400);
  const remaining = seconds - days * 86_400;
  const hours = Math.floor(remaining / 3_600);
  const mins = Math.floor((remaining % 3_600) / 60);
  return `Day ${days}, ${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}
