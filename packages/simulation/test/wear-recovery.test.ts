/**
 * W59 — wear recovery (the fix for the W58 bot's tree-death-under-sustainable-
 * play finding).
 *
 * Pre-W59, `tree.wear` was strictly monotonic — it NEVER decayed. Ambient
 * pest/disease infestations added ~0.026 wear/day regardless of player care,
 * so even a perfectly-cared-for tree crossed the mortality onset (3.0) at
 * ~3-6mo + died. The W58 design-promise bot found the tree dies at day 85
 * under sustainable harvesting (30 leaves/28d + watering + compost).
 *
 * W59 adds `recoverWear` — a recovery path mirroring `updateStress`. When
 * conditions are favourable (water/nutrient/reserves OK) + there's been no
 * severe-defoliation in the last 7 days, wear decays at
 * PROVISIONAL_BIOLOGY_WEAR_RECOVERY_RATE_PER_DAY (0.04/day — exceeds the
 * ~0.026/day ambient infestation rate, so a cared-for tree nets out wear).
 */
import { describe, it, expect } from 'vitest';
import { recoverWear } from '../src/biology/wear.js';
import { testTree, testContext } from './_biology-helpers.js';
import {
  PROVISIONAL_BIOLOGY_WEAR_RECOVERY_RATE_PER_DAY,
  PROVISIONAL_BIOLOGY_WEAR_RECOVERY_PROPORTIONAL_FRACTION_PER_DAY,
  PROVISIONAL_BIOLOGY_WEAR_RECOVERY_ENERGY_COST,
} from '@capitalist-tree/shared';
import type { BiologyContext } from '../src/biology/types.js';

const DAY = 86_400;

describe('W59 — wear recovery', () => {
  it('decays wear when conditions are favourable + no recent severe-defoliation', () => {
    const tree = testTree({
      wear: 2.0,
      water: { stored: 50, capacity: 50 },
      energy: { reserves: 800, production: 0, consumption: 0 },
      damage: [],
    });
    const ctx = testContext({ stepSeconds: DAY }) as BiologyContext;
    const r = recoverWear(tree, ctx);
    // W78: hybrid recovery = max(flat rate, proportional fraction of wear).
    // At wear=2.0, 1 day: max(0.04, 2.0 × 0.05) = max(0.04, 0.1) = 0.1.
    const expectedDecay = Math.max(
      PROVISIONAL_BIOLOGY_WEAR_RECOVERY_RATE_PER_DAY,
      tree.wear * PROVISIONAL_BIOLOGY_WEAR_RECOVERY_PROPORTIONAL_FRACTION_PER_DAY,
    ); // 1 day
    expect(r.wear).toBeCloseTo(2.0 - expectedDecay, 5);
    expect(r.recoveryCost).toBeCloseTo(
      expectedDecay * PROVISIONAL_BIOLOGY_WEAR_RECOVERY_ENERGY_COST,
      5,
    );
  });

  it('does NOT decay wear when water is deficient', () => {
    const tree = testTree({
      wear: 2.0,
      water: { stored: 0, capacity: 50 }, // empty → waterF = 0
      energy: { reserves: 800, production: 0, consumption: 0 },
      damage: [],
    });
    const ctx = testContext({ stepSeconds: DAY }) as BiologyContext;
    const r = recoverWear(tree, ctx);
    expect(r.wear).toBe(2.0);
    expect(r.recoveryCost).toBe(0);
  });

  it('does NOT decay wear when reserves are critical', () => {
    const tree = testTree({
      wear: 2.0,
      water: { stored: 50, capacity: 50 },
      energy: { reserves: 1, production: 0, consumption: 0 }, // critical
      damage: [],
    });
    const ctx = testContext({ stepSeconds: DAY }) as BiologyContext;
    const r = recoverWear(tree, ctx);
    expect(r.wear).toBe(2.0);
    expect(r.recoveryCost).toBe(0);
  });

  it('does NOT decay wear when there is a recent severe-defoliation (within 7d)', () => {
    const now = 10 * DAY;
    const tree = testTree({
      wear: 2.0,
      water: { stored: 50, capacity: 50 },
      energy: { reserves: 800, production: 0, consumption: 0 },
      damage: [{ type: 'severe-defoliation', severity: 0.5, appliedAt: now - 3 * DAY }],
    });
    const ctx = testContext({ stepSeconds: DAY, now }) as BiologyContext;
    const r = recoverWear(tree, ctx);
    expect(r.wear).toBe(2.0);
    expect(r.recoveryCost).toBe(0);
  });

  it('DOES decay wear when the severe-defoliation is older than 7d', () => {
    const now = 30 * DAY;
    const tree = testTree({
      wear: 2.0,
      water: { stored: 50, capacity: 50 },
      energy: { reserves: 800, production: 0, consumption: 0 },
      damage: [{ type: 'severe-defoliation', severity: 0.5, appliedAt: now - 10 * DAY }],
    });
    const ctx = testContext({ stepSeconds: DAY, now }) as BiologyContext;
    const r = recoverWear(tree, ctx);
    expect(r.wear).toBeLessThan(2.0);
    expect(r.recoveryCost).toBeGreaterThan(0);
  });

  it('does NOT decay wear when the tree is dead', () => {
    const tree = testTree({
      wear: 2.0,
      alive: false,
      water: { stored: 50, capacity: 50 },
      energy: { reserves: 800, production: 0, consumption: 0 },
      damage: [],
    });
    const ctx = testContext({ stepSeconds: DAY }) as BiologyContext;
    const r = recoverWear(tree, ctx);
    expect(r.wear).toBe(2.0);
    expect(r.recoveryCost).toBe(0);
  });

  it('clamps wear to >= 0 (does not go negative)', () => {
    const tree = testTree({
      wear: 0.01, // less than one step's decay
      water: { stored: 50, capacity: 50 },
      energy: { reserves: 800, production: 0, consumption: 0 },
      damage: [],
    });
    const ctx = testContext({ stepSeconds: DAY }) as BiologyContext;
    const r = recoverWear(tree, ctx);
    expect(r.wear).toBe(0);
  });

  it('returns no-op when wear is already 0', () => {
    const tree = testTree({
      wear: 0,
      water: { stored: 50, capacity: 50 },
      energy: { reserves: 800, production: 0, consumption: 0 },
      damage: [],
    });
    const ctx = testContext({ stepSeconds: DAY }) as BiologyContext;
    const r = recoverWear(tree, ctx);
    expect(r.wear).toBe(0);
    expect(r.recoveryCost).toBe(0);
  });
});
