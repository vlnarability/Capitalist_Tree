/**
 * Credits data tests (P13-C — content/credits).
 *
 * Pins the CREDITS contract: every entry is well-formed, every file lives under
 * /assets/, CC-BY entries carry an attribution line, and — critically — every
 * referenced asset file actually exists on disk under apps/web/public/assets/
 * (so the Credits screen + useAudio never point at a missing file).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CREDITS, ATTRIBUTION_LINES } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// From packages/content/test/ → repo root → apps/web/public.
const PUBLIC_DIR = resolve(__dirname, '../../../apps/web/public');

describe('credits — CREDITS data (P13-C)', () => {
  it('has at least one art + one audio asset', () => {
    expect(CREDITS.filter((c) => c.category === 'art').length).toBeGreaterThan(0);
    expect(CREDITS.filter((c) => c.category === 'audio').length).toBeGreaterThan(0);
  });

  it('every entry is well-formed + its file path is under /assets/', () => {
    for (const c of CREDITS) {
      expect(c.slot).toBeTruthy();
      expect(c.title).toBeTruthy();
      expect(c.author).toBeTruthy();
      expect(c.sourceUrl).toMatch(/^https:\/\//);
      expect(['CC0', 'CC-BY', 'CC-BY-SA']).toContain(c.license);
      expect(c.file.startsWith('/assets/')).toBe(true);
    }
  });

  it('CC-BY entries carry a non-empty attribution line', () => {
    for (const c of CREDITS) {
      if (c.license === 'CC-BY' || c.license === 'CC-BY-SA') {
        expect(c.attribution.length).toBeGreaterThan(0);
      }
    }
  });

  it('ATTRIBUTION_LINES matches the attribution-bearing entries', () => {
    const expected = CREDITS.filter((c) => c.attribution.length > 0).map((c) => c.attribution);
    expect(ATTRIBUTION_LINES).toEqual(expected);
    // At least the Kevin MacLeod CC-BY music line is present.
    expect(ATTRIBUTION_LINES.some((l) => l.includes('Kevin MacLeod'))).toBe(true);
  });

  it('every referenced asset file exists on disk under apps/web/public', () => {
    for (const c of CREDITS) {
      const abs = join(PUBLIC_DIR, c.file);
      // throws if missing — the failure message names the missing file.
      const stat = readFileSync(abs);
      expect(stat.length).toBeGreaterThan(0);
    }
  });

  it('no asset is AI-generated or emoji-as-art (policy: license in allowed set)', () => {
    // The license field is constrained to CC0/CC-BY/CC-BY-SA; no NC/ND. This
    // test documents the policy + guards against a future NC/ND addition.
    for (const c of CREDITS) {
      expect(c.license).not.toBe('CC-BY-NC');
      expect(c.license).not.toBe('CC-BY-ND');
    }
  });
});
