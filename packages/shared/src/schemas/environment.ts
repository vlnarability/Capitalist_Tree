import { z } from 'zod';
import { nutrientStateSchema } from './tree.js';

export const speciesPopulationSchema = z.object({
  speciesId: z.string(),
  population: z.number().nonnegative(),
});
export type SpeciesPopulation = z.infer<typeof speciesPopulationSchema>;

/**
 * Global environmental state (TDD §5.5).
 *
 * Regional environments will eventually reuse this shape (TDD §5.5 note).
 * All fields are physical quantities; P0 leaves them at neutral defaults.
 */
export const environmentStateSchema = z.object({
  atmosphere: z.object({
    co2Concentration: z.number().nonnegative(),
    emissions: z.number(),
    sequestration: z.number(),
  }),
  soil: z.object({
    health: z.number().min(0).max(1),
    organicMatter: z.number().nonnegative(),
    contamination: z.number().nonnegative(),
    nutrients: nutrientStateSchema,
  }),
  freshwater: z.object({
    availability: z.number().nonnegative(),
    groundwater: z.number().nonnegative(),
    contamination: z.number().nonnegative(),
  }),
  biodiversity: z.object({
    index: z.number().min(0).max(1),
    speciesPopulations: z.array(speciesPopulationSchema),
  }),
  forestCoverage: z.number().min(0).max(1),
  ecosystemResilience: z.number().min(0).max(1),
  globalTemperature: z.number(),
});
export type EnvironmentState = z.infer<typeof environmentStateSchema>;

/**
 * World state — wraps global environment plus a stub for regional data.
 * P0 has a single region (the player's land).
 */
export const worldStateSchema = z.object({
  environment: environmentStateSchema,
  // PROVISIONAL: regional granularity is unresolved (GDD §17). P0 has one
  // implicit region. P6/P9 will expand this into a region map.
  regionId: z.string().min(1),
});
export type WorldState = z.infer<typeof worldStateSchema>;
