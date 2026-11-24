/**
 * Sustainability score tests (W51).
 *
 * The score is a stewardship-balance metric anchored so the PRISTINE initial
 * state = 5 (balanced midpoint). These fixtures mirror the initial-state.ts
 * values (health 1, resilience/biodiversity 0.8, soil/air 1, 50 leaves, zero
 * extraction) so the "pristine = 5" assertion is meaningful.
 */
import { describe, it, expect } from 'vitest';
import { computeSustainabilityScore } from '../../../lib/aesthetic/score';
import type { GameState } from '@capitalist-tree/shared';

/** Minimal GameState fixture — only the fields the score reads. */
function makeState(opts: {
  leaves?: number;
  leafCapacity?: number;
  health?: number;
  resilience?: number;
  biodiversity?: number;
  soilHealth?: number;
  airQuality?: number;
  contamination?: number;
  degraded?: number;
}): GameState {
  return {
    originalTree: {
      foliage: { currentLeaves: opts.leaves ?? 50, leafCapacity: opts.leafCapacity ?? 200 },
      health: opts.health ?? 1,
    },
    world: {
      environment: {
        ecosystemResilience: opts.resilience ?? 0.8,
        biodiversity: { index: opts.biodiversity ?? 0.8 },
        soil: { health: opts.soilHealth ?? 1, contamination: opts.contamination ?? 0 },
        airQuality: opts.airQuality ?? 1,
        landUse: { developed: 0, degraded: opts.degraded ?? 0, protected: 0 },
      },
    },
  } as unknown as GameState;
}

describe('computeSustainabilityScore (W51)', () => {
  it('pristine untouched sapling = 5 (balanced midpoint, the starting state)', () => {
    expect(computeSustainabilityScore(makeState({}))).toBe(5);
  });

  it('full lush canopy + pristine ecology = 10 (full sustainability)', () => {
    expect(computeSustainabilityScore(makeState({ leaves: 200 }))).toBe(10);
  });

  it('over-harvested canopy below the sapling start drops below 5', () => {
    expect(computeSustainabilityScore(makeState({ leaves: 0 }))).toBeLessThan(5);
  });

  it('total ecological collapse = 0', () => {
    expect(
      computeSustainabilityScore(
        makeState({
          leaves: 0,
          health: 0,
          resilience: 0,
          biodiversity: 0,
          soilHealth: 0,
          airQuality: 0,
          contamination: 1,
          degraded: 1,
        }),
      ),
    ).toBe(0);
  });

  it('canopy growth is monotonic (more leaves → higher score, pristine eco)', () => {
    const s50 = computeSustainabilityScore(makeState({ leaves: 50 }));
    const s100 = computeSustainabilityScore(makeState({ leaves: 100 }));
    const s200 = computeSustainabilityScore(makeState({ leaves: 200 }));
    expect(s50).toBeLessThan(s100);
    expect(s100).toBeLessThan(s200);
  });

  it('ecological damage lowers the score (full canopy, degraded eco)', () => {
    const pristine = computeSustainabilityScore(makeState({ leaves: 200 }));
    const degraded = computeSustainabilityScore(
      makeState({
        leaves: 200,
        health: 0.3,
        soilHealth: 0.3,
        airQuality: 0.3,
        degraded: 0.5,
      }),
    );
    expect(degraded).toBeLessThan(pristine);
  });

  it('clamps to [0, 10]', () => {
    // way over (impossible leaves) → clamps to 10
    expect(computeSustainabilityScore(makeState({ leaves: 9999 }))).toBe(10);
    // way under → clamps to 0
    expect(
      computeSustainabilityScore(
        makeState({ leaves: -100, health: -5, soilHealth: -5, airQuality: -5 }),
      ),
    ).toBe(0);
  });

  it('returns an integer (0–10), never a float', () => {
    const s = computeSustainabilityScore(makeState({ leaves: 75 }));
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(10);
  });
});
