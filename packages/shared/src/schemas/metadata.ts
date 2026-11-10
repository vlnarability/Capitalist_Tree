import { z } from 'zod';

/**
 * Game metadata (TDD §5.2).
 *
 * Timestamps are Unix milliseconds. The random seed is persisted so the
 * entire RNG sequence can be reconstructed from a save (the live RNG position
 * is persisted separately on GameState.rngState — see game-state.ts).
 */
export const gameMetadataSchema = z.object({
  saveId: z.string().min(1),
  // `version` is the simulation/engine version (separate from schemaVersion
  // on the save envelope). Bumped when engine behaviour changes.
  version: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  lastSavedAt: z.number().int().nonnegative(),
  lastSimulatedAt: z.number().int().nonnegative(),
  randomSeed: z.number().int(),
  simulationVersion: z.number().int().nonnegative(),
});
export type GameMetadata = z.infer<typeof gameMetadataSchema>;
