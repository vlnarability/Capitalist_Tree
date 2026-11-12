/**
 * P4a unit tests — EnvironmentRenderData mapping (TDD §15.2, GDD §13.4
 * surrounding environment).
 *
 * Covers:
 *   - buildEnvironmentRenderData: weather / season / time-of-day / soil /
 *     contamination / CO2 / pollution combinations for representative
 *     environment states.
 *   - Rule-6 immutability (mapping never mutates its inputs).
 *   - Inline snapshot for a representative polluted cloudy winter night.
 *   - Cross-pipeline snapshot: a dead winter tree in a contaminated,
 *     polluted environment combined with buildTreeRenderData — the worst
 *     case the renderer (P4b/P4c) will need to draw.
 *
 * These tests run in node (no DOM). The rendering package's tsconfig
 * excludes DOM types — these tests follow suit.
 */
import { describe, it, expect } from 'vitest';
import {
  buildTreeRenderData,
  buildEnvironmentRenderData,
} from '../src/index.js';
import { baseTree, baseWorld, baseClock } from './_helpers.js';

// ----------------------------------------------------------------------------
// 1. buildEnvironmentRenderData — mapping tests (TDD §15.2, GDD §13.4).
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

  it('accepts option overrides for the CO2 haze floor + saturation', () => {
    // With co2HazeFloorPpm=0 + co2HazeSaturationPpm=200, a co2Level of 100
    // → co2Excess=100, co2Span=200 → co2Pollution=0.5.
    const world = baseWorld({
      environment: {
        ...baseWorld().environment,
        atmosphere: { ...baseWorld().environment.atmosphere, co2Concentration: 100 },
      },
    });
    const out = buildEnvironmentRenderData(world, baseClock(), {
      co2HazeFloorPpm: 0,
      co2HazeSaturationPpm: 200,
    });
    expect(out.pollutionLevel).toBeCloseTo(0.5, 6);
  });

  it('accepts a contaminationFullDegrade override', () => {
    const world = baseWorld({
      environment: {
        ...baseWorld().environment,
        soil: { ...baseWorld().environment.soil, contamination: 25 },
      },
    });
    // With contaminationFullDegrade=50, 25/50 = 0.5.
    const out = buildEnvironmentRenderData(world, baseClock(), {
      contaminationFullDegrade: 50,
    });
    expect(out.soilContamination).toBeCloseTo(0.5, 6);
  });

  it('does NOT mutate the input world or clock (rule 6)', () => {
    const world = baseWorld();
    const clock = baseClock();
    const worldBefore = JSON.stringify(world);
    const clockBefore = JSON.stringify(clock);
    buildEnvironmentRenderData(world, clock);
    expect(JSON.stringify(world)).toBe(worldBefore);
    expect(JSON.stringify(clock)).toBe(clockBefore);
  });

  it('returns fresh objects on each call (no shared state)', () => {
    const a = buildEnvironmentRenderData(baseWorld(), baseClock());
    const b = buildEnvironmentRenderData(baseWorld(), baseClock());
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
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
// 2. Cross-cutting: representative-state pipeline snapshot.
//
// Tests that buildTreeRenderData + buildEnvironmentRenderData work together
// to produce a coherent combined snapshot for the worst-case scenario the
// renderer will need to draw (P4b Canvas / P4c environment): a dead tree
// in a contaminated, polluted, severe-storm winter environment.
// ----------------------------------------------------------------------------

describe('representative state pipeline', () => {
  it('buildTreeRenderData + buildEnvironmentRenderData produce stable snapshots', () => {
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
