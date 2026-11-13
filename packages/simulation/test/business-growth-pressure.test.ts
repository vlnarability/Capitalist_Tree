/**
 * Business growth-pressure tests (P8c — TDD §11, GDD §8.4 Growth Pressure:
 * inflation, debt/interest, shareholder expectations, competition).
 *
 * Asserts the four growth-pressure helpers drive their GDD §8.4 axes:
 *   - applyInflationPressure: operating costs (wageRate) rise with the
 *     economy's inflationIndex (read-only by business — TDD §10.6).
 *   - accrueDebtInterest: liabilities accrue interest into `accruedInterest`
 *     (NOT compounded into principal — P8c carry-forward #3) over multiple
 *     ticks.
 *   - applyShareholderExpectations: corporations underperforming →
 *     `shareholder-pressure` notification + valuation reduced; non-corporation
 *     ownership structures are unaffected.
 *   - applyCompetitionPressure: less-efficient businesses lose production rate
 *     when multiple businesses share an output market.
 *
 * All helpers are pure: they return new arrays + events; the input is never
 * mutated. Deterministic given the inputs.
 */
import { describe, it, expect } from 'vitest';
import {
  applyInflationPressure,
  accrueDebtInterest,
  applyShareholderExpectations,
  applyCompetitionPressure,
  createBusinessFromDefinition,
} from '../src/index.js';
import { WATER_EXTRACTION_PLANT } from '@capitalist-tree/content';
import {
  type BusinessState,
  type SimulationEvent,
} from '@capitalist-tree/shared';

const SECONDS_PER_DAY = 24 * 60 * 60;

/** Build a minimal operating business with the given overrides. */
function makeBusiness(overrides: Partial<BusinessState> = {}): BusinessState {
  return {
    ...createBusinessFromDefinition(
      WATER_EXTRACTION_PLANT,
      'business:test:0',
      'Test Plant',
    ),
    ...overrides,
    id: overrides.id ?? 'business:test:0',
  };
}

/** Find a shareholder-pressure notification event. */
function shareholderEvent(events: readonly SimulationEvent[]) {
  return events.find(
    (e) => e.type === 'notification' && e.payload.code === 'shareholder-pressure',
  );
}

/** Find a competition-pressure system event for a business. */
function competitionEvent(events: readonly SimulationEvent[], businessId: string) {
  return events.find(
    (e) =>
      e.type === 'system' &&
      e.payload.data?.kind === 'competition-pressure' &&
      e.payload.data?.businessId === businessId,
  );
}

// ---------------------------------------------------------------------------
// applyInflationPressure (GDD §8.4 inflation + labor costs)
// ---------------------------------------------------------------------------

describe('applyInflationPressure — operating costs rise with inflationIndex', () => {
  it('raises wageRate by floor(wageRate × (inflationIndex − 1) × passThrough × dtFraction)', () => {
    // WATER_EXTRACTION_PLANT wageRate = '400'. inflationIndex = 1.10 (10%
    // inflation). dtFraction = 1.0 (full day). passThrough = 1.0.
    // increase = floor(400 × 0.10 × 1.0 × 1.0) = floor(40) = 40.
    // newWageRate = 400 + 40 = 440.
    const business = makeBusiness({ wageRate: '400', status: 'operating' });
    const result = applyInflationPressure([business], 1.10, SECONDS_PER_DAY, 100);
    expect(result.businesses[0]!.wageRate).toBe('440');
    // A system event was emitted for the audit trail.
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.type).toBe('system');
    expect(result.events[0]!.payload.data?.kind).toBe('inflation-pressure');
  });

  it('leaves wageRate unchanged when inflationIndex <= 1.0 (no inflation)', () => {
    const business = makeBusiness({ wageRate: '400', status: 'operating' });
    const result = applyInflationPressure([business], 1.0, SECONDS_PER_DAY, 100);
    expect(result.businesses[0]!.wageRate).toBe('400');
    expect(result.events).toEqual([]);
  });

  it('skips non-operating businesses (idle / bankrupt businesses pay no wages)', () => {
    const operating = makeBusiness({ id: 'b:op', wageRate: '400', status: 'operating' });
    const idle = makeBusiness({ id: 'b:idle', wageRate: '400', status: 'idle' });
    const result = applyInflationPressure(
      [operating, idle],
      1.10,
      SECONDS_PER_DAY,
      100,
    );
    const op = result.businesses.find((b) => b.id === 'b:op')!;
    const idl = result.businesses.find((b) => b.id === 'b:idle')!;
    expect(op.wageRate).toBe('440'); // raised
    expect(idl.wageRate).toBe('400'); // unchanged
  });

  it('pro-rates the increase by dtFraction (half a day → half the increase)', () => {
    // Full day: increase = 40. Half day: increase = floor(400 × 0.10 × 1.0 ×
    // 0.5) = floor(20) = 20. newWageRate = 420.
    const business = makeBusiness({ wageRate: '400', status: 'operating' });
    const result = applyInflationPressure(
      [business],
      1.10,
      SECONDS_PER_DAY / 2,
      100,
    );
    expect(result.businesses[0]!.wageRate).toBe('420');
  });

  it('does not mutate the input business (purity)', () => {
    const business = makeBusiness({ wageRate: '400', status: 'operating' });
    const original = business.wageRate;
    applyInflationPressure([business], 1.10, SECONDS_PER_DAY, 100);
    expect(business.wageRate).toBe(original); // unchanged
  });
});

// ---------------------------------------------------------------------------
// accrueDebtInterest (GDD §8.4 debt and interest — P8c carry-forward #3)
// ---------------------------------------------------------------------------

describe('accrueDebtInterest — interest accrues into accruedInterest (NOT principal)', () => {
  it('accrues interest into accruedInterest, leaving principal unchanged', () => {
    // principal=100000, interestRate=0.05 (5%/year), dtSeconds=SECONDS_PER_DAY.
    // dtFraction = 86400 / (365 × 86400) = 1/365.
    // accrual = floor(100000 × 0.05 / 365) = floor(13.698) = 13.
    const business = makeBusiness({
      liabilities: [
        {
          id: 'liability:1',
          type: 'loan',
          principal: '100000',
          interestRate: 0.05,
          dueAt: 0,
          accruedInterest: '0',
        },
      ],
    });
    const result = accrueDebtInterest([business], SECONDS_PER_DAY);
    expect(result[0]!.liabilities[0]!.accruedInterest).toBe('13');
    expect(result[0]!.liabilities[0]!.principal).toBe('100000'); // unchanged
  });

  it('accumulates accruedInterest across multiple ticks (compounds into accruedInterest)', () => {
    const business = makeBusiness({
      liabilities: [
        {
          id: 'liability:1',
          type: 'loan',
          principal: '100000',
          interestRate: 0.05,
          dueAt: 0,
          accruedInterest: '0',
        },
      ],
    });
    // Two consecutive ticks: each accrues 13. Total = 26.
    const after1 = accrueDebtInterest([business], SECONDS_PER_DAY);
    const after2 = accrueDebtInterest(after1, SECONDS_PER_DAY);
    expect(after2[0]!.liabilities[0]!.accruedInterest).toBe('26');
    expect(after2[0]!.liabilities[0]!.principal).toBe('100000'); // still unchanged
  });

  it('preserves hand-set accruedInterest (adds to it, never resets)', () => {
    // A liability that already accrued 100 interest — the next tick adds 13.
    const business = makeBusiness({
      liabilities: [
        {
          id: 'liability:1',
          type: 'loan',
          principal: '100000',
          interestRate: 0.05,
          dueAt: 0,
          accruedInterest: '100',
        },
      ],
    });
    const result = accrueDebtInterest([business], SECONDS_PER_DAY);
    expect(result[0]!.liabilities[0]!.accruedInterest).toBe('113'); // 100 + 13
    expect(result[0]!.liabilities[0]!.principal).toBe('100000');
  });

  it('leaves zero-rate liabilities unchanged', () => {
    const business = makeBusiness({
      liabilities: [
        {
          id: 'l1',
          type: 'loan',
          principal: '100000',
          interestRate: 0,
          dueAt: 0,
          accruedInterest: '0',
        },
      ],
    });
    const result = accrueDebtInterest([business], SECONDS_PER_DAY);
    expect(result[0]!.liabilities[0]!.accruedInterest).toBe('0');
    expect(result[0]!.liabilities[0]!.principal).toBe('100000');
  });

  it('is a no-op for businesses with no liabilities', () => {
    const business = makeBusiness({ liabilities: [] });
    const result = accrueDebtInterest([business], SECONDS_PER_DAY);
    expect(result[0]!.liabilities).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// applyShareholderExpectations (GDD §8.4 shareholder expectations)
// ---------------------------------------------------------------------------

describe('applyShareholderExpectations — corporations underperforming', () => {
  /** Build a corporation (ownership.structure = 'corporation'). */
  function makeCorporation(overrides: Partial<BusinessState> = {}): BusinessState {
    return makeBusiness({
      ownership: {
        ownerId: 'player:personal',
        structure: 'corporation',
        share: 1,
      },
      ...overrides,
      id: overrides.id ?? 'business:corp:0',
    });
  }

  it('reduces valuation + emits shareholder-pressure when a corporation underperforms', () => {
    // A corporation with revenue=0, expenses=5000 (unprofitable). growthProxy
    // = 0 / (0 + 5000) = 0 < expected (0.001). shortfall = 0.001.
    // valuation = 75000. penalty = floor(75000 × 0.001 × 0.5 × 0.10) =
    // floor(3.75) = 3. newValuation = 75000 − 3 = 74997.
    const corp = makeCorporation({
      revenue: '0',
      expenses: '5000',
      valuation: '75000',
      status: 'operating',
    });
    const result = applyShareholderExpectations([corp], SECONDS_PER_DAY, 100);
    expect(result.businesses[0]!.valuation).toBe('74997');
    const ev = shareholderEvent(result.events);
    expect(ev).toBeDefined();
    expect(ev!.payload.severity).toBe('warning');
    expect(ev!.payload.code).toBe('shareholder-pressure');
  });

  it('leaves a profitable corporation unaffected (growthProxy >= expected)', () => {
    // revenue=10000, expenses=0 → growthProxy = 10000/10000 = 1.0 >= 0.001.
    // No penalty, no notification.
    const corp = makeCorporation({
      revenue: '10000',
      expenses: '0',
      valuation: '75000',
      status: 'operating',
    });
    const result = applyShareholderExpectations([corp], SECONDS_PER_DAY, 100);
    expect(result.businesses[0]!.valuation).toBe('75000'); // unchanged
    expect(shareholderEvent(result.events)).toBeUndefined();
  });

  it('does NOT affect non-corporation ownership structures', () => {
    // A sole-proprietorship with the same unprofitable profile — no
    // shareholder pressure (only corporations have shareholders).
    const soleProp = makeBusiness({
      revenue: '0',
      expenses: '5000',
      valuation: '75000',
      status: 'operating',
      ownership: {
        ownerId: 'player:personal',
        structure: 'sole-proprietorship',
        share: 1,
      },
    });
    const result = applyShareholderExpectations([soleProp], SECONDS_PER_DAY, 100);
    expect(result.businesses[0]!.valuation).toBe('75000'); // unchanged
    expect(shareholderEvent(result.events)).toBeUndefined();
  });

  it('skips non-operating corporations (a bankrupt corporation has no active shareholders)', () => {
    const corp = makeCorporation({
      revenue: '0',
      expenses: '5000',
      valuation: '75000',
      status: 'bankrupt',
    });
    const result = applyShareholderExpectations([corp], SECONDS_PER_DAY, 100);
    expect(result.businesses[0]!.valuation).toBe('75000'); // unchanged
    expect(shareholderEvent(result.events)).toBeUndefined();
  });

  it('floors valuation at 0 (never negative)', () => {
    // A corporation with a tiny valuation and a big shortfall — the penalty
    // would drive it negative; it floors at 0.
    const corp = makeCorporation({
      revenue: '0',
      expenses: '1000000',
      valuation: '1',
      status: 'operating',
    });
    const result = applyShareholderExpectations([corp], SECONDS_PER_DAY, 100);
    // growthProxy = 0; shortfall = 0.001; penalty = floor(1 × 0.001 × 0.5 ×
    // 0.10) = floor(0.00005) = 0. No penalty applied (penalty <= 0).
    // Valuation unchanged at '1'.
    expect(result.businesses[0]!.valuation).toBe('1');
  });
});

// ---------------------------------------------------------------------------
// applyCompetitionPressure (GDD §8.4 competition)
// ---------------------------------------------------------------------------

describe('applyCompetitionPressure — less-efficient businesses lose rate', () => {
  /** Build a business producing a given output at a given efficiency. */
  function makeCompetitor(
    id: string,
    efficiency: number,
    rate = 100,
    outputResourceId = 'resource:water',
  ): BusinessState {
    return makeBusiness({
      id,
      status: 'operating',
      production: {
        inputResourceIds: [],
        outputResourceId,
        rate,
        efficiency,
      },
    });
  }

  it('erodes the production rate of the less-efficient business in a shared market', () => {
    // Two businesses producing resource:water: b1 efficiency 0.9, b2
    // efficiency 0.6. avgEfficiency = 0.75. b2 (0.6 < 0.75) erodes:
    // erosion = floor(100 × 0.10 × (0.75 − 0.6)) = floor(1.5) = 1.
    // newRate_b2 = 100 − 1 = 99. b1 (0.9 >= 0.75) unchanged.
    const b1 = makeCompetitor('b:1', 0.9);
    const b2 = makeCompetitor('b:2', 0.6);
    const result = applyCompetitionPressure([b1, b2], SECONDS_PER_DAY, 100);
    const r1 = result.businesses.find((b) => b.id === 'b:1')!;
    const r2 = result.businesses.find((b) => b.id === 'b:2')!;
    expect(r1.production.rate).toBe(100); // unchanged (more efficient)
    expect(r2.production.rate).toBe(99); // eroded by 1
    // A competition-pressure event was emitted for b2.
    expect(competitionEvent(result.events, 'b:2')).toBeDefined();
    expect(competitionEvent(result.events, 'b:1')).toBeUndefined();
  });

  it('leaves all businesses unchanged when only one produces the output (no competition)', () => {
    const b1 = makeCompetitor('b:1', 0.9);
    const result = applyCompetitionPressure([b1], SECONDS_PER_DAY, 100);
    expect(result.businesses[0]!.production.rate).toBe(100);
    expect(result.events).toEqual([]);
  });

  it('leaves all businesses unchanged when efficiencies are equal (no gap)', () => {
    const b1 = makeCompetitor('b:1', 0.8);
    const b2 = makeCompetitor('b:2', 0.8);
    const result = applyCompetitionPressure([b1, b2], SECONDS_PER_DAY, 100);
    expect(result.businesses[0]!.production.rate).toBe(100);
    expect(result.businesses[1]!.production.rate).toBe(100);
    expect(result.events).toEqual([]);
  });

  it('groups competitors by outputResourceId (different outputs do not compete)', () => {
    // b1 produces water (eff 0.9), b2 produces food (eff 0.5). Different
    // outputs → no shared market → no erosion.
    const b1 = makeCompetitor('b:1', 0.9, 100, 'resource:water');
    const b2 = makeCompetitor('b:2', 0.5, 100, 'resource:food');
    const result = applyCompetitionPressure([b1, b2], SECONDS_PER_DAY, 100);
    expect(result.businesses[0]!.production.rate).toBe(100);
    expect(result.businesses[1]!.production.rate).toBe(100);
    expect(result.events).toEqual([]);
  });

  it('erodes over multiple ticks (rate declines cumulatively)', () => {
    // b1 eff 0.9, b2 eff 0.6, rate 100. Tick 1: b2 → 99 (erosion 1). Tick 2:
    // avgEfficiency = (0.9 + 0.6) / 2 = 0.75 still; erosion = floor(99 × 0.10
    // × 0.15) = floor(1.485) = 1. b2 → 98.
    const b1 = makeCompetitor('b:1', 0.9);
    const b2 = makeCompetitor('b:2', 0.6);
    const after1 = applyCompetitionPressure([b1, b2], SECONDS_PER_DAY, 100);
    const after2 = applyCompetitionPressure(after1.businesses, SECONDS_PER_DAY, 200);
    const r2 = after2.businesses.find((b) => b.id === 'b:2')!;
    expect(r2.production.rate).toBeLessThan(99); // declined further
  });

  it('does not mutate the input businesses (purity)', () => {
    const b1 = makeCompetitor('b:1', 0.9);
    const b2 = makeCompetitor('b:2', 0.6);
    const originalRate = b2.production.rate;
    applyCompetitionPressure([b1, b2], SECONDS_PER_DAY, 100);
    expect(b2.production.rate).toBe(originalRate); // unchanged
  });
});
