import { z } from 'zod';
import { PROVISIONAL_DEFAULT_CURRENCY_ID, PROVISIONAL_DEFAULT_SPECIES_ID, PROVISIONAL_STARTING_PERSONAL_CASH_MINOR } from '../constants/provisional.js';
import { PROVISIONAL_WEATHER_DEFAULT_CLIMATE_ID } from '../constants/resources.js';

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
  /**
   * GAP-17 (DR-11) Phase 3: the Köppen climate zone the player starts in
   * (e.g. `climate:temperate` warm-Dfb, `climate:bwh` hot desert,
   * `climate:dwd` ultra-continental). The WeatherSystem reads this from
   * `state.world.climateId` (stamped at initialize) to pick the transition
   * matrix + the zone's `seasonalBaseTemp` feeds the temperature→growth curve.
   * Defaults to the warm-Dfb temperate zone for back-compat with pre-GAP-17
   * saves + the existing default starting experience.
   */
  climateId: z.string().min(1).default(PROVISIONAL_WEATHER_DEFAULT_CLIMATE_ID),
  /**
   * GAP-17 (DR-11) Phase 4: highland elevation modifier (metres above sea
   * level). When > 0, the WeatherSystem applies the environmental lapse rate
   * (6.5 °C/km) to the climate's `seasonalBaseTemp`, so a highland game is
   * colder at altitude (a Cfb at 2000 m ≈ a subarctic climate). 0 = sea level
   * (the default). Range [0, 4000] — the highest tree-line zones in §5.
   * Defaults to 0 for back-compat with pre-GAP-17 saves.
   */
  elevationM: z.number().nonnegative().max(4000).default(0),
  currencyId: z.string().min(1).default(PROVISIONAL_DEFAULT_CURRENCY_ID),
  // Optional wall-clock createdAt timestamp (ms). Tests pass an explicit
  // value to stay deterministic; production reads Date.now() ONCE here.
  createdAt: z.number().int().nonnegative().optional(),
});
export type GameConfig = z.infer<typeof gameConfigSchema>;
