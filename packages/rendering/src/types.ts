/**
 * Rendering types — visual data contracts (TDD §15, GDD §13.4).
 *
 * These types are the public contract between the simulation and the
 * renderer (TDD §15.1 Tree Rendering, §15.2 Environmental Rendering, §15.3
 * Visual Implementation, §15.4 Currency Cosmetics).
 *
 * The cardinal rule (rule 6: rendering reads state, never writes; TDD §15.1):
 * the renderer NEVER decides biological or economic values. Every field
 * below is either a 1:1 read of a simulation-state field, or a cosmetic /
 * visual tuning value that does not feed back into the sim. Cosmetics live
 * in this package, NOT in `packages/content` (GDD §6.1: cosmetics must not
 * be exposed to the simulation engine).
 *
 * Pure data shapes — no Zod schemas here. The simulation already validates
 * its own state via `packages/shared/src/schemas/`; re-validating in the
 * renderer would be redundant work each frame (TDD §17 — efficient UI updates).
 */
import type { Season, WeatherCondition, TreeDamageState } from '@capitalist-tree/shared';

// ============================================================================
// TreeRenderData (TDD §15.1, GDD §13.4).
//
// A pure visual description of the tree. The renderer consumes this and
// decides ONLY visual concerns (pixel position, colour, branch angles). It
// MUST NOT mutate this object or derive biological meaning from it — every
// biological decision was already made by BiologySystem before this was built.
// ============================================================================

/**
 * Canonical seasonal appearance strings (GDD §4.4 seasons, §13.4 Tree
 * Visualization). Maps the simulation's `Season` enum + the tree's
 * `foliage.seasonalCondition` to a visual cue the renderer picks a palette
 * for.
 *
 * - 'spring-buds'   — budding canopy, soft green, small leaves
 * - 'summer-green'  — full canopy, vibrant green
 * - 'autumn-color'  — senescence, yellow/orange/red hues
 * - 'winter-bare'   — full dormancy, no leaves (or sparse for evergreens)
 *
 * P1 ships only the deciduous White Oak — all four seasonal states appear
 * over a sim year. Evergreen species (P6+) will use 'summer-green' year-round
 * except for a brief 'spring-buds' flush.
 */
export type SeasonalAppearance = 'spring-buds' | 'summer-green' | 'autumn-color' | 'winter-bare';

/**
 * Coarse silhouette shape the renderer uses to pick a procedural branch
 * generator (GDD §13.4 Species, TDD §15.3 Procedural tree structure).
 *
 * - 'broadleaf-round' — White Oak and most deciduous hardwoods
 * - 'broadleaf-oval'  — Maple, birch
 * - 'conical'         — conifers (fir, spruce)
 * - 'columnar'        — poplar, cypress
 * - 'palm'            — palm trees (P6+ tropics)
 * - 'unknown'         — fallback for species without a registered shape
 *
 * The shape is a *visual* property — it does not exist on `TreeSpecies`
 * (which carries biological traits). P4a derives it via a lookup keyed on
 * speciesId; future content can extend the lookup without changing the
 * type.
 */
export type SpeciesShape =
  | 'broadleaf-round'
  | 'broadleaf-oval'
  | 'conical'
  | 'columnar'
  | 'palm'
  | 'unknown';

/**
 * Visual marker for a recorded damage event (GDD §13.4 Physical damage).
 *
 * Mirrors `TreeDamageState` from the sim but is intentionally a separate
 * type: the renderer may add purely-visual fields (e.g. `markerColor`) in
 * later phases without coupling to the simulation's schema. P4a is a 1:1
 * mirror so the data flow is obvious.
 */
export interface DamageMarker {
  /** Damage-type string from the sim's `TreeDamageState.type` (e.g. 'severe-defoliation'). */
  readonly type: string;
  /** Severity ∈ [0, 1] from the sim. Drives marker size + colour intensity. */
  readonly severity: number;
  /** Sim-second timestamp the damage was applied. For age-based fade-out. */
  readonly appliedAt: number;
}

/**
 * TreeRenderData — the renderer's view of the tree (TDD §15.1).
 *
 * Built by `buildTreeRenderData(tree, options)` from a `TreeState`. Every
 * field is either a direct read of the sim state or a cosmetic derivation
 * (seasonal appearance string, species shape). The renderer NEVER writes
 * back to the sim.
 *
 * Fields (per GDD §13.4):
 *   - height, trunkDiameter, branchDevelopment: structural metrics from
 *     `tree.structure`. Units match the sim (metres, metres, dimensionless).
 *   - foliageDensity: `currentLeaves / leafCapacity` ∈ [0, 1] — how full the
 *     canopy looks.
 *   - foliageCondition: leaf health ∈ [0, 1]. Derived from
 *     `1 - tree.stress` (stressed leaves are yellower / less efficient; the
 *     biology model uses the same factor for photosynthesis).
 *   - seasonalAppearance: derived from the clock's `Season` +
 *     `tree.foliage.seasonalCondition`.
 *   - damage: visual markers from `tree.damage[]`.
 *   - alive: false → renderer draws a stump / dead trunk (GDD §16.3 — death
 *     is permanent for the original tree but does not end the game).
 *   - speciesId, speciesShape: identity + silhouette shape.
 *   - ageDays: for visual scaling (sapling vs mature trunk texture).
 *   - leafCount: explicit leaf count for money-leaf rendering (one leaf = one
 *     banknote per GDD §6.1 — leaves ARE physical currency).
 */
export interface TreeRenderData {
  /** Tree height (m). Direct read of `tree.structure.height`. */
  readonly height: number;
  /** Trunk diameter (m). Direct read of `tree.structure.trunkDiameter`. */
  readonly trunkDiameter: number;
  /** Branch development score (dimensionless). Direct read of `tree.structure.branchDevelopment`. */
  readonly branchDevelopment: number;
  /** Foliage density ∈ [0, 1] — `currentLeaves / leafCapacity`. 0 = bare canopy. */
  readonly foliageDensity: number;
  /** Foliage / leaf health ∈ [0, 1] — `1 - tree.stress`. Drives leaf colour. */
  readonly foliageCondition: number;
  /** Seasonal appearance string for palette selection. */
  readonly seasonalAppearance: SeasonalAppearance;
  /** Visual damage markers from `tree.damage[]`. */
  readonly damage: readonly DamageMarker[];
  /** Whether the tree is alive. false → render stump / dead trunk. */
  readonly alive: boolean;
  /** Species id (e.g. 'species:white-oak'). Direct read of `tree.speciesId`. */
  readonly speciesId: string;
  /** Coarse silhouette shape for procedural rendering. */
  readonly speciesShape: SpeciesShape;
  /** Age in sim days. For visual scaling (sapling vs mature texture). */
  readonly ageDays: number;
  /** Current leaf count — one leaf = one money-leaf (banknote). */
  readonly leafCount: number;
}

// ============================================================================
// EnvironmentRenderData (TDD §15.2, GDD §13.4 surrounding environment).
// ============================================================================

/**
 * EnvironmentRenderData — the renderer's view of the surroundings.
 *
 * Built by `buildEnvironmentRenderData(world, clock, options)` from a
 * `WorldState` + `SimulationClock`. Drives the sky, ground, weather overlay,
 * and lighting in P4c's environment renderer.
 *
 * Each field is a direct read of a sim-state field, normalised to the range
 * the renderer consumes (typically [0, 1] or a physical unit like ppm).
 */
export interface EnvironmentRenderData {
  /**
   * Soil condition ∈ [0, 1]. Direct read of `world.environment.soil.health`.
   * Drives the soil colour (healthy brown ↔ degraded tan).
   */
  readonly soilCondition: number;
  /**
   * Soil contamination ∈ [0, 1] — normalised from
   * `world.environment.soil.contamination` against
   * `PROVISIONAL_RESOURCE_SOIL_CONTAMINATION_FULL_DEGRADE`. Drives the
   * contamination tint opacity.
   */
  readonly soilContamination: number;
  /** Current weather condition (GDD §4.3). Direct read of `world.weather.condition`. */
  readonly weatherCondition: WeatherCondition;
  /** Weather intensity ∈ [0, 1]. Direct read of `world.weather.intensity`. */
  readonly weatherIntensity: number;
  /**
   * Time of day ∈ [0, 1). Direct read of `clock.timeOfDay`.
   * 0 = midnight, 0.25 = 06:00, 0.5 = noon, 0.75 = 18:00.
   * Drives day/night lighting.
   */
  readonly timeOfDay: number;
  /** Current season. Direct read of `clock.season`. */
  readonly season: Season;
  /**
   * Pollution level ∈ [0, 1] — derived from atmospheric CO2 concentration
   * (`world.environment.atmosphere.co2Concentration`) and emissions. Drives
   * the haze overlay opacity. P6+ EnvironmentSystem will populate a more
   * granular pollution index; P4a derives a coarse proxy from CO2.
   */
  readonly pollutionLevel: number;
  /**
   * Biodiversity level ∈ [0, 1]. Direct read of
   * `world.environment.biodiversity.index`. Drives background vegetation
   * density (more biodiversity → more undergrowth / critters drawn).
   */
  readonly biodiversityLevel: number;
  /**
   * Atmospheric CO2 concentration (ppm). Direct read of
   * `world.environment.atmosphere.co2Concentration`. Drives haze intensity
   * (above the 410 ppm ambient floor).
   */
  readonly co2Level: number;
}

// ============================================================================
// CurrencyVisual — cosmetic appearance of money leaves (TDD §15.4, GDD §14).
// ============================================================================

/**
 * A single denomination tier (TDD §15.4 — `denominations` array).
 *
 * The sim stores money as a single bigint minor-unit total per account
 * (TDD §10.1). Currency visuals, however, present money as a layered stack
 * of denominations: each leaf on the tree is one banknote, and higher-value
 * leaves are drawn larger / more elaborately. The denomination list lets the
 * renderer tier the leaves visually.
 *
 * `valueMinor` is a bigint-as-string for safety (TDD §10.1) — even though
 * a denomination is a small constant, keeping the type consistent with the
 * sim's money type avoids surprise conversions.
 */
export interface CurrencyDenomination {
  /** BigInt minor units (string for safe JSON). e.g. '100' = $1.00. */
  readonly valueMinor: string;
  /** Short human-readable label, e.g. '$1', '€5', 'gold-leaf'. */
  readonly label: string;
  /** Tier index (0 = lowest denomination). Higher tier = larger leaf. */
  readonly leafTier: number;
}

/**
 * CurrencyVisual — cosmetic appearance of money leaves (TDD §15.4).
 *
 * Pure visual data. The sim never sees this — currency issuance, harvest
 * accounting, and balances are all stored as bare bigint minor units keyed
 * by currencyId (TDD §10.1). This type only affects HOW the renderer draws
 * the leaves, not what they're worth. Cosmetic selection MUST NOT modify
 * the underlying monetary value or simulation balance (TDD §15.4).
 */
export interface CurrencyVisual {
  /** Unique id, matches the sim's `currencyId` (e.g. 'currency:leaf-dollar'). */
  readonly id: string;
  /** Human-readable name (e.g. 'Leaf Dollar'). */
  readonly name: string;
  /** Currency symbol (e.g. '$', '€', '◈'). */
  readonly symbol: string;
  /** Denomination tiers for leaf visual tiering. */
  readonly denominations: readonly CurrencyDenomination[];
  /**
   * Banknote colour theme — palette name the renderer maps to a hex set.
   * Kept as a string so P4b can resolve it through a palette registry
   * without changing this type when new themes are added.
   */
  readonly banknoteTheme: string;
  /**
   * Leaf shape / style descriptor. Examples: 'oval-banknote', 'gold-foil',
   * 'eurostar-leaf'. The renderer picks a procedural leaf generator based
   * on this string.
   */
  readonly leafAppearance: string;
}

// ============================================================================
// TreeRenderer interface (TDD §15.3) + factory.
// ============================================================================

/**
 * Identifies the rendering backend a TreeRenderer uses. Consumers (the React
 * wrapper in P4d) switch on this to decide which DOM element / canvas type
 * to mount. P4a ships the 'headless' kind only; P4b adds 'canvas'; later
 * phases may add 'svg' / 'webgl'.
 */
export type TreeRendererTarget = 'canvas' | 'svg' | 'headless' | 'webgl';

/**
 * TreeRenderer — replaceable rendering surface (TDD §15.3).
 *
 * The interface decouples the React wrapper (P4d) from the actual drawing
 * backend (Canvas / SVG / WebGL / headless test stub). All concrete renderers
 * implement this interface so the wrapper can swap them by changing one line.
 *
 * Contract:
 *   - `render(tree, env, frameTimeMs)` is called each animation frame. It
 *     MUST NOT mutate its arguments (rule 6: rendering reads state, never
 *     writes).
 *   - `resize(width, height)` is called when the viewport changes. The
 *     renderer MUST handle this without leaking resources.
 *   - `dispose()` releases all resources (canvas contexts, GPU buffers, etc.)
 *     MUST be idempotent.
 *   - `targetKind` is a readonly discriminator — set once at construction.
 */
export interface TreeRenderer {
  /** Discriminator for the rendering backend (see TreeRendererTarget). */
  readonly targetKind: TreeRendererTarget;
  /**
   * Render one frame. `frameTimeMs` is the wall-clock ms since the previous
   * call (for animations like leaf-rustle, rain drift, etc.). The renderer
   * MUST NOT mutate `tree` or `env`.
   */
  render(tree: TreeRenderData, env: EnvironmentRenderData, frameTimeMs: number): void;
  /** Resize the render surface. Must be safe to call before render(). */
  resize(width: number, height: number): void;
  /** Release all resources. Idempotent. */
  dispose(): void;
}

/**
 * Tagged-union factory target (TDD §15.3 — replaceable rendering).
 *
 * `createTreeRenderer({ kind: 'canvas', ...canvasOptions })` returns a
 * CanvasRenderer (P4b). `createTreeRenderer({ kind: 'headless' })` returns
 * the headless stub (P4a). This discriminated union grows as new backends
 * are added without breaking existing call sites.
 *
 * P4a uses `unknown` for the canvas / container / webgl-canvas payloads
 * because the rendering package's tsconfig does not include DOM lib types
 * (the base tsconfig uses `"lib": ["ES2022"]`). P4b will either add DOM lib
 * to the rendering package's tsconfig or replace these with proper
 * `HTMLCanvasElement` / `HTMLElement` types when it lands the Canvas renderer.
 */
export type CreateTreeRendererTarget =
  | { readonly kind: 'headless' }
  | { readonly kind: 'canvas'; readonly canvas: unknown }
  | { readonly kind: 'svg'; readonly container: unknown }
  | { readonly kind: 'webgl'; readonly canvas: unknown };

// ============================================================================
// TreeViewProps — what the React wrapper (P4d) will receive.
//
// P4a declares the shape so P4d can wire up to it without re-deriving the
// contract. The actual React component lives in P4d; this is the data
// contract the component accepts.
// ============================================================================

/**
 * Props for the React tree-view component (P4d). P4a declares the shape so
 * the public contract is stable across P4b/P4c/P4d.
 *
 * - `tree` + `environment` are pre-built TreeRenderData / EnvironmentRenderData.
 * - `currency` is a CurrencyVisual (cosmetic; defaults to leaf-dollar).
 * - `width` / `height` set the viewport; defaults applied in P4d.
 * - `className` lets the parent style the wrapper element.
 *
 * The component itself is NOT in P4a — only the props type is. P4d wires
 * the actual React component.
 */
export interface TreeViewProps {
  /** Pre-built tree render data. */
  readonly tree: TreeRenderData;
  /** Pre-built environment render data. */
  readonly environment: EnvironmentRenderData;
  /** Cosmetic currency visual. Defaults to leaf-dollar in P4d. */
  readonly currency?: CurrencyVisual;
  /** Viewport width (px). P4d default: 600. */
  readonly width?: number;
  /** Viewport height (px). P4d default: 480. */
  readonly height?: number;
  /** Optional CSS class for the wrapper element. */
  readonly className?: string;
}

// Re-export the simulation's TreeDamageState type alias so consumers building
// DamageMarkers from raw TreeState.damage entries don't need a second import.
export type { TreeDamageState };
