import { z } from 'zod';
import { currencyIssuanceRequestSchema } from './harvest.js';

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
 * - `pendingIssuances` (P1) holds CurrencyIssuanceRequests queued by
 *   `harvest-leaves` action handlers, awaiting fulfilment by P3's
 *   EconomySystem. The EconomySystem drains this array each tick.
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
  /**
   * Accumulated fractional leaf-growth progress in [0, 1).
   *
   * P1: per-step `leafGrowth` energy from `allocateEnergy` is often too small
   * to grow even one whole leaf at `species.leafEnergyCost` (a sapling allocates
   * ~0.001 eu/step to leaf growth, but a leaf costs 2 eu). Without accumulation
   * the tree would never regrow leaves after winter senescence. The
   * BiologySystem adds `alloc.leafGrowth / leafEnergyCost` to this field each
   * step; when it crosses 1.0, a new leaf is grown and the remainder carries
   * over. This keeps `currentLeaves` an integer (TDD §18.4 invariant) without
   * wasting the per-step surplus.
   *
   * Default 0 (backfilled by v2 → v3 migration for older saves).
   */
  leafGrowthProgress: z.number().min(0).max(1).default(0),
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
  // Age in simulated days. Relaxed from `.int()` to allow fractional day
  // precision (the engine runs at 1-min resolution; `ageDays += stepDays`
  // produces fractional values that the schema must accept). Conceptually
  // "time since planting", not "whole days survived". Rounding for display is
  // the renderer's job (P4).
  ageDays: z.number().nonnegative(),
  alive: z.boolean(),
  structure: treeStructureSchema,
  foliage: treeFoliageSchema,
  roots: treeRootsSchema,
  energy: treeEnergySchema,
  water: treeWaterSchema,
  nutrients: nutrientStateSchema,
  // Derived indicator (GDD §5.1). BiologySystem recomputes this each tick.
  health: z.number().min(0).max(1),
  stress: z.number().min(0).max(1),
  damage: z.array(treeDamageStateSchema),
  // P1: pending currency issuance requests queued by `harvest-leaves`.
  // Drained by P3's EconomySystem during `advance`. Empty by default.
  pendingIssuances: z.array(currencyIssuanceRequestSchema).default([]),
});
export type TreeState = z.infer<typeof treeStateSchema>;
