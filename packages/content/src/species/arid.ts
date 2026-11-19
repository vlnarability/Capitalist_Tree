/**
 * Arid (Köppen B) tree species — GAP-17 / DR-11 Phase 2.
 *
 * One real, native species per tree-supporting B-zone (BWh, BWk, BSh, BSk — the
 * last via Ponderosa pine, which also covers Dsa/Dsb). Arid-zone trees are
 * defined by water stress: the date palm is an oasis palm, saxaul + mesquite are
 * drought-tolerant dryland species, ponderosa pine is a drought-tolerant conifer
 * of steppe + dry montane margins. Every constant is `@provisional` per GDD §17.
 */
import { makeSpecies } from './make-species.js';

/** Date palm (Phoenix dactylifera) — BWh, desert oasis palm. Evergreen, extreme heat tolerance. */
export const DATE_PALM = makeSpecies({
  id: 'species:date-palm',
  name: 'Date Palm',
  scientificName: 'Phoenix dactylifera',
  deciduous: false, // palms keep their fronds
  form: 'palm',
  nativeKoppenCodes: ['BWh'],
  maximumHeight: 21,
  growthRate: 0.6,
  matureAgeYears: 50,
  temperatureRange: { minimum: 12, optimum: 32, maximum: 48 }, // desert heat-tolerant
});

/** Saxaul (Haloxylon ammodendron) — BWk, cold desert. Drought-deciduous shrub-tree. */
export const SAXAUL = makeSpecies({
  id: 'species:saxaul',
  name: 'Saxaul',
  scientificName: 'Haloxylon ammodendron',
  deciduous: true,
  nativeKoppenCodes: ['BWk'],
  maximumHeight: 7, // shrubby small tree
  growthRate: 0.3, // slow — arid
  matureAgeYears: 80,
  temperatureRange: { minimum: -5, optimum: 15, maximum: 35 }, // cold desert
});

/** Honey mesquite (Prosopis glandulosa) — BSh, hot semi-arid steppe. Drought-deciduous, deep roots. */
export const HONEY_MESQUITE = makeSpecies({
  id: 'species:honey-mesquite',
  name: 'Honey Mesquite',
  scientificName: 'Prosopis glandulosa',
  deciduous: true,
  nativeKoppenCodes: ['BSh'],
  maximumHeight: 10,
  growthRate: 0.4,
  matureAgeYears: 50,
  temperatureRange: { minimum: 5, optimum: 28, maximum: 45 },
});

/**
 * Ponderosa pine (Pinus ponderosa) — BSk + Dsa + Dsb. Drought-tolerant conifer
 * of the western North American steppe margins + dry montane interiors. Spans
 * three Köppen zones (steppe + dry-summer continental hot/warm).
 */
export const PONDEROSA_PINE = makeSpecies({
  id: 'species:ponderosa-pine',
  name: 'Ponderosa Pine',
  scientificName: 'Pinus ponderosa',
  deciduous: false,
  form: 'conifer',
  nativeKoppenCodes: ['BSk', 'Dsa', 'Dsb'],
  maximumHeight: 50,
  growthRate: 0.5,
  matureAgeYears: 150,
  temperatureRange: { minimum: 0, optimum: 18, maximum: 38 },
});
