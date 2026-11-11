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
