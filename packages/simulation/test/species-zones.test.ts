import { describe, it, expect } from 'vitest';
import {
  ALL_SPECIES,
  ALL_CLIMATES,
  KOPPEN_ZONES,
  WHITE_OAK,
  EASTERN_HEMLOCK,
  findSpeciesById,
  findSpeciesByKoppenCode,
} from '@capitalist-tree/content';
import { treeSpeciesSchema, type TreeSpecies } from '@capitalist-tree/shared';

/**
 * GAP-17 / DR-11 — Phase 2 species catalog tests.
 *
 * Validates that the species catalog covers every tree-supporting Köppen zone
 * (every `supportsTrees: true` zone has ≥1 real species native to it), that no
 * species is offered for EF (ice cap), that each species carries a non-empty
 * native Köppen band of valid codes, and that the existing White Oak / Eastern
 * Hemlock kept their climate-correct native bands.
 */
const ALL_KOPPEN_CODES = new Set<string>([
  'Af', 'Am', 'As', 'Aw',
  'BWh', 'BWk', 'BSh', 'BSk',
  'Cfa', 'Cfb', 'Cfc', 'Csa', 'Csb', 'Csc', 'Cwa', 'Cwb', 'Cwc',
  'Dfa', 'Dfb', 'Dfc', 'Dfd', 'Dsa', 'Dsb', 'Dsc', 'Dsd', 'Dwa', 'Dwb', 'Dwc', 'Dwd',
  'ET', 'EF',
]);

describe('GAP-17 species catalog — all species valid + unique', () => {
  it('ALL_SPECIES has 27 entries (2 existing + 25 new)', () => {
    expect(ALL_SPECIES).toHaveLength(27);
  });

  it('every species id is unique + findable via findSpeciesById', () => {
    const ids = ALL_SPECIES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of ALL_SPECIES) {
      expect(findSpeciesById(s.id)).toBe(s);
    }
  });

  it('every species parses treeSpeciesSchema (schema-conformant)', () => {
    for (const s of ALL_SPECIES) {
      const parsed = treeSpeciesSchema.safeParse(s);
      expect(parsed.success, `species ${s.id} failed schema: ${parsed.success ? '' : JSON.stringify(parsed.error.issues)}`).toBe(true);
    }
  });

  it('every species carries a non-empty nativeKoppenCodes list of valid codes', () => {
    for (const s of ALL_SPECIES) {
      expect(s.nativeKoppenCodes.length).toBeGreaterThanOrEqual(1);
      for (const code of s.nativeKoppenCodes) {
        expect(ALL_KOPPEN_CODES.has(code), `species ${s.id} lists invalid Köppen code "${code}"`).toBe(true);
      }
    }
  });

  it('no species lists EF (no tree survives perennial ice)', () => {
    for (const s of ALL_SPECIES) {
      expect(s.nativeKoppenCodes).not.toContain('EF');
    }
  });

  it('every species sapling starts no taller than its maximum height', () => {
    for (const s of ALL_SPECIES) {
      expect(s.initial.height).toBeLessThanOrEqual(s.maximumHeight);
      expect(s.initial.trunkDiameter).toBeLessThanOrEqual(s.maximumTrunkDiameter);
    }
  });
});

describe('GAP-17 species-per-zone coverage — every tree zone has ≥1 native species', () => {
  it('every supportsTrees:true climate zone has ≥1 species', () => {
    // ALL_CLIMATES = the warm default + 31 Köppen exemplars (32 entries, with
    // two Dfb entries — the warm default + the pure exemplar — both mapping to
    // the same species set).
    const treeZones = ALL_CLIMATES.filter((c) => c.supportsTrees);
    expect(treeZones.length).toBe(31); // 32 total − EF
    for (const zone of treeZones) {
      const species = findSpeciesByKoppenCode(zone.koppenCode);
      expect(species.length, `zone ${zone.id} (${zone.koppenCode}) has no native species`).toBeGreaterThanOrEqual(1);
    }
  });

  it('every distinct Köppen code in the 31 exemplars is covered by ≥1 species', () => {
    // The pure-exemplar check (independent of the warm-default alias).
    const codes = new Set(KOPPEN_ZONES.map((z) => z.koppenCode));
    for (const code of codes) {
      if (code === 'EF') continue; // EF has no species
      const species = findSpeciesByKoppenCode(code);
      expect(species.length, `Köppen code ${code} has no native species`).toBeGreaterThanOrEqual(1);
    }
  });

  it('EF (ice cap) has no species offered', () => {
    expect(findSpeciesByKoppenCode('EF')).toHaveLength(0);
  });

  it('findSpeciesByKoppenCode returns only species whose nativeKoppenCodes includes the code', () => {
    for (const code of ['Af', 'Dfb', 'BWh', 'ET']) {
      const species = findSpeciesByKoppenCode(code);
      for (const s of species) {
        expect(s.nativeKoppenCodes).toContain(code);
      }
    }
  });
});

describe('GAP-17 existing-species continuity — White Oak + Eastern Hemlock climate-correct', () => {
  it('White Oak is native to Dfa + Dfb (the default starting climate band)', () => {
    expect(WHITE_OAK.nativeKoppenCodes).toEqual(['Dfa', 'Dfb']);
    expect(WHITE_OAK.id).toBe('species:white-oak');
  });

  it('Eastern Hemlock is native to Dfb + Dfc', () => {
    expect(EASTERN_HEMLOCK.nativeKoppenCodes).toEqual(['Dfb', 'Dfc']);
    expect(EASTERN_HEMLOCK.id).toBe('species:eastern-hemlock');
  });

  it('the default climate:temperate (warm-Dfb) offers White Oak + Eastern Hemlock', () => {
    const dfbSpecies = findSpeciesByKoppenCode('Dfb');
    expect(dfbSpecies.map((s) => s.id)).toContain('species:white-oak');
    expect(dfbSpecies.map((s) => s.id)).toContain('species:eastern-hemlock');
  });

  it('multi-zone species cover their full native band', () => {
    const ponderosa = findSpeciesById('species:ponderosa-pine')!;
    expect(ponderosa.nativeKoppenCodes).toEqual(['BSk', 'Dsa', 'Dsb']);
    for (const code of ['BSk', 'Dsa', 'Dsb']) {
      expect(findSpeciesByKoppenCode(code).map((s) => s.id)).toContain('species:ponderosa-pine');
    }
    const blackSpruce = findSpeciesById('species:black-spruce')!;
    expect(blackSpruce.nativeKoppenCodes).toEqual(['Dfc', 'ET']);
    for (const code of ['Dfc', 'ET']) {
      expect(findSpeciesByKoppenCode(code).map((s) => s.id)).toContain('species:black-spruce');
    }
  });
});

describe('GAP-17 species catalog — climate-relevant biology sanity', () => {
  // A light sanity check that the factory's climate-derived temperature ranges
  // are consistent with the species' native zones (cold-zone species tolerate
  // lower minimums; hot-zone species tolerate higher maximums). Not exhaustive
  // — the factory is provisional tuning (GDD §17) — but guards against a
  // gross miscategorization (e.g. a Dwd species with a 15 °C minimum).

  it('boreal/polar species (Dfc/Dfd/Dwd/ET) tolerate sub-zero minimums', () => {
    const coldZones = ['Dfc', 'Dfd', 'Dwd', 'Dsd', 'Dwc', 'ET'];
    const coldSpecies = ALL_SPECIES.filter((s) =>
      s.nativeKoppenCodes.some((c) => coldZones.includes(c)),
    );
    expect(coldSpecies.length).toBeGreaterThan(0);
    for (const s of coldSpecies) {
      expect(s.temperatureRange.minimum, `${s.name} (cold-zone) minimum should be ≤ 0`).toBeLessThanOrEqual(0);
    }
  });

  it('hot-desert species (BWh/BSh) tolerate high maximums', () => {
    const hotSpecies = ALL_SPECIES.filter((s) =>
      s.nativeKoppenCodes.includes('BWh') || s.nativeKoppenCodes.includes('BSh'),
    );
    expect(hotSpecies.length).toBeGreaterThan(0);
    for (const s of hotSpecies) {
      expect(s.temperatureRange.maximum, `${s.name} (hot-zone) maximum should be ≥ 40`).toBeGreaterThanOrEqual(40);
    }
  });

  it('tropical species (A) have minimums ≥ 10 °C (no frost tolerance)', () => {
    const tropical = ALL_SPECIES.filter((s) =>
      s.nativeKoppenCodes.some((c) => c.startsWith('A')),
    );
    expect(tropical.length).toBeGreaterThan(0);
    for (const s of tropical) {
      expect(s.temperatureRange.minimum, `${s.name} (tropical) minimum should be ≥ 10`).toBeGreaterThanOrEqual(10);
    }
  });
});

// Type-only reference to keep TreeSpecies import meaningful for downstream readers.
export type { TreeSpecies };
