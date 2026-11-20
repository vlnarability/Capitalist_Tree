/**
 * Player → regional environmental bridge (P11 W6 / RV4-F-H3).
 *
 * Pre-W6, player actions (harvest, operate-business, purchase-equipment)
 * had NO pathway into the P10 regional model — `eventState.global.regions`
 * only moved via stochastic events in `evolveRegions`. The `industrialActivity`
 * lever (the sole driver of pollution accumulation, which in turn drives
 * soil/water/forest/biodiversity decline) was never written by anything.
 * This left the player decoupled from regional state (RV4-F-H3) and made the
 * `last-tree` objective unreachable (RV4-F-H1 — no way to raise
 * `aggregateActivity ≥ 0.6` without stochastic events).
 *
 * This module maps an `EnvironmentalImpact` payload (carried by every
 * BusinessState + AutomationState, copied from the content definition's
 * `baseEnvironmentalImpact` at purchase time) onto the player's HOME REGION
 * (`PLAYER_HOME_REGION_ID`). The downstream `evolveRegions` (next EventSystem
 * tick) then propagates the industrialActivity/pollution change into
 * soil/water/forest/biodiversity, and `aggregateGlobalIndicators` rolls it
 * into `avgBiodiversity` / `avgForestCoverage` / `ecosystemResilience`.
 *
 * Pure: returns a new state; the input is never mutated.
 */
import type { GameState } from '@capitalist-tree/shared';
import type { EnvironmentalImpact } from '@capitalist-tree/shared';
import { PLAYER_HOME_REGION_ID } from '@capitalist-tree/shared';

/** Clamp a value to [0, 1]. */
function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Per-field scale factors mapping an `EnvironmentalImpact` to regional deltas.
 *
 * The impact fields are raw content numbers (e.g. extraction.pollution = 0.01,
 * manufacturing.landDisturbance = 0.1, application.waterConsumption = 30).
 * The scales convert these to meaningful per-action regional indicator deltas:
 *   - industrialActivity: raised by the combined industrial footprint
 *     (pollution + landDisturbance + carbonEmissions×0.1). A heavy
 *     manufacturing operation (~0.4 combined) raises industrialActivity by
 *     ~0.08/tick; a light extraction operation (~0.08 combined) by ~0.016.
 *     Sustained extraction raises the home region to 1.0 in ~30 operations,
 *     pushing the population-weighted aggregate past the 0.6 W5 threshold.
 *   - pollution: added to air (full), water (×0.5), soil (×0.3) — mirrors the
 *     `evolveRegions` accumulation split.
 *   - forestCoverage: reduced by landDisturbance (clearing).
 *   - biodiversity: reduced by biodiversityImpact (habitat loss).
 *   - waterAvailability: reduced by waterConsumption (drawdown).
 *   - soilHealth: reduced by soilDegradation (nutrient depletion).
 *
 * @provisional — tuned so a realistic extraction strategy reaches the W5
 * threshold; final calibration from playtesting.
 */
export const PLAYER_IMPACT_SCALES = {
  industrialActivity: 0.2, // per unit of combined footprint
  pollutionAir: 50, // pollution field → air load
  forestCoverage: 0.5, // landDisturbance → forest loss
  biodiversity: 0.3, // biodiversityImpact → biodiversity loss
  waterAvailability: 0.002, // waterConsumption → water drawdown
  soilHealth: 0.5, // soilDegradation → soil loss
} as const;

/** The combined industrial footprint of an impact (drives industrialActivity). */
function industrialFootprint(impact: EnvironmentalImpact): number {
  return (
    impact.pollution +
    impact.landDisturbance +
    impact.carbonEmissions * 0.1
  );
}

/**
 * Apply a player action's environmental impact to the home region.
 *
 * Returns a new state with the home region's indicators adjusted. If the home
 * region doesn't exist (e.g. regions not yet seeded — the EventSystem seeds
 * them on its first tick), the state is returned unchanged (the impact is
 * silently dropped; it will apply once regions exist).
 *
 * The 0-1 fields (industrialActivity, forestCoverage, biodiversity,
 * waterAvailability, soilHealth) are clamped to [0, 1]. Pollution fields are
 * non-negative (floored at 0).
 *
 * Pure: never mutates the input.
 */
export function applyPlayerEnvironmentalImpact(
  state: GameState,
  impact: EnvironmentalImpact,
): GameState {
  const regions = state.eventState.global.regions;
  const homeIdx = regions.findIndex((r) => r.id === PLAYER_HOME_REGION_ID);
  if (homeIdx === -1) {
    // Regions not seeded yet (EventSystem hasn't run). Drop the impact —
    // it will apply on the next action once regions exist.
    return state;
  }

  const home = regions[homeIdx]!;
  const footprint = industrialFootprint(impact);
  const s = PLAYER_IMPACT_SCALES;

  const industrialActivity = clamp01(
    home.industrialActivity + footprint * s.industrialActivity,
  );
  const pollution = {
    air: Math.max(0, home.pollution.air + impact.pollution * s.pollutionAir),
    water: Math.max(
      0,
      home.pollution.water + impact.pollution * s.pollutionAir * 0.5,
    ),
    soil: Math.max(
      0,
      home.pollution.soil + impact.pollution * s.pollutionAir * 0.3,
    ),
  };
  const forestCoverage = clamp01(
    home.forestCoverage - impact.landDisturbance * s.forestCoverage,
  );
  const biodiversity = clamp01(
    home.biodiversity - impact.biodiversityImpact * s.biodiversity,
  );
  const waterAvailability = clamp01(
    home.waterAvailability - impact.waterConsumption * s.waterAvailability,
  );
  const soilHealth = clamp01(
    home.soilHealth - impact.soilDegradation * s.soilHealth,
  );

  const updatedRegion = {
    ...home,
    industrialActivity,
    pollution,
    forestCoverage,
    biodiversity,
    waterAvailability,
    soilHealth,
  };

  return {
    ...state,
    eventState: {
      ...state.eventState,
      global: {
        ...state.eventState.global,
        regions: regions.map((r, i) => (i === homeIdx ? updatedRegion : r)),
      },
    },
  };
}
