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
 * P3c replaces the PersonalSystem stub with a real implementation that
 * schedules recurring living-expense bills, derives well-being indicators,
 * and emits financial-event notifications. P6b2 replaces the AutomationSystem
 * stub with a real implementation that evaluates each automation's policy
 * each tick and executes its action via the normal action dispatch pipeline.
 * P7b replaces the EnvironmentSystem stub with a real implementation that
 * advances the atmosphere / climate / freshwater / soil / biodiversity
 * subsystems each tick and derives forestCoverage + ecosystemResilience.
 * P8b replaces the BusinessSystem stub with a real implementation that runs
 * production / supply-chain resolution / accounting / valuation / interest
 * accrual each tick and emits business-operated / business-bankrupt events.
 */
import { SystemRegistry } from './registry.js';
import { timeSystem } from './time-system.js';
import { weatherSystem } from './weather-system.js';
import { biologySystem } from './biology-system.js';
import { resourceSystem } from './resource-system.js';
import { harvestSystem } from './harvest-system.js';
import { economySystem } from './economy.js';
import { personalSystem } from './personal.js';
import { businessSystem } from './business.js';
import { automationSystem } from './automation.js';
import { environmentSystem } from './environment.js';
import {
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
export * from './personal.js';
export * from './business.js';
export * from './automation.js';
export * from './environment.js';
export * from './stubs.js';
