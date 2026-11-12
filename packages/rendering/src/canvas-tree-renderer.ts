/**
 * CanvasTreeRenderer — procedural Canvas 2D TreeRenderer (P4b, TDD §15.3).
 *
 * Renders a procedural tree to an HTMLCanvasElement's 2D context. Implements
 * the full `TreeRenderer` interface so consumers (P4d React wrapper) can swap
 * it with the headless stub (P4a) without changing call sites.
 *
 * Architecture (10 Capitalist Tree rules — see docs/GDD.txt §16):
 *
 *   - Rule 6 (TDD §15.1): rendering reads state, NEVER writes. The renderer
 *     does not mutate `tree` or `env`. Every biological / economic value was
 *     already decided by the simulation before this method runs.
 *   - Procedural tree (TDD §15.3 — "procedural tree structure"): a recursive
 *     branch generator seeded by a deterministic LCG. The seed is derived
 *     from the tree's structural signature (species + height + trunkDiameter
 *     + branchDevelopment + alive + ageDays). The same TreeRenderData always
 *     produces the same branch layout — a sapling doesn't jitter frame-to-frame.
 *   - Animation (TDD §15.3 — "leaf harvesting animations", "weather effects"):
 *     branch sway is a sine of `frameTimeMs × frequency`, NOT an LCG advance,
 *     so the structure stays deterministic while the canopy gently moves.
 *     Weather + falling-leaf particles live in pre-allocated fixed-size pools
 *     (no per-frame allocation). Particle init positions use Math.random per
 *     spec ("Math.random OK for particle init positions only").
 *   - Environment (TDD §15.2 — soil, weather, pollution, time-of-day, season):
 *     sky gradient interpolated across night/dawn/day/dusk anchors by
 *     `env.timeOfDay`; ground band tinted by `env.soilCondition` + contamination;
 *     weather particles (rain / snow) driven by `env.weatherCondition` +
 *     `env.weatherIntensity`; pollution haze alpha by `env.pollutionLevel`;
 *     day/night brightness overlay by `env.timeOfDay`.
 *   - Money-leaf visuals (TDD §15.4, GDD §14): each leaf draws as a small
 *     banknote-coloured rectangle. The CurrencyVisual's `banknoteTheme`
 *     resolves to a per-tier colour triplet via the theme registry. Higher
 *     tiers are drawn larger so high-denomination leaves read at a glance.
 *   - Seasonal state (GDD §4.4): spring draws small + sparse budding leaves;
 *     summer draws the full vibrant canopy; autumn draws orange-shifted
 *     leaves (with a falling-leaf particle animation); winter draws no
 *     leaves for deciduous species (White Oak in P1). Dead trees render as
 *     a bare stump.
 *   - Damage markers (GDD §13.4 — physical damage): small dark-red circles
 *     placed along the trunk, one per `tree.damage[]` entry. Marker radius
 *     scales with severity; position along the trunk is derived from
 *     `appliedAt` so distinct damage events sit at distinct heights.
 *
 * The renderer NEVER throws inside `render()` for malformed input — it
 * clamps, no-ops, or skips. The TreeRenderer contract (TDD §15.3) requires
 * a stable frame loop, and a thrown exception in render() would crash the
 * animation frame. Construction can throw (canvas must exist); render()
 * cannot.
 */
import type {
  TreeRenderData,
  EnvironmentRenderData,
  TreeRenderer,
  CurrencyVisual,
  SeasonalAppearance,
} from './types.js';
import { getDefaultCurrencyVisual } from './currency-visuals.js';
import {
  // Layout + scaling.
  PROVISIONAL_RENDER_TREE_HEIGHT_SCALE_PX_PER_M,
  PROVISIONAL_RENDER_TRUNK_DIAMETER_SCALE_PX_PER_M,
  PROVISIONAL_RENDER_MIN_TREE_HEIGHT_PX,
  PROVISIONAL_RENDER_MAX_TREE_HEIGHT_PX,
  PROVISIONAL_RENDER_DAMAGE_MARKER_RADIUS_PX,
  PROVISIONAL_RENDER_FOLIAGE_HEALTHY_THRESHOLD,
  PROVISIONAL_RENDER_FOLIAGE_STRESSED_THRESHOLD,
  PROVISIONAL_RENDER_SOIL_HEALTHY_COLOR,
  PROVISIONAL_RENDER_SOIL_DEGRADED_COLOR,
  PROVISIONAL_RENDER_SOIL_CONTAMINATION_TINT,
  PROVISIONAL_RENDER_POLLUTION_HAZE_MAX_OPACITY,
  PROVISIONAL_RENDER_RAIN_OPACITY_MAX,
  PROVISIONAL_RENDER_CLOUD_OPACITY_MAX,
  PROVISIONAL_RENDER_SNOW_OPACITY_MAX,
  PROVISIONAL_RENDER_NIGHT_LIGHT_LEVEL,
  PROVISIONAL_RENDER_DAWN_DUSK_LIGHT_LEVEL,
  PROVISIONAL_RENDER_DAY_LIGHT_LEVEL,
  // Canvas-specific.
  PROVISIONAL_RENDER_CANVAS_TARGET_KIND,
  PROVISIONAL_RENDER_CANVAS_DEFAULT_WIDTH_PX,
  PROVISIONAL_RENDER_CANVAS_DEFAULT_HEIGHT_PX,
  PROVISIONAL_RENDER_GROUND_HEIGHT_FRACTION,
  PROVISIONAL_RENDER_TREE_BASELINE_FRACTION,
  PROVISIONAL_RENDER_TRUNK_COLOR,
  PROVISIONAL_RENDER_TRUNK_DEAD_COLOR,
  PROVISIONAL_RENDER_BRANCH_COLOR,
  PROVISIONAL_RENDER_DAMAGE_MARKER_COLOR,
  PROVISIONAL_RENDER_FOLIAGE_SPRING_COLOR,
  PROVISIONAL_RENDER_FOLIAGE_SUMMER_COLOR,
  PROVISIONAL_RENDER_FOLIAGE_AUTUMN_COLOR,
  PROVISIONAL_RENDER_FOLIAGE_WINTER_COLOR,
  PROVISIONAL_RENDER_FOLIAGE_STRESSED_TINT,
  PROVISIONAL_RENDER_SKY_NIGHT_TOP,
  PROVISIONAL_RENDER_SKY_NIGHT_BOTTOM,
  PROVISIONAL_RENDER_SKY_DAWN_TOP,
  PROVISIONAL_RENDER_SKY_DAWN_BOTTOM,
  PROVISIONAL_RENDER_SKY_DAY_TOP,
  PROVISIONAL_RENDER_SKY_DAY_BOTTOM,
  PROVISIONAL_RENDER_SKY_DUSK_TOP,
  PROVISIONAL_RENDER_SKY_DUSK_BOTTOM,
  PROVISIONAL_RENDER_CLOUD_COLOR,
  PROVISIONAL_RENDER_GRASS_COLOR,
  PROVISIONAL_RENDER_RAIN_PARTICLE_POOL_SIZE,
  PROVISIONAL_RENDER_SNOW_PARTICLE_POOL_SIZE,
  PROVISIONAL_RENDER_FALLING_LEAF_POOL_SIZE,
  PROVISIONAL_RENDER_WIND_SWAY_AMPLITUDE_PX,
  PROVISIONAL_RENDER_WIND_SWAY_FREQUENCY_HZ,
  PROVISIONAL_RENDER_MAX_BRANCH_DEPTH,
  PROVISIONAL_RENDER_BRANCH_ANGLE_SPREAD_DEG,
  PROVISIONAL_RENDER_BRANCH_LENGTH_DECAY,
  PROVISIONAL_RENDER_BRANCH_DIAMETER_DECAY,
  PROVISIONAL_RENDER_BRANCH_CHILD_COUNT,
  PROVISIONAL_RENDER_LEAF_TIER0_SIZE_PX,
  PROVISIONAL_RENDER_LEAF_TIER1_SIZE_PX,
  PROVISIONAL_RENDER_LEAF_TIER2_SIZE_PX,
  PROVISIONAL_RENDER_LEAF_OUTLINE_WIDTH_PX,
  PROVISIONAL_RENDER_BANKNOTE_THEME_US_GREENBACK,
  PROVISIONAL_RENDER_BANKNOTE_THEME_GOLD_FOIL,
  PROVISIONAL_RENDER_BANKNOTE_THEME_EURO_VIOLET,
  PROVISIONAL_RENDER_BANKNOTE_THEME_FALLBACK,
  PROVISIONAL_RENDER_DAY_PHASE_NIGHT_TOD,
  PROVISIONAL_RENDER_DAY_PHASE_DAWN_TOD,
  PROVISIONAL_RENDER_DAY_PHASE_DAY_TOD,
  PROVISIONAL_RENDER_DAY_PHASE_DUSK_TOD,
} from './constants/rendering.js';

// ============================================================================
// Duck-typed canvas / context surface types.
//
// Decoupling the renderer from the full `HTMLCanvasElement` /
// `CanvasRenderingContext2D` types lets unit tests pass mock objects cast
// through `unknown`. The real DOM types are still allowed at runtime — they
// satisfy these structural shapes automatically.
// ============================================================================

/**
 * Minimal canvas-like surface the renderer needs. Real HTMLCanvasElement
 * satisfies this structurally; tests pass a mock that satisfies the same
 * shape.
 */
export interface CanvasLike {
  width: number;
  height: number;
  getContext(
    contextId: '2d',
    options?: CanvasRenderingContext2DSettings,
  ): CanvasRenderingContext2D | null;
}

/**
 * Constructor options for `CanvasTreeRenderer`.
 *
 * `canvas` is the DOM canvas (or mock) the renderer draws to. The renderer
 * acquires the 2D context once at construction; if `getContext('2d')`
 * returns null (e.g. context-lost, or a non-canvas element), `render()` is
 * a silent no-op rather than throwing — this keeps the animation frame loop
 * stable (TDD §15.3 contract: render() never throws).
 *
 * `currency` overrides the default CurrencyVisual (TDD §15.4). Defaults to
 * `LEAF_BANKNOTE` (US-dollar-style green banknote leaves).
 *
 * `width` / `height` set the initial viewport; if omitted, the renderer
 * reads them from the canvas (or falls back to the provisional defaults).
 */
export interface CanvasTreeRendererOptions {
  readonly canvas: CanvasLike;
  readonly currency?: CurrencyVisual;
  readonly width?: number;
  readonly height?: number;
}

// ============================================================================
// Internal data shapes (layout cache + particle pools).
// ============================================================================

/** A pre-computed branch segment in the cached layout. */
interface BranchSegment {
  /** Start point (canvas px, origin top-left). */
  readonly x0: number;
  readonly y0: number;
  /** End point (canvas px). */
  readonly x1: number;
  readonly y1: number;
  /** Recursion depth from the trunk (0 = trunk itself). */
  readonly depth: number;
  /** Diameter in px. */
  readonly diameter: number;
}

/** A pre-computed leaf attachment slot. */
interface LeafSlot {
  /** Position (canvas px). */
  readonly x: number;
  readonly y: number;
  /** Currency denomination tier (0..2). */
  readonly tier: number;
  /** Per-slot sway phase offset (radians). */
  readonly phaseOffset: number;
  /** Per-slot size jitter multiplier (~1.0). */
  readonly sizeJitter: number;
}

/** A pre-computed damage marker placement. */
interface DamageMarkerPlacement {
  readonly x: number;
  readonly y: number;
  readonly severity: number;
  readonly type: string;
}

/**
 * Cached tree structure (recomputed only when the structural signature
 * changes — see `treeStructureSignature`).
 */
interface CachedTreeStructure {
  readonly signature: string;
  readonly branches: readonly BranchSegment[];
  readonly leafSlots: readonly LeafSlot[];
  readonly damageMarkers: readonly DamageMarkerPlacement[];
  /** True when the tree is dead (alive=false) — renderer draws a stump only. */
  readonly stump: boolean;
  /** Trunk base (canvas px, origin top-left). */
  readonly baseX: number;
  readonly baseY: number;
  /** Rendered tree height (px, clamped to MIN/MAX). */
  readonly treeHeightPx: number;
  /** Trunk length (px). */
  readonly trunkLengthPx: number;
  /** Trunk diameter (px). */
  readonly trunkDiameterPx: number;
}

/** A particle in any of the pools (rain / snow / falling leaf). */
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Remaining lifetime in ms (falling leaves only). */
  life: number;
  /** Max lifetime in ms (falling leaves only). */
  maxLife: number;
  /** Visual size in px. */
  size: number;
  /** Active flag — slot is in use this frame. */
  active: boolean;
  /** Rotation (radians, falling leaves only). */
  rotation: number;
  /** Rotation speed (rad/ms, falling leaves only). */
  rotationSpeed: number;
  /** Currency tier (falling leaves only — drives colour). */
  tier: number;
  /** Per-particle phase offset (radians, snow drift only). */
  phaseOffset: number;
}

// ============================================================================
// LCG — deterministic pseudo-random for tree structure.
//
// Per spec ("Math.random OK for particle init positions only; tree structure
// uses deterministic LCG"), the procedural tree layout is driven by this LCG
// seeded from the tree's structural signature. Math.random is reserved for
// particle pool init (which is non-deterministic but cosmetic).
// ============================================================================

/**
 * Linear-congruential generator (Numerical Recipes constants). Deterministic
 * across JS engines (unlike Math.random) — the same seed always produces the
 * same sequence, so the same TreeRenderData always produces the same tree.
 */
function createLcg(seed: number): () => number {
  let s = seed >>> 0;
  // Avoid the degenerate seed=0 case (the LCG would stay at 0 for one step).
  if (s === 0) s = 0xdeadbeef;
  return () => {
    // a = 1664525, c = 1013904223, m = 2^32 (Numerical Recipes).
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * FNV-1a string hash → uint32 seed. Used to derive a deterministic LCG seed
 * from the tree's structural signature string.
 */
function hashStringToSeed(s: string): number {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// ============================================================================
// Colour helpers — hex → rgb + lerp. Tiny and pure.
// ============================================================================

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** Parse a `#rrggbb` hex string into an {r, g, b} triple. Defensive: returns
 * black on unparseable input (so a typo in a constant can't crash render). */
function parseHex(hex: string): Rgb {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return { r: 0, g: 0, b: 0 };
  const v = parseInt(m[1]!, 16);
  return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
}

/** Linear-interpolate two {r,g,b} triples. t=0 → a, t=1 → b. */
function lerpRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const u = Math.min(1, Math.max(0, t));
  return {
    r: a.r + (b.r - a.r) * u,
    g: a.g + (b.g - a.g) * u,
    b: a.b + (b.b - a.b) * u,
  };
}

/** Convert an {r,g,b} triple back to a `#rrggbb` string. */
function rgbToHex(c: Rgb): string {
  const r = Math.round(c.r).toString(16).padStart(2, '0');
  const g = Math.round(c.g).toString(16).padStart(2, '0');
  const b = Math.round(c.b).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

/** Linear-interpolate two hex colours, returning a `#rrggbb` string. */
function lerpHex(a: string, b: string, t: number): string {
  return rgbToHex(lerpRgb(parseHex(a), parseHex(b), t));
}

// ============================================================================
// Signature — what triggers a layout rebuild.
// ============================================================================

/**
 * Derive the structural signature for a tree. Only fields that affect the
 * LAYOUT (branch positions, leaf-slot positions) are included. Cosmetic
 * per-frame fields (foliage density, damage list, seasonal appearance) do
 * NOT trigger a rebuild — they're applied at draw time against the cached
 * layout.
 *
 * This keeps per-frame cost low: a tree growing slowly (height ticks up
 * each sim step) rebuilds only when height crosses an integer metre, not
 * on every animation frame.
 */
function treeStructureSignature(tree: TreeRenderData, width: number, height: number): string {
  return [
    tree.speciesId,
    tree.speciesShape,
    // Quantise height to 0.1 m to avoid thrashing the cache during slow growth.
    Math.round(tree.height * 10) / 10,
    // Quantise trunk diameter to 0.01 m.
    Math.round(tree.trunkDiameter * 100) / 100,
    // Quantise branchDevelopment to nearest 0.5 unit (0..100 → 200 buckets).
    Math.round(tree.branchDevelopment * 2) / 2,
    tree.alive ? 'alive' : 'dead',
    // ageDays affects trunk texture (sapling vs mature) but is a coarse driver.
    Math.floor(tree.ageDays / 10),
    width,
    height,
  ].join('|');
}

// ============================================================================
// Theme registry — banknote theme name → per-tier colour triplet.
// ============================================================================

const BANKNOTE_THEME_MAP: Readonly<Record<string, Readonly<{ tier0: string; tier1: string; tier2: string }>>> =
  Object.freeze({
    'us-greenback': PROVISIONAL_RENDER_BANKNOTE_THEME_US_GREENBACK,
    'gold-foil': PROVISIONAL_RENDER_BANKNOTE_THEME_GOLD_FOIL,
    'euro-violet': PROVISIONAL_RENDER_BANKNOTE_THEME_EURO_VIOLET,
  });

/** Resolve a CurrencyVisual's banknoteTheme to a per-tier colour triplet. */
function resolveBanknoteTheme(theme: string): Readonly<{ tier0: string; tier1: string; tier2: string }> {
  return BANKNOTE_THEME_MAP[theme] ?? PROVISIONAL_RENDER_BANKNOTE_THEME_FALLBACK;
}

/** Pick the leaf size (half-extent, px) for a given tier. */
function leafSizeForTier(tier: number): number {
  switch (tier) {
    case 0:
      return PROVISIONAL_RENDER_LEAF_TIER0_SIZE_PX;
    case 1:
      return PROVISIONAL_RENDER_LEAF_TIER1_SIZE_PX;
    case 2:
      return PROVISIONAL_RENDER_LEAF_TIER2_SIZE_PX;
    default:
      return PROVISIONAL_RENDER_LEAF_TIER0_SIZE_PX;
  }
}

// ============================================================================
// Seasonal helpers.
// ============================================================================

/**
 * Seasonal canopy-density multiplier. Drives how many of the cached leaf
 * slots are active this frame. Spring draws ~60% of slots (budding); summer
 * draws 100%; autumn draws ~50% (senescence thinning); winter draws 0% for
 * deciduous species (P1 White Oak). Evergreens (P6+) will use a different
 * table — for P4b the deciduous table is the only one shipped.
 */
function seasonalCanopyFactor(seasonal: SeasonalAppearance): number {
  switch (seasonal) {
    case 'spring-buds':
      return 0.6;
    case 'summer-green':
      return 1.0;
    case 'autumn-color':
      return 0.5;
    case 'winter-bare':
      return 0.0;
  }
}

/** Foliage base colour for a seasonal appearance (used for leaf tinting). */
function seasonalFoliageColor(seasonal: SeasonalAppearance): string {
  switch (seasonal) {
    case 'spring-buds':
      return PROVISIONAL_RENDER_FOLIAGE_SPRING_COLOR;
    case 'summer-green':
      return PROVISIONAL_RENDER_FOLIAGE_SUMMER_COLOR;
    case 'autumn-color':
      return PROVISIONAL_RENDER_FOLIAGE_AUTUMN_COLOR;
    case 'winter-bare':
      return PROVISIONAL_RENDER_FOLIAGE_WINTER_COLOR;
  }
}

// ============================================================================
// Particle pool factory.
// ============================================================================

/** Allocate a particle pool of `n` inactive particles. */
function makePool(n: number): Particle[] {
  const pool: Particle[] = [];
  for (let i = 0; i < n; i++) {
    pool.push({
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      maxLife: 1,
      size: 1,
      active: false,
      rotation: 0,
      rotationSpeed: 0,
      tier: 0,
      phaseOffset: 0,
    });
  }
  return pool;
}

/** Find the first inactive slot in a pool, or null if all are busy. */
function findInactiveSlot(pool: Particle[]): Particle | null {
  for (let i = 0; i < pool.length; i++) {
    if (!pool[i]!.active) return pool[i]!;
  }
  return null;
}

// ============================================================================
// CanvasTreeRenderer — the main P4b implementation.
// ============================================================================

/**
 * Canvas TreeRenderer implementation (P4b — TDD §15.3, GDD §13.4).
 *
 * Renders a procedural tree + environment to a 2D canvas context. See the
 * file header for the full architecture writeup.
 *
 * Lifecycle:
 *   - constructor: acquires the 2D context, allocates particle pools.
 *   - render: reads TreeRenderData + EnvironmentRenderData, draws one frame.
 *   - resize: updates canvas dimensions, invalidates the layout cache.
 *   - dispose: clears the cache + pools; further renders are no-ops.
 *
 * Mutability contract (rule 6): render() does NOT mutate `tree` or `env`.
 * The renderer holds internal mutable state (layout cache, particle pools,
 * time accumulator) — but never writes back to the inputs.
 */
export class CanvasTreeRenderer implements TreeRenderer {
  public readonly targetKind: 'canvas' = PROVISIONAL_RENDER_CANVAS_TARGET_KIND;

  private readonly _canvas: CanvasLike;
  private readonly _ctx: CanvasRenderingContext2D | null;
  private _width: number;
  private _height: number;
  private _disposed = false;
  private _currency: CurrencyVisual;

  // Cached structure — recomputed only when the structural signature changes.
  private _cachedStructure: CachedTreeStructure | null = null;

  // Particle pools — pre-allocated, reused across frames (no per-frame alloc).
  private readonly _rainPool: Particle[];
  private readonly _snowPool: Particle[];
  private readonly _leafPool: Particle[];

  // Animation time accumulator (ms). Advanced by frameTimeMs each render.
  private _timeAccumMs = 0;

  // Track last weather condition to spin particle pools up/down cleanly.
  private _lastWeatherCondition: string | null = null;

  constructor(options: CanvasTreeRendererOptions) {
    this._canvas = options.canvas;
    this._ctx = this._canvas.getContext('2d');

    // Initial viewport: explicit option > canvas.width > default.
    this._width =
      options.width ??
      (this._canvas.width > 0 ? this._canvas.width : PROVISIONAL_RENDER_CANVAS_DEFAULT_WIDTH_PX);
    this._height =
      options.height ??
      (this._canvas.height > 0 ? this._canvas.height : PROVISIONAL_RENDER_CANVAS_DEFAULT_HEIGHT_PX);

    // Sync the canvas backing store to our viewport if it's still zero.
    if (this._canvas.width === 0) this._canvas.width = this._width;
    if (this._canvas.height === 0) this._canvas.height = this._height;

    this._currency = options.currency ?? getDefaultCurrencyVisual();

    this._rainPool = makePool(PROVISIONAL_RENDER_RAIN_PARTICLE_POOL_SIZE);
    this._snowPool = makePool(PROVISIONAL_RENDER_SNOW_PARTICLE_POOL_SIZE);
    this._leafPool = makePool(PROVISIONAL_RENDER_FALLING_LEAF_POOL_SIZE);
  }

  // -------------------------------------------------------------------------
  // TreeRenderer interface.
  // -------------------------------------------------------------------------

  render(tree: TreeRenderData, env: EnvironmentRenderData, frameTimeMs: number): void {
    if (this._disposed) return;
    if (!this._ctx) return; // No 2D context — silent no-op (TDD §15.3: render never throws).
    if (!Number.isFinite(frameTimeMs) || frameTimeMs < 0) return; // Defensive.

    const ctx = this._ctx;
    this._timeAccumMs += frameTimeMs;

    // Update cached structure if signature changed.
    const sig = treeStructureSignature(tree, this._width, this._height);
    if (!this._cachedStructure || this._cachedStructure.signature !== sig) {
      this._cachedStructure = this._buildStructure(tree, sig);
    }
    const struct = this._cachedStructure;

    // 1. Environment: sky + ground (drawn first so the tree sits on top).
    this._renderSky(ctx, env);
    this._renderGround(ctx, env);

    // 2. Tree: branches, leaves, damage markers.
    this._renderTree(ctx, tree, struct, env);

    // 3. Weather particles (rain / snow) — drawn on top of the tree.
    this._renderWeatherParticles(ctx, env, frameTimeMs);

    // 4. Pollution haze — semi-transparent overlay.
    this._renderPollutionHaze(ctx, env);

    // 5. Day/night lighting overlay — multiplies the scene by brightness.
    this._renderLightingOverlay(ctx, env);

    this._lastWeatherCondition = env.weatherCondition;
  }

  resize(width: number, height: number): void {
    if (this._disposed) return;
    if (!Number.isFinite(width) || !Number.isFinite(height)) return;
    if (width < 0 || height < 0) return; // Defensive — ignore negative sizes.
    this._width = Math.round(width);
    this._height = Math.round(height);
    this._canvas.width = this._width;
    this._canvas.height = this._height;
    // Layout depends on canvas size — invalidate the cache.
    this._cachedStructure = null;
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._cachedStructure = null;
    // Pools are plain-object arrays — drop references so GC can reclaim them.
    this._rainPool.length = 0;
    this._snowPool.length = 0;
    this._leafPool.length = 0;
  }

  // -------------------------------------------------------------------------
  // Inspection helpers (NOT part of TreeRenderer — for tests + P4d debugging).
  // -------------------------------------------------------------------------

  /** Current viewport width (px). */
  get width(): number {
    return this._width;
  }
  /** Current viewport height (px). */
  get height(): number {
    return this._height;
  }
  /** True after dispose() has been called. */
  get disposed(): boolean {
    return this._disposed;
  }
  /** The CurrencyVisual currently driving money-leaf cosmetics. */
  get currency(): CurrencyVisual {
    return this._currency;
  }
  /** The cached structure signature, or null if no render has occurred. */
  get cachedSignature(): string | null {
    return this._cachedStructure?.signature ?? null;
  }
  /** Number of branch segments in the cached layout (0 if no render yet). */
  get cachedBranchCount(): number {
    return this._cachedStructure?.branches.length ?? 0;
  }
  /** Number of leaf slots in the cached layout (0 if no render yet). */
  get cachedLeafSlotCount(): number {
    return this._cachedStructure?.leafSlots.length ?? 0;
  }
  /** True if the cached layout is a stump (dead tree). */
  get cachedIsStump(): boolean {
    return this._cachedStructure?.stump ?? false;
  }
  /**
   * Replace the CurrencyVisual. Useful for P4d's currency-picker UI — the
   * player can swap cosmetics at runtime without re-creating the renderer.
   * Cosmetic selection MUST NOT modify the underlying monetary value
   * (TDD §15.4) — this method only changes how the renderer paints leaves.
   */
  setCurrency(c: CurrencyVisual): void {
    if (this._disposed) return;
    this._currency = c;
  }

  // -------------------------------------------------------------------------
  // Layout — build / cache the procedural tree structure.
  // -------------------------------------------------------------------------

  /**
   * Build (or rebuild) the cached procedural structure for `tree`. Uses a
   * deterministic LCG seeded from `signature` so the same tree always
   * produces the same layout.
   */
  private _buildStructure(tree: TreeRenderData, signature: string): CachedTreeStructure {
    const baseX = this._width / 2;
    const baseY = this._height * PROVISIONAL_RENDER_TREE_BASELINE_FRACTION;

    // Rendered tree height: clamp height × scale into [MIN, MAX] px.
    const treeHeightPx = Math.min(
      PROVISIONAL_RENDER_MAX_TREE_HEIGHT_PX,
      Math.max(
        PROVISIONAL_RENDER_MIN_TREE_HEIGHT_PX,
        tree.height * PROVISIONAL_RENDER_TREE_HEIGHT_SCALE_PX_PER_M,
      ),
    );

    // Trunk diameter in px. Floor at 2 px so saplings still have a visible trunk.
    const trunkDiameterPx = Math.max(
      2,
      tree.trunkDiameter * PROVISIONAL_RENDER_TRUNK_DIAMETER_SCALE_PX_PER_M,
    );

    // Dead tree → stump only.
    if (!tree.alive) {
      const stumpHeightPx = Math.min(treeHeightPx * 0.18, 50);
      const stump: BranchSegment = {
        x0: baseX,
        y0: baseY,
        x1: baseX,
        y1: baseY - stumpHeightPx,
        depth: 0,
        diameter: trunkDiameterPx * 1.3, // Stumps are stubby + thick.
      };
      return {
        signature,
        branches: [stump],
        leafSlots: [],
        damageMarkers: [], // Damage markers are not drawn on a stump.
        stump: true,
        baseX,
        baseY,
        treeHeightPx: stumpHeightPx,
        trunkLengthPx: stumpHeightPx,
        trunkDiameterPx: stump.diameter,
      };
    }

    // Trunk length: ~45% of tree height (canopy occupies the remaining 55%).
    const trunkLengthPx = treeHeightPx * 0.45;

    // Branch recursion depth: derived from branchDevelopment (0..100 → 1..MAX).
    const branchDepth = Math.max(
      1,
      Math.min(
        PROVISIONAL_RENDER_MAX_BRANCH_DEPTH,
        1 + Math.floor(tree.branchDevelopment / 25),
      ),
    );

    // LCG seeded from the structural signature.
    const rng = createLcg(hashStringToSeed(signature));

    // Recursive branch generator.
    const branches: BranchSegment[] = [];
    const angleSpreadRad = (PROVISIONAL_RENDER_BRANCH_ANGLE_SPREAD_DEG * Math.PI) / 180;

    const grow = (
      x0: number,
      y0: number,
      angle: number, // 0 = straight up; positive = clockwise.
      length: number,
      diameter: number,
      depth: number,
    ): void => {
      const x1 = x0 + Math.sin(angle) * length;
      const y1 = y0 - Math.cos(angle) * length;
      branches.push({ x0, y0, x1, y1, depth, diameter });

      if (depth >= branchDepth) return;

      const childCount = PROVISIONAL_RENDER_BRANCH_CHILD_COUNT;
      const childLen = length * PROVISIONAL_RENDER_BRANCH_LENGTH_DECAY;
      const childDia = Math.max(0.5, diameter * PROVISIONAL_RENDER_BRANCH_DIAMETER_DECAY);

      for (let i = 0; i < childCount; i++) {
        // Even fan distribution across [-1, +1] when there are multiple
        // children; falls back to straight-ahead when only one. Using a
        // `Math.max(1, ...)` denom avoids divide-by-zero without tripping
        // TS2367 (which would flag a `childCount === 1` literal-type check
        // against the constant `2`).
        const denom = Math.max(1, childCount - 1);
        const t = (i / denom) * 2 - 1;
        const jitter = (rng() * 2 - 1) * 0.4; // ±40% jitter.
        const childAngleOffset = (t + jitter) * angleSpreadRad;
        // Children fan outward from the parent's direction.
        let childAngle = angle + childAngleOffset;

        // Constrain: children must not bend backward below the parent's start.
        // (Prevents branches that grow back down into the ground.)
        if (childAngle > Math.PI / 2) childAngle = Math.PI / 2;
        if (childAngle < -Math.PI / 2) childAngle = -Math.PI / 2;

        // Slight upward bias so the canopy stays round, not drooping.
        const upwardBias = (1 - depth / branchDepth) * 0.15;
        const biasedAngle = childAngle * (1 - upwardBias * 0.2);

        grow(x1, y1, biasedAngle, childLen, childDia, depth + 1);
      }
    };

    grow(baseX, baseY, 0, trunkLengthPx, trunkDiameterPx, 0);

    // ----- Leaf slots -----
    // Distribute leaf slots around the canopy. The canopy is roughly a
    // disc centered on the trunk top, radius = treeHeightPx × 0.35.
    // Each slot's tier is picked from a deterministic distribution:
    //   ~70% tier 0, ~20% tier 1, ~10% tier 2 (provisional tier weights).
    const canopyCenterX = baseX;
    const canopyCenterY = baseY - trunkLengthPx - treeHeightPx * 0.2;
    const canopyRadius = treeHeightPx * 0.35;

    // Cap the total slot count to keep per-frame draw cost bounded. The
    // seasonal canopy factor (below) reduces the active count further.
    const maxSlots = 120;
    // Density from foliageDensity (so a sparse canopy has fewer slots).
    const densityFactor = Math.min(1, Math.max(0, tree.foliageDensity));
    const slotCount = Math.max(0, Math.round(maxSlots * densityFactor));

    const leafSlots: LeafSlot[] = [];
    for (let i = 0; i < slotCount; i++) {
      // Random point inside a disc (rejection sampling).
      const r = Math.sqrt(rng()) * canopyRadius;
      const theta = rng() * Math.PI * 2;
      const x = canopyCenterX + Math.cos(theta) * r;
      const y = canopyCenterY + Math.sin(theta) * r;
      // Pick tier: 0 (70%), 1 (20%), 2 (10%).
      const tierRoll = rng();
      const tier = tierRoll < 0.7 ? 0 : tierRoll < 0.9 ? 1 : 2;
      // Per-slot sway phase offset + size jitter (drives variety at draw time).
      const phaseOffset = rng() * Math.PI * 2;
      const sizeJitter = 0.8 + rng() * 0.4; // 0.8..1.2
      leafSlots.push({ x, y, tier, phaseOffset, sizeJitter });
    }

    // ----- Damage markers -----
    // Place each damage entry along the trunk at a height derived from its
    // appliedAt timestamp (so distinct events sit at distinct heights).
    const damageMarkers: DamageMarkerPlacement[] = [];
    for (const d of tree.damage) {
      const t = (d.appliedAt % 1000) / 1000; // 0..1 — wraps so multiple events spread.
      const yOffset = trunkLengthPx * (0.1 + t * 0.8); // 10%..90% up the trunk.
      const xOffset = (trunkDiameterPx / 2 + 2) * (d.appliedAt % 2 === 0 ? 1 : -1);
      damageMarkers.push({
        x: baseX + xOffset,
        y: baseY - yOffset,
        severity: Math.min(1, Math.max(0, d.severity)),
        type: d.type,
      });
    }

    return {
      signature,
      branches,
      leafSlots,
      damageMarkers,
      stump: false,
      baseX,
      baseY,
      treeHeightPx,
      trunkLengthPx,
      trunkDiameterPx,
    };
  }

  // -------------------------------------------------------------------------
  // Sky rendering — gradient by timeOfDay (TDD §15.2, GDD §4.1).
  // -------------------------------------------------------------------------

  private _renderSky(ctx: CanvasRenderingContext2D, env: EnvironmentRenderData): void {
    const tod = env.timeOfDay;
    // Pick the two anchor phases to interpolate between.
    // Anchor order (wrapping): NIGHT(0) → DAWN(0.25) → DAY(0.5) → DUSK(0.75) → NIGHT(1.0)
    const phases: ReadonlyArray<{ tod: number; top: string; bottom: string }> = [
      { tod: PROVISIONAL_RENDER_DAY_PHASE_NIGHT_TOD, top: PROVISIONAL_RENDER_SKY_NIGHT_TOP, bottom: PROVISIONAL_RENDER_SKY_NIGHT_BOTTOM },
      { tod: PROVISIONAL_RENDER_DAY_PHASE_DAWN_TOD, top: PROVISIONAL_RENDER_SKY_DAWN_TOP, bottom: PROVISIONAL_RENDER_SKY_DAWN_BOTTOM },
      { tod: PROVISIONAL_RENDER_DAY_PHASE_DAY_TOD, top: PROVISIONAL_RENDER_SKY_DAY_TOP, bottom: PROVISIONAL_RENDER_SKY_DAY_BOTTOM },
      { tod: PROVISIONAL_RENDER_DAY_PHASE_DUSK_TOD, top: PROVISIONAL_RENDER_SKY_DUSK_TOP, bottom: PROVISIONAL_RENDER_SKY_DUSK_BOTTOM },
      // Wrap: dusk → next-night.
      { tod: 1.0, top: PROVISIONAL_RENDER_SKY_NIGHT_TOP, bottom: PROVISIONAL_RENDER_SKY_NIGHT_BOTTOM },
    ];
    // Find the segment tod falls into.
    let a = phases[0]!;
    let b = phases[phases.length - 1]!;
    for (let i = 0; i < phases.length - 1; i++) {
      const p0 = phases[i]!;
      const p1 = phases[i + 1]!;
      if (tod >= p0.tod && tod <= p1.tod) {
        a = p0;
        b = p1;
        break;
      }
    }
    const span = b.tod - a.tod || 1;
    const t = Math.min(1, Math.max(0, (tod - a.tod) / span));
    const top = lerpHex(a.top, b.top, t);
    const bottom = lerpHex(a.bottom, b.bottom, t);

    const grad = ctx.createLinearGradient(0, 0, 0, this._height);
    grad.addColorStop(0, top);
    grad.addColorStop(1, bottom);
    ctx.save();
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this._width, this._height);
    ctx.restore();

    // Cloud overlay: alpha by weatherIntensity for cloudy / rainy / stormy.
    if (this._isCloudy(env.weatherCondition)) {
      const cloudAlpha = env.weatherIntensity * PROVISIONAL_RENDER_CLOUD_OPACITY_MAX;
      if (cloudAlpha > 0.001) {
        ctx.save();
        ctx.globalAlpha = cloudAlpha;
        ctx.fillStyle = PROVISIONAL_RENDER_CLOUD_COLOR;
        ctx.fillRect(0, 0, this._width, this._height * (1 - PROVISIONAL_RENDER_GROUND_HEIGHT_FRACTION));
        ctx.restore();
      }
    }
  }

  /** True for weather conditions that produce a cloud overlay. */
  private _isCloudy(condition: EnvironmentRenderData['weatherCondition']): boolean {
    return (
      condition === 'cloudy' ||
      condition === 'rain' ||
      condition === 'heavy-rain' ||
      condition === 'severe-storm'
    );
  }

  // -------------------------------------------------------------------------
  // Ground rendering — soil colour + contamination tint (TDD §15.2, GDD §13.4).
  // -------------------------------------------------------------------------

  private _renderGround(ctx: CanvasRenderingContext2D, env: EnvironmentRenderData): void {
    const groundTop = this._height * (1 - PROVISIONAL_RENDER_GROUND_HEIGHT_FRACTION);
    const soilCondition = Math.min(1, Math.max(0, env.soilCondition));
    const soilColor = lerpHex(
      PROVISIONAL_RENDER_SOIL_DEGRADED_COLOR,
      PROVISIONAL_RENDER_SOIL_HEALTHY_COLOR,
      soilCondition,
    );

    ctx.save();
    ctx.fillStyle = soilColor;
    ctx.fillRect(0, groundTop, this._width, this._height - groundTop);

    // Grass strip at the soil/air boundary (subtle).
    ctx.fillStyle = PROVISIONAL_RENDER_GRASS_COLOR;
    ctx.globalAlpha = 0.35 + soilCondition * 0.4;
    ctx.fillRect(0, groundTop, this._width, 3);
    ctx.globalAlpha = 1;

    // Contamination tint (rusty red-brown) blended over the soil.
    const contamination = Math.min(1, Math.max(0, env.soilContamination));
    if (contamination > 0.001) {
      ctx.globalAlpha = contamination * 0.6;
      ctx.fillStyle = PROVISIONAL_RENDER_SOIL_CONTAMINATION_TINT;
      ctx.fillRect(0, groundTop, this._width, this._height - groundTop);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // Tree rendering — branches, leaves, damage markers (TDD §15.3, GDD §13.4).
  // -------------------------------------------------------------------------

  private _renderTree(
    ctx: CanvasRenderingContext2D,
    tree: TreeRenderData,
    struct: CachedTreeStructure,
    env: EnvironmentRenderData,
  ): void {
    // Wind sway: sinusoidal, scaled by branch depth (tips sway more).
    const swayAmplitude =
      PROVISIONAL_RENDER_WIND_SWAY_AMPLITUDE_PX *
      (tree.branchDevelopment / 100) *
      // Stormy weather amplifies sway; still air dampens it.
      (env.weatherCondition === 'wind' || env.weatherCondition === 'severe-storm' ? 1.6 : 1.0);
    const swayPhase = this._timeAccumMs * 0.001 * PROVISIONAL_RENDER_WIND_SWAY_FREQUENCY_HZ * Math.PI * 2;

    // ----- Branches -----
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const seg of struct.branches) {
      // Sway offset scales with depth (0 at trunk base, max at tips).
      const depthFactor = seg.depth / Math.max(1, PROVISIONAL_RENDER_MAX_BRANCH_DEPTH);
      const swayX = Math.sin(swayPhase + seg.depth * 0.5) * swayAmplitude * depthFactor;
      // Stump segments don't sway.
      const offsetX = struct.stump ? 0 : swayX;
      ctx.lineWidth = seg.diameter;
      ctx.strokeStyle = struct.stump ? PROVISIONAL_RENDER_TRUNK_DEAD_COLOR : PROVISIONAL_RENDER_BRANCH_COLOR;
      // Trunk (depth 0) gets a slightly darker, thicker stroke.
      if (seg.depth === 0 && !struct.stump) {
        ctx.strokeStyle = PROVISIONAL_RENDER_TRUNK_COLOR;
      }
      ctx.beginPath();
      ctx.moveTo(seg.x0, seg.y0);
      ctx.lineTo(seg.x1 + offsetX, seg.y1);
      ctx.stroke();
    }
    ctx.restore();

    // ----- Leaves -----
    // Skip for stumps (dead trees) and winter-bare deciduous.
    if (!struct.stump && tree.alive) {
      this._renderLeaves(ctx, tree, struct, swayPhase, env);
    }

    // ----- Damage markers (only for living trees with damage) -----
    if (!struct.stump && struct.damageMarkers.length > 0) {
      this._renderDamageMarkers(ctx, struct);
    }
  }

  private _renderLeaves(
    ctx: CanvasRenderingContext2D,
    tree: TreeRenderData,
    struct: CachedTreeStructure,
    swayPhase: number,
    env: EnvironmentRenderData,
  ): void {
    const seasonal = tree.seasonalAppearance;
    const canopyFactor = seasonalCanopyFactor(seasonal);
    if (canopyFactor <= 0) return; // Winter-bare: no leaves.

    // Density from foliageDensity (defensive clamp).
    const density = Math.min(1, Math.max(0, tree.foliageDensity));
    const condition = Math.min(1, Math.max(0, tree.foliageCondition));

    // Active leaf count = round(slots × canopyFactor × density × conditionFactor)
    // conditionFactor reduces visible leaves when stressed (stressed leaves
    // are sparse / yellowing). Below STRESSED threshold, reduce to 70%; below
    // 0.1, reduce to 30%.
    let conditionFactor = 1.0;
    if (condition < PROVISIONAL_RENDER_FOLIAGE_STRESSED_THRESHOLD) {
      conditionFactor = 0.3 + 0.4 * (condition / PROVISIONAL_RENDER_FOLIAGE_STRESSED_THRESHOLD);
    }
    const activeCount = Math.round(struct.leafSlots.length * canopyFactor * density * conditionFactor);
    if (activeCount <= 0) return;

    // Resolve banknote theme + per-tier colours.
    const theme = resolveBanknoteTheme(this._currency.banknoteTheme);
    const tierColors: readonly string[] = [theme.tier0, theme.tier1, theme.tier2];
    const seasonalColor = seasonalFoliageColor(seasonal);

    // Stress tint: blend toward stressed tint when condition < STRESSED.
    const stressT = condition < PROVISIONAL_RENDER_FOLIAGE_HEALTHY_THRESHOLD
      ? 1 - condition / Math.max(0.01, PROVISIONAL_RENDER_FOLIAGE_HEALTHY_THRESHOLD)
      : 0;
    const stressTint = PROVISIONAL_RENDER_FOLIAGE_STRESSED_TINT;

    ctx.save();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = PROVISIONAL_RENDER_LEAF_OUTLINE_WIDTH_PX;

    // Deterministic iteration order over the cached slots — same frame-to-frame.
    for (let i = 0; i < activeCount; i++) {
      const slot = struct.leafSlots[i];
      if (!slot) break;

      // Per-slot sway: small sinusoidal offset.
      const swayX = Math.sin(swayPhase + slot.phaseOffset) * 1.5;
      const swayY = Math.cos(swayPhase * 0.7 + slot.phaseOffset) * 1.0;

      // Banknote-tier colour, blended with seasonal foliage colour.
      const baseColor = tierColors[slot.tier] ?? tierColors[0]!;
      const blended = lerpHex(baseColor, seasonalColor, 0.35);
      // Apply stress tint (yellowing) when condition drops.
      const finalColor = stressT > 0 ? lerpHex(blended, stressTint, stressT * 0.4) : blended;

      const size = leafSizeForTier(slot.tier) * slot.sizeJitter;

      ctx.fillStyle = finalColor;
      ctx.save();
      ctx.translate(slot.x + swayX, slot.y + swayY);
      ctx.rotate(slot.phaseOffset + swayPhase * 0.1);
      // Draw an ellipse — the banknote/leaf shape.
      ctx.beginPath();
      ctx.ellipse(0, 0, size, size * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
      // Subtle outline so individual leaves read against the canopy.
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    // ----- Falling leaves (autumn only) -----
    // Spawn falling-leaf particles from the canopy for the autumn-color state.
    if (seasonal === 'autumn-color' && env.weatherCondition !== 'frost') {
      this._updateFallingLeaves(ctx, struct, swayPhase);
    } else {
      // Decay any existing falling leaves so they finish their fall.
      this._decayFallingLeaves(ctx);
    }
  }

  // -------------------------------------------------------------------------
  // Damage markers — small dark-red circles on the trunk (GDD §13.4 physical damage).
  // -------------------------------------------------------------------------

  private _renderDamageMarkers(ctx: CanvasRenderingContext2D, struct: CachedTreeStructure): void {
    ctx.save();
    for (const m of struct.damageMarkers) {
      const radius =
        PROVISIONAL_RENDER_DAMAGE_MARKER_RADIUS_PX * (0.5 + 0.5 * m.severity);
      ctx.fillStyle = PROVISIONAL_RENDER_DAMAGE_MARKER_COLOR;
      ctx.globalAlpha = 0.5 + 0.5 * m.severity;
      ctx.beginPath();
      ctx.arc(m.x, m.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // Weather particle overlays — rain + snow (TDD §15.3 weather effects).
  // -------------------------------------------------------------------------

  private _renderWeatherParticles(
    ctx: CanvasRenderingContext2D,
    env: EnvironmentRenderData,
    frameTimeMs: number,
  ): void {
    const intensity = Math.min(1, Math.max(0, env.weatherIntensity));
    if (intensity <= 0) {
      // No weather — decay any active particles.
      this._decayAllParticles(frameTimeMs);
      return;
    }

    const condition = env.weatherCondition;
    if (condition === 'rain' || condition === 'heavy-rain' || condition === 'severe-storm') {
      this._updateRain(ctx, intensity, frameTimeMs);
    } else {
      // Not raining — decay rain particles.
      this._decayPool(this._rainPool, frameTimeMs);
    }

    if (condition === 'frost' || (condition === 'severe-storm' && env.season === 'winter')) {
      this._updateSnow(ctx, intensity, frameTimeMs);
    } else {
      this._decayPool(this._snowPool, frameTimeMs);
    }
  }

  /** Update + draw rain particles. Spawn from inactive slots up to a target count. */
  private _updateRain(ctx: CanvasRenderingContext2D, intensity: number, frameTimeMs: number): void {
    const targetActive = Math.round(this._rainPool.length * intensity * 0.6);
    let activeCount = 0;
    for (const p of this._rainPool) {
      if (p.active) activeCount++;
    }
    // Spawn new particles if below target.
    while (activeCount < targetActive) {
      const slot = findInactiveSlot(this._rainPool);
      if (!slot) break;
      slot.active = true;
      // Init position uses Math.random (per spec) — non-deterministic but cosmetic.
      slot.x = Math.random() * this._width;
      slot.y = Math.random() * this._height * 0.5;
      slot.vx = 0.5; // slight horizontal drift
      slot.vy = 4 + Math.random() * 3; // 4-7 px/frame
      slot.size = 1 + Math.random() * 1.5;
      activeCount++;
    }

    ctx.save();
    ctx.strokeStyle = '#a0c0e0';
    ctx.lineWidth = 1;
    for (const p of this._rainPool) {
      if (!p.active) continue;
      p.x += p.vx * (frameTimeMs / 16);
      p.y += p.vy * (frameTimeMs / 16);
      // Recycle when off-screen.
      if (p.y > this._height) {
        p.active = false;
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 2, p.y - p.vy * 2);
      ctx.globalAlpha = PROVISIONAL_RENDER_RAIN_OPACITY_MAX * intensity;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /** Update + draw snow particles. */
  private _updateSnow(ctx: CanvasRenderingContext2D, intensity: number, frameTimeMs: number): void {
    const targetActive = Math.round(this._snowPool.length * intensity * 0.5);
    let activeCount = 0;
    for (const p of this._snowPool) {
      if (p.active) activeCount++;
    }
    while (activeCount < targetActive) {
      const slot = findInactiveSlot(this._snowPool);
      if (!slot) break;
      slot.active = true;
      slot.x = Math.random() * this._width;
      slot.y = Math.random() * this._height * 0.3;
      slot.vx = (Math.random() - 0.5) * 0.6;
      slot.vy = 0.6 + Math.random() * 0.8;
      slot.size = 1.5 + Math.random() * 1.5;
      slot.phaseOffset = Math.random() * Math.PI * 2;
      activeCount++;
    }

    ctx.save();
    ctx.fillStyle = '#ffffff';
    for (const p of this._snowPool) {
      if (!p.active) continue;
      p.x += p.vx * (frameTimeMs / 16);
      p.y += p.vy * (frameTimeMs / 16);
      // Lateral drift (sine wave).
      p.x += Math.sin((p.y + p.phaseOffset) * 0.05) * 0.3;
      if (p.y > this._height) {
        p.active = false;
        continue;
      }
      ctx.globalAlpha = PROVISIONAL_RENDER_SNOW_OPACITY_MAX * intensity;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /** Update + draw falling leaves (autumn only). */
  private _updateFallingLeaves(
    ctx: CanvasRenderingContext2D,
    struct: CachedTreeStructure,
    swayPhase: number,
  ): void {
    // Spawn one new leaf every few frames from a random canopy slot.
    // Use a low spawn rate (one per ~6 frames) so the canopy doesn't drain.
    const spawn = this._timeAccumMs % 100 < 16; // roughly 1/6 frames at 60fps
    if (spawn && struct.leafSlots.length > 0) {
      const slot = findInactiveSlot(this._leafPool);
      if (slot) {
        const idx = Math.floor(Math.random() * struct.leafSlots.length);
        const sourceSlot = struct.leafSlots[idx]!;
        slot.active = true;
        slot.x = sourceSlot.x;
        slot.y = sourceSlot.y;
        slot.vx = (Math.random() - 0.5) * 0.8;
        slot.vy = 0.3 + Math.random() * 0.6;
        slot.size = leafSizeForTier(sourceSlot.tier) * sourceSlot.sizeJitter;
        slot.rotation = Math.random() * Math.PI * 2;
        slot.rotationSpeed = (Math.random() - 0.5) * 0.005;
        slot.tier = sourceSlot.tier;
        slot.maxLife = 8000 + Math.random() * 4000; // 8-12 seconds
        slot.life = slot.maxLife;
      }
    }

    const theme = resolveBanknoteTheme(this._currency.banknoteTheme);
    const tierColors: readonly string[] = [theme.tier0, theme.tier1, theme.tier2];
    const autumnTint = PROVISIONAL_RENDER_FOLIAGE_AUTUMN_COLOR;

    ctx.save();
    for (const p of this._leafPool) {
      if (!p.active) continue;
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.rotationSpeed * 16;
      p.life -= 16;
      if (p.life <= 0 || p.y > this._height) {
        p.active = false;
        continue;
      }
      const baseColor = tierColors[p.tier] ?? tierColors[0]!;
      const color = lerpHex(baseColor, autumnTint, 0.6);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = color;
      ctx.globalAlpha = Math.min(1, p.life / 1000);
      ctx.beginPath();
      ctx.ellipse(0, 0, p.size, p.size * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // Silence unused-variable warning for swayPhase — kept on signature so
    // future per-leaf sway can reuse the canopy's sway timing.
    void swayPhase;
  }

  /** Decay (fade out) falling leaves without spawning new ones. */
  private _decayFallingLeaves(ctx: CanvasRenderingContext2D): void {
    if (!this._leafPool.some((p) => p.active)) return;
    const theme = resolveBanknoteTheme(this._currency.banknoteTheme);
    const tierColors: readonly string[] = [theme.tier0, theme.tier1, theme.tier2];
    ctx.save();
    for (const p of this._leafPool) {
      if (!p.active) continue;
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.rotationSpeed * 16;
      p.life -= 16;
      if (p.life <= 0 || p.y > this._height) {
        p.active = false;
        continue;
      }
      const baseColor = tierColors[p.tier] ?? tierColors[0]!;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = baseColor;
      ctx.globalAlpha = Math.min(1, p.life / 1000);
      ctx.beginPath();
      ctx.ellipse(0, 0, p.size, p.size * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /** Decay all particle pools (no new spawns). Used when intensity = 0. */
  private _decayAllParticles(frameTimeMs: number): void {
    this._decayPool(this._rainPool, frameTimeMs);
    this._decayPool(this._snowPool, frameTimeMs);
    // Falling leaves decay on their own (life-based).
    // Re-render them via _decayFallingLeaves if any are still active — but
    // we can't draw here because we'd need the ctx. Skip: the next autumn
    // frame will redraw them. In non-autumn states they'll be drained
    // naturally over their lifetime.
  }

  /** Drain a particle pool: advance positions, recycle off-screen ones, no spawns. */
  private _decayPool(pool: Particle[], _frameTimeMs: number): void {
    for (const p of pool) {
      if (!p.active) continue;
      p.x += p.vx;
      p.y += p.vy;
      if (p.y > this._height || p.x < -10 || p.x > this._width + 10) {
        p.active = false;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Pollution haze overlay (TDD §15.2, GDD §13.4 pollution).
  // -------------------------------------------------------------------------

  private _renderPollutionHaze(ctx: CanvasRenderingContext2D, env: EnvironmentRenderData): void {
    const pollution = Math.min(1, Math.max(0, env.pollutionLevel));
    if (pollution <= 0.001) return;
    const alpha = pollution * PROVISIONAL_RENDER_POLLUTION_HAZE_MAX_OPACITY;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#a09060'; // warm haze tint
    ctx.fillRect(0, 0, this._width, this._height);
    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // Day/night lighting overlay (TDD §15.2, GDD §4.1).
  // -------------------------------------------------------------------------

  private _renderLightingOverlay(ctx: CanvasRenderingContext2D, env: EnvironmentRenderData): void {
    const brightness = this._brightnessForTimeOfDay(env.timeOfDay);
    // Darken the scene by (1 - brightness) using a multiply-equivalent overlay.
    const dimAlpha = 1 - brightness;
    if (dimAlpha <= 0.001) return;
    ctx.save();
    ctx.globalAlpha = dimAlpha;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, this._width, this._height);
    ctx.restore();
  }

  /**
   * Compute the scene brightness multiplier for a timeOfDay ∈ [0, 1).
   * Interpolates across the four phase anchors: night → dawn → day → dusk → night.
   */
  private _brightnessForTimeOfDay(tod: number): number {
    // Anchor table: (tod, brightness).
    const anchors: ReadonlyArray<{ tod: number; brightness: number }> = [
      { tod: PROVISIONAL_RENDER_DAY_PHASE_NIGHT_TOD, brightness: PROVISIONAL_RENDER_NIGHT_LIGHT_LEVEL },
      { tod: PROVISIONAL_RENDER_DAY_PHASE_DAWN_TOD, brightness: PROVISIONAL_RENDER_DAWN_DUSK_LIGHT_LEVEL },
      { tod: PROVISIONAL_RENDER_DAY_PHASE_DAY_TOD, brightness: PROVISIONAL_RENDER_DAY_LIGHT_LEVEL },
      { tod: PROVISIONAL_RENDER_DAY_PHASE_DUSK_TOD, brightness: PROVISIONAL_RENDER_DAWN_DUSK_LIGHT_LEVEL },
      { tod: 1.0, brightness: PROVISIONAL_RENDER_NIGHT_LIGHT_LEVEL },
    ];
    let a = anchors[0]!;
    let b = anchors[anchors.length - 1]!;
    for (let i = 0; i < anchors.length - 1; i++) {
      const p0 = anchors[i]!;
      const p1 = anchors[i + 1]!;
      if (tod >= p0.tod && tod <= p1.tod) {
        a = p0;
        b = p1;
        break;
      }
    }
    const span = b.tod - a.tod || 1;
    const t = Math.min(1, Math.max(0, (tod - a.tod) / span));
    return a.brightness + (b.brightness - a.brightness) * t;
  }
}
