/**
 * ResourceSystem (TDD §4.2, §8; GDD §10).
 *
 * Replaces the P0 stub at registry slot #4. Runs once per simulation step
 * AFTER BiologySystem so the resource model reacts to the new weather + the
 * tree's just-computed biological activity.
 *
 * Each step:
 *   1. Read the weather (just produced by WeatherSystem).
 *   2. Compute the per-step water balance for the COUPLED soil + tree water
 *      pools:
 *        - Inputs: rainfall (from weather), irrigation (already applied by
 *          the apply-water action handler — appears in env.soil.soilWater).
 *        - Outputs: evaporation (temp-modulated), drainage (recharges
 *          groundwater), tree uptake (Liebig-capped by root capacity +
 *          soil water; transferred to tree.water.stored), runoff (excess
 *          above capacity).
 *        - Tree transpiration: removed from tree.water.stored (the tree's
 *          consumption, based on `dailyWaterNeed` from the biology module).
 *      Apply the balance to env.soil.soilWater, env.freshwater.groundwater,
 *      env.freshwater.availability, AND originalTree.water.stored.
 *   3. Compute the per-step nutrient balance for the COUPLED soil + tree
 *      nutrient pools:
 *        - Soil: replenishment (slow background mineral weathering) +
 *          leaching (when soil is saturated — GDD §10.3).
 *        - Tree: consumption (scales with foliage) + absorption (Liebig-capped
 *          by root capacity + soil nutrients).
 *      Apply the balance to env.soil.nutrients AND originalTree.nutrients.
 *   4. Add organic matter replenishment (slow background decomposition).
 *   5. Recompute derived soil health from organic matter, nutrients, moisture,
 *      contamination (+ stubbed extension-point factors).
 *   6. Emit `resource-notification` events for adverse conditions (low soil
 *      water, high contamination, low soil health).
 *
 * P2 OWNS the per-tree water/nutrient uptake model. P1's BiologySystem
 * previously had a placeholder (`applyPlaceholderResources`) that mirrored
 * env.freshwater.availability → tree.water.stored and env.soil.nutrients →
 * tree.nutrients WITHOUT decrementing env (conservation was broken). P2
 * removed the placeholder — the full balance (conservation-enforced) lives
 * here. BiologySystem reads `tree.water.stored` and `tree.nutrients` via
 * photosynthesis's Liebig factors (`waterFactor`, `nutrientFactor`); those
 * values are now populated by this system's uptake model.
 *
 * The system is pure: it deep-copies the input state, mutates the copy, and
 * returns the new state. The input is NEVER mutated.
 */
import type { GameState, SimulationEvent } from '@capitalist-tree/shared';
import {
  PROVISIONAL_RESOURCE_ORGANIC_MATTER_REPLENISH_PER_DAY,
} from '@capitalist-tree/shared';
import { WEATHER_EVENT_MAP } from '@capitalist-tree/content';
import type { System, SystemContext, SystemResult } from './system.js';
import { deepCopy } from '../deep-copy.js';
import {
  computeNutrientBalance,
  applyNutrientBalance,
} from '../resources/nutrients.js';
import {
  computeSoilEvaporationRate,
  computeWaterBalance,
  applyWaterBalance,
} from '../resources/water.js';
import {
  computeSoilHealth,
  contaminationFraction,
  moistureFraction,
} from '../resources/soil.js';
import { computeSpeciesMaxFoliage, dailyWaterNeed, getSpeciesOrFail } from '../biology/index.js';

const SECONDS_PER_DAY = 24 * 60 * 60;

export const resourceSystem: System = {
  id: 'ResourceSystem',
  execute(state: GameState, ctx: SystemContext): SystemResult {
    const next = deepCopy(state);
    const events: SimulationEvent[] = [];
    const env = next.world.environment;
    const weather = next.world.weather;
    const stepDays = ctx.stepSeconds / SECONDS_PER_DAY;
    const tree = next.originalTree;

    // If the tree is dead, it no longer transpires or absorbs. Soil still
    // evolves (rainfall, evaporation, drainage, leaching) but tree uptake
    // is zero. P3 still drains any pending issuances queued before death.
    const alive = tree.alive;

    // 1. Look up the weather event definition (for rainfall + evaporation mult).
    const weatherEvent = WEATHER_EVENT_MAP[weather.condition];
    if (!weatherEvent) {
      // Defensive — schema guarantees all conditions have a definition.
      return { state: next, events };
    }

    // 2. Water balance (coupled soil + tree pools).
    const species = getSpeciesOrFail(tree.speciesId);
    const speciesMaxFoliage = computeSpeciesMaxFoliage(species);
    // dailyWaterNeed is the L/day the tree transpires at current foliage.
    // Returns 0 for a dead tree (foliage.currentLeaves would be 0 after death)
    // — but we short-circuit anyway so a recently-dead tree doesn't transpire
    // stale water from its buffer.
    const dailyWater = alive ? dailyWaterNeed(tree, species) : 0;
    const evapRatePerDay = computeSoilEvaporationRate(weatherEvent, weather.temperature);
    // Rainfall comes from the weather condition × intensity × stepDays.
    // The weather event's `rainfallLPerDay` is the rate at intensity=1; actual
    // rainfall scales linearly with intensity.
    const rainfall = weatherEvent.rainfallLPerDay * weather.intensity * stepDays;
    const waterBalance = computeWaterBalance({
      soilWater: env.soil.soilWater,
      treeWater: tree.water.stored,
      treeWaterCapacity: tree.water.capacity,
      dailyWaterNeedL: dailyWater,
      rainfall,
      evaporationRatePerDay: evapRatePerDay,
      rootAbsorptionCapacity: tree.roots.absorptionCapacity,
      stepDays,
    });
    applyWaterBalance(env, tree, waterBalance);

    // 3. Nutrient balance (coupled soil + tree pools).
    const nutrientBalance = computeNutrientBalance({
      soilNutrients: env.soil.nutrients,
      treeNutrients: tree.nutrients,
      speciesNutrientRequirement: species.nutrientRequirement,
      speciesMaxFoliage,
      currentLeaves: alive ? tree.foliage.currentLeaves : 0,
      rootAbsorptionCapacity: tree.roots.absorptionCapacity,
      soilWater: env.soil.soilWater,
      stepDays,
    });
    applyNutrientBalance(env, tree, nutrientBalance);

    // 4. Organic matter replenishment (slow background decomposition).
    env.soil.organicMatter = Math.max(
      0,
      env.soil.organicMatter + PROVISIONAL_RESOURCE_ORGANIC_MATTER_REPLENISH_PER_DAY * stepDays,
    );

    // 5. Recompute derived soil health.
    env.soil.health = computeSoilHealth(env);

    // 6. Emit resource-notification events for adverse conditions.
    pushResourceNotifications(env, ctx.now, events);

    return { state: next, events };
  },
};

/**
 * Emit soft notifications for adverse resource conditions.
 *
 * Thresholds are PROVISIONAL — tuned for early-playtest visibility. The
 * events are info-only; the simulation continues regardless.
 */
function pushResourceNotifications(
  env: GameState['world']['environment'],
  now: number,
  events: SimulationEvent[],
): void {
  const moistFrac = moistureFraction(env.soil.soilWater);
  if (moistFrac < 0.25) {
    events.push({
      type: 'resource-notification',
      at: now,
      payload: {
        code: 'low-soil-water',
        severity: moistFrac < 0.1 ? 'critical' : 'warning',
        message: `Soil water at ${(moistFrac * 100).toFixed(0)}% of ideal moisture.`,
        value: moistFrac,
      },
    });
  }

  const contamFrac = contaminationFraction(env.soil.contamination);
  if (contamFrac < 0.5) {
    events.push({
      type: 'resource-notification',
      at: now,
      payload: {
        code: 'soil-contamination-high',
        severity: contamFrac < 0.25 ? 'critical' : 'warning',
        message: `Soil contamination at ${((1 - contamFrac) * 100).toFixed(0)}% of full degrade.`,
        value: contamFrac,
      },
    });
  }

  if (env.soil.health < 0.4) {
    events.push({
      type: 'resource-notification',
      at: now,
      payload: {
        code: 'soil-health-low',
        severity: env.soil.health < 0.2 ? 'critical' : 'warning',
        message: `Soil health at ${(env.soil.health * 100).toFixed(0)}%.`,
        value: env.soil.health,
      },
    });
  }
}
