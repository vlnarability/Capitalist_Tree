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
 *   1. Fork a deterministic sub-stream `'EnvironmentSystem'` from `ctx.rng`.
 *      Reserved for future stochastic environmental events (wildfire rolls,
 *      extreme-weather spikes). Currently unused by the deterministic
 *      transforms below; the fork keeps the environment path's draws
 *      independent of other systems' sequences. @provisional — persisting it
 *      would need an `rngStreams.environment` field (GDD §17); the fork is
 *      stateless per-step, like BiologySystem's + AutomationSystem's forks.
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
import { deepCopy } from '../deep-copy.js';
import {
  stepAtmosphere,
  deriveClimateForcing,
  stepTemperature,
  stepSeaLevel,
  stepFreshwater,
  stepSoil,
  stepBiodiversity,
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
 * Derive `forestCoverage` in [0, 1] from the originalTree's biology outputs.
 *
 * READ ONLY — does not modify the tree. Uses canopy fullness + age-based
 * maturity. Pure: takes the tree, returns the coverage.
 */
function deriveForestCoverage(tree: GameState['originalTree']): number {
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

/**
 * Derive `ecosystemResilience` in [0, 1] from biodiversity + forestCoverage +
 * soil.health (GDD §10.1). Pure: takes the env, returns the resilience.
 */
function deriveEcosystemResilience(env: GameState['world']['environment']): number {
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
 */
function pushEnvironmentNotifications(
  env: GameState['world']['environment'],
  now: number,
  events: SimulationEvent[],
): void {
  const tempAnomaly = env.globalTemperature - PROVISIONAL_ENV_BASELINE_TEMP_C;
  if (tempAnomaly > TEMP_ANOMALY_CRITICAL_C) {
    events.push({
      type: 'notification',
      at: now,
      payload: {
        severity: 'critical',
        code: 'environment-temperature-anomaly',
        message: `Global temperature anomaly at +${tempAnomaly.toFixed(1)} °C above baseline.`,
      },
    });
  } else if (tempAnomaly > TEMP_ANOMALY_WARN_C) {
    events.push({
      type: 'notification',
      at: now,
      payload: {
        severity: 'warning',
        code: 'environment-temperature-anomaly',
        message: `Global temperature anomaly at +${tempAnomaly.toFixed(1)} °C above baseline.`,
      },
    });
  }

  if (env.biodiversity.index < BIODIVERSITY_CRITICAL) {
    events.push({
      type: 'notification',
      at: now,
      payload: {
        severity: 'critical',
        code: 'environment-biodiversity-low',
        message: `Biodiversity index at ${(env.biodiversity.index * 100).toFixed(0)}%.`,
      },
    });
  } else if (env.biodiversity.index < BIODIVERSITY_WARN) {
    events.push({
      type: 'notification',
      at: now,
      payload: {
        severity: 'warning',
        code: 'environment-biodiversity-low',
        message: `Biodiversity index at ${(env.biodiversity.index * 100).toFixed(0)}%.`,
      },
    });
  }

  if (env.soil.health < SOIL_HEALTH_CRITICAL) {
    events.push({
      type: 'notification',
      at: now,
      payload: {
        severity: 'critical',
        code: 'environment-soil-health-low',
        message: `Soil health at ${(env.soil.health * 100).toFixed(0)}%.`,
      },
    });
  } else if (env.soil.health < SOIL_HEALTH_WARN) {
    events.push({
      type: 'notification',
      at: now,
      payload: {
        severity: 'warning',
        code: 'environment-soil-health-low',
        message: `Soil health at ${(env.soil.health * 100).toFixed(0)}%.`,
      },
    });
  }
}

export const environmentSystem: System = {
  id: 'EnvironmentSystem',
  execute(state: GameState, ctx: SystemContext): SystemResult {
    const next = deepCopy(state);
    const events: SimulationEvent[] = [];
    const env = next.world.environment;
    // stepSeconds is the per-tick sim seconds; the helpers take seconds and
    // convert to sim days internally.
    const dtSeconds = ctx.stepSeconds;

    // @provisional RNG fork DEFERRED. The EnvironmentSystem's transforms in
    // P7b are fully deterministic (no stochastic environmental events yet),
    // so it does NOT call `ctx.rng.fork('EnvironmentSystem')`. Calling fork
    // would advance the shared root RNG by one draw per tick, shifting the
    // sequence every other system sees (BiologySystem's mortality rolls,
    // WeatherSystem's next condition, etc.) and breaking existing
    // determinism-calibrated tests (e.g. the offline-catch-up "starved tree
    // dies" scenario). The fork will be added in P7c+ when stochastic
    // environmental events (wildfire rolls, extreme-weather spikes) land and
    // the catch-up tests are retuned for the shifted sequence. Matches the
    // BiologySystem / AutomationSystem fork pattern — but only once there's a
    // draw to make.

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

    // 9. Biodiversity (index + species populations, reads soil.health +
    //    forestCoverage + globalTemperature).
    env.biodiversity = stepBiodiversity(env, dtSeconds);

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

    // 11. Threshold notifications (GDD §10.3 environmental feedback).
    pushEnvironmentNotifications(env, ctx.now, events);

    return { state: next, events };
  },
};
