/**
 * Stub systems for P0/P1/P2/P3a/P3b/P3c. Each returns its input state
 * unchanged and emits no events. Later phases replace these with real
 * implementations.
 *
 * P1 has REPLACED the BiologySystem (see `biology-system.ts`) and
 * HarvestSystem (see `harvest-system.ts`) stubs with real implementations.
 * P2 has REPLACED the WeatherSystem (see `weather-system.ts`) and
 * ResourceSystem (see `resource-system.ts`) stubs with real implementations.
 * P3a has REPLACED the EconomySystem (see `economy.ts`) stub with a real
 * implementation that drains `originalTree.pendingIssuances` and records
 * currency-issuance transactions.
 * P3c has REPLACED the PersonalSystem (see `personal.ts`) stub with a real
 * implementation that schedules recurring living-expense bills, derives
 * well-being indicators with diminishing returns on wealth, and emits
 * financial-event notifications.
 * P6b2 has REPLACED the AutomationSystem (see `automation.ts`) stub with a
 * real implementation that evaluates each automation's policy each tick and
 * executes its action via the normal action dispatch pipeline.
 * P7b has REPLACED the EnvironmentSystem (see `environment.ts`) stub with a
 * real implementation that advances the atmosphere / climate / freshwater /
 * soil / biodiversity subsystems each tick and derives forestCoverage +
 * ecosystemResilience.
 * P8b has REPLACED the BusinessSystem (see `business.ts`) stub with a real
 * implementation that runs production / supply-chain resolution / accounting
 * / valuation / interest accrual each tick and emits business-operated /
 * business-bankrupt events.
 *
 * These are no longer exported from this file — `systems/index.ts` imports
 * them from their dedicated modules.
 *
 * The remaining stubs (progression, event) are no-ops until their phases:
 *
 *   - ProgressionSystem — P6+/P8
 *   - EventSystem       — P3+
 *
 * The `id` strings are part of the public interface — downstream agents
 * reference them in tests and event logs. Do NOT rename.
 *
 * Order of registration in `packages/simulation/src/systems/index.ts` is the
 * stable system execution order. Do not reorder existing entries.
 */
import type { System } from './system.js';
import { noopSystem } from './system.js';

export const progressionSystem: System = noopSystem('ProgressionSystem');
export const eventSystem: System = noopSystem('EventSystem');
