/**
 * Shared types for the biology module (P1 — TDD §7).
 *
 * These are internal to the simulation package. The public GameState shapes
 * (TreeState, TreeSpecies, EnvironmentState) live in @capitalist-tree/shared.
 */
import type {
  EnvironmentState,
  GameState,
  Season,
  TreeSpecies,
  TreeState,
} from '@capitalist-tree/shared';

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
}

/** Pull the BiologyContext-relevant pieces out of a GameState + ctx pair. */
export function biologyContextFromState(
  state: GameState,
  now: number,
  stepSeconds: number,
  stepDays: number,
  species: TreeSpecies,
): BiologyContext {
  return {
    now,
    stepSeconds,
    stepDays,
    season: state.clock.season,
    timeOfDay: state.clock.timeOfDay,
    species,
    environment: state.world.environment,
  };
}

/** Convenience type alias. */
export type { TreeState, TreeSpecies, EnvironmentState };
