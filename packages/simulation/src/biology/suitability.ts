/**
 * Species-climate suitability scoring (GAP-17 / DR-11 — Phase 5).
 *
 * `computeSpeciesClimateSuitability` rates how well a tree species suits a
 * (possibly highland-modified) climate on a 0-1 scale — the "right tree for the
 * right climate" as a gameplay lever. The score is:
 *
 *   score = 0.4 × nativeFit + 0.6 × tempFit   (clamped to [0, 1])
 *
 * - **nativeFit** (0 or 1): 1 iff the climate's `koppenCode` is in the species'
 *   `nativeKoppenCodes` (the §5b "offered for this zone" query). Non-native
 *   species score lower — the lever rewards planting the right species. The
 *   picker offers only natives, so this is 1 for every offered species + the
 *   `tempFit` decides between them.
 *
 * - **tempFit** (0-1): the average `temperatureFactor` over the species' ACTIVE
 *   seasons — how well the climate's seasonal base temps suit the species'
 *   temperature-response curve. Deciduous species are dormant in winter, so
 *   winter is excluded (a harsh winter shouldn't penalize a tree that sleeps
 *   through it); evergreen species are scored over all four seasons (they
 *   photosynthesize year-round if temps allow, so a winter below their minimum
 *   rightly lowers the score).
 *
 * The score differentiates species within a climate's native set (e.g. in Dfb
 * both White Oak + Eastern Hemlock are native, but their temp curves differ).
 * It's displayed in the picker + may drive a mild growth lever. It complements
 * — does not replace — the per-tick trait mechanics (the temperature→growth
 * curve, the water-demand/soil cycle, deciduous dormancy) that already make a
 * mismatched species struggle; the score is the aggregate, up-front signal.
 *
 * Pure: a deterministic function of (species, climate). Pass the EFFECTIVE
 * climate (base, or base + `applyHighlandModifier` when elevationM > 0) so the
 * highland preview reflects the shifted temperatures.
 */
import type { ClimateBaseline, TreeSpecies } from '@capitalist-tree/shared';
import { temperatureFactor } from './photosynthesis.js';

/** Seasons the tree is actively photosynthesizing (excludes winter for deciduous). */
function activeSeasons(deciduous: boolean): readonly (keyof ClimateBaseline['seasonalBaseTemp'])[] {
  return deciduous
    ? ['spring', 'summer', 'autumn']
    : ['spring', 'summer', 'autumn', 'winter'];
}

/**
 * Compute the 0-1 climate-suitability score for a species in a climate. Pure.
 *
 * @param species The tree species (its `nativeKoppenCodes`, `deciduous`,
 *   `temperatureRange` drive the score).
 * @param climate The (effective) climate — its `koppenCode` + `seasonalBaseTemp`.
 *   Pass `applyHighlandModifier(base, elevationM)` when elevationM > 0 so the
 *   score reflects the altitude-shifted temperatures.
 */
export function computeSpeciesClimateSuitability(
  species: TreeSpecies,
  climate: ClimateBaseline,
): number {
  const nativeFit = species.nativeKoppenCodes.includes(climate.koppenCode) ? 1 : 0;
  const seasons = activeSeasons(species.deciduous);
  let tempFitSum = 0;
  for (const s of seasons) {
    tempFitSum += temperatureFactor(climate.seasonalBaseTemp[s], species.temperatureRange);
  }
  const tempFit = tempFitSum / seasons.length;
  const score = 0.4 * nativeFit + 0.6 * tempFit;
  return Math.max(0, Math.min(1, score));
}
