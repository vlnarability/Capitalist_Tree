import { z } from 'zod';

/**
 * Serializable RNG state.
 *
 * The engine's seeded RNG (sfc32 in packages/simulation) holds four 32-bit
 * unsigned integers as its live state. We persist them as a fixed-length
 * tuple of numbers so the RNG position survives save/load — this is what
 * makes the simulation deterministic across reloads (TDD §18.3).
 */
export const rngStateSchema = z.tuple([
  z.number().int().min(0).max(0xffffffff),
  z.number().int().min(0).max(0xffffffff),
  z.number().int().min(0).max(0xffffffff),
  z.number().int().min(0).max(0xffffffff),
]);
export type RngState = z.infer<typeof rngStateSchema>;
