/**
 * W60 (RV4-F-L12) — trait-effects `default:` must throw, not silently skip.
 *
 * `applyTraitEffects` guards unknown ids via `getTraitById` (those are skipped).
 * The switch `default:` is therefore reachable ONLY by a trait id that IS a
 * known definition but has no effect case — i.e. a future trait added to the
 * definitions without being wired into the switch. That must throw loudly so
 * the gap surfaces in tests instead of shipping as a silently-no-op trait.
 *
 * Because all 7 currently-defined trait ids have explicit cases, the default
 * is unreachable with the real content module. This file mocks
 * `getTraitById` to recognise one synthetic id (`trait:test-unwired`) that
 * passes the guard but has no case, forcing the throw.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@capitalist-tree/content', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@capitalist-tree/content')>();
  return {
    ...actual,
    getTraitById: (id: string) =>
      id === 'trait:test-unwired'
        ? ({
            id,
            name: 'Test Unwired',
            description: '',
            benefit: '',
            tradeOff: '',
            category: 'growth',
          })
        : actual.getTraitById(id),
  };
});

import {
  applyTraitEffects,
  defaultBiologyParameters,
} from '../src/index.js';
import type { GeneticTraitState } from '@capitalist-tree/shared';

describe('applyTraitEffects — W60 default-throw invariant', () => {
  it('throws for a defined-but-unwired trait id', () => {
    const unwired: GeneticTraitState = {
      traitId: 'trait:test-unwired',
      active: true,
      generation: 1,
      magnitude: 1,
    };
    expect(() =>
      applyTraitEffects(defaultBiologyParameters(), [unwired]),
    ).toThrow(
      /applyTraitEffects: defined trait "trait:test-unwired" has no effect case/,
    );
  });

  it('still skips genuinely-unknown ids (getTraitById guard intact)', () => {
    // An id the mock does NOT recognise → getTraitById returns undefined →
    // skipped before the switch, no throw.
    expect(() =>
      applyTraitEffects(defaultBiologyParameters(), [
        { traitId: 'trait:truly-unknown', active: true, generation: 1, magnitude: 1 },
      ]),
    ).not.toThrow();
  });
});
