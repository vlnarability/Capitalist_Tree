import { z } from 'zod';
import { PROVISIONAL_DEFAULT_CURRENCY_ID, PROVISIONAL_DEFAULT_SPECIES_ID, PROVISIONAL_STARTING_PERSONAL_CASH_MINOR } from '../constants/provisional.js';

/**
 * Game configuration passed to `SimulationEngine.initialize` (TDD §4.1).
 *
 * All values are explicit — `initialize` does not consult the system clock
 * or Math.random() (GDD §1 deterministic rule). The player's seed and
 * starting conditions come from here.
 *
 * Most fields default to PROVISIONAL_* constants from
 * `packages/shared/src/constants/provisional.ts`. Override them in tests
 * for reproducibility.
 */
export const gameConfigSchema = z.object({
  seed: z.number().int(),
  saveId: z.string().min(1).default('save-default'),
  // Starting in-game day. 0 = first day of spring.
  startingDay: z.number().int().nonnegative().default(0),
  // Starting personal cash, in minor currency units (bigint-as-string).
  startingPersonalCash: z.string().default(String(PROVISIONAL_STARTING_PERSONAL_CASH_MINOR)),
  speciesId: z.string().min(1).default(PROVISIONAL_DEFAULT_SPECIES_ID),
  currencyId: z.string().min(1).default(PROVISIONAL_DEFAULT_CURRENCY_ID),
  // Optional wall-clock createdAt timestamp (ms). Tests pass an explicit
  // value to stay deterministic; production reads Date.now() ONCE here.
  createdAt: z.number().int().nonnegative().optional(),
});
export type GameConfig = z.infer<typeof gameConfigSchema>;
