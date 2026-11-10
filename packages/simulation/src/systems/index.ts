/**
 * Default system registry.
 *
 * The order here is the canonical execution order (see registry.ts).
 * Downstream agents MUST NOT reorder existing entries — append only.
 */
import { SystemRegistry } from './registry.js';
import { timeSystem } from './time-system.js';
import {
  weatherSystem,
  biologySystem,
  resourceSystem,
  harvestSystem,
  economySystem,
  personalSystem,
  businessSystem,
  automationSystem,
  environmentSystem,
  progressionSystem,
  eventSystem,
} from './stubs.js';

export const defaultSystems = [
  timeSystem,
  weatherSystem,
  biologySystem,
  resourceSystem,
  harvestSystem,
  economySystem,
  personalSystem,
  businessSystem,
  automationSystem,
  environmentSystem,
  progressionSystem,
  eventSystem,
] as const;

export const defaultRegistry = new SystemRegistry(defaultSystems);

export * from './system.js';
export * from './registry.js';
export * from './time-system.js';
export * from './stubs.js';
