/**
 * Arid (Köppen B) tree species — GAP-17 / DR-11 Phase 2 (W62 hand-authored).
 *
 * One real, native species per tree-supporting B-zone (BWh, BWk, BSh, BSk — the last via
Ponderosa pine, which also covers Dsa/Dsb). Arid-zone trees are defined by water
stress: the date palm is an oasis palm, saxaul + mesquite are drought-deciduous
dryland species, ponderosa pine is a drought-tolerant conifer of steppe + dry
montane margins. Each species is a hand-authored TreeSpecies object (W62).
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

/** Date Palm (Phoenix dactylifera) — BWh desert oasis palm. The only palm species;
 * kept its fronds year-round (palms don't drop fronds like broadleaf). Extreme heat
 * tolerance (maximum 48 °C, the highest of any species). An oasis tree — its deep
 * taproots reach groundwater. The palm form (heightDiameterSplit 0.7) gives the
 * slender, unbranched trunk.
 *
 * Every constant is `@provisional` per GDD §17 ("detailed photosynthesis
 * and energy allocation equations"); values derive from the makeSpecies
 * allometric formulas + are tunable in playtesting.
 */
export const DATE_PALM: TreeSpecies = {
  id: 'species:date-palm',
  name: 'Date Palm',
  scientificName: 'Phoenix dactylifera',
  deciduous: false,
  nativeKoppenCodes: ['BWh'],

  growthRate: 0.6,
  matureAgeDays: 50 * 120, // 6000 days
  maximumHeight: 21,
  maximumTrunkDiameter: 0.38, // 21/55 (palm divisor)
  maximumBranchDevelopment: 84,
  heightDiameterSplit: 0.7, // palm default
  maxSlendernessRatio: 70,
  rootDevelopmentRate: 0.018, // palm default
  reserveCapacity: 840,
  waterRequirement: 42,
  nutrientRequirement: { nitrogen: 4, phosphorus: 1.7, potassium: 3 },
  temperatureRange: { minimum: 12, optimum: 32, maximum: 48 },
  photosynthesisRate: 1.1, // palm default
  leafAreaPerLeaf: 0.008, // palm default
  leafDenominationMinor: PROVISIONAL_BIOLOGY_DEFAULT_LEAF_DENOMINATION_MINOR,
  leafEnergyCost: 3, // palm default
  maximumHarvestFraction: PROVISIONAL_BIOLOGY_DEFAULT_MAX_HARVEST_FRACTION,

  initial: {
    height: 0.6,
    trunkDiameter: 0.015,
    branchDevelopment: 0,
    leafCapacity: 80,
    rootDevelopment: 0.1,
    absorptionCapacity: 0.2,
    reserveCapacity: 80,
    waterCapacity: 60,
    waterStored: 60,
    energyReserves: 80,
    nutrients: { nitrogen: 4, phosphorus: 1.7, potassium: 3 },
  },
};

/** Saxaul (Haloxylon ammodendron) — BWk cold desert. A drought-deciduous shrub-tree
 * of the cold Central Asian deserts (Gobi, Taklamakan). Small (to 7 m, the smallest
 * broadleaf tree besides prostrate Polylepis/Arctic Willow); cold-tolerant for a
 * desert species (minimum -5 °C). A desert halophyte; the deciduous habit + reduced
 * leaves cut water loss.
 *
 * Every constant is `@provisional` per GDD §17 ("detailed photosynthesis
 * and energy allocation equations"); values derive from the makeSpecies
 * allometric formulas + are tunable in playtesting.
 */
export const SAXAUL: TreeSpecies = {
  id: 'species:saxaul',
  name: 'Saxaul',
  scientificName: 'Haloxylon ammodendron',
  deciduous: true,
  nativeKoppenCodes: ['BWk'],

  growthRate: 0.3,
  matureAgeDays: 80 * 120, // 9600 days
  maximumHeight: 7,
  maximumTrunkDiameter: 0.39, // 7/18 (broadleaf divisor)
  maximumBranchDevelopment: 28,
  heightDiameterSplit: 0.4, // broadleaf default
  maxSlendernessRatio: 40,
  rootDevelopmentRate: 0.02, // broadleaf default
  reserveCapacity: 280,
  waterRequirement: 14,
  nutrientRequirement: { nitrogen: 1, phosphorus: 0.6, potassium: 1 },
  temperatureRange: { minimum: -5, optimum: 15, maximum: 35 },
  photosynthesisRate: 1, // broadleaf default
  leafAreaPerLeaf: 0.005, // broadleaf default
  leafDenominationMinor: PROVISIONAL_BIOLOGY_DEFAULT_LEAF_DENOMINATION_MINOR,
  leafEnergyCost: 2, // broadleaf default
  maximumHarvestFraction: PROVISIONAL_BIOLOGY_DEFAULT_MAX_HARVEST_FRACTION,

  initial: {
    height: 0.5,
    trunkDiameter: 0.01,
    branchDevelopment: 0,
    leafCapacity: 200,
    rootDevelopment: 0.15,
    absorptionCapacity: 0.3,
    reserveCapacity: 120,
    waterCapacity: 50,
    waterStored: 50,
    energyReserves: 120,
    nutrients: { nitrogen: 1, phosphorus: 0.6, potassium: 1 },
  },
};

/** Honey Mesquite (Prosopis glandulosa) — BSh hot semi-arid steppe. Drought-deciduous
 * shrubby tree of the North American SW; famous for a VERY deep taproot (to 50 m)
 * that reaches groundwater. Moderate growth (0.4), to 10 m, extreme heat tolerance
 * (maximum 45 °C). Nitrogen-fixing — enriches the desert soil. Deciduous for the
 * dry season.
 *
 * Every constant is `@provisional` per GDD §17 ("detailed photosynthesis
 * and energy allocation equations"); values derive from the makeSpecies
 * allometric formulas + are tunable in playtesting.
 */
export const HONEY_MESQUITE: TreeSpecies = {
  id: 'species:honey-mesquite',
  name: 'Honey Mesquite',
  scientificName: 'Prosopis glandulosa',
  deciduous: true,
  nativeKoppenCodes: ['BSh'],

  growthRate: 0.4,
  matureAgeDays: 50 * 120, // 6000 days
  maximumHeight: 10,
  maximumTrunkDiameter: 0.56, // 10/18 (broadleaf divisor)
  maximumBranchDevelopment: 40,
  heightDiameterSplit: 0.4, // broadleaf default
  maxSlendernessRatio: 40,
  rootDevelopmentRate: 0.02, // broadleaf default
  reserveCapacity: 400,
  waterRequirement: 20,
  nutrientRequirement: { nitrogen: 2, phosphorus: 0.8, potassium: 2 },
  temperatureRange: { minimum: 5, optimum: 28, maximum: 45 },
  photosynthesisRate: 1, // broadleaf default
  leafAreaPerLeaf: 0.005, // broadleaf default
  leafDenominationMinor: PROVISIONAL_BIOLOGY_DEFAULT_LEAF_DENOMINATION_MINOR,
  leafEnergyCost: 2, // broadleaf default
  maximumHarvestFraction: PROVISIONAL_BIOLOGY_DEFAULT_MAX_HARVEST_FRACTION,

  initial: {
    height: 0.5,
    trunkDiameter: 0.01,
    branchDevelopment: 0,
    leafCapacity: 200,
    rootDevelopment: 0.15,
    absorptionCapacity: 0.3,
    reserveCapacity: 120,
    waterCapacity: 50,
    waterStored: 50,
    energyReserves: 120,
    nutrients: { nitrogen: 2, phosphorus: 0.8, potassium: 2 },
  },
};

/** Ponderosa Pine (Pinus ponderosa) — BSk + Dsa + Dsb. A drought-tolerant conifer of
 * the western North American steppe margins + dry montane interiors; spans three
 * Köppen zones. One of the most widespread + tallest pines (to 50 m). Moderate-fast
 * growth (0.5), long-lived (150+ years to maturity). The height-focused conifer
 * build suits its tall, open-canopy form.
 *
 * Every constant is `@provisional` per GDD §17 ("detailed photosynthesis
 * and energy allocation equations"); values derive from the makeSpecies
 * allometric formulas + are tunable in playtesting.
 */
export const PONDEROSA_PINE: TreeSpecies = {
  id: 'species:ponderosa-pine',
  name: 'Ponderosa Pine',
  scientificName: 'Pinus ponderosa',
  deciduous: false,
  nativeKoppenCodes: ['BSk', 'Dsa', 'Dsb'],

  growthRate: 0.5,
  matureAgeDays: 150 * 120, // 18000 days
  maximumHeight: 50,
  maximumTrunkDiameter: 1.67, // 50/30 (conifer divisor)
  maximumBranchDevelopment: 200,
  heightDiameterSplit: 0.55, // conifer default
  maxSlendernessRatio: 50,
  rootDevelopmentRate: 0.015, // conifer default
  reserveCapacity: 2000,
  waterRequirement: 100,
  nutrientRequirement: { nitrogen: 10, phosphorus: 4, potassium: 8 },
  temperatureRange: { minimum: 0, optimum: 18, maximum: 38 },
  photosynthesisRate: 0.8, // conifer default
  leafAreaPerLeaf: 0.002, // conifer default
  leafDenominationMinor: PROVISIONAL_BIOLOGY_DEFAULT_LEAF_DENOMINATION_MINOR,
  leafEnergyCost: 1.5, // conifer default
  maximumHarvestFraction: PROVISIONAL_BIOLOGY_DEFAULT_MAX_HARVEST_FRACTION,

  initial: {
    height: 0.4,
    trunkDiameter: 0.008,
    branchDevelopment: 0,
    leafCapacity: 150,
    rootDevelopment: 0.12,
    absorptionCapacity: 0.25,
    reserveCapacity: 100,
    waterCapacity: 40,
    waterStored: 40,
    energyReserves: 100,
    nutrients: { nitrogen: 10, phosphorus: 4, potassium: 8 },
  },
};
