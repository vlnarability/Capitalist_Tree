/**
 * Continental (Köppen D) tree species — GAP-17 / DR-11 Phase 2.
 *
 * One real, native species per tree-supporting D-zone not already covered by
 * the existing White Oak (Dfa/Dfb) + Eastern Hemlock (Dfb/Dfc): Dfc (black
 * spruce), Dfd (Siberian + Dahurian larch), Dsa/Dsb (ponderosa pine, in arid.ts),
 * Dsc (lodgepole pine), Dsd (subalpine larch), Dwa (Chinese red pine + Mongolian
 * oak), Dwb (Mongolian oak), Dwc (Siberian larch), Dwd (Dahurian larch). The
 * larches are deciduous conifers — a key cold-climate adaptation. Every constant
 * is `@provisional` per GDD §17.
 */
import { makeSpecies } from './make-species.js';

/** Black spruce (Picea mariana) — Dfc + ET. Boreal conifer; also krummholz at the Arctic treeline. */
export const BLACK_SPRUCE = makeSpecies({
  id: 'species:black-spruce',
  name: 'Black Spruce',
  scientificName: 'Picea mariana',
  deciduous: false,
  form: 'conifer',
  nativeKoppenCodes: ['Dfc', 'ET'],
  maximumHeight: 20, // smaller at the boreal/treeline margin
  growthRate: 0.3,
  matureAgeYears: 100,
  temperatureRange: { minimum: -5, optimum: 15, maximum: 28 },
});

/** Siberian larch (Larix sibirica) — Dfd + Dwc. Deciduous conifer of the cold continental interior. */
export const SIBERIAN_LARCH = makeSpecies({
  id: 'species:siberian-larch',
  name: 'Siberian Larch',
  scientificName: 'Larix sibirica',
  deciduous: true, // deciduous conifer — sheds needles for the extreme winter
  form: 'conifer',
  nativeKoppenCodes: ['Dfd', 'Dwc'],
  maximumHeight: 30,
  growthRate: 0.4,
  matureAgeYears: 120,
  temperatureRange: { minimum: -10, optimum: 15, maximum: 28 },
});

/** Dahurian larch (Larix gmelinii) — Dfd + Dwd. The coldest-tolerant tree species on Earth. */
export const DAHURIAN_LARCH = makeSpecies({
  id: 'species:dahurian-larch',
  name: 'Dahurian Larch',
  scientificName: 'Larix gmelinii',
  deciduous: true,
  form: 'conifer',
  nativeKoppenCodes: ['Dfd', 'Dwd'],
  maximumHeight: 25,
  growthRate: 0.3,
  matureAgeYears: 120,
  temperatureRange: { minimum: -15, optimum: 14, maximum: 25 },
});

/** Lodgepole pine (Pinus contorta) — Dsc. Continental dry-summer (cool) conifer. */
export const LODGEPOLE_PINE = makeSpecies({
  id: 'species:lodgepole-pine',
  name: 'Lodgepole Pine',
  scientificName: 'Pinus contorta',
  deciduous: false,
  form: 'conifer',
  nativeKoppenCodes: ['Dsc'],
  maximumHeight: 25,
  growthRate: 0.45,
  matureAgeYears: 100,
  temperatureRange: { minimum: -8, optimum: 14, maximum: 28 },
});

/** Subalpine larch (Larix lyallii) — Dsd. Deciduous conifer of high continental interiors. */
export const SUBALPINE_LARCH = makeSpecies({
  id: 'species:subalpine-larch',
  name: 'Subalpine Larch',
  scientificName: 'Larix lyallii',
  deciduous: true,
  form: 'conifer',
  nativeKoppenCodes: ['Dsd'],
  maximumHeight: 15, // stunted at high altitude
  growthRate: 0.2, // slow
  matureAgeYears: 150,
  temperatureRange: { minimum: -10, optimum: 12, maximum: 22 },
});

/** Chinese red pine (Pinus tabuliformis) — Dwa. Continental dry-winter (hot summer) conifer. */
export const CHINESE_RED_PINE = makeSpecies({
  id: 'species:chinese-red-pine',
  name: 'Chinese Red Pine',
  scientificName: 'Pinus tabuliformis',
  deciduous: false,
  form: 'conifer',
  nativeKoppenCodes: ['Dwa'],
  maximumHeight: 25,
  growthRate: 0.5,
  matureAgeYears: 100,
  temperatureRange: { minimum: -8, optimum: 16, maximum: 32 },
});

/** Mongolian oak (Quercus mongolica) — Dwa + Dwb. Deciduous broadleaf of East Asian continental forests. */
export const MONGOLIAN_OAK = makeSpecies({
  id: 'species:mongolian-oak',
  name: 'Mongolian Oak',
  scientificName: 'Quercus mongolica',
  deciduous: true,
  nativeKoppenCodes: ['Dwa', 'Dwb'],
  maximumHeight: 25,
  growthRate: 0.4,
  matureAgeYears: 120,
  temperatureRange: { minimum: -10, optimum: 16, maximum: 30 },
});
