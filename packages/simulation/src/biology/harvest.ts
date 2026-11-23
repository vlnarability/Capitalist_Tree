/**
 * Harvesting (TDD §7.5, GDD §5.4).
 *
 * Leaves are physical banknotes. Harvesting:
 *   - Removes foliage (reduces photosynthetic capacity).
 *   - Generates a CurrencyIssuanceRequest that P3's EconomySystem fulfils.
 *   - Induces immediate biological stress.
 *   - Costs the tree energy to regrow the harvested foliage (recorded for the
 *     energy-allocation model to consume via leafGrowth).
 *   - Is capped by available foliage AND the species' maximumHarvestFraction
 *     per action (GDD §17: maximum harvesting rates).
 *
 * The simulation must NEVER:
 *   - Permit negative leaf counts.
 *   - Generate money from nonexistent leaves.
 *   - Exceed the species' per-action harvest fraction.
 *
 * The simulation MUST expose a sustainable harvest estimate (GDD §5.4: "The
 * game should expose an estimated sustainable harvest level without forcing
 * the player to follow it").
 */
import type {
  CurrencyIssuanceRequest,
  HarvestResult,
  SustainableHarvestEstimate,
  TreeState,
} from '@capitalist-tree/shared';
import {
  PROVISIONAL_BIOLOGY_HARVEST_STRESS_PER_LEAF_FRACTION,
  PROVISIONAL_BIOLOGY_SUSTAINABLE_HARVEST_SAFETY_MARGIN,
} from '@capitalist-tree/shared';
import type { BiologyContext } from './types.js';
import {
  dailyWaterNeed,
  co2Factor,
  effectiveLeafCondition,
  leafHealth,
  lightFactor,
  nutrientFactor,
  temperatureFactor,
  waterFactor,
} from './photosynthesis.js';
import { maintenanceForStep } from './energy-allocation.js';

const SECONDS_PER_DAY = 24 * 60 * 60;

/**
 * Pure harvest function.
 *
 * Returns a `HarvestResult` describing what was actually harvested. Does NOT
 * mutate the input tree — the action handler applies the result.
 *
 * Invariants:
 *   - leavesHarvested >= 0
 *   - leavesHarvested <= foliageBefore
 *   - leavesHarvested <= floor(foliageBefore * species.maximumHarvestFraction),
 *     with a minimum of 1 when foliageBefore >= 1 (W47 last-leaf fix — see
 *     below). Pre-W47 floor(foliage * 0.5) rounded to 0 when foliage === 1,
 *     trapping the last leaf forever + queueing a rejected 0-amount issuance.
 *   - foliageAfter === foliageBefore - leavesHarvested
 *   - No money is generated from nonexistent leaves (leavesHarvested * denomination
 *     is the exact issuance).
 */
export function harvestLeaves(
  tree: TreeState,
  ctx: BiologyContext,
  requestedLeaves: number,
  at: number,
  currencyId: string,
): HarvestResult {
  // Dead trees have no live foliage to harvest (GDD §5.6: death persists).
  if (!tree.alive) {
    return {
      treeId: tree.id,
      leavesHarvested: 0,
      foliageBefore: tree.foliage.currentLeaves,
      foliageAfter: tree.foliage.currentLeaves,
      activeLeafAreaBefore: tree.foliage.activeLeafArea,
      activeLeafAreaAfter: tree.foliage.activeLeafArea,
      photosyntheticCapacityBefore: 0,
      photosyntheticCapacityAfter: 0,
      stressInduced: 0,
      energyCost: 0,
      currencyIssuance: {
        treeId: tree.id,
        amount: '0',
        currencyId,
        source: 'harvest-leaves',
      },
      at,
    };
  }

  const foliageBefore = tree.foliage.currentLeaves;
  // W47 (last-leaf harvest fix): the per-action fraction cap is
  // `floor(foliage * maximumHarvestFraction)`, but when foliage === 1 that
  // rounds to 0 (floor(0.5) = 0) — trapping the last leaf forever + queueing
  // a rejected 0-amount issuance ("Issuance amount '0' is not a valid
  // positive bigint string"). The `Math.max(1, …)` floor lets the player
  // harvest the last leaf (down to 0) when there is at least 1 leaf. For all
  // foliage >= 2 the value is unchanged (floor(2*0.5)=1, floor(200*0.5)=100).
  const maxByFraction =
    foliageBefore >= 1
      ? Math.max(1, Math.floor(foliageBefore * ctx.species.maximumHarvestFraction))
      : 0;
  const leavesHarvested = Math.max(0, Math.min(requestedLeaves, maxByFraction, foliageBefore));
  const foliageAfter = foliageBefore - leavesHarvested;

  // Photosynthetic capacity = eu/day at current conditions, before and after.
  // (leafCapacity is intentionally not consulted here — capacity constrains
  //   budding/growth, not the rate at which existing leaves photosynthesize.)
  const cond = effectiveLeafCondition(tree.stress, tree.foliage.seasonalCondition);
  const dailyWater = dailyWaterNeed(tree, ctx.species);
  // P11 (W33 / RV2-2 follow-up): read the step's weather temperature (with
  // climate fallback) so frost/heat-wave weather events reduce the harvest
  // capacity estimate — same fix as photosynthesis.ts:271. Pre-fix, a frost
  // event dropped weather.temperature below the species' minimum but harvest
  // kept reading the ~14 °C climate average, so the per-action capacity + the
  // sustainable-harvest estimate never reflected acute weather stress.
  const temperatureC = ctx.weather?.temperature ?? ctx.environment.globalTemperature;
  const liebig = Math.min(
    lightFactor(ctx.timeOfDay),
    temperatureFactor(temperatureC, ctx.species.temperatureRange),
    waterFactor(tree, dailyWater),
    co2Factor(ctx.environment.atmosphere.co2Concentration),
    nutrientFactor(tree.nutrients, ctx.species.nutrientRequirement),
    leafHealth(tree.stress),
  );
  const ratePerLeafPerDay =
    ctx.species.photosynthesisRate * liebig; // PROVISIONAL_BIOLOGY_MAX_PHOTOSYNTHESIS_RATE = 1.0
  const photosyntheticCapacityBefore = foliageBefore * cond * ratePerLeafPerDay;
  const photosyntheticCapacityAfter = foliageAfter * cond * ratePerLeafPerDay;

  // Stress induced: proportional to the fraction of remaining foliage harvested.
  // Harvesting ALL the foliage (50% per action max) inflicts significant stress.
  const denom = Math.max(foliageBefore, 1);
  const stressInduced = Math.min(
    1,
    (leavesHarvested / denom) * PROVISIONAL_BIOLOGY_HARVEST_STRESS_PER_LEAF_FRACTION,
  );

  // Energy cost to regrow the harvested foliage.
  const energyCost = leavesHarvested * ctx.species.leafEnergyCost;

  // Currency issuance — bigint minor units (TDD §10.1).
  const amountMinor = BigInt(leavesHarvested) * BigInt(ctx.species.leafDenominationMinor);
  const currencyIssuance: CurrencyIssuanceRequest = {
    treeId: tree.id,
    amount: String(amountMinor),
    currencyId,
    source: 'harvest-leaves',
  };

  return {
    treeId: tree.id,
    leavesHarvested,
    foliageBefore,
    foliageAfter,
    activeLeafAreaBefore:
      foliageBefore * ctx.species.leafAreaPerLeaf * cond,
    activeLeafAreaAfter: foliageAfter * ctx.species.leafAreaPerLeaf * cond,
    photosyntheticCapacityBefore,
    photosyntheticCapacityAfter,
    stressInduced,
    energyCost,
    currencyIssuance,
    at,
  };
}

/**
 * Estimate the sustainable harvest level (GDD §5.4).
 *
 * The estimate is the number of leaves the tree could lose per day without
 * driving reserves into decline, given its current production rate. Computed
 * as:
 *
 *   surplusPerDay = productionPerDay - maintenancePerDay
 *   regrowablePerDay = surplusPerDay / species.leafEnergyCost
 *   sustainablePerDay = regrowablePerDay * SAFETY_MARGIN
 *
 * The SAFETY_MARGIN (PROVISIONAL_BIOLOGY_SUSTAINABLE_HARVEST_SAFETY_MARGIN)
 * scales the recommendation down so a player following it doesn't push the tree
 * into reserve depletion. The player is free to harvest more or less.
 *
 * Pure: takes the tree + context, returns the estimate. Does not mutate.
 */
export function estimateSustainableHarvest(
  tree: TreeState,
  ctx: BiologyContext,
): SustainableHarvestEstimate {
  if (!tree.alive) {
    return {
      treeId: tree.id,
      leavesPerDay: 0,
      fractionOfFoliage: 0,
      productionPerDay: 0,
      maintenancePerDay: 0,
    };
  }

  // Compute per-day production and maintenance at current conditions.
  // (Re-derive the per-day versions; the step versions would scale by stepDays.)
  const cond = effectiveLeafCondition(tree.stress, tree.foliage.seasonalCondition);
  const dailyWater = dailyWaterNeed(tree, ctx.species);
  // P11 (W33 / RV2-2 follow-up): read the step's weather temperature (with
  // climate fallback) so frost/heat-wave weather events reduce the
  // sustainable-harvest estimate — same fix as photosynthesis.ts:271.
  const temperatureC = ctx.weather?.temperature ?? ctx.environment.globalTemperature;
  const liebig = Math.min(
    lightFactor(ctx.timeOfDay),
    temperatureFactor(temperatureC, ctx.species.temperatureRange),
    waterFactor(tree, dailyWater),
    co2Factor(ctx.environment.atmosphere.co2Concentration),
    nutrientFactor(tree.nutrients, ctx.species.nutrientRequirement),
    leafHealth(tree.stress),
  );

  const productionPerDay =
    ctx.species.photosynthesisRate * tree.foliage.currentLeaves * cond * liebig;
  // P11 (W26 / RV2-4): guard against stepDays=0 (a zero-length step would
  // divide by zero → Infinity/NaN). Default to 1 day so the per-day rate is
  // well-defined. `maintenanceForStep` already scales by stepDays internally,
  // so dividing by 1 (when stepDays is 0/missing) gives the per-day rate.
  const stepDaysSafe = ctx.stepDays > 0 ? ctx.stepDays : 1;
  const maintenancePerDay = maintenanceForStep(tree, ctx) / stepDaysSafe;

  const surplusPerDay = Math.max(0, productionPerDay - maintenancePerDay);
  const regrowablePerDay =
    ctx.species.leafEnergyCost > 0 ? surplusPerDay / ctx.species.leafEnergyCost : 0;
  const leavesPerDay = Math.floor(regrowablePerDay * PROVISIONAL_BIOLOGY_SUSTAINABLE_HARVEST_SAFETY_MARGIN);
  const fractionOfFoliage =
    tree.foliage.currentLeaves > 0
      ? Math.min(1, leavesPerDay / tree.foliage.currentLeaves)
      : 0;

  return {
    treeId: tree.id,
    leavesPerDay,
    fractionOfFoliage,
    productionPerDay,
    maintenancePerDay,
  };
}

/**
 * Threshold above which a harvest is considered a "severe defoliation" event
 * (>= 50% of foliage removed). The BiologySystem records these as damage
 * entries for the mortality check.
 */
export const SEVERE_DEFOLIATION_FRACTION = 0.5;

/** Convenience re-export for tests. */
export { SECONDS_PER_DAY };
