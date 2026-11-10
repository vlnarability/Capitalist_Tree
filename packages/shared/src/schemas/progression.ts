import { z } from 'zod';

/**
 * Progression state (TDD §5.1).
 *
 * Tracks research, achievements, and (eventually) genetic legacy / prestige
 * (GDD §11). P0 leaves an empty state.
 */
export const progressionStateSchema = z.object({
  research: z.array(
    z.object({
      id: z.string().min(1),
      completedAt: z.number().int().nonnegative(),
    }),
  ),
  achievements: z.array(
    z.object({
      id: z.string().min(1),
      completedAt: z.number().int().nonnegative(),
    }),
  ),
  // PROVISIONAL (GDD §17: Genetic Legacy calculation)
  geneticLegacy: z.number().nonnegative(),
});
export type ProgressionState = z.infer<typeof progressionStateSchema>;
