/**
 * P4a unit tests — TreeRenderData mapping + types + TreeRenderer interface.
 *
 * Covers (TDD §15.1, §15.3, §15.4; GDD §13.4, §14):
 *   - buildTreeRenderData: mapping tests for sapling, mature, damaged,
 *     defoliated, dead, seasonal states.
 *   - CurrencyVisual lookup: findCurrencyVisual / getDefaultCurrencyVisual /
 *     resolveCurrencyVisual + ALL_CURRENCY_VISUALS shape.
 *   - TreeRenderer interface conformance: the headless stub satisfies the
 *     interface, factory dispatch works, unknown kinds throw.
 *   - Pure helper functions (deriveSeasonalAppearance, resolveSpeciesShape,
 *     mapDamageMarker).
 *
 * EnvironmentRenderData mapping tests live in environment-render-data.test.ts;
 * shared fixtures (baseTree / baseWorld / baseClock) live in _helpers.ts.
 *
 * These tests run in node (no DOM). The rendering package's tsconfig
 * excludes DOM types — these tests follow suit.
 */
import { describe, it, expect } from 'vitest';
import type { TreeDamageState } from '@capitalist-tree/shared';
import {
  buildTreeRenderData,
  buildEnvironmentRenderData,
  deriveSeasonalAppearance,
  resolveSpeciesShape,
  mapDamageMarker,
  findCurrencyVisual,
  getDefaultCurrencyVisual,
  resolveCurrencyVisual,
  ALL_CURRENCY_VISUALS,
  LEAF_BANKNOTE,
  GOLD_LEAF,
  EURO_LEAF,
  createTreeRenderer,
  HeadlessTreeRenderer,
} from '../src/index.js';
import type {
  TreeRenderer,
  CurrencyVisual,
  CreateTreeRendererTarget,
} from '../src/index.js';
import { baseTree, baseWorld, baseClock } from './_helpers.js';

// ----------------------------------------------------------------------------
// 1. buildTreeRenderData — mapping tests.
// ----------------------------------------------------------------------------

describe('buildTreeRenderData', () => {
  it('maps a healthy mature summer tree 1:1 from TreeState', () => {
    const tree = baseTree();
    const out = buildTreeRenderData(tree, { season: 'summer' });

    expect(out.height).toBe(5);
    expect(out.trunkDiameter).toBe(0.2);
    expect(out.branchDevelopment).toBe(20);
    expect(out.foliageDensity).toBeCloseTo(1000 / 2050, 6);
    expect(out.foliageCondition).toBe(1); // stress = 0 → 1 - 0 = 1
    expect(out.seasonalAppearance).toBe('summer-green');
    expect(out.damage).toEqual([]);
    expect(out.alive).toBe(true);
    expect(out.speciesId).toBe('species:white-oak');
    expect(out.speciesShape).toBe('broadleaf-round');
    expect(out.ageDays).toBe(100);
    expect(out.leafCount).toBe(1000);
  });

  it('maps a sapling: small structure, partial canopy, low density', () => {
    const tree = baseTree({
      ageDays: 1,
      structure: {
        height: 0.5,
        trunkDiameter: 0.01,
        branchDevelopment: 0,
        structuralIntegrity: 1,
      },
      foliage: {
        currentLeaves: 50,
        leafCapacity: 200,
        activeLeafArea: 0.25,
        seasonalCondition: 0.6,
        leafGrowthProgress: 0,
      },
    });
    const out = buildTreeRenderData(tree, { season: 'spring' });

    expect(out.height).toBe(0.5);
    expect(out.trunkDiameter).toBe(0.01);
    expect(out.branchDevelopment).toBe(0);
    expect(out.foliageDensity).toBeCloseTo(0.25, 6); // 50/200
    expect(out.seasonalAppearance).toBe('spring-buds');
    expect(out.ageDays).toBe(1);
    expect(out.leafCount).toBe(50);
  });

  it('maps a damaged tree: damage[] mirrors TreeDamageState[]', () => {
    const damage: TreeDamageState[] = [
      { type: 'severe-defoliation', severity: 0.6, appliedAt: 12345 },
      { type: 'wind-storm', severity: 0.3, appliedAt: 13000 },
    ];
    const tree = baseTree({ damage });
    const out = buildTreeRenderData(tree, { season: 'summer' });

    expect(out.damage).toHaveLength(2);
    expect(out.damage[0]).toEqual({ type: 'severe-defoliation', severity: 0.6, appliedAt: 12345 });
    expect(out.damage[1]).toEqual({ type: 'wind-storm', severity: 0.3, appliedAt: 13000 });
    // Different object references — the mapping produces fresh objects.
    expect(out.damage[0]).not.toBe(damage[0]);
  });

  it('maps a defoliated tree: density drops to ~0, condition still derived from stress', () => {
    const tree = baseTree({
      foliage: {
        currentLeaves: 0,
        leafCapacity: 2050,
        activeLeafArea: 0,
        seasonalCondition: 1,
        leafGrowthProgress: 0,
      },
      stress: 0.4,
    });
    const out = buildTreeRenderData(tree, { season: 'summer' });

    expect(out.foliageDensity).toBe(0);
    expect(out.foliageCondition).toBeCloseTo(0.6, 6); // 1 - 0.4
    expect(out.leafCount).toBe(0);
  });

  it('maps a dead tree: alive=false → renderer will draw a stump', () => {
    const tree = baseTree({
      alive: false,
      health: 0,
      stress: 1,
      foliage: {
        currentLeaves: 0,
        leafCapacity: 2050,
        activeLeafArea: 0,
        seasonalCondition: 0,
        leafGrowthProgress: 0,
      },
    });
    const out = buildTreeRenderData(tree, { season: 'winter' });

    expect(out.alive).toBe(false);
    expect(out.foliageDensity).toBe(0);
    expect(out.foliageCondition).toBe(0); // stress = 1
    expect(out.seasonalAppearance).toBe('winter-bare');
  });

  it('maps seasonal states correctly across all four seasons', () => {
    const seasons = ['spring', 'summer', 'autumn', 'winter'] as const;
    const expected = {
      spring: 'spring-buds',
      summer: 'summer-green',
      autumn: 'autumn-color',
      winter: 'winter-bare',
    } as const;

    for (const season of seasons) {
      const tree = baseTree();
      const out = buildTreeRenderData(tree, { season });
      expect(out.seasonalAppearance).toBe(expected[season]);
    }
  });

  it('falls back to seasonalCondition thresholds when no season provided', () => {
    const base = baseTree();
    // seasonalCondition = 1.0 → summer-green
    const summer = buildTreeRenderData({
      ...base,
      foliage: { ...base.foliage, seasonalCondition: 1.0 },
    });
    expect(summer.seasonalAppearance).toBe('summer-green');
    // seasonalCondition = 0.6 → spring-buds (0.55 ≤ x < 0.85)
    const spring = buildTreeRenderData({
      ...base,
      foliage: { ...base.foliage, seasonalCondition: 0.6 },
    });
    expect(spring.seasonalAppearance).toBe('spring-buds');
    // seasonalCondition = 0.5 → autumn-color (0.1 ≤ x < 0.55)
    const autumn = buildTreeRenderData({
      ...base,
      foliage: { ...base.foliage, seasonalCondition: 0.5 },
    });
    expect(autumn.seasonalAppearance).toBe('autumn-color');
    // seasonalCondition = 0.0 → winter-bare
    const winter = buildTreeRenderData({
      ...base,
      foliage: { ...base.foliage, seasonalCondition: 0.0 },
    });
    expect(winter.seasonalAppearance).toBe('winter-bare');
  });

  it('derives foliageCondition from stress (1 - stress)', () => {
    const tree = baseTree({ stress: 0.25 });
    const out = buildTreeRenderData(tree, { season: 'summer' });
    expect(out.foliageCondition).toBeCloseTo(0.75, 6);
  });

  it('clamps foliageDensity to [0, 1] even if currentLeaves exceeds leafCapacity', () => {
    const tree = baseTree({
      foliage: {
        currentLeaves: 4000,
        leafCapacity: 2000,
        activeLeafArea: 4,
        seasonalCondition: 1,
        leafGrowthProgress: 0,
      },
    });
    const out = buildTreeRenderData(tree, { season: 'summer' });
    expect(out.foliageDensity).toBe(1);
  });

  it('handles leafCapacity = 0 gracefully (no NaN, density = 0)', () => {
    const tree = baseTree({
      foliage: {
        currentLeaves: 0,
        leafCapacity: 0,
        activeLeafArea: 0,
        seasonalCondition: 1,
        leafGrowthProgress: 0,
      },
    });
    const out = buildTreeRenderData(tree, { season: 'summer' });
    expect(Number.isNaN(out.foliageDensity)).toBe(false);
    expect(out.foliageDensity).toBe(0);
  });

  it('does NOT mutate the input TreeState (rule 6: rendering reads, never writes)', () => {
    const tree = baseTree();
    const snapshotBefore = JSON.stringify(tree);
    buildTreeRenderData(tree, { season: 'summer' });
    expect(JSON.stringify(tree)).toBe(snapshotBefore);
  });

  it('returns fresh objects on each call (no shared state)', () => {
    const tree = baseTree();
    const a = buildTreeRenderData(tree, { season: 'summer' });
    const b = buildTreeRenderData(tree, { season: 'summer' });
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a.damage).not.toBe(b.damage);
  });

  it('resolves speciesShape for known species (white-oak → broadleaf-round)', () => {
    const tree = baseTree({ speciesId: 'species:white-oak' });
    const out = buildTreeRenderData(tree);
    expect(out.speciesShape).toBe('broadleaf-round');
  });

  it('falls back to "unknown" speciesShape for unregistered species', () => {
    const tree = baseTree({ speciesId: 'species:future-banyan' });
    const out = buildTreeRenderData(tree);
    expect(out.speciesShape).toBe('unknown');
  });

  it('snapshot test: representative mature summer tree', () => {
    const tree = baseTree();
    const out = buildTreeRenderData(tree, { season: 'summer' });
    expect(out).toMatchInlineSnapshot(`
      {
        "ageDays": 100,
        "alive": true,
        "branchDevelopment": 20,
        "damage": [],
        "foliageCondition": 1,
        "foliageDensity": 0.4878048780487805,
        "height": 5,
        "leafCount": 1000,
        "seasonalAppearance": "summer-green",
        "speciesId": "species:white-oak",
        "speciesShape": "broadleaf-round",
        "trunkDiameter": 0.2,
      }
    `);
  });
});

// ----------------------------------------------------------------------------
// 2. CurrencyVisual lookup tests (TDD §15.4, GDD §14).
// ----------------------------------------------------------------------------

describe('CurrencyVisual data', () => {
  it('ALL_CURRENCY_VISUALS contains exactly 3 cosmetics (P4a scope)', () => {
    expect(ALL_CURRENCY_VISUALS).toHaveLength(3);
    expect(ALL_CURRENCY_VISUALS.map((c) => c.id).sort()).toEqual([
      'currency:euro-leaf',
      'currency:gold-leaf',
      'currency:leaf-dollar',
    ]);
  });

  it('each CurrencyVisual has required fields populated', () => {
    for (const c of ALL_CURRENCY_VISUALS) {
      expect(c.id).toMatch(/^currency:/);
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.symbol.length).toBeGreaterThan(0);
      expect(c.denominations.length).toBeGreaterThan(0);
      expect(c.banknoteTheme.length).toBeGreaterThan(0);
      expect(c.leafAppearance.length).toBeGreaterThan(0);
      // Each denomination has valid fields
      for (const d of c.denominations) {
        expect(d.valueMinor).toMatch(/^\d+$/);
        expect(d.label.length).toBeGreaterThan(0);
        expect(d.leafTier).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('leaf tiers are monotonically increasing per currency', () => {
    for (const c of ALL_CURRENCY_VISUALS) {
      const tiers = c.denominations.map((d) => d.leafTier);
      for (let i = 1; i < tiers.length; i++) {
        expect(tiers[i]).toBeGreaterThan(tiers[i - 1]);
      }
    }
  });

  it('findCurrencyVisual returns the cosmetic by id', () => {
    expect(findCurrencyVisual('currency:leaf-dollar')).toBe(LEAF_BANKNOTE);
    expect(findCurrencyVisual('currency:gold-leaf')).toBe(GOLD_LEAF);
    expect(findCurrencyVisual('currency:euro-leaf')).toBe(EURO_LEAF);
  });

  it('findCurrencyVisual returns undefined for unknown ids', () => {
    expect(findCurrencyVisual('currency:unknown')).toBeUndefined();
    expect(findCurrencyVisual('')).toBeUndefined();
  });

  it('getDefaultCurrencyVisual returns LEAF_BANKNOTE', () => {
    expect(getDefaultCurrencyVisual()).toBe(LEAF_BANKNOTE);
    expect(getDefaultCurrencyVisual().id).toBe('currency:leaf-dollar');
  });

  it('resolveCurrencyVisual returns the named cosmetic when found', () => {
    expect(resolveCurrencyVisual('currency:euro-leaf')).toBe(EURO_LEAF);
    expect(resolveCurrencyVisual('currency:gold-leaf')).toBe(GOLD_LEAF);
  });

  it('resolveCurrencyVisual falls back to default for unknown / null / undefined', () => {
    expect(resolveCurrencyVisual('currency:unknown')).toBe(LEAF_BANKNOTE);
    expect(resolveCurrencyVisual(undefined)).toBe(LEAF_BANKNOTE);
    expect(resolveCurrencyVisual(null)).toBe(LEAF_BANKNOTE);
    expect(resolveCurrencyVisual('')).toBe(LEAF_BANKNOTE);
  });

  it('CurrencyVisual is structurally compatible with the TDD §15.4 shape', () => {
    const c: CurrencyVisual = LEAF_BANKNOTE;
    // TDD §15.4 — these four fields are the spec-defined contract.
    expect(typeof c.id).toBe('string');
    expect(typeof c.name).toBe('string');
    expect(typeof c.symbol).toBe('string');
    expect(Array.isArray(c.denominations)).toBe(true);
    expect(typeof c.banknoteTheme).toBe('string');
    expect(typeof c.leafAppearance).toBe('string');
  });
});

// ----------------------------------------------------------------------------
// 3. TreeRenderer interface conformance + factory (TDD §15.3).
// ----------------------------------------------------------------------------

describe('TreeRenderer interface + factory', () => {
  it('HeadlessTreeRenderer satisfies TreeRenderer interface', () => {
    const r: TreeRenderer = new HeadlessTreeRenderer();
    expect(r.targetKind).toBe('headless');
    expect(typeof r.render).toBe('function');
    expect(typeof r.resize).toBe('function');
    expect(typeof r.dispose).toBe('function');
  });

  it('createTreeRenderer({ kind: "headless" }) returns a HeadlessTreeRenderer', () => {
    const target: CreateTreeRendererTarget = { kind: 'headless' };
    const r = createTreeRenderer(target);
    expect(r).toBeInstanceOf(HeadlessTreeRenderer);
    expect(r.targetKind).toBe('headless');
  });

  it('createTreeRenderer({ kind: "canvas" }) returns a CanvasTreeRenderer (P4b lands)', () => {
    // P4b ships CanvasTreeRenderer. The full canvas test suite lives in
    // canvas-tree-renderer.test.ts; this assertion just confirms the factory
    // dispatch works from this side too. We pass a minimal canvas-shaped mock
    // with a no-op getContext so the renderer constructs without a real DOM.
    const canvasLike = {
      width: 0,
      height: 0,
      getContext: () => null,
    };
    const target: CreateTreeRendererTarget = { kind: 'canvas', canvas: canvasLike };
    const r = createTreeRenderer(target);
    expect(r.targetKind).toBe('canvas');
  });

  it('createTreeRenderer({ kind: "svg" }) throws (future phase)', () => {
    const target: CreateTreeRendererTarget = { kind: 'svg', container: {} };
    expect(() => createTreeRenderer(target)).toThrowError(/future phase/);
  });

  it('createTreeRenderer({ kind: "webgl" }) throws (future phase)', () => {
    const target: CreateTreeRendererTarget = { kind: 'webgl', canvas: {} };
    expect(() => createTreeRenderer(target)).toThrowError(/future phase/);
  });

  it('headless renderer render() does not mutate its inputs', () => {
    const tree = buildTreeRenderData(baseTree(), { season: 'summer' });
    const env = buildEnvironmentRenderData(baseWorld(), baseClock());
    const treeBefore = JSON.stringify(tree);
    const envBefore = JSON.stringify(env);

    const r = new HeadlessTreeRenderer();
    r.render(tree, env, 16);
    expect(JSON.stringify(tree)).toBe(treeBefore);
    expect(JSON.stringify(env)).toBe(envBefore);
  });

  it('headless renderer exposes lastSnapshot for tests', () => {
    const tree = buildTreeRenderData(baseTree(), { season: 'summer' });
    const env = buildEnvironmentRenderData(baseWorld(), baseClock());
    const r = new HeadlessTreeRenderer();
    expect(r.lastSnapshot).toBeNull();
    r.render(tree, env, 16);
    expect(r.lastSnapshot).not.toBeNull();
    expect(r.lastSnapshot?.tree).toBe(tree);
    expect(r.lastSnapshot?.env).toBe(env);
    expect(r.lastSnapshot?.frameTimeMs).toBe(16);
    expect(r.renderCount).toBe(1);
  });

  it('headless renderer resize() updates dimensions', () => {
    const r = new HeadlessTreeRenderer();
    expect(r.width).toBe(0);
    expect(r.height).toBe(0);
    r.resize(640, 480);
    expect(r.width).toBe(640);
    expect(r.height).toBe(480);
  });

  it('headless renderer dispose() is idempotent and stops further renders', () => {
    const tree = buildTreeRenderData(baseTree(), { season: 'summer' });
    const env = buildEnvironmentRenderData(baseWorld(), baseClock());
    const r = new HeadlessTreeRenderer();
    r.render(tree, env, 16);
    expect(r.disposed).toBe(false);
    r.dispose();
    expect(r.disposed).toBe(true);
    expect(r.lastSnapshot).toBeNull();
    // Subsequent render is a no-op
    r.render(tree, env, 16);
    expect(r.renderCount).toBe(1);
    // Dispose again is safe.
    expect(() => r.dispose()).not.toThrow();
  });
});

// ----------------------------------------------------------------------------
// 4. Pure helper functions (deriveSeasonalAppearance, resolveSpeciesShape,
//    mapDamageMarker).
// ----------------------------------------------------------------------------

describe('pure helpers', () => {
  describe('deriveSeasonalAppearance', () => {
    it('uses season when provided (authoritative)', () => {
      expect(deriveSeasonalAppearance('spring', 0.0)).toBe('spring-buds');
      expect(deriveSeasonalAppearance('summer', 0.0)).toBe('summer-green');
      expect(deriveSeasonalAppearance('autumn', 1.0)).toBe('autumn-color');
      expect(deriveSeasonalAppearance('winter', 0.5)).toBe('winter-bare');
    });

    it('falls back to thresholds when season is undefined', () => {
      expect(deriveSeasonalAppearance(undefined, 0.0)).toBe('winter-bare');
      expect(deriveSeasonalAppearance(undefined, 0.4)).toBe('autumn-color');
      expect(deriveSeasonalAppearance(undefined, 0.7)).toBe('spring-buds');
      expect(deriveSeasonalAppearance(undefined, 1.0)).toBe('summer-green');
    });
  });

  describe('resolveSpeciesShape', () => {
    it('returns "broadleaf-round" for white-oak', () => {
      expect(resolveSpeciesShape('species:white-oak')).toBe('broadleaf-round');
    });

    it('returns "broadleaf-round" for proto-oak (P0 placeholder)', () => {
      expect(resolveSpeciesShape('species:proto-oak')).toBe('broadleaf-round');
    });

    it('returns "unknown" for unregistered species', () => {
      expect(resolveSpeciesShape('species:future-banyan')).toBe('unknown');
      expect(resolveSpeciesShape('')).toBe('unknown');
    });
  });

  describe('mapDamageMarker', () => {
    it('mirrors all fields from TreeDamageState', () => {
      const d: TreeDamageState = { type: 'severe-defoliation', severity: 0.5, appliedAt: 999 };
      const m = mapDamageMarker(d);
      expect(m).toEqual(d);
      expect(m).not.toBe(d); // fresh object
    });
  });
});
