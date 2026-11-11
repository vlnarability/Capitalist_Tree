/**
 * Default system registry.
 *
 * The order here is the canonical execution order (see registry.ts).
 * Downstream agents MUST NOT reorder existing entries — append only.
 *
 * P1 replaces the BiologySystem and HarvestSystem stubs with real
 * implementations. P2 replaces the WeatherSystem and ResourceSystem stubs.
 * P3a replaces the EconomySystem stub with a real implementation that drains
 * `originalTree.pendingIssuances` and records currency-issuance transactions.
 * The other systems remain stubs until their phases.
 */
import { SystemRegistry } from './registry.js';
import { timeSystem } from './time-system.js';
import { weatherSystem } from './weather-system.js';
import { biologySystem } from './biology-system.js';
import { resourceSystem } from './resource-system.js';
import { harvestSystem } from './harvest-system.js';
import { economySystem } from './economy.js';
import {
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
export * from './weather-system.js';
export * from './biology-system.js';
export * from './resource-system.js';
export * from './harvest-system.js';
export * from './economy.js';
export * from './stubs.js';
