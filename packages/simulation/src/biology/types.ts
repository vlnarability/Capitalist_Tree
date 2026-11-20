/**
 * Shared types for the biology module (P1 — TDD §7).
 *
 * These are internal to the simulation package. The public GameState shapes
 * (TreeState, TreeSpecies, EnvironmentState) live in @capitalist-tree/shared.
 */
import type {
  ClimateBaseline,
  EnvironmentState,
  GameState,
  Season,
  TreeSpecies,
  TreeState,
  WeatherState,
} from '@capitalist-tree/shared';
import { applyHighlandModifier, findClimateById } from '@capitalist-tree/content';

/** Per-step biology inputs — everything BiologySystem needs to advance a tree. */
export interface BiologyContext {
  /** Current simulation time (clock.elapsedSeconds). */
  readonly now: number;
  /** Length of this step in simulation seconds. */
  readonly stepSeconds: number;
  /** Step length in in-game days (= stepSeconds / SECONDS_PER_DAY). */
  readonly stepDays: number;
  /** Current season. */
  readonly season: Season;
  /** Time-of-day fraction in [0, 1). 0 = midnight, 0.25 = 06:00, 0.5 = noon. */
  readonly timeOfDay: number;
  /** The species the tree belongs to. */
  readonly species: TreeSpecies;
  /** The environment the tree is growing in. */
  readonly environment: EnvironmentState;
  /**
   * P11 (W4 / RV2-2): the current step's weather. When present,
   * `photosynthesisForStep` reads `weather.temperature` (the local
   * air temperature that fluctuates with frost/heat-wave conditions) for its
   * temperature Liebig factor instead of `environment.globalTemperature`
   * (the slowly-evolving climate baseline). Optional for backward
   * compatibility with callers that build a context without weather.
   */
  readonly weather?: WeatherState;
  /**
   * GAP-17 (DR-11) Phase 3 deferred follow-up (a): the EFFECTIVE climate (base,
   * or base + `applyHighlandModifier` when elevationM > 0). When present,
   * `photosynthesisForStep` applies the climate-level water-stress Liebig factor
   * (`computeClimateWaterStressFactor`) — the regional precipitation-vs-demand
   * deficit that the per-plot soil-water cap decouples from the tree's buffer.
   * Optional for backward compatibility with callers that build a context
   * without a climate (the factor falls back to 1, no stress).
   */
  readonly climate?: ClimateBaseline;
}

/** Pull the BiologyContext-relevant pieces out of a GameState + ctx pair. */
export function biologyContextFromState(
  state: GameState,
  now: number,
  stepSeconds: number,
  stepDays: number,
  species: TreeSpecies,
): BiologyContext {
  // GAP-17 (DR-11) Phase 3 deferred follow-up (a): thread the effective climate
  // (base, or base + applyHighlandModifier at altitude) so photosynthesis can
  // apply the climate-level water-stress Liebig factor. Falls back to undefined
  // for pre-GAP-17 states without a climateId (the factor then defaults to 1).
  const baseClimate = state.world.climateId ? findClimateById(state.world.climateId) : undefined;
  const elevationM = state.world.elevationM ?? 0;
  const climate =
    baseClimate && elevationM > 0 ? applyHighlandModifier(baseClimate, elevationM) : baseClimate;
  return {
    now,
    stepSeconds,
    stepDays,
    season: state.clock.season,
    timeOfDay: state.clock.timeOfDay,
    species,
    environment: state.world.environment,
    // P11 (W4 / RV2-2): carry the current weather so photosynthesis reads the
    // local temperature (frost/heat-wave fluctuations) rather than the climate
    // baseline. WeatherSystem (slot #2) runs before BiologySystem (slot #3),
    // so `state.world.weather` is the fresh step value.
    weather: state.world.weather,
    // Only set when a climate was resolved (exactOptionalPropertyTypes: an
    // explicit undefined isn't assignable to `climate?`).
    ...(climate ? { climate } : {}),
  };
}

/** Convenience type alias. */
export type { TreeState, TreeSpecies, EnvironmentState };
