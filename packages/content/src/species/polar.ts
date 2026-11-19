/**
 * Polar (Köppen E) tree species — GAP-17 / DR-11 Phase 2.
 *
 * ET (tundra) is the only tree-supporting E-zone (EF — ice cap — has none: no
 * tree survives perennial ice). Trees at the Arctic treeline are at their
 * absolute limit — stunted, prostrate forms. The Arctic willow is a prostrate
 * shrub that barely qualifies as a "tree"; black spruce krummholz (in
 * continental.ts, native to Dfc + ET) is the other treeline form. Every constant
 * is `@provisional` per GDD §17.
 */
import { makeSpecies } from './make-species.js';

/** Arctic willow (Salix arctica) — ET. Prostrate deciduous shrub of the Arctic tundra. */
export const ARCTIC_WILLOW = makeSpecies({
  id: 'species:arctic-willow',
  name: 'Arctic Willow',
  scientificName: 'Salix arctica',
  deciduous: true,
  nativeKoppenCodes: ['ET'],
  maximumHeight: 0.3, // prostrate — creeps along the ground
  growthRate: 0.1, // extremely slow (short growing season)
  matureAgeYears: 50,
  temperatureRange: { minimum: -8, optimum: 8, maximum: 18 },
  // Prostrate, low-spreading form — a lower slenderness ratio than the broadleaf default.
  maxSlendernessRatio: 25,
});
