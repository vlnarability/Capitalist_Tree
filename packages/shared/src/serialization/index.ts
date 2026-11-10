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
import { gameStateSchema, type GameState } from '../schemas/game-state.js';
import { saveEnvelopeSchema, type SaveEnvelope } from '../schemas/save.js';
import { CURRENT_SCHEMA_VERSION } from '../constants/provisional.js';
import { migrations } from '../migrations/index.js';
import { SaveValidationError, UnknownSchemaVersionError } from '../errors.js';

/** Serialize a GameState to a JSON-safe save envelope. */
export function serialize(state: GameState): SaveEnvelope {
  return { schemaVersion: CURRENT_SCHEMA_VERSION, state };
}

/**
 * Deserialize a raw save envelope into a validated GameState.
 *
 * Steps:
 *   1. Parse envelope shape (must have schemaVersion + state).
 *   2. Run migrations from `schemaVersion` to CURRENT_SCHEMA_VERSION. If
 *      schemaVersion is unknown, raises UnknownSchemaVersionError (NOT silent discard).
 *   3. Validate the migrated state against gameStateSchema (incl. superRefine).
 *
 * On validation failure, raises SaveValidationError with the Zod issues.
 */
export function deserialize(raw: unknown): GameState {
  let envelope: SaveEnvelope;
  try {
    envelope = saveEnvelopeSchema.parse(raw);
  } catch (err) {
    if (err && typeof err === 'object' && 'issues' in err) {
      throw new SaveValidationError('Save envelope failed validation', (err as { issues: unknown[] }).issues);
    }
    throw err;
  }
  const migrated = migrations.migrate(envelope.state, envelope.schemaVersion, CURRENT_SCHEMA_VERSION);
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
