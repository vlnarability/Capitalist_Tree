/**
 * WeatherDisplay — current weather + clock (P5b — GDD §13.1).
 *
 * Subscribes narrowly to:
 *
 *   - `simState.world.weather.condition` — drives the weather chip label +
 *     icon + tone (via `labelForWeather`).
 *   - `simState.world.weather.temperature` — shown as `°C` via
 *     `formatTemperature`.
 *   - `simState.world.weather.intensity` — shown as a ProgressBar so the
 *     player can see how strong the current weather is (a high-intensity
 *     severe storm is more dangerous than a low-intensity one).
 *   - `simState.clock.season` + `clock.timeOfDay` + `clock.day` +
 *     `clock.elapsedSeconds` — shown as the season chip + `Day N, HH:MM`
 *     summary.
 *
 * Per GDD §13.2 (simplified view), the helper does NOT expose the weather
 * Markov matrix, the climate baseline, or the intensity-driven damage math
 * — those land in P5c's advanced view. Here, the player just sees "Rain,
 * 18°C, Day 5, Spring, 14:30" and a one-line hint about what the condition
 * does.
 *
 * Rule 6 (rendering / UI reads state, never writes): no engine calls, no
 * dispatches. The engine owns the weather model; this component renders.
 */
'use client';

import type { ReactElement } from 'react';
import { useGameStore } from '../../stores/game-store';
import {
  labelForWeather,
  labelForSeason,
  formatTemperature,
  formatTimeOfDay,
  formatElapsed,
} from '../../lib/format/weather';
import { clampProgress } from '../../lib/format/tree';
import { ProgressBar } from '../common/ProgressBar';
import type { WeatherCondition, Season } from '@capitalist-tree/shared';

export interface WeatherDisplayProps {
  /** Optional className applied to the outer wrapper. */
  readonly className?: string;
}

/**
 * Map a Tailwind tone fragment from lib/format/weather.ts (one of
 * `'amber' | 'slate' | 'sky' | 'indigo' | 'rose' | 'cyan'`) to the matching
 * ProgressBar tone. ProgressBar accepts the wider `Tone` set including
 * `'emerald' | 'orange'`; this map handles the weather subset.
 */
function weatherToneToProgressBarTone(
  tone: 'amber' | 'slate' | 'sky' | 'indigo' | 'rose' | 'cyan',
): 'amber' | 'slate' | 'sky' | 'indigo' | 'rose' | 'cyan' {
  return tone;
}

/**
 * Render the weather + clock summary. Subscribes narrowly to the weather +
 * clock slices. Returns `null` when `simState` is null.
 */
export function WeatherDisplay({ className }: WeatherDisplayProps = {}): ReactElement | null {
  const condition = useGameStore((s) => s.simState?.world.weather.condition ?? null);
  const temperature = useGameStore((s) => s.simState?.world.weather.temperature ?? null);
  const intensity = useGameStore((s) => s.simState?.world.weather.intensity ?? null);
  const season = useGameStore((s) => s.simState?.clock.season ?? null);
  const timeOfDay = useGameStore((s) => s.simState?.clock.timeOfDay ?? null);
  const day = useGameStore((s) => s.simState?.clock.day ?? null);
  const elapsedSeconds = useGameStore((s) => s.simState?.clock.elapsedSeconds ?? null);

  if (
    condition === null ||
    temperature === null ||
    intensity === null ||
    season === null ||
    timeOfDay === null ||
    day === null ||
    elapsedSeconds === null
  ) {
    return null;
  }

  const w = labelForWeather(condition as WeatherCondition);
  const s = labelForSeason(season as Season);
  const tempStr = formatTemperature(temperature);
  const todStr = formatTimeOfDay(timeOfDay);
  const elapsedStr = formatElapsed(elapsedSeconds);
  const intensityClamped = clampProgress(intensity);
  const barTone = weatherToneToProgressBarTone(w.tone);

  return (
    <div className={`flex flex-col gap-3 ${className ?? ''}`} data-testid="weather-display">
      <div className="flex items-center gap-2">
        <span className="text-2xl" aria-hidden="true">
          {w.icon}
        </span>
        <div className="flex flex-col">
          <span className={`text-lg font-semibold ${textClassForTone(w.tone)}`}>
            {w.label}
          </span>
          <span className="text-xs text-slate-500">{tempStr}</span>
        </div>
      </div>

      <p className="text-xs text-slate-400" data-testid="weather-hint">
        {w.hint}
      </p>

      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">
            Intensity
          </span>
          <span className="text-xs tabular-nums text-slate-400">
            {Math.round(intensityClamped * 100)}%
          </span>
        </div>
        <ProgressBar
          value={intensityClamped}
          label="Weather intensity"
          tone={barTone}
        />
      </div>

      <div className="flex items-center justify-between border-t border-slate-800/80 pt-2">
        <div className="flex items-center gap-1.5">
          <span aria-hidden="true">{s.icon}</span>
          <span className={`text-sm font-medium ${textClassForTone(s.tone)}`}>
            {s.label}
          </span>
        </div>
        <div className="flex flex-col items-end">
          <span className="font-mono text-sm text-slate-200">{todStr}</span>
          <span className="text-[10px] text-slate-500">{elapsedStr}</span>
        </div>
      </div>
    </div>
  );
}

/** Map a weather/season tone to a Tailwind text colour class. */
function textClassForTone(
  tone: 'amber' | 'slate' | 'sky' | 'indigo' | 'rose' | 'cyan' | 'emerald' | 'orange',
): string {
  switch (tone) {
    case 'amber':
      return 'text-amber-300';
    case 'slate':
      return 'text-slate-300';
    case 'sky':
      return 'text-sky-300';
    case 'indigo':
      return 'text-indigo-300';
    case 'rose':
      return 'text-rose-300';
    case 'cyan':
      return 'text-cyan-300';
    case 'emerald':
      return 'text-emerald-300';
    case 'orange':
      return 'text-orange-300';
  }
}
