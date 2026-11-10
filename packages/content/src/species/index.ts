/**
 * Tree species content registry.
 *
 * Each species is a pure data object (TDD §7.7). The simulation engine looks
 * up a species by id via `findSpeciesById`; content authors add new species
 * by appending to `ALL_SPECIES` and re-exporting.
 *
 * The engine imports this module directly so that the DEFAULT_GAME_CONFIG can
 * reference a real species (P1: white oak). Tests can inject their own
 * species via `GameConfig.species` without touching this registry.
 */
import type { TreeSpecies } from '@capitalist-tree/shared';
import { WHITE_OAK } from './white-oak.js';

export { WHITE_OAK } from './white-oak.js';

/** All known species. Add new species here. */
export const ALL_SPECIES: readonly TreeSpecies[] = [WHITE_OAK];

/** Look up a species by id. Returns the species or `undefined` if unknown. */
export function findSpeciesById(speciesId: string): TreeSpecies | undefined {
  return ALL_SPECIES.find((s) => s.id === speciesId);
}
