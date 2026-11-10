import { z } from 'zod';

// PROVISIONAL (GDD §4.4 / TDD §6.1: seasons)
//
// The four in-game seasons. Order matches the canonical start-of-year order
// (spring first). Used by the TimeSystem to derive season from day-of-year.
export const seasonSchema = z.enum(['spring', 'summer', 'autumn', 'winter']);
export type Season = z.infer<typeof seasonSchema>;

export const SEASONS_IN_ORDER: readonly Season[] = [
  'spring',
  'summer',
  'autumn',
  'winter',
] as const;

// Coarse phase of day, derived from timeOfDay fraction by the TimeSystem.
export const dayPhaseSchema = z.enum(['dawn', 'day', 'dusk', 'night']);
export type DayPhase = z.infer<typeof dayPhaseSchema>;

/**
 * Simulation clock (TDD §6.1).
 *
 * - `elapsedSeconds`: total simulation seconds since game start. Monotonic
 *   integer multiple of SIMULATION_STEP_SECONDS after each `advance` call.
 * - `day`: in-game day counter, starts at 0.
 * - `season`: derived from day-of-year. The TimeSystem recomputes this each
 *   step; it is persisted on the clock so consumers (UI, save) can read it
 *   without recomputing.
 * - `timeOfDay`: fraction of the current in-game day in [0, 1).
 *   0 = midnight, 0.25 = 06:00, 0.5 = noon, 0.75 = 18:00.
 *   Kept as a number (not an object) to match TDD §6.1 exactly.
 * - `speedMultiplier`: 0 (paused) | 1 | 5 | 15 | 60. Persisted so save/load
 *   preserves the player's selected speed.
 * - `paused`: explicit pause flag. The accumulator layer in apps/web checks
 *   this; `engine.advance` itself does NOT short-circuit on `paused` (the
 *   Pause contract — see docs/simulation.md). This keeps the engine pure and
 *   makes `paused` purely a UI/accumulator concern.
 */
export const simulationClockSchema = z.object({
  elapsedSeconds: z.number().int().nonnegative(),
  day: z.number().int().nonnegative(),
  season: seasonSchema,
  timeOfDay: z.number().min(0).max(1),
  speedMultiplier: z.number(),
  paused: z.boolean(),
});
export type SimulationClock = z.infer<typeof simulationClockSchema>;
