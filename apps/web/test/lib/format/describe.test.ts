/**
 * Tests for `lib/format/describe.ts` (P5c — GDD §13.3 advanced view).
 *
 * Covers the plain-language relationship descriptions used by the
 * BiologyPanel / EnvironmentPanel / HarvestControls:
 *
 *   - `describeLimitingFactor` picks the Liebig minimum + formats a sentence.
 *   - `describeEnergyBalance` distinguishes surplus / steady / deficit.
 *   - `describeNutrientStatus` calls out the limiting nutrient.
 *   - `describeSoilWaterBalance` tone + summary for each tier.
 *   - `describePollution` handles contamination + emissions combinations.
 *   - `describeHarvestRecommendation` compares requested vs sustainable.
 *   - `describeTransactionCategory` resolves known + unknown categories.
 */
import { describe, it, expect } from 'vitest';
import {
  describeLimitingFactor,
  describeEnergyBalance,
  describeNutrientStatus,
  describeSoilWaterBalance,
  describePollution,
  describeHarvestRecommendation,
  describeTransactionCategory,
  describeTransaction,
} from '../../../lib/format/describe';
import type { TransactionRecord } from '@capitalist-tree/shared';

describe('describeLimitingFactor (P5c)', () => {
  it('identifies water as the limiting factor with severity', () => {
    const s = describeLimitingFactor({
      light: 1.0,
      temperature: 1.0,
      water: 0.18,
      co2: 1.0,
      nutrients: 1.0,
      leafHealth: 1.0,
    });
    expect(s).toMatch(/^Water is the limiting factor/);
    expect(s).toMatch(/18% of full rate/);
    expect(s).toMatch(/critical/);
    // Headline relationship: Liebig's Law.
    expect(s).toMatch(/Liebig/);
  });

  it('reports "near optimum" when all factors are >= 0.9', () => {
    const s = describeLimitingFactor({
      light: 1.0,
      temperature: 0.95,
      water: 1.0,
      co2: 1.0,
      nutrients: 0.92,
      leafHealth: 1.0,
    });
    expect(s).toMatch(/near optimum/);
  });

  it('calls "low" availability for the [0.3, 0.6) range', () => {
    const s = describeLimitingFactor({
      light: 1.0,
      temperature: 1.0,
      water: 1.0,
      co2: 1.0,
      nutrients: 0.45,
      leafHealth: 1.0,
    });
    expect(s).toMatch(/^Soil nutrients is the limiting factor/);
    expect(s).toMatch(/low availability/);
  });

  it('falls back gracefully on non-finite input', () => {
    const s = describeLimitingFactor({
      light: Number.NaN,
      temperature: Number.NaN,
      water: Number.NaN,
      co2: Number.NaN,
      nutrients: Number.NaN,
      leafHealth: Number.NaN,
    });
    expect(s).toBe('Growth factors unavailable.');
  });
});

describe('describeEnergyBalance (P5c)', () => {
  it('reports surplus when production exceeds maintenance by >= 5%', () => {
    const s = describeEnergyBalance(120, 100, 0);
    expect(s).toMatch(/exceeds maintenance/);
    expect(s).toMatch(/20%/);
  });

  it('reports steady state when within ±5%', () => {
    const s = describeEnergyBalance(100, 100, 0);
    expect(s).toMatch(/roughly balanced/);
  });

  it('reports deficit with reserve draw when production < maintenance', () => {
    const s = describeEnergyBalance(40, 100, 60);
    expect(s).toMatch(/deficit/);
    expect(s).toMatch(/reserves/);
    expect(s).toMatch(/mortality risk/);
  });

  it('falls back on non-finite input', () => {
    const s = describeEnergyBalance(Number.NaN, 100, 0);
    expect(s).toBe('Energy balance unavailable.');
  });
});

describe('describeNutrientStatus (P5c)', () => {
  it('reports all-sufficient when every nutrient meets requirement', () => {
    const r = describeNutrientStatus(
      { nitrogen: 10, phosphorus: 5, potassium: 8 },
      { nitrogen: 5, phosphorus: 2, potassium: 4 },
    );
    expect(r.limiting).toBeNull();
    expect(r.summary).toMatch(/not a bottleneck/);
  });

  it('calls out phosphorus as the limiting nutrient', () => {
    const r = describeNutrientStatus(
      { nitrogen: 10, phosphorus: 1, potassium: 8 },
      { nitrogen: 5, phosphorus: 2, potassium: 4 },
    );
    expect(r.limiting).toBe('phosphorus');
    expect(r.summary).toMatch(/^Phosphorus \(P\) is the limiting nutrient/);
    expect(r.summary).toMatch(/50%/);
  });

  it('explains Liebig — excess of others cannot compensate', () => {
    const r = describeNutrientStatus(
      { nitrogen: 100, phosphorus: 0.2, potassium: 100 },
      { nitrogen: 5, phosphorus: 2, potassium: 4 },
    );
    expect(r.summary).toMatch(/will not raise photosynthesis until P is restored/);
  });
});

describe('describeSoilWaterBalance (P5c)', () => {
  it('reports waterlogging at >= 95% capacity', () => {
    const r = describeSoilWaterBalance(95, 100);
    expect(r.tone).toBe('sky');
    expect(r.summary).toMatch(/at capacity/);
    expect(r.summary).toMatch(/runs off/);
  });

  it('reports healthy moisture at 60-95%', () => {
    const r = describeSoilWaterBalance(70, 100);
    expect(r.tone).toBe('emerald');
    expect(r.summary).toMatch(/healthy/);
  });

  it('reports dry at 25-60%', () => {
    const r = describeSoilWaterBalance(40, 100);
    expect(r.tone).toBe('amber');
    expect(r.summary).toMatch(/getting dry/);
  });

  it('reports critical drought below 25%', () => {
    const r = describeSoilWaterBalance(10, 100);
    expect(r.tone).toBe('rose');
    expect(r.summary).toMatch(/critically dry/);
  });

  it('falls back on bad input', () => {
    const r = describeSoilWaterBalance(Number.NaN, 100);
    expect(r.tone).toBe('slate');
    expect(r.summary).toMatch(/unavailable/);
  });
});

describe('describePollution (P5c)', () => {
  it('reports clean soil + no emissions when both are zero', () => {
    const s = describePollution(0, 0);
    expect(s).toMatch(/Soil is clean/);
    expect(s).not.toMatch(/Emissions/);
  });

  it('reports elevated contamination + positive emissions together', () => {
    const s = describePollution(2.5, 0.7);
    expect(s).toMatch(/contamination is elevated/);
    expect(s).toMatch(/Emissions are positive/);
  });
});

describe('describeHarvestRecommendation (P5c)', () => {
  it('within sustainable range when requested <= estimate', () => {
    const r = describeHarvestRecommendation(10, 20);
    expect(r.tone).toBe('emerald');
    expect(r.summary).toMatch(/sustainable range/);
  });

  it('above sustainable when between 1x and 2x', () => {
    const r = describeHarvestRecommendation(30, 20);
    expect(r.tone).toBe('amber');
    expect(r.summary).toMatch(/Above the sustainable rate/);
  });

  it('well above sustainable when > 2x', () => {
    const r = describeHarvestRecommendation(60, 20);
    expect(r.tone).toBe('rose');
    expect(r.summary).toMatch(/Well above/);
  });

  it('reserves warning when estimate is zero', () => {
    const r = describeHarvestRecommendation(5, 0);
    expect(r.tone).toBe('rose');
    expect(r.summary).toMatch(/No harvestable surplus/);
  });
});

describe('describeTransactionCategory / describeTransaction (P5c)', () => {
  it('resolves known categories to title-case labels', () => {
    expect(describeTransactionCategory('purchase')).toBe('Purchase');
    expect(describeTransactionCategory('expense')).toBe('Expense');
    expect(describeTransactionCategory('issuance')).toBe('Issuance');
    expect(describeTransactionCategory('transfer')).toBe('Transfer');
    expect(describeTransactionCategory('sink')).toBe('Sink');
  });

  it('title-cases unknown categories instead of returning blank', () => {
    expect(describeTransactionCategory('future-tax')).toBe('Future-tax');
  });

  it('formats a transaction record as a one-line summary', () => {
    const t: TransactionRecord = {
      id: 'txn:1:0',
      timestamp: 86_400 * 3 + 3_600 * 4, // Day 3, 04:00
      sourceAccount: 'player:personal',
      destinationAccount: 'market:water',
      amount: '500',
      category: 'purchase',
      description: 'Purchase 10 × resource:water',
    };
    const s = describeTransaction(t);
    expect(s).toMatch(/Purchase on Day 3/);
    expect(s).toMatch(/player:personal → market:water/);
  });
});
