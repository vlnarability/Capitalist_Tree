/** Font-tier tests (W51). */
import { describe, it, expect } from 'vitest';
import { fontTierForScore, FONT_STACKS, TIER_LABELS } from '../../../lib/aesthetic/fonts';

describe('fontTierForScore (W51)', () => {
  it('score ≤ 3 = brutalist', () => {
    expect(fontTierForScore(0)).toBe('brutalist');
    expect(fontTierForScore(3)).toBe('brutalist');
  });

  it('score 4–6 = neutral', () => {
    expect(fontTierForScore(4)).toBe('neutral');
    expect(fontTierForScore(5)).toBe('neutral');
    expect(fontTierForScore(6)).toBe('neutral');
  });

  it('score > 6 = floral', () => {
    expect(fontTierForScore(7)).toBe('floral');
    expect(fontTierForScore(10)).toBe('floral');
  });
});

describe('FONT_STACKS + TIER_LABELS', () => {
  it('brutalist tier = monospace', () => {
    expect(FONT_STACKS.brutalist).toMatch(/monospace/);
  });

  it('neutral tier = sans-serif', () => {
    expect(FONT_STACKS.neutral).toMatch(/sans-serif/);
  });

  it('floral tier = the W48 Georgia-first serif (no regression at score 10)', () => {
    expect(FONT_STACKS.floral).toMatch(/^Georgia/);
  });

  it('tier labels (Exploitation / Balanced / Sustainability)', () => {
    expect(TIER_LABELS.brutalist).toBe('Exploitation');
    expect(TIER_LABELS.neutral).toBe('Balanced');
    expect(TIER_LABELS.floral).toBe('Sustainability');
  });
});
