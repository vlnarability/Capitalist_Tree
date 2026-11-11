import { z } from 'zod';
import { PROVISIONAL_SPEED_MULTIPLIERS } from '../constants/provisional.js';
import { harvestLeavesActionSchema } from './actions-biology.js';
import { applyWaterActionSchema, applyFertilizerActionSchema } from './actions-resources.js';
import { purchaseActionSchema } from './actions-economy.js';

/**
 * GameAction — discriminated union of player actions handled by
 * `SimulationEngine.executeAction` (TDD §4.1).
 *
 * P0 actions:
 *   - `no-op`: testing helper, returns state unchanged.
 *   - `set-speed`: changes `clock.speedMultiplier`. The accumulator in
 *     apps/web reads this on the next frame.
 *
 * HOW TO EXTEND (P1/P3/...): add a new variant with a unique `type` literal.
 * Register a handler in packages/simulation/src/actions/handlers.ts. The
 * handler signature is `(state, action) => { state, events }`. Keep actions
 * pure — never mutate input state. Reject unknown action types with
 * `UnknownActionError` (handled centrally by `executeAction`).
 */
const speedMultiplierSchema = z.number().refine(
  (n) => (PROVISIONAL_SPEED_MULTIPLIERS as readonly number[]).includes(n),
  (n) => ({ message: `Invalid speed multiplier ${n}` }),
);

export const noOpActionSchema = z.object({
  type: z.literal('no-op'),
});

export const setSpeedActionSchema = z.object({
  type: z.literal('set-speed'),
  payload: z.object({
    multiplier: speedMultiplierSchema,
  }),
});

export const gameActionSchema = z.discriminatedUnion('type', [
  noOpActionSchema,
  setSpeedActionSchema,
  harvestLeavesActionSchema,
  applyWaterActionSchema,
  applyFertilizerActionSchema,
  purchaseActionSchema,
]);
export type GameAction = z.infer<typeof gameActionSchema>;
export type NoOpAction = z.infer<typeof noOpActionSchema>;
export type SetSpeedAction = z.infer<typeof setSpeedActionSchema>;
export type HarvestLeavesAction = z.infer<typeof harvestLeavesActionSchema>;

// Re-export biology action variants so consumers can `import { HarvestLeavesAction }`
// from @capitalist-tree/shared without reaching into the biology submodule.
export * from './actions-biology.js';
// Re-export resource action variants so consumers can `import { ApplyWaterAction }`
// etc. from @capitalist-tree/shared without reaching into the resources submodule.
export * from './actions-resources.js';
// Re-export economy action variants so consumers can `import { PurchaseAction }`
// from @capitalist-tree/shared without reaching into the economy submodule.
export * from './actions-economy.js';
