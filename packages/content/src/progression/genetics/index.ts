/**
 * Genetics content registry (P9a — TDD §5.7 / §11, GDD §11.2 Genetic Legacy).
 *
 * Re-exports the seven GDD §11.2 genetic trait definitions and the
 * `getTraitById` lookup. Each trait is a pure-data `GeneticTraitDefinition`
 * (rule 5). Follows the same barrel pattern as
 * `packages/content/src/businesses/index.ts`.
 */
export {
  RAPID_GROWTH,
  LARGE_FOLIAGE,
  DEEP_ROOTS,
  THICK_TRUNK,
  PEST_RESISTANCE,
  COLD_RESISTANCE,
  EFFICIENT_PHOTOSYNTHESIS,
  GENETIC_TRAITS,
  getTraitById,
} from './traits.js';
