/**
 * Dynamic aesthetic palette tests (W51).
 *
 * Covers `interpolatePalette` (the 0–10 brutalist → floral interpolation),
 * `interpolateSteward` (the piecewise red → brass → green meter accent),
 * `lerpTriple`, and `cssVarName`. The score=5 midpoint values asserted here
 * MUST match the `:root` defaults in `apps/web/app/globals.css` so SSR renders
 * identically to the hook's first client write (no theme flash on hydration).
 */
import { describe, it, expect } from 'vitest';
import {
  interpolatePalette,
  interpolateSteward,
  lerpTriple,
  cssVarName,
  BRUTALIST,
  FLORAL,
  STEWARD_BRUTALIST,
  STEWARD_NEUTRAL,
  STEWARD_FLORAL,
} from '../../../lib/aesthetic/palette';

describe('interpolatePalette (W51)', () => {
  it('score 0 = brutalist endpoint (concrete / steel / yellowed)', () => {
    const p = interpolatePalette(0);
    expect(p['--ct-parchment']).toBe(BRUTALIST.parchment);
    expect(p['--ct-ink']).toBe(BRUTALIST.ink);
    expect(p['--ct-leaf']).toBe(BRUTALIST.leaf);
  });

  it('score 10 = floral endpoint (the W48 field-journal palette, no regression)', () => {
    const p = interpolatePalette(10);
    expect(p['--ct-parchment']).toBe(FLORAL.parchment);
    expect(p['--ct-ink']).toBe(FLORAL.ink);
    expect(p['--ct-brass']).toBe(FLORAL.brass);
  });

  it('score 5 = the :root defaults in globals.css (no SSR theme flash)', () => {
    const p = interpolatePalette(5);
    expect(p['--ct-parchment']).toBe('145 141 131');
    expect(p['--ct-ink']).toBe('129 121 113');
    expect(p['--ct-ink-soft']).toBe('138 130 114');
    expect(p['--ct-leaf']).toBe('114 122 58');
    expect(p['--ct-bark']).toBe('83 57 33');
    expect(p['--ct-brass']).toBe('106 82 34');
  });

  it('writes all 13 tokens', () => {
    const p = interpolatePalette(5);
    expect(Object.keys(p).length).toBe(13);
    for (const v of Object.values(p)) {
      expect(v).toMatch(/^\d+ \d+ \d+$/);
    }
  });

  it('interpolates monotonically (parchment lightens as score rises)', () => {
    const red = (s: number): number => {
      const v = interpolatePalette(s)['--ct-parchment'] ?? '0 0 0';
      return Number(v.split(' ')[0] ?? '0');
    };
    expect(red(0)).toBeLessThan(red(5));
    expect(red(5)).toBeLessThan(red(10));
  });

  it('clamps out-of-range scores to [0, 10]', () => {
    expect(interpolatePalette(-5)['--ct-parchment']).toBe(BRUTALIST.parchment);
    expect(interpolatePalette(99)['--ct-parchment']).toBe(FLORAL.parchment);
  });
});

describe('interpolateSteward (W51 — piecewise red → brass → green)', () => {
  it('score 0 = industrial red', () => {
    expect(interpolateSteward(0)).toBe(STEWARD_BRUTALIST);
  });

  it('score 5 = brass (neutral midpoint, not muddy brown)', () => {
    expect(interpolateSteward(5)).toBe(STEWARD_NEUTRAL);
  });

  it('score 10 = leaf green', () => {
    expect(interpolateSteward(10)).toBe(STEWARD_FLORAL);
  });

  it('midpoint is brass, NOT the linear average of red + green', () => {
    const linearMid = lerpTriple(STEWARD_BRUTALIST, STEWARD_FLORAL, 0.5);
    expect(interpolateSteward(5)).not.toBe(linearMid);
    expect(interpolateSteward(5)).toBe(STEWARD_NEUTRAL);
  });

  it('is monotonic across the whole range', () => {
    // green channel rises from red(38) → brass(133) → green(124).
    // It dips brass→green on G but R falls throughout; check R is monotonic.
    const r = (s: number): number => Number(interpolateSteward(s).split(' ')[0] ?? '0');
    expect(r(0)).toBeGreaterThan(r(5));
    expect(r(5)).toBeGreaterThan(r(10));
  });

  it('clamps to [0, 10]', () => {
    expect(interpolateSteward(-5)).toBe(STEWARD_BRUTALIST);
    expect(interpolateSteward(99)).toBe(STEWARD_FLORAL);
  });
});

describe('lerpTriple + cssVarName', () => {
  it('cssVarName maps a token to --ct-<token>', () => {
    expect(cssVarName('parchment')).toBe('--ct-parchment');
    expect(cssVarName('parchment-2')).toBe('--ct-parchment-2');
    expect(cssVarName('ink-soft')).toBe('--ct-ink-soft');
  });

  it('lerpTriple midpoint is the channel-wise average', () => {
    expect(lerpTriple('0 0 0', '100 100 100', 0.5)).toBe('50 50 50');
  });

  it('lerpTriple endpoints at t=0 and t=1', () => {
    expect(lerpTriple('10 20 30', '40 60 80', 0)).toBe('10 20 30');
    expect(lerpTriple('10 20 30', '40 60 80', 1)).toBe('40 60 80');
  });

  it('lerpTriple rounds to integers', () => {
    // 0 → 9 at t=0.5 = 4.5 → Math.round(4.5) = 5.
    expect(lerpTriple('0 0 0', '9 9 9', 0.5)).toBe('5 5 5');
  });
});
