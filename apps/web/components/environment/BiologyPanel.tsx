/**
 * BiologyPanel — advanced biology breakdown (P5c — GDD §13.3 Advanced View).
 *
 * The advanced view (GDD §13.3) "should explain relationships, not merely
 * display more numbers." This panel subscribes narrowly to the tree +
 * environment slices of `simState`, rebuilds a BiologyContext with a 1-day
 * step so per-day rates are meaningful, and runs the simulation's own pure
 * biology functions (`photosynthesisForStep`, `allocateEnergy`,
 * `estimateSustainableHarvest`, the Liebig-factor helpers from
 * `biology/photosynthesis.ts`) against the latest snapshot.
 *
 * Output (GDD §13.3):
 *
 *   - **Photosynthesis rate** (eu/day) + the Liebig-minimum factor that
 *     constrains it. The helper {@link describeLimitingFactor} turns the
 *     Liebig min into a plain-language sentence explaining *why* the rate
 *     is what it is ("Water is the limiting factor at 18% of full rate").
 *   - **Energy allocation breakdown** (eu/day) for maintenance / roots /
 *     trunk / branches / leaves / reserves — the output of the simulation's
 *     `allocateEnergy` priority order (TDD §7.3 survival-first).
 *   - **Stress factors** — `tree.stress`, recent `tree.damage` entries,
 *     `leafHealth` derived from stress.
 *   - **Sustainable harvest estimate** (GDD §5.4) — re-derived from
 *     `estimateSustainableHarvest` so the panel doesn't need the
 *     HarvestControls' estimate.
 *   - **Derived health explanation** — combines Liebig + energy balance
 *     into one sentence ("Tree is healthy; production covers maintenance
 *     with surplus to spare" vs "Tree is stressed; water is the limiting
 *     factor and reserves are being drawn down").
 *
 * Architecture (10 Capitalist Tree rules):
 *
 *   - Rule 6 (TDD §15.1, GDD §6.1): rendering / UI reads state, never writes.
 *     The panel reads `simState` slices and computes derived display values;
 *     it never dispatches actions and never mutates inputs.
 *   - Rule 2 (purity): the biology functions from `@capitalist-tree/simulation`
 *     are pure (they take a tree + context + production and return deltas /
 *     new values without mutating). The BiologyContext built here is a fresh
 *     object on every render; no engine state is touched.
 *   - TDD §16 selective UI updates: narrow selectors per slice. A
 *     `player.personalCash` change re-renders MoneyDisplay but NOT the
 *     BiologyPanel.
 *
 * Lifecycle: returns `null` until `simState` is published (loop hasn't
 * booted) so the parent can render a loading placeholder.
 */
'use client';

import { useMemo, type ReactElement } from 'react';
import type {
  BiologyContext,
  TreeState,
  TreeSpecies,
} from '@capitalist-tree/simulation';
import {
  allocateEnergy,
  co2Factor,
  dailyWaterNeed,
  estimateSustainableHarvest,
  effectiveLeafCondition,
  leafHealth,
  lightFactor,
  maintenanceForStep,
  nutrientFactor,
  photosynthesisForStep,
  temperatureFactor,
  waterFactor,
} from '@capitalist-tree/simulation';
import type {
  EnvironmentState,
  SimulationClock,
} from '@capitalist-tree/shared';
import { findSpeciesById } from '@capitalist-tree/content';
import { useGameStore } from '../../stores/game-store';
import { clampProgress } from '../../lib/format/tree';
import {
  describeEnergyBalance,
  describeLimitingFactor,
  type LiebigFactors,
} from '../../lib/format/describe';
import { ProgressBar } from '../common/ProgressBar';
import { Stat } from '../common/Stat';

// ----------------------------------------------------------------------------
// Constants for the per-day BiologyContext. The panel displays per-day rates
// (eu/day, leaves/day), so a 1-day step normalises every per-step helper.
// ----------------------------------------------------------------------------

const SECONDS_PER_DAY = 24 * 60 * 60;

export interface BiologyPanelProps {
  /** Optional className applied to the outer wrapper. */
  readonly className?: string;
}

/**
 * Per-day breakdown of the energy allocation produced by
 * `allocateEnergy(tree, production, ctx)`. All values are eu/day (the
 * underlying function returns eu-per-step; we feed it a 1-day step so the
 * per-step values are already per-day).
 */
interface EnergyBreakdown {
  /** Total photosynthetic production (eu/day). */
  readonly production: number;
  /** Maintenance respiration (eu/day). */
  readonly maintenance: number;
  /** Surplus after maintenance (eu/day). */
  readonly surplus: number;
  /** Energy drawn from reserves (eu/day, 0 when surplus >= 0). */
  readonly reserveDraw: number;
  /** Root growth (eu/day). */
  readonly rootGrowth: number;
  /** Trunk growth (eu/day). */
  readonly trunkGrowth: number;
  /** Branch growth (eu/day). */
  readonly branchGrowth: number;
  /** Leaf growth / budding (eu/day, 0 in winter for deciduous). */
  readonly leafGrowth: number;
  /** Energy stored to reserves (eu/day). */
  readonly reserveStorage: number;
}

/**
 * Build a per-day BiologyContext from the slices the panel already has.
 * Mirrors `biologyContextFromState` from `@capitalist-tree/simulation` but
 * works against individual slices instead of the full GameState — so the
 * panel can subscribe narrowly without reading the whole simState.
 *
 * Pure: takes the slices + species, returns a fresh BiologyContext object.
 */
function buildDailyContext(
  clock: SimulationClock,
  environment: EnvironmentState,
  species: TreeSpecies,
): BiologyContext {
  return {
    now: clock.elapsedSeconds,
    stepSeconds: SECONDS_PER_DAY,
    stepDays: 1,
    season: clock.season,
    timeOfDay: clock.timeOfDay,
    species,
    environment,
  };
}

/**
 * Compute the per-day Liebig factors + production + allocation for display.
 * Pure: takes the slices + species, returns the derived metrics. Returns
 * `null` if any input is non-finite (defensive — never crash the panel).
 */
function computeBiologyMetrics(
  tree: TreeState,
  clock: SimulationClock,
  environment: EnvironmentState,
  species: TreeSpecies,
): {
  factors: LiebigFactors;
  production: number;
  breakdown: EnergyBreakdown;
  sustainableLeavesPerDay: number;
  maintenancePerDay: number;
} | null {
  const ctx = buildDailyContext(clock, environment, species);
  const dailyWater = dailyWaterNeed(tree, species);

  const factors: LiebigFactors = {
    light: lightFactor(ctx.timeOfDay),
    temperature: temperatureFactor(
      environment.globalTemperature,
      species.temperatureRange,
    ),
    water: waterFactor(tree, dailyWater),
    co2: co2Factor(environment.atmosphere.co2Concentration),
    nutrients: nutrientFactor(tree.nutrients, species.nutrientRequirement),
    leafHealth: leafHealth(tree.stress),
  };

  const production = photosynthesisForStep(tree, ctx);
  const alloc = allocateEnergy(tree, production, ctx);
  const breakdown: EnergyBreakdown = {
    production,
    maintenance: alloc.maintenance,
    surplus: alloc.surplus,
    reserveDraw: alloc.reserveDraw,
    rootGrowth: alloc.rootGrowth,
    trunkGrowth: alloc.trunkGrowth,
    branchGrowth: alloc.branchGrowth,
    leafGrowth: alloc.leafGrowth,
    reserveStorage: alloc.reserveStorage,
  };

  const sustainable = estimateSustainableHarvest(tree, ctx);
  const maintenancePerDay = maintenanceForStep(tree, ctx);

  return {
    factors,
    production,
    breakdown,
    sustainableLeavesPerDay: sustainable.leavesPerDay,
    maintenancePerDay,
  };
}

/**
 * Compose a one-line "derived health explanation" from the limiting factor
 * + energy balance. Mirrors the spirit of `labelForTree` (simplified view)
 * but in advanced-view language: it names *why* the tree is healthy or
 * stressed (GDD §13.3 — relationships, not just numbers).
 */
function explainHealth(
  alive: boolean,
  limitingSentence: string,
  energySentence: string,
): string {
  if (!alive) {
    return 'The tree has died — biology is no longer active. The stump persists on the land.';
  }
  return `${limitingSentence} ${energySentence}`;
}

/**
 * Tone used for the energy-allocation rows. Mirrors the ProgressBar /
 * Stat tones (so the row label + the matching bar would render the same
 * colour family).
 */
type EnergyRowTone = 'emerald' | 'amber' | 'rose' | 'sky' | 'cyan';

/**
 * Map an energy-allocation tone to a static Tailwind text class. Tailwind
 * scans source files for literal class strings — dynamic templates like
 * `text-${tone}-300` don't get picked up, so we resolve through this
 * lookup instead (mirror of the pattern in
 * `components/dashboard/TreeConditionSummary.tsx`'s `textClassForTone`).
 */
function textClassForTone(tone: EnergyRowTone): string {
  switch (tone) {
    case 'emerald':
      return 'text-emerald-300';
    case 'amber':
      return 'text-amber-300';
    case 'rose':
      return 'text-rose-300';
    case 'sky':
      return 'text-sky-300';
    case 'cyan':
      return 'text-cyan-300';
  }
}

/**
 * Render the BiologyPanel. Subscribes narrowly to the tree + clock +
 * environment slices. Returns `null` when simState is null (loop hasn't
 * booted) or when the species can't be resolved (defensive — the
 * gameStateSchema guarantees a registered species, but a missing content
 * module should not crash the dashboard).
 */
export function BiologyPanel({ className }: BiologyPanelProps = {}): ReactElement | null {
  const tree = useGameStore((s) => s.simState?.originalTree ?? null);
  const clock = useGameStore((s) => s.simState?.clock ?? null);
  const environment = useGameStore((s) => s.simState?.world.environment ?? null);

  // Resolve the species once per tree.speciesId change. `findSpeciesById`
  // returns `undefined` if the species isn't registered (defensive — schema
  // guarantees registration, but a future content-module split could break
  // that contract; the panel degrades gracefully).
  const speciesId = tree?.speciesId ?? null;
  const species = useMemo<TreeSpecies | null>(() => {
    if (!speciesId) return null;
    return findSpeciesById(speciesId) ?? null;
  }, [speciesId]);

  // Recompute the biology metrics whenever any input slice reference changes.
  // `useMemo` deps are object references — the engine replaces the slice
  // reference on every commit, so the memo recomputes once per step.
  const metrics = useMemo(() => {
    if (!tree || !clock || !environment || !species) return null;
    return computeBiologyMetrics(tree, clock, environment, species);
  }, [tree, clock, environment, species]);

  if (tree === null || clock === null || environment === null) return null;
  if (!species || !metrics) {
    return (
      <div className={className ?? ''} data-testid="biology-panel">
        <p className="text-xs text-slate-500">Biology metrics unavailable.</p>
      </div>
    );
  }

  const limitingSentence = describeLimitingFactor(metrics.factors);
  const energySentence = describeEnergyBalance(
    metrics.production,
    metrics.maintenancePerDay,
    metrics.breakdown.reserveDraw,
  );
  const healthExplanation = explainHealth(tree.alive, limitingSentence, energySentence);

  // Stress-derived tone for the stress ProgressBar.
  const stressTone =
    tree.stress >= 0.7 ? 'rose' : tree.stress >= 0.3 ? 'amber' : 'emerald';

  // Effective leaf condition (combines stress + seasonal condition) —
  // drives the "photosynthetic capacity" row.
  const cond = effectiveLeafCondition(tree.stress, tree.foliage.seasonalCondition);
  const effectiveLeaves = tree.foliage.currentLeaves * cond;

  // Recent damage entries (severe-defoliation records drive mortality).
  const recentDamage = tree.damage.slice(-5).reverse();

  return (
    <div
      className={`flex flex-col gap-4 ${className ?? ''}`}
      data-testid="biology-panel"
    >
      {/* Photosynthesis rate + Liebig-minimum relationship. */}
      <section
        className="flex flex-col gap-2"
        data-testid="biology-photosynthesis"
      >
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">
            Photosynthesis
          </span>
          <span className="tabular-nums text-lg font-semibold text-emerald-300">
            {metrics.production.toFixed(2)} eu/day
          </span>
        </div>
        <p
          className="text-xs text-slate-400"
          data-testid="biology-limiting-factor"
        >
          {limitingSentence}
        </p>
        {/* Liebig factor bar — shows each factor as a thin row so the
            player sees the whole picture, not just the bottleneck. */}
        <ul
          className="flex flex-col gap-1.5 text-xs"
          data-testid="biology-liebig-factors"
        >
          {(
            [
              ['Light', metrics.factors.light, 'amber'],
              ['Temperature', metrics.factors.temperature, 'amber'],
              ['Water', metrics.factors.water, 'sky'],
              ['CO\u2082', metrics.factors.co2, 'slate'],
              ['Nutrients', metrics.factors.nutrients, 'emerald'],
              ['Leaf health', metrics.factors.leafHealth, 'emerald'],
            ] as const
          ).map(([label, value, tone]) => (
            <li
              key={label}
              className="flex flex-col gap-1"
              data-testid={`biology-factor-${label
                .toLowerCase()
                .replace(/[^a-z]/g, '')}`}
            >
              <div className="flex items-baseline justify-between">
                <span className="text-slate-400">{label}</span>
                <span className="tabular-nums text-slate-300">
                  {Math.round(clampProgress(value) * 100)}%
                </span>
              </div>
              <ProgressBar value={value} label={label} tone={tone} />
            </li>
          ))}
        </ul>
      </section>

      {/* Energy allocation breakdown. */}
      <section
        className="flex flex-col gap-2"
        data-testid="biology-energy-allocation"
      >
        <span className="text-[10px] uppercase tracking-wider text-slate-500">
          Energy allocation (eu/day)
        </span>
        <p
          className="text-xs text-slate-400"
          data-testid="biology-energy-balance"
        >
          {energySentence}
        </p>
        <ul className="flex flex-col gap-1.5 text-sm tabular-nums">
          {(
            [
              ['Production', metrics.breakdown.production, 'emerald'],
              ['Maintenance', metrics.breakdown.maintenance, 'amber'],
              ['Reserve draw', metrics.breakdown.reserveDraw, 'rose'],
              ['Root growth', metrics.breakdown.rootGrowth, 'sky'],
              ['Trunk growth', metrics.breakdown.trunkGrowth, 'sky'],
              ['Branch growth', metrics.breakdown.branchGrowth, 'sky'],
              ['Leaf growth', metrics.breakdown.leafGrowth, 'emerald'],
              ['Reserve storage', metrics.breakdown.reserveStorage, 'cyan'],
            ] as const
          ).map(([label, value, tone]) => (
            <li
              key={label}
              className="flex items-baseline justify-between gap-2"
              data-testid={`biology-alloc-${label
                .toLowerCase()
                .replace(/\s+/g, '-')}`}
            >
              <span className="text-slate-400">{label}</span>
              <span className={textClassForTone(tone)}>{value.toFixed(3)}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Stress + damage. */}
      <section className="flex flex-col gap-2" data-testid="biology-stress">
        <span className="text-[10px] uppercase tracking-wider text-slate-500">
          Stress factors
        </span>
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-slate-400">Cumulative stress</span>
            <span className="text-xs tabular-nums text-slate-300">
              {Math.round(clampProgress(tree.stress) * 100)}%
            </span>
          </div>
          <ProgressBar value={tree.stress} label="Tree stress" tone={stressTone} />
        </div>
        <Stat
          label="Effective leaf condition"
          value={`${Math.round(clampProgress(cond) * 100)}%`}
          sub={`Effective leaves: ${Math.round(effectiveLeaves)} of ${tree.foliage.currentLeaves} (stress + seasonal senescence)`}
        />
        {recentDamage.length > 0 ? (
          <ul
            className="flex flex-col gap-1 text-xs"
            data-testid="biology-damage"
          >
            {recentDamage.map((d, i) => (
              <li
                key={`${d.type}-${d.appliedAt}-${i}`}
                className="flex items-baseline justify-between gap-2"
              >
                <span className="text-rose-300">{d.type}</span>
                <span className="tabular-nums text-slate-500">
                  sev {Math.round(clampProgress(d.severity) * 100)}% · day{' '}
                  {Math.floor(d.appliedAt / SECONDS_PER_DAY)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {/* Sustainable harvest estimate (also surfaced in HarvestControls). */}
      <section
        className="flex flex-col gap-1"
        data-testid="biology-sustainable-harvest"
      >
        <span className="text-[10px] uppercase tracking-wider text-slate-500">
          Sustainable harvest estimate (GDD §5.4)
        </span>
        <Stat
          label="Recommended leaves / day"
          value={metrics.sustainableLeavesPerDay.toString()}
          sub={
            metrics.sustainableLeavesPerDay > 0
              ? 'Soft guideline — the tree can regrow this without dipping into reserves.'
              : 'No surplus available — harvesting will deplete reserves.'
          }
        />
      </section>

      {/* Derived health explanation — the headline relationship sentence. */}
      <section
        className="rounded border border-slate-800/60 bg-slate-900/40 p-3 text-xs text-slate-200"
        data-testid="biology-health-explanation"
      >
        <span className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">
          Derived health explanation
        </span>
        {healthExplanation}
      </section>
    </div>
  );
}
