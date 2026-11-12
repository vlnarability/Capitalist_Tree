/**
 * Business content registry (P8a — TDD §5.7 / §11, GDD §8 Business and
 * Economic Simulation).
 *
 * Each business type is a pure data object — the simulation engine reads it
 * via `getBusinessTypeById` and the `purchase-business` action handler (P8b)
 * looks up a definition to instantiate a `BusinessState`. Content authors add
 * new business types by appending to the per-supply-chain-level arrays and to
 * `BUSINESS_TYPES`.
 *
 * Files are split per supply chain level (GDD §8.2): extraction, processing,
 * manufacturing, distribution, retail, application. The flat `BUSINESS_TYPES`
 * array is the union of all levels; `getBusinessTypeById` is the canonical
 * lookup.
 *
 * Follows the same pattern as `packages/content/src/equipment/` and
 * `packages/content/src/markets/` (rule 5: content is data, never hardcoded
 * in engine logic).
 *
 * PROVISIONAL per GDD §17 ("detailed resource simulation equations" +
 * business balance). All costs are bigint minor currency units serialized as
 * string (TDD §10.1).
 */
import type { BusinessTypeDefinition } from '@capitalist-tree/shared';
import { EXTRACTION_BUSINESSES } from './extraction.js';
import { PROCESSING_BUSINESSES } from './processing.js';
import { MANUFACTURING_BUSINESSES } from './manufacturing.js';
import { DISTRIBUTION_BUSINESSES } from './distribution.js';
import { RETAIL_BUSINESSES } from './retail.js';
import { APPLICATION_BUSINESSES } from './application.js';

export {
  WATER_EXTRACTION_PLANT,
  MINERAL_MINE,
} from './extraction.js';
export { CHEMICAL_PLANT, SAWMILL } from './processing.js';
export { FERTILIZER_FACTORY, EQUIPMENT_FACTORY } from './manufacturing.js';
export { DISTRIBUTION_COMPANY } from './distribution.js';
export { GENERAL_STORE } from './retail.js';
export { FARM } from './application.js';

export { EXTRACTION_BUSINESSES } from './extraction.js';
export { PROCESSING_BUSINESSES } from './processing.js';
export { MANUFACTURING_BUSINESSES } from './manufacturing.js';
export { DISTRIBUTION_BUSINESSES } from './distribution.js';
export { RETAIL_BUSINESSES } from './retail.js';
export { APPLICATION_BUSINESSES } from './application.js';

/**
 * All known business types, flat across supply chain levels. Add new business
 * types to their level file and the corresponding per-level array — this list
 * is the union of those arrays and stays in sync with them.
 */
export const BUSINESS_TYPES: readonly BusinessTypeDefinition[] = [
  ...EXTRACTION_BUSINESSES,
  ...PROCESSING_BUSINESSES,
  ...MANUFACTURING_BUSINESSES,
  ...DISTRIBUTION_BUSINESSES,
  ...RETAIL_BUSINESSES,
  ...APPLICATION_BUSINESSES,
];

/**
 * Look up a business type definition by id. Returns the definition or
 * `undefined` if unknown. The `purchase-business` action handler (P8b) uses
 * this to resolve `businessTypeId`; an unknown id raises
 * `UnknownBusinessTypeError`.
 */
export function getBusinessTypeById(
  businessTypeId: string,
): BusinessTypeDefinition | undefined {
  return BUSINESS_TYPES.find((b) => b.id === businessTypeId);
}
