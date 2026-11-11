/**
 * Stub systems for P0/P1/P2/P3a. Each returns its input state unchanged and emits no
 * events. Later phases replace these with real implementations.
 *
 * P1 has REPLACED the BiologySystem (see `biology-system.ts`) and
 * HarvestSystem (see `harvest-system.ts`) stubs with real implementations.
 * P2 has REPLACED the WeatherSystem (see `weather-system.ts`) and
 * ResourceSystem (see `resource-system.ts`) stubs with real implementations.
 * P3a has REPLACED the EconomySystem (see `economy.ts`) stub with a real
 * implementation that drains `originalTree.pendingIssuances` and records
 * currency-issuance transactions.
 *
 * These are no longer exported from this file — `systems/index.ts` imports
 * them from their dedicated modules.
 *
 * The remaining stubs (personal, business, automation, environment,
 * progression, event) are no-ops until their phases:
 *
 *   - PersonalSystem    — P3c (expenses/well-being)
 *   - BusinessSystem    — P7
 *   - AutomationSystem  — P5
 *   - EnvironmentSystem — P6
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

export const personalSystem: System = noopSystem('PersonalSystem');
export const businessSystem: System = noopSystem('BusinessSystem');
export const automationSystem: System = noopSystem('AutomationSystem');
export const environmentSystem: System = noopSystem('EnvironmentSystem');
export const progressionSystem: System = noopSystem('ProgressionSystem');
export const eventSystem: System = noopSystem('EventSystem');
