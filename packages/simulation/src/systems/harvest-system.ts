/**
 * HarvestSystem (TDD §4.2, §7.5; GDD §5.4).
 *
 * Per-tick responsibility: NONE. Harvesting is action-driven (the
 * `harvest-leaves` GameAction calls the pure `harvestLeaves` biology function
 * via the action handler in `actions/handlers.ts`).
 *
 * This system exists in the registry (slot 5) for two reasons:
 *   1. Ordering — TDD §4.2 fixes the slot for `HarvestSystem` between
 *      BiologySystem and EconomySystem. Later phases (P3 EconomySystem) may
 *      read harvest outputs produced this tick.
 *   2. Future scheduled-harvest logic — automated harvesting equipment (P5)
 *      will produce scheduled harvest events that this system processes here.
 *
 * The system is a no-op for P1: it returns its input unchanged and emits no
 * events. This keeps the registry order stable without coupling P1 to future
 * automation.
 *
 * P3's EconomySystem drains `tree.pendingIssuances` (queued by the
 * `harvest-leaves` action handler) — this system does NOT touch that queue.
 */
import type { System, SystemResult } from './system.js';

export const harvestSystem: System = {
  id: 'HarvestSystem',
  execute(state): SystemResult {
    // No-op: harvesting is driven by the `harvest-leaves` GameAction handler.
    // Future: process scheduled-harvest events from automation (P5).
    return { state, events: [] };
  },
};
