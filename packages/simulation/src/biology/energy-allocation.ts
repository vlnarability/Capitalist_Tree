/**
 * Energy allocation (TDD §7.3, GDD §5.2).
 *
 * Photosynthetic production is distributed among several demands, in a
 * survival-first priority:
 *
 *   1. Maintenance (respiration) — always paid; deficit draws from reserves.
 *   2. Root growth     \
 *   3. Trunk growth     |  discretionary growth — only if surplus exists.
 *   4. Branch growth    |  weights from PROVISIONAL_BIOLOGY_ALLOCATION_WEIGHTS.
 *   5. Leaf growth      /
 *   6. Reproduction     — stub (0.0) until P6+ Genetic Legacy.
 *   7. Reserves         — the remainder; capped at reserve capacity.
 *
 * Allocation priorities depend on season (winter = dormancy for deciduous,
 * no leaf growth), age (mature trees have reduced structural growth), health
 * (stressed trees spend more on maintenance), and stress (GDD §5.3).
 *
 * Units: eu per step. Caller multiplies per-day rates by `ctx.stepDays`.
 */
import type { TreeState } from '@capitalist-tree/shared';
import {
  PROVISIONAL_BIOLOGY_ALLOCATION_WEIGHTS,
  PROVISIONAL_BIOLOGY_BIOMASS_MAINTENANCE_RATE,
  PROVISIONAL_BIOLOGY_DORMANCY_MAINTENANCE_FRACTION,
  PROVISIONAL_BIOLOGY_MAINTENANCE_FRACTION,
  PROVISIONAL_BIOLOGY_MATURE_GROWTH_FRACTION,
  PROVISIONAL_BIOLOGY_RESPIRATION_TEMP_FLOOR,
  PROVISIONAL_BIOLOGY_STRESS_MAINTENANCE_MULTIPLIER,
} from '@capitalist-tree/shared';
import type { BiologyContext } from './types.js';
import { temperatureFactor } from './photosynthesis.js';

/**
 * Biomass score in [0, 4] — the sum of normalized structural development
 * fractions. Used to scale maintenance respiration (a bigger tree costs more
 * to keep alive). Each component is clamped to [0, 1] so the sum is in [0, 4]
 * even if the tree's current values exceed the species' maxima (defensive —
 * should not happen in normal operation, but the schema allows it).
 */
export function biomassScore(
  tree: TreeState,
  species: {
    maximumHeight: number;
    maximumTrunkDiameter: number;
    maximumBranchDevelopment: number;
  },
): number {
  const heightFrac =
    species.maximumHeight > 0
      ? Math.min(1, Math.max(0, tree.structure.height / species.maximumHeight))
      : 0;
  const trunkFrac =
    species.maximumTrunkDiameter > 0
      ? Math.min(1, Math.max(0, tree.structure.trunkDiameter / species.maximumTrunkDiameter))
      : 0;
  const branchFrac =
    species.maximumBranchDevelopment > 0
      ? Math.min(1, Math.max(0, tree.structure.branchDevelopment / species.maximumBranchDevelopment))
      : 0;
  const rootFrac = Math.min(1, Math.max(0, tree.roots.development));
  return heightFrac + trunkFrac + branchFrac + rootFrac;
}

/**
 * Maintenance respiration cost for one step (eu).
 *
 * Maintenance is biomass-driven (not potential-production-driven) so a sapling
 * doesn't pay full-canopy maintenance it cannot afford. Stress multiplies the
 * cost: stressed trees burn more energy (GDD §5.3 "Stress responses").
 *
 * Temperature affects respiration via the Q10-like floor: even cold trees
 * respire at PROVISIONAL_BIOLOGY_RESPIRATION_TEMP_FLOOR of their optimum rate.
 * Deciduous trees in winter pay only DORMANCY_MAINTENANCE_FRACTION of normal
 * maintenance (GDD §4.4).
 *
 * The result is always >= 0; a living tree always pays some maintenance.
 */
export function maintenanceForStep(tree: TreeState, ctx: BiologyContext): number {
  if (!tree.alive) return 0;

  const biomass = biomassScore(tree, ctx.species);
  const tempF = temperatureFactor(
    ctx.environment.globalTemperature,
    ctx.species.temperatureRange,
  );
  const tempRespF = Math.max(PROVISIONAL_BIOLOGY_RESPIRATION_TEMP_FLOOR, tempF);
  const stressMult = 1 + tree.stress * (PROVISIONAL_BIOLOGY_STRESS_MAINTENANCE_MULTIPLIER - 1);

  const basePerDay =
    PROVISIONAL_BIOLOGY_MAINTENANCE_FRACTION *
    PROVISIONAL_BIOLOGY_BIOMASS_MAINTENANCE_RATE *
    biomass *
    tempRespF *
    stressMult;

  let perDay = basePerDay;
  if (ctx.species.deciduous && ctx.season === 'winter') {
    // Dormancy: minimal respiration; no foliage to maintain.
    perDay = basePerDay * PROVISIONAL_BIOLOGY_DORMANCY_MAINTENANCE_FRACTION;
  }

  return perDay * ctx.stepDays;
}

/**
 * Maturity growth multiplier in [0, 1].
 *
 * Saplings grow at full rate. As age approaches `matureAgeDays`, structural
 * growth slows asymptotically to PROVISIONAL_BIOLOGY_MATURE_GROWTH_FRACTION.
 *
 *   ageDays / matureAgeDays  ->  growthMult
 *          0.0                ->     1.0
 *          0.5                ->   ~0.55  (interpolated)
 *          1.0                ->   MATURE_GROWTH_FRACTION (0.05)
 *          2.0+               ->   MATURE_GROWTH_FRACTION (clamped)
 */
export function maturityMultiplier(ageDays: number, matureAgeDays: number): number {
  if (matureAgeDays <= 0) return PROVISIONAL_BIOLOGY_MATURE_GROWTH_FRACTION;
  const ratio = Math.min(1, ageDays / matureAgeDays);
  // Smooth interpolation from 1.0 (sapling) to MATURE_GROWTH_FRACTION (mature).
  const mature = PROVISIONAL_BIOLOGY_MATURE_GROWTH_FRACTION;
  return mature + (1 - mature) * (1 - ratio);
}

/**
 * EnergyAllocation (TDD §7.3).
 *
 * All values are eu per step. `maintenance` is paid first from production; if
 * production is insufficient, the deficit is drawn from reserves (caller's
 * responsibility). The remaining `surplus` is split across growth buckets and
 * reserves by the allocation weights.
 */
export interface EnergyAllocation {
  /** Maintenance respiration (always >= 0 for living trees). */
  maintenance: number;
  /** Energy surplus after maintenance (= production - maintenance + reserveDraw). */
  surplus: number;
  /** Energy drawn from reserves to cover maintenance deficit (>= 0). */
  reserveDraw: number;
  /** Energy allocated to root growth (eu). */
  rootGrowth: number;
  /** Energy allocated to trunk growth (eu). */
  trunkGrowth: number;
  /** Energy allocated to branch growth (eu). */
  branchGrowth: number;
  /** Energy allocated to new leaf production (eu). 0 in winter for deciduous. */
  leafGrowth: number;
  /** Reproduction slot — stub, always 0 until P6+. */
  reproduction: number;
  /** Energy stored in reserves (eu, capped at reserve capacity). */
  reserveStorage: number;
  /** Production that drove this allocation (eu, for diagnostics). */
  production: number;
}

/**
 * Allocate production energy to maintenance, growth, and reserves.
 *
 * Pure: takes the tree + production + context, returns an allocation. Caller
 * applies it to the tree (growth increments, reserve changes, etc.).
 *
 *   - If `production < maintenance`, the deficit is drawn from reserves and
 *     growth is zero (survival first).
 *   - If `production >= maintenance`, the surplus is split across growth buckets
 *     by `PROVISIONAL_BIOLOGY_ALLOCATION_WEIGHTS`, scaled by the maturity
 *     multiplier (mature trees grow slower structurally). The remainder goes
 *     to reserve storage.
 *   - Leaf growth is zero for deciduous trees in winter (no budding).
 *   - Reproduction is a stub (always 0) until P6+ (Genetic Legacy).
 */
export function allocateEnergy(
  tree: TreeState,
  production: number,
  ctx: BiologyContext,
): EnergyAllocation {
  const maintenance = maintenanceForStep(tree, ctx);

  // Survival-first: cover maintenance from production; if production is
  // insufficient, draw the deficit from reserves.
  let availableForGrowth: number;
  let reserveDraw: number;
  if (production >= maintenance) {
    availableForGrowth = production - maintenance;
    reserveDraw = 0;
  } else {
    availableForGrowth = 0;
    reserveDraw = maintenance - production;
  }

  const matureMult = maturityMultiplier(tree.ageDays, ctx.species.matureAgeDays);
  const isWinterDormant = ctx.species.deciduous && ctx.season === 'winter';

  const w = PROVISIONAL_BIOLOGY_ALLOCATION_WEIGHTS;
  // Structural growth is scaled by maturity; leaf growth is not (mature trees
  // still replace senesced leaves at full rate).
  const rootEu = availableForGrowth * w.rootGrowth * matureMult;
  const trunkEu = availableForGrowth * w.trunkGrowth * matureMult;
  const branchEu = availableForGrowth * w.branchGrowth * matureMult;
  const leafEu = isWinterDormant ? 0 : availableForGrowth * w.leafGrowth;
  const reproductionEu = availableForGrowth * w.reproduction;
  const usedForGrowth = rootEu + trunkEu + branchEu + leafEu + reproductionEu;
  const reserveStorage = Math.max(0, availableForGrowth - usedForGrowth);

  return {
    maintenance,
    surplus: availableForGrowth,
    reserveDraw,
    rootGrowth: rootEu,
    trunkGrowth: trunkEu,
    branchGrowth: branchEu,
    leafGrowth: leafEu,
    reproduction: reproductionEu,
    reserveStorage,
    production,
  };
}
