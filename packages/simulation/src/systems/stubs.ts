/**
 * Stub systems for P0. Each returns its input state unchanged and emits no
 * events. Later phases replace these with real implementations.
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
export const biologySystem: System = noopSystem('BiologySystem');
export const resourceSystem: System = noopSystem('ResourceSystem');
export const harvestSystem: System = noopSystem('HarvestSystem');
export const economySystem: System = noopSystem('EconomySystem');
export const personalSystem: System = noopSystem('PersonalSystem');
export const businessSystem: System = noopSystem('BusinessSystem');
export const automationSystem: System = noopSystem('AutomationSystem');
export const environmentSystem: System = noopSystem('EnvironmentSystem');
export const progressionSystem: System = noopSystem('ProgressionSystem');
export const eventSystem: System = noopSystem('EventSystem');
