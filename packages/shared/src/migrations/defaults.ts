/**
 * Default migrations for the current P0 schema.
 *
 * v0 -> v1: a sample migration that the test suite exercises. v0 saves are
 * hypothetical (we never wrote one in production); the migration exists to
 * prove the framework works end-to-end.
 *
 * Future agents: when you change GameState's shape, bump CURRENT_SCHEMA_VERSION
 * in constants/provisional.ts and add a real migration here. Migrations MUST
 * be pure and MUST NOT touch `originalTree.id` or `originalTree.isOriginal`.
 */
import type { GameState } from '../schemas/game-state.js';
import { migrations } from './registry.js';

// Sample v0 -> v1 migration. v0 saves had no `scheduler` field; v1 adds it.
// (In reality, no v0 saves exist — this is here to demonstrate the framework.)
migrations.register(0, (state) => {
  // We can't actually reconstruct the missing field with full fidelity from
  // a v0 save in the general case. For the sample migration we add an empty
  // scheduler if it's missing, and otherwise return the state unchanged.
  // `state` is typed as GameState (the v1 type) here for simplicity — a real
  // migration would have a separate v0 input type.
  return {
    ...state,
    scheduler: state.scheduler ?? { events: [] },
  };
});
