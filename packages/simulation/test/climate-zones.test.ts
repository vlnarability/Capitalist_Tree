import { describe, it, expect } from 'vitest';
import {
  ALL_CLIMATES,
  KOPPEN_ZONES,
  TEMPERATE_CLIMATE,
  findClimateById,
  applyHighlandModifier,
  HIGHLAND_LAPSE_RATE_C_PER_KM,
} from '@capitalist-tree/content';
import {
  PROVISIONAL_WEATHER_DEFAULT_CLIMATE_ID,
  PROVISIONAL_WEATHER_CLIMATE_SHIFT_BASELINE_TEMP_C,
  type ClimateBaseline,
} from '@capitalist-tree/shared';

/**
 * GAP-17 / DR-11 — Köppen-Geiger climate zone catalog (Phase 1).
 *
 * Validates that all 31 Köppen-Geiger climate types are present as realistic
 * exemplar zones whose temperature + precipitation profiles satisfy the
 * published Köppen criteria (Kottek et al. 2006 / NOAA Jetstream), that the
 * default `climate:temperate` is byte-identical to the pre-GAP-17 baseline (no
 * behavior change), and that the H highland modifier applies the standard
 * environmental lapse rate.
 */
const ALL_KOPPEN_CODES = [
  'Af', 'Am', 'As', 'Aw',
  'BWh', 'BWk', 'BSh', 'BSk',
  'Cfa', 'Cfb', 'Cfc', 'Csa', 'Csb', 'Csc', 'Cwa', 'Cwb', 'Cwc',
  'Dfa', 'Dfb', 'Dfc', 'Dfd', 'Dsa', 'Dsb', 'Dsc', 'Dsd', 'Dwa', 'Dwb', 'Dwc', 'Dwd',
  'ET', 'EF',
] as const;

function warmest(z: ClimateBaseline): number {
  return Math.max(...Object.values(z.seasonalBaseTemp));
}
function coldest(z: ClimateBaseline): number {
  return Math.min(...Object.values(z.seasonalBaseTemp));
}
function annualMean(z: ClimateBaseline): number {
  const v = Object.values(z.seasonalBaseTemp);
  return v.reduce((a, b) => a + b, 0) / v.length;
}

/**
 * Assert a zone's profile matches its Köppen-Geiger criteria, to the extent
 * the 4 seasonal means + the precipitation summary allow. The third-letter
 * 'd' (coldest month < −38 °C) + the 'b'-vs-'c' months-over-10 °C distinction
 * require monthly means (not stored yet — a Phase 3 refinement); the 'd' check
 * is therefore skipped, and 'b'/'c' are validated as "summer not hot" (≤ 22 °C).
 */
function checkKoppenCriteria(z: ClimateBaseline): void {
  const { koppenCode, koppenClass, precipitation, seasonalBaseTemp } = z;
  const w = warmest(z);
  const c = coldest(z);
  const s = seasonalBaseTemp.summer;

  // --- Class-level criteria ---
  if (koppenClass === 'A') {
    // All monthly means > 18 °C (approximated by all 4 seasonal means > 18).
    for (const t of Object.values(seasonalBaseTemp)) {
      expect(t).toBeGreaterThan(18);
    }
  } else if (koppenClass === 'B') {
    expect(precipitation.pattern).toBe('arid');
    expect(precipitation.annualMm).toBeLessThan(500);
  } else if (koppenClass === 'C') {
    expect(w).toBeGreaterThan(10); // warmest > 10 °C
    expect(c).toBeLessThanOrEqual(18); // coldest ≤ 18 °C
    expect(c).toBeGreaterThan(-3); // coldest > −3 °C (Kottek C/D boundary)
  } else if (koppenClass === 'D') {
    expect(w).toBeGreaterThan(10); // warmest > 10 °C
    expect(c).toBeLessThanOrEqual(-3); // coldest ≤ −3 °C (Kottek C/D boundary)
  } else if (koppenClass === 'E') {
    expect(w).toBeLessThan(10); // warmest < 10 °C
  }

  // --- Precipitation qualifier (second letter f/s/w/m) — A/C/D only ---
  // (B uses uppercase W/S = desert/steppe, both 'arid'; E uses T/F.)
  if (koppenClass === 'A' || koppenClass === 'C' || koppenClass === 'D') {
    const second = koppenCode[1]?.toLowerCase();
    const expectedPattern =
      second === 'f' ? 'year-round'
      : second === 's' ? 'dry-summer'
      : second === 'w' ? 'dry-winter'
      : second === 'm' ? 'monsoon'
      : undefined;
    if (expectedPattern !== undefined) {
      expect(precipitation.pattern).toBe(expectedPattern);
    }
  }

  // --- B third letter h/k (hot/cold: annual mean > / < 18 °C) ---
  if (koppenClass === 'B') {
    const third = koppenCode[2]?.toLowerCase();
    const mean = annualMean(z);
    if (third === 'h') expect(mean).toBeGreaterThan(18);
    else if (third === 'k') expect(mean).toBeLessThan(18);
  }

  // --- C/D third letter a/b/c (d skipped — needs monthly coldest) ---
  if (koppenClass === 'C' || koppenClass === 'D') {
    const third = koppenCode[2]?.toLowerCase();
    if (third === 'a') {
      expect(s).toBeGreaterThan(22); // hot summer: warmest > 22 °C
    } else if (third === 'b' || third === 'c') {
      expect(s).toBeLessThanOrEqual(22); // warm/cool summer: not hot
    }
    // 'd' (very cold winter, coldest month < −38 °C) cannot be validated from
    // seasonal means — skipped; documented as a Phase 3 refinement.
  }

  // --- supportsTrees: only EF (ice cap) is false ---
  if (koppenCode === 'EF') {
    expect(z.supportsTrees).toBe(false);
  } else {
    expect(z.supportsTrees).toBe(true);
  }
}

describe('GAP-17 climate catalog — all 31 Köppen-Geiger zones present', () => {
  it('KOPPEN_ZONES contains exactly the 31 Köppen-Geiger climate types', () => {
    expect(KOPPEN_ZONES).toHaveLength(31);
    const codes = KOPPEN_ZONES.map((z) => z.koppenCode);
    for (const code of ALL_KOPPEN_CODES) {
      expect(codes).toContain(code);
    }
  });

  it('every zone id is unique + findable via findClimateById', () => {
    const ids = KOPPEN_ZONES.map((z) => z.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const z of KOPPEN_ZONES) {
      expect(findClimateById(z.id)).toBe(z);
    }
  });

  it('koppenCode first letter matches koppenClass', () => {
    for (const z of KOPPEN_ZONES) {
      expect(z.koppenCode[0]).toBe(z.koppenClass);
    }
  });

  it('supportsTrees is false only for EF', () => {
    const noTree = KOPPEN_ZONES.filter((z) => !z.supportsTrees).map((z) => z.koppenCode);
    expect(noTree).toEqual(['EF']);
  });

  it('every zone carries the full Köppen profile (no empty fields)', () => {
    for (const z of KOPPEN_ZONES) {
      expect(z.koppenCode.length).toBeGreaterThanOrEqual(2);
      expect(z.name.length).toBeGreaterThan(0);
      expect(z.description.length).toBeGreaterThan(0);
      expect(z.precipitation.annualMm).toBeGreaterThanOrEqual(0);
      expect(z.precipitation.driestMonthMm).toBeGreaterThanOrEqual(0);
      expect(z.treeSuitabilityNote.length).toBeGreaterThan(0);
    }
  });

  it('every pure-exemplar zone satisfies its Köppen-Geiger criteria', () => {
    for (const z of KOPPEN_ZONES) {
      checkKoppenCriteria(z);
    }
  });

  it('ALL_CLIMATES = the default + the 31 exemplars (32 entries, unique ids)', () => {
    expect(ALL_CLIMATES).toHaveLength(32);
    const ids = ALL_CLIMATES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('climate:temperate');
    expect(ids).toContain('climate:dfb'); // pure Dfb exemplar (distinct from the warm default)
  });

  it('findClimateById resolves several Köppen codes', () => {
    expect(findClimateById('climate:af')?.koppenCode).toBe('Af');
    expect(findClimateById('climate:dfb')?.koppenCode).toBe('Dfb');
    expect(findClimateById('climate:ef')?.supportsTrees).toBe(false);
    expect(findClimateById('climate:et')?.koppenClass).toBe('E');
    expect(findClimateById('climate:bwh')?.koppenClass).toBe('B');
  });
});

describe('GAP-17 default climate:temperate — warm-Dfb, byte-identical to pre-GAP-17', () => {
  it('id + findability unchanged', () => {
    expect(TEMPERATE_CLIMATE.id).toBe(PROVISIONAL_WEATHER_DEFAULT_CLIMATE_ID);
    expect(TEMPERATE_CLIMATE.id).toBe('climate:temperate');
    expect(findClimateById(PROVISIONAL_WEATHER_DEFAULT_CLIMATE_ID)).toBe(TEMPERATE_CLIMATE);
  });

  it('seasonal temperatures unchanged (no behavior change)', () => {
    expect(TEMPERATE_CLIMATE.seasonalBaseTemp).toEqual({
      spring: 12,
      summer: 24,
      autumn: 12,
      winter: 0,
    });
  });

  it('climateShiftHook unchanged', () => {
    expect(TEMPERATE_CLIMATE.climateShiftHook).toEqual({
      baselineTempC: PROVISIONAL_WEATHER_CLIMATE_SHIFT_BASELINE_TEMP_C,
      tempShiftPerDegreeC: 1.0,
      droughtProbShiftPerDegreeC: 0.02,
    });
  });

  it('carries the warm-Dfb Köppen profile (classification only — temps untouched)', () => {
    expect(TEMPERATE_CLIMATE.koppenCode).toBe('Dfb');
    expect(TEMPERATE_CLIMATE.koppenClass).toBe('D');
    expect(TEMPERATE_CLIMATE.supportsTrees).toBe(true);
    expect(TEMPERATE_CLIMATE.precipitation.pattern).toBe('year-round');
    expect(TEMPERATE_CLIMATE.seasonality).toBe('four-season');
    // The warm default is deliberately exempt from the strict Köppen criteria
    // test (its winter 0 °C sits at the C/D boundary — documented in
    // climate-baselines.ts). A strict pure-Dfb exemplar (7/19/7/-5) is
    // validated above as climate:dfb.
  });
});

describe('GAP-17 highland (H) modifier', () => {
  const cfb = findClimateById('climate:cfb')!;

  it('lapse rate constant is 6.5 °C/km', () => {
    expect(HIGHLAND_LAPSE_RATE_C_PER_KM).toBe(6.5);
  });

  it('reduces every season by 6.5 °C per km of elevation', () => {
    const h = applyHighlandModifier(cfb, 1000);
    expect(h.seasonalBaseTemp.spring).toBeCloseTo(cfb.seasonalBaseTemp.spring - 6.5, 5);
    expect(h.seasonalBaseTemp.summer).toBeCloseTo(cfb.seasonalBaseTemp.summer - 6.5, 5);
    expect(h.seasonalBaseTemp.autumn).toBeCloseTo(cfb.seasonalBaseTemp.autumn - 6.5, 5);
    expect(h.seasonalBaseTemp.winter).toBeCloseTo(cfb.seasonalBaseTemp.winter - 6.5, 5);
  });

  it('marks the result as highland (koppenClass H) + annotates the description', () => {
    const h = applyHighlandModifier(cfb, 1500);
    expect(h.koppenClass).toBe('H');
    expect(h.description).toContain('Highland');
    expect(h.description).toContain('1500');
  });

  it('bumps frost risk one step when the adjusted winter drops below 0 °C', () => {
    // Cfb winter 5 °C → at 1000 m: 5 − 6.5 = −1.5 (< 0) → bump 'occasional' → 'regular-winter'.
    const h = applyHighlandModifier(cfb, 1000);
    expect(h.frostRisk).not.toBe(cfb.frostRisk);
    expect(h.frostRisk).toBe('regular-winter');
  });

  it('leaves frost risk unchanged when the adjusted winter stays ≥ 0 °C', () => {
    // Cfb winter 5 °C → at 500 m: 5 − 3.25 = 1.75 (≥ 0) → unchanged.
    const h = applyHighlandModifier(cfb, 500);
    expect(h.frostRisk).toBe(cfb.frostRisk);
  });

  it('preserves the base zone precipitation, seasonality, supportsTrees, + Köppen code', () => {
    const h = applyHighlandModifier(cfb, 2000);
    expect(h.precipitation).toEqual(cfb.precipitation);
    expect(h.seasonality).toBe(cfb.seasonality);
    expect(h.supportsTrees).toBe(cfb.supportsTrees);
    expect(h.koppenCode).toBe(cfb.koppenCode);
  });

  it('does not mutate the base zone', () => {
    const before = { ...cfb, seasonalBaseTemp: { ...cfb.seasonalBaseTemp } };
    applyHighlandModifier(cfb, 3000);
    expect(cfb).toEqual(before);
  });

  it('throws on negative elevation', () => {
    expect(() => applyHighlandModifier(cfb, -100)).toThrow();
  });
});
