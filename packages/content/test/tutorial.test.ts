/**
 * Tutorial content tests (GAP-33 — content/tutorial).
 *
 * Pins the tutorial contract: a non-empty title + intro + an ordered list of
 * core-loop tips, each well-formed (heading + a real body sentence).
 */
import { describe, it, expect } from 'vitest';
import { getTutorial } from '../src/index.js';

describe('tutorial content (GAP-33 — first-time onboarding)', () => {
  it('exposes a title + intro + at least four core-loop tips', () => {
    const t = getTutorial();
    expect(t.title.length).toBeGreaterThan(0);
    expect(t.intro.length).toBeGreaterThan(20);
    expect(t.tips.length).toBeGreaterThanOrEqual(4);
  });

  it('every tip has a non-empty heading + a real body (1+ sentences)', () => {
    const t = getTutorial();
    for (const tip of t.tips) {
      expect(tip.heading.length).toBeGreaterThan(0);
      expect(tip.body.length).toBeGreaterThan(20);
    }
  });

  it('tip headings are unique', () => {
    const t = getTutorial();
    const headings = t.tips.map((tip) => tip.heading);
    expect(new Set(headings).size).toBe(headings.length);
  });

  it('getTutorial is stable (same content across calls)', () => {
    const a = getTutorial();
    const b = getTutorial();
    expect(a).toEqual(b);
  });
});
