/**
 * Tests for `lib/format/tree.ts` (P5b).
 *
 * Covers:
 *   - `tierFromHealth` maps [0, 1] → healthy/stressed/critical/dead.
 *   - `tierFromStress` is the mirror (1 - stress) mapping.
 *   - `labelForTier` returns the full label + tone + hint.
 *   - `labelForTree` honours the `alive` flag.
 *   - `clampProgress` clamps + handles NaN.
 */
import { describe, it, expect } from 'vitest';
import {
  tierFromHealth,
  tierFromStress,
  labelForTier,
  labelForTree,
  clampProgress,
  PROVISIONAL_UI_TREE_HEALTHY_THRESHOLD,
  PROVISIONAL_UI_TREE_STRESSED_THRESHOLD,
  type ConditionTier,
} from '../../../lib/format/tree';

describe('tierFromHealth — [0, 1] health → tier', () => {
  it('returns "healthy" at or above the healthy threshold (0.7)', () => {
    expect(tierFromHealth(0.7)).toBe('healthy');
    expect(tierFromHealth(0.85)).toBe('healthy');
    expect(tierFromHealth(1.0)).toBe('healthy');
  });

  it('returns "stressed" between the stressed + healthy thresholds', () => {
    expect(tierFromHealth(0.69)).toBe('stressed');
    expect(tierFromHealth(0.5)).toBe('stressed');
    expect(tierFromHealth(0.3)).toBe('stressed');
  });

  it('returns "critical" between zero and the stressed threshold', () => {
    expect(tierFromHealth(0.29)).toBe('critical');
    expect(tierFromHealth(0.1)).toBe('critical');
    expect(tierFromHealth(0.01)).toBe('critical');
  });

  it('returns "dead" at or below zero', () => {
    expect(tierFromHealth(0)).toBe('dead');
    expect(tierFromHealth(-0.5)).toBe('dead');
  });

  it('returns "critical" for NaN (defensive — no crash)', () => {
    expect(tierFromHealth(Number.NaN)).toBe('critical');
  });

  it('returns "critical" for Infinity (defensive — no crash)', () => {
    expect(tierFromHealth(Number.POSITIVE_INFINITY)).toBe('critical');
    expect(tierFromHealth(Number.NEGATIVE_INFINITY)).toBe('critical');
  });

  it('thresholds match the documented PROVISIONAL constants', () => {
    expect(PROVISIONAL_UI_TREE_HEALTHY_THRESHOLD).toBe(0.7);
    expect(PROVISIONAL_UI_TREE_STRESSED_THRESHOLD).toBe(0.3);
  });
});

describe('tierFromStress — [0, 1] stress → tier (mirror of health)', () => {
  it('returns "healthy" for low stress (stress <= 0.3 since health=1-stress >= 0.7)', () => {
    expect(tierFromStress(0.0)).toBe('healthy');
    expect(tierFromStress(0.29)).toBe('healthy');
    expect(tierFromStress(0.3)).toBe('healthy'); // 1 - 0.3 = 0.7 = healthy
  });

  it('returns "stressed" for mid stress (0.3 < stress <= 0.7)', () => {
    expect(tierFromStress(0.31)).toBe('stressed');
    expect(tierFromStress(0.5)).toBe('stressed');
    expect(tierFromStress(0.69)).toBe('stressed');
    expect(tierFromStress(0.7)).toBe('stressed'); // 1 - 0.7 = 0.3 = stressed
  });

  it('returns "critical" for high stress (0.7 < stress < 1)', () => {
    expect(tierFromStress(0.71)).toBe('critical');
    expect(tierFromStress(0.9)).toBe('critical');
    expect(tierFromStress(0.99)).toBe('critical');
  });

  it('returns "dead" for stress >= 1', () => {
    expect(tierFromStress(1.0)).toBe('dead');
    expect(tierFromStress(1.5)).toBe('dead');
  });

  it('returns "critical" for NaN (defensive — no crash)', () => {
    expect(tierFromStress(Number.NaN)).toBe('critical');
  });

  it('mirrors tierFromHealth(1 - stress) for typical values', () => {
    for (const stress of [0, 0.2, 0.4, 0.5, 0.6, 0.8, 1.0]) {
      expect(tierFromStress(stress)).toBe(tierFromHealth(1 - stress));
    }
  });
});

describe('labelForTier — full label object', () => {
  const tiers: ConditionTier[] = ['healthy', 'stressed', 'critical', 'dead'];
  for (const tier of tiers) {
    it(`returns label for "${tier}" with a non-empty label + tone + hint`, () => {
      const l = labelForTier(tier);
      expect(l.tier).toBe(tier);
      expect(l.label.length).toBeGreaterThan(0);
      expect(l.tone.length).toBeGreaterThan(0);
      expect(l.hint.length).toBeGreaterThan(0);
    });
  }

  it('uses emerald tone for healthy, amber for stressed, rose for critical, slate for dead', () => {
    expect(labelForTier('healthy').tone).toBe('emerald');
    expect(labelForTier('stressed').tone).toBe('amber');
    expect(labelForTier('critical').tone).toBe('rose');
    expect(labelForTier('dead').tone).toBe('slate');
  });
});

describe('labelForTree — alive flag honoured', () => {
  it('returns the dead label when alive=false, regardless of stress', () => {
    const l = labelForTree(false, 0.0);
    expect(l.tier).toBe('dead');
    expect(l.tone).toBe('slate');

    // Even if stress is at 0 (which would otherwise map to "healthy"), the
    // alive flag is authoritative.
    expect(labelForTree(false, 0.0).tier).toBe('dead');
    expect(labelForTree(false, 0.5).tier).toBe('dead');
    expect(labelForTree(false, 1.0).tier).toBe('dead');
  });

  it('derives from stress when alive=true', () => {
    expect(labelForTree(true, 0.0).tier).toBe('healthy');
    expect(labelForTree(true, 0.5).tier).toBe('stressed');
    expect(labelForTree(true, 0.9).tier).toBe('critical');
  });

  it('returns the same object shape as labelForTier (tier + label + tone + hint)', () => {
    // 0.5 stress → 1 - 0.5 = 0.5 health → stressed
    const l = labelForTree(true, 0.5);
    expect(l).toEqual(labelForTier('stressed'));
  });
});

describe('clampProgress — defensive [0, 1] clamping', () => {
  it('passes through values in [0, 1]', () => {
    expect(clampProgress(0)).toBe(0);
    expect(clampProgress(0.5)).toBe(0.5);
    expect(clampProgress(1)).toBe(1);
  });

  it('clamps values above 1 to 1', () => {
    expect(clampProgress(1.5)).toBe(1);
    expect(clampProgress(2)).toBe(1);
    expect(clampProgress(1_000_000)).toBe(1);
  });

  it('clamps negative values to 0', () => {
    expect(clampProgress(-0.5)).toBe(0);
    expect(clampProgress(-1)).toBe(0);
  });

  it('returns 0 for NaN (defensive — no crash)', () => {
    expect(clampProgress(Number.NaN)).toBe(0);
  });

  it('returns 0 for Infinity (defensive — no crash)', () => {
    expect(clampProgress(Number.POSITIVE_INFINITY)).toBe(1);
    expect(clampProgress(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});
