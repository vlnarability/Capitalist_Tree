/**
 * Stub systems for P0/P1. Each returns its input state unchanged and emits no
 * events. Later phases replace these with real implementations.
 *
 * P1 has REPLACED the BiologySystem (see `biology-system.ts`) and
 * HarvestSystem (see `harvest-system.ts`) stubs with real implementations.
 * They are no longer exported from this file — `systems/index.ts` imports
 * them from their dedicated modules.
 *
 * The remaining stubs (weather, resources, economy, personal, business,
 * automation, environment, progression, event) are no-ops until their phases:
 *
 *   - WeatherSystem     — P2
 *   - ResourceSystem    — P2 (water/nutrients/soil — P1 has a placeholder in BiologySystem)
 *   - EconomySystem     — P3 (drains `tree.pendingIssuances`)
 *   - PersonalSystem    — P3 (expenses/well-being)
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

export const weatherSystem: System = noopSystem('WeatherSystem');
export const resourceSystem: System = noopSystem('ResourceSystem');
export const economySystem: System = noopSystem('EconomySystem');
export const personalSystem: System = noopSystem('PersonalSystem');
export const businessSystem: System = noopSystem('BusinessSystem');
export const automationSystem: System = noopSystem('AutomationSystem');
export const environmentSystem: System = noopSystem('EnvironmentSystem');
export const progressionSystem: System = noopSystem('ProgressionSystem');
export const eventSystem: System = noopSystem('EventSystem');
