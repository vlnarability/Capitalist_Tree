/**
 * EnvironmentPanel — advanced environmental breakdown (P5c — GDD §13.3).
 *
 * The advanced view (GDD §13.3) "should explain relationships, not merely
 * display more numbers." This panel subscribes narrowly to
 * `simState.world.environment` (+ `clock` for the day stamp used by
 * `describeTransaction` if the panel embeds a transaction row), and exposes
 * the soil N/P/K, water balance, weather details, pollution, CO2, and
 * biodiversity — the items GDD §13.3 calls out as "Environmental data".
 *
 * Output:
 *
 *   - **Soil nutrients** — N/P/K vs the species' requirement, with the
 *     limiting nutrient called out via {@link describeNutrientStatus}.
 *     Also: pH, organic matter, microbial activity, compaction,
 *     contamination, soil health.
 *   - **Water balance** — soil water relative to soil water capacity (via
 *     {@link describeSoilWaterBalance}), plus freshwater availability +
 *     groundwater + contamination.
 *   - **Weather details** — condition, temperature, intensity,
 *     daysInCondition, prevCondition. Mirrors WeatherDisplay but with the
 *     raw values + the Markov-transition context (advanced view).
 *   - **Pollution + emissions** — soil contamination + atmosphere emissions
 *     via {@link describePollution}.
 *   - **CO2 concentration** — atmosphere.co2Concentration vs the
 *     photosynthesis saturation point (PROVISIONAL_BIOLOGY_CO2_SATURATION_PPM).
 *   - **Biodiversity** — index + species-population breakdown.
 *
 * Architecture: same as BiologyPanel — narrow selectors, pure compute,
 * `describe.ts` for the plain-language explanations (rule 6 + purity).
 *
 * Returns `null` until `simState` is published (loop hasn't booted).
 */
'use client';

import { useMemo, type ReactElement } from 'react';
import type { TreeSpecies } from '@capitalist-tree/simulation';
import {
  PROVISIONAL_BIOLOGY_CO2_SATURATION_PPM,
  type EnvironmentState,
  type SimulationClock,
  type WeatherState,
} from '@capitalist-tree/shared';
import { findSpeciesById } from '@capitalist-tree/content';
import { useGameStore } from '../../stores/game-store';
import { clampProgress } from '../../lib/format/tree';
import {
  describeNutrientStatus,
  describePollution,
  describeSoilWaterBalance,
  type NutrientKey,
} from '../../lib/format/describe';
import { formatTemperature } from '../../lib/format/weather';
import { PROVISIONAL_RESOURCE_SOIL_WATER_CAPACITY } from '@capitalist-tree/shared';
import { ProgressBar } from '../common/ProgressBar';
import { Stat } from '../common/Stat';

export interface EnvironmentPanelProps {
  /** Optional className applied to the outer wrapper. */
  readonly className?: string;
}

/**
 * Soil water capacity used by the water-balance description. Mirrors the
 * constant the apply-water handler uses (`PROVISIONAL_RESOURCE_SOIL_WATER_CAPACITY`)
 * so the panel describes the same capacity the engine enforces.
 */
const SOIL_WATER_CAPACITY = PROVISIONAL_RESOURCE_SOIL_WATER_CAPACITY;

/** Plain-language label for each nutrient. */
const NUTRIENT_LABELS: Readonly<Record<NutrientKey, string>> = Object.freeze({
  nitrogen: 'Nitrogen (N)',
  phosphorus: 'Phosphorus (P)',
  potassium: 'Potassium (K)',
});

/**
 * Map a describe-tone (returned by `describeSoilWaterBalance` etc.) to a
 * static Tailwind text class. Tailwind scans source files for literal class
 * strings — dynamic templates like `text-${tone}-300` don't get picked up,
 * so we resolve through this lookup instead.
 */
function describeToneToTextClass(
  tone: 'sky' | 'emerald' | 'amber' | 'rose' | 'slate',
): string {
  switch (tone) {
    case 'sky':
      return 'text-sky-300';
    case 'emerald':
      return 'text-emerald-300';
    case 'amber':
      return 'text-amber-300';
    case 'rose':
      return 'text-rose-300';
    case 'slate':
      return 'text-slate-300';
  }
}

/**
 * Render the EnvironmentPanel. Subscribes narrowly to the environment +
 * clock + tree.speciesId slices. Returns `null` when simState is null.
 */
export function EnvironmentPanel({
  className,
}: EnvironmentPanelProps = {}): ReactElement | null {
  const environment = useGameStore((s) => s.simState?.world.environment ?? null);
  const weather = useGameStore((s) => s.simState?.world.weather ?? null);
  const clock = useGameStore((s) => s.simState?.clock ?? null);
  const speciesId = useGameStore((s) => s.simState?.originalTree.speciesId ?? null);

  // Resolve the species so we can compare soil nutrients against the
  // species' requirement (Liebig). Defensive: returns null if the species
  // isn't registered; the panel degrades by skipping the nutrient-vs-req
  // comparison and showing raw values only.
  const species = useMemo<TreeSpecies | null>(() => {
    if (!speciesId) return null;
    return findSpeciesById(speciesId) ?? null;
  }, [speciesId]);

  if (environment === null || weather === null || clock === null) return null;

  return (
    <div
      className={`flex flex-col gap-4 ${className ?? ''}`}
      data-testid="environment-panel"
    >
      <SoilSection
        environment={environment}
        species={species}
      />
      <WaterSection environment={environment} />
      <WeatherSection weather={weather} />
      <AtmosphereSection environment={environment} clock={clock} />
      <BiodiversitySection environment={environment} />
    </div>
  );
}

// ----------------------------------------------------------------------------
// Sub-sections — each is a small presentational component that takes its
// slice as a prop. Keeping them as separate components keeps the parent's
// JSX readable + lets React skip re-rendering a sub-section whose props
// didn't change (the parent subscribes narrowly; the children are pure).
// ----------------------------------------------------------------------------

interface SoilSectionProps {
  readonly environment: EnvironmentState;
  readonly species: TreeSpecies | null;
}

function SoilSection({ environment, species }: SoilSectionProps): ReactElement {
  const soil = environment.soil;
  const nutrients = soil.nutrients;
  const requirement = species?.nutrientRequirement ?? null;

  const nutrientSummary = useMemo(() => {
    if (!requirement) return null;
    return describeNutrientStatus(nutrients, requirement);
  }, [nutrients, requirement]);

  return (
    <section className="flex flex-col gap-2" data-testid="environment-soil">
      <span className="text-[10px] uppercase tracking-wider text-slate-500">
        Soil nutrients + condition
      </span>
      {nutrientSummary ? (
        <p className="text-xs text-slate-400" data-testid="environment-nutrient-summary">
          {nutrientSummary.summary}
        </p>
      ) : (
        <p className="text-xs text-slate-500">
          Soil nutrient ratios unavailable (species not resolved).
        </p>
      )}
      <ul className="grid grid-cols-3 gap-2 text-sm tabular-nums" data-testid="environment-npk">
        {(
          [
            ['nitrogen', nutrients.nitrogen],
            ['phosphorus', nutrients.phosphorus],
            ['potassium', nutrients.potassium],
          ] as const
        ).map(([key, value]) => (
          <li
            key={key}
            className="flex flex-col gap-0.5 rounded border border-slate-800/60 bg-slate-900/40 p-2"
            data-testid={`environment-npk-${key}`}
          >
            <span className="text-[10px] uppercase tracking-wider text-slate-500">
              {NUTRIENT_LABELS[key]}
            </span>
            <span className="text-base font-semibold text-slate-100">
              {value.toFixed(1)}
            </span>
            {requirement ? (
              <span className="text-[10px] text-slate-500">
                req {requirement[key].toFixed(1)}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <Stat label="Soil health" value={`${Math.round(clampProgress(soil.health) * 100)}%`} />
        <Stat label="pH" value={soil.ph.toFixed(1)} sub="neutral = 7.0" />
        <Stat label="Organic matter" value={soil.organicMatter.toFixed(1)} />
        <Stat
          label="Contamination"
          value={soil.contamination.toFixed(1)}
          tone={soil.contamination > 0 ? 'amber' : 'slate'}
        />
        <Stat
          label="Microbial activity"
          value={soil.microbialActivity.toFixed(2)}
          sub="1.00 = baseline"
        />
        <Stat
          label="Compaction"
          value={`${Math.round(clampProgress(soil.compaction) * 100)}%`}
        />
      </div>
      <ProgressBar
        value={soil.health}
        label="Soil health"
        tone={
          soil.health >= 0.7
            ? 'emerald'
            : soil.health >= 0.3
              ? 'amber'
              : 'rose'
        }
      />
    </section>
  );
}

interface WaterSectionProps {
  readonly environment: EnvironmentState;
}

function WaterSection({ environment }: WaterSectionProps): ReactElement {
  const soil = environment.soil;
  const freshwater = environment.freshwater;
  const balance = describeSoilWaterBalance(soil.soilWater, SOIL_WATER_CAPACITY);
  return (
    <section className="flex flex-col gap-2" data-testid="environment-water">
      <span className="text-[10px] uppercase tracking-wider text-slate-500">
        Water balance
      </span>
      <p
        className={`text-xs ${describeToneToTextClass(balance.tone)}`}
        data-testid="environment-water-summary"
      >
        {balance.summary}
      </p>
      <ProgressBar
        value={soil.soilWater / SOIL_WATER_CAPACITY}
        label="Soil moisture vs capacity"
        tone={balance.tone}
      />
      <div className="grid grid-cols-2 gap-2 text-xs">
        <Stat
          label="Soil moisture"
          value={`${Math.round(soil.soilWater)} L`}
          sub={`cap ${SOIL_WATER_CAPACITY} L`}
        />
        <Stat
          label="Freshwater avail."
          value={`${Math.round(freshwater.availability)} L`}
        />
        <Stat
          label="Groundwater"
          value={`${Math.round(freshwater.groundwater)} L`}
        />
        <Stat
          label="Freshwater contam."
          value={freshwater.contamination.toFixed(2)}
          tone={freshwater.contamination > 0 ? 'amber' : 'slate'}
        />
      </div>
    </section>
  );
}

interface WeatherSectionProps {
  readonly weather: WeatherState;
}

function WeatherSection({ weather }: WeatherSectionProps): ReactElement {
  const intensityTone =
    weather.intensity >= 0.7
      ? 'rose'
      : weather.intensity >= 0.4
        ? 'amber'
        : 'sky';
  return (
    <section className="flex flex-col gap-2" data-testid="environment-weather">
      <span className="text-[10px] uppercase tracking-wider text-slate-500">
        Weather details
      </span>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <Stat label="Condition" value={weather.condition} />
        <Stat label="Temperature" value={formatTemperature(weather.temperature)} />
        <Stat
          label="Intensity"
          value={`${Math.round(clampProgress(weather.intensity) * 100)}%`}
          tone={intensityTone}
        />
        <Stat
          label="Days in condition"
          value={String(weather.daysInCondition)}
        />
        <Stat
          label="Previous condition"
          value={weather.prevCondition ?? '—'}
        />
      </div>
      <ProgressBar
        value={weather.intensity}
        label="Weather intensity"
        tone={intensityTone}
      />
    </section>
  );
}

interface AtmosphereSectionProps {
  readonly environment: EnvironmentState;
  readonly clock: SimulationClock;
}

function AtmosphereSection({ environment, clock }: AtmosphereSectionProps): ReactElement {
  const atmosphere = environment.atmosphere;
  const co2Saturation = clampProgress(
    atmosphere.co2Concentration / PROVISIONAL_BIOLOGY_CO2_SATURATION_PPM,
  );
  const pollution = describePollution(
    environment.soil.contamination,
    atmosphere.emissions,
  );
  return (
    <section className="flex flex-col gap-2" data-testid="environment-atmosphere">
      <span className="text-[10px] uppercase tracking-wider text-slate-500">
        Pollution + atmosphere
      </span>
      <p className="text-xs text-slate-400" data-testid="environment-pollution">
        {pollution}
      </p>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <Stat
          label={'CO\u2082 concentration'}
          value={`${atmosphere.co2Concentration.toFixed(0)} ppm`}
          sub={`saturation ${PROVISIONAL_BIOLOGY_CO2_SATURATION_PPM} ppm`}
        />
        <Stat
          label="Emissions"
          value={atmosphere.emissions.toFixed(2)}
          tone={atmosphere.emissions > 0 ? 'amber' : 'emerald'}
        />
        <Stat
          label="Sequestration"
          value={atmosphere.sequestration.toFixed(2)}
          tone={atmosphere.sequestration > 0 ? 'emerald' : 'slate'}
        />
        <Stat
          label="Global temperature"
          value={formatTemperature(environment.globalTemperature)}
        />
      </div>
      <ProgressBar
        value={co2Saturation}
        label="CO2 vs saturation"
        tone={co2Saturation >= 1 ? 'amber' : 'emerald'}
      />
      {/* Defensive — clock is read so the section re-renders when the day
          advances (the atmosphere values may have shifted). The value
          isn't displayed but the prop dependency keeps the section fresh. */}
      <span className="sr-only" data-testid="environment-atmosphere-day">
        Day {Math.floor(clock.elapsedSeconds / 86_400)}
      </span>
    </section>
  );
}

interface BiodiversitySectionProps {
  readonly environment: EnvironmentState;
}

function BiodiversitySection({
  environment,
}: BiodiversitySectionProps): ReactElement {
  const bio = environment.biodiversity;
  return (
    <section className="flex flex-col gap-2" data-testid="environment-biodiversity">
      <span className="text-[10px] uppercase tracking-wider text-slate-500">
        Biodiversity
      </span>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <Stat
          label="Biodiversity index"
          value={`${Math.round(clampProgress(bio.index) * 100)}%`}
          tone={
            bio.index >= 0.6
              ? 'emerald'
              : bio.index >= 0.3
                ? 'amber'
                : 'rose'
          }
        />
        <Stat
          label="Forest coverage"
          value={`${Math.round(clampProgress(environment.forestCoverage) * 100)}%`}
        />
        <Stat
          label="Ecosystem resilience"
          value={`${Math.round(clampProgress(environment.ecosystemResilience) * 100)}%`}
        />
        <Stat
          label="Tracked species"
          value={String(bio.speciesPopulations.length)}
        />
      </div>
      <ProgressBar
        value={bio.index}
        label="Biodiversity index"
        tone={
          bio.index >= 0.6
            ? 'emerald'
            : bio.index >= 0.3
              ? 'amber'
              : 'rose'
        }
      />
      {bio.speciesPopulations.length > 0 ? (
        <ul
          className="flex flex-col gap-1 text-xs tabular-nums"
          data-testid="environment-species-populations"
        >
          {bio.speciesPopulations.map((sp) => (
            <li
              key={sp.speciesId}
              className="flex items-baseline justify-between gap-2"
            >
              <span className="text-slate-400">{sp.speciesId}</span>
              <span className="text-slate-300">
                pop {sp.population.toFixed(1)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
