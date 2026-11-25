/**
 * Polar (Köppen E) tree species — GAP-17 / DR-11 Phase 2 (W62 hand-authored).
 *
 * ET (tundra) is the only tree-supporting E-zone (EF — ice cap — has none: no tree
survives perennial ice). Trees at the Arctic treeline are at their absolute limit —
stunted, prostrate forms. The Arctic willow is a prostrate shrub that barely
qualifies as a "tree"; black spruce krummholz (in continental.ts, native to Dfc +
ET) is the other treeline form. Each species is a hand-authored TreeSpecies
object (W62).
 *
 * Every constant is `@provisional` per GDD §17 ("detailed photosynthesis and
 * energy allocation equations"); values derive from the makeSpecies allometric
 * formulas (see make-species.ts) so they are balance-consistent with the prior
 * factory output, + are tunable in playtesting.
 */
import {
  PROVISIONAL_BIOLOGY_DEFAULT_LEAF_DENOMINATION_MINOR,
  PROVISIONAL_BIOLOGY_DEFAULT_MAX_HARVEST_FRACTION,
  type TreeSpecies,
} from '@capitalist-tree/shared';

/** Arctic Willow (Salix arctica) — ET tundra. A prostrate deciduous shrub that barely
 * qualifies as a tree — it creeps along the ground (maximum height 0.3 m, the
 * smallest of any species) to escape the Arctic wind. Extremely slow-growing (0.1,
 * the slowest — a response to the brief 6–8 week growing season + permafrost).
 * Cold-tolerant to -8 °C; the low maxSlendernessRatio (25) reflects the prostrate,
 * low-spreading form.
 *
 * Every constant is `@provisional` per GDD §17 ("detailed photosynthesis
 * and energy allocation equations"); values derive from the makeSpecies
 * allometric formulas + are tunable in playtesting.
 */
export const ARCTIC_WILLOW: TreeSpecies = {
  id: 'species:arctic-willow',
  name: 'Arctic Willow',
  scientificName: 'Salix arctica',
  deciduous: true,
  nativeKoppenCodes: ['ET'],

  growthRate: 0.1,
  matureAgeDays: 50 * 120, // 6000 days
  maximumHeight: 0.3,
  maximumTrunkDiameter: 0.02, // 0.3/18 (broadleaf divisor)
  maximumBranchDevelopment: 1,
  heightDiameterSplit: 0.4, // broadleaf default
  maxSlendernessRatio: 25,
  rootDevelopmentRate: 0.02, // broadleaf default
  reserveCapacity: 12,
  waterRequirement: 1,
  nutrientRequirement: { nitrogen: 1, phosphorus: 0.5, potassium: 1 },
  temperatureRange: { minimum: -8, optimum: 8, maximum: 18 },
  photosynthesisRate: 1, // broadleaf default
  leafAreaPerLeaf: 0.005, // broadleaf default
  leafDenominationMinor: PROVISIONAL_BIOLOGY_DEFAULT_LEAF_DENOMINATION_MINOR,
  leafEnergyCost: 2, // broadleaf default
  maximumHarvestFraction: PROVISIONAL_BIOLOGY_DEFAULT_MAX_HARVEST_FRACTION,

  initial: {
    height: 0.15,
    trunkDiameter: 0,
    branchDevelopment: 0,
    leafCapacity: 200,
    rootDevelopment: 0.15,
    absorptionCapacity: 0.3,
    reserveCapacity: 120,
    waterCapacity: 50,
    waterStored: 50,
    energyReserves: 120,
    nutrients: { nitrogen: 1, phosphorus: 0.5, potassium: 1 },
  },
};
