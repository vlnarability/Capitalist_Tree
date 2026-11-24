/**
 * W57 — WCAG 2.1 AA contrast regression test for the dynamic palette.
 *
 * Pins the fix for the pre-W57 contrast collapse: the linear RGB lerp between
 * a dark-bg/light-text endpoint (brutalist) and a light-bg/dark-text endpoint
 * (floral) drove text-ink-on-parchment to ~1.29:1 at score 5 (WCAG AA needs
 * 4.5:1). The W57 fix keeps bg in the cream range + text dark at BOTH
 * endpoints, so they never converge.
 *
 * This test computes the WCAG contrast ratio for every text token on the
 * parchment background at every integer score (0-10) + asserts each passes:
 *   - ink / ink-2 / ink-soft: ≥ 4.5:1 (used for normal + small text)
 *   - brass-2 / leaf-dark: ≥ 3.0:1 (used for large / bold text only)
 *
 * If a future palette change regresses contrast, this test fails before the
 * code ships.
 */
import { describe, it, expect } from 'vitest';
import { interpolatePalette, PALETTE_TOKENS } from '../../../lib/aesthetic/palette';

/** sRGB channel → linear luminance (WCAG 2.1 §1.4.3). */
function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of an "R G B" triple string. */
function relativeLuminance(triple: string): number {
  const [r, g, b] = triple.split(' ').map(Number);
  return 0.2126 * srgbToLinear(r ?? 0) + 0.7152 * srgbToLinear(g ?? 0) + 0.0722 * srgbToLinear(b ?? 0);
}

/** WCAG contrast ratio between two "R G B" triple strings. */
function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Parse a palette var value ("R G B") from the interpolatePalette output. */
function token(p: Record<string, string>, name: string): string {
  return p[`--ct-${name}`] ?? '0 0 0';
}

describe('W57 — WCAG 2.1 AA contrast at every score (regression guard)', () => {
  // Tokens used for normal + small text (10-11px labels) → need 4.5:1.
  const NORMAL_TEXT_TOKENS = ['ink', 'ink-2', 'ink-soft'] as const;
  // Tokens used only for large / bold text (text-2xl, font-bold) → need 3:1.
  const LARGE_TEXT_TOKENS = ['brass-2', 'leaf-dark'] as const;
  const AA_NORMAL = 4.5;
  const AA_LARGE = 3.0;

  it('PALETTE_TOKENS includes all tokens we test', () => {
    // Guard: if a token is renamed, these tests must be updated, not silently
    // skipped.
    for (const t of [...NORMAL_TEXT_TOKENS, ...LARGE_TEXT_TOKENS]) {
      expect(PALETTE_TOKENS).toContain(t);
    }
  });

  for (let score = 0; score <= 10; score++) {
    it(`score ${score}: normal-text tokens ≥ 4.5:1 on parchment`, () => {
      const p = interpolatePalette(score);
      const bg = token(p, 'parchment');
      for (const tok of NORMAL_TEXT_TOKENS) {
        const ratio = contrastRatio(token(p, tok), bg);
        expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL);
      }
    });

    it(`score ${score}: large-text tokens ≥ 3.0:1 on parchment`, () => {
      const p = interpolatePalette(score);
      const bg = token(p, 'parchment');
      for (const tok of LARGE_TEXT_TOKENS) {
        const ratio = contrastRatio(token(p, tok), bg);
        expect(ratio).toBeGreaterThanOrEqual(AA_LARGE);
      }
    });
  }
});
