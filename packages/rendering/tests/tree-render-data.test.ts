/**
 * P4a unit tests — TreeRenderData mapping + types + TreeRenderer interface.
 *
 * Covers (TDD §15.1, §15.2, §15.3, §15.4; GDD §13.4, §14):
 *   - buildTreeRenderData: mapping tests for sapling, mature, damaged,
 *     defoliated, dead, seasonal states.
 *   - buildEnvironmentRenderData: weather / season / time-of-day / soil /
 *     pollution combinations.
 *   - CurrencyVisual lookup: findCurrencyVisual / getDefaultCurrencyVisual /
 *     resolveCurrencyVisual + ALL_CURRENCY_VISUALS shape.
 *   - TreeRenderer interface conformance: the headless stub satisfies the
 *     interface, factory dispatch works, unknown kinds throw.
 *   - Snapshot tests for representative states.
 *
 * These tests run in node (no DOM). The rendering package's tsconfig
 * excludes DOM types — these tests follow suit.
 */
import { describe, it, expect } from 'vitest';
import type {
  TreeState,
  WorldState,
  SimulationClock,
  EnvironmentState,
  TreeDamageState,
} from '@capitalist-tree/shared';
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

// ----------------------------------------------------------------------------
// Test fixtures — minimal valid TreeState / WorldState / SimulationClock.
// Kept self-contained so this test file doesn't depend on simulation's
// _biology-helpers.ts (which would couple rendering tests to the simulation
// package). Mirrors the patterns in packages/simulation/test/_biology-helpers.ts
// but at the rendering layer's scope.
// ----------------------------------------------------------------------------

const SECONDS_PER_DAY = 24 * 60 * 60;

function deepMerge<T>(base: T, overrides: Partial<T>): T {
  if (!overrides) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const key of Object.keys(overrides as Record<string, unknown>)) {
    const b = (base as Record<string, unknown>)[key];
    const o = (overrides as Record<string, unknown>)[key];
    if (
      b &&
      o &&
      typeof b === 'object' &&
      !Array.isArray(b) &&
      typeof o === 'object' &&
      !Array.isArray(o)
    ) {
      out[key] = deepMerge(b, o);
    } else if (o !== undefined) {
      out[key] = o;
    }
  }
  return out as T;
}

function baseTree(overrides: Partial<TreeState> = {}): TreeState {
  const base: TreeState = {
    id: 'original',
    speciesId: 'species:white-oak',
    isOriginal: true,
    ageDays: 100,
    alive: true,
    structure: {
      height: 5,
      trunkDiameter: 0.2,
      branchDevelopment: 20,
      structuralIntegrity: 1,
    },
    foliage: {
      currentLeaves: 1000,
      leafCapacity: 2050,
      activeLeafArea: 5,
      seasonalCondition: 1,
      leafGrowthProgress: 0,
    },
    roots: { development: 0.5, absorptionCapacity: 0.5 },
    energy: { reserves: 500, production: 0, consumption: 0 },
    water: { stored: 25, capacity: 50 },
    nutrients: { nitrogen: 5, phosphorus: 2, potassium: 4 },
    health: 1,
    stress: 0,
    damage: [],
    pendingIssuances: [],
  };
  return deepMerge(base, overrides);
}

function baseEnvironment(overrides: Partial<EnvironmentState> = {}): EnvironmentState {
  const base: EnvironmentState = {
    atmosphere: { co2Concentration: 410, emissions: 0, sequestration: 0 },
    soil: {
      health: 0.9,
      organicMatter: 50,
      contamination: 0,
      nutrients: { nitrogen: 50, phosphorus: 50, potassium: 50 },
      soilWater: 100,
      ph: 6.5,
      compaction: 0,
      microbialActivity: 1.0,
    },
    freshwater: { availability: 1000, groundwater: 500, contamination: 0 },
    biodiversity: { index: 0.8, speciesPopulations: [] },
    forestCoverage: 0.3,
    ecosystemResilience: 0.8,
    globalTemperature: 22,
  };
  return deepMerge(base, overrides);
}

function baseWorld(overrides: Partial<WorldState> = {}): WorldState {
  const base: WorldState = {
    environment: baseEnvironment(),
    weather: {
      condition: 'sunny',
      temperature: 22,
      intensity: 0.5,
      prevCondition: null,
      daysInCondition: 0,
    },
    regionId: 'region:starting-plot',
  };
  return deepMerge(base, overrides);
}

function baseClock(overrides: Partial<SimulationClock> = {}): SimulationClock {
  const base: SimulationClock = {
    elapsedSeconds: 0,
    day: 0,
    season: 'summer',
    timeOfDay: 0.5,
    speedMultiplier: 1,
    paused: false,
  };
  return deepMerge(base, overrides);
}

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
// 2. buildEnvironmentRenderData — mapping tests.
// ----------------------------------------------------------------------------

describe('buildEnvironmentRenderData', () => {
  it('maps a sunny midday summer world 1:1', () => {
    const world = baseWorld();
    const clock = baseClock({ season: 'summer', timeOfDay: 0.5 });
    const out = buildEnvironmentRenderData(world, clock);

    expect(out.soilCondition).toBe(0.9);
    expect(out.soilContamination).toBe(0);
    expect(out.weatherCondition).toBe('sunny');
    expect(out.weatherIntensity).toBe(0.5);
    expect(out.timeOfDay).toBe(0.5);
    expect(out.season).toBe('summer');
    expect(out.co2Level).toBe(410);
    expect(out.biodiversityLevel).toBe(0.8);
    // pollutionLevel derived from CO2 (ambient = 0) + emissions (0) → 0
    expect(out.pollutionLevel).toBe(0);
  });

  it('maps weather conditions through unchanged', () => {
    const conditions = [
      'sunny',
      'cloudy',
      'rain',
      'heavy-rain',
      'drought',
      'frost',
      'heat-wave',
      'wind',
      'severe-storm',
    ] as const;
    for (const c of conditions) {
      const world = baseWorld({ weather: { ...baseWorld().weather, condition: c } });
      const out = buildEnvironmentRenderData(world, baseClock());
      expect(out.weatherCondition).toBe(c);
    }
  });

  it('derives soilContamination normalised against FULL_DEGRADE (100)', () => {
    const world = baseWorld({
      environment: {
        ...baseWorld().environment,
        soil: { ...baseWorld().environment.soil, contamination: 50 },
      },
    });
    const out = buildEnvironmentRenderData(world, baseClock());
    expect(out.soilContamination).toBeCloseTo(0.5, 6);
  });

  it('clamps soilContamination at 1 when contamination exceeds FULL_DEGRADE', () => {
    const world = baseWorld({
      environment: {
        ...baseWorld().environment,
        soil: { ...baseWorld().environment.soil, contamination: 250 },
      },
    });
    const out = buildEnvironmentRenderData(world, baseClock());
    expect(out.soilContamination).toBe(1);
  });

  it('maps all four seasons through clock.season', () => {
    for (const s of ['spring', 'summer', 'autumn', 'winter'] as const) {
      const out = buildEnvironmentRenderData(baseWorld(), baseClock({ season: s }));
      expect(out.season).toBe(s);
    }
  });

  it('maps timeOfDay through clock.timeOfDay', () => {
    // midnight = 0, dawn = 0.25, noon = 0.5, dusk = 0.75
    for (const tod of [0, 0.25, 0.5, 0.75]) {
      const out = buildEnvironmentRenderData(baseWorld(), baseClock({ timeOfDay: tod }));
      expect(out.timeOfDay).toBe(tod);
    }
  });

  it('derives pollutionLevel from CO2 above the floor (410 ppm)', () => {
    const world = baseWorld({
      environment: {
        ...baseWorld().environment,
        atmosphere: { ...baseWorld().environment.atmosphere, co2Concentration: 505 },
      },
    });
    // co2Floor=410, co2Sat=600 → 505-410=95; 95/190 = 0.5
    // emissions=0 → emissionsPollution=0
    // pollution = max(0.5, 0) = 0.5
    const out = buildEnvironmentRenderData(world, baseClock());
    expect(out.pollutionLevel).toBeCloseTo(0.5, 6);
  });

  it('saturates pollutionLevel at 1 when CO2 far exceeds the saturation point', () => {
    const world = baseWorld({
      environment: {
        ...baseWorld().environment,
        atmosphere: { ...baseWorld().environment.atmosphere, co2Concentration: 1000 },
      },
    });
    const out = buildEnvironmentRenderData(world, baseClock());
    expect(out.pollutionLevel).toBe(1);
  });

  it('treats sequestration (negative emissions) as zero pollution contribution', () => {
    const world = baseWorld({
      environment: {
        ...baseWorld().environment,
        atmosphere: {
          ...baseWorld().environment.atmosphere,
          co2Concentration: 410,
          emissions: -50, // sequestration
        },
      },
    });
    const out = buildEnvironmentRenderData(world, baseClock());
    expect(out.pollutionLevel).toBe(0);
  });

  it('does NOT mutate the input world or clock', () => {
    const world = baseWorld();
    const clock = baseClock();
    const worldBefore = JSON.stringify(world);
    const clockBefore = JSON.stringify(clock);
    buildEnvironmentRenderData(world, clock);
    expect(JSON.stringify(world)).toBe(worldBefore);
    expect(JSON.stringify(clock)).toBe(clockBefore);
  });

  it('snapshot test: representative cloudy winter night with pollution', () => {
    const world = baseWorld({
      environment: {
        ...baseWorld().environment,
        soil: { ...baseWorld().environment.soil, health: 0.6, contamination: 30 },
        atmosphere: { ...baseWorld().environment.atmosphere, co2Concentration: 510 },
        biodiversity: { ...baseWorld().environment.biodiversity, index: 0.4 },
      },
      weather: {
        condition: 'cloudy',
        temperature: 5,
        intensity: 0.7,
        prevCondition: 'sunny',
        daysInCondition: 2,
      },
    });
    const clock = baseClock({ season: 'winter', timeOfDay: 0.0 });
    const out = buildEnvironmentRenderData(world, clock);
    expect(out).toMatchInlineSnapshot(`
      {
        "biodiversityLevel": 0.4,
        "co2Level": 510,
        "pollutionLevel": 0.5263157894736842,
        "season": "winter",
        "soilCondition": 0.6,
        "soilContamination": 0.3,
        "timeOfDay": 0,
        "weatherCondition": "cloudy",
        "weatherIntensity": 0.7,
      }
    `);
  });
});

// ----------------------------------------------------------------------------
// 3. CurrencyVisual lookup tests.
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
// 4. TreeRenderer interface conformance + factory.
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

  it('createTreeRenderer({ kind: "canvas" }) throws (lands in P4b)', () => {
    const target: CreateTreeRendererTarget = { kind: 'canvas', canvas: {} };
    expect(() => createTreeRenderer(target)).toThrowError(/P4b/);
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
// 5. Pure helper functions (deriveSeasonalAppearance, resolveSpeciesShape,
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

// ----------------------------------------------------------------------------
// 6. Cross-cutting: representative-state snapshot for a full pipeline.
// ----------------------------------------------------------------------------

describe('representative state pipeline', () => {
  it('buildTreeRenderData + buildEnvironmentRenderData produce stable snapshots', () => {
    // A dead winter tree in a contaminated, polluted environment — the worst
    // case the renderer will need to draw.
    const tree = baseTree({
      alive: false,
      ageDays: 365 * 5,
      structure: { height: 8, trunkDiameter: 0.4, branchDevelopment: 30, structuralIntegrity: 0.6 },
      foliage: {
        currentLeaves: 0,
        leafCapacity: 3200,
        activeLeafArea: 0,
        seasonalCondition: 0,
        leafGrowthProgress: 0,
      },
      stress: 1,
      damage: [
        { type: 'severe-defoliation', severity: 0.8, appliedAt: 100 },
        { type: 'severe-defoliation', severity: 0.6, appliedAt: 130 },
      ],
    });
    const world = baseWorld({
      environment: {
        ...baseWorld().environment,
        soil: { ...baseWorld().environment.soil, health: 0.3, contamination: 80 },
        atmosphere: { ...baseWorld().environment.atmosphere, co2Concentration: 600, emissions: 40 },
        biodiversity: { ...baseWorld().environment.biodiversity, index: 0.2 },
      },
      weather: {
        condition: 'severe-storm',
        temperature: 2,
        intensity: 0.9,
        prevCondition: 'heavy-rain',
        daysInCondition: 1,
      },
    });
    const clock = baseClock({ season: 'winter', timeOfDay: 0.05 });

    const treeRender = buildTreeRenderData(tree, { season: 'winter' });
    const envRender = buildEnvironmentRenderData(world, clock);

    expect(treeRender).toMatchInlineSnapshot(`
      {
        "ageDays": 1825,
        "alive": false,
        "branchDevelopment": 30,
        "damage": [
          {
            "appliedAt": 100,
            "severity": 0.8,
            "type": "severe-defoliation",
          },
          {
            "appliedAt": 130,
            "severity": 0.6,
            "type": "severe-defoliation",
          },
        ],
        "foliageCondition": 0,
        "foliageDensity": 0,
        "height": 8,
        "leafCount": 0,
        "seasonalAppearance": "winter-bare",
        "speciesId": "species:white-oak",
        "speciesShape": "broadleaf-round",
        "trunkDiameter": 0.4,
      }
    `);
    expect(envRender).toMatchInlineSnapshot(`
      {
        "biodiversityLevel": 0.2,
        "co2Level": 600,
        "pollutionLevel": 1,
        "season": "winter",
        "soilCondition": 0.3,
        "soilContamination": 0.8,
        "timeOfDay": 0.05,
        "weatherCondition": "severe-storm",
        "weatherIntensity": 0.9,
      }
    `);
  });
});

// Silence the unused-import warning for SECONDS_PER_DAY (kept for parity with
// other test files in the repo; will be used when extending tests in P4b).
void SECONDS_PER_DAY;
