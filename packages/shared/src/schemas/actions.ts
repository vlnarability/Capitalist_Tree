import { z } from 'zod';
import { PROVISIONAL_SPEED_MULTIPLIERS } from '../constants/provisional.js';
import { harvestLeavesActionSchema } from './actions-biology.js';
import { applyWaterActionSchema, applyFertilizerActionSchema } from './actions-resources.js';
import {
  purchaseActionSchema,
  payExpenseActionSchema,
  transferActionSchema,
  sellTreeActionSchema,
} from './actions-economy.js';
import {
  setAutomationPolicyActionSchema,
  enableAutomationActionSchema,
  disableAutomationActionSchema,
  purchaseEquipmentActionSchema,
} from './actions-automation.js';
import {
  purchaseBusinessActionSchema,
  operateBusinessActionSchema,
  sellBusinessActionSchema,
  takeLoanActionSchema,
  repayLoanActionSchema,
  hireEmployeesActionSchema,
  layOffEmployeesActionSchema,
  setBusinessStatusActionSchema,
} from './actions-business.js';
import {
  unlockResearchActionSchema,
  activateTraitActionSchema,
  deactivateTraitActionSchema,
  prestigeResetActionSchema,
  recordHistoricalEventActionSchema,
} from './actions-progression.js';
import {
  scheduleEventActionSchema,
  cancelEventActionSchema,
  triggerEventActionSchema,
  resolveEventActionSchema,
  setGovernmentPolicyActionSchema,
  setMonetaryPolicyActionSchema,
} from './actions-events.js';

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
  payExpenseActionSchema,
  transferActionSchema,
  sellTreeActionSchema,
  setAutomationPolicyActionSchema,
  enableAutomationActionSchema,
  disableAutomationActionSchema,
  purchaseEquipmentActionSchema,
  // P8a: business actions (schema-only — handlers + BusinessSystem land in P8b).
  purchaseBusinessActionSchema,
  operateBusinessActionSchema,
  sellBusinessActionSchema,
  takeLoanActionSchema,
  repayLoanActionSchema,
  hireEmployeesActionSchema,
  layOffEmployeesActionSchema,
  setBusinessStatusActionSchema,
  // P9a: progression actions (schema-only — handlers + ProgressionSystem land in P9b).
  unlockResearchActionSchema,
  activateTraitActionSchema,
  deactivateTraitActionSchema,
  prestigeResetActionSchema,
  recordHistoricalEventActionSchema,
  // P10a: EventSystem actions (schema-only — handlers + EventSystem land in P10b).
  scheduleEventActionSchema,
  cancelEventActionSchema,
  triggerEventActionSchema,
  resolveEventActionSchema,
  setGovernmentPolicyActionSchema,
  setMonetaryPolicyActionSchema,
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
// etc. from @capitalist-tree/shared without reaching into the economy submodule.
export * from './actions-economy.js';
// P6b1: re-export automation action variants so consumers can import
// `SetAutomationPolicyAction` etc. from @capitalist-tree/shared without
// reaching into the automation submodule.
export * from './actions-automation.js';
// P8a: re-export business action variants so consumers can import
// `PurchaseBusinessAction` etc. from @capitalist-tree/shared without
// reaching into the business submodule.
export * from './actions-business.js';
// P9a: re-export progression action variants so consumers can import
// `UnlockResearchAction` etc. from @capitalist-tree/shared without
// reaching into the progression submodule.
export * from './actions-progression.js';
// P10a: re-export EventSystem action variants so consumers can import
// `ScheduleEventAction` etc. from @capitalist-tree/shared without
// reaching into the events submodule.
export * from './actions-events.js';
