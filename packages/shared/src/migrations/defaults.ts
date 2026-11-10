/**
 * Default migrations for the current schema.
 *
 * v0 -> v1: a sample migration that the test suite exercises. v0 saves are
 * hypothetical (we never wrote one in production); the migration exists to
 * prove the framework works end-to-end.
 *
 * v1 -> v2 (P1): backfills `originalTree.pendingIssuances` with an empty
 * array if missing. P1 added this field to queue currency-issuance requests
 * produced by the `harvest-leaves` action handler. P3's EconomySystem
 * drains the queue each tick.
 *
 * v2 -> v3 (P1): backfills `originalTree.foliage.leafGrowthProgress` with
 * 0 if missing. P1 added this accumulator so per-step leaf-growth energy
 * isn't wasted when it's too small to grow a whole leaf.
 *
 * v3 -> v4 (P2): backfills four new GameState shapes for P2 (Resources +
 * Weather):
 *   - `world.weather: WeatherState` — current condition, temperature,
 *     intensity, prev condition, days-in-condition. Defaults to a sunny
 *     spring day at 18 °C.
 *   - `rngStreams.weather: RngState` — persisted RNG sub-stream for the
 *     WeatherSystem so the Markov sequence survives save/load. Defaults
 *     to a zero state (WeatherSystem initializes it on first tick if zero).
 *   - `world.environment.soil.soilWater: number` — soil water content (L).
 *     Defaults to PROVISIONAL_RESOURCE_INITIAL_SOIL_WATER.
 *   - `world.environment.soil.{ph, compaction, microbialActivity}: number`
 *     — extension-point stubs for the soil health derivation. Defaults to
 *     6.5 / 0 / 1.0 respectively.
 *
 * The migration is pure and does NOT touch `originalTree.id` or
 * `originalTree.isOriginal` (GDD §16.1/16.2).
 *
 * Future agents: when you change GameState's shape, bump CURRENT_SCHEMA_VERSION
 * in constants/provisional.ts and add a real migration here. Migrations MUST
 * be pure and MUST NOT touch `originalTree.id` or `originalTree.isOriginal`.
 */
import type { GameState } from '../schemas/game-state.js';
import { type Migration, migrations } from './registry.js';
import { PROVISIONAL_RESOURCE_INITIAL_SOIL_WATER } from '../constants/resources.js';

// Sample v0 -> v1 migration. v0 saves had no `scheduler` field; v1 adds it.
// (In reality, no v0 saves exist — this is here to demonstrate the framework.)
const v0ToV1: Migration = (state: GameState): GameState => {
  // We can't actually reconstruct the missing field with full fidelity from
  // a v0 save in the general case. For the sample migration we add an empty
  // scheduler if it's missing, and otherwise return the state unchanged.
  // `state` is typed as GameState (the v1 type) here for simplicity — a real
  // migration would have a separate v0 input type.
  return {
    ...state,
    scheduler: state.scheduler ?? { events: [] },
  };
};

// P1: v1 -> v2 migration. Backfills `originalTree.pendingIssuances` if a
// v1 save lacks it. The field is always present on v2+ saves.
const v1ToV2: Migration = (state: GameState): GameState => {
  const originalTree = state.originalTree as typeof state.originalTree & {
    pendingIssuances?: unknown;
  };
  if (Array.isArray(originalTree.pendingIssuances)) {
    return state;
  }
  return {
    ...state,
    originalTree: {
      ...state.originalTree,
      pendingIssuances: [],
    },
  };
};

// P1: v2 -> v3 migration. Backfills `originalTree.foliage.leafGrowthProgress`
// with 0 if a v2 save lacks it. The field is always present on v3+ saves.
const v2ToV3: Migration = (state: GameState): GameState => {
  const foliage = state.originalTree.foliage as typeof state.originalTree.foliage & {
    leafGrowthProgress?: unknown;
  };
  if (typeof foliage.leafGrowthProgress === 'number') {
    return state;
  }
  return {
    ...state,
    originalTree: {
      ...state.originalTree,
      foliage: {
        ...state.originalTree.foliage,
        leafGrowthProgress: 0,
      },
    },
  };
};

// P2: v3 -> v4 migration. Backfills P2's new GameState shapes:
//   - world.weather
//   - rngStreams.weather
//   - world.environment.soil.soilWater
//   - world.environment.soil.{ph, compaction, microbialActivity}
//
// Each field is backfilled only if missing — fields added by other migrations
// (or by a v3+ save that already includes them) are left untouched. This
// makes the migration idempotent under repeated application (defensive — the
// migration framework doesn't re-run migrations, but tests do).
const v3ToV4: Migration = (state: GameState): GameState => {
  const out: GameState = { ...state };

  // 1. rngStreams.weather (top-level addition).
  const rngStreams = out.rngStreams as { weather?: unknown } | undefined;
  const isRngState =
    Array.isArray(rngStreams?.weather) && (rngStreams!.weather as unknown[]).length === 4;
  if (!isRngState) {
    out.rngStreams = { weather: [0, 0, 0, 0] };
  }

  // 2. world.weather — backfill the entire WeatherState if missing.
  const world = out.world as typeof out.world & {
    weather?: unknown;
  };
  if (
    typeof world.weather !== 'object' ||
    world.weather === null ||
    Array.isArray(world.weather)
  ) {
    out.world = {
      ...out.world,
      weather: {
        condition: 'sunny',
        temperature: 18,
        intensity: 0.5,
        prevCondition: null,
        daysInCondition: 0,
      },
    };
  }

  // 3. world.environment.soil.{soilWater, ph, compaction, microbialActivity}.
  const soil = out.world.environment.soil as typeof out.world.environment.soil & {
    soilWater?: unknown;
    ph?: unknown;
    compaction?: unknown;
    microbialActivity?: unknown;
  };
  const soilPatch: Record<string, unknown> = {};
  if (typeof soil.soilWater !== 'number') {
    soilPatch.soilWater = PROVISIONAL_RESOURCE_INITIAL_SOIL_WATER;
  }
  if (typeof soil.ph !== 'number') {
    soilPatch.ph = 6.5;
  }
  if (typeof soil.compaction !== 'number') {
    soilPatch.compaction = 0;
  }
  if (typeof soil.microbialActivity !== 'number') {
    soilPatch.microbialActivity = 1.0;
  }
  if (Object.keys(soilPatch).length > 0) {
    out.world = {
      ...out.world,
      environment: {
        ...out.world.environment,
        soil: {
          ...out.world.environment.soil,
          ...soilPatch,
        },
      },
    };
  }

  return out;
};

migrations.register(0, v0ToV1);
migrations.register(1, v1ToV2);
migrations.register(2, v2ToV3);
migrations.register(3, v3ToV4);
