/**
 * TreeRenderData mapping — pure state → visual contract (TDD §15.1, GDD §13.4).
 *
 * `buildTreeRenderData` is a PURE function: it reads simulation state and
 * produces a visual-data snapshot for the renderer. It NEVER mutates its
 * inputs (rule 6: rendering reads state, never writes — TDD §15.1, GDD §6.1)
 * and it NEVER derives biological / economic values. Every biological /
 * economic decision was already made by the simulation systems before this
 * function runs.
 *
 * The function is designed to be cheap: the React wrapper (P4d) calls it
 * once per simulation tick (typically once per `engine.advance` result),
 * not once per animation frame. The renderer itself runs at the browser's
 * native frame rate against the latest TreeRenderData snapshot
 * (TDD §15.1 — "tree should be rendered independently of the simulation").
 *
 * The companion function `buildEnvironmentRenderData` lives in
 * environment-render-data.ts. They share no helpers — keeping them split
 * makes it obvious which file to touch when only the tree or only the
 * environment mapping changes.
 */
import type {
  TreeState,
  Season,
  TreeSpecies,
  TreeDamageState,
} from '@capitalist-tree/shared';
import { findSpeciesById } from '@capitalist-tree/content';
import type {
  TreeRenderData,
  SeasonalAppearance,
  SpeciesShape,
  DamageMarker,
} from './types.js';

// ============================================================================
// Species → silhouette-shape lookup (GDD §13.4 Species).
//
// The TreeSpecies schema (packages/shared/src/schemas/species.ts) carries
// biological traits but NOT visual silhouette. We can't modify the schema
// (P4a stays out of simulation/shared/content). Instead, P4a keeps a small
// registry mapping speciesId → SpeciesShape. New species get a row here
// when they're added to content. Unknown species fall back to 'unknown'
// and the renderer uses a default silhouette.
// ============================================================================

const SPECIES_SHAPE_BY_ID: Readonly<Record<string, SpeciesShape>> = Object.freeze({
  // P0 placeholder:
  'species:proto-oak': 'broadleaf-round',
  // P1 White Oak — rounded canopy (docs/biology.md §2 "Iconic, recognizable
  // silhouette").
  'species:white-oak': 'broadleaf-round',
});

/**
 * Resolve a SpeciesShape from a speciesId. Returns 'unknown' if the species
 * is not in the lookup table. The shape is purely visual — it does not exist
 * on TreeSpecies.
 *
 * Future content authors can extend the lookup by appending to
 * `SPECIES_SHAPE_BY_ID`. If a species has no entry, the renderer falls back
 * to the 'unknown' silhouette (P4b's default procedural branch generator).
 */
export function resolveSpeciesShape(speciesId: string): SpeciesShape {
  return SPECIES_SHAPE_BY_ID[speciesId] ?? 'unknown';
}

// ============================================================================
// Season + foliage → SeasonalAppearance string.
//
// Per GDD §4.4 + docs/biology.md §8: deciduous species' `foliage.seasonalCondition`
// approaches a season-specific target each day. The four canonical targets:
//   spring: 0.6  (budding — partial canopy)
//   summer: 1.0  (full canopy)
//   autumn: 0.5  (senescence begins)
//   winter: 0.0  (full dormancy, no foliage)
//
// `seasonalCondition` alone can't disambiguate spring (0.6) from autumn (0.5)
// during the transition window — both cross 0.55 mid-transition. So we use
// the clock's `Season` for the primary classification and only fall back to
// a seasonalCondition heuristic when no Season is provided.
// ============================================================================

const SEASON_TO_APPEARANCE: Readonly<Record<Season, SeasonalAppearance>> = Object.freeze({
  spring: 'spring-buds',
  summer: 'summer-green',
  autumn: 'autumn-color',
  winter: 'winter-bare',
});

/**
 * Derive the SeasonalAppearance from a Season + seasonalCondition.
 *
 * If `season` is provided, it's the authoritative source — the sim's
 * season transitions are crisp (every step recomputes from day-of-year)
 * while `seasonalCondition` is a smoothed value that lags the season.
 *
 * If `season` is undefined (a defensive fallback — the sim always has a
 * season), we derive from `seasonalCondition` thresholds with hysteresis:
 *   - < 0.1     → winter-bare
 *   - < 0.55    → autumn-color
 *   - < 0.85    → spring-buds
 *   - else      → summer-green
 */
export function deriveSeasonalAppearance(
  season: Season | undefined,
  seasonalCondition: number,
): SeasonalAppearance {
  if (season) {
    return SEASON_TO_APPEARANCE[season];
  }
  if (seasonalCondition < 0.1) return 'winter-bare';
  if (seasonalCondition < 0.55) return 'autumn-color';
  if (seasonalCondition < 0.85) return 'spring-buds';
  return 'summer-green';
}

// ============================================================================
// damage[] mapping (GDD §13.4 Physical damage).
//
// TreeState.damage is `TreeDamageState[]` from the sim. We mirror it 1:1 to
// `DamageMarker[]`. The marker type is intentionally a separate interface so
// future rendering phases can add purely-visual fields (e.g. `markerColor`,
// `fadeStart`) without coupling to the sim's schema.
// ============================================================================

/**
 * Map a sim `TreeDamageState` to a renderer `DamageMarker`. Pure 1:1 mirror.
 */
export function mapDamageMarker(d: TreeDamageState): DamageMarker {
  return {
    type: d.type,
    severity: d.severity,
    appliedAt: d.appliedAt,
  };
}

// ============================================================================
// buildTreeRenderData — pure TreeState → TreeRenderData (TDD §15.1).
// ============================================================================

/**
 * Options for `buildTreeRenderData`.
 *
 * - `speciesLookup`: override the default species lookup (which uses
 *   `findSpeciesById` from `@capitalist-tree/content`). Useful for tests
 *   and for swapping content sources without touching rendering code.
 * - `season`: optional explicit Season for `seasonalAppearance` derivation.
 *   If omitted, the appearance is derived from `tree.foliage.seasonalCondition`
 *   thresholds. The React wrapper (P4d) should pass the clock's season so the
 *   appearance matches the sim's actual season.
 */
export interface BuildTreeRenderDataOptions {
  readonly speciesLookup?: (speciesId: string) => TreeSpecies | undefined;
  readonly season?: Season;
}

/**
 * Build a TreeRenderData snapshot from a TreeState (TDD §15.1).
 *
 * Pure: the input `tree` is never mutated. The output is a fresh object.
 *
 * Field derivation:
 *   - `height`, `trunkDiameter`, `branchDevelopment` — direct reads of
 *     `tree.structure.{...}`.
 *   - `foliageDensity` = `currentLeaves / max(leafCapacity, 1)` ∈ [0, 1].
 *     `max(leafCapacity, 1)` guards against divide-by-zero when a tree has
 *     been initialised with `leafCapacity = 0` (defensive — BiologySystem
 *     should never produce this, but rendering must not crash on it).
 *   - `foliageCondition` = `1 - tree.stress`. Stressed leaves are yellower
 *     and less efficient (the biology model uses the same factor — see
 *     docs/biology.md §4 leafHealthF). This is the canonical mapping.
 *   - `seasonalAppearance` — `deriveSeasonalAppearance(options.season, tree.foliage.seasonalCondition)`.
 *   - `damage` — `tree.damage.map(mapDamageMarker)`.
 *   - `alive`, `speciesId`, `ageDays`, `leafCount` (`currentLeaves`) — direct reads.
 *   - `speciesShape` — `resolveSpeciesShape(tree.speciesId)`.
 *
 * Does NOT decide health or energy — only displays supplied state.
 */
export function buildTreeRenderData(
  tree: TreeState,
  options: BuildTreeRenderDataOptions = {},
): TreeRenderData {
  // Foliage density: clamp to [0, 1] for safety. currentLeaves can never
  // exceed leafCapacity by BiologySystem invariant (currentLeaves ≤
  // floor(leafCapacity × seasonalCondition)), but defensive clamping keeps
  // rendering robust against post-migration desync.
  const densityDenominator = Math.max(tree.foliage.leafCapacity, 1);
  const foliageDensity = Math.min(1, Math.max(0, tree.foliage.currentLeaves / densityDenominator));

  // Foliage condition: stress is in [0, 1] by schema invariant, so this is
  // also in [0, 1]. Defensive clamp anyway.
  const foliageCondition = Math.min(1, Math.max(0, 1 - tree.stress));

  return {
    height: tree.structure.height,
    trunkDiameter: tree.structure.trunkDiameter,
    branchDevelopment: tree.structure.branchDevelopment,
    foliageDensity,
    foliageCondition,
    seasonalAppearance: deriveSeasonalAppearance(
      options.season,
      tree.foliage.seasonalCondition,
    ),
    damage: tree.damage.map(mapDamageMarker),
    alive: tree.alive,
    speciesId: tree.speciesId,
    speciesShape: resolveSpeciesShape(tree.speciesId),
    ageDays: tree.ageDays,
    leafCount: tree.foliage.currentLeaves,
  };
}

// Re-export the species lookup from content so consumers can override it in
// tests without a separate import. Kept here (not in types.ts) so types.ts
// stays a pure-type module with no runtime dependencies on content.
export { findSpeciesById };
