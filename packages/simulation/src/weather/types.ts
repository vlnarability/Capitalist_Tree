/**
 * Shared types for the weather module (P2 — TDD §9).
 *
 * These are internal to the simulation package. The public GameState shapes
 * (WeatherState, ClimateBaseline, WeatherTransitionMatrix) live in
 * @capitalist-tree/shared.
 */
import type {
  ClimateBaseline,
  GameState,
  Season,
  WeatherCondition,
  WeatherEventDefinition,
  WeatherState,
  WeatherTransitionMatrix,
} from '@capitalist-tree/shared';

/** Per-step weather inputs — everything WeatherSystem needs to advance. */
export interface WeatherContext {
  /** Current simulation time (clock.elapsedSeconds). */
  readonly now: number;
  /** Length of this step in simulation seconds. */
  readonly stepSeconds: number;
  /** Step length in in-game days (= stepSeconds / SECONDS_PER_DAY). */
  readonly stepDays: number;
  /** Current season. */
  readonly season: Season;
  /** Active climate baseline (looked up by content id). */
  readonly climate: ClimateBaseline;
  /** Transition matrix for (climate, season). */
  readonly matrix: WeatherTransitionMatrix;
  /** Map of condition -> event definition (looked up by content id). */
  readonly eventMap: Readonly<Record<WeatherCondition, WeatherEventDefinition>>;
  /** Trees the weather can damage (P2: just the original tree). */
  readonly treeIds: readonly string[];
}

/** Pull the WeatherContext-relevant pieces out of a GameState + ctx pair. */
export function weatherContextFromState(state: GameState, climateId: string): {
  climate: ClimateBaseline;
  matrix: WeatherTransitionMatrix;
} | null {
  // Look up the climate + transition matrix via the content package.
  // The WeatherSystem does the actual lookup; this helper is for tests.
  void climateId;
  void state;
  return null;
}

/** Convenience type alias. */
export type { WeatherState, ClimateBaseline, WeatherTransitionMatrix, WeatherEventDefinition };
