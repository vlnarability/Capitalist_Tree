/**
 * BiologySystem (TDD §4.2, §7; GDD §5).
 *
 * The BiologySystem is the only writer to TreeState biology fields (rule:
 * rendering reads, never writes; biology is internally consistent; GDD §5.1
 * "health is derived"). It runs once per simulation step in registry order:
 *
 *   3. BiologySystem — photosynthesis/growth; depends on weather + time.
 *
 * Each step it:
 *   1. Looks up the species via the content package.
 *   2. Builds a BiologyContext for the pure biology functions.
 *   3. If the tree is dead, recomputes health=0 and returns (death persists).
 *   4. Updates seasonal condition (deciduous budding/senescence).
 *   5. Recomputes leafCapacity from branch development.
 *   6. Caps currentLeaves at the seasonally-supported max (autumn senescence).
 *   7. Photosynthesizes — computes eu produced this step.
 *   8. Allocates energy (survival-first: maintenance → growth → reserves).
 *   9. Applies growth (height, trunk, branch, root, new leaves).
 *  10. Updates reserves (storage - draw - recovery).
 *  11. Updates stress (deficiency → +; favourable → −).
 *  12. Prunes decayed damage records.
 *  13. Ages the tree.
 *  14. Recomputes derived health (GDD §5.1).
 *  15. Checks mortality (RNG-driven; deterministic per seed).
 *  16. Emits `tree-died` if the tree died, plus `biology-notification` events
 *      for low reserves / drought stress / nutrient deficiency (soft signals).
 *
 * WATER + NUTRIENT UPTAKE (P2 contract):
 *   BiologySystem no longer mutates `tree.water.stored` or `tree.nutrients`.
 *   P2's ResourceSystem (registry slot #4, runs AFTER this system) owns the
 *   full water + nutrient balance: it transfers water from `env.soil.soilWater`
 *   into `tree.water.stored` (Liebig-capped by root capacity + soil water,
 *   conservation-enforced) and nutrients from `env.soil.nutrients` into
 *   `tree.nutrients`. BiologySystem reads `tree.water.stored` (via
 *   photosynthesis's `waterFactor`) and `tree.nutrients` (via `nutrientFactor`)
 *   to compute Liebig factors — the values are populated by ResourceSystem.
 *
 *   P1 had a placeholder (`applyPlaceholderResources`) that mirrored env
 *   into tree.water/nutrients WITHOUT decrementing env (conservation was
 *   broken). P2 removed the placeholder; see R-P2-1 in
 *   docs/resources-weather.md for the full contract.
 *
 * Emits (SimulationEvent):
 *   - `tree-died`           when the tree dies (GDD §5.6).
 *   - `biology-notification` soft notifications for low reserves, drought, etc.
 *
 * The system is pure: it deep-copies the input state, mutates the copy, and
 * returns the new state. The input is NEVER mutated.
 */
import type { GameState, SimulationEvent, TreeState, TreeDamageState } from '@capitalist-tree/shared';
import type { System, SystemContext, SystemResult } from './system.js';
import {
  biologyContextFromState,
  photosynthesisForStep,
  allocateEnergy,
  applyGrowth,
  applyReserveDelta,
  computeReserveCapacity,
  computeLeafCapacity,
  computeActiveLeafArea,
  computeHealth,
  advanceSeasonalCondition,
  maxSupportedLeaves,
  updateStress,
  recoverWear,
  checkMortality,
  recentSevereDefoliations,
  rollInfestation,
  getSpeciesOrFail,
  type BiologyContext,
} from '../biology/index.js';
import {
  applyTraitEffects,
  defaultBiologyParameters,
} from '../progression/trait-effects.js';
import {
  PROVISIONAL_BIOLOGY_DEATH_DEFOLIATION_WINDOW_DAYS,
  PROVISIONAL_BIOLOGY_WEAR_PER_DAMAGE,
  PROVISIONAL_BIOLOGY_REPRODUCTION_SEED_ENERGY_COST_EU,
  PROVISIONAL_BIOLOGY_REPRODUCTION_FRUITING_AGE_FRACTION,
  PROVISIONAL_BIOLOGY_REPRODUCTION_SEED_YIELD,
} from '@capitalist-tree/shared';

const SECONDS_PER_DAY = 24 * 60 * 60;

/** Damage records older than this (sim seconds) are pruned. */
const DAMAGE_PRUNE_SECONDS = PROVISIONAL_BIOLOGY_DEATH_DEFOLIATION_WINDOW_DAYS * SECONDS_PER_DAY;

/** Drain queued CurrencyIssuanceRequests — P3's EconomySystem consumes them. */
function hasPendingIssuances(tree: TreeState): boolean {
  return tree.pendingIssuances.length > 0;
}

export const biologySystem: System = {
  id: 'BiologySystem',
  execute(state: GameState, ctx: SystemContext): SystemResult {
    // Targeted clone (R-P10-6 perf — avoids a full structuredClone of the
    // entire GameState per tick). BiologySystem is the sole writer to
    // `originalTree` biology fields (energy, foliage, structure, roots, stress,
    // damage, health, ageDays, alive); only that slice is deep-cloned. The rest
    // of the state (clock, world, economy, businesses, eventState, ...) is
    // shared by reference — read-only here. Pure: the frozen input is never
    // touched (a new top-level object + a new originalTree).
    const next: GameState = {
      ...state,
      originalTree: structuredClone(state.originalTree),
    };
    const events: SimulationEvent[] = [];
    const tree = next.originalTree;

    const species = getSpeciesOrFail(tree.speciesId);
    const stepDays = ctx.stepSeconds / SECONDS_PER_DAY;
    const bioCtx: BiologyContext = biologyContextFromState(
      next,
      ctx.now,
      ctx.stepSeconds,
      stepDays,
      species,
    );

    // P11 (W9 / RV4-F-M7, extended W32): apply genetic trait effects to the
    // biology multipliers BEFORE any biology computation that consumes them.
    // `applyTraitEffects` folds each active (expressed) trait's benefit +
    // trade-off into the parameter set. W9 wired only `growthRateMultiplier`
    // (into applyGrowth); W32 threads the full set through photosynthesis
    // (energyProduction, warmClimate, droughtResistance, waterDemand), leaf
    // capacity (productionCapacity), reserve capacity (reservesCapacity),
    // infestation (pestVulnerability), mortality (frostSurvival), + growth
    // (earlyGrowth, structuralGrowth, maxGrowth). Pre-W32 the helper was
    // called but 11 of 12 multipliers were computed then never read.
    const traitParams = applyTraitEffects(
      defaultBiologyParameters(),
      state.progression.genetics.activeTraits,
    );

    // Dead trees stay dead. Recompute health=0 and skip the rest. P3 still
    // drains any pending issuances queued before death.
    if (!tree.alive) {
      tree.health = 0;
      // Don't emit anything new — death was emitted when it happened.
      return { state: next, events };
    }

    // 4. Seasonal condition (deciduous budding/senescence).
    tree.foliage.seasonalCondition = advanceSeasonalCondition(tree, bioCtx);

    // 5. Recompute leafCapacity from branch development.
    // P11 (W32): pass traitParams so productionCapacityMultiplier (large-foliage)
    // scales the leaf capacity.
    tree.foliage.leafCapacity = computeLeafCapacity(
      tree.structure.branchDevelopment,
      species.initial.leafCapacity,
      traitParams,
    );

    // 6. Cap currentLeaves at the seasonally-supported maximum (senescence).
    const seasonalMax = maxSupportedLeaves(tree);
    if (tree.foliage.currentLeaves > seasonalMax) {
      tree.foliage.currentLeaves = seasonalMax;
    }
    // Invariant: no negative leaf counts (TDD §18.4).
    if (tree.foliage.currentLeaves < 0) tree.foliage.currentLeaves = 0;

    // 7. Photosynthesis.
    // P11 (W32): pass traitParams so energyProductionMultiplier
    // (efficient-photosynthesis), warmClimatePerformanceMultiplier
    // (cold-resistance trade-off), droughtResistanceMultiplier (deep-roots),
    // + waterDemandMultiplier (rapid-growth / large-foliage) all take effect.
    const production = photosynthesisForStep(tree, bioCtx, traitParams);
    tree.energy.production = production / stepDays; // store per-day rate

    // NOTE: water + nutrient uptake is owned by ResourceSystem (slot #4,
    // runs AFTER this system). P1's placeholder `applyPlaceholderResources`
    // was removed in P2 — see R-P2-1 in docs/resources-weather.md.
    // BiologySystem reads `tree.water.stored` and `tree.nutrients` (via
    // photosynthesis's `waterFactor` / `nutrientFactor` Liebig factors);
    // ResourceSystem populates those fields from env.soil.soilWater and
    // env.soil.nutrients each tick.

    // 8. Energy allocation (survival-first).
    const alloc = allocateEnergy(tree, production, bioCtx);
    tree.energy.consumption = (alloc.maintenance + alloc.reserveDraw) / stepDays;

    // Reserve capacity — recomputed from current biomass (the tree may have
    // grown since last tick). Used by budding and reserve update below.
    // P11 (W32): pass traitParams so reservesCapacityMultiplier (thick-trunk)
    // scales the capacity.
    const capacity = computeReserveCapacity(tree, species, traitParams);

    // 9b. Apply growth.
    const growth = applyGrowth(tree, bioCtx, alloc, seasonalMax, traitParams);
    tree.structure.height = growth.height;
    tree.structure.trunkDiameter = growth.trunkDiameter;
    tree.structure.branchDevelopment = growth.branchDevelopment;
    tree.roots.development = growth.rootDevelopment;
    tree.foliage.currentLeaves = Math.max(0, tree.foliage.currentLeaves + growth.newLeaves);
    tree.foliage.leafGrowthProgress = growth.leafGrowthProgress;

    // 10b. Budding fallback (GDD §4.4 spring budding).
    //
    // If the tree has very few leaves (< BUDDING_FLOOR) but the season supports
    // foliage (seasonalCondition > 0.3 — spring/summer/autumn, not winter) and
    // reserves are healthy (> BUDDING_RESERVE_THRESHOLD of capacity), the tree
    // invests reserves into emergency budding. This lets a sapling bootstrap
    // from a few starter leaves and lets a defoliated mature tree recover.
    //
    // The budding floor is intentionally high (30 leaves) so a tree recovering
    // from winter senescence (which drops all leaves for deciduous species)
    // gets a meaningful canopy to restart photosynthesis. 5 leaves wouldn't
    // produce enough to outpace maintenance, trapping the tree in a death spiral.
    //
    // The reserve threshold is low (10%) so a sapling's small reserve buffer
    // can still drive budding — a sapling's reserve capacity scales with
    // biomass (see computeReserveCapacity) so 10% of a sapling's ~120 eu
    // capacity is ~12 eu, which can bud 6 leaves at leafEnergyCost=2.
    const buddingFloor = 30;
    const buddingThreshold = 0.3;
    const buddingReserveFraction = 0.1;
    if (
      tree.foliage.currentLeaves < buddingFloor &&
      tree.foliage.seasonalCondition > buddingThreshold &&
      tree.energy.reserves > buddingReserveFraction * capacity
    ) {
      const buddingLeaves = Math.min(
        buddingFloor - tree.foliage.currentLeaves,
        seasonalMax - tree.foliage.currentLeaves,
      );
      if (buddingLeaves > 0) {
        const buddingCost = buddingLeaves * species.leafEnergyCost;
        // Only bud if we can afford it from reserves.
        if (tree.energy.reserves >= buddingCost) {
          tree.foliage.currentLeaves += buddingLeaves;
          tree.energy.reserves -= buddingCost;
        }
      }
    }

    // Update activeLeafArea for P4's renderer (GDD §5.1).
    tree.foliage.activeLeafArea = computeActiveLeafArea(tree, species.leafAreaPerLeaf);

    // P12-B (GAP-18): pest + disease infestations. Roll BEFORE the stress
    // computation so the new damage records count toward activeDamage (which
    // drives STRESS_DAMAGE_PER_DAY × activeDamage × stepDays). Uses a dedicated
    // RNG fork ('BiologySystem:infestation') so the infestation draws don't
    // shift the mortality fork's sequence (DR-6 — non-root-consuming, versioned
    // forks; a new fork label is the standard pattern for adding RNG draws).
    // Pests are gated on foliage (pests eat leaves); disease can take hold on
    // any living tree. The rates are per-day × stepDays (per-tick-vs-per-day
    // scaling, same pattern as the weather fix + RV4-F-H2).
    const infestationRng = ctx.rng.fork('BiologySystem:infestation');
    // P11 (W32): pass traitParams so pestVulnerabilityMultiplier (pest-resistance)
    // scales the pest rate.
    const infestationDamage = rollInfestation(
      tree.foliage.currentLeaves > 0,
      bioCtx,
      infestationRng,
      stepDays,
      traitParams,
    );
    if (infestationDamage.length > 0) {
      tree.damage = [...tree.damage, ...infestationDamage];
      // P12-C redesign: accumulate non-weather damage severity into the
      // monotonic wear counter (drives the chronic-neglect mortality path in
      // death.ts). Weather damage is excluded (ambient; its impact is
      // defoliation, applied in the WeatherSystem).
      tree.wear += infestationDamage.reduce(
        (sum, d) => sum + d.severity * PROVISIONAL_BIOLOGY_WEAR_PER_DAMAGE,
        0,
      );
      for (const d of infestationDamage) {
        events.push({
          type: 'infestation',
          at: ctx.now,
          payload: {
            treeId: tree.id,
            kind: d.type as 'pest' | 'disease',
            severity: d.severity,
          },
        });
      }
    }

    // 11. Update reserves (storage - draw - recovery).
    // Stress update needs to happen before reserves so we know recovery cost.
    const stressUpdate = updateStress(tree, bioCtx);
    tree.stress = stressUpdate.stress;
    // W59: wear recovery (mirrors stress recovery — decays wear when conditions
    // are favourable + no recent severe-defoliation). Pre-W59 wear was strictly
    // monotonic, so even sustainable play killed the tree (the W58 design-promise
    // bot found the tree dies day 85 under 30 leaves/28d + watering + compost).
    // The recovery cost is combined with the stress-recovery cost so both are
    // deducted from reserves in a single applyReserveDelta call.
    const wearUpdate = recoverWear(tree, bioCtx);
    tree.wear = wearUpdate.wear;
    tree.energy.reserves = applyReserveDelta(
      tree,
      capacity,
      alloc.reserveStorage,
      alloc.reserveDraw,
      stressUpdate.recoveryCost + wearUpdate.recoveryCost,
    );

    // 12. Prune decayed damage records (older than the mortality window).
    tree.damage = pruneDamage(tree.damage, ctx.now);

    // 13. Age the tree.
    tree.ageDays += stepDays;

    // 14. Recompute derived health (GDD §5.1).
    tree.health = computeHealth(tree, bioCtx);

    // 15. Mortality check (RNG-driven).
    // P11 (W32): pass traitParams so frostSurvivalMultiplier (cold-resistance)
    // + reservesCapacityMultiplier (thick-trunk, via capacity) affect survival.
    const rng = ctx.rng.fork('BiologySystem');
    const mortality = checkMortality(tree, bioCtx, rng, traitParams);
    if (mortality.died) {
      tree.alive = false;
      tree.health = 0;
      events.push({
        type: 'tree-died',
        at: ctx.now,
        payload: {
          treeId: tree.id,
          cause: mortality.cause ?? 'unknown',
          detail: mortality.detail,
        },
      });
    }

    // 15b. Reproduction (GAP-19 / GDD §5.2, §11.2). The reproduction energy
    // bucket (`alloc.reproduction`, fed by the allocation weight) fills
    // `tree.seedGrowthProgress`. When it reaches 1.0 AND the tree is past its
    // fruiting age (`ageDays >= matureAgeDays × FRUITING_AGE_FRACTION`),
    // disperse a seed: increment `tree.seeds`, reset the accumulator, emit
    // `seed-dispersed`. Dead trees don't reproduce. Saplings accumulate
    // progress (capped at 1.0) but don't fruit until the gate opens — so the
    // first seed fires soon after maturity.
    if (tree.alive && alloc.reproduction > 0) {
      const progressAfter = Math.min(
        1,
        tree.seedGrowthProgress +
          alloc.reproduction / PROVISIONAL_BIOLOGY_REPRODUCTION_SEED_ENERGY_COST_EU,
      );
      tree.seedGrowthProgress = progressAfter;
      const fruitingAgeDays =
        species.matureAgeDays * PROVISIONAL_BIOLOGY_REPRODUCTION_FRUITING_AGE_FRACTION;
      if (progressAfter >= 1 && tree.ageDays >= fruitingAgeDays) {
        tree.seeds += PROVISIONAL_BIOLOGY_REPRODUCTION_SEED_YIELD;
        tree.seedGrowthProgress = 0;
        events.push({
          type: 'seed-dispersed',
          at: ctx.now,
          payload: {
            treeId: tree.id,
            seedsProduced: PROVISIONAL_BIOLOGY_REPRODUCTION_SEED_YIELD,
            seedsTotal: tree.seeds,
            seedGrowthProgressAfter: 0,
          },
        });
      }
    }

    // 16. Soft notifications for adverse conditions (info for the UI).
    pushBiologyNotifications(tree, bioCtx, ctx.now, events);

    // Sanity: pendingIssuances are P3's to drain. We only queue them in the
    // harvest-leaves action handler; we do NOT touch them here.
    void hasPendingIssuances(tree);

    return { state: next, events };
  },
};

/**
 * Water + nutrient uptake — REMOVED in P2.
 *
 * P1's BiologySystem had a placeholder (`applyPlaceholderResources`) that
 * mirrored `env.freshwater.availability` → `tree.water.stored` and
 * `env.soil.nutrients` → `tree.nutrients` WITHOUT decrementing env. This
 * violated conservation (TDD §18.4 invariant) and duplicated the soil water
 * balance that P2's ResourceSystem owns.
 *
 * P2's ResourceSystem now owns the full water + nutrient balance:
 *   - Water: rainfall + irrigation in, evaporation + drainage + tree uptake
 *     + runoff out. Tree uptake is Liebig-capped by root capacity + soil
 *     water; transferred from env.soil.soilWater to tree.water.stored.
 *   - Nutrients: replenishment + fertilizer in, leaching + tree absorption
 *     out. Tree absorption is Liebig-capped by root capacity + soil
 *     nutrients; transferred from env.soil.nutrients to tree.nutrients.
 *
 * BiologySystem reads `tree.water.stored` (via `waterFactor` in
 * photosynthesis) and `tree.nutrients` (via `nutrientFactor`);
 * ResourceSystem keeps them populated. See R-P2-1 in
 * docs/resources-weather.md.
 */

/** Prune damage records older than the mortality window. */
function pruneDamage(damage: TreeDamageState[], nowSeconds: number): TreeDamageState[] {
  const cutoff = nowSeconds - DAMAGE_PRUNE_SECONDS;
  return damage.filter((d) => d.appliedAt >= cutoff);
}

/** Emit soft notifications for adverse conditions. */
function pushBiologyNotifications(
  tree: TreeState,
  ctx: BiologyContext,
  now: number,
  events: SimulationEvent[],
): void {
  const capacity = computeReserveCapacity(tree, ctx.species);
  const reserveFrac = tree.energy.reserves / capacity;

  if (reserveFrac < 0.2 && tree.alive) {
    events.push({
      type: 'biology-notification',
      at: now,
      payload: {
        treeId: tree.id,
        severity: reserveFrac < 0.1 ? 'critical' : 'warning',
        code: 'reserves-low',
        message: `Energy reserves at ${(reserveFrac * 100).toFixed(0)}% of capacity.`,
      },
    });
  }

  const recentDefol = recentSevereDefoliations(tree, now);
  if (recentDefol > 0) {
    events.push({
      type: 'biology-notification',
      at: now,
      payload: {
        treeId: tree.id,
        severity: recentDefol >= 2 ? 'critical' : 'warning',
        code: 'defoliation-stress',
        message: `${recentDefol} severe defoliation(s) in the last ${PROVISIONAL_BIOLOGY_DEATH_DEFOLIATION_WINDOW_DAYS} days.`,
      },
    });
  }
}
