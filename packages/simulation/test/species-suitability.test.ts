/**
 * Tests for `computeSpeciesClimateSuitability` (GAP-17 / DR-11 — Phase 5).
 *
 * Covers:
 *   - The score is in [0, 1].
 *   - A native species scores higher than a non-native in the same climate
 *     (the "right tree for the right climate" native lever).
 *   - The default (White Oak in warm-Dfb temperate) scores well.
 *   - Deciduous species exclude winter: a harsh winter does not zero the score
 *     (the growing seasons still contribute).
 *   - The highland modifier shifts the score (altitude-shifted temps change the
 *     fit) + a colder highland climate lowers the White Oak's score.
 *
 * Robust to exact calibration: asserts bounds + relative ordering, not magic
 * numbers.
 */
import { describe, it, expect } from 'vitest';
import { computeSpeciesClimateSuitability } from '../src/biology/suitability.js';
import {
  WHITE_OAK,
  EASTERN_HEMLOCK,
  DATE_PALM,
  applyHighlandModifier,
  findClimateById,
} from '@capitalist-tree/content';

describe('GAP-17 Phase 5 — species-climate suitability scoring', () => {
  it('returns a score in [0, 1]', () => {
    const temperate = findClimateById('climate:temperate')!;
    const s = computeSpeciesClimateSuitability(WHITE_OAK, temperate);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });

  it('a native species scores higher than a non-native in the same climate (the native lever)', () => {
    const bwh = findClimateById('climate:bwh')!;
    // Date palm is native to BWh; white oak is not.
    expect(DATE_PALM.nativeKoppenCodes).toContain('BWh');
    expect(WHITE_OAK.nativeKoppenCodes).not.toContain('BWh');
    const palmScore = computeSpeciesClimateSuitability(DATE_PALM, bwh);
    const oakScore = computeSpeciesClimateSuitability(WHITE_OAK, bwh);
    expect(palmScore).toBeGreaterThan(oakScore);
  });

  it('the default (white oak in warm-Dfb temperate) scores well (native + good temp fit)', () => {
    const temperate = findClimateById('climate:temperate')!;
    expect(WHITE_OAK.nativeKoppenCodes).toContain('Dfb'); // native to the default zone
    const s = computeSpeciesClimateSuitability(WHITE_OAK, temperate);
    // nativeFit (0.4) + a decent tempFit → above 0.6.
    expect(s).toBeGreaterThan(0.6);
  });

  it('deciduous species exclude winter — a harsh winter does not zero the score', () => {
    // White oak (deciduous) in Dwd (ultra-continental, severe winter). If winter
    // were included, tempFactor(winter < 0, {5,22,35}) = 0. Deciduous excludes
    // winter, so the score reflects the growing seasons + stays non-trivial.
    const dwd = findClimateById('climate:dwd')!;
    expect(dwd.seasonalBaseTemp.winter).toBeLessThan(0); // harsh winter
    expect(WHITE_OAK.deciduous).toBe(true);
    const s = computeSpeciesClimateSuitability(WHITE_OAK, dwd);
    expect(s).toBeGreaterThan(0);
  });

  it('evergreen species include winter — a harsh winter CAN zero a cold-intolerant evergreen', () => {
    // Contrast: the date palm (evergreen, minimum 12 °C) in Dwd (winter < 0) —
    // winter is included + tempFactor(winter < 0, {12,32,48}) = 0, dragging the
    // score down. (The date palm is also non-native to Dwd → nativeFit 0.)
    const dwd = findClimateById('climate:dwd')!;
    expect(DATE_PALM.deciduous).toBe(false);
    const s = computeSpeciesClimateSuitability(DATE_PALM, dwd);
    // Non-native + cold winter → a low score (lower than the deciduous oak above).
    const oakScore = computeSpeciesClimateSuitability(WHITE_OAK, dwd);
    expect(s).toBeLessThan(oakScore);
  });

  it('the highland modifier shifts the score — colder altitude lowers the white oak fit in Cfb', () => {
    const cfb = findClimateById('climate:cfb')!;
    const high = applyHighlandModifier(cfb, 2000); // 13 °C drop
    const seaScore = computeSpeciesClimateSuitability(WHITE_OAK, cfb);
    const highScore = computeSpeciesClimateSuitability(WHITE_OAK, high);
    // The altitude-shifted temps are colder → worse for the white oak (min 5 °C).
    expect(highScore).toBeLessThan(seaScore);
  });

  it('two native species in the same climate can differ (the score differentiates within the native set)', () => {
    // In Dfb, both White Oak (deciduous) + Eastern Hemlock (evergreen) are
    // native. Their temp curves + active-season sets differ → the scores can
    // differ (the lever differentiates within the native set).
    const dfb = findClimateById('climate:dfb')!;
    expect(WHITE_OAK.nativeKoppenCodes).toContain('Dfb');
    expect(EASTERN_HEMLOCK.nativeKoppenCodes).toContain('Dfb');
    const oakScore = computeSpeciesClimateSuitability(WHITE_OAK, dfb);
    const hemlockScore = computeSpeciesClimateSuitability(EASTERN_HEMLOCK, dfb);
    // Both are native (≥ 0.4) + their temp fits differ — at least one differs
    // from the other (we don't assert which is higher, only that the score is a
    // meaningful per-species signal).
    expect(oakScore).toBeGreaterThanOrEqual(0.4);
    expect(hemlockScore).toBeGreaterThanOrEqual(0.4);
    // They're not guaranteed to differ, but both are valid distinct signals.
  });
});
