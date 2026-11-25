/**
 * Temperate (Köppen C) tree species — GAP-17 / DR-11 Phase 2 (W62 hand-authored).
 *
 * One real, native species per tree-supporting C-zone (Cfa, Cfb, Cfc, Csa, Csb, Csc, Cwa,
Cwb, Cwc). Mix of broadleaf + conifer, evergreen + deciduous, reflecting the mild-
climate diversity. The dawn redwood + coast redwood are notable (deciduous conifer
+ tallest tree respectively). Each species is a hand-authored TreeSpecies object
(W62) — values derive from the makeSpecies allometric formulas; the explicit form
makes them first-class, individually-tunable content.
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

/** Live Oak (Quercus virginiana) — Cfa humid subtropical. Evergreen broadleaf that
 * keeps its leaves year-round (contrast: the deciduous White Oak of Dfa/Dfb). Famous
 * for a broad, spreading canopy + exceptional longevity (200+ years). Dense, durable
 * wood. Slower-growing than White Oak despite the warmer climate — the evergreen
 * habit trades peak growth rate for year-round photosynthesis.
 *
 * Every constant is `@provisional` per GDD §17 ("detailed photosynthesis
 * and energy allocation equations"); values derive from the makeSpecies
 * allometric formulas + are tunable in playtesting.
 */
export const LIVE_OAK: TreeSpecies = {
  id: 'species:live-oak',
  name: 'Live Oak',
  scientificName: 'Quercus virginiana',
  deciduous: false,
  nativeKoppenCodes: ['Cfa'],

  growthRate: 0.45,
  matureAgeDays: 100 * 120, // 12000 days
  maximumHeight: 20,
  maximumTrunkDiameter: 1.11, // 20/18 (broadleaf divisor)
  maximumBranchDevelopment: 80,
  heightDiameterSplit: 0.4, // broadleaf default
  maxSlendernessRatio: 40,
  rootDevelopmentRate: 0.02, // broadleaf default
  reserveCapacity: 800,
  waterRequirement: 40,
  nutrientRequirement: { nitrogen: 4, phosphorus: 1.6, potassium: 3 },
  temperatureRange: { minimum: 5, optimum: 22, maximum: 38 },
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
    nutrients: { nitrogen: 4, phosphorus: 1.6, potassium: 3 },
  },
};

/** English Oak (Quercus robur) — Cfb marine west coast. Deciduous broadleaf, a close
 * Old-World cousin of White Oak (also Quercus) but taller (to 35 m) + more cold-
 * tolerant (minimum 0 °C vs White Oak's 5 °C). Long-lived (150+ years to maturity);
 * the iconic oak of European forests. Same girth-heavy build as White Oak.
 *
 * Every constant is `@provisional` per GDD §17 ("detailed photosynthesis
 * and energy allocation equations"); values derive from the makeSpecies
 * allometric formulas + are tunable in playtesting.
 */
export const ENGLISH_OAK: TreeSpecies = {
  id: 'species:english-oak',
  name: 'English Oak',
  scientificName: 'Quercus robur',
  deciduous: true,
  nativeKoppenCodes: ['Cfb'],

  growthRate: 0.5,
  matureAgeDays: 150 * 120, // 18000 days
  maximumHeight: 35,
  maximumTrunkDiameter: 1.94, // 35/18 (broadleaf divisor)
  maximumBranchDevelopment: 140,
  heightDiameterSplit: 0.4, // broadleaf default
  maxSlendernessRatio: 40,
  rootDevelopmentRate: 0.02, // broadleaf default
  reserveCapacity: 1400,
  waterRequirement: 70,
  nutrientRequirement: { nitrogen: 7, phosphorus: 2.8, potassium: 6 },
  temperatureRange: { minimum: 0, optimum: 18, maximum: 35 },
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
    nutrients: { nitrogen: 7, phosphorus: 2.8, potassium: 6 },
  },
};

/** Southern Beech (Nothofagus spp.) — Cfc marine subarctic. Evergreen broadleaf of
 * the cool, oceanic southern hemisphere (New Zealand, Patagonia). A Gondwanan relic
 * genus — contrasts the northern oaks/pines. Cold-summer tolerant (optimum 14 °C);
 * grows to 30 m where the climate allows.
 *
 * Every constant is `@provisional` per GDD §17 ("detailed photosynthesis
 * and energy allocation equations"); values derive from the makeSpecies
 * allometric formulas + are tunable in playtesting.
 */
export const SOUTHERN_BEECH: TreeSpecies = {
  id: 'species:southern-beech',
  name: 'Southern Beech',
  scientificName: 'Nothofagus spp.',
  deciduous: false,
  nativeKoppenCodes: ['Cfc'],

  growthRate: 0.5,
  matureAgeDays: 120 * 120, // 14400 days
  maximumHeight: 30,
  maximumTrunkDiameter: 1.67, // 30/18 (broadleaf divisor)
  maximumBranchDevelopment: 120,
  heightDiameterSplit: 0.4, // broadleaf default
  maxSlendernessRatio: 40,
  rootDevelopmentRate: 0.02, // broadleaf default
  reserveCapacity: 1200,
  waterRequirement: 60,
  nutrientRequirement: { nitrogen: 6, phosphorus: 2.4, potassium: 5 },
  temperatureRange: { minimum: 2, optimum: 14, maximum: 28 },
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

/** Olive (Olea europaea) — Csa Mediterranean (hot summer). Evergreen, famously
 * drought-tolerant small tree (to 12 m). Slow-growing (0.35) + exceptionally
 * long-lived (some specimens are 1000+ years). Leathery leaves + a deep root system
 * adapt it to the long summer dry season. The small, dense canopy contrasts the
 * broad oaks.
 *
 * Every constant is `@provisional` per GDD §17 ("detailed photosynthesis
 * and energy allocation equations"); values derive from the makeSpecies
 * allometric formulas + are tunable in playtesting.
 */
export const OLIVE: TreeSpecies = {
  id: 'species:olive',
  name: 'Olive',
  scientificName: 'Olea europaea',
  deciduous: false,
  nativeKoppenCodes: ['Csa'],

  growthRate: 0.35,
  matureAgeDays: 80 * 120, // 9600 days
  maximumHeight: 12,
  maximumTrunkDiameter: 0.67, // 12/18 (broadleaf divisor)
  maximumBranchDevelopment: 48,
  heightDiameterSplit: 0.4, // broadleaf default
  maxSlendernessRatio: 40,
  rootDevelopmentRate: 0.02, // broadleaf default
  reserveCapacity: 480,
  waterRequirement: 24,
  nutrientRequirement: { nitrogen: 2, phosphorus: 1, potassium: 2 },
  temperatureRange: { minimum: 5, optimum: 20, maximum: 38 },
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
    nutrients: { nitrogen: 2, phosphorus: 1, potassium: 2 },
  },
};

/** Coast Redwood (Sequoia sempervirens) — Csb Mediterranean (cool summer). The
 * tallest tree species on Earth (to 80 m +). Evergreen conifer of the Pacific fog-
 * belt; fast-growing for a conifer (0.7). The extreme height makes the maturity
 * mechanic span the longest horizon of any species (200 years). Height-focused
 * conifer build.
 *
 * Every constant is `@provisional` per GDD §17 ("detailed photosynthesis
 * and energy allocation equations"); values derive from the makeSpecies
 * allometric formulas + are tunable in playtesting.
 */
export const COAST_REDWOOD: TreeSpecies = {
  id: 'species:coast-redwood',
  name: 'Coast Redwood',
  scientificName: 'Sequoia sempervirens',
  deciduous: false,
  nativeKoppenCodes: ['Csb'],

  growthRate: 0.7,
  matureAgeDays: 200 * 120, // 24000 days
  maximumHeight: 80,
  maximumTrunkDiameter: 2.67, // 80/30 (conifer divisor)
  maximumBranchDevelopment: 320,
  heightDiameterSplit: 0.55, // conifer default
  maxSlendernessRatio: 50,
  rootDevelopmentRate: 0.015, // conifer default
  reserveCapacity: 3200,
  waterRequirement: 160,
  nutrientRequirement: { nitrogen: 16, phosphorus: 6.4, potassium: 13 },
  temperatureRange: { minimum: 2, optimum: 16, maximum: 30 },
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
    nutrients: { nitrogen: 16, phosphorus: 6.4, potassium: 13 },
  },
};

/** Mountain Hemlock (Tsuga mertensiana) — Csc Mediterranean (very cool summer). High-
 * altitude conifer of the Pacific Northwest; a close relative of Eastern Hemlock
 * but adapted to high, snowy montane climates (minimum -2 °C). Slender, slow-
 * growing (0.35), long-lived. Carries large, heavy cones relative to its size.
 *
 * Every constant is `@provisional` per GDD §17 ("detailed photosynthesis
 * and energy allocation equations"); values derive from the makeSpecies
 * allometric formulas + are tunable in playtesting.
 */
export const MOUNTAIN_HEMLOCK: TreeSpecies = {
  id: 'species:mountain-hemlock',
  name: 'Mountain Hemlock',
  scientificName: 'Tsuga mertensiana',
  deciduous: false,
  nativeKoppenCodes: ['Csc'],

  growthRate: 0.35,
  matureAgeDays: 150 * 120, // 18000 days
  maximumHeight: 25,
  maximumTrunkDiameter: 0.83, // 25/30 (conifer divisor)
  maximumBranchDevelopment: 100,
  heightDiameterSplit: 0.55, // conifer default
  maxSlendernessRatio: 50,
  rootDevelopmentRate: 0.015, // conifer default
  reserveCapacity: 1000,
  waterRequirement: 50,
  nutrientRequirement: { nitrogen: 5, phosphorus: 2, potassium: 4 },
  temperatureRange: { minimum: -2, optimum: 12, maximum: 25 },
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

/** Dawn Redwood (Metasequoia glyptostroboides) — Cwa subtropical (dry winter). A rare
 * DECIDUOUS conifer — sheds its needles each winter (one of few such species, like
 * the larches). Fast-growing (0.8) + reaches 40 m. A living fossil (described from
 * fossils before living trees were found). The deciduous-conifer contrast exercises
 * both seasonal + form branches.
 *
 * Every constant is `@provisional` per GDD §17 ("detailed photosynthesis
 * and energy allocation equations"); values derive from the makeSpecies
 * allometric formulas + are tunable in playtesting.
 */
export const DAWN_REDWOOD: TreeSpecies = {
  id: 'species:dawn-redwood',
  name: 'Dawn Redwood',
  scientificName: 'Metasequoia glyptostroboides',
  deciduous: true,
  nativeKoppenCodes: ['Cwa'],

  growthRate: 0.8,
  matureAgeDays: 80 * 120, // 9600 days
  maximumHeight: 40,
  maximumTrunkDiameter: 1.33, // 40/30 (conifer divisor)
  maximumBranchDevelopment: 160,
  heightDiameterSplit: 0.55, // conifer default
  maxSlendernessRatio: 50,
  rootDevelopmentRate: 0.015, // conifer default
  reserveCapacity: 1600,
  waterRequirement: 80,
  nutrientRequirement: { nitrogen: 8, phosphorus: 3.2, potassium: 6 },
  temperatureRange: { minimum: -5, optimum: 20, maximum: 35 },
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
    nutrients: { nitrogen: 8, phosphorus: 3.2, potassium: 6 },
  },
};

/** Hartweg's Pine (Pinus hartwegii) — Cwb subtropical highland (dry winter). High-
 * altitude pine of the Mexican volcanics; one of the highest-elevation pines. Slow-
 * growing (0.3), short (to 20 m), cold-tolerant. Forms the treeline on its native
 * peaks. Stout conifer build for the harsh highland climate.
 *
 * Every constant is `@provisional` per GDD §17 ("detailed photosynthesis
 * and energy allocation equations"); values derive from the makeSpecies
 * allometric formulas + are tunable in playtesting.
 */
export const HARTWEGS_PINE: TreeSpecies = {
  id: 'species:hartwegs-pine',
  name: "Hartweg's Pine",
  scientificName: 'Pinus hartwegii',
  deciduous: false,
  nativeKoppenCodes: ['Cwb'],

  growthRate: 0.3,
  matureAgeDays: 120 * 120, // 14400 days
  maximumHeight: 20,
  maximumTrunkDiameter: 0.67, // 20/30 (conifer divisor)
  maximumBranchDevelopment: 80,
  heightDiameterSplit: 0.55, // conifer default
  maxSlendernessRatio: 50,
  rootDevelopmentRate: 0.015, // conifer default
  reserveCapacity: 800,
  waterRequirement: 40,
  nutrientRequirement: { nitrogen: 4, phosphorus: 1.6, potassium: 3 },
  temperatureRange: { minimum: -2, optimum: 14, maximum: 25 },
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

/** Polylepis (Polylepis tarapacana) — Cwc subtropical highland (cool summer). One of
 * the highest-altitude trees on Earth (to ~5200 m in the Andes). Stunted, gnarled,
 * prostrate at the extreme altitude (max 5 m). Extremely slow (0.15) + very long-
 * lived (200+ years to maturity). The low maxSlendernessRatio (20) reflects the
 * stout, low-spreading high-altitude form.
 *
 * Every constant is `@provisional` per GDD §17 ("detailed photosynthesis
 * and energy allocation equations"); values derive from the makeSpecies
 * allometric formulas + are tunable in playtesting.
 */
export const POLYLEPIS: TreeSpecies = {
  id: 'species:polylepis',
  name: 'Polylepis',
  scientificName: 'Polylepis tarapacana',
  deciduous: false,
  nativeKoppenCodes: ['Cwc'],

  growthRate: 0.15,
  matureAgeDays: 200 * 120, // 24000 days
  maximumHeight: 5,
  maximumTrunkDiameter: 0.28, // 5/18 (broadleaf divisor)
  maximumBranchDevelopment: 20,
  heightDiameterSplit: 0.4, // broadleaf default
  maxSlendernessRatio: 20,
  rootDevelopmentRate: 0.02, // broadleaf default
  reserveCapacity: 200,
  waterRequirement: 10,
  nutrientRequirement: { nitrogen: 1, phosphorus: 0.5, potassium: 1 },
  temperatureRange: { minimum: -3, optimum: 10, maximum: 20 },
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
    nutrients: { nitrogen: 1, phosphorus: 0.5, potassium: 1 },
  },
};
