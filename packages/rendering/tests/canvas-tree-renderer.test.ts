/**
 * P4b unit tests — CanvasTreeRenderer (TDD §15.3, GDD §13.4).
 *
 * Covers:
 *   - Interface conformance: CanvasTreeRenderer satisfies TreeRenderer; the
 *     factory returns it for `kind: 'canvas'` instead of throwing P4b.
 *   - No-throw rendering for representative tree + environment states
 *     (sapling, mature, dead, defoliated, damaged; all four seasons; all
 *     weather conditions; day/dawn/night; pollution; contamination).
 *   - resize() updates dimensions + invalidates the cached structure.
 *   - dispose() is idempotent; subsequent render/resize are no-ops.
 *   - Mock canvas context snapshots: render a known state and assert the
 *     recorded canvas calls include sky fillRect + branch strokes + leaf
 *     ellipses + (for damaged trees) damage-marker arcs. Deterministic
 *     tree structure → stable call counts across renders.
 *   - Determinism: the same TreeRenderData yields the same cached signature
 *     + branch count + leaf-slot count across renders.
 *   - Rule 6 (TDD §15.1): render() never mutates `tree` or `env`.
 *
 * Mocks: a Proxy-based mock context records every property-set and method
 * call into a `calls` array. The mock canvas wraps it and exposes
 * `getContext('2d')`. Real HTMLCanvasElement would satisfy the same shape;
 * tests don't need a real DOM (vitest runs in node).
 *
 * Math.random: the renderer uses Math.random for particle-init positions
 * only (per spec). To keep snapshots deterministic, the snapshot tests use
 * sunny weather (no rain/snow particles) and summer season (no falling
 * leaves) — so no Math.random code paths execute.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildTreeRenderData,
  buildEnvironmentRenderData,
  createTreeRenderer,
  CanvasTreeRenderer,
  LEAF_BANKNOTE,
  GOLD_LEAF,
} from '../src/index.js';
import type {
  TreeRenderer,
  TreeRenderData,
  EnvironmentRenderData,
  CurrencyVisual,
  CreateTreeRendererTarget,
} from '../src/index.js';
import { baseTree, baseWorld, baseClock } from './_helpers.js';

// ----------------------------------------------------------------------------
// Mock canvas + 2D context (Proxy-based recorders).
// ----------------------------------------------------------------------------

interface RecordedCall {
  readonly op: string;
  readonly args: readonly unknown[];
}

/**
 * Mock 2D context — extends `CanvasRenderingContext2D` so the renderer's
 * typed calls type-check, AND exposes `calls` + `state` for assertions.
 *
 * Implemented as a Proxy: every property access returns a recording
 * function (for method calls), every property assignment records a
 * `set:<prop>` entry, and `createLinearGradient` / `createRadialGradient`
 * return gradient-like objects with their own recording `addColorStop`.
 *
 * The Proxy target is a plain object holding the `calls` array + `state`
 * record so both `proxy.calls` and `proxy.fillStyle = ...` work through
 * the traps. Spreading a Proxy enumerates only its target's own keys —
 * that's why earlier implementations that returned `{ ...ctx }` lost the
 * method-returning trap.
 */
interface MockContext extends CanvasRenderingContext2D {
  readonly calls: RecordedCall[];
  readonly state: Record<string, unknown>;
}

interface MockCanvas {
  width: number;
  height: number;
  getContext(
    contextId: '2d',
    options?: CanvasRenderingContext2DSettings,
  ): MockContext | null;
  readonly _mockContext: MockContext;
}

function createMockContext(): MockContext {
  const calls: RecordedCall[] = [];
  const state: Record<string, unknown> = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    lineCap: 'butt',
    lineJoin: 'miter',
    font: '10px sans-serif',
    textAlign: 'left',
    textBaseline: 'alphabetic',
  };

  const ctx = new Proxy(
    // Target — holds `calls` + `state` so they're accessible through both
    // direct access (`proxy.calls`) and the get trap.
    { calls, state },
    {
      get(target, prop) {
        if (prop === 'calls') return target.calls;
        if (prop === 'state') return target.state;
        if (typeof prop !== 'string') return undefined;
        if (prop in state) return state[prop];

        // Gradient factories return an object with a recording addColorStop.
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
          return (...args: unknown[]) => {
            calls.push({ op: prop, args });
            return {
              addColorStop: (stop: number, color: string) => {
                calls.push({ op: 'addColorStop', args: [stop, color] });
              },
            };
          };
        }
        // measureText returns a TextMetrics-like shape.
        if (prop === 'measureText') {
          return (...args: unknown[]) => {
            calls.push({ op: prop, args });
            return { width: 10 };
          };
        }
        // Generic method — record and return undefined.
        return (...args: unknown[]) => {
          calls.push({ op: prop, args });
        };
      },
      set(_t, prop, value) {
        if (typeof prop === 'string') {
          state[prop] = value;
          calls.push({ op: `set:${prop}`, args: [value] });
        }
        return true;
      },
    },
  );

  return ctx as unknown as MockContext;
}

/** Create a mock canvas wrapping a mock 2D context. */
function createMockCanvas(width = 600, height = 480): MockCanvas {
  const ctx = createMockContext();
  return {
    width,
    height,
    getContext: () => ctx,
    _mockContext: ctx,
  };
}

/** Summarise a calls array into { op → count } for compact snapshot asserts. */
function summariseCalls(calls: readonly RecordedCall[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of calls) {
    out[c.op] = (out[c.op] ?? 0) + 1;
  }
  // Sort keys for stable snapshot output.
  const sorted: Record<string, number> = {};
  for (const k of Object.keys(out).sort()) sorted[k] = out[k];
  return sorted;
}

// ----------------------------------------------------------------------------
// Fixtures — minimal TreeRenderData + EnvironmentRenderData for tests.
// ----------------------------------------------------------------------------

function summerMiddayEnv(): EnvironmentRenderData {
  return buildEnvironmentRenderData(baseWorld(), baseClock({ season: 'summer', timeOfDay: 0.5 }));
}

function matureSummerTree(): TreeRenderData {
  return buildTreeRenderData(baseTree(), { season: 'summer' });
}

// ----------------------------------------------------------------------------
// 1. Interface conformance + factory (TDD §15.3).
// ----------------------------------------------------------------------------

describe('CanvasTreeRenderer — interface conformance', () => {
  it('satisfies the TreeRenderer interface', () => {
    const canvas = createMockCanvas();
    const r: TreeRenderer = new CanvasTreeRenderer({ canvas });
    expect(r.targetKind).toBe('canvas');
    expect(typeof r.render).toBe('function');
    expect(typeof r.resize).toBe('function');
    expect(typeof r.dispose).toBe('function');
  });

  it('exposes inspection getters (width, height, disposed, currency)', () => {
    const canvas = createMockCanvas(640, 480);
    const r = new CanvasTreeRenderer({ canvas });
    expect(r.width).toBe(640);
    expect(r.height).toBe(480);
    expect(r.disposed).toBe(false);
    expect(r.currency.id).toBe('currency:leaf-dollar'); // default
  });

  it('accepts a currency override at construction', () => {
    const canvas = createMockCanvas();
    const r = new CanvasTreeRenderer({ canvas, currency: GOLD_LEAF });
    expect(r.currency.id).toBe('currency:gold-leaf');
  });

  it('createTreeRenderer({ kind: "canvas" }) returns a CanvasTreeRenderer (P4b lands)', () => {
    const canvas = createMockCanvas();
    const target: CreateTreeRendererTarget = { kind: 'canvas', canvas };
    const r = createTreeRenderer(target);
    expect(r).toBeInstanceOf(CanvasTreeRenderer);
    expect(r.targetKind).toBe('canvas');
  });

  it('createTreeRenderer({ kind: "canvas" }) throws if canvas is missing getContext', () => {
    // An empty object doesn't satisfy CanvasLike — factory should refuse it.
    const target: CreateTreeRendererTarget = { kind: 'canvas', canvas: {} };
    expect(() => createTreeRenderer(target)).toThrowError(/getContext/);
  });

  it('createTreeRenderer({ kind: "canvas" }) still throws for null canvas', () => {
    const target: CreateTreeRendererTarget = { kind: 'canvas', canvas: null };
    expect(() => createTreeRenderer(target)).toThrowError(/getContext/);
  });

  it('createTreeRenderer({ kind: "svg" }) still throws (future phase)', () => {
    const target: CreateTreeRendererTarget = { kind: 'svg', container: {} };
    expect(() => createTreeRenderer(target)).toThrowError(/future phase/);
  });
});

// ----------------------------------------------------------------------------
// 2. render() does not throw for representative states (TDD §15.3 contract).
//
// The TreeRenderer contract requires render() to never throw — a thrown
// exception would crash the animation frame loop. We exercise a wide matrix
// of tree + environment states to make sure defensive clamping + null-guards
// hold up.
// ----------------------------------------------------------------------------

describe('CanvasTreeRenderer.render — does not throw (representative states)', () => {
  const cases: ReadonlyArray<{
    name: string;
    tree: () => TreeRenderData;
    env: () => EnvironmentRenderData;
  }> = [
    { name: 'mature summer sunny midday', tree: matureSummerTree, env: summerMiddayEnv },
    {
      name: 'sapling spring sunny dawn',
      tree: () =>
        buildTreeRenderData(
          baseTree({
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
          }),
          { season: 'spring' },
        ),
      env: () =>
        buildEnvironmentRenderData(baseWorld(), baseClock({ season: 'spring', timeOfDay: 0.25 })),
    },
    {
      name: 'dead tree (alive=false) — stump only',
      tree: () =>
        buildTreeRenderData(
          baseTree({ alive: false, stress: 1, health: 0 }),
          { season: 'winter' },
        ),
      env: summerMiddayEnv,
    },
    {
      name: 'defoliated summer tree (zero leaves)',
      tree: () =>
        buildTreeRenderData(
          baseTree({
            foliage: {
              currentLeaves: 0,
              leafCapacity: 2050,
              activeLeafArea: 0,
              seasonalCondition: 1,
              leafGrowthProgress: 0,
            },
          }),
          { season: 'summer' },
        ),
      env: summerMiddayEnv,
    },
    {
      name: 'damaged tree with two damage markers',
      tree: () =>
        buildTreeRenderData(
          baseTree({
            damage: [
              { type: 'severe-defoliation', severity: 0.7, appliedAt: 100 },
              { type: 'wind-storm', severity: 0.3, appliedAt: 250 },
            ],
          }),
          { season: 'summer' },
        ),
      env: summerMiddayEnv,
    },
    {
      name: 'autumn tree (falling leaves spawn path)',
      tree: () => buildTreeRenderData(baseTree(), { season: 'autumn' }),
      env: () =>
        buildEnvironmentRenderData(baseWorld(), baseClock({ season: 'autumn', timeOfDay: 0.5 })),
    },
    {
      name: 'winter bare tree (deciduous)',
      tree: () => buildTreeRenderData(baseTree(), { season: 'winter' }),
      env: () =>
        buildEnvironmentRenderData(baseWorld(), baseClock({ season: 'winter', timeOfDay: 0.5 })),
    },
    {
      name: 'midnight winter storm (low light, severe weather)',
      tree: () => buildTreeRenderData(baseTree(), { season: 'winter' }),
      env: () =>
        buildEnvironmentRenderData(
          baseWorld({
            weather: {
              condition: 'severe-storm',
              temperature: 2,
              intensity: 0.9,
              prevCondition: 'heavy-rain',
              daysInCondition: 1,
            },
          }),
          baseClock({ season: 'winter', timeOfDay: 0.0 }),
        ),
    },
    {
      name: 'rainy autumn dusk with heavy pollution',
      tree: () => buildTreeRenderData(baseTree(), { season: 'autumn' }),
      env: () =>
        buildEnvironmentRenderData(
          baseWorld({
            environment: {
              ...baseWorld().environment,
              atmosphere: {
                ...baseWorld().environment.atmosphere,
                co2Concentration: 700,
                emissions: 80,
              },
              soil: { ...baseWorld().environment.soil, contamination: 60 },
            },
            weather: {
              condition: 'heavy-rain',
              temperature: 12,
              intensity: 0.8,
              prevCondition: 'rain',
              daysInCondition: 3,
            },
          }),
          baseClock({ season: 'autumn', timeOfDay: 0.75 }),
        ),
    },
    {
      name: 'frost winter (snow particles)',
      tree: () => buildTreeRenderData(baseTree(), { season: 'winter' }),
      env: () =>
        buildEnvironmentRenderData(
          baseWorld({
            weather: {
              condition: 'frost',
              temperature: -5,
              intensity: 0.7,
              prevCondition: 'sunny',
              daysInCondition: 1,
            },
          }),
          baseClock({ season: 'winter', timeOfDay: 0.3 }),
        ),
    },
    {
      name: 'all-weather-conditions sweep (no-throw)',
      tree: matureSummerTree,
      env: () => {
        // Use any single env; the sweep is below.
        return summerMiddayEnv();
      },
    },
  ];

  for (const c of cases) {
    it(`does not throw for: ${c.name}`, () => {
      const canvas = createMockCanvas();
      const r = new CanvasTreeRenderer({ canvas });
      expect(() => r.render(c.tree(), c.env(), 16)).not.toThrow();
      r.dispose();
    });
  }

  it('does not throw for every WeatherCondition value', () => {
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
    for (const cond of conditions) {
      const canvas = createMockCanvas();
      const r = new CanvasTreeRenderer({ canvas });
      const env = buildEnvironmentRenderData(
        baseWorld({
          weather: { ...baseWorld().weather, condition: cond, intensity: 0.7 },
        }),
        baseClock({ season: 'summer', timeOfDay: 0.5 }),
      );
      expect(() => r.render(matureSummerTree(), env, 16)).not.toThrow();
      r.dispose();
    }
  });

  it('does not throw when frameTimeMs is 0 (first frame)', () => {
    const canvas = createMockCanvas();
    const r = new CanvasTreeRenderer({ canvas });
    expect(() => r.render(matureSummerTree(), summerMiddayEnv(), 0)).not.toThrow();
    r.dispose();
  });

  it('does not throw when canvas has no 2D context (silent no-op)', () => {
    // Canvas whose getContext returns null.
    const canvas: MockCanvas = {
      width: 600,
      height: 480,
      getContext: () => null,
      _mockContext: null as unknown as MockContext,
    };
    const r = new CanvasTreeRenderer({ canvas });
    expect(() => r.render(matureSummerTree(), summerMiddayEnv(), 16)).not.toThrow();
    r.dispose();
  });

  it('does not throw when tree height = 0 (defensive)', () => {
    const canvas = createMockCanvas();
    const r = new CanvasTreeRenderer({ canvas });
    const tree = buildTreeRenderData(
      baseTree({
        structure: {
          height: 0,
          trunkDiameter: 0,
          branchDevelopment: 0,
          structuralIntegrity: 1,
        },
      }),
      { season: 'summer' },
    );
    expect(() => r.render(tree, summerMiddayEnv(), 16)).not.toThrow();
    r.dispose();
  });

  it('does not throw when env has NaN-safe edge values (timeOfDay boundaries)', () => {
    const canvas = createMockCanvas();
    const r = new CanvasTreeRenderer({ canvas });
    for (const tod of [0, 0.25, 0.5, 0.75, 0.999]) {
      const env = buildEnvironmentRenderData(baseWorld(), baseClock({ timeOfDay: tod }));
      expect(() => r.render(matureSummerTree(), env, 16)).not.toThrow();
    }
    r.dispose();
  });
});

// ----------------------------------------------------------------------------
// 3. resize() (TDD §15.3 — viewport changes).
// ----------------------------------------------------------------------------

describe('CanvasTreeRenderer.resize', () => {
  it('updates the viewport dimensions', () => {
    const canvas = createMockCanvas(600, 480);
    const r = new CanvasTreeRenderer({ canvas });
    expect(r.width).toBe(600);
    expect(r.height).toBe(480);
    r.resize(800, 600);
    expect(r.width).toBe(800);
    expect(r.height).toBe(600);
    // Canvas backing store was synced.
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
  });

  it('invalidates the cached structure (signature depends on canvas size)', () => {
    const canvas = createMockCanvas(600, 480);
    const r = new CanvasTreeRenderer({ canvas });
    r.render(matureSummerTree(), summerMiddayEnv(), 16);
    const sigBefore = r.cachedSignature;
    const branchCountBefore = r.cachedBranchCount;
    expect(sigBefore).not.toBeNull();
    r.resize(1024, 768);
    // Signature cleared; next render rebuilds.
    expect(r.cachedSignature).toBeNull();
    r.render(matureSummerTree(), summerMiddayEnv(), 16);
    expect(r.cachedSignature).not.toBeNull();
    // Layout may differ because of new viewport — at minimum, the signature
    // embeds the new width/height.
    expect(r.cachedSignature).not.toBe(sigBefore);
    // Branch count shouldn't be zero (tree still has structure).
    expect(r.cachedBranchCount).toBeGreaterThan(0);
    // Branch count may or may not equal the previous (depends on layout) —
    // we just assert it's positive.
    expect(branchCountBefore).toBeGreaterThan(0);
  });

  it('ignores negative dimensions (defensive)', () => {
    const canvas = createMockCanvas(600, 480);
    const r = new CanvasTreeRenderer({ canvas });
    r.resize(-1, -1);
    expect(r.width).toBe(600);
    expect(r.height).toBe(480);
  });

  it('ignores NaN dimensions (defensive)', () => {
    const canvas = createMockCanvas(600, 480);
    const r = new CanvasTreeRenderer({ canvas });
    r.resize(Number.NaN, Number.NaN);
    expect(r.width).toBe(600);
    expect(r.height).toBe(480);
  });

  it('is a no-op after dispose()', () => {
    const canvas = createMockCanvas(600, 480);
    const r = new CanvasTreeRenderer({ canvas });
    r.dispose();
    r.resize(1024, 768);
    expect(r.width).toBe(600); // unchanged
    expect(canvas.width).toBe(600);
  });

  it('is safe to call before render()', () => {
    const canvas = createMockCanvas(0, 0);
    const r = new CanvasTreeRenderer({ canvas, width: 100, height: 100 });
    r.resize(800, 600);
    expect(() => r.render(matureSummerTree(), summerMiddayEnv(), 16)).not.toThrow();
    r.dispose();
  });
});

// ----------------------------------------------------------------------------
// 4. dispose() (TDD §15.3 — resource release, idempotent).
// ----------------------------------------------------------------------------

describe('CanvasTreeRenderer.dispose', () => {
  it('is idempotent', () => {
    const canvas = createMockCanvas();
    const r = new CanvasTreeRenderer({ canvas });
    expect(() => r.dispose()).not.toThrow();
    expect(() => r.dispose()).not.toThrow();
    expect(() => r.dispose()).not.toThrow();
    expect(r.disposed).toBe(true);
  });

  it('stops further renders (render is a silent no-op)', () => {
    const canvas = createMockCanvas();
    const r = new CanvasTreeRenderer({ canvas });
    r.render(matureSummerTree(), summerMiddayEnv(), 16);
    const callsBefore = canvas._mockContext.calls.length;
    expect(callsBefore).toBeGreaterThan(0);
    r.dispose();
    // Clear the recorder to confirm no further calls land.
    canvas._mockContext.calls.length = 0;
    r.render(matureSummerTree(), summerMiddayEnv(), 16);
    expect(canvas._mockContext.calls.length).toBe(0);
  });

  it('clears the cached structure', () => {
    const canvas = createMockCanvas();
    const r = new CanvasTreeRenderer({ canvas });
    r.render(matureSummerTree(), summerMiddayEnv(), 16);
    expect(r.cachedSignature).not.toBeNull();
    r.dispose();
    expect(r.cachedSignature).toBeNull();
    expect(r.cachedBranchCount).toBe(0);
    expect(r.cachedLeafSlotCount).toBe(0);
  });

  it('setCurrency is a no-op after dispose', () => {
    const canvas = createMockCanvas();
    const r = new CanvasTreeRenderer({ canvas });
    r.dispose();
    r.setCurrency(GOLD_LEAF);
    expect(r.currency.id).toBe('currency:leaf-dollar'); // unchanged
  });
});

// ----------------------------------------------------------------------------
// 5. Mock context snapshots (representative states).
//
// Uses sunny summer midday weather to keep Math.random code paths dormant
// (no rain / snow / falling-leaf particles) — so the snapshot is deterministic
// across runs.
// ----------------------------------------------------------------------------

describe('CanvasTreeRenderer — mock context snapshot', () => {
  it('draws sky (fillRect over the full canvas) + ground band + tree (stroke branches + fill leaves)', () => {
    const canvas = createMockCanvas(600, 480);
    const r = new CanvasTreeRenderer({ canvas });
    r.render(matureSummerTree(), summerMiddayEnv(), 16);
    const calls = canvas._mockContext.calls;
    const summary = summariseCalls(calls);

    // Sky: at least one fillRect spanning the full canvas (or close to it).
    const fillRects = calls.filter((c) => c.op === 'fillRect');
    expect(fillRects.length).toBeGreaterThanOrEqual(2); // sky + ground + maybe damage
    // Sky fillRect should be full-width.
    const skyRect = fillRects.find((c) => {
      const [x, y, w, h] = c.args as [number, number, number, number];
      return x === 0 && y === 0 && w === 600 && h === 480;
    });
    expect(skyRect).toBeDefined();

    // Branches: at least one stroke (trunk) — moveTo + lineTo + stroke.
    expect(summary['beginPath'] ?? 0).toBeGreaterThan(0);
    expect(summary['moveTo'] ?? 0).toBeGreaterThan(0);
    expect(summary['lineTo'] ?? 0).toBeGreaterThan(0);
    expect(summary['stroke'] ?? 0).toBeGreaterThan(0);

    // Leaves: at least one ellipse + fill.
    expect(summary['ellipse'] ?? 0).toBeGreaterThan(0);
    expect(summary['fill'] ?? 0).toBeGreaterThan(0);

    // Sky gradient: createLinearGradient + at least 2 addColorStop calls.
    expect(summary['createLinearGradient'] ?? 0).toBeGreaterThan(0);
    expect(summary['addColorStop'] ?? 0).toBeGreaterThanOrEqual(2);

    // save/restore pairs.
    expect(summary['save'] ?? 0).toBe(summary['restore'] ?? 0);
    expect(summary['save']).toBeGreaterThan(0);

    r.dispose();
  });

  it('does NOT draw leaves for a dead tree (stump only)', () => {
    const canvas = createMockCanvas(600, 480);
    const r = new CanvasTreeRenderer({ canvas });
    const deadTree = buildTreeRenderData(
      baseTree({ alive: false, stress: 1, health: 0 }),
      { season: 'winter' },
    );
    r.render(deadTree, summerMiddayEnv(), 16);
    const calls = canvas._mockContext.calls;
    const summary = summariseCalls(calls);

    // Stump should have one beginPath + moveTo + lineTo + stroke (no leaves).
    expect(summary['ellipse'] ?? 0).toBe(0); // no leaves
    expect(summary['arc'] ?? 0).toBe(0); // no damage markers on stump
    expect(summary['beginPath'] ?? 0).toBeGreaterThan(0); // sky gradient doesn't use beginPath; stump stroke does
    expect(summary['stroke'] ?? 0).toBeGreaterThan(0); // stump outline

    expect(r.cachedIsStump).toBe(true);
    expect(r.cachedLeafSlotCount).toBe(0);
    r.dispose();
  });

  it('draws damage markers as arcs for a damaged living tree', () => {
    const canvas = createMockCanvas(600, 480);
    const r = new CanvasTreeRenderer({ canvas });
    const damagedTree = buildTreeRenderData(
      baseTree({
        damage: [
          { type: 'severe-defoliation', severity: 0.7, appliedAt: 100 },
          { type: 'wind-storm', severity: 0.3, appliedAt: 250 },
        ],
      }),
      { season: 'summer' },
    );
    r.render(damagedTree, summerMiddayEnv(), 16);
    const calls = canvas._mockContext.calls;
    const arcCount = calls.filter((c) => c.op === 'arc').length;
    // At least 2 arcs (one per damage marker). Leaves use ellipse, not arc.
    expect(arcCount).toBeGreaterThanOrEqual(2);
    r.dispose();
  });

  it('does not draw leaves in winter-bare deciduous state', () => {
    const canvas = createMockCanvas(600, 480);
    const r = new CanvasTreeRenderer({ canvas });
    const winterTree = buildTreeRenderData(baseTree(), { season: 'winter' });
    r.render(winterTree, summerMiddayEnv(), 16);
    const calls = canvas._mockContext.calls;
    const summary = summariseCalls(calls);
    // No leaves → no ellipse calls. Branches still drawn.
    expect(summary['ellipse'] ?? 0).toBe(0);
    expect(summary['stroke'] ?? 0).toBeGreaterThan(0); // branches
    r.dispose();
  });

  it('draws a pollution haze overlay when pollutionLevel > 0', () => {
    const canvas = createMockCanvas(600, 480);
    const r = new CanvasTreeRenderer({ canvas });
    const pollutedEnv = buildEnvironmentRenderData(
      baseWorld({
        environment: {
          ...baseWorld().environment,
          atmosphere: {
            ...baseWorld().environment.atmosphere,
            co2Concentration: 800,
            emissions: 50,
          },
        },
      }),
      baseClock({ season: 'summer', timeOfDay: 0.5 }),
    );
    expect(pollutedEnv.pollutionLevel).toBeGreaterThan(0.5);
    r.render(matureSummerTree(), pollutedEnv, 16);
    const calls = canvas._mockContext.calls;

    // Pollution haze draws a fillRect with globalAlpha < 1. Find at least
    // one fillRect preceded by a `set:globalAlpha` to a value < 1.
    let foundHaze = false;
    for (let i = 1; i < calls.length; i++) {
      const prev = calls[i - 1]!;
      const cur = calls[i]!;
      if (prev.op === 'set:globalAlpha' && typeof prev.args[0] === 'number' && prev.args[0] < 1 && cur.op === 'fillRect') {
        foundHaze = true;
        break;
      }
    }
    expect(foundHaze).toBe(true);
    r.dispose();
  });

  it('draws a day/night brightness overlay at midnight (timeOfDay = 0)', () => {
    const canvas = createMockCanvas(600, 480);
    const r = new CanvasTreeRenderer({ canvas });
    const midnightEnv = buildEnvironmentRenderData(baseWorld(), baseClock({ timeOfDay: 0.0 }));
    r.render(matureSummerTree(), midnightEnv, 16);
    const calls = canvas._mockContext.calls;
    // At midnight, brightness = NIGHT_LIGHT_LEVEL (0.25). dimAlpha = 0.75.
    // The lighting overlay records: save → set:globalAlpha 0.75 → set:fillStyle
    // '#000000' → fillRect. We look for that exact 4-call sequence.
    const lightingFillRect = calls.find((c, i) => {
      if (c.op !== 'fillRect') return false;
      const prev = calls[i - 1]; // set:fillStyle
      const prev2 = calls[i - 2]; // set:globalAlpha
      return (
        prev?.op === 'set:fillStyle' &&
        prev.args[0] === '#000000' &&
        prev2?.op === 'set:globalAlpha' &&
        typeof prev2.args[0] === 'number' &&
        Math.abs((prev2.args[0] as number) - 0.75) < 0.01
      );
    });
    expect(lightingFillRect).toBeDefined();
    r.dispose();
  });

  it('does not draw a brightness overlay at noon (brightness = 1)', () => {
    const canvas = createMockCanvas(600, 480);
    const r = new CanvasTreeRenderer({ canvas });
    // Noon — brightness = 1.0 → dimAlpha = 0 → no overlay.
    r.render(matureSummerTree(), summerMiddayEnv(), 16);
    const calls = canvas._mockContext.calls;
    // No fillRect with fillStyle #000000 + globalAlpha 0.75 should appear.
    const midnightOverlay = calls.find((c, i) => {
      if (c.op !== 'fillRect') return false;
      const prev = calls[i - 1]; // set:fillStyle
      const prev2 = calls[i - 2]; // set:globalAlpha
      return (
        prev?.op === 'set:fillStyle' &&
        prev.args[0] === '#000000' &&
        prev2?.op === 'set:globalAlpha' &&
        typeof prev2.args[0] === 'number' &&
        Math.abs((prev2.args[0] as number) - 0.75) < 0.01
      );
    });
    expect(midnightOverlay).toBeUndefined();
    r.dispose();
  });

  it('uses the banknote theme colour for leaves (us-greenback by default)', () => {
    const canvas = createMockCanvas(600, 480);
    const r = new CanvasTreeRenderer({ canvas }); // default = LEAF_BANKNOTE
    r.render(matureSummerTree(), summerMiddayEnv(), 16);
    const calls = canvas._mockContext.calls;
    // Find all set:fillStyle calls. Leaf fillStyle should be a hex colour
    // derived from the us-greenback theme (greens). At least one of #a3c98f,
    // #7eb463, #5a8f3a should appear after the first strokeStyle (which is
    // the branch colour, not a leaf).
    const fillStyles = calls
      .filter((c) => c.op === 'set:fillStyle')
      .map((c) => String(c.args[0]));
    // The theme colours should be blended with summer-green #3a8b3a — so the
    // exact hex won't match exactly. But we can check that green-ish hexes
    // appear (start with #5.., #6.., #7.., #8.., #9.., #a..).
    const greenishCount = fillStyles.filter((h) => /^#[5-9aA][0-9a-fA-F]{5}$|^#[0-9a-fA-F]{2}[6-9aA][0-9a-fA-F]{3}$/.test(h)).length;
    expect(greenishCount).toBeGreaterThan(0);
    r.dispose();
  });

  it('uses gold-foil theme colours when currency = GOLD_LEAF', () => {
    const canvas = createMockCanvas(600, 480);
    const r = new CanvasTreeRenderer({ canvas, currency: GOLD_LEAF });
    r.render(matureSummerTree(), summerMiddayEnv(), 16);
    const calls = canvas._mockContext.calls;
    const fillStyles = calls
      .filter((c) => c.op === 'set:fillStyle')
      .map((c) => String(c.args[0]));
    // Gold-foil tiers: #f5d76e, #e6b94e, #c69a3a (yellow/gold). After
    // blending with summer-green, leaves should be yellowish — first hex
    // char in {b..f}.
    const goldishCount = fillStyles.filter((h) => /^#[b-fB-F][0-9a-fA-F]{5}$/.test(h)).length;
    expect(goldishCount).toBeGreaterThan(0);
    r.dispose();
  });
});

// ----------------------------------------------------------------------------
// 6. Determinism (TDD §15.3 — procedural tree structure).
// ----------------------------------------------------------------------------

describe('CanvasTreeRenderer — determinism', () => {
  it('produces the same cached signature across multiple renders of the same tree', () => {
    const canvas = createMockCanvas();
    const r = new CanvasTreeRenderer({ canvas });
    r.render(matureSummerTree(), summerMiddayEnv(), 16);
    const sig1 = r.cachedSignature;
    const branchCount1 = r.cachedBranchCount;
    const leafSlotCount1 = r.cachedLeafSlotCount;
    r.render(matureSummerTree(), summerMiddayEnv(), 16);
    const sig2 = r.cachedSignature;
    const branchCount2 = r.cachedBranchCount;
    const leafSlotCount2 = r.cachedLeafSlotCount;

    expect(sig1).toBe(sig2);
    expect(branchCount1).toBe(branchCount2);
    expect(leafSlotCount1).toBe(leafSlotCount2);
    r.dispose();
  });

  it('produces different signatures when speciesId changes', () => {
    const canvas = createMockCanvas();
    const r = new CanvasTreeRenderer({ canvas });
    const oak = buildTreeRenderData(baseTree({ speciesId: 'species:white-oak' }), { season: 'summer' });
    const other = buildTreeRenderData(baseTree({ speciesId: 'species:future-banyan' }), { season: 'summer' });
    r.render(oak, summerMiddayEnv(), 16);
    const sig1 = r.cachedSignature;
    r.render(other, summerMiddayEnv(), 16);
    const sig2 = r.cachedSignature;
    expect(sig1).not.toBe(sig2);
    r.dispose();
  });

  it('produces different signatures when height changes', () => {
    const canvas = createMockCanvas();
    const r = new CanvasTreeRenderer({ canvas });
    const small = buildTreeRenderData(baseTree({ structure: { ...baseTree().structure, height: 2 } }), { season: 'summer' });
    const tall = buildTreeRenderData(baseTree({ structure: { ...baseTree().structure, height: 25 } }), { season: 'summer' });
    r.render(small, summerMiddayEnv(), 16);
    const sig1 = r.cachedSignature;
    r.render(tall, summerMiddayEnv(), 16);
    const sig2 = r.cachedSignature;
    expect(sig1).not.toBe(sig2);
    // Tall tree should produce more branches (more depth).
    expect(r.cachedBranchCount).toBeGreaterThan(1);
    r.dispose();
  });

  it('produces a stump layout (1 branch, 0 leaf slots) when alive=false', () => {
    const canvas = createMockCanvas();
    const r = new CanvasTreeRenderer({ canvas });
    const dead = buildTreeRenderData(baseTree({ alive: false, stress: 1, health: 0 }), { season: 'summer' });
    r.render(dead, summerMiddayEnv(), 16);
    expect(r.cachedIsStump).toBe(true);
    expect(r.cachedBranchCount).toBe(1); // just the stump
    expect(r.cachedLeafSlotCount).toBe(0);
    r.dispose();
  });

  it('rebuilds the cached structure only when the signature changes (not every frame)', () => {
    const canvas = createMockCanvas();
    const r = new CanvasTreeRenderer({ canvas });
    r.render(matureSummerTree(), summerMiddayEnv(), 16);
    const sig1 = r.cachedSignature;
    // Multiple renders with the same tree → same signature (no rebuild).
    r.render(matureSummerTree(), summerMiddayEnv(), 16);
    r.render(matureSummerTree(), summerMiddayEnv(), 16);
    expect(r.cachedSignature).toBe(sig1);
    r.dispose();
  });

  it('does not advance the LCG between frames with the same tree (no jitter)', () => {
    // Render the same tree twice; assert that the recorded canvas call count
    // is identical (the layout is deterministic, and the only per-frame
    // variation is the sway phase — which we don't expect to change call
    // count, only call args).
    const canvas = createMockCanvas();
    const r = new CanvasTreeRenderer({ canvas });
    r.render(matureSummerTree(), summerMiddayEnv(), 16);
    const calls1 = canvas._mockContext.calls.length;
    canvas._mockContext.calls.length = 0;
    r.render(matureSummerTree(), summerMiddayEnv(), 16);
    const calls2 = canvas._mockContext.calls.length;
    expect(calls1).toBe(calls2);
    r.dispose();
  });
});

// ----------------------------------------------------------------------------
// 7. Rule 6 — render() never mutates its inputs (TDD §15.1).
// ----------------------------------------------------------------------------

describe('CanvasTreeRenderer — rule 6 (render reads, never writes)', () => {
  it('does not mutate the TreeRenderData argument', () => {
    const canvas = createMockCanvas();
    const r = new CanvasTreeRenderer({ canvas });
    const tree = matureSummerTree();
    const before = JSON.stringify(tree);
    r.render(tree, summerMiddayEnv(), 16);
    expect(JSON.stringify(tree)).toBe(before);
    r.dispose();
  });

  it('does not mutate the EnvironmentRenderData argument', () => {
    const canvas = createMockCanvas();
    const r = new CanvasTreeRenderer({ canvas });
    const env = summerMiddayEnv();
    const before = JSON.stringify(env);
    r.render(matureSummerTree(), env, 16);
    expect(JSON.stringify(env)).toBe(before);
    r.dispose();
  });

  it('does not mutate the damage array on the TreeRenderData', () => {
    const canvas = createMockCanvas();
    const r = new CanvasTreeRenderer({ canvas });
    const tree = buildTreeRenderData(
      baseTree({
        damage: [
          { type: 'severe-defoliation', severity: 0.7, appliedAt: 100 },
          { type: 'wind-storm', severity: 0.3, appliedAt: 250 },
        ],
      }),
      { season: 'summer' },
    );
    const damageBefore = JSON.stringify(tree.damage);
    r.render(tree, summerMiddayEnv(), 16);
    expect(JSON.stringify(tree.damage)).toBe(damageBefore);
    r.dispose();
  });
});

// ----------------------------------------------------------------------------
// 8. Currency swap (TDD §15.4 — cosmetic selection).
// ----------------------------------------------------------------------------

describe('CanvasTreeRenderer — currency cosmetics', () => {
  it('setCurrency replaces the CurrencyVisual used for money-leaf visuals', () => {
    const canvas = createMockCanvas();
    const r = new CanvasTreeRenderer({ canvas });
    expect(r.currency.id).toBe('currency:leaf-dollar');
    r.setCurrency(GOLD_LEAF);
    expect(r.currency.id).toBe('currency:gold-leaf');
    r.dispose();
  });

  it('does not throw when rendering with each shipped CurrencyVisual', () => {
    const visuals: readonly CurrencyVisual[] = [LEAF_BANKNOTE, GOLD_LEAF];
    for (const v of visuals) {
      const canvas = createMockCanvas();
      const r = new CanvasTreeRenderer({ canvas, currency: v });
      expect(() => r.render(matureSummerTree(), summerMiddayEnv(), 16)).not.toThrow();
      r.dispose();
    }
  });
});

// ----------------------------------------------------------------------------
// 9. Multi-frame animation (TDD §15.3 — animation).
// ----------------------------------------------------------------------------

describe('CanvasTreeRenderer — multi-frame animation', () => {
  beforeEach(() => {
    // Mock Math.random so particle-init tests are deterministic.
    let i = 0;
    const original = Math.random;
    Math.random = () => {
      // Cycle through a deterministic sequence.
      i = (i + 1) % 100;
      return i / 100;
    };
    // Stash the original for afterEach.
    (Math.random as unknown as { _orig: () => number })._orig = original;
  });

  afterEach(() => {
    Math.random = (Math.random as unknown as { _orig: () => number })._orig;
  });

  it('advances the time accumulator across frames without leaking state', () => {
    const canvas = createMockCanvas();
    const r = new CanvasTreeRenderer({ canvas });
    // Render 10 frames — should not throw, no per-frame allocation errors.
    for (let i = 0; i < 10; i++) {
      expect(() => r.render(matureSummerTree(), summerMiddayEnv(), 16)).not.toThrow();
    }
    r.dispose();
  });

  it('renders rain particles across multiple rainy frames without exhausting the pool', () => {
    const canvas = createMockCanvas();
    const r = new CanvasTreeRenderer({ canvas });
    const rainyEnv = buildEnvironmentRenderData(
      baseWorld({
        weather: { ...baseWorld().weather, condition: 'heavy-rain', intensity: 1.0 },
      }),
      baseClock({ season: 'summer', timeOfDay: 0.5 }),
    );
    for (let i = 0; i < 30; i++) {
      expect(() => r.render(matureSummerTree(), rainyEnv, 16)).not.toThrow();
    }
    // The renderer should have drawn at least one line (rain streak).
    const calls = canvas._mockContext.calls;
    const strokeCount = calls.filter((c) => c.op === 'stroke').length;
    expect(strokeCount).toBeGreaterThan(0);
    r.dispose();
  });

  it('renders snow particles for frost weather', () => {
    const canvas = createMockCanvas();
    const r = new CanvasTreeRenderer({ canvas });
    const frostyEnv = buildEnvironmentRenderData(
      baseWorld({
        weather: { ...baseWorld().weather, condition: 'frost', intensity: 0.9 },
      }),
      baseClock({ season: 'winter', timeOfDay: 0.3 }),
    );
    for (let i = 0; i < 30; i++) {
      expect(() => r.render(matureSummerTree(), frostyEnv, 16)).not.toThrow();
    }
    // Snow particles use arc() (not ellipse), so we should see more arcs
    // than just the damage markers (which there are none of here since tree
    // has no damage).
    const calls = canvas._mockContext.calls;
    const arcCount = calls.filter((c) => c.op === 'arc').length;
    expect(arcCount).toBeGreaterThan(0);
    r.dispose();
  });
});
