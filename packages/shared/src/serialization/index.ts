/**
 * Serialization helpers.
 *
 * The GameState contains bigint minor-unit money fields stored as strings
 * (TDD §10.1). These helpers convert between the in-memory form (string,
 * for safe JSON round-trip) and bigint for engine arithmetic.
 *
 * `serialize(state)` returns a JSON-safe plain object (it's already plain
 * because we store bigints as strings). `deserialize(raw)` runs Zod
 * validation and migrations. Both are pure.
 */
import { z } from 'zod';
import { gameStateSchema, type GameState } from '../schemas/game-state.js';
import { saveEnvelopeSchema, type SaveEnvelope } from '../schemas/save.js';
import { CURRENT_SCHEMA_VERSION } from '../constants/provisional.js';
import { migrations } from '../migrations/index.js';
import { SaveValidationError, UnknownSchemaVersionError } from '../errors.js';

/**
 * Loose envelope shape used by `deserialize()` to peek at `schemaVersion`
 * before migrating. We do NOT validate `state` here — that would reject
 * older saves before migrations could fix them (TDD §14.3).
 */
const looseEnvelopeSchema = z.object({
  schemaVersion: z.number().int().nonnegative(),
  state: z.unknown(),
});

/** Serialize a GameState to a JSON-safe save envelope. */
export function serialize(state: GameState): SaveEnvelope {
  return { schemaVersion: CURRENT_SCHEMA_VERSION, state };
}

/**
 * Deserialize a raw save envelope into a validated GameState.
 *
 * Order of operations (TDD §14.3: migrations MUST run before strict
 * validation, otherwise older saves whose `state` no longer matches the
 * current schema would be rejected before the migration can fix them):
 *
 *   1. Parse the envelope *shape* loosely — only `schemaVersion` (a
 *      nonnegative int) and `state` (unknown). The state's internals are
 *      NOT validated here; that comes after migration.
 *   2. Run migrations from `schemaVersion` to CURRENT_SCHEMA_VERSION. If
 *      `schemaVersion` is unknown, raises UnknownSchemaVersionError
 *      (NOT silent discard).
 *   3. Strictly validate the migrated state against gameStateSchema
 *      (including the originalTree superRefine invariants).
 *
 * On validation failure, raises SaveValidationError with the Zod issues.
 */
export function deserialize(raw: unknown): GameState {
  // Step 1 — envelope shape only. We deliberately do NOT call
  // `saveEnvelopeSchema.parse(raw)` here because that schema requires
  // `state` to conform to the *current* gameStateSchema, which would
  // reject older saves before migrations could run.
  const looseEnvelope = looseEnvelopeSchema.safeParse(raw);
  if (!looseEnvelope.success) {
    throw new SaveValidationError('Save envelope failed validation', looseEnvelope.error.issues);
  }
  const env = looseEnvelope.data;

  // Step 2 — migrate. Throws UnknownSchemaVersionError for unknown versions.
  const migrated = migrations.migrate(
    env.state as GameState,
    env.schemaVersion,
    CURRENT_SCHEMA_VERSION,
  );

  // Step 3 — strict validate the migrated state.
  const parsed = gameStateSchema.safeParse(migrated);
  if (!parsed.success) {
    throw new SaveValidationError('Save state failed validation', parsed.error.issues);
  }
  return parsed.data;
}

/** Validate a raw save envelope WITHOUT migrating — used by tests to assert
 * that an unknown schemaVersion raises a typed error rather than being
 * silently discarded. */
export function validateWithoutMigrate(raw: unknown): GameState {
  const envelope = saveEnvelopeSchema.parse(raw);
  const parsed = gameStateSchema.safeParse(envelope.state);
  if (!parsed.success) {
    throw new SaveValidationError('Save state failed validation', parsed.error.issues);
  }
  return parsed.data;
}

/** Throw `UnknownSchemaVersionError` if the envelope's schemaVersion is unknown
 *  to the registry. Used by `Storage.load()` to short-circuit. */
export function assertKnownSchemaVersion(version: number): void {
  const known = [...migrations.knownVersions(), CURRENT_SCHEMA_VERSION];
  if (version > CURRENT_SCHEMA_VERSION && !migrations.knownVersions().includes(version)) {
    throw new UnknownSchemaVersionError(version, known);
  }
}
