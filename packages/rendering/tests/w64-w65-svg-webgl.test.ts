/**
 * W64/W65 — SVG + WebGL renderer tests.
 *
 * Both backends implement the `TreeRenderer` interface (targetKind, render,
 * resize, dispose), share the exact layout (`buildTreeLayout`) with Canvas,
 * + never throw inside `render()` (TDD §15.3). The SVG renderer writes markup
 * to a container's `innerHTML`; the WebGL renderer draws via a GL context.
 *
 * Tests run in node (no real DOM / GPU), so they use mock containers + a mock
 * WebGL context (a Proxy that returns fake objects for the create-and-get
 * methods + no-ops for the rest, with GL constants as numeric properties). The mock is enough
 * for the renderer to compile its program + draw without throwing.
 */
import { describe, it, expect } from 'vitest';
import {
  createTreeRenderer,
  SvgTreeRenderer,
  WebGlTreeRenderer,
  buildTreeRenderData,
  buildEnvironmentRenderData,
} from '../src/index.js';
import { baseTree, baseWorld, baseClock } from './_helpers.js';
import type { TreeRenderData, EnvironmentRenderData } from '../src/index.js';

// ----------------------------------------------------------------------------
// Mocks.
// ----------------------------------------------------------------------------

/** Mock SVG container — a plain object with a settable `innerHTML`. */
function makeMockContainer(): { innerHTML: string } {
  return { innerHTML: '' };
}

/** GL constants the renderer references (numeric, matching the WebGL spec). */
const GL_CONST: Record<string, number> = {
  VERTEX_SHADER: 35633,
  FRAGMENT_SHADER: 35632,
  ARRAY_BUFFER: 34962,
  STATIC_DRAW: 35044,
  FLOAT: 5126,
  COLOR_BUFFER_BIT: 16384,
  LINES: 1,
  POINTS: 0,
  COMPILE_STATUS: 35713,
  LINK_STATUS: 35714,
};

/**
 * Mock WebGL context — returns fake objects for createShader/createProgram/
 * createBuffer, `true` for get*Parameter, `0` for getAttribLocation, + a
 * no-op for every other method. GL constants are exposed as numeric props.
 * Enough for WebGlTreeRenderer to compile + draw without a real GPU.
 */
function makeMockWebGlContext(): WebGLRenderingContext {
  return new Proxy({ ...GL_CONST } as Record<string, unknown>, {
    get: (target, prop: string) => {
      if (prop in target) return (target as Record<string, unknown>)[prop];
      if (prop === 'createShader' || prop === 'createProgram' || prop === 'createBuffer')
        return () => ({ __fake: prop });
      if (prop === 'getShaderParameter' || prop === 'getProgramParameter')
        return () => true;
      if (prop === 'getAttribLocation') return () => 0;
      return () => undefined; // every other method is a no-op
    },
    set: () => true,
  }) as unknown as WebGLRenderingContext;
}

/** Mock WebGL canvas — exposes `getContext('webgl')` returning the mock ctx. */
function makeMockWebGlCanvas(): { width: number; height: number; getContext: (id: 'webgl') => WebGLRenderingContext | null } {
  const ctx = makeMockWebGlContext();
  return { width: 600, height: 480, getContext: () => ctx };
}

/** Build a TreeRenderData + EnvironmentRenderData pair for a given species/season. */
function makeRenderData(
  speciesId: string,
  season: 'spring' | 'summer' | 'autumn' | 'winter',
): { tree: TreeRenderData; env: EnvironmentRenderData } {
  const tree = buildTreeRenderData(baseTree({ speciesId }), { season });
  const env = buildEnvironmentRenderData(baseWorld(), baseClock());
  return { tree, env };
}

// ----------------------------------------------------------------------------
// W64 — SvgTreeRenderer.
// ----------------------------------------------------------------------------

describe('W64 — SvgTreeRenderer', () => {
  it('satisfies the TreeRenderer interface + targetKind', () => {
    const r = new SvgTreeRenderer({ container: makeMockContainer() });
    expect(r.targetKind).toBe('svg');
    expect(typeof r.render).toBe('function');
    expect(typeof r.resize).toBe('function');
    expect(typeof r.dispose).toBe('function');
  });

  it('render() writes SVG markup to the container (no throw)', () => {
    const container = makeMockContainer();
    const r = new SvgTreeRenderer({ container });
    const { tree, env } = makeRenderData('species:white-oak', 'summer');
    expect(() => r.render(tree, env, 16)).not.toThrow();
    expect(container.innerHTML).toContain('<svg');
    expect(container.innerHTML).toContain('<line'); // branches
    expect(container.innerHTML).toContain('<circle'); // leaves
  });

  it('renders a distinct palm silhouette (frond fan, no broad branches)', () => {
    const container = makeMockContainer();
    const r = new SvgTreeRenderer({ container });
    const { tree, env } = makeRenderData('species:date-palm', 'summer');
    r.render(tree, env, 16);
    // Palm has branchDepth=0 → only the trunk segment (1 <line> for the trunk).
    const lineCount = (container.innerHTML.match(/<line/g) || []).length;
    expect(lineCount).toBe(1);
    // Leaves are still drawn (the frond crown).
    expect(container.innerHTML).toContain('<circle');
  });

  it('winter-bare trees draw branches but no leaves', () => {
    const container = makeMockContainer();
    const r = new SvgTreeRenderer({ container });
    const { tree, env } = makeRenderData('species:white-oak', 'winter');
    r.render(tree, env, 16);
    expect(container.innerHTML).toContain('<line'); // branches still drawn
    // No leaf circles — winter-bare skips foliage.
    expect(container.innerHTML).not.toContain('<circle');
  });

  it('dead trees render a stump (one branch segment, no leaves)', () => {
    const container = makeMockContainer();
    const r = new SvgTreeRenderer({ container });
    const tree = buildTreeRenderData(baseTree({ speciesId: 'species:white-oak', alive: false }), { season: 'summer' });
    const env = buildEnvironmentRenderData(baseWorld(), baseClock());
    r.render(tree, env, 16);
    const lineCount = (container.innerHTML.match(/<line/g) || []).length;
    expect(lineCount).toBe(1); // stump only
    expect(container.innerHTML).not.toContain('<circle'); // no leaves on a stump
  });

  it('second render with the same tree reuses the cached layout (no throw)', () => {
    const container = makeMockContainer();
    const r = new SvgTreeRenderer({ container });
    const { tree, env } = makeRenderData('species:white-oak', 'summer');
    r.render(tree, env, 16);
    const firstHtml = container.innerHTML;
    r.render(tree, env, 16); // signature unchanged → cached layout
    expect(container.innerHTML).toBe(firstHtml);
  });

  it('resize + dispose work; render after dispose is a no-op', () => {
    const container = makeMockContainer();
    const r = new SvgTreeRenderer({ container });
    r.resize(800, 600);
    expect(r.width).toBe(800);
    expect(r.height).toBe(600);
    r.dispose();
    expect(r.disposed).toBe(true);
    const { tree, env } = makeRenderData('species:white-oak', 'summer');
    const before = container.innerHTML;
    r.render(tree, env, 16); // disposed → no-op
    expect(container.innerHTML).toBe(before);
  });

  it('factory: createTreeRenderer({ kind: "svg" }) returns an SvgTreeRenderer', () => {
    const container = makeMockContainer();
    const r = createTreeRenderer({ kind: 'svg', container });
    expect(r).toBeInstanceOf(SvgTreeRenderer);
    expect(r.targetKind).toBe('svg');
  });

  it('factory: createTreeRenderer({ kind: "svg" }) throws if container is missing', () => {
    expect(() => createTreeRenderer({ kind: 'svg', container: null })).toThrowError(/container/);
  });
});

// ----------------------------------------------------------------------------
// W65 — WebGlTreeRenderer.
// ----------------------------------------------------------------------------

describe('W65 — WebGlTreeRenderer', () => {
  it('satisfies the TreeRenderer interface + targetKind', () => {
    const r = new WebGlTreeRenderer({ canvas: makeMockWebGlCanvas() });
    expect(r.targetKind).toBe('webgl');
    expect(typeof r.render).toBe('function');
    expect(typeof r.resize).toBe('function');
    expect(typeof r.dispose).toBe('function');
  });

  it('render() with a mock GL context does not throw', () => {
    const r = new WebGlTreeRenderer({ canvas: makeMockWebGlCanvas() });
    const { tree, env } = makeRenderData('species:date-palm', 'summer');
    expect(() => r.render(tree, env, 16)).not.toThrow();
    // Second render reuses the cached program + layout.
    expect(() => r.render(tree, env, 16)).not.toThrow();
  });

  it('renders each shape without throwing (round/oval/conical/columnar/palm)', () => {
    const r = new WebGlTreeRenderer({ canvas: makeMockWebGlCanvas() });
    const shapes: Array<[string, 'spring' | 'summer' | 'autumn' | 'winter']> = [
      ['species:white-oak', 'summer'],
      ['species:kapok', 'summer'],
      ['species:eastern-hemlock', 'autumn'],
      ['species:lodgepole-pine', 'summer'],
      ['species:date-palm', 'summer'],
    ];
    for (const [speciesId, season] of shapes) {
      const { tree, env } = makeRenderData(speciesId, season);
      expect(() => r.render(tree, env, 16)).not.toThrow();
    }
  });

  it('render() with a null GL context is a silent no-op (no throw)', () => {
    const canvas = { width: 600, height: 480, getContext: () => null };
    const r = new WebGlTreeRenderer({ canvas });
    const { tree, env } = makeRenderData('species:white-oak', 'summer');
    expect(() => r.render(tree, env, 16)).not.toThrow();
  });

  it('winter-bare trees render without throwing (no leaf buffer path)', () => {
    const r = new WebGlTreeRenderer({ canvas: makeMockWebGlCanvas() });
    const { tree, env } = makeRenderData('species:white-oak', 'winter');
    expect(() => r.render(tree, env, 16)).not.toThrow();
  });

  it('resize + dispose work; render after dispose is a no-op', () => {
    const r = new WebGlTreeRenderer({ canvas: makeMockWebGlCanvas() });
    r.resize(800, 600);
    expect(r.width).toBe(800);
    expect(r.height).toBe(600);
    r.dispose();
    expect(r.disposed).toBe(true);
    const { tree, env } = makeRenderData('species:white-oak', 'summer');
    expect(() => r.render(tree, env, 16)).not.toThrow(); // disposed → no-op
  });

  it('factory: createTreeRenderer({ kind: "webgl" }) returns a WebGlTreeRenderer', () => {
    const canvas = makeMockWebGlCanvas();
    const r = createTreeRenderer({ kind: 'webgl', canvas });
    expect(r).toBeInstanceOf(WebGlTreeRenderer);
    expect(r.targetKind).toBe('webgl');
  });

  it('factory: createTreeRenderer({ kind: "webgl" }) throws if canvas is missing getContext', () => {
    expect(() => createTreeRenderer({ kind: 'webgl', canvas: {} })).toThrowError(/getContext/);
  });
});
