'use client';

/**
 * Dev demo page for the TreeView wrapper (P4d).
 *
 * Route: /dev/tree-render-demo
 *
 * This is a developer-only playground for the procedural tree renderer. It
 * exposes every scrubbable parameter the renderer reacts to (tree structure,
 * foliage state, damage, season, weather, soil, time-of-day, pollution,
 * currency cosmetic) so a developer can quickly see how the CanvasTreeRenderer
 * responds to each without booting the full simulation.
 *
 * The page builds TreeRenderData + EnvironmentRenderData FIXTURES directly
 * (no simulation state) — the shape matches what `buildTreeRenderData` /
 * `buildEnvironmentRenderData` produce from real sim state, but the values
 * are sliders / preset buttons, not engine output. The simulation itself
 * still owns all biological + economic decisions; this page just feeds the
 * renderer hand-crafted snapshots to exercise its visual range.
 *
 * Rule 6 (TDD §15.1, GDD §6.1): rendering reads state, NEVER writes. This
 * page never calls into the simulation; it only feeds the renderer.
 */
import { useMemo, useState } from 'react';
import { TreeView } from '../../../components/tree';
import {
  LEAF_BANKNOTE,
  GOLD_LEAF,
  EURO_LEAF,
  ALL_CURRENCY_VISUALS,
  type TreeRenderData,
  type EnvironmentRenderData,
  type CurrencyVisual,
  type SeasonalAppearance,
} from '@capitalist-tree/rendering';
import type { Season, WeatherCondition } from '@capitalist-tree/shared';

// ----------------------------------------------------------------------------
// Scrubbable parameter state — what the developer can move.
// ----------------------------------------------------------------------------

interface DemoState {
  // Tree structure.
  ageDays: number;
  height: number; // metres (drives trunk scale on screen).
  trunkDiameter: number; // metres.
  branchDevelopment: number; // 0..100.
  // Foliage.
  foliageDensity: number; // 0..1 — how full the canopy is.
  foliageCondition: number; // 0..1 — leaf health.
  alive: boolean;
  // Damage — one marker at `damageSeverity` (or none if severity is 0).
  damageSeverity: number; // 0..1.
  // Environment.
  season: Season;
  timeOfDay: number; // 0..1 — 0 = midnight, 0.5 = noon.
  weatherCondition: WeatherCondition;
  weatherIntensity: number; // 0..1.
  soilCondition: number; // 0..1.
  soilContamination: number; // 0..1.
  pollutionLevel: number; // 0..1.
  biodiversityLevel: number; // 0..1.
  co2Level: number; // ppm — typically 410..600.
  // Cosmetic.
  currencyId: string;
}

// ----------------------------------------------------------------------------
// Base defaults — a healthy mature summer oak at noon.
// ----------------------------------------------------------------------------

const DEFAULT_STATE: DemoState = {
  ageDays: 365 * 5,
  height: 12,
  trunkDiameter: 0.6,
  branchDevelopment: 60,
  foliageDensity: 0.85,
  foliageCondition: 0.9,
  alive: true,
  damageSeverity: 0,
  season: 'summer',
  timeOfDay: 0.5,
  weatherCondition: 'sunny',
  weatherIntensity: 0.5,
  soilCondition: 0.9,
  soilContamination: 0,
  pollutionLevel: 0,
  biodiversityLevel: 0.8,
  co2Level: 410,
  currencyId: LEAF_BANKNOTE.id,
};

// ----------------------------------------------------------------------------
// 25+ named presets — each merges partial overrides onto DEFAULT_STATE so the
// page can flip between visually distinct scenes without manual slider work.
// ----------------------------------------------------------------------------

interface Preset {
  label: string;
  description: string;
  overrides: Partial<DemoState>;
}

const PRESETS: readonly Preset[] = [
  // ----- Sapling variants --------------------------------------------------
  {
    label: 'Sapling · Spring Dawn',
    description: 'A young 1-year-old tree budding in spring at sunrise.',
    overrides: {
      ageDays: 365,
      height: 1.5,
      trunkDiameter: 0.08,
      branchDevelopment: 8,
      foliageDensity: 0.35,
      foliageCondition: 0.85,
      alive: true,
      damageSeverity: 0,
      season: 'spring',
      timeOfDay: 0.25,
      weatherCondition: 'sunny',
      weatherIntensity: 0.3,
    },
  },
  {
    label: 'Sapling · Summer Noon',
    description: 'A sapling at full summer midday.',
    overrides: {
      ageDays: 200,
      height: 1.2,
      trunkDiameter: 0.07,
      branchDevelopment: 6,
      foliageDensity: 0.45,
      foliageCondition: 0.92,
      alive: true,
      damageSeverity: 0,
      season: 'summer',
      timeOfDay: 0.5,
      weatherCondition: 'sunny',
      weatherIntensity: 0.4,
    },
  },
  {
    label: 'Sapling · Autumn Color',
    description: 'A young tree showing autumn foliage.',
    overrides: {
      ageDays: 300,
      height: 1.8,
      trunkDiameter: 0.09,
      branchDevelopment: 10,
      foliageDensity: 0.5,
      foliageCondition: 0.7,
      alive: true,
      damageSeverity: 0,
      season: 'autumn',
      timeOfDay: 0.4,
      weatherCondition: 'cloudy',
      weatherIntensity: 0.5,
    },
  },
  // ----- Mature variants ----------------------------------------------------
  {
    label: 'Mature · Summer Sunny',
    description: 'A 5-year mature oak in full summer sun.',
    overrides: { ...DEFAULT_STATE },
  },
  {
    label: 'Mature · Autumn Afternoon',
    description: 'Autumn canopy in late-afternoon golden light.',
    overrides: {
      ageDays: 365 * 6,
      height: 14,
      trunkDiameter: 0.7,
      branchDevelopment: 70,
      foliageDensity: 0.75,
      foliageCondition: 0.65,
      alive: true,
      damageSeverity: 0,
      season: 'autumn',
      timeOfDay: 0.65,
      weatherCondition: 'sunny',
      weatherIntensity: 0.4,
    },
  },
  {
    label: 'Mature · Winter Night',
    description: 'A bare deciduous tree at midnight.',
    overrides: {
      ageDays: 365 * 7,
      height: 13,
      trunkDiameter: 0.65,
      branchDevelopment: 65,
      foliageDensity: 0,
      foliageCondition: 0,
      alive: true,
      damageSeverity: 0,
      season: 'winter',
      timeOfDay: 0.0,
      weatherCondition: 'cloudy',
      weatherIntensity: 0.6,
    },
  },
  {
    label: 'Mature · Spring Morning Rain',
    description: 'A mature oak budding in spring rain.',
    overrides: {
      ageDays: 365 * 5,
      height: 12,
      trunkDiameter: 0.6,
      branchDevelopment: 60,
      foliageDensity: 0.5,
      foliageCondition: 0.85,
      alive: true,
      damageSeverity: 0,
      season: 'spring',
      timeOfDay: 0.3,
      weatherCondition: 'rain',
      weatherIntensity: 0.7,
    },
  },
  {
    label: 'Mature · Sunny Spring Buds',
    description: 'Healthy spring budding in full sun.',
    overrides: {
      ageDays: 365 * 5,
      height: 12,
      trunkDiameter: 0.6,
      branchDevelopment: 60,
      foliageDensity: 0.55,
      foliageCondition: 0.88,
      alive: true,
      damageSeverity: 0,
      season: 'spring',
      timeOfDay: 0.45,
      weatherCondition: 'sunny',
      weatherIntensity: 0.5,
    },
  },
  {
    label: 'Mature · Heavy Rain Dusk',
    description: 'Heavy rain at sunset.',
    overrides: {
      ageDays: 365 * 6,
      height: 13,
      trunkDiameter: 0.65,
      branchDevelopment: 65,
      foliageDensity: 0.8,
      foliageCondition: 0.7,
      alive: true,
      damageSeverity: 0,
      season: 'summer',
      timeOfDay: 0.78,
      weatherCondition: 'heavy-rain',
      weatherIntensity: 0.9,
    },
  },
  {
    label: 'Mature · Cloudy Day',
    description: 'Overcast summer afternoon.',
    overrides: {
      ageDays: 365 * 5,
      height: 12,
      trunkDiameter: 0.6,
      branchDevelopment: 60,
      foliageDensity: 0.8,
      foliageCondition: 0.78,
      alive: true,
      damageSeverity: 0,
      season: 'summer',
      timeOfDay: 0.5,
      weatherCondition: 'cloudy',
      weatherIntensity: 0.6,
    },
  },
  // ----- Stress / damage variants ------------------------------------------
  {
    label: 'Stressed · Drought Summer',
    description: 'Heat-stressed tree with yellowing leaves in drought.',
    overrides: {
      ageDays: 365 * 4,
      height: 10,
      trunkDiameter: 0.5,
      branchDevelopment: 50,
      foliageDensity: 0.4,
      foliageCondition: 0.25,
      alive: true,
      damageSeverity: 0.4,
      season: 'summer',
      timeOfDay: 0.55,
      weatherCondition: 'drought',
      weatherIntensity: 0.85,
      soilCondition: 0.3,
    },
  },
  {
    label: 'Stressed · Heat Wave',
    description: 'Heat-wave conditions withering the canopy.',
    overrides: {
      ageDays: 365 * 4,
      height: 10,
      trunkDiameter: 0.5,
      branchDevelopment: 50,
      foliageDensity: 0.5,
      foliageCondition: 0.2,
      alive: true,
      damageSeverity: 0.3,
      season: 'summer',
      timeOfDay: 0.55,
      weatherCondition: 'heat-wave',
      weatherIntensity: 0.9,
    },
  },
  {
    label: 'Defoliated · Severe Storm',
    description: 'Most of the canopy stripped by a severe storm.',
    overrides: {
      ageDays: 365 * 6,
      height: 12,
      trunkDiameter: 0.6,
      branchDevelopment: 60,
      foliageDensity: 0.15,
      foliageCondition: 0.3,
      alive: true,
      damageSeverity: 0.85,
      season: 'autumn',
      timeOfDay: 0.4,
      weatherCondition: 'severe-storm',
      weatherIntensity: 1.0,
    },
  },
  {
    label: 'Damaged · Frost + Wind',
    description: 'Frost damage with strong wind sway.',
    overrides: {
      ageDays: 365 * 5,
      height: 11,
      trunkDiameter: 0.55,
      branchDevelopment: 55,
      foliageDensity: 0.4,
      foliageCondition: 0.45,
      alive: true,
      damageSeverity: 0.6,
      season: 'winter',
      timeOfDay: 0.2,
      weatherCondition: 'frost',
      weatherIntensity: 0.7,
    },
  },
  {
    label: 'Damaged · Storm Damage',
    description: 'Severe storm damage (broken branches).',
    overrides: {
      ageDays: 365 * 7,
      height: 13,
      trunkDiameter: 0.65,
      branchDevelopment: 65,
      foliageDensity: 0.3,
      foliageCondition: 0.4,
      alive: true,
      damageSeverity: 1.0,
      season: 'summer',
      timeOfDay: 0.5,
      weatherCondition: 'severe-storm',
      weatherIntensity: 0.95,
    },
  },
  // ----- Dead / dying ------------------------------------------------------
  {
    label: 'Dead · Stump in Winter',
    description: 'A dead tree rendered as a bare stump.',
    overrides: {
      ageDays: 365 * 12,
      height: 8,
      trunkDiameter: 0.7,
      branchDevelopment: 30,
      foliageDensity: 0,
      foliageCondition: 0,
      alive: false,
      damageSeverity: 0,
      season: 'winter',
      timeOfDay: 0.1,
      weatherCondition: 'cloudy',
      weatherIntensity: 0.6,
    },
  },
  // ----- Environment variants ----------------------------------------------
  {
    label: 'Pollution · High CO2 Haze',
    description: 'Heavy atmospheric pollution haze.',
    overrides: {
      pollutionLevel: 0.85,
      co2Level: 580,
      weatherCondition: 'cloudy',
      weatherIntensity: 0.5,
    },
  },
  {
    label: 'Soil · Contaminated Brown',
    description: 'Contaminated soil tint.',
    overrides: {
      soilCondition: 0.4,
      soilContamination: 0.8,
    },
  },
  {
    label: 'Soil · Healthy Vibrant',
    description: 'Rich healthy soil.',
    overrides: {
      soilCondition: 1.0,
      soilContamination: 0,
    },
  },
  {
    label: 'Wind · Strong Sway',
    description: 'Windy conditions with strong branch sway.',
    overrides: {
      weatherCondition: 'wind',
      weatherIntensity: 0.9,
    },
  },
  {
    label: 'Frost · Snow Coverage',
    description: 'Frosty winter morning with snow particles.',
    overrides: {
      season: 'winter',
      timeOfDay: 0.35,
      weatherCondition: 'frost',
      weatherIntensity: 0.8,
      foliageDensity: 0.1,
    },
  },
  {
    label: 'Dusk · Sunset Glow',
    description: 'Pink-orange dusk sky.',
    overrides: {
      season: 'summer',
      timeOfDay: 0.78,
      weatherCondition: 'sunny',
      weatherIntensity: 0.3,
    },
  },
  {
    label: 'Dawn · Sunrise Colors',
    description: 'Soft dawn light.',
    overrides: {
      season: 'spring',
      timeOfDay: 0.22,
      weatherCondition: 'sunny',
      weatherIntensity: 0.4,
    },
  },
  // ----- Currency cosmetics ------------------------------------------------
  {
    label: 'Cosmetic · Gold Leaf',
    description: 'Premium gold-foil money leaves (cosmetic only).',
    overrides: {
      currencyId: GOLD_LEAF.id,
    },
  },
  {
    label: 'Cosmetic · Euro Leaf',
    description: 'Euro-style violet banknote leaves (cosmetic only).',
    overrides: {
      currencyId: EURO_LEAF.id,
    },
  },
  {
    label: 'Cosmetic · Leaf Dollar (default)',
    description: 'US-dollar-style green banknote leaves (default cosmetic).',
    overrides: {
      currencyId: LEAF_BANKNOTE.id,
    },
  },
  {
    label: 'Biodiversity · Lush Understory',
    description: 'High biodiversity drives undergrowth density.',
    overrides: {
      biodiversityLevel: 1.0,
      soilCondition: 0.95,
    },
  },
  {
    label: 'Biodiversity · Barren',
    description: 'Low biodiversity — sparse surroundings.',
    overrides: {
      biodiversityLevel: 0.1,
      soilCondition: 0.4,
    },
  },
];

// ----------------------------------------------------------------------------
// State → TreeRenderData + EnvironmentRenderData fixtures.
//
// Mirrors the shape `buildTreeRenderData` / `buildEnvironmentRenderData`
// produce from real sim state, but built directly from slider values so the
// demo doesn't need a running simulation. The seasonal appearance maps 1:1
// from the season (deciduous White Oak).
// ----------------------------------------------------------------------------

const SEASON_TO_APPEARANCE: Record<Season, SeasonalAppearance> = {
  spring: 'spring-buds',
  summer: 'summer-green',
  autumn: 'autumn-color',
  winter: 'winter-bare',
};

function stateToTree(state: DemoState): TreeRenderData {
  // Derive leafCount from density × capacity (1000-leaf capacity for the
  // demo — arbitrary, just gives the renderer a sensible particle count).
  const leafCapacity = 1000;
  const leafCount = Math.round(state.foliageDensity * leafCapacity);

  const damage =
    state.damageSeverity > 0
      ? [
          {
            type: 'severe-defoliation',
            severity: state.damageSeverity,
            appliedAt: Math.max(0, state.ageDays - 5),
          },
        ]
      : [];

  return {
    height: state.height,
    trunkDiameter: state.trunkDiameter,
    branchDevelopment: state.branchDevelopment,
    foliageDensity: state.foliageDensity,
    foliageCondition: state.foliageCondition,
    seasonalAppearance: SEASON_TO_APPEARANCE[state.season],
    damage,
    alive: state.alive,
    speciesId: 'species:white-oak',
    speciesShape: 'broadleaf-round',
    ageDays: state.ageDays,
    leafCount,
  };
}

function stateToEnvironment(state: DemoState): EnvironmentRenderData {
  return {
    soilCondition: state.soilCondition,
    soilContamination: state.soilContamination,
    weatherCondition: state.weatherCondition,
    weatherIntensity: state.weatherIntensity,
    timeOfDay: state.timeOfDay,
    season: state.season,
    pollutionLevel: state.pollutionLevel,
    biodiversityLevel: state.biodiversityLevel,
    co2Level: state.co2Level,
  };
}

function currencyById(id: string): CurrencyVisual {
  return ALL_CURRENCY_VISUALS.find((c) => c.id === id) ?? LEAF_BANKNOTE;
}

// ----------------------------------------------------------------------------
// Slider helper components.
// ----------------------------------------------------------------------------

interface SliderProps {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit?: string;
  readonly onChange: (value: number) => void;
  readonly format?: (value: number) => string;
}

function Slider({ label, value, min, max, step, unit, onChange, format }: SliderProps) {
  const display = format ? format(value) : value.toFixed(2);
  return (
    <label className="block space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-slate-300">{label}</span>
        <span className="font-mono text-slate-400">
          {display}
          {unit ? <span className="ml-0.5">{unit}</span> : null}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-emerald-500"
      />
    </label>
  );
}

interface SelectProps<T extends string> {
  readonly label: string;
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly onChange: (value: T) => void;
}

function Select<T extends string>({ label, value, options, onChange }: SelectProps<T>) {
  return (
    <label className="block space-y-1">
      <div className="text-xs text-slate-300">{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// ----------------------------------------------------------------------------
// Main page.
// ----------------------------------------------------------------------------

const SEASON_OPTIONS: readonly { readonly value: Season; readonly label: string }[] = [
  { value: 'spring', label: 'Spring' },
  { value: 'summer', label: 'Summer' },
  { value: 'autumn', label: 'Autumn' },
  { value: 'winter', label: 'Winter' },
];

const WEATHER_OPTIONS: readonly { readonly value: WeatherCondition; readonly label: string }[] = [
  { value: 'sunny', label: 'Sunny' },
  { value: 'cloudy', label: 'Cloudy' },
  { value: 'rain', label: 'Rain' },
  { value: 'heavy-rain', label: 'Heavy Rain' },
  { value: 'drought', label: 'Drought' },
  { value: 'frost', label: 'Frost' },
  { value: 'heat-wave', label: 'Heat Wave' },
  { value: 'wind', label: 'Wind' },
  { value: 'severe-storm', label: 'Severe Storm' },
];

const CURRENCY_OPTIONS: readonly { readonly value: string; readonly label: string }[] =
  ALL_CURRENCY_VISUALS.map((c) => ({ value: c.id, label: c.name }));

function formatTimeOfDay(t: number): string {
  const totalMin = Math.floor(t * 24 * 60);
  const h = Math.floor(totalMin / 60) % 24;
  const m = totalMin % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export default function TreeRenderDemoPage() {
  const [state, setState] = useState<DemoState>(DEFAULT_STATE);

  const tree = useMemo(() => stateToTree(state), [state]);
  const environment = useMemo(() => stateToEnvironment(state), [state]);
  const currency = useMemo(() => currencyById(state.currencyId), [state.currencyId]);

  function patch(p: Partial<DemoState>): void {
    setState((s) => ({ ...s, ...p }));
  }

  function applyPreset(p: Preset): void {
    setState({ ...DEFAULT_STATE, ...p.overrides });
  }

  return (
    <main className="mx-auto max-w-7xl p-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Tree Render Demo</h1>
        <p className="text-sm text-slate-400">
          P4d developer playground for the procedural CanvasTreeRenderer. Scrub
          any parameter and watch the renderer react in real time. No
          simulation is running — these are hand-built TreeRenderData +
          EnvironmentRenderData fixtures fed directly to the renderer.
        </p>
      </header>

      <section className="rounded-lg border border-slate-800 p-4">
        <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">
          Presets ({PRESETS.length})
        </div>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              title={p.description}
              onClick={() => applyPreset(p)}
              className="px-2 py-1 rounded border border-slate-700 bg-slate-900 text-xs text-slate-200 hover:border-emerald-500 hover:bg-emerald-500/10"
            >
              {p.label}
            </button>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <section className="rounded-lg border border-slate-800 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-wider text-slate-500">
              TreeView canvas
            </div>
            <div className="text-xs font-mono text-slate-500">
              season={state.season} · tod={formatTimeOfDay(state.timeOfDay)} ·{' '}
              {state.weatherCondition} · {state.alive ? 'alive' : 'dead'}
            </div>
          </div>
          <TreeView
            tree={tree}
            environment={environment}
            currency={currency}
            width={600}
            height={480}
            className="w-full rounded border border-slate-800"
          />
          <p className="text-xs text-slate-500">
            The canvas redraws at the browser&apos;s native frame rate against
            the latest snapshots — branch sway + weather particles animate
            independently of how often you move a slider. The simulation would
            feed this component once per engine step; here we feed it directly
            from React state.
          </p>
        </section>

        <aside className="space-y-4">
          <section className="rounded-lg border border-slate-800 p-4 space-y-3">
            <div className="text-xs uppercase tracking-wider text-slate-500">
              Tree
            </div>
            <Slider
              label="Age"
              value={state.ageDays}
              min={0}
              max={365 * 15}
              step={1}
              unit="d"
              onChange={(v) => patch({ ageDays: v })}
              format={(v) => `${(v / 365).toFixed(1)}y`}
            />
            <Slider
              label="Height"
              value={state.height}
              min={0.5}
              max={25}
              step={0.1}
              unit="m"
              onChange={(v) => patch({ height: v })}
            />
            <Slider
              label="Trunk diameter"
              value={state.trunkDiameter}
              min={0.05}
              max={1.5}
              step={0.05}
              unit="m"
              onChange={(v) => patch({ trunkDiameter: v })}
            />
            <Slider
              label="Branch development"
              value={state.branchDevelopment}
              min={0}
              max={100}
              step={1}
              onChange={(v) => patch({ branchDevelopment: v })}
              format={(v) => v.toFixed(0)}
            />
            <Slider
              label="Foliage density"
              value={state.foliageDensity}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => patch({ foliageDensity: v })}
              format={(v) => `${(v * 100).toFixed(0)}%`}
            />
            <Slider
              label="Foliage health"
              value={state.foliageCondition}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => patch({ foliageCondition: v })}
              format={(v) => `${(v * 100).toFixed(0)}%`}
            />
            <Slider
              label="Damage severity"
              value={state.damageSeverity}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => patch({ damageSeverity: v })}
              format={(v) => (v === 0 ? 'none' : `${(v * 100).toFixed(0)}%`)}
            />
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={state.alive}
                onChange={(e) => patch({ alive: e.target.checked })}
                className="accent-emerald-500"
              />
              Alive (unchecked → renders as stump)
            </label>
          </section>

          <section className="rounded-lg border border-slate-800 p-4 space-y-3">
            <div className="text-xs uppercase tracking-wider text-slate-500">
              Environment
            </div>
            <Select
              label="Season"
              value={state.season}
              options={SEASON_OPTIONS}
              onChange={(v) => patch({ season: v })}
            />
            <Slider
              label="Time of day"
              value={state.timeOfDay}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => patch({ timeOfDay: v })}
              format={formatTimeOfDay}
            />
            <Select
              label="Weather"
              value={state.weatherCondition}
              options={WEATHER_OPTIONS}
              onChange={(v) => patch({ weatherCondition: v })}
            />
            <Slider
              label="Weather intensity"
              value={state.weatherIntensity}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => patch({ weatherIntensity: v })}
              format={(v) => `${(v * 100).toFixed(0)}%`}
            />
            <Slider
              label="Soil condition"
              value={state.soilCondition}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => patch({ soilCondition: v })}
              format={(v) => `${(v * 100).toFixed(0)}%`}
            />
            <Slider
              label="Soil contamination"
              value={state.soilContamination}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => patch({ soilContamination: v })}
              format={(v) => `${(v * 100).toFixed(0)}%`}
            />
            <Slider
              label="Pollution"
              value={state.pollutionLevel}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => patch({ pollutionLevel: v })}
              format={(v) => `${(v * 100).toFixed(0)}%`}
            />
            <Slider
              label="CO2 concentration"
              value={state.co2Level}
              min={410}
              max={600}
              step={1}
              unit="ppm"
              onChange={(v) => patch({ co2Level: v })}
              format={(v) => v.toFixed(0)}
            />
            <Slider
              label="Biodiversity"
              value={state.biodiversityLevel}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => patch({ biodiversityLevel: v })}
              format={(v) => `${(v * 100).toFixed(0)}%`}
            />
          </section>

          <section className="rounded-lg border border-slate-800 p-4 space-y-3">
            <div className="text-xs uppercase tracking-wider text-slate-500">
              Cosmetic
            </div>
            <Select
              label="Currency visual"
              value={state.currencyId}
              options={CURRENCY_OPTIONS}
              onChange={(v) => patch({ currencyId: v })}
            />
            <p className="text-xs text-slate-500">
              Cosmetic only — does NOT modify the underlying monetary value
              (TDD §15.4). Swapping cosmetics re-tints the leaves via
              <code className="mx-1 text-slate-300">renderer.setCurrency()</code>
              without recreating the renderer.
            </p>
          </section>

          <section className="rounded-lg border border-slate-800 p-4 space-y-2">
            <div className="text-xs uppercase tracking-wider text-slate-500">
              Reset
            </div>
            <button
              type="button"
              onClick={() => setState(DEFAULT_STATE)}
              className="w-full px-3 py-1 rounded border border-slate-700 bg-slate-900 text-sm text-slate-200 hover:border-amber-500"
            >
              Reset to defaults
            </button>
          </section>
        </aside>
      </div>
    </main>
  );
}
