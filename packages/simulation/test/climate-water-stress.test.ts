/**
 * Tests for `computeClimateWaterStressFactor` (GAP-17 / DR-11 — Phase 3 deferred
 * follow-up (a): the climate-level water-stress Liebig factor).
 *
 * Covers:
 *   - The default (White Oak in temperate) has factor 1 (supply ≈ demand → no
 *     stress → the biology tests' baseline is unchanged).
 *   - The date palm in BWh (native, low precip) has factor < 1 (the regional
 *     drought shows at the tree level — the gap the deferred task closes).
 *   - The date palm in Af (high precip) has factor 1 (plenty of water).
 *   - Native discount: a native species in a low-precip climate has a higher
 *     factor (less stress) than a non-native species with the same demand.
 *   - A sapling (low foliage → low demand) has less stress than a mature tree.
 *
 * Robust to exact calibration: asserts bounds + relative ordering. The
 * date-palm waterRequirement is defaulted to `maximumHeight × 2` = 42 L/day.
 */
import { describe, it, expect } from 'vitest';
import { computeClimateWaterStressFactor } from '../src/biology/photosynthesis.js';
import { WHITE_OAK, DATE_PALM, findClimateById } from '@capitalist-tree/content';

describe('GAP-17 Phase 3 deferred (a) — climate-water-stress Liebig factor', () => {
  it('the default (white oak in temperate, native) has factor 1 (supply ≈ demand → no stress)', () => {
    const temperate = findClimateById('climate:temperate')!;
    expect(WHITE_OAK.nativeKoppenCodes).toContain('Dfb'); // native to the default zone
    // Mature white oak demand = waterRequirement 50 L/day.
    const f = computeClimateWaterStressFactor(WHITE_OAK, temperate, 50);
    expect(f).toBe(1); // (750/365) × 25 = 51.4 ≥ 50 → no stress
  });

  it('the date palm in BWh (native, low precip) has factor < 1 — the regional drought shows at the tree level', () => {
    const bwh = findClimateById('climate:bwh')!;
    expect(DATE_PALM.nativeKoppenCodes).toContain('BWh'); // native (drought-tolerant)
    // Mature date palm demand = maximumHeight × 2 = 42 L/day.
    const f = computeClimateWaterStressFactor(DATE_PALM, bwh, 42);
    expect(f).toBeLessThan(1); // supply (100/365)×25 = 6.85 < 42 → stress
    // But native-tolerated → a MILD penalty (~0.83), not death.
    expect(f).toBeGreaterThan(0.5);
  });

  it('the date palm in Af (high precip) has factor 1 (plenty of water)', () => {
    const af = findClimateById('climate:af')!;
    // Non-native to Af, but the precip (2400 mm/yr) far exceeds demand → no stress.
    const f = computeClimateWaterStressFactor(DATE_PALM, af, 42);
    expect(f).toBe(1); // (2400/365) × 25 = 164 ≫ 42 → no stress
  });

  it('the BWh date palm factor is lower than the Af date palm factor (climate matters)', () => {
    const bwh = findClimateById('climate:bwh')!;
    const af = findClimateById('climate:af')!;
    const bwhF = computeClimateWaterStressFactor(DATE_PALM, bwh, 42);
    const afF = computeClimateWaterStressFactor(DATE_PALM, af, 42);
    expect(bwhF).toBeLessThan(afF);
  });

  it('native discount: a native species in a low-precip climate has less stress than a non-native with the same demand', () => {
    const bwh = findClimateById('climate:bwh')!;
    // Date palm is native to BWh → discounted stress.
    const nativeF = computeClimateWaterStressFactor(DATE_PALM, bwh, 42);
    // White oak (non-native to BWh) with the SAME demand 42 → full base stress.
    const nonNativeF = computeClimateWaterStressFactor(WHITE_OAK, bwh, 42);
    expect(WHITE_OAK.nativeKoppenCodes).not.toContain('BWh');
    expect(nativeF).toBeGreaterThan(nonNativeF); // native tolerates more
  });

  it('a sapling (low foliage → low demand) has less stress than a mature tree in the same climate', () => {
    const bwh = findClimateById('climate:bwh')!;
    // Mature date palm: demand 42. Sapling: demand 10 (low foliage).
    const matureF = computeClimateWaterStressFactor(DATE_PALM, bwh, 42);
    const saplingF = computeClimateWaterStressFactor(DATE_PALM, bwh, 10);
    expect(saplingF).toBeGreaterThan(matureF); // low demand → less stress
  });

  it('zero demand → factor 1 (no stress, no division-by-zero)', () => {
    const bwh = findClimateById('climate:bwh')!;
    expect(computeClimateWaterStressFactor(DATE_PALM, bwh, 0)).toBe(1);
  });
});
