/**
 * Water balance (TDD §8.1, GDD §10.1).
 *
 * The water model has inputs (rainfall, irrigation) and outputs (evaporation,
 * drainage, tree uptake, runoff). Per-tree uptake is limited by root capacity
 * AND soil water (Liebig-style: the scarcest resource limits growth).
 *
 * Per-step water balance across two coupled pools:
 *
 *   SOIL WATER POOL (env.soil.soilWater):
 *     soilWater' = max(0, soilWater + rainfall + irrigation
 *                          - evaporation - drainage - treeUptake - runoff)
 *
 *   TREE WATER BUFFER (originalTree.water.stored):
 *     treeWater' = clamp(treeWater - transpiration + treeUptake, 0, capacity)
 *
 * Where:
 *   - rainfall comes from the WeatherSystem (per-condition rate × intensity × stepDays).
 *   - irrigation comes from the `apply-water` action handler (already added to
 *     `soilWater` before this function runs; the function just sees the
 *     post-irrigation `soilWater` value).
 *   - evaporation scales with temperature + per-condition multiplier.
 *   - drainage is a fraction of soilWater per day (recharges groundwater).
 *   - transpiration = dailyWaterNeed × stepDays (water the tree consumes).
 *   - treeUptake = min(rootCap × stepDays, availableForUptake, bufferRoom)
 *     where availableForUptake = soilWater + rainfall + irrigation
 *                                  - evaporation - drainage
 *     and bufferRoom = treeWaterCapacity - max(0, treeWater - transpiration)
 *     (the tree can't absorb more than its buffer can hold after transpiration).
 *   - runoff = max(0, postUptakeSoil - SOIL_WATER_CAPACITY) (excess leaves the
 *     plot — not tracked as a separate state field in P2).
 *
 * Conservation (TDD §18.4 invariant):
 *   soilWater_after + treeWater_after + evaporation + drainage + runoff + transpiration
 *     = soilWater_before + treeWater_before + rainfall + irrigation
 *
 * The `treeUptake` term cancels — it moves water from the soil pool to the
 * tree buffer (a transfer, not a loss). This is the GDD §10.1 contract that
 * "water flows through the system".
 *
 * `env.freshwater.availability` is kept in sync with the soil water + groundwater
 * via `computeFreshwaterAvailability` so older downstream consumers that read
 * it directly (none in P2, but the field is part of the schema) see a value
 * consistent with the actual balance.
 *
 * Pure functions: callers apply the deltas to the state.
 */
import type { EnvironmentState, TreeState, WeatherState } from '@capitalist-tree/shared';
import {
  PROVISIONAL_RESOURCE_DRAINAGE_RATE_PER_DAY,
  PROVISIONAL_RESOURCE_EVAPORATION_BASE_TEMP_C,
  PROVISIONAL_RESOURCE_EVAPORATION_RATE_PER_DAY,
  PROVISIONAL_RESOURCE_MAX_UPTAKE_FRACTION,
  PROVISIONAL_RESOURCE_SOIL_WATER_CAPACITY,
} from '@capitalist-tree/shared';
import type { WeatherEventDefinition } from '@capitalist-tree/shared';
import { computeEvaporationRate } from '../weather/effects.js';

/** Water balance result — applied to env.soil.soilWater + tree.water.stored. */
export interface WaterBalance {
  /** Rainfall added (L). */
  rainfall: number;
  /** Evaporation removed (L). */
  evaporation: number;
  /** Drainage to groundwater (L). */
  drainage: number;
  /** Tree uptake (L) — transferred from soil pool to tree buffer. */
  treeUptake: number;
  /** Transpiration (L) — consumed by the tree (lost to atmosphere). */
  transpiration: number;
  /** Runoff — couldn't fit in soil (L). */
  runoff: number;
  /** Soil water BEFORE balance. */
  soilWaterBefore: number;
  /** Soil water AFTER balance (clamped at >= 0). */
  soilWaterAfter: number;
  /** Tree water BEFORE balance. */
  treeWaterBefore: number;
  /** Tree water AFTER balance (clamped at [0, capacity]). */
  treeWaterAfter: number;
}

/**
 * Compute the per-step water balance for the coupled soil + tree water pools.
 *
 * Inputs (all in L unless noted):
 *   - soilWater: current soil water content.
 *   - treeWater: current tree internal water buffer.
 *   - treeWaterCapacity: max the tree's internal buffer can hold.
 *   - dailyWaterNeedL: L/day the tree transpires at current foliage.
 *   - rainfall: L added this step from WeatherSystem.
 *   - evaporationRatePerDay: L/day, per-condition + temperature-modulated.
 *   - rootAbsorptionCapacity: tree's root absorption capacity in [0, 1].
 *   - stepDays: length of this step in sim days.
 *
 * Pure: takes inputs, returns the balance. Caller applies the deltas to both
 * `env.soil.soilWater` and `originalTree.water.stored`.
 */
export function computeWaterBalance(params: {
  soilWater: number;
  treeWater: number;
  treeWaterCapacity: number;
  dailyWaterNeedL: number;
  rainfall: number;
  evaporationRatePerDay: number;
  rootAbsorptionCapacity: number;
  stepDays: number;
}): WaterBalance {
  const {
    soilWater,
    treeWater,
    treeWaterCapacity,
    dailyWaterNeedL,
    rainfall,
    rootAbsorptionCapacity,
    stepDays,
  } = params;

  const evaporation = params.evaporationRatePerDay * stepDays;
  const drainage = soilWater * PROVISIONAL_RESOURCE_DRAINAGE_RATE_PER_DAY * stepDays;
  const transpiration = dailyWaterNeedL * stepDays;

  // Available for uptake from the soil pool (before the tree touches it):
  //   rainfall is added before uptake (the tree can drink this step's rain).
  //   evaporation + drainage happen first — they reduce what the tree can take.
  // (irrigation is already in soilWater — the action handler updates soilWater
  // directly, so we don't add it again here.)
  const availableForUptake = Math.max(0, soilWater + rainfall - evaporation - drainage);

  // Root absorption capacity (L/day). Decoupled from transpiration:
  //   rootCap = dailyWaterNeedL * MAX_UPTAKE_FRACTION * rootAbsorptionCapacity
  // A mature root (1.0) can take up to MAX_UPTAKE_FRACTION × dailyNeed per day
  // (headroom above transpiration so the buffer can refill). A sapling root
  // (0.3) absorbs proportionally less.
  //
  // dailyWaterNeedL already scales with foliage (see biology/photosynthesis.ts
  // `dailyWaterNeed`), so rootCap scales with foliage too: a sapling with few
  // leaves needs little water and has a small root cap; a mature tree with full
  // canopy needs much more and has a larger cap.
  const rootCapPerDay =
    dailyWaterNeedL * PROVISIONAL_RESOURCE_MAX_UPTAKE_FRACTION * rootAbsorptionCapacity;
  const rootCap = rootCapPerDay * stepDays;

  // Tree uptake is Liebig: min(root cap, available in soil, buffer room).
  // The buffer-room cap prevents overflow when the tree is already full.
  const treeWaterAfterTranspiration = Math.max(0, treeWater - transpiration);
  const bufferRoom = Math.max(0, treeWaterCapacity - treeWaterAfterTranspiration);
  const treeUptake = Math.min(rootCap, availableForUptake, bufferRoom);

  // Soil water after uptake (before runoff):
  const postUptakeSoil = soilWater + rainfall - evaporation - drainage - treeUptake;
  // Runoff is anything above capacity.
  const runoff = Math.max(0, postUptakeSoil - PROVISIONAL_RESOURCE_SOIL_WATER_CAPACITY);
  const soilWaterAfter = Math.max(0, postUptakeSoil - runoff);

  // Tree water after uptake (capped at capacity — bufferRoom already enforces
  // this, but we double-clamp defensively).
  const treeWaterAfter = Math.max(
    0,
    Math.min(treeWaterCapacity, treeWater - transpiration + treeUptake),
  );

  return {
    rainfall,
    evaporation,
    drainage,
    treeUptake,
    transpiration,
    runoff,
    soilWaterBefore: soilWater,
    soilWaterAfter,
    treeWaterBefore: treeWater,
    treeWaterAfter,
  };
}

/**
 * Apply the water balance to an environment state + tree.
 *
 * Mutates `env.soil.soilWater`, `env.freshwater.groundwater` (recharged by
 * drainage), `env.freshwater.availability` (kept in sync with soil water +
 * groundwater), and `tree.water.stored`. The caller is expected to deep-copy
 * the state before calling.
 *
 * Returns the water balance for diagnostics / events (already passed in).
 */
export function applyWaterBalance(
  env: EnvironmentState,
  tree: TreeState,
  balance: WaterBalance,
): void {
  env.soil.soilWater = balance.soilWaterAfter;
  tree.water.stored = balance.treeWaterAfter;
  // Drainage recharges groundwater.
  env.freshwater.groundwater = Math.max(0, env.freshwater.groundwater + balance.drainage);
  // Keep env.freshwater.availability in sync with the actual soil water +
  // groundwater balance. The BiologySystem no longer reads this field (P2
  // removed the placeholder), but the schema field is still here for future
  // consumers and for v3→v4 migrated saves that may carry a stale value.
  env.freshwater.availability = computeFreshwaterAvailability(
    balance.soilWaterAfter,
    env.freshwater.groundwater,
  );
}

/**
 * Map the soil water + groundwater to the env.freshwater.availability field.
 *
 * The 0.1 factor on groundwater reflects that groundwater is less accessible
 * than soil water (deeper, slower to draw down). Pure: takes inputs, returns
 * the new availability.
 */
export function computeFreshwaterAvailability(
  soilWater: number,
  groundwater: number,
): number {
  return Math.max(0, soilWater + groundwater * 0.1);
}

/**
 * Compute the per-step evaporation rate (L/day) given the current weather
 * condition, local temperature, and the soil's baseline evaporation rate.
 *
 * Wraps the weather module's `computeEvaporationRate` with the resource
 * module's base rate constant. Pure: takes inputs, returns the rate.
 */
export function computeSoilEvaporationRate(
  weatherEvent: WeatherEventDefinition,
  localTempC: number,
): number {
  return computeEvaporationRate(
    weatherEvent,
    localTempC,
    PROVISIONAL_RESOURCE_EVAPORATION_RATE_PER_DAY,
    PROVISIONAL_RESOURCE_EVAPORATION_BASE_TEMP_C,
  );
}

/** Re-export the weather event type for callers that need it. */
export type { WeatherEventDefinition, WeatherState, TreeState };
