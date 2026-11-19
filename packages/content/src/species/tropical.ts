/**
 * Tropical (Köppen A) tree species — GAP-17 / DR-11 Phase 2.
 *
 * One real, native species per tree-supporting A-zone (Af, Am, As, Aw). All are
 * hot-climate broadleaf species; kapok + teak + mahogany are rainforest/
 * monsoon canopy species, baobab is the iconic savanna tree. Every constant is
 * `@provisional` per GDD §17; the essence (max height, deciduousness, climate-
 * derived temperature range) is real, the rest is allometric (see make-species).
 */
import { makeSpecies } from './make-species.js';

/** Kapok (Ceiba pentandra) — Af, equatorial rainforest emergent. Deciduous in seasonal climates. */
export const KAPOK = makeSpecies({
  id: 'species:kapok',
  name: 'Kapok',
  scientificName: 'Ceiba pentandra',
  deciduous: true,
  nativeKoppenCodes: ['Af'],
  maximumHeight: 60, // emergent — towers above the rainforest canopy
  growthRate: 0.8, // fast tropical growth
  matureAgeYears: 100,
  temperatureRange: { minimum: 15, optimum: 28, maximum: 38 },
});

/** Teak (Tectona grandis) — Am, equatorial monsoon. Deciduous in the dry season. */
export const TEAK = makeSpecies({
  id: 'species:teak',
  name: 'Teak',
  scientificName: 'Tectona grandis',
  deciduous: true,
  nativeKoppenCodes: ['Am'],
  maximumHeight: 40,
  growthRate: 0.7,
  matureAgeYears: 80,
  temperatureRange: { minimum: 15, optimum: 27, maximum: 38 },
});

/** Senegal mahogany (Khaya senegalensis) — As, tropical dry savanna. Semi-deciduous. */
export const SENEAGAL_MAHOGANY = makeSpecies({
  id: 'species:senegal-mahogany',
  name: 'Senegal Mahogany',
  scientificName: 'Khaya senegalensis',
  deciduous: true,
  nativeKoppenCodes: ['As'],
  maximumHeight: 30,
  growthRate: 0.6,
  matureAgeYears: 70,
  temperatureRange: { minimum: 15, optimum: 27, maximum: 40 },
});

/** Baobab (Adansonia digitata) — Aw, tropical savanna. Famously huge trunk, deciduous in the dry season. */
export const BAOBAB = makeSpecies({
  id: 'species:baobab',
  name: 'Baobab',
  scientificName: 'Adansonia digitata',
  deciduous: true,
  nativeKoppenCodes: ['Aw'],
  maximumHeight: 25,
  growthRate: 0.4, // slow — baobabs live 1000+ years
  matureAgeYears: 200,
  temperatureRange: { minimum: 15, optimum: 27, maximum: 40 },
  // Baobabs are extraordinarily stout for their height — override the
  // broadleaf defaults to reflect the massive water-storing trunk.
  maximumTrunkDiameter: 3, // ~8:1 height:diameter
  maxSlendernessRatio: 12,
});
