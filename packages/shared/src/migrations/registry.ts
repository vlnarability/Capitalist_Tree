/**
 * Migration framework (TDD §14.3).
 *
 * Migrations are pure functions: `(oldState) => newState`. They are
 * registered in a `MigrationRegistry` keyed by source version. The runner
 * walks from the save's `schemaVersion` up to `targetVersion`, applying
 * each registered migration in order.
 *
 * If a save's `schemaVersion` is unknown (no migration from it, and it
 * isn't the current version), `migrate()` raises `UnknownSchemaVersionError`
 * — saves MUST NOT be silently discarded (TDD §14.3, P0 spec).
 */
import type { GameState } from '../schemas/game-state.js';
import { UnknownSchemaVersionError } from '../errors.js';

export type Migration = (state: GameState) => GameState;

export class MigrationRegistry {
  private readonly migrations = new Map<number, Migration>();

  /** Register a migration from `fromVersion` to `fromVersion + 1`. */
  register(fromVersion: number, migration: Migration): this {
    if (this.migrations.has(fromVersion)) {
      throw new Error(
        `MigrationRegistry: duplicate migration from version ${fromVersion}`,
      );
    }
    this.migrations.set(fromVersion, migration);
    return this;
  }

  /** All "from" versions we know how to migrate from. */
  knownVersions(): number[] {
    return [...this.migrations.keys()];
  }

  /**
   * Migrate `state` from its current `schemaVersion` (read from the envelope
   * by the caller) up to `targetVersion`.
   *
   * Returns the migrated state. If `fromVersion === targetVersion`, returns
   * state unchanged. If `fromVersion > targetVersion`, raises
   * `UnknownSchemaVersionError` (downgrades are not supported).
   *
   * If any intermediate version is missing a registered migration, raises
   * `UnknownSchemaVersionError` (rather than silently discarding the save).
   */
  migrate(state: GameState, fromVersion: number, targetVersion: number): GameState {
    if (fromVersion === targetVersion) {
      return state;
    }
    if (fromVersion > targetVersion) {
      throw new UnknownSchemaVersionError(fromVersion, [
        ...this.migrations.keys(),
        targetVersion,
      ]);
    }
    let current = state;
    let v = fromVersion;
    while (v < targetVersion) {
      const m = this.migrations.get(v);
      if (!m) {
        throw new UnknownSchemaVersionError(v, [...this.migrations.keys(), targetVersion]);
      }
      current = m(current);
      v += 1;
    }
    return current;
  }
}

/**
 * The default registry used by `Storage.load()` and `Storage.validate()`.
 *
 * P0 includes a single sample migration v0 -> v1 used by tests. Real
 * migrations will be added as the GameState shape evolves.
 */
export const migrations = new MigrationRegistry();
