/**
 * GAP-31 Phase 2 (DR-13) — sim-summary aggregation tests.
 *
 * Covers: extractSimSummary (the right fields are pulled + shaped), isSimSummaryDue
 * (cadence: first call → false, after a sim-day → true, backward clock → false).
 */
import { describe, it, expect } from 'vitest';
import {
  extractSimSummary,
  isSimSummaryDue,
  SIM_SUMMARY_CADENCE_SECONDS,
} from '../../../lib/analytics/sim-summary';
import type { GameState } from '@capitalist-tree/shared';

/** Build a minimal GameState fixture with only the fields extractSimSummary
 *  reads. Cast through unknown — the extractor doesn't touch the rest. */
function fixture(overrides?: {
  elapsedSeconds?: number;
  height?: number;
  health?: number;
  alive?: boolean;
  airQuality?: number;
  totalIssued?: string;
}): GameState {
  return {
    clock: { elapsedSeconds: overrides?.elapsedSeconds ?? 0 },
    originalTree: {
      alive: overrides?.alive ?? true,
      ageDays: 30,
      structure: {
        height: overrides?.height ?? 1.5,
        trunkDiameter: 0.2,
        branchDevelopment: 1,
        structuralIntegrity: 1,
      },
      health: overrides?.health ?? 0.9,
      energy: { reserves: 50, production: 0, consumption: 0 },
    },
    world: {
      environment: {
        airQuality: overrides?.airQuality ?? 0.95,
        oceanHealth: 0.9,
      },
    },
    economy: { totalIssued: overrides?.totalIssued ?? '50000' },
  } as unknown as GameState;
}

describe('extractSimSummary', () => {
  it('pulls tree growth + vitality + env + economy into a compact snapshot', () => {
    const summary = extractSimSummary(fixture({ elapsedSeconds: 86_400, height: 2.5, health: 0.8 }));
    expect(summary.elapsedSeconds).toBe(86_400);
    expect(summary.tree).toEqual({
      alive: true,
      ageDays: 30,
      height: 2.5,
      trunkDiameter: 0.2,
      health: 0.8,
      energyReserves: 50,
    });
    expect(summary.environment).toEqual({ airQuality: 0.95, oceanHealth: 0.9 });
    expect(summary.economy).toEqual({ totalIssued: '50000' });
  });

  it('captures a dead tree (alive=false)', () => {
    const summary = extractSimSummary(fixture({ alive: false, health: 0 }));
    expect(summary.tree).toMatchObject({ alive: false, health: 0 });
  });
});

describe('isSimSummaryDue', () => {
  it('returns false on the first call (null last) — seeds, does not emit', () => {
    expect(isSimSummaryDue(100, null)).toBe(false);
  });

  it('returns false when less than a sim-day has elapsed', () => {
    expect(isSimSummaryDue(100, 0)).toBe(false);
    expect(isSimSummaryDue(86_399, 0)).toBe(false);
  });

  it('returns true when a full sim-day has elapsed', () => {
    expect(isSimSummaryDue(SIM_SUMMARY_CADENCE_SECONDS, 0)).toBe(true);
    expect(isSimSummaryDue(2 * SIM_SUMMARY_CADENCE_SECONDS, 0)).toBe(true);
  });

  it('returns false + signals a re-seed when the clock went backward', () => {
    expect(isSimSummaryDue(50, 1000)).toBe(false);
  });

  it('honours a custom cadence', () => {
    expect(isSimSummaryDue(500, 0, 1000)).toBe(false);
    expect(isSimSummaryDue(1000, 0, 1000)).toBe(true);
  });
});
