/**
 * Shared types for the resources module (P2 — TDD §8).
 *
 * These are internal to the simulation package. The public GameState shapes
 * (EnvironmentState, Fertilizer, etc.) live in @capitalist-tree/shared.
 */
import type {
  EnvironmentState,
  Fertilizer,
  GameState,
  NutrientState,
  Season,
  TreeState,
  WeatherState,
} from '@capitalist-tree/shared';

/** Per-step resource inputs — everything ResourceSystem needs to advance. */
export interface ResourceContext {
  /** Current simulation time (clock.elapsedSeconds). */
  readonly now: number;
  /** Length of this step in simulation seconds. */
  readonly stepSeconds: number;
  /** Step length in in-game days (= stepSeconds / SECONDS_PER_DAY). */
  readonly stepDays: number;
  /** Current season. */
  readonly season: Season;
  /** Current weather (just produced by WeatherSystem). */
  readonly weather: WeatherState;
  /** The environment (soil, freshwater, atmosphere, etc.). */
  readonly environment: EnvironmentState;
  /** The original tree (for water/nutrient uptake). */
  readonly tree: TreeState;
}

/** Pull the ResourceContext-relevant pieces out of a GameState. */
export function resourceContextFromState(state: GameState): ResourceContext {
  return {
    now: state.clock.elapsedSeconds,
    stepSeconds: 60, // PROVISIONAL_SIMULATION_STEP_SECONDS
    stepDays: 60 / 86400,
    season: state.clock.season,
    weather: state.world.weather,
    environment: state.world.environment,
    tree: state.originalTree,
  };
}

/** Convenience type aliases. */
export type { EnvironmentState, Fertilizer, GameState, NutrientState, TreeState, WeatherState };
