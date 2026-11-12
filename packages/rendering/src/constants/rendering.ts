/**
 * Rendering provisional constants (P4a — TDD §15, GDD §13.4, §14).
 *
 * Every value here corresponds to (or stands in for) an unresolved visual /
 * cosmetic design decision listed in GDD §13.4 (Tree Visualization), §14
 * (Monetization and Cosmetics), and §17 (Unresolved Design Decisions). They
 * live in a dedicated file inside `packages/rendering` so visual tuning is
 * localized to one place — separate from simulation tuning
 * (`packages/shared/src/constants/`).
 *
 * The rendering package is the only consumer of these constants. They MUST
 * NOT leak into the simulation (rule 6: rendering reads state, never writes;
 * GDD §6.1 / TDD §15.1 — cosmetics stay out of the sim). P4b's Canvas
 * implementation will import them; P4c's environment renderer will use the
 * weather + soil palette entries.
 *
 * CONVENTION: `PROVISIONAL_RENDER_*` prefix and a
 * `// PROVISIONAL (GDD §<section>: <item>)` comment pointing at the GDD
 * entry the value resolves. When a value is promoted from "provisional" to
 * "decided" via playtesting, move it to a sibling `decided.ts` and remove
 * the prefix. Leave a comment so the migration is traceable.
 */

// ============================================================================
// Tree geometry — pixel/metre scaling for Canvas/SVG rendering (GDD §13.4).
// @provisional: exact canvas size and tree-on-screen proportions are GDD §17
// unresolved ("Regional simulation granularity" affects how many trees fit on
// screen at once; the default single-tree scale is provisional).
// ============================================================================

// PROVISIONAL (GDD §13.4: Tree Visualization — height)
//
// Pixels per metre of tree height at the default zoom. 20 px/m means a 25 m
// mature White Oak renders at 500 px tall — fits comfortably inside a
// 600 px viewport with room for ground + sky. Tunable per-viewport in P4b.
export const PROVISIONAL_RENDER_TREE_HEIGHT_SCALE_PX_PER_M = 20;

// PROVISIONAL (GDD §13.4: Tree Visualization — trunk diameter)
//
// Pixels per metre of trunk diameter. Trunks look thin at the same scale as
// height (a 1.5 m trunk × 20 px/m = 30 px — readable but a bit narrow), so we
// use a larger multiplier (40 px/m → 60 px for a mature oak trunk).
export const PROVISIONAL_RENDER_TRUNK_DIAMETER_SCALE_PX_PER_M = 40;

// PROVISIONAL (GDD §13.4: Tree Visualization — branch structure)
//
// Pixels of canopy spread per unit of branchDevelopment. White Oak caps at
// `maximumBranchDevelopment = 100`; 5 px per unit → 500 px canopy diameter at
// full maturity (matches the height in px — a round oak silhouette).
export const PROVISIONAL_RENDER_BRANCH_SCALE_PX_PER_UNIT = 5;

// PROVISIONAL (GDD §13.4: Tree Visualization — height)
//
// Floor and ceiling on rendered tree height in px. A sapling (0.5 m × 20 = 10
// px) is too small to draw legibly; the floor forces a minimum 60 px so the
// sapling is visible. The ceiling clamps absurdly-tall zoom levels.
export const PROVISIONAL_RENDER_MIN_TREE_HEIGHT_PX = 60;
export const PROVISIONAL_RENDER_MAX_TREE_HEIGHT_PX = 600;

// PROVISIONAL (GDD §13.4: Tree Visualization — physical damage)
//
// Radius of the visual damage marker (broken-branch stubs, scars, etc.)
// drawn at the trunk. 6 px is readable at default scale.
export const PROVISIONAL_RENDER_DAMAGE_MARKER_RADIUS_PX = 6;

// ============================================================================
// Foliage thresholds — what numerical state maps to which visual cue.
// @provisional: visual fidelity thresholds are GDD §17 unresolved
// ("detailed photosynthesis and energy allocation equations" feeds the
// leaf-health → visual-colour mapping).
// ============================================================================

// PROVISIONAL (GDD §13.4: Tree Visualization — leaf condition)
//
// Foliage health (foliageCondition ∈ [0,1]) thresholds. Above HEALTHY the
// canopy reads as vibrant green; below STRESSED it reads as yellowing /
// sparse; in between it's a transitional olive. P4b will lerp the leaf colour
// across the [STRESSED, HEALTHY] band.
export const PROVISIONAL_RENDER_FOLIAGE_HEALTHY_THRESHOLD = 0.7;
export const PROVISIONAL_RENDER_FOLIAGE_STRESSED_THRESHOLD = 0.3;

// PROVISIONAL (GDD §13.4: Tree Visualization — foliage density)
//
// Foliage density (foliageDensity ∈ [0,1]) below which the renderer draws the
// canopy as see-through (individual leaves visible) rather than as a solid
// mass. 0.4 = below 40% of capacity the canopy becomes "thin".
export const PROVISIONAL_RENDER_FOLIAGE_THIN_CANOPY_THRESHOLD = 0.4;

// ============================================================================
// Soil + environment palette (GDD §13.4 surrounding environment).
// @provisional: the exact colour palette is a GDD §14 cosmetic item
// ("Environmental visual themes"); these defaults ship with P4a so P4b/P4c
// have something concrete to draw.
// ============================================================================

// PROVISIONAL (GDD §13.4: surrounding environment — soil quality)
//
// Hex colour for healthy soil (soilCondition near 1.0). Deep loamy brown.
export const PROVISIONAL_RENDER_SOIL_HEALTHY_COLOR = '#6b4423';

// PROVISIONAL (GDD §13.4: surrounding environment — soil quality)
//
// Hex colour for degraded soil (soilCondition near 0.0). Pale dusty tan.
export const PROVISIONAL_RENDER_SOIL_DEGRADED_COLOR = '#b39078';

// PROVISIONAL (GDD §13.4: surrounding environment — soil contamination)
//
// Hex tint applied (alpha-blended) over the soil colour based on
// `soilContamination`. Rusty red-brown.
export const PROVISIONAL_RENDER_SOIL_CONTAMINATION_TINT = '#7a3d3d';

// PROVISIONAL (GDD §13.4: surrounding environment — pollution)
//
// Haze overlay opacity at maximum pollutionLevel (1.0). 0.4 = hazy enough to
// be noticeable without obscuring the tree. Linearly scaled by pollutionLevel.
export const PROVISIONAL_RENDER_POLLUTION_HAZE_MAX_OPACITY = 0.4;

// PROVISIONAL (GDD §13.4: surrounding environment — CO2 / atmosphere)
//
// CO2 concentration (ppm) at which the haze overlay reaches its maximum
// opacity. Real-world ambient is ~410 ppm; 600 ppm represents a heavily
// polluted atmosphere. P4c will lerp from 410 → 600 ppm.
export const PROVISIONAL_RENDER_CO2_HAZE_SATURATION_PPM = 600;

// PROVISIONAL (GDD §13.4: surrounding environment — CO2 / atmosphere)
//
// Baseline CO2 (ppm) below which no haze is drawn. Matches real-world ambient.
export const PROVISIONAL_RENDER_CO2_HAZE_FLOOR_PPM = 410;

// ============================================================================
// Weather overlay opacities (GDD §4.3 weather, GDD §13.4 surroundings).
// @provisional: weather overlay tuning is a GDD §14 cosmetic item.
// ============================================================================

// PROVISIONAL (GDD §13.4: surrounding environment — weather)
//
// Rain overlay opacity at full intensity. 0.5 = heavy but tree still visible.
export const PROVISIONAL_RENDER_RAIN_OPACITY_MAX = 0.5;

// PROVISIONAL (GDD §13.4: surrounding environment — weather)
//
// Cloud overlay opacity at full intensity (overcast). 0.7 = mostly grey.
export const PROVISIONAL_RENDER_CLOUD_OPACITY_MAX = 0.7;

// PROVISIONAL (GDD §13.4: surrounding environment — weather)
//
// Snow / frost overlay opacity at full intensity. 0.6 = clearly visible.
export const PROVISIONAL_RENDER_SNOW_OPACITY_MAX = 0.6;

// ============================================================================
// Day / night lighting (GDD §4.1 day/night, TDD §15.2 Environmental Rendering).
// @provisional: the exact day/night colour temperature curve is a GDD §17
// unresolved item ("exact real-time-to-simulation-time relationship" feeds
// how quickly day/night cycles).
// ============================================================================

// PROVISIONAL (GDD §4.1: day/night, TDD §15.2)
//
// Brightness multiplier (0..1) applied to the scene at midnight. 0.25 =
// night is dim but the tree silhouette is still readable (we never go fully
// black — the player needs to see the tree).
export const PROVISIONAL_RENDER_NIGHT_LIGHT_LEVEL = 0.25;

// PROVISIONAL (GDD §4.1: day/night, TDD §15.2)
//
// Brightness multiplier at dawn/dusk (sunrise/sunset transition window).
export const PROVISIONAL_RENDER_DAWN_DUSK_LIGHT_LEVEL = 0.7;

// PROVISIONAL (GDD §4.1: day/night, TDD §15.2)
//
// Brightness multiplier at full midday (noon). 1.0 = full brightness.
export const PROVISIONAL_RENDER_DAY_LIGHT_LEVEL = 1.0;

// ============================================================================
// Currency visuals — cosmetic defaults (TDD §15.4, GDD §14).
// @provisional: cosmetic selection is GDD §14 unresolved ("Final monetization
// model"); the default currency id is provisional until the player-options
// panel lands in P4c/P4d.
// ============================================================================

// PROVISIONAL (GDD §14: Monetization and Cosmetics — currency designs)
//
// Default CurrencyVisual id used when the player hasn't picked a cosmetic.
// Maps to the leaf-banknote entry in `packages/rendering/src/currency-visuals.ts`.
export const PROVISIONAL_RENDER_DEFAULT_CURRENCY_VISUAL_ID = 'currency:leaf-dollar';

// PROVISIONAL (GDD §14: Monetization and Cosmetics — banknote appearances)
//
// Default number of leaf tiers (denominations) the renderer draws. Each tier
// is visually distinct so the player can read at a glance which leaves are
// high-value. 3 tiers: minor / standard / premium.
export const PROVISIONAL_RENDER_CURRENCY_DEFAULT_TIER_COUNT = 3;

// ============================================================================
// Headless renderer — used for SSR / unit tests / non-visual runs (TDD §15.3).
// ============================================================================

// PROVISIONAL (TDD §15.3: Visual Implementation — replaceable rendering)
//
// The headless renderer's `targetKind` identifier. P4b adds `'canvas'`;
// P4c may add `'svg'` / `'webgl'`. The headless renderer draws nothing but
// implements the full TreeRenderer interface so consumer code paths work
// unchanged in non-visual contexts (SSR, tests, screenshots).
export const PROVISIONAL_RENDER_HEADLESS_TARGET_KIND = 'headless' as const;

// ============================================================================
// Canvas renderer (P4b — TDD §15.3, GDD §13.4 procedural tree structure).
//
// Every constant in this section is a @provisional visual-tuning knob. They
// drive only the Canvas renderer's drawing — never the simulation. When a
// value is promoted from "provisional" to "decided" via playtesting, move it
// to a sibling `decided.ts` and remove the prefix (per the convention in the
// header above).
// ============================================================================

// PROVISIONAL (TDD §15.3 — canvas target discriminator)
//
// The Canvas renderer's `targetKind` identifier. P4d's React wrapper will
// switch on this to decide which DOM element to mount (an <HTMLCanvasElement>
// for canvas vs an <SVGSVGElement> for svg).
export const PROVISIONAL_RENDER_CANVAS_TARGET_KIND = 'canvas' as const;

// ----------------------------------------------------------------------------
// Canvas layout — default viewport + ground/baseline fractions (GDD §13.4).
// @provisional: exact canvas size + tree-on-screen proportions are GDD §17
// unresolved ("Regional simulation granularity" affects how many trees fit
// on screen at once; the default single-tree scale is provisional).
// ----------------------------------------------------------------------------

// PROVISIONAL (GDD §13.4: surrounding environment — viewport defaults)
export const PROVISIONAL_RENDER_CANVAS_DEFAULT_WIDTH_PX = 600;
export const PROVISIONAL_RENDER_CANVAS_DEFAULT_HEIGHT_PX = 480;

// PROVISIONAL (GDD §13.4: surrounding environment — ground)
//
// Fraction of the canvas height (from the bottom) occupied by the ground
// band. 0.18 = ground takes the bottom ~86 px of a 480 px canvas.
export const PROVISIONAL_RENDER_GROUND_HEIGHT_FRACTION = 0.18;

// PROVISIONAL (GDD §13.4: surrounding environment — tree placement)
//
// Fraction of the canvas height (from the top) at which the tree's base
// sits. 0.82 = the trunk emerges from the ground at 82% down the canvas,
// matching GROUND_HEIGHT_FRACTION (1 - 0.18 = 0.82).
export const PROVISIONAL_RENDER_TREE_BASELINE_FRACTION = 1 - PROVISIONAL_RENDER_GROUND_HEIGHT_FRACTION;

// ----------------------------------------------------------------------------
// Tree palette — trunk / branch / damage colours (GDD §13.4 Species, Physical
// damage). @provisional: exact palette is GDD §14 unresolved ("Tree species
// appearances" + "Foliage colors" cosmetic items).
// ----------------------------------------------------------------------------

// PROVISIONAL (GDD §13.4: Tree Visualization — trunk)
export const PROVISIONAL_RENDER_TRUNK_COLOR = '#5a3a1f';
// PROVISIONAL (GDD §13.4: Tree Visualization — dead stump)
export const PROVISIONAL_RENDER_TRUNK_DEAD_COLOR = '#3a2a1a';
// PROVISIONAL (GDD §13.4: Tree Visualization — branches)
export const PROVISIONAL_RENDER_BRANCH_COLOR = '#6b4226';
// PROVISIONAL (GDD §13.4: Tree Visualization — physical damage marker)
export const PROVISIONAL_RENDER_DAMAGE_MARKER_COLOR = '#8b1a1a';

// ----------------------------------------------------------------------------
// Seasonal foliage palette (GDD §4.4 seasons, §13.4 foliage).
// @provisional: exact palette is GDD §14 unresolved ("Foliage colors").
// ----------------------------------------------------------------------------

// PROVISIONAL (GDD §4.4: Spring — bud development)
export const PROVISIONAL_RENDER_FOLIAGE_SPRING_COLOR = '#a8d672';
// PROVISIONAL (GDD §4.4: Summer — active photosynthesis)
export const PROVISIONAL_RENDER_FOLIAGE_SUMMER_COLOR = '#3a8b3a';
// PROVISIONAL (GDD §4.4: Autumn — leaf aging + senescence)
export const PROVISIONAL_RENDER_FOLIAGE_AUTUMN_COLOR = '#d97942';
// PROVISIONAL (GDD §4.4: Winter — used only for evergreens; deciduous trees
// draw no foliage in winter)
export const PROVISIONAL_RENDER_FOLIAGE_WINTER_COLOR = '#9bb3c8';

// PROVISIONAL (GDD §13.4: Tree Visualization — leaf condition)
//
// Hex tint applied to leaves when foliageCondition drops below the stressed
// threshold (drives yellowing — stressed leaves are less green).
export const PROVISIONAL_RENDER_FOLIAGE_STRESSED_TINT = '#c8b560';

// ----------------------------------------------------------------------------
// Sky palette by time-of-day phase (GDD §4.1 day/night, TDD §15.2 environment).
// @provisional: the exact day/night colour temperature curve is a GDD §17
// unresolved item ("exact real-time-to-simulation-time relationship").
//
// The renderer interpolates the sky top/bottom hex colours across four anchor
// phases: night (00:00), dawn (06:00), day (12:00), dusk (18:00), then back
// to night. timeOfDay ∈ [0, 1) where 0 = midnight, 0.25 = 06:00, 0.5 = noon,
// 0.75 = 18:00.
// ----------------------------------------------------------------------------

// PROVISIONAL (GDD §4.1: day/night — night sky)
export const PROVISIONAL_RENDER_SKY_NIGHT_TOP = '#0a0a1f';
export const PROVISIONAL_RENDER_SKY_NIGHT_BOTTOM = '#1a1a3a';
// PROVISIONAL (GDD §4.1: day/night — dawn sky)
export const PROVISIONAL_RENDER_SKY_DAWN_TOP = '#ff9966';
export const PROVISIONAL_RENDER_SKY_DAWN_BOTTOM = '#ffcc99';
// PROVISIONAL (GDD §4.1: day/night — day sky)
export const PROVISIONAL_RENDER_SKY_DAY_TOP = '#4a90e2';
export const PROVISIONAL_RENDER_SKY_DAY_BOTTOM = '#87ceeb';
// PROVISIONAL (GDD §4.1: day/night — dusk sky)
export const PROVISIONAL_RENDER_SKY_DUSK_TOP = '#cc6666';
export const PROVISIONAL_RENDER_SKY_DUSK_BOTTOM = '#ff9966';

// PROVISIONAL (GDD §4.1: day/night — cloud overlay)
//
// Cloud grey tint applied (alpha-blended) over the sky when weather is cloudy
// / rainy / stormy. Intensity (weatherIntensity) drives alpha.
export const PROVISIONAL_RENDER_CLOUD_COLOR = '#9aa4b0';

// ----------------------------------------------------------------------------
// Ground palette (GDD §13.4 surrounding environment, soil quality).
// @provisional: the exact ground palette is a GDD §14 cosmetic item
// ("Environmental visual themes").
// ----------------------------------------------------------------------------

// PROVISIONAL (GDD §13.4: surrounding environment — grass)
export const PROVISIONAL_RENDER_GRASS_COLOR = '#6b8e23';

// ----------------------------------------------------------------------------
// Particle pool sizes (TDD §15.3 — weather effects; "no per-frame alloc").
//
// Each pool is a fixed-size array of pre-allocated particle structs. The
// renderer reuses inactive slots rather than allocating new objects each
// frame. Sizes are tuned to fill a 600x480 viewport without runaway memory.
// @provisional: pool sizing is a P4b performance tuning concern.
// ----------------------------------------------------------------------------

// PROVISIONAL (TDD §15.3: rain overlay)
export const PROVISIONAL_RENDER_RAIN_PARTICLE_POOL_SIZE = 200;
// PROVISIONAL (TDD §15.3: snow / frost overlay)
export const PROVISIONAL_RENDER_SNOW_PARTICLE_POOL_SIZE = 150;
// PROVISIONAL (TDD §15.3: autumn falling-leaf animation)
export const PROVISIONAL_RENDER_FALLING_LEAF_POOL_SIZE = 50;

// ----------------------------------------------------------------------------
// Wind sway (TDD §15.3 — animation).
// @provisional: wind amplitude + frequency are GDD §14 cosmetic items
// ("Environmental visual themes"); also depend on the unresolved real-time-
// to-simulation-time relationship (GDD §17).
// ----------------------------------------------------------------------------

// PROVISIONAL (TDD §15.3: wind sway amplitude)
//
// Max horizontal pixel offset applied to branch tips at full branch depth.
// Scales with branchDevelopment / 100 (developed crowns sway more visibly).
export const PROVISIONAL_RENDER_WIND_SWAY_AMPLITUDE_PX = 6;
// PROVISIONAL (TDD §15.3: wind sway frequency)
//
// Frequency of the sinusoidal sway. 0.5 Hz = one full sway cycle every 2 s.
export const PROVISIONAL_RENDER_WIND_SWAY_FREQUENCY_HZ = 0.5;

// ----------------------------------------------------------------------------
// Procedural branch generation (TDD §15.3 — procedural tree structure).
// @provisional: branch depth + decay rates are GDD §17 unresolved
// ("detailed photosynthesis and energy allocation equations" feeds how
// branchDevelopment translates to visible structure).
// ----------------------------------------------------------------------------

// PROVISIONAL (GDD §13.4: Tree Visualization — branch structure)
//
// Maximum recursive depth of the procedural branch generator. 4 = trunk →
// main limbs → secondary branches → twigs. Higher depths explode the leaf
// count geometrically; 4 keeps a 600x480 canvas legible.
export const PROVISIONAL_RENDER_MAX_BRANCH_DEPTH = 4;

// PROVISIONAL (GDD §13.4: Tree Visualization — branch structure)
//
// Half-angle (in degrees) of the cone each child branch can deviate from
// its parent's direction. 35° → children fan ±35° around the parent's heading.
export const PROVISIONAL_RENDER_BRANCH_ANGLE_SPREAD_DEG = 35;

// PROVISIONAL (GDD §13.4: Tree Visualization — branch structure)
//
// Length multiplier applied at each branch recursion depth. 0.7 → child
// branches are 70% as long as their parent.
export const PROVISIONAL_RENDER_BRANCH_LENGTH_DECAY = 0.7;

// PROVISIONAL (GDD §13.4: Tree Visualization — branch structure)
//
// Diameter multiplier applied at each branch recursion depth. 0.65 → child
// branches are 65% as thick as their parent.
export const PROVISIONAL_RENDER_BRANCH_DIAMETER_DECAY = 0.65;

// PROVISIONAL (GDD §13.4: Tree Visualization — branch structure)
//
// Number of children each non-leaf branch produces. 2 = binary branching
// (typical of oaks).
export const PROVISIONAL_RENDER_BRANCH_CHILD_COUNT = 2;

// ----------------------------------------------------------------------------
// Money-leaf sizing per denomination tier (TDD §15.4 currency cosmetics).
// @provisional: leaf sizes are a P4b visual-tuning concern; the GDD §14
// "Banknote appearances" cosmetic item is unresolved.
// ----------------------------------------------------------------------------

// PROVISIONAL (TDD §15.4: Currency Cosmetics — leaf tier sizes)
//
// Half-extent (px) of a leaf drawn at each tier. Higher tier = larger leaf
// (a high-denomination leaf reads as more prominent at a glance).
export const PROVISIONAL_RENDER_LEAF_TIER0_SIZE_PX = 3;
export const PROVISIONAL_RENDER_LEAF_TIER1_SIZE_PX = 4.5;
export const PROVISIONAL_RENDER_LEAF_TIER2_SIZE_PX = 6;

// PROVISIONAL (TDD §15.4: Currency Cosmetics — leaf outline width)
export const PROVISIONAL_RENDER_LEAF_OUTLINE_WIDTH_PX = 0.5;

// ----------------------------------------------------------------------------
// Banknote theme palette (TDD §15.4, GDD §14 currency designs).
//
// Each CurrencyVisual carries a `banknoteTheme` string. The renderer resolves
// it to a per-tier colour triplet via this registry. Adding a new theme is a
// one-line addition here — no type changes required.
//
// @provisional: the exact colours are GDD §14 unresolved ("Currency designs"
// + "Banknote appearances").
// ----------------------------------------------------------------------------

// PROVISIONAL (GDD §14: Monetization and Cosmetics — US greenback theme)
export const PROVISIONAL_RENDER_BANKNOTE_THEME_US_GREENBACK: Readonly<{
  tier0: string;
  tier1: string;
  tier2: string;
}> = Object.freeze({
  tier0: '#a3c98f',
  tier1: '#7eb463',
  tier2: '#5a8f3a',
});

// PROVISIONAL (GDD §14: Monetization and Cosmetics — gold foil theme)
export const PROVISIONAL_RENDER_BANKNOTE_THEME_GOLD_FOIL: Readonly<{
  tier0: string;
  tier1: string;
  tier2: string;
}> = Object.freeze({
  tier0: '#f5d76e',
  tier1: '#e6b94e',
  tier2: '#c69a3a',
});

// PROVISIONAL (GDD §14: Monetization and Cosmetics — euro violet theme)
export const PROVISIONAL_RENDER_BANKNOTE_THEME_EURO_VIOLET: Readonly<{
  tier0: string;
  tier1: string;
  tier2: string;
}> = Object.freeze({
  tier0: '#a3b1d4',
  tier1: '#7d8cc0',
  tier2: '#5a6db0',
});

// PROVISIONAL (GDD §14: Monetization and Cosmetics — fallback theme)
//
// Used when a CurrencyVisual's `banknoteTheme` is not in the registry.
export const PROVISIONAL_RENDER_BANKNOTE_THEME_FALLBACK: Readonly<{
  tier0: string;
  tier1: string;
  tier2: string;
}> = PROVISIONAL_RENDER_BANKNOTE_THEME_US_GREENBACK;

// ----------------------------------------------------------------------------
// Day / night lighting curve (GDD §4.1 day/night, TDD §15.2 environment).
// @provisional: the exact curve is GDD §17 unresolved ("exact real-time-to-
// simulation-time relationship").
//
// Anchor timeOfDay values for the linear-interpolation curve:
//   0.00 → NIGHT  (midnight)
//   0.25 → DAWN   (06:00 sunrise)
//   0.50 → DAY    (noon, peak brightness)
//   0.75 → DUSK   (18:00 sunset)
//   1.00 → NIGHT  (next midnight; wraps to 0)
// ----------------------------------------------------------------------------

// PROVISIONAL (GDD §4.1: day/night — anchor fractions)
export const PROVISIONAL_RENDER_DAY_PHASE_NIGHT_TOD = 0.0;
export const PROVISIONAL_RENDER_DAY_PHASE_DAWN_TOD = 0.25;
export const PROVISIONAL_RENDER_DAY_PHASE_DAY_TOD = 0.5;
export const PROVISIONAL_RENDER_DAY_PHASE_DUSK_TOD = 0.75;
