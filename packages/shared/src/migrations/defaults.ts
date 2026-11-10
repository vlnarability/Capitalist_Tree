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
 * Future agents: when you change GameState's shape, bump CURRENT_SCHEMA_VERSION
 * in constants/provisional.ts and add a real migration here. Migrations MUST
 * be pure and MUST NOT touch `originalTree.id` or `originalTree.isOriginal`.
 */
import type { GameState } from '../schemas/game-state.js';
import { type Migration, migrations } from './registry.js';

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

migrations.register(0, v0ToV1);
migrations.register(1, v1ToV2);
migrations.register(2, v2ToV3);
