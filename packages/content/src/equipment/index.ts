/**
 * Equipment content registry (P6b1 — TDD §12, GDD §9 "Automation and Technology").
 *
 * Each piece of equipment is a pure data object — the simulation engine reads
 * it via `getEquipmentById` and the `purchase-equipment` action handler (P6b2)
 * looks up a definition to instantiate an `AutomationState`. Content authors
 * add new equipment by appending to the per-category arrays and to `EQUIPMENT`.
 *
 * Files are split per category (GDD §9): irrigation, fertilization,
 * harvesting, monitoring, energy. The flat `EQUIPMENT` array is the union of
 * all categories; `getEquipmentById` is the canonical lookup.
 *
 * Follows the same pattern as `packages/content/src/fertilizers/` and
 * `packages/content/src/markets/`.
 *
 * PROVISIONAL per GDD §17 ("automation cost/effectiveness balance" +
 * "detailed resource simulation equations"). All costs are bigint minor
 * currency units serialized as string (TDD §10.1).
 */
import type { EquipmentDefinition } from '@capitalist-tree/shared';
import { IRRIGATION_EQUIPMENT } from './irrigation.js';
import { FERTILIZATION_EQUIPMENT } from './fertilization.js';
import { HARVESTING_EQUIPMENT } from './harvesting.js';
import { MONITORING_EQUIPMENT } from './monitoring.js';
import { ENERGY_EQUIPMENT } from './energy.js';

export { SPRINKLER_T1, SPRINKLER_T2, SPRINKLER_T3 } from './irrigation.js';
export { SPREADER_T1, SPREADER_T2, SPREADER_T3 } from './fertilization.js';
export { HARVESTER_T1, HARVESTER_T2, HARVESTER_T3 } from './harvesting.js';
export { SOIL_SENSOR, WEATHER_STATION } from './monitoring.js';
export { SOLAR_PANEL, BATTERY } from './energy.js';

export { IRRIGATION_EQUIPMENT } from './irrigation.js';
export { FERTILIZATION_EQUIPMENT } from './fertilization.js';
export { HARVESTING_EQUIPMENT } from './harvesting.js';
export { MONITORING_EQUIPMENT } from './monitoring.js';
export { ENERGY_EQUIPMENT } from './energy.js';

/**
 * All known equipment, flat across categories. Add new equipment to its
 * category file and the corresponding per-category array — this list is the
 * union of those arrays and stays in sync with them.
 */
export const EQUIPMENT: readonly EquipmentDefinition[] = [
  ...IRRIGATION_EQUIPMENT,
  ...FERTILIZATION_EQUIPMENT,
  ...HARVESTING_EQUIPMENT,
  ...MONITORING_EQUIPMENT,
  ...ENERGY_EQUIPMENT,
];

/**
 * Look up an equipment definition by id. Returns the definition or
 * `undefined` if unknown. The `purchase-equipment` action handler (P6b2) uses
 * this to resolve `equipmentId`; an unknown id raises `UnknownEquipmentError`.
 */
export function getEquipmentById(equipmentId: string): EquipmentDefinition | undefined {
  return EQUIPMENT.find((e) => e.id === equipmentId);
}
