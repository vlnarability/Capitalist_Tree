/**
 * Non-color aesthetic interpolation tests (W52).
 *
 * Covers `interpolateRadius` (corner radius: 0 → 0.25rem across score 0–10)
 * and `canopyDensityScale` (drawn-canopy density factor: 0.7 → 1.0). Both
 * share W51's no-regression invariant: at score 10 (full sustainability) the
 * values reproduce the pre-W52 look — radius = 0.25rem (the Tailwind `rounded`
 * DEFAULT base, so every remapped radius token resolves to its original
 * Tailwind value) and canopy scale = 1.0 (drawn canopy = real density, no
 * inflation). The score=5 midpoint radius asserted here MUST match the
 * `--ct-radius` `:root` default in globals.css so SSR matches the hook's first
 * client write (no theme flash on hydration).
 */
import { describe, it, expect } from 'vitest';
import {
  interpolateRadius,
  canopyDensityScale,
  RADIUS_BRUTALIST,
  RADIUS_FLORAL,
  CANOPY_SCALE_BRUTALIST,
  CANOPY_SCALE_FLORAL,
} from '../../../lib/aesthetic/geometry';

describe('interpolateRadius (W52)', () => {
  it('score 0 = brutalist endpoint (sharp: "0rem")', () => {
    expect(interpolateRadius(0)).toBe('0rem');
  });

  it('score 10 = floral endpoint = 0.25rem (Tailwind DEFAULT base, no regression)', () => {
    // 0.25rem is Tailwind's `rounded` DEFAULT — at this base every remapped
    // radius token (sm/md/lg/xl/2xl/3xl) resolves to its original Tailwind
    // value, so the floral end matches the pre-W52 look exactly.
    expect(interpolateRadius(10)).toBe('0.25rem');
  });

  it('score 5 = the :root default in globals.css ("0.125rem", no SSR flash)', () => {
    expect(interpolateRadius(5)).toBe('0.125rem');
  });

  it('is monotonic non-decreasing across the 0–10 range', () => {
    for (let i = 0; i < 10; i++) {
      const a = Number(interpolateRadius(i).replace('rem', ''));
      const b = Number(interpolateRadius(i + 1).replace('rem', ''));
      expect(a).toBeLessThanOrEqual(b);
    }
  });

  it('clamps below 0 to the brutalist endpoint', () => {
    expect(interpolateRadius(-5)).toBe(interpolateRadius(0));
    expect(interpolateRadius(-5)).toBe(`${RADIUS_BRUTALIST}rem`);
  });

  it('clamps above 10 to the floral endpoint', () => {
    expect(interpolateRadius(15)).toBe(interpolateRadius(10));
    expect(interpolateRadius(15)).toBe(`${RADIUS_FLORAL}rem`);
  });

  it('intermediate scores produce values strictly between the endpoints', () => {
    const mid = Number(interpolateRadius(5).replace('rem', ''));
    expect(mid).toBeGreaterThan(RADIUS_BRUTALIST);
    expect(mid).toBeLessThan(RADIUS_FLORAL);
  });
});

describe('canopyDensityScale (W52)', () => {
  it('score 0 = brutalist endpoint (0.7 — drawn canopy 30% sparser than real)', () => {
    expect(canopyDensityScale(0)).toBe(CANOPY_SCALE_BRUTALIST);
    expect(canopyDensityScale(0)).toBe(0.7);
  });

  it('score 10 = floral endpoint (1.0 — drawn canopy = real density, no inflation)', () => {
    expect(canopyDensityScale(10)).toBe(CANOPY_SCALE_FLORAL);
    expect(canopyDensityScale(10)).toBe(1.0);
  });

  it('score 5 = midpoint (0.85)', () => {
    expect(canopyDensityScale(5)).toBeCloseTo(0.85, 10);
  });

  it('is monotonic non-decreasing across the 0–10 range', () => {
    for (let i = 0; i < 10; i++) {
      expect(canopyDensityScale(i)).toBeLessThanOrEqual(canopyDensityScale(i + 1));
    }
  });

  it('clamps below 0 to the brutalist endpoint', () => {
    expect(canopyDensityScale(-5)).toBe(canopyDensityScale(0));
  });

  it('clamps above 10 to the floral endpoint', () => {
    expect(canopyDensityScale(15)).toBe(canopyDensityScale(10));
  });

  it('never exceeds 1.0 (the canopy is never drawn fuller than reality)', () => {
    // The no-inflation invariant: across the full valid range + beyond, the
    // scale stays ≤ 1.0 so the drawn canopy can only be thinned, never inflated.
    for (let s = -5; s <= 15; s++) {
      expect(canopyDensityScale(s)).toBeLessThanOrEqual(1.0);
    }
  });

  it('never drops below the brutalist floor (0.7)', () => {
    for (let s = -5; s <= 15; s++) {
      expect(canopyDensityScale(s)).toBeGreaterThanOrEqual(CANOPY_SCALE_BRUTALIST);
    }
  });
});
