/**
 * Event content registry (P10a — TDD §6.4 Event Scheduling, TDD line 200
 * EventSystem; GDD §10.3 Environmental Feedback, §8 economic events, §6
 * policy, §5 biological; GDD §148-152 influence over regional/global
 * markets/governments/regulations/environmental conditions).
 *
 * Aggregates the four event-category sub-registries defined in
 * `event-types.ts`:
 *   - environmental/: drought, heat-wave, pest-outbreak, wildfire, flood.
 *   - economic/     : market-crash, resource-scarcity, recession, boom.
 *   - policy/       : carbon-tax-introduced, environmental-regulation-
 *                     tightened, subsidy-granted.
 *   - biological/   : disease-outbreak, invasive-species, blight.
 *
 * Each is pure data (rule 5). The EventSystem (P10b) reads these definitions
 * to resolve an event's `type`, roll severity/duration, and apply `effects`.
 * Follows the same pattern as `packages/content/src/progression/` and
 * `packages/content/src/businesses/`.
 */
import type { EventDefinition } from '@capitalist-tree/shared';
import { EVENT_DEFINITIONS } from './event-types.js';

export {
  DROUGHT,
  HEAT_WAVE,
  PEST_OUTBREAK,
  WILDFIRE,
  FLOOD,
  MARKET_CRASH,
  RESOURCE_SCARCITY,
  RECESSION,
  BOOM,
  CARBON_TAX_INTRODUCED,
  ENVIRONMENTAL_REGULATION_TIGHTENED,
  SUBSIDY_GRANTED,
  DISEASE_OUTBREAK,
  INVASIVE_SPECIES,
  BLIGHT,
} from './event-types.js';

export {
  ENVIRONMENTAL_EVENTS,
  ECONOMIC_EVENTS,
  POLICY_EVENTS,
  BIOLOGICAL_EVENTS,
  EVENT_DEFINITIONS,
} from './event-types.js';

/**
 * Look up an event definition by id. Returns the definition or `undefined` if
 * unknown. The `schedule-event` / `trigger-event` action handlers (P10b) use
 * this to resolve `eventTypeId`; an unknown id raises
 * `UnknownEventDefinitionError` (P10b).
 */
export function getEventDefinitionById(
  eventTypeId: string,
): EventDefinition | undefined {
  return EVENT_DEFINITIONS.find((e) => e.id === eventTypeId);
}
