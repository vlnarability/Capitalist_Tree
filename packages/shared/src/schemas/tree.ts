import { z } from 'zod';

/**
 * Tree biological state (TDD §5.4 / GDD §5.1).
 *
 * Money uses bigint minor units (TDD §10.1, GDD §6). The bigint is stored
 * as a string in JSON for safe round-tripping; the schema converts on
 * parse/stringify via the `bigintString` helper.
 *
 * Notes:
 * - `id` MUST be `'original'` for the original tree (enforced by
 *   gameStateSchema superRefine, GDD §16.1/16.2, TDD §18.4).
 * - `isOriginal` MUST be `true` for the original tree (same superRefine).
 * - `ageDays` MUST be >= 0 (validated here + invariant-checked by BiologySystem
 *   in a later phase).
 * - `health` is a derived indicator (GDD §5.1) — it is stored on the tree so
 *   consumers can read it, but it MUST be recomputed by BiologySystem from
 *   underlying biological factors. P0 leaves it at a placeholder 1.0.
 */
export const treeDamageStateSchema = z.object({
  type: z.string().min(1),
  severity: z.number().min(0).max(1),
  appliedAt: z.number().int().nonnegative(),
});
export type TreeDamageState = z.infer<typeof treeDamageStateSchema>;

export const nutrientStateSchema = z.object({
  nitrogen: z.number().nonnegative(),
  phosphorus: z.number().nonnegative(),
  potassium: z.number().nonnegative(),
});
export type NutrientState = z.infer<typeof nutrientStateSchema>;

export const treeStructureSchema = z.object({
  height: z.number().nonnegative(),
  trunkDiameter: z.number().nonnegative(),
  branchDevelopment: z.number().nonnegative(),
  structuralIntegrity: z.number().min(0).max(1),
});

export const treeFoliageSchema = z.object({
  currentLeaves: z.number().int().nonnegative(),
  leafCapacity: z.number().int().nonnegative(),
  activeLeafArea: z.number().nonnegative(),
  seasonalCondition: z.number().min(0).max(1),
});

export const treeRootsSchema = z.object({
  development: z.number().nonnegative(),
  absorptionCapacity: z.number().nonnegative(),
});

export const treeEnergySchema = z.object({
  reserves: z.number().nonnegative(),
  production: z.number().nonnegative(),
  consumption: z.number().nonnegative(),
});

export const treeWaterSchema = z.object({
  stored: z.number().nonnegative(),
  capacity: z.number().nonnegative(),
});

export const treeStateSchema = z.object({
  id: z.string().min(1),
  speciesId: z.string().min(1),
  isOriginal: z.boolean(),
  ageDays: z.number().int().nonnegative(),
  alive: z.boolean(),
  structure: treeStructureSchema,
  foliage: treeFoliageSchema,
  roots: treeRootsSchema,
  energy: treeEnergySchema,
  water: treeWaterSchema,
  nutrients: nutrientStateSchema,
  // Derived indicator (GDD §5.1). BiologySystem will recompute this in P2.
  health: z.number().min(0).max(1),
  stress: z.number().min(0).max(1),
  damage: z.array(treeDamageStateSchema),
});
export type TreeState = z.infer<typeof treeStateSchema>;
