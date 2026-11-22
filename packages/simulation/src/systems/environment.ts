/**
 * EnvironmentSystem (TDD §4.2, §13 Environment System, §5.5, §9.2; GDD §10,
 * §28, §59–67, §170).
 *
 * Replaces the P0 stub at registry slot #10. Runs once per simulation step
 * AFTER all other production systems (resources, biology, economy, personal,
 * automation) so it can aggregate their environmental impacts. Per
 * docs/simulation.md the registry order is stable — this slot was reserved
 * for the EnvironmentSystem in P0 and is now filled.
 *
 * Each step:
 *   1. (RNG fork DEFERRED — R-P7-1, see docs/environment.md §11.) The
 *      EnvironmentSystem's transforms are fully deterministic, so it does NOT
 *      call `ctx.rng.fork('EnvironmentSystem')`. `fork()` advances the root
 *      RNG by one draw by design; adding a third per-step fork (on top of
 *      BiologySystem's + AutomationSystem's) shifts the mortality sequence
 *      and breaks the calibrated catch-up death test. The fork lands when
 *      stochastic environmental events arrive AND the catch-up test is
 *      retuned, or `fork()` is refactored to a non-advancing derivation. A
 *      determinism test pins the current (no-fork) behaviour.
 *   2. Derive `forestCoverage` from the originalTree's biology outputs
 *      (canopy fullness + age-based maturity). READ ONLY — the EnvironmentSystem
 *      never modifies TreeState (rule: biology consistent; the EnvironmentSystem
 *      reads biology outputs but does not write them).
 *   3. Step the atmosphere (`stepAtmosphere`): advance CO2 / CH4 / N2O / aerosol
 *      concentrations from emissions vs sequestration + natural decay.
 *   4. Derive `climateForcing` from the new atmosphere (`deriveClimateForcing`).
 *   5. Step `globalTemperature` toward the forcing-driven equilibrium with
 *      thermal inertia (`stepTemperature`).
 *   6. Step `seaLevelRise` with sustained warming (`stepSeaLevel`).
 *   7. Step the regional freshwater reserve (`stepFreshwater`): rainfall in,
 *      evaporation out, slow groundwater recharge, contamination decay.
 *   8. Step the soil extension-point dynamics + health nudge (`stepSoil`).
 *   9. Step biodiversity (`stepBiodiversity`): index declines with stress,
 *      recovers when stress removed; species populations track the index.
 *  10. Derive `ecosystemResilience` from biodiversity + forestCoverage +
 *      soil.health.
 *  11. Emit `notification` events when key thresholds cross (GDD §10.3
 *      environmental feedback creates secondary consequences):
 *        - globalTemperature anomaly > 2 °C  (warning / critical)
 *        - biodiversity.index < 0.3          (warning / critical)
 *        - soil.health < 0.3                 (warning / critical)
 *      Reuses the existing `notification` SimulationEvent variant — no new
 *      event schema needed (P7a froze packages/shared; the `notification`
 *      channel is the GDD §13.5 actionable-event channel).
 *
 * ENERGY POOL: P7a added `environment.energy` { stored, capacity,
 * generationRate, consumptionRate }. P7c wires the passive/baseline energy
 * path here (resolves R-P6-3, docs/offline-automation.md §6.3): each tick the
 * EnvironmentSystem (a) derives `capacity` from the count of active battery
 * automations (`deriveEnergyCapacity` — each battery raises the ceiling) and
 * (b) debits the player's baseline ambient consumption
 * (`applyBaselineEnergyConsumption`). Solar generation + on-fire
 * `energyConsumption` debits are applied by the AutomationSystem (slot #9)
 * before this system runs. The `generationRate` / `consumptionRate` fields are
 * left at their P7a defaults (P7c uses event-driven `stored` mutation, not a
 * continuous-rate model) — @provisional, reserved for a future continuous-rate
 * energy model (GDD §17).
 *
 * LAND USE: P7a added `environment.landUse` { developed, degraded, protected }.
 * P7c routes `landDisturbance` from automation into `degraded` (resolves
 * R-P6-4) via the centralized `environment/impact.ts` `applyEnvironmentalImpact`
 * helper, called by `executeAutomation` on each fire. The EnvironmentSystem
 * does not re-apply (would double-count); it reads `landUse` as populated by
 * the AutomationSystem.
 *
 * The system is pure: it deep-copies the input state, mutates the copy, and
 * returns the new state. The input is NEVER mutated (TDD §4.1).
 *
 * Rendering reads only — the rendering layer MUST NOT execute environmental
 * evolution independently. This system is the single engine-side driver.
 */
import type { GameState, SimulationEvent } from '@capitalist-tree/shared';
import { BATTERY } from '@capitalist-tree/content';
import type { System, SystemContext, SystemResult } from './system.js';
import {
  stepAtmosphere,
  deriveClimateForcing,
  stepTemperature,
  stepSeaLevel,
  stepFreshwater,
  stepSoil,
  stepBiodiversity,
  stepIndicators,
  deriveEnergyCapacity,
  applyBaselineEnergyConsumption,
  PROVISIONAL_ENV_BASELINE_TEMP_C,
} from '../environment/index.js';

// @provisional (GDD §17: detailed resource simulation equations) — provisional
// mapping from the originalTree's biology outputs to `forestCoverage`. A
// single mature tree is treated as a small forest stand proxy: coverage grows
// with canopy fullness (currentLeaves / leafCapacity) and age-based maturity,
// starting from a 0.1 floor (a sapling already casts some shade) up to ~0.8
// (a fully mature, full-canopy tree). Promote to a decided mapping once the
// regional forest model lands (P9) — until then the originalTree is the only
// tree, so this is the canopy coverage of the plot.
const FOREST_COVERAGE_FLOOR = 0.1;
const FOREST_COVERAGE_CANOPY_WEIGHT = 0.5;
const FOREST_COVERAGE_MATURITY_WEIGHT = 0.3;
// @provisional — age in sim days at which the tree counts as fully mature for
// the coverage mapping. 10 years (3650 days) for a temperate oak; tunable.
const FOREST_COVERAGE_MATURITY_DAYS = 3650;
// P11 (W17 / RV4-F-M10): saplings (age < this) are exempt from deforestation
// stress. Pre-fix, a leafless sapling (canopy=0, maturity=0) got forestCoverage
// = 0.1 (the floor) → 90% deforestation stress → biodiversity crashed
// immediately, even though a young tree isn't "deforested." Saplings now get a
// baseline coverage representing "young forest, not deforested."
const SAPLING_AGE_DAYS = 90;
const SAPLING_FOREST_COVERAGE_BASELINE = 0.3;

/**
 * Derive `forestCoverage` in [0, 1] from the originalTree's biology outputs.
 *
 * READ ONLY — does not modify the tree. Uses canopy fullness + age-based
 * maturity. Pure: takes the tree, returns the coverage.
 *
 * P11 (W17): saplings (age < SAPLING_AGE_DAYS) get a baseline coverage so they
 * don't drive deforestation stress while they're still establishing.
 */
function deriveForestCoverage(tree: GameState['originalTree']): number {
  // P11 (W17): exempt young trees — a sapling isn't deforested, just young.
  if (tree.ageDays < SAPLING_AGE_DAYS) {
    return SAPLING_FOREST_COVERAGE_BASELINE;
  }
  const canopy = tree.foliage.leafCapacity > 0
    ? Math.min(1, tree.foliage.currentLeaves / tree.foliage.leafCapacity)
    : 0;
  const maturity = Math.min(1, tree.ageDays / FOREST_COVERAGE_MATURITY_DAYS);
  const coverage =
    FOREST_COVERAGE_FLOOR +
    FOREST_COVERAGE_CANOPY_WEIGHT * canopy +
    FOREST_COVERAGE_MATURITY_WEIGHT * maturity;
  return Math.max(0, Math.min(1, coverage));
}
// Ecosystem resilience weights (sum to 1.0). @provisional (GDD §17: detailed
// resource simulation equations) — the relative influence of biodiversity,
// forest coverage, and soil health on ecosystem resilience (GDD §10.1
// "ecosystem resilience: biodiversity, habitat quality, ecosystem
// connectivity"). Tunable.
const RESILIENCE_WEIGHTS = {
  biodiversity: 0.4,
  forestCoverage: 0.3,
  soil: 0.3,
} as const;

/** Threshold constants for `notification` event emission (GDD §10.3). */
const TEMP_ANOMALY_WARN_C = 2; // °C above baseline → warning
const TEMP_ANOMALY_CRITICAL_C = 4; // °C above baseline → critical
const BIODIVERSITY_WARN = 0.3; // index below → warning
const BIODIVERSITY_CRITICAL = 0.15; // index below → critical
const SOIL_HEALTH_WARN = 0.3; // health below → warning
const SOIL_HEALTH_CRITICAL = 0.15; // health below → critical

/**
 * Derive `ecosystemResilience` in [0, 1] from biodiversity + forestCoverage +
 * soil.health (GDD §10.1). Pure: takes the env, returns the resilience.
 *
 * W37: also re-invoked from `aggregateGlobalIndicators` (events/regional.ts)
 * AFTER the biodiversity rollup writes `env.biodiversity.index`, so the
 * resilience stays consistent with the canonical per-region-derived index at
 * end-of-tick (the EnvironmentSystem step #10 derivation runs BEFORE the
 * EventSystem rollup + would otherwise be one-tick stale).
 */
export function deriveEcosystemResilience(env: GameState['world']['environment']): number {
  const w = RESILIENCE_WEIGHTS;
  return Math.max(
    0,
    Math.min(
      1,
      w.biodiversity * env.biodiversity.index +
        w.forestCoverage * env.forestCoverage +
        w.soil * env.soil.health,
    ),
  );
}

/**
 * Emit `notification` events when key environmental thresholds cross (GDD §10.3
 * environmental feedback creates secondary consequences). Reuses the existing
 * `notification` SimulationEvent variant — no new schema (P7a froze shared).
 *
 * P11 (W15 / RV4-F-M8): throttled to threshold CROSSINGS + severity
 * escalations. Pre-fix, this emitted a notification EVERY tick the value was
 * in a threshold band — a sustained anomaly flooded the event log. Now it
 * emits only when the value transitions INTO a band (OK→warn, OK→critical,
 * warn→critical). Recovery (warn→OK, critical→warn) does NOT emit (the
 * improvement is its own reward; no need to spam). Comparing `beforeEnv` vs
 * `afterEnv` avoids any schema change (no persisted "last notified" field).
 */
type SeverityBand = 0 | 1 | 2; // 0 = OK, 1 = warn, 2 = critical

/** Classify a value into a severity band given warn + critical thresholds
 *  (lower-is-worse semantics: value < critical → 2, < warn → 1, else 0). */
function bandLower(value: number, warn: number, critical: number): SeverityBand {
  if (value < critical) return 2;
  if (value < warn) return 1;
  return 0;
}

/** Classify a value into a severity band (higher-is-worse semantics). */
function bandHigher(value: number, warn: number, critical: number): SeverityBand {
  if (value > critical) return 2;
  if (value > warn) return 1;
  return 0;
}

function pushEnvironmentNotifications(
  beforeEnv: GameState['world']['environment'],
  afterEnv: GameState['world']['environment'],
  /** The output GameState being built (`next`). Read `next.eventState.
   *  environment.lastSoilHealthBand` (the previous tick's persisted band —
   *  `next.eventState` is shared by reference from the input state, so it
   *  holds the prior tick's value) + write this-tick's band back via a new
   *  eventState object (immutably, to preserve purity). */
  next: GameState,
  now: number,
  events: SimulationEvent[],
): void {
  // Temperature anomaly (higher-is-worse).
  const tempBeforeBand = bandHigher(
    beforeEnv.globalTemperature - PROVISIONAL_ENV_BASELINE_TEMP_C,
    TEMP_ANOMALY_WARN_C,
    TEMP_ANOMALY_CRITICAL_C,
  );
  const tempAfterAnomaly = afterEnv.globalTemperature - PROVISIONAL_ENV_BASELINE_TEMP_C;
  const tempAfterBand = bandHigher(tempAfterAnomaly, TEMP_ANOMALY_WARN_C, TEMP_ANOMALY_CRITICAL_C);
  if (tempAfterBand > tempBeforeBand) {
    events.push({
      type: 'notification',
      at: now,
      payload: {
        severity: tempAfterBand === 2 ? 'critical' : 'warning',
        code: 'environment-temperature-anomaly',
        message: `Global temperature anomaly at +${tempAfterAnomaly.toFixed(1)} °C above baseline.`,
      },
    });
  }

  // Biodiversity (lower-is-worse).
  const bioBeforeBand = bandLower(beforeEnv.biodiversity.index, BIODIVERSITY_WARN, BIODIVERSITY_CRITICAL);
  const bioAfterBand = bandLower(afterEnv.biodiversity.index, BIODIVERSITY_WARN, BIODIVERSITY_CRITICAL);
  if (bioAfterBand > bioBeforeBand) {
    events.push({
      type: 'notification',
      at: now,
      payload: {
        severity: bioAfterBand === 2 ? 'critical' : 'warning',
        code: 'environment-biodiversity-low',
        message: `Biodiversity index at ${(afterEnv.biodiversity.index * 100).toFixed(0)}%.`,
      },
    });
  }

  // Soil health (lower-is-worse). W15 follow-up (RV4-F-M8): soil.health is
  // recomputed by the ResourceSystem (slot #4) BEFORE the EnvironmentSystem
  // (slot #10) runs, so beforeEnv.soil.health is already this-tick's value —
  // a within-step before/after comparison cannot detect a previous-tick →
  // this-tick escalation (a sustained-low soil.health emitted nothing).
  // Instead compare this-tick's band against the PERSISTED last band from
  // eventState.environment.lastSoilHealthBand (survives save/load → no re-fire
  // after the first post-load notification of a sustained-critical state).
  const prevEnvState = next.eventState as { environment?: { lastSoilHealthBand?: number } };
  const prevSoilBand = prevEnvState.environment?.lastSoilHealthBand ?? 0;
  const soilAfterBand = bandLower(afterEnv.soil.health, SOIL_HEALTH_WARN, SOIL_HEALTH_CRITICAL);
  if (soilAfterBand > prevSoilBand) {
    events.push({
      type: 'notification',
      at: now,
      payload: {
        severity: soilAfterBand === 2 ? 'critical' : 'warning',
        code: 'environment-soil-health-low',
        message: `Soil health at ${(afterEnv.soil.health * 100).toFixed(0)}%.`,
      },
    });
  }
  // Persist this-tick's band for next tick's crossing comparison. Create a
  // NEW eventState object — next.eventState is shared by reference from the
  // input state, so mutating it in place would break purity (Rule 4).
  next.eventState = {
    ...next.eventState,
    environment: { lastSoilHealthBand: soilAfterBand },
  };
}

export const environmentSystem: System = {
  id: 'EnvironmentSystem',
  execute(state: GameState, ctx: SystemContext): SystemResult {
    // Targeted clone (R-P10-6 perf — avoids a full structuredClone of the
    // entire GameState per tick). EnvironmentSystem mutates many nested fields
    // of `state.world.environment` in place (forestCoverage, atmosphere,
    // climateForcing, globalTemperature, seaLevelRise, freshwater, soil,
    // biodiversity, ecosystemResilience, energy) via reassignment onto the env
    // object. Only that slice is deep-cloned; the rest is shared by reference
    // (originalTree, world.weather, automation are read-only here). Pure: the
    // frozen input is never touched.
    const next: GameState = {
      ...state,
      world: {
        ...state.world,
        environment: structuredClone(state.world.environment),
      },
    };
    const events: SimulationEvent[] = [];
    const env = next.world.environment;
    // stepSeconds is the per-tick sim seconds; the helpers take seconds and
    // convert to sim days internally.
    const dtSeconds = ctx.stepSeconds;

    // @provisional RNG fork DEFERRED — see R-P7-1 in docs/environment.md.
    //
    // The EnvironmentSystem's transforms are fully deterministic (no stochastic
    // environmental events yet), so it does NOT call
    // `ctx.rng.fork('EnvironmentSystem')`. `Rng.fork()` advances the shared
    // root RNG by exactly one draw BY DESIGN (packages/simulation/src/rng.ts:
    // `fork()` calls `this.next()` to seed the child — "the parent advances by
    // exactly one draw to seed the fork"). The EnvironmentSystem runs at slot
    // #10, AFTER BiologySystem (slot #3) + WeatherSystem (slot #2). A fork
    // here would advance the root at the END of the tick, shifting the child
    // seed BiologySystem's `fork('BiologySystem')` derives on the NEXT tick →
    // the mortality roll sequence changes → the offline-catch-up "starved tree
    // dies" test (seed=3, calibrated to the current sequence) flips from
    // dies-in-1-chunk to survives. Verified empirically in P7d.
    //
    // BiologySystem + AutomationSystem also fork per-step, but their forks are
    // already baked into the calibrated sequence; adding a THIRD per-step fork
    // (EnvironmentSystem) is the perturbation. The fork will be added when (a)
    // stochastic environmental events land AND (b) the catch-up death test is
    // retuned for the shifted sequence, OR `fork()` is refactored to support a
    // non-advancing sub-stream derivation (a deeper change that retunes every
    // system's sequence — out of P7d scope). A determinism test
    // (environment.test.ts "does NOT shift the root RNG") pins this: the root
    // RNG state is unchanged across an EnvironmentSystem.execute.

    // 2. Derive forestCoverage from the originalTree's biology outputs.
    //    READ ONLY — does not modify TreeState.
    env.forestCoverage = deriveForestCoverage(next.originalTree);

    // 3. Atmosphere.
    env.atmosphere = stepAtmosphere(env, dtSeconds);

    // 4. Climate forcing (derived from the new atmosphere).
    env.climateForcing = deriveClimateForcing(env.atmosphere);

    // 5. Temperature (moves toward forcing-driven equilibrium with inertia).
    env.globalTemperature = stepTemperature(env, dtSeconds);

    // 6. Sea level (rises with sustained warming, advanced per sim year).
    env.seaLevelRise = stepSeaLevel(env.seaLevelRise, env.globalTemperature, dtSeconds);

    // 7. Freshwater (regional reserve dynamics, reads the WeatherSystem output).
    env.freshwater = stepFreshwater(env, next.world.weather, dtSeconds);

    // 8. Soil (extension-point dynamics + health nudge).
    env.soil = stepSoil(env, dtSeconds);

    // 9. Biodiversity — W37 (RV4-F-H4 first clause): the per-tick P7
    //    stress-driven `stepBiodiversity` advance is REMOVED. The canonical
    //    biodiversity producer is now the P10 per-region model in `evolveRegions`
    //    (EventSystem slot #12), + `aggregateGlobalIndicators` writes the
    //    population-weighted rollup `avgBiodiversity` back into
    //    `env.biodiversity.index` each tick. Achievements + objectives already
    //    read `aggregatedIndicators.avgBiodiversity` (W7 unified the consumers);
    //    this completes the unification by collapsing to ONE producer. The
    //    `stepBiodiversity` helper is retained as a deprecated pure function
    //    (its unit tests still exercise it directly). `deriveEcosystemResilience`
    //    (step #10 below) reads `env.biodiversity.index` — it now sees the
    //    previous tick's rollup (a one-tick lag, matching the existing
    //    `aggregatedIndicators` lag the ProgressionSystem already tolerates).

    // 10. Ecosystem resilience (derived from biodiversity + forestCoverage +
    //     soil.health).
    env.ecosystemResilience = deriveEcosystemResilience(env);

    // 10b. Energy pool reconciliation (P7c — resolves R-P6-3). (a) Derive the
    //      effective capacity from active battery automations (each battery
    //      raises the storage ceiling — passive effect). (b) Apply the player's
    //      baseline energy consumption (ambient draw) for this tick. Solar
    //      generation was already banked by the AutomationSystem (slot #9, this
    //      tick); automation `energyConsumption` is debited on-fire by
    //      `executeAutomation`. The EnvironmentSystem owns the passive/baseline
    //      energy path. Both transforms are pure; clamping (stored ≥ 0,
    //      capacity ≥ default) is inside the helpers. The `landUse` field is
    //      populated by the AutomationSystem's impact routing (R-P6-4) — read
    //      only here.
    const batteryCount = next.automation.filter(
      (a) => a.enabled && a.type === BATTERY.id,
    ).length;
    env.energy = {
      ...env.energy,
      capacity: deriveEnergyCapacity(batteryCount),
      stored: applyBaselineEnergyConsumption(env, dtSeconds),
    };

    // 10c. P13-A / GAP-21 additional indicators (airQuality, oceanHealth,
    //      wetlandCoverage, nutrientRunoff). Reads atmosphere (step 3),
    //      temperature (step 5), soil nutrients (step 8), + landUse (set by
    //      the AutomationSystem #9 this tick). Relaxes toward driver-derived
    //      targets; nutrientRunoff accumulates + decays.
    const indicators = stepIndicators(env, dtSeconds);
    env.airQuality = indicators.airQuality;
    env.oceanHealth = indicators.oceanHealth;
    env.wetlandCoverage = indicators.wetlandCoverage;
    env.nutrientRunoff = indicators.nutrientRunoff;

    // 11. Threshold notifications (GDD §10.3 environmental feedback).
    // P11 (W15): pass before + after so notifications fire only on threshold
    // crossings / severity escalations, not every tick. W15 follow-up: pass
    // `next` so the soil.health check can read + persist the previous-tick
    // band from eventState.environment.lastSoilHealthBand (soil.health is set
    // by ResourceSystem before this system runs, so a within-step before/after
    // comparison can't detect a previous-tick → this-tick escalation).
    pushEnvironmentNotifications(state.world.environment, env, next, ctx.now, events);

    return { state: next, events };
  },
};
