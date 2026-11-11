/**
 * EnvironmentRenderData mapping — pure (WorldState, SimulationClock) →
 * EnvironmentRenderData (TDD §15.2, GDD §13.4 surrounding environment).
 *
 * `buildEnvironmentRenderData` is a PURE function: it reads simulation
 * state and produces a visual-data snapshot for the renderer. It NEVER
 * mutates its inputs (rule 6: rendering reads state, never writes —
 * TDD §15.1, GDD §6.1) and it NEVER derives biological / economic values.
 * Every biological / economic decision was already made by the simulation
 * systems before this function runs.
 *
 * The function is designed to be cheap: the React wrapper (P4d) calls it
 * once per simulation tick (typically once per `engine.advance` result),
 * not once per animation frame. The renderer itself runs at the browser's
 * native frame rate against the latest EnvironmentRenderData snapshot
 * (TDD §15.1 — "tree should be rendered independently of the simulation").
 *
 * Extracted from tree-render-data.ts in P4a so the two mapping functions
 * have separate files matching the user-spec for P4a. They share no
 * helpers — keeping them split makes it obvious which file to touch when
 * only the tree or only the environment mapping changes.
 */
import type { WorldState, SimulationClock } from '@capitalist-tree/shared';
import { PROVISIONAL_RESOURCE_CONTAMINATION_FULL_DEGRADE } from '@capitalist-tree/shared';
import {
  PROVISIONAL_RENDER_CO2_HAZE_FLOOR_PPM,
  PROVISIONAL_RENDER_CO2_HAZE_SATURATION_PPM,
} from './constants/rendering.js';
import type { EnvironmentRenderData } from './types.js';

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
