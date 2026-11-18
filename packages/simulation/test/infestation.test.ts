/**
 * P12-B (GAP-18): pest + disease infestations — regression tests.
 *
 * The infestation mechanism (biology/infestation.ts) rolls for pest + disease
 * each tick via a dedicated RNG fork; when one takes hold, a `pest`/`disease`
 * damage record is appended to `tree.damage` + an `infestation` event is
 * emitted. The existing damage-stress path (STRESS_DAMAGE_PER_DAY ×
 * activeDamage × stepDays) + the age-based prune handle the rest.
 *
 * The unit tests call `rollInfestation` directly with a controlled stepDays
 * (stepDays=100 forces both infestations — the per-tick probability = rate ×
 * stepDays exceeds 1.0) so they're deterministic + fast. The integration test
 * runs a 60-day idle sim (the infestation rates are ~0.035/day → ~2 records
 * over 60 days) + asserts the infestations actually fire end-to-end + drive
 * the stress toward the neglect death.
 */
import { describe, it, expect } from 'vitest';
import { engine, DEFAULT_GAME_CONFIG, Rng } from '../src/index.js';
import { rollInfestation } from '../src/biology/infestation.js';
import {
  PROVISIONAL_BIOLOGY_INFESTATION_SEVERITY_MIN,
  PROVISIONAL_BIOLOGY_INFESTATION_SEVERITY_MAX,
} from '@capitalist-tree/shared';

const DAY = 86400;

describe('P12-B infestation — rollInfestation (unit)', () => {
  it('with stepDays=100 (forces both): produces a pest + a disease damage record', () => {
    // stepDays=100 → pest prob = 0.02×100 = 2.0 > 1 (always), disease prob =
    // 0.015×100 = 1.5 > 1 (always). Both fire.
    const rng = Rng.fromSeed(1);
    const ctx = { now: 1_000_000 };
    const damage = rollInfestation(true, ctx, rng, 100);
    expect(damage).toHaveLength(2);
    const pest = damage.find((d) => d.type === 'pest');
    const disease = damage.find((d) => d.type === 'disease');
    expect(pest).toBeDefined();
    expect(disease).toBeDefined();
    // appliedAt = ctx.now (an integer — the schema requires .int()).
    expect(pest!.appliedAt).toBe(1_000_000);
    expect(disease!.appliedAt).toBe(1_000_000);
    // Severity in [MIN, MAX].
    for (const d of damage) {
      expect(d.severity).toBeGreaterThanOrEqual(PROVISIONAL_BIOLOGY_INFESTATION_SEVERITY_MIN);
      expect(d.severity).toBeLessThanOrEqual(PROVISIONAL_BIOLOGY_INFESTATION_SEVERITY_MAX);
    }
  });

  it('pests are gated on foliage (hasFoliage=false → disease only, no pest)', () => {
    const rng = Rng.fromSeed(2);
    const damage = rollInfestation(false, { now: 0 }, rng, 100);
    // stepDays=100 forces disease (always); pest is gated off (no foliage).
    expect(damage).toHaveLength(1);
    expect(damage[0].type).toBe('disease');
  });

  it('stepDays=0 produces no damage records (no time elapsed → no roll fires)', () => {
    const rng = Rng.fromSeed(3);
    const damage = rollInfestation(true, { now: 0 }, rng, 0);
    expect(damage).toHaveLength(0);
  });

  it('is deterministic given the same RNG seed (TDD §18.3)', () => {
    const ctx = { now: 500 };
    const a = rollInfestation(true, ctx, Rng.fromSeed(42), 1);
    const b = rollInfestation(true, ctx, Rng.fromSeed(42), 1);
    expect(a).toEqual(b);
  });
});

describe('P12-B infestation — BiologySystem integration (60-day idle)', () => {
  it('pest/disease damage records accumulate + drive stress toward the neglect death', () => {
    // The infestation rates (~0.035/day) + the weather damage (~0.09/day)
    // accumulate damage records over ~45-60 days. Once activeDamage > 2, the
    // damage stress (0.05 × activeDamage) exceeds the recovery rate (0.1/day)
    // + stress climbs to critical. This is the neglect-death mechanism that was
    // MISSING before P12-B (the idle tree sustained itself indefinitely).
    const s = engine.initialize({ ...DEFAULT_GAME_CONFIG, seed: 42, createdAt: 0 });
    const r: any = engine.advance(s, 60 * DAY);
    const t = r.state.originalTree;
    const pest = t.damage.filter((d: any) => d.type === 'pest').length;
    const disease = t.damage.filter((d: any) => d.type === 'disease').length;
    // At least one pest or disease infestation fired over 60 days.
    expect(pest + disease).toBeGreaterThan(0);
    // The infestation events were emitted.
    const infestationEvents = r.events.filter((e: any) => e.type === 'infestation');
    expect(infestationEvents.length).toBeGreaterThan(0);
    // Each event has the right payload shape.
    const first = infestationEvents[0];
    expect(['pest', 'disease']).toContain(first.payload.kind);
    expect(first.payload.severity).toBeGreaterThanOrEqual(0);
    expect(first.payload.severity).toBeLessThanOrEqual(1);
    // The accumulated damage drove the stress above 0 (the neglect-death
    // trajectory — pre-P12-B the idle tree stayed at stress=0 indefinitely).
    expect(t.stress).toBeGreaterThan(0);
  });
});
