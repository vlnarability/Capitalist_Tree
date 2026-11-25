/**
 * Tropical (Köppen A) tree species — GAP-17 / DR-11 Phase 2 (W62 hand-authored).
 *
 * One real, native species per tree-supporting A-zone (Af, Am, As, Aw). All are hot-
climate broadleaf species; kapok + teak + mahogany are rainforest/monsoon canopy
species, baobab is the iconic savanna tree with a massively stout trunk. Each
species is a hand-authored TreeSpecies object (W62) — the baobab overrides the
broadleaf trunk/slenderness defaults to reflect its water-storing trunk.
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

/** Kapok (Ceiba pentandra) — Af equatorial rainforest. A rainforest EMERGENT — it
 * towers above the closed canopy (to 60 m) on a tall, buttressed trunk. Fast-
 * growing (0.8) + deciduous in seasonal climates (drops leaves to emerge above
 * the canopy for pollination). Tropical broadleaf build; the great height makes it
 * the tallest broadleaf species.
 *
 * Every constant is `@provisional` per GDD §17 ("detailed photosynthesis
 * and energy allocation equations"); values derive from the makeSpecies
 * allometric formulas + are tunable in playtesting.
 */
export const KAPOK: TreeSpecies = {
  id: 'species:kapok',
  name: 'Kapok',
  scientificName: 'Ceiba pentandra',
  deciduous: true,
  nativeKoppenCodes: ['Af'],

  growthRate: 0.8,
  matureAgeDays: 100 * 120, // 12000 days
  maximumHeight: 60,
  maximumTrunkDiameter: 3.33, // 60/18 (broadleaf divisor)
  maximumBranchDevelopment: 240,
  heightDiameterSplit: 0.4, // broadleaf default
  maxSlendernessRatio: 40,
  rootDevelopmentRate: 0.02, // broadleaf default
  reserveCapacity: 2400,
  waterRequirement: 120,
  nutrientRequirement: { nitrogen: 12, phosphorus: 4.8, potassium: 10 },
  temperatureRange: { minimum: 15, optimum: 28, maximum: 38 },
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
    nutrients: { nitrogen: 12, phosphorus: 4.8, potassium: 10 },
  },
};

/** Teak (Tectona grandis) — Am equatorial monsoon. Deciduous in the dry season; one
 * of the world's most valuable timber trees (hard, durable, oily wood). Fast-
 * growing (0.7), to 40 m. Tropical broadleaf build; the large, rough leaves shed
 * for the dry season. A flagship tropical-forestry species.
 *
 * Every constant is `@provisional` per GDD §17 ("detailed photosynthesis
 * and energy allocation equations"); values derive from the makeSpecies
 * allometric formulas + are tunable in playtesting.
 */
export const TEAK: TreeSpecies = {
  id: 'species:teak',
  name: 'Teak',
  scientificName: 'Tectona grandis',
  deciduous: true,
  nativeKoppenCodes: ['Am'],

  growthRate: 0.7,
  matureAgeDays: 80 * 120, // 9600 days
  maximumHeight: 40,
  maximumTrunkDiameter: 2.22, // 40/18 (broadleaf divisor)
  maximumBranchDevelopment: 160,
  heightDiameterSplit: 0.4, // broadleaf default
  maxSlendernessRatio: 40,
  rootDevelopmentRate: 0.02, // broadleaf default
  reserveCapacity: 1600,
  waterRequirement: 80,
  nutrientRequirement: { nitrogen: 8, phosphorus: 3.2, potassium: 6 },
  temperatureRange: { minimum: 15, optimum: 27, maximum: 38 },
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
    nutrients: { nitrogen: 8, phosphorus: 3.2, potassium: 6 },
  },
};

/** Senegal Mahogany (Khaya senegalensis) — As tropical dry savanna. Semi-deciduous
 * mahogany of the African dry tropics; a premium timber species. Moderate-fast
 * growth (0.6), to 30 m, heat-tolerant (maximum 40 °C). Drought-tolerant for a
 * mahogany — native to the savanna rather than closed rainforest.
 *
 * Every constant is `@provisional` per GDD §17 ("detailed photosynthesis
 * and energy allocation equations"); values derive from the makeSpecies
 * allometric formulas + are tunable in playtesting.
 */
export const SENEGAL_MAHOGANY: TreeSpecies = {
  id: 'species:senegal-mahogany',
  name: 'Senegal Mahogany',
  scientificName: 'Khaya senegalensis',
  deciduous: true,
  nativeKoppenCodes: ['As'],

  growthRate: 0.6,
  matureAgeDays: 70 * 120, // 8400 days
  maximumHeight: 30,
  maximumTrunkDiameter: 1.67, // 30/18 (broadleaf divisor)
  maximumBranchDevelopment: 120,
  heightDiameterSplit: 0.4, // broadleaf default
  maxSlendernessRatio: 40,
  rootDevelopmentRate: 0.02, // broadleaf default
  reserveCapacity: 1200,
  waterRequirement: 60,
  nutrientRequirement: { nitrogen: 6, phosphorus: 2.4, potassium: 5 },
  temperatureRange: { minimum: 15, optimum: 27, maximum: 40 },
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
    nutrients: { nitrogen: 6, phosphorus: 2.4, potassium: 5 },
  },
};

/** Baobab (Adansonia digitata) — Aw tropical savanna. The iconic savanna tree with a
 * famously massive, water-storing trunk (to 25 m tall but a trunk diameter of 3 m →
 * maxSlendernessRatio 12, the stoutest of any species). Deciduous in the long dry
 * season; extremely long-lived (1000+ years, 200 to maturity). Slow-growing (0.4).
 * The overridden trunk diameter + slenderness reflect the biology.
 *
 * Every constant is `@provisional` per GDD §17 ("detailed photosynthesis
 * and energy allocation equations"); values derive from the makeSpecies
 * allometric formulas + are tunable in playtesting.
 */
export const BAOBAB: TreeSpecies = {
  id: 'species:baobab',
  name: 'Baobab',
  scientificName: 'Adansonia digitata',
  deciduous: true,
  nativeKoppenCodes: ['Aw'],

  growthRate: 0.4,
  matureAgeDays: 200 * 120, // 24000 days
  maximumHeight: 25,
  maximumTrunkDiameter: 3, // 25/18 (broadleaf divisor)
  maximumBranchDevelopment: 100,
  heightDiameterSplit: 0.4, // broadleaf default
  maxSlendernessRatio: 12,
  rootDevelopmentRate: 0.02, // broadleaf default
  reserveCapacity: 1000,
  waterRequirement: 50,
  nutrientRequirement: { nitrogen: 5, phosphorus: 2, potassium: 4 },
  temperatureRange: { minimum: 15, optimum: 27, maximum: 40 },
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
    nutrients: { nitrogen: 5, phosphorus: 2, potassium: 4 },
  },
};
