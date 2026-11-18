/**
 * Endings content tests (GAP-36 — content/endings).
 *
 * Pins the ENDINGS contract: 6 endings (one per GDD §12 objective), each
 * well-formed with a unique id, + getEnding round-trips. The EndingId union
 * must match the simulation's OBJECTIVE_IDS (same six id strings) so an
 * ObjectiveId value is assignable to EndingId without a mapping step —
 * verified here against a hardcoded expected set (content cannot import from
 * simulation, so the canonical ids are inlined).
 */
import { describe, it, expect } from 'vitest';
import {
  ENDINGS_LIST,
  ENDING_IDS,
  getEnding,
  type EndingId,
} from '../src/index.js';

const EXPECTED_IDS: readonly EndingId[] = [
  'wealthiest-being',
  'great-restoration',
  'last-tree',
  'natural-balance',
  'industrial-empire',
  'generational-legacy',
];

describe('endings content (GAP-36 — GDD §12)', () => {
  it('exposes exactly the six GDD §12 endings in order', () => {
    expect(ENDING_IDS).toEqual(EXPECTED_IDS);
    expect(ENDINGS_LIST.map((e) => e.id)).toEqual(EXPECTED_IDS);
  });

  it('every ending is well-formed with a non-empty title/objective/epilogue', () => {
    for (const e of ENDINGS_LIST) {
      expect(e.id).toBeTruthy();
      expect(e.title.length).toBeGreaterThan(0);
      expect(e.objective.length).toBeGreaterThan(0);
      expect(e.epilogue.length).toBeGreaterThan(0);
      expect(e.epilogue.split('. ').length).toBeGreaterThanOrEqual(2); // 2+ sentences
      expect([
        'triumph',
        'restoration',
        'desolation',
        'balance',
        'industry',
        'legacy',
      ]).toContain(e.tone);
    }
  });

  it('every ending id is unique + every tone is unique (one accent per ending)', () => {
    expect(new Set(ENDINGS_LIST.map((e) => e.id)).size).toBe(ENDINGS_LIST.length);
    expect(new Set(ENDINGS_LIST.map((e) => e.tone)).size).toBe(ENDINGS_LIST.length);
  });

  it('getEnding round-trips each id + matches ENDINGS_LIST', () => {
    for (const expected of ENDINGS_LIST) {
      const got = getEnding(expected.id);
      expect(got).toBe(expected);
    }
  });

  it('getEnding throws for an unknown id', () => {
    expect(() => getEnding('not-an-ending' as EndingId)).toThrow(/unknown ending id/);
  });
});
