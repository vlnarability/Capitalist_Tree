/**
 * Continental (Köppen D) tree species — GAP-17 / DR-11 Phase 2 (W62 hand-authored).
 *
 * One real, native species per tree-supporting D-zone not already covered by the existing
White Oak (Dfa/Dfb) + Eastern Hemlock (Dfb/Dfc): Dfc (black spruce), Dfd/Dwc/Dwd
(Siberian + Dahurian larch), Dsc (lodgepole pine), Dsd (subalpine larch), Dwa
(Chinese red pine + Mongolian oak). The larches are deciduous conifers — a key
cold-climate adaptation. Each species is a hand-authored TreeSpecies object (W62).
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

/** Black Spruce (Picea mariana) — Dfc + ET. The boreal conifer of the North American
 * taiga; also forms krummholz (stunted prostrate mats) at the Arctic treeline. Small
 * (to 20 m), slow-growing (0.3), cold-hardy (minimum -5 °C). Tolerates the wet,
 * acidic, permafrost soils of the boreal lowlands. The other treeline form besides
 * Arctic Willow.
 *
 * Every constant is `@provisional` per GDD §17 ("detailed photosynthesis
 * and energy allocation equations"); values derive from the makeSpecies
 * allometric formulas + are tunable in playtesting.
 */
export const BLACK_SPRUCE: TreeSpecies = {
  id: 'species:black-spruce',
  name: 'Black Spruce',
  scientificName: 'Picea mariana',
  deciduous: false,
  nativeKoppenCodes: ['Dfc', 'ET'],

  growthRate: 0.3,
  matureAgeDays: 100 * 120, // 12000 days
  maximumHeight: 20,
  maximumTrunkDiameter: 0.67, // 20/30 (conifer divisor)
  maximumBranchDevelopment: 80,
  heightDiameterSplit: 0.55, // conifer default
  maxSlendernessRatio: 50,
  rootDevelopmentRate: 0.015, // conifer default
  reserveCapacity: 800,
  waterRequirement: 40,
  nutrientRequirement: { nitrogen: 4, phosphorus: 1.6, potassium: 3 },
  temperatureRange: { minimum: -5, optimum: 15, maximum: 28 },
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
    nutrients: { nitrogen: 4, phosphorus: 1.6, potassium: 3 },
  },
};

/** Siberian Larch (Larix sibirica) — Dfd + Dwc. Deciduous conifer of the cold
 * continental interior of Eurasia; sheds its needles for the extreme winter (a
 * deciduous habit is an adaptation to the deep-freeze continental climate — it
 * avoids winter desiccation + transpiration loss). Grows to 30 m; cold-tolerant to
 * -10 °C. The most widely planted larch in northern forestry.
 *
 * Every constant is `@provisional` per GDD §17 ("detailed photosynthesis
 * and energy allocation equations"); values derive from the makeSpecies
 * allometric formulas + are tunable in playtesting.
 */
export const SIBERIAN_LARCH: TreeSpecies = {
  id: 'species:siberian-larch',
  name: 'Siberian Larch',
  scientificName: 'Larix sibirica',
  deciduous: true,
  nativeKoppenCodes: ['Dfd', 'Dwc'],

  growthRate: 0.4,
  matureAgeDays: 120 * 120, // 14400 days
  maximumHeight: 30,
  maximumTrunkDiameter: 1, // 30/30 (conifer divisor)
  maximumBranchDevelopment: 120,
  heightDiameterSplit: 0.55, // conifer default
  maxSlendernessRatio: 50,
  rootDevelopmentRate: 0.015, // conifer default
  reserveCapacity: 1200,
  waterRequirement: 60,
  nutrientRequirement: { nitrogen: 6, phosphorus: 2.4, potassium: 5 },
  temperatureRange: { minimum: -10, optimum: 15, maximum: 28 },
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
    nutrients: { nitrogen: 6, phosphorus: 2.4, potassium: 5 },
  },
};

/** Dahurian Larch (Larix gmelinii) — Dfd + Dwd. The coldest-tolerant tree species on
 * Earth — it forms the world's northernmost treeline in northern Siberia. Deciduous
 * conifer (like Siberian Larch) but more cold-hardy (minimum -15 °C). Slow-growing
 * (0.3); the extreme cold tolerance makes it the defining species of the coldest
 * continental climates.
 *
 * Every constant is `@provisional` per GDD §17 ("detailed photosynthesis
 * and energy allocation equations"); values derive from the makeSpecies
 * allometric formulas + are tunable in playtesting.
 */
export const DAHURIAN_LARCH: TreeSpecies = {
  id: 'species:dahurian-larch',
  name: 'Dahurian Larch',
  scientificName: 'Larix gmelinii',
  deciduous: true,
  nativeKoppenCodes: ['Dfd', 'Dwd'],

  growthRate: 0.3,
  matureAgeDays: 120 * 120, // 14400 days
  maximumHeight: 25,
  maximumTrunkDiameter: 0.83, // 25/30 (conifer divisor)
  maximumBranchDevelopment: 100,
  heightDiameterSplit: 0.55, // conifer default
  maxSlendernessRatio: 50,
  rootDevelopmentRate: 0.015, // conifer default
  reserveCapacity: 1000,
  waterRequirement: 50,
  nutrientRequirement: { nitrogen: 5, phosphorus: 2, potassium: 4 },
  temperatureRange: { minimum: -15, optimum: 14, maximum: 25 },
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
    nutrients: { nitrogen: 5, phosphorus: 2, potassium: 4 },
  },
};

/** Lodgepole Pine (Pinus contorta) — Dsc. Continental dry-summer (cool) conifer of
 * the North American interior; named for its use as tipi poles. A pioneer species
 * that colonizes after fire (serotinous cones release seed on heating). Moderate
 * growth (0.45), cold-tolerant (-8 °C), straight + slender — the height-focused
 * conifer build suits its tall, narrow form.
 *
 * Every constant is `@provisional` per GDD §17 ("detailed photosynthesis
 * and energy allocation equations"); values derive from the makeSpecies
 * allometric formulas + are tunable in playtesting.
 */
export const LODGEPOLE_PINE: TreeSpecies = {
  id: 'species:lodgepole-pine',
  name: 'Lodgepole Pine',
  scientificName: 'Pinus contorta',
  deciduous: false,
  nativeKoppenCodes: ['Dsc'],

  growthRate: 0.45,
  matureAgeDays: 100 * 120, // 12000 days
  maximumHeight: 25,
  maximumTrunkDiameter: 0.83, // 25/30 (conifer divisor)
  maximumBranchDevelopment: 100,
  heightDiameterSplit: 0.55, // conifer default
  maxSlendernessRatio: 50,
  rootDevelopmentRate: 0.015, // conifer default
  reserveCapacity: 1000,
  waterRequirement: 50,
  nutrientRequirement: { nitrogen: 5, phosphorus: 2, potassium: 4 },
  temperatureRange: { minimum: -8, optimum: 14, maximum: 28 },
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
    nutrients: { nitrogen: 5, phosphorus: 2, potassium: 4 },
  },
};

/** Subalpine Larch (Larix lyallii) — Dsd. Deciduous conifer of the high continental
 * interiors of the North American Rockies. Stunted at altitude (to 15 m), slow-
 * growing (0.2), long-lived (150+ years). Golden autumn needles make it a flagship
 * species of the high subalpine. Cold-tolerant to -10 °C; deciduous for winter
 * avoidance.
 *
 * Every constant is `@provisional` per GDD §17 ("detailed photosynthesis
 * and energy allocation equations"); values derive from the makeSpecies
 * allometric formulas + are tunable in playtesting.
 */
export const SUBALPINE_LARCH: TreeSpecies = {
  id: 'species:subalpine-larch',
  name: 'Subalpine Larch',
  scientificName: 'Larix lyallii',
  deciduous: true,
  nativeKoppenCodes: ['Dsd'],

  growthRate: 0.2,
  matureAgeDays: 150 * 120, // 18000 days
  maximumHeight: 15,
  maximumTrunkDiameter: 0.5, // 15/30 (conifer divisor)
  maximumBranchDevelopment: 60,
  heightDiameterSplit: 0.55, // conifer default
  maxSlendernessRatio: 50,
  rootDevelopmentRate: 0.015, // conifer default
  reserveCapacity: 600,
  waterRequirement: 30,
  nutrientRequirement: { nitrogen: 3, phosphorus: 1.2, potassium: 2 },
  temperatureRange: { minimum: -10, optimum: 12, maximum: 22 },
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
    nutrients: { nitrogen: 3, phosphorus: 1.2, potassium: 2 },
  },
};

/** Chinese Red Pine (Pinus tabuliformis) — Dwa. Continental dry-winter (hot summer)
 * conifer of East Asia; the lowland pine of northern China. Moderate growth (0.5),
 * cold-tolerant (-8 °C) + heat-tolerant (maximum 32 °C) — spans a wide temperature
 * range reflecting the hot-summer / cold-winter continental climate. The flat-
 * topped canopy gives its species epithet.
 *
 * Every constant is `@provisional` per GDD §17 ("detailed photosynthesis
 * and energy allocation equations"); values derive from the makeSpecies
 * allometric formulas + are tunable in playtesting.
 */
export const CHINESE_RED_PINE: TreeSpecies = {
  id: 'species:chinese-red-pine',
  name: 'Chinese Red Pine',
  scientificName: 'Pinus tabuliformis',
  deciduous: false,
  nativeKoppenCodes: ['Dwa'],

  growthRate: 0.5,
  matureAgeDays: 100 * 120, // 12000 days
  maximumHeight: 25,
  maximumTrunkDiameter: 0.83, // 25/30 (conifer divisor)
  maximumBranchDevelopment: 100,
  heightDiameterSplit: 0.55, // conifer default
  maxSlendernessRatio: 50,
  rootDevelopmentRate: 0.015, // conifer default
  reserveCapacity: 1000,
  waterRequirement: 50,
  nutrientRequirement: { nitrogen: 5, phosphorus: 2, potassium: 4 },
  temperatureRange: { minimum: -8, optimum: 16, maximum: 32 },
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
    nutrients: { nitrogen: 5, phosphorus: 2, potassium: 4 },
  },
};

/** Mongolian Oak (Quercus mongolica) — Dwa + Dwb. Deciduous broadleaf of East Asian
 * continental forests; the cold-tolerant oak (minimum -10 °C, far hardier than
 * White Oak). A third Quercus (with White + English Oak) — same girth-heavy build
 * but adapted to the deep-freece continental winters. Slow-growing (0.4); the
 * deciduous habit handles the cold winter.
 *
 * Every constant is `@provisional` per GDD §17 ("detailed photosynthesis
 * and energy allocation equations"); values derive from the makeSpecies
 * allometric formulas + are tunable in playtesting.
 */
export const MONGOLIAN_OAK: TreeSpecies = {
  id: 'species:mongolian-oak',
  name: 'Mongolian Oak',
  scientificName: 'Quercus mongolica',
  deciduous: true,
  nativeKoppenCodes: ['Dwa', 'Dwb'],

  growthRate: 0.4,
  matureAgeDays: 120 * 120, // 14400 days
  maximumHeight: 25,
  maximumTrunkDiameter: 1.39, // 25/18 (broadleaf divisor)
  maximumBranchDevelopment: 100,
  heightDiameterSplit: 0.4, // broadleaf default
  maxSlendernessRatio: 40,
  rootDevelopmentRate: 0.02, // broadleaf default
  reserveCapacity: 1000,
  waterRequirement: 50,
  nutrientRequirement: { nitrogen: 5, phosphorus: 2, potassium: 4 },
  temperatureRange: { minimum: -10, optimum: 16, maximum: 30 },
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
