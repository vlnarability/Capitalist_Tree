/**
 * Tree species content registry (GAP-17 / DR-11 — expanded to all 30
 * tree-supporting Köppen zones in Phase 2).
 *
 * Each species is a pure data object (TDD §7.7). The simulation engine looks
 * up a species by id via `findSpeciesById`; content authors add new species by
 * appending to `ALL_SPECIES` and re-exporting. The engine imports this module
 * directly so that the DEFAULT_GAME_CONFIG can reference a real species
 * (P1: White Oak). Tests can inject their own species via `GameConfig.species`
 * without touching this registry.
 *
 * GAP-17 Phase 2: every `supportsTrees: true` climate zone has ≥1 real species
 * native to it (carried on `species.nativeKoppenCodes`). The existing White Oak
 * (Dfa/Dfb) + Eastern Hemlock (Dfb/Dfc) are kept; the 25 new species are built
 * via the `makeSpecies` allometric factory (see make-species.ts). EF (ice cap)
 * has no species — no tree survives perennial ice. `findSpeciesByKoppenCode`
 * returns the species offered for a given climate zone (the "right tree for the
 * right climate" query, used by Phase 4's climate picker).
 */
import type { TreeSpecies } from '@capitalist-tree/shared';
import { WHITE_OAK } from './white-oak.js';
import { EASTERN_HEMLOCK } from './eastern-hemlock.js';
import { KAPOK, TEAK, SENEGAL_MAHOGANY, BAOBAB } from './tropical.js';
import { DATE_PALM, SAXAUL, HONEY_MESQUITE, PONDEROSA_PINE } from './arid.js';
import {
  LIVE_OAK,
  ENGLISH_OAK,
  SOUTHERN_BEECH,
  OLIVE,
  COAST_REDWOOD,
  MOUNTAIN_HEMLOCK,
  DAWN_REDWOOD,
  HARTWEGS_PINE,
  POLYLEPIS,
} from './temperate.js';
import {
  BLACK_SPRUCE,
  SIBERIAN_LARCH,
  DAHURIAN_LARCH,
  LODGEPOLE_PINE,
  SUBALPINE_LARCH,
  CHINESE_RED_PINE,
  MONGOLIAN_OAK,
} from './continental.js';
import { ARCTIC_WILLOW } from './polar.js';

export { WHITE_OAK } from './white-oak.js';
export { EASTERN_HEMLOCK } from './eastern-hemlock.js';
export { KAPOK, TEAK, SENEGAL_MAHOGANY, BAOBAB } from './tropical.js';
export { DATE_PALM, SAXAUL, HONEY_MESQUITE, PONDEROSA_PINE } from './arid.js';
export {
  LIVE_OAK,
  ENGLISH_OAK,
  SOUTHERN_BEECH,
  OLIVE,
  COAST_REDWOOD,
  MOUNTAIN_HEMLOCK,
  DAWN_REDWOOD,
  HARTWEGS_PINE,
  POLYLEPIS,
} from './temperate.js';
export {
  BLACK_SPRUCE,
  SIBERIAN_LARCH,
  DAHURIAN_LARCH,
  LODGEPOLE_PINE,
  SUBALPINE_LARCH,
  CHINESE_RED_PINE,
  MONGOLIAN_OAK,
} from './continental.js';
export { ARCTIC_WILLOW } from './polar.js';

/**
 * All known species: the existing White Oak + Eastern Hemlock + the 25 GAP-17
 * species covering every tree-supporting Köppen zone. Add new species in the
 * per-class files (tropical/arid/temperate/continental/polar); the engine code
 * stays fixed (rule 5: species are data).
 */
export const ALL_SPECIES: readonly TreeSpecies[] = [
  WHITE_OAK,
  EASTERN_HEMLOCK,
  KAPOK,
  TEAK,
  SENEGAL_MAHOGANY,
  BAOBAB,
  DATE_PALM,
  SAXAUL,
  HONEY_MESQUITE,
  PONDEROSA_PINE,
  LIVE_OAK,
  ENGLISH_OAK,
  SOUTHERN_BEECH,
  OLIVE,
  COAST_REDWOOD,
  MOUNTAIN_HEMLOCK,
  DAWN_REDWOOD,
  HARTWEGS_PINE,
  POLYLEPIS,
  BLACK_SPRUCE,
  SIBERIAN_LARCH,
  DAHURIAN_LARCH,
  LODGEPOLE_PINE,
  SUBALPINE_LARCH,
  CHINESE_RED_PINE,
  MONGOLIAN_OAK,
  ARCTIC_WILLOW,
];

/** Look up a species by id. Returns the species or `undefined` if unknown. */
export function findSpeciesById(speciesId: string): TreeSpecies | undefined {
  return ALL_SPECIES.find((s) => s.id === speciesId);
}

/**
 * GAP-17: return every species native to a given Köppen code (the species
 * offered for a climate zone). A species is offered iff the zone's
 * `koppenCode` is in `species.nativeKoppenCodes`. Returns `[]` for EF (no
 * species) — the caller should not offer a species picker for a
 * `supportsTrees: false` zone.
 */
export function findSpeciesByKoppenCode(koppenCode: string): readonly TreeSpecies[] {
  return ALL_SPECIES.filter((s) => s.nativeKoppenCodes.includes(koppenCode));
}
