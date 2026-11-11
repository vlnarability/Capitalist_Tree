/**
 * TreeRenderData mapping — pure state → visual contract (TDD §15.1, GDD §13.4).
 *
 * `buildTreeRenderData` and `buildEnvironmentRenderData` are PURE functions:
 * they read simulation state and produce a visual-data snapshot for the
 * renderer. They NEVER mutate their inputs (rule 6: rendering reads state,
 * never writes — TDD §15.1, GDD §6.1) and they NEVER derive biological /
 * economic values. Every biological / economic decision was already made by
 * the simulation systems before these functions run.
 *
 * The functions are designed to be cheap: the React wrapper (P4d) will call
 * them once per simulation tick (typically once per `engine.advance` result),
 * not once per animation frame. The renderer itself runs at the browser's
 * native frame rate against the latest TreeRenderData / EnvironmentRenderData
 * snapshot (TDD §15.1 — "tree should be rendered independently of the
 * simulation").
 */
import type {
  TreeState,
  WorldState,
  SimulationClock,
  Season,
  TreeSpecies,
  TreeDamageState,
} from '@capitalist-tree/shared';
import {
  PROVISIONAL_RESOURCE_CONTAMINATION_FULL_DEGRADE,
} from '@capitalist-tree/shared';
import { findSpeciesById } from '@capitalist-tree/content';
import {
  PROVISIONAL_RENDER_CO2_HAZE_FLOOR_PPM,
  PROVISIONAL_RENDER_CO2_HAZE_SATURATION_PPM,
} from './constants/rendering.js';
import type {
  TreeRenderData,
  EnvironmentRenderData,
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

// ============================================================================
// buildEnvironmentRenderData — pure (WorldState, SimulationClock) → EnvironmentRenderData
// (TDD §15.2).
// ============================================================================

/**
 * Options for `buildEnvironmentRenderData`.
 *
 * Reserved for future visual overrides (regional palette, custom color
 * schemes, etc.). P4a ships no options — the function reads everything from
 * the world + clock. The argument is included for forward compatibility so
 * the public signature doesn't change when P4c adds tuning hooks.
 */
export interface BuildEnvironmentRenderDataOptions {
  /**
   * Optional override for the CO2 haze floor (ppm). Defaults to
   * `PROVISIONAL_RENDER_CO2_HAZE_FLOOR_PPM`. Useful for tests asserting the
   * mapping shape without depending on the exact provisional constant.
   */
  readonly co2HazeFloorPpm?: number;
  /**
   * Optional override for the CO2 haze saturation point (ppm). Defaults to
   * `PROVISIONAL_RENDER_CO2_HAZE_SATURATION_PPM`.
   */
  readonly co2HazeSaturationPpm?: number;
  /**
   * Optional override for the contamination full-degrade level. Defaults to
   * `PROVISIONAL_RESOURCE_CONTAMINATION_FULL_DEGRADE` from shared.
   */
  readonly contaminationFullDegrade?: number;
}

/**
 * Build an EnvironmentRenderData snapshot from a WorldState + SimulationClock
 * (TDD §15.2).
 *
 * Pure: neither `world` nor `clock` is mutated. Output is a fresh object.
 *
 * Field derivation:
 *   - `soilCondition` = `world.environment.soil.health` (already [0, 1]).
 *   - `soilContamination` = `clamp(contamination / FULL_DEGRADE, 0, 1)`.
 *   - `weatherCondition` = `world.weather.condition`.
 *   - `weatherIntensity` = `world.weather.intensity`.
 *   - `timeOfDay` = `clock.timeOfDay`.
 *   - `season` = `clock.season`.
 *   - `co2Level` = `world.environment.atmosphere.co2Concentration` (ppm).
 *   - `pollutionLevel` — coarse proxy from CO2 + emissions, clamped to [0, 1].
 *     P6+ EnvironmentSystem will populate a more granular index; P4a derives
 *     a coarse haze driver so the renderer has *something* to react to.
 *   - `biodiversityLevel` = `world.environment.biodiversity.index`.
 */
export function buildEnvironmentRenderData(
  world: WorldState,
  clock: SimulationClock,
  options: BuildEnvironmentRenderDataOptions = {},
): EnvironmentRenderData {
  const co2Floor = options.co2HazeFloorPpm ?? PROVISIONAL_RENDER_CO2_HAZE_FLOOR_PPM;
  const co2Sat = options.co2HazeSaturationPpm ?? PROVISIONAL_RENDER_CO2_HAZE_SATURATION_PPM;
  const fullDegrade =
    options.contaminationFullDegrade ?? PROVISIONAL_RESOURCE_CONTAMINATION_FULL_DEGRADE;

  const co2Level = world.environment.atmosphere.co2Concentration;

  // Pollution proxy: derived from CO2 (atmospheric stock) + emissions (flow).
  // We take the MAX of the two factors rather than the average so that
  // either signal alone can saturate the haze (a high-CO2 atmosphere OR a
  // heavy-emissions regime each push pollution to 1 on their own). P6+
  // EnvironmentSystem will own a real pollution index; this is a coarse
  // driver so P4c has a haze signal to react to.
  const co2Excess = Math.max(0, co2Level - co2Floor);
  const co2Span = Math.max(1, co2Sat - co2Floor);
  const co2Pollution = Math.min(1, co2Excess / co2Span);

  // Emissions: a negative value (sequestration) contributes 0; positive
  // emissions contribute scaled by a soft cap. The 100 emissions-unit cap
  // is a @provisional rendering tuning — P6+ will replace with the real
  // pollution model.
  const emissionsPollution = Math.min(
    1,
    Math.max(0, world.environment.atmosphere.emissions) / 100,
  );

  const pollutionLevel = Math.min(1, Math.max(co2Pollution, emissionsPollution));

  // Soil contamination normalised to [0, 1] against the full-degrade level.
  const soilContamination = Math.min(
    1,
    Math.max(0, world.environment.soil.contamination / Math.max(1, fullDegrade)),
  );

  return {
    soilCondition: world.environment.soil.health,
    soilContamination,
    weatherCondition: world.weather.condition,
    weatherIntensity: world.weather.intensity,
    timeOfDay: clock.timeOfDay,
    season: clock.season,
    pollutionLevel,
    biodiversityLevel: world.environment.biodiversity.index,
    co2Level,
  };
}

// Re-export the species lookup from content so consumers can override it in
// tests without a separate import. Kept here (not in types.ts) so types.ts
// stays a pure-type module with no runtime dependencies on content.
export { findSpeciesById };
