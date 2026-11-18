import { describe, it, expect } from 'vitest';
import { testTree, testContext } from './_biology-helpers.js';
import { photosynthesisForStep } from '../src/biology/photosynthesis.js';
import { WHITE_OAK, EASTERN_HEMLOCK, ALL_SPECIES, findSpeciesById } from '@capitalist-tree/content';

/**
 * P12-A (GAP-16): Eastern Hemlock — the second playable tree species.
 * Exercises the data-driven content pipeline + the evergreen seasonal contrast
 * (deciduous oak vs evergreen hemlock). DR-4 (height/diameter independence)
 * was the prerequisite — unblocked by the 96b95dd refactor.
 */
describe('P12-A: Eastern Hemlock (2nd species) — evergreen contrast', () => {
  it('is registered + lookable by id + evergreen', () => {
    expect(EASTERN_HEMLOCK.id).toBe('species:eastern-hemlock');
    expect(EASTERN_HEMLOCK.name).toBe('Eastern Hemlock');
    expect(EASTERN_HEMLOCK.scientificName).toBe('Tsuga canadensis');
    expect(EASTERN_HEMLOCK.deciduous).toBe(false);
    expect(ALL_SPECIES.length).toBeGreaterThanOrEqual(2);
    expect(ALL_SPECIES.map((s) => s.id)).toContain('species:eastern-hemlock');
    expect(findSpeciesById('species:eastern-hemlock')?.name).toBe('Eastern Hemlock');
  });

  it('evergreen photosynthesizes in winter; deciduous oak does not (the P12-A contrast)', () => {
    // Same tree state (1000 leaves, good reserves); only the species differs.
    const tree = testTree();
    const hemlockCtx = testContext({ species: EASTERN_HEMLOCK, season: 'winter' });
    const oakCtx = testContext({ species: WHITE_OAK, season: 'winter' });
    const hemlockProd = photosynthesisForStep(tree, hemlockCtx);
    const oakProd = photosynthesisForStep(tree, oakCtx);
    // Deciduous oak in winter → photosynthesis returns 0 (winter dormancy).
    expect(oakProd).toBe(0);
    // Evergreen hemlock in winter → keeps photosynthesizing (conditions good).
    expect(hemlockProd).toBeGreaterThan(0);
  });

  it('DR-4 contrast: hemlock is height-focused + slender vs oak girth-heavy + stout', () => {
    // Hemlock allocates more to height (0.55 vs oak's 0.40) + is more slender.
    expect(EASTERN_HEMLOCK.heightDiameterSplit).toBeGreaterThan(WHITE_OAK.heightDiameterSplit);
    expect(EASTERN_HEMLOCK.maxSlendernessRatio).toBeGreaterThan(WHITE_OAK.maxSlendernessRatio);
    // Both within DR-4 schema bounds.
    expect(EASTERN_HEMLOCK.heightDiameterSplit).toBeGreaterThanOrEqual(0);
    expect(EASTERN_HEMLOCK.heightDiameterSplit).toBeLessThanOrEqual(1);
    expect(EASTERN_HEMLOCK.maxSlendernessRatio).toBeGreaterThan(0);
  });

  it('cold-tolerance contrast: hemlock photosynthesizes at colder temperatures than oak', () => {
    // Hemlock minimum temp 0°C vs oak 5°C. At 3°C, the oak stops but the
    // hemlock continues (part of the evergreen winter contrast).
    expect(EASTERN_HEMLOCK.temperatureRange.minimum).toBeLessThan(WHITE_OAK.temperatureRange.minimum);
    expect(EASTERN_HEMLOCK.temperatureRange.minimum).toBe(0);
    expect(WHITE_OAK.temperatureRange.minimum).toBe(5);
  });
});
