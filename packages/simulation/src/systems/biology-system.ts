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
 *   8. Performs placeholder water/nutrient uptake (P2 will own this).
 *   9. Allocates energy (survival-first: maintenance → growth → reserves).
 *  10. Applies growth (height, trunk, branch, root, new leaves).
 *  11. Updates reserves (storage - draw - recovery).
 *  12. Updates stress (deficiency → +; favourable → −).
 *  13. Prunes decayed damage records.
 *  14. Ages the tree.
 *  15. Recomputes derived health (GDD §5.1).
 *  16. Checks mortality (RNG-driven; deterministic per seed).
 *  17. Emits `tree-died` if the tree died, plus `biology-notification` events
 *      for low reserves / drought stress / nutrient deficiency (soft signals).
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
import { deepCopy } from '../deep-copy.js';
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
  computeSpeciesMaxFoliage,
  maxSupportedLeaves,
  updateStress,
  checkMortality,
  recentSevereDefoliations,
  getSpeciesOrFail,
  dailyWaterNeed,
  type BiologyContext,
} from '../biology/index.js';
import {
  PROVISIONAL_BIOLOGY_DEATH_DEFOLIATION_WINDOW_DAYS,
  PROVISIONAL_BIOLOGY_NUTRIENT_UPTAKE_RATE,
  PROVISIONAL_BIOLOGY_WATER_UPTAKE_RATE,
} from '@capitalist-tree/shared';

const SECONDS_PER_DAY = 24 * 60 * 60;

/** Damage records older than this (sim seconds) are pruned. */
const DAMAGE_PRUNE_SECONDS = PROVISIONAL_BIOLOGY_DEATH_DEFOLIATION_WINDOW_DAYS * SECONDS_PER_DAY;

/** Placeholder fraction of environment freshwater the tree can absorb per day. */
const ENV_WATER_ABSORPTION_FRACTION = 0.01;
/** Placeholder fraction of environment soil nutrients the tree can absorb per day. */
const ENV_NUTRIENT_ABSORPTION_FRACTION = 0.01;

/** Drain queued CurrencyIssuanceRequests — P3's EconomySystem consumes them. */
function hasPendingIssuances(tree: TreeState): boolean {
  return tree.pendingIssuances.length > 0;
}

export const biologySystem: System = {
  id: 'BiologySystem',
  execute(state: GameState, ctx: SystemContext): SystemResult {
    const next = deepCopy(state);
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
    tree.foliage.leafCapacity = computeLeafCapacity(
      tree.structure.branchDevelopment,
      species.initial.leafCapacity,
    );

    // 6. Cap currentLeaves at the seasonally-supported maximum (senescence).
    const seasonalMax = maxSupportedLeaves(tree);
    if (tree.foliage.currentLeaves > seasonalMax) {
      tree.foliage.currentLeaves = seasonalMax;
    }
    // Invariant: no negative leaf counts (TDD §18.4).
    if (tree.foliage.currentLeaves < 0) tree.foliage.currentLeaves = 0;

    // 7. Photosynthesis.
    const production = photosynthesisForStep(tree, bioCtx);
    tree.energy.production = production / stepDays; // store per-day rate

    // 8. Placeholder water/nutrient uptake (P2's ResourceSystem will own this).
    applyPlaceholderResources(tree, bioCtx);

    // 9. Energy allocation (survival-first).
    const alloc = allocateEnergy(tree, production, bioCtx);
    tree.energy.consumption = (alloc.maintenance + alloc.reserveDraw) / stepDays;

    // Reserve capacity — recomputed from current biomass (the tree may have
    // grown since last tick). Used by budding and reserve update below.
    const capacity = computeReserveCapacity(tree, species);

    // 10. Apply growth.
    const growth = applyGrowth(tree, bioCtx, alloc, seasonalMax);
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

    // 11. Update reserves (storage - draw - recovery).
    // Stress update needs to happen before reserves so we know recovery cost.
    const stressUpdate = updateStress(tree, bioCtx);
    tree.stress = stressUpdate.stress;
    tree.energy.reserves = applyReserveDelta(
      tree,
      capacity,
      alloc.reserveStorage,
      alloc.reserveDraw,
      stressUpdate.recoveryCost,
    );

    // 12. Prune decayed damage records (older than the mortality window).
    tree.damage = pruneDamage(tree.damage, ctx.now);

    // 13. Age the tree.
    tree.ageDays += stepDays;

    // 14. Recompute derived health (GDD §5.1).
    tree.health = computeHealth(tree, bioCtx);

    // 15. Mortality check (RNG-driven).
    const rng = ctx.rng.fork('BiologySystem');
    const mortality = checkMortality(tree, bioCtx, rng);
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

    // 16. Soft notifications for adverse conditions (info for the UI).
    pushBiologyNotifications(tree, bioCtx, ctx.now, events);

    // Sanity: pendingIssuances are P3's to drain. We only queue them in the
    // harvest-leaves action handler; we do NOT touch them here.
    void hasPendingIssuances(tree);

    return { state: next, events };
  },
};

/**
 * Placeholder water/nutrient uptake.
 *
 * P1's BiologySystem performs a minimal uptake so the tree survives long enough
 * for the headless script to grow it for several sim years. P2's ResourceSystem
 * will own the full model (rainfall, irrigation, soil depletion, etc.).
 *
 * The placeholder:
 *   - Transpires `dailyWaterNeed * stepDays` from `water.stored`.
 *   - Absorbs water from `environment.freshwater.availability` (capped by a
 *     small per-day fraction and the tree's root absorption capacity).
 *   - Consumes nutrients proportional to foliage.
 *   - Absorbs nutrients from `environment.soil.nutrients` (capped similarly).
 *
 * Mutates `tree.water` and `tree.nutrients` in place (the caller already
 * deep-copied the state).
 */
function applyPlaceholderResources(tree: TreeState, ctx: BiologyContext): void {
  // Water: transpire from stored, absorb from environment.
  const dailyWater = dailyWaterNeed(tree, ctx.species);
  const transpired = dailyWater * ctx.stepDays;
  // Environment offers a small fraction of its freshwater per day (P2's
  // ResourceSystem will model rainfall, irrigation, soil moisture, etc.).
  const absorbableFromEnv =
    ctx.environment.freshwater.availability * ENV_WATER_ABSORPTION_FRACTION;
  // Root absorption capacity (L/day) — independent of the daily need. A mature
  // root system (absorptionCapacity=1.0) can absorb up to the species' baseline
  // waterRequirement per day; a sapling root (0.2) absorbs proportionally less.
  // Decoupling this from dailyWater means a sapling with a few leaves can still
  // refill its (small) water buffer faster than it transpires.
  const rootCap = ctx.species.waterRequirement * tree.roots.absorptionCapacity;
  const absorbed = Math.min(absorbableFromEnv, rootCap) * ctx.stepDays * PROVISIONAL_BIOLOGY_WATER_UPTAKE_RATE;
  tree.water.stored = Math.max(0, Math.min(tree.water.capacity, tree.water.stored - transpired + absorbed));

  // Nutrients: consume proportional to foliage (relative to the species' max
  // canopy, not the sapling's current leafCapacity — same scaling fix as
  // dailyWaterNeed). Absorb from soil.
  const speciesMaxFoliage = computeSpeciesMaxFoliage(ctx.species);
  const foliageFrac = Math.min(1, tree.foliage.currentLeaves / Math.max(1, speciesMaxFoliage));
  const req = ctx.species.nutrientRequirement;
  const consumed = {
    nitrogen: req.nitrogen * foliageFrac * ctx.stepDays,
    phosphorus: req.phosphorus * foliageFrac * ctx.stepDays,
    potassium: req.potassium * foliageFrac * ctx.stepDays,
  };
  const soilN = ctx.environment.soil.nutrients;
  const absorbableN = soilN.nitrogen * ENV_NUTRIENT_ABSORPTION_FRACTION;
  const absorbableP = soilN.phosphorus * ENV_NUTRIENT_ABSORPTION_FRACTION;
  const absorbableK = soilN.potassium * ENV_NUTRIENT_ABSORPTION_FRACTION;
  // Root absorption capacity (units/day) — decoupled from consumption.
  // A mature root (absorptionCapacity=1.0) can absorb the species' full daily
  // requirement per nutrient; a sapling root (0.3) absorbs proportionally less.
  const rootAbsN = ctx.species.nutrientRequirement.nitrogen * tree.roots.absorptionCapacity * PROVISIONAL_BIOLOGY_NUTRIENT_UPTAKE_RATE;
  const rootAbsP = ctx.species.nutrientRequirement.phosphorus * tree.roots.absorptionCapacity * PROVISIONAL_BIOLOGY_NUTRIENT_UPTAKE_RATE;
  const rootAbsK = ctx.species.nutrientRequirement.potassium * tree.roots.absorptionCapacity * PROVISIONAL_BIOLOGY_NUTRIENT_UPTAKE_RATE;
  tree.nutrients.nitrogen = Math.max(
    0,
    tree.nutrients.nitrogen - consumed.nitrogen + Math.min(absorbableN, rootAbsN) * ctx.stepDays,
  );
  tree.nutrients.phosphorus = Math.max(
    0,
    tree.nutrients.phosphorus - consumed.phosphorus + Math.min(absorbableP, rootAbsP) * ctx.stepDays,
  );
  tree.nutrients.potassium = Math.max(
    0,
    tree.nutrients.potassium - consumed.potassium + Math.min(absorbableK, rootAbsK) * ctx.stepDays,
  );
}

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
