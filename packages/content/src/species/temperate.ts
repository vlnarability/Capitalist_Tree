/**
 * Temperate (Köppen C) tree species — GAP-17 / DR-11 Phase 2.
 *
 * One real, native species per tree-supporting C-zone (Cfa, Cfb, Cfc, Csa, Csb,
 * Csc, Cwa, Cwb, Cwc). Mix of broadleaf + conifer, evergreen + deciduous,
 * reflecting the mild-climate diversity. The dawn redwood + coast redwood are
 * notable (deciduous conifer + tallest tree respectively). Every constant is
 * `@provisional` per GDD §17.
 */
import { makeSpecies } from './make-species.js';

/** Live oak (Quercus virginiana) — Cfa, humid subtropical. Evergreen broadleaf. */
export const LIVE_OAK = makeSpecies({
  id: 'species:live-oak',
  name: 'Live Oak',
  scientificName: 'Quercus virginiana',
  deciduous: false, // evergreen broadleaf
  nativeKoppenCodes: ['Cfa'],
  maximumHeight: 20,
  growthRate: 0.45,
  matureAgeYears: 100,
  temperatureRange: { minimum: 5, optimum: 22, maximum: 38 },
});

/** English oak (Quercus robur) — Cfb, marine west coast. Deciduous broadleaf. */
export const ENGLISH_OAK = makeSpecies({
  id: 'species:english-oak',
  name: 'English Oak',
  scientificName: 'Quercus robur',
  deciduous: true,
  nativeKoppenCodes: ['Cfb'],
  maximumHeight: 35,
  growthRate: 0.5,
  matureAgeYears: 150,
  temperatureRange: { minimum: 0, optimum: 18, maximum: 35 },
});

/** Southern beech (Nothofagus spp.) — Cfc, marine subarctic. Evergreen broadleaf. */
export const SOUTHERN_BEECH = makeSpecies({
  id: 'species:southern-beech',
  name: 'Southern Beech',
  scientificName: 'Nothofagus spp.',
  deciduous: false,
  nativeKoppenCodes: ['Cfc'],
  maximumHeight: 30,
  growthRate: 0.5,
  matureAgeYears: 120,
  temperatureRange: { minimum: 2, optimum: 14, maximum: 28 },
});

/** Olive (Olea europaea) — Csa, Mediterranean (hot summer). Evergreen, drought-tolerant. */
export const OLIVE = makeSpecies({
  id: 'species:olive',
  name: 'Olive',
  scientificName: 'Olea europaea',
  deciduous: false,
  nativeKoppenCodes: ['Csa'],
  maximumHeight: 12,
  growthRate: 0.35, // slow — olives live centuries
  matureAgeYears: 80,
  temperatureRange: { minimum: 5, optimum: 20, maximum: 38 },
});

/** Coast redwood (Sequoia sempervirens) — Csb, Mediterranean (cool summer). Tallest tree species. */
export const COAST_REDWOOD = makeSpecies({
  id: 'species:coast-redwood',
  name: 'Coast Redwood',
  scientificName: 'Sequoia sempervirens',
  deciduous: false,
  form: 'conifer',
  nativeKoppenCodes: ['Csb'],
  maximumHeight: 80, // the tallest trees on Earth
  growthRate: 0.7, // fast for a conifer
  matureAgeYears: 200,
  temperatureRange: { minimum: 2, optimum: 16, maximum: 30 },
});

/** Mountain hemlock (Tsuga mertensiana) — Csc, Mediterranean (very cool summer). High-altitude conifer. */
export const MOUNTAIN_HEMLOCK = makeSpecies({
  id: 'species:mountain-hemlock',
  name: 'Mountain Hemlock',
  scientificName: 'Tsuga mertensiana',
  deciduous: false,
  form: 'conifer',
  nativeKoppenCodes: ['Csc'],
  maximumHeight: 25,
  growthRate: 0.35,
  matureAgeYears: 150,
  temperatureRange: { minimum: -2, optimum: 12, maximum: 25 },
});

/** Dawn redwood (Metasequoia glyptostroboides) — Cwa, subtropical (dry winter). Rare deciduous conifer. */
export const DAWN_REDWOOD = makeSpecies({
  id: 'species:dawn-redwood',
  name: 'Dawn Redwood',
  scientificName: 'Metasequoia glyptostroboides',
  deciduous: true, // one of the few deciduous conifers
  form: 'conifer',
  nativeKoppenCodes: ['Cwa'],
  maximumHeight: 40,
  growthRate: 0.8, // fast
  matureAgeYears: 80,
  temperatureRange: { minimum: -5, optimum: 20, maximum: 35 },
});

/** Hartweg's pine (Pinus hartwegii) — Cwb, subtropical highland (dry winter). High-altitude pine. */
export const HARTWEGS_PINE = makeSpecies({
  id: 'species:hartwegs-pine',
  name: "Hartweg's Pine",
  scientificName: 'Pinus hartwegii',
  deciduous: false,
  form: 'conifer',
  nativeKoppenCodes: ['Cwb'],
  maximumHeight: 20,
  growthRate: 0.3, // slow — high altitude
  matureAgeYears: 120,
  temperatureRange: { minimum: -2, optimum: 14, maximum: 25 },
});

/** Polylepis (Polylepis tarapacana) — Cwc, subtropical highland (cool summer). One of the highest-altitude trees on Earth. */
export const POLYLEPIS = makeSpecies({
  id: 'species:polylepis',
  name: 'Polylepis',
  scientificName: 'Polylepis tarapacana',
  deciduous: false, // evergreen, gnarled high-Andes tree
  nativeKoppenCodes: ['Cwc'],
  maximumHeight: 5, // stunted, prostrate at extreme altitude
  growthRate: 0.15, // extremely slow
  matureAgeYears: 200,
  temperatureRange: { minimum: -3, optimum: 10, maximum: 20 },
  // Gnarled, stout high-altitude form — a lower slenderness ratio than the broadleaf default.
  maxSlendernessRatio: 20,
});
