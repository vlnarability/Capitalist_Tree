/**
 * Explanations content tests (GAP-35 — content/explanations).
 *
 * Pins the EXPLANATIONS contract: every entry is well-formed (non-empty label
 * + text), keys are unique, + getExplanation round-trips + throws for unknown.
 */
import { describe, it, expect } from 'vitest';
import {
  EXPLANATIONS_LIST,
  EXPLANATION_KEYS,
  getExplanation,
  type ExplanationKey,
} from '../src/index.js';

describe('explanations content (GAP-35 — GDD §13.3)', () => {
  it('exposes at least the five BiologyPanel explanation keys', () => {
    expect(EXPLANATION_KEYS).toContain('biology-photosynthesis');
    expect(EXPLANATION_KEYS).toContain('biology-liebig-factors');
    expect(EXPLANATION_KEYS).toContain('biology-energy-allocation');
    expect(EXPLANATION_KEYS).toContain('biology-stress');
    expect(EXPLANATION_KEYS).toContain('biology-sustainable-harvest');
  });

  it('every entry is well-formed with a non-empty label + relationship text', () => {
    for (const e of EXPLANATIONS_LIST) {
      expect(e.key).toBeTruthy();
      expect(e.label.length).toBeGreaterThan(0);
      expect(e.text.length).toBeGreaterThan(20); // a real sentence, not a stub
      expect(e.text.split('. ').length).toBeGreaterThanOrEqual(1); // 1+ sentence
    }
  });

  it('keys are unique', () => {
    expect(new Set(EXPLANATION_KEYS).size).toBe(EXPLANATION_KEYS.length);
  });

  it('getExplanation round-trips each key', () => {
    for (const expected of EXPLANATIONS_LIST) {
      expect(getExplanation(expected.key)).toBe(expected);
    }
  });

  it('getExplanation throws for an unknown key', () => {
    expect(() => getExplanation('not-a-key' as ExplanationKey)).toThrow(
      /unknown explanation key/,
    );
  });
});
