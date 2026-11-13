/**
 * Research content registry (P9a — TDD §5.7 / §11, GDD §11.2 genetic legacy
 * unlocks research).
 *
 * Each research node is a pure-data `ResearchNodeDefinition` (rule 5). The
 * ProgressionSystem (P9b) reads a definition via `getResearchNodeById` to
 * validate an `unlock-research` action (prerequisites met + genetic-legacy
 * cost available). Content authors add new nodes by appending to the
 * per-category arrays in `nodes.ts` and to `RESEARCH_NODES`.
 *
 * Follows the same pattern as `packages/content/src/businesses/index.ts` and
 * `packages/content/src/equipment/index.ts` (rule 5: content is data).
 */
import type { ResearchNodeDefinition } from '@capitalist-tree/shared';
import { RESEARCH_NODES } from './nodes.js';

export {
  IMPROVED_PHOTOSYNTHESIS,
  DROUGHT_RESISTANCE_BREEDING,
  PEST_RESISTANCE_BREEDING,
  ADVANCED_IRRIGATION,
  PRECISION_FERTILIZATION,
  AUTONOMOUS_HARVESTING,
  SUPPLY_CHAIN_OPTIMIZATION,
  MARKET_ANALYSIS,
  CORPORATE_STRUCTURE,
  CARBON_CAPTURE,
  SOIL_RESTORATION,
  BIODIVERSITY_ENHANCEMENT,
  SOLAR_EFFICIENCY,
  BATTERY_TECHNOLOGY,
} from './nodes.js';

export {
  BIOLOGY_RESEARCH,
  AUTOMATION_RESEARCH,
  BUSINESS_RESEARCH,
  ENVIRONMENT_RESEARCH,
  ENERGY_RESEARCH,
  RESEARCH_NODES,
} from './nodes.js';

/**
 * Look up a research node definition by id. Returns the definition or
 * `undefined` if unknown. The `unlock-research` action handler (P9b) uses this
 * to resolve `researchNodeId`; an unknown id raises `UnknownResearchNodeError`.
 */
export function getResearchNodeById(
  researchNodeId: string,
): ResearchNodeDefinition | undefined {
  return RESEARCH_NODES.find((n) => n.id === researchNodeId);
}
