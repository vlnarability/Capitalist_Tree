/**
 * Save envelope: the on-disk JSON shape for a saved game (TDD §14.2).
 *
 * The envelope wraps the GameState with a `schemaVersion` so the migration
 * framework can detect older saves and run them forward. Saves MUST NOT be
 * silently discarded if the schemaVersion is unknown — the loader raises
 * `UnknownSchemaVersionError` so the UI can surface the problem.
 */
import { z } from 'zod';
import { gameStateSchema } from './game-state.js';
import type { GameState } from './game-state.js';
import { CURRENT_SCHEMA_VERSION } from '../constants/provisional.js';

export const saveEnvelopeSchema = z.object({
  schemaVersion: z.number().int().nonnegative(),
  state: gameStateSchema,
});
export type SaveEnvelope = z.infer<typeof saveEnvelopeSchema>;

/** Wrap a GameState in a save envelope at the current schema version. */
export function envelope(state: GameState): SaveEnvelope {
  return { schemaVersion: CURRENT_SCHEMA_VERSION, state };
}
