/**
 * Species lookup helper (TDD §7.7).
 *
 * The simulation engine MUST NOT hardcode species traits (rule 5). It looks up
 * a species by id via the content package's registry at runtime. Tests can
 * inject a custom TreeSpecies directly into the pure biology functions — they
 * don't have to go through this lookup.
 */
import type { TreeSpecies } from '@capitalist-tree/shared';
import { findSpeciesById } from '@capitalist-tree/content';

/**
 * Look up a species by id. Throws if the species is not registered — a missing
 * species is a configuration error, not a runtime error the engine can recover
 * from.
 */
export function getSpeciesOrFail(speciesId: string): TreeSpecies {
  const species = findSpeciesById(speciesId);
  if (!species) {
    throw new Error(
      `BiologySystem: unknown species id "${speciesId}". ` +
        `Register the species in packages/content/src/species/index.ts.`,
    );
  }
  return species;
}
