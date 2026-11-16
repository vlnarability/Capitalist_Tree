/**
 * Event definition registry — pure data (P10a — TDD §6.4 Event Scheduling,
 * TDD line 200 EventSystem; GDD §10.3 Environmental Feedback, §8 economic
 * events, §6 policy, §5 biological; GDD §148-152 influence over regional/
 * global markets/governments/regulations/environmental conditions).
 *
 * Each event is a pure-data `EventDefinition` (rule 5). The EventSystem
 * (P10b) reads a definition via `getEventDefinitionById` to resolve an
 * event's `type`, roll its severity within `severityRange`, roll its duration
 * within `durationRange`, and apply its `effects` deltas to the target
 * region's state (GDD §10.3 — environmental damage creates secondary
 * consequences).
 *
 * The events span four categories (GDD §10 environmental, §8 economic, §6
 * policy, §5 biological):
 *
 *   Environmental (GDD §10.3): drought, heat-wave, pest-outbreak, wildfire,
 *     flood.
 *   Economic (GDD §8.5 market simulation): market-crash, resource-scarcity,
 *     recession, boom.
 *   Policy (GDD §148-152, §404-408): carbon-tax-introduced,
 *     environmental-regulation-tightened, subsidy-granted.
 *   Biological (GDD §5): disease-outbreak, invasive-species, blight.
 *
 * `effects` is a record of regional/global state field path -> delta (sign =
 * direction of change). `triggerConditions` is a list of descriptive
 * condition strings the EventSystem (P10b) evaluates against regional/global
 * state to decide eligibility. `probabilityWeight` is the base weight
 * (relative to other eligible events) the scheduler uses when rolling random
 * events.
 *
 * PROVISIONAL per GDD §17 (event balance, regional granularity, recovery
 * timescales). Values are tuning data; add an event by appending to its
 * category array + to `EVENT_DEFINITIONS`.
 */
import type { EventDefinition } from '@capitalist-tree/shared';

// ---------------------------------------------------------------------------
// Environmental events (GDD §10.3 — environmental feedback)
// ---------------------------------------------------------------------------

/**
 * Drought — a region's water availability drops sharply (GDD §10.3: water
 * scarcity increases resource prices). Severity scales the depth + duration.
 * Triggers when a region's waterAvailability is already low or after a
 * sustained heat-wave.
 */
export const DROUGHT: EventDefinition = {
  id: 'event:drought',
  name: 'Drought',
  description:
    'A prolonged dry spell drains the region\'s freshwater. Water availability ' +
    'falls, soil moisture drops, and resource prices for water climb (GDD ' +
    '§10.3 — water scarcity increases resource prices).',
  category: 'environmental',
  severityRange: ['minor', 'catastrophic'],
  durationRange: [30, 120], // ticks
  effects: {
    waterAvailability: -0.3,
    'climate.precipitationBaseline': -0.2,
    soilHealth: -0.05,
  },
  triggerConditions: [
    'waterAvailability < 0.4',
    'season in (summer, autumn)',
    'precipitationBaseline below regional average',
  ],
  probabilityWeight: 1.2,
};

/**
 * Heat-wave — regional temperature spikes, stressing biology (GDD §10.3:
 * climate disruption increases drought, heat, and extreme weather risks).
 * Triggers in summer or under sustained global warming.
 */
export const HEAT_WAVE: EventDefinition = {
  id: 'event:heat-wave',
  name: 'Heat Wave',
  description:
    'A sustained heat dome raises the region\'s effective temperature well ' +
    'above its baseline, stressing tree biology and raising wildfire risk ' +
    '(GDD §10.3 — climate disruption increases heat risks).',
  category: 'environmental',
  severityRange: ['minor', 'severe'],
  durationRange: [10, 60],
  effects: {
    'climate.temperatureBaseline': 5,
    waterAvailability: -0.15,
    biodiversity: -0.05,
  },
  triggerConditions: [
    'season == summer',
    'globalTemperature > baseline + 1',
  ],
  probabilityWeight: 1.0,
};

/**
 * Pest-outbreak — foliage-damaging insects surge (GDD §10.3: biodiversity
 * loss reduces resilience). Triggers when biodiversity is low (fewer
 * predators) and the season is warm.
 */
export const PEST_OUTBREAK: EventDefinition = {
  id: 'event:pest-outbreak',
  name: 'Pest Outbreak',
  description:
    'A pest population explodes in the region, defoliating trees and ' +
    'stressing biology. Low biodiversity (fewer natural predators) makes ' +
    'outbreaks more likely and more severe (GDD §10.3 — biodiversity loss ' +
    'reduces ecosystem resilience).',
  category: 'environmental',
  severityRange: ['minor', 'severe'],
  durationRange: [20, 80],
  effects: {
    biodiversity: -0.1,
    forestCoverage: -0.1,
  },
  triggerConditions: [
    'biodiversity < 0.5',
    'season in (spring, summer)',
    'temperatureBaseline above regional average',
  ],
  probabilityWeight: 0.9,
};

/**
 * Wildfire — forest coverage is destroyed and carbon is emitted (GDD §10.3:
 * deforestation increases erosion and reduces habitat; GDD §10.1 atmospheric
 * carbon). Triggers under drought + heat + low forest-coverage resilience.
 */
export const WILDFIRE: EventDefinition = {
  id: 'event:wildfire',
  name: 'Wildfire',
  description:
    'A wildfire sweeps the region, destroying forest coverage and releasing ' +
    'stored carbon into the atmosphere (GDD §10.3 — deforestation; §10.1 ' +
    'atmospheric carbon). Recovery is slow and costly.',
  category: 'environmental',
  severityRange: ['moderate', 'catastrophic'],
  durationRange: [5, 30],
  effects: {
    forestCoverage: -0.4,
    'pollution.air': 50,
    biodiversity: -0.2,
    soilHealth: -0.15,
  },
  triggerConditions: [
    'forestCoverage > 0.2',
    'waterAvailability < 0.3',
    'temperatureBaseline above regional average',
    'season in (summer, autumn)',
  ],
  probabilityWeight: 0.4,
};

/**
 * Flood — infrastructure damaged + soil eroded (GDD §10.3: soil degradation
 * reduces productivity; GDD §10.1 nutrient runoff, land degradation).
 * Triggers after sustained heavy precipitation or in flood-prone regions.
 */
export const FLOOD: EventDefinition = {
  id: 'event:flood',
  name: 'Flood',
  description:
    'A flood inundates the region, eroding soil, washing out nutrients, and ' +
    'damaging infrastructure (GDD §10.3 — soil degradation; §10.1 nutrient ' +
    'runoff, land degradation).',
  category: 'environmental',
  severityRange: ['minor', 'severe'],
  durationRange: [5, 20],
  effects: {
    soilHealth: -0.2,
    'pollution.water': 30,
    'pollution.soil': 15,
    industrialActivity: -0.1,
  },
  triggerConditions: [
    'precipitationBaseline above regional average',
    'vulnerabilities contains "flood-risk"',
    'season in (spring, autumn)',
  ],
  probabilityWeight: 0.6,
};

// ---------------------------------------------------------------------------
// Economic events (GDD §8.5 — market simulation)
// ---------------------------------------------------------------------------

/**
 * Market-crash — commodity prices drop sharply (GDD §8.5 market simulation;
 * §563 markets at regional and global scales). Triggers under recession or
 * after a speculative boom.
 */
export const MARKET_CRASH: EventDefinition = {
  id: 'event:market-crash',
  name: 'Market Crash',
  description:
    'A market crash sends commodity prices plummeting (GDD §8.5 — market ' +
    'simulation). Producers see revenues collapse; downstream buyers benefit ' +
    'briefly until supply contracts.',
  category: 'economic',
  severityRange: ['moderate', 'catastrophic'],
  durationRange: [20, 90],
  effects: {
    'globalMarketIndices.index:commodity-basket': -0.3,
    industrialActivity: -0.1,
  },
  triggerConditions: [
    'globalMarketIndices["index:commodity-basket"] above 100',
    'interestRate > 0.07',
  ],
  probabilityWeight: 0.5,
};

/**
 * Resource-scarcity — a specific resource price spikes (GDD §10.3: water
 * scarcity increases resource prices; §8.5 supply/demand). Triggers when a
 * resource's regional availability drops.
 */
export const RESOURCE_SCARCITY: EventDefinition = {
  id: 'event:resource-scarcity',
  name: 'Resource Scarcity',
  description:
    'A key resource becomes scarce, spiking its market price (GDD §10.3 — ' +
    'water scarcity increases resource prices; §8.5 supply/demand pricing).',
  category: 'economic',
  severityRange: ['minor', 'severe'],
  durationRange: [15, 60],
  effects: {
    'globalMarketIndices.index:commodity-basket': 0.15,
    industrialActivity: -0.05,
  },
  triggerConditions: [
    'waterAvailability < 0.3',
    'industrialActivity > 0.6',
  ],
  probabilityWeight: 0.8,
};

/**
 * Recession — regional/global demand drops (GDD §8.4 growth pressure; §8.5
 * market simulation). Triggers after a market crash or tight monetary policy.
 */
export const RECESSION: EventDefinition = {
  id: 'event:recession',
  name: 'Recession',
  description:
    'A recession contracts demand across the region (GDD §8.4 growth ' +
    'pressure; §8.5 market simulation). Industrial activity falls and ' +
    'commodity prices soften.',
  category: 'economic',
  severityRange: ['moderate', 'severe'],
  durationRange: [60, 180],
  effects: {
    industrialActivity: -0.2,
    'globalMarketIndices.index:commodity-basket': -0.15,
  },
  triggerConditions: [
    'interestRate > 0.08',
    'globalMarketIndices["index:commodity-basket"] below trend',
  ],
  probabilityWeight: 0.4,
};

/**
 * Boom — demand + prices rise (GDD §8.4 growth pressure; §8.5 market
 * simulation). Triggers under loose monetary policy or after a subsidy
 * program.
 */
export const BOOM: EventDefinition = {
  id: 'event:boom',
  name: 'Economic Boom',
  description:
    'An economic boom lifts demand and prices across the region (GDD §8.4 ' +
    'growth pressure; §8.5 market simulation). Industrial activity rises, ' +
    'but so does pollution.',
  category: 'economic',
  severityRange: ['minor', 'moderate'],
  durationRange: [60, 150],
  effects: {
    industrialActivity: 0.2,
    'globalMarketIndices.index:commodity-basket': 0.2,
    'pollution.air': 20,
  },
  triggerConditions: [
    'interestRate < 0.04',
    'moneySupplyGrowth > 0.04',
  ],
  probabilityWeight: 0.5,
};

// ---------------------------------------------------------------------------
// Policy events (GDD §148-152, §404-408 — governments + monetary authority)
// ---------------------------------------------------------------------------

/**
 * Carbon-tax-introduced — the government levies a carbon tax (GDD §148-152 —
 * influence over governments/regulations; §6 monetary authority). Triggers
 * when atmospheric carbon crosses a policy threshold.
 */
export const CARBON_TAX_INTRODUCED: EventDefinition = {
  id: 'event:carbon-tax-introduced',
  name: 'Carbon Tax Introduced',
  description:
    'The government introduces a carbon tax on emissions (GDD §148-152 — ' +
    'regulatory influence; §6 monetary authority). Industrial activity ' +
    'contracts and pollution falls.',
  category: 'policy',
  severityRange: ['minor', 'moderate'],
  durationRange: [120, 360],
  effects: {
    industrialActivity: -0.1,
    'pollution.air': -25,
  },
  triggerConditions: [
    'atmosphericCarbon > 430',
    'environmentalRegulations < 0.5',
  ],
  probabilityWeight: 0.3,
};

/**
 * Environmental-regulation-tightened — regulation stringency rises (GDD
 * §148-152). Triggers when pollution loads are high.
 */
export const ENVIRONMENTAL_REGULATION_TIGHTENED: EventDefinition = {
  id: 'event:environmental-regulation-tightened',
  name: 'Environmental Regulations Tightened',
  description:
    'The government tightens environmental regulations (GDD §148-152 — ' +
    'regulatory influence). Pollution output is capped more strictly.',
  category: 'policy',
  severityRange: ['minor', 'moderate'],
  durationRange: [120, 360],
  effects: {
    'pollution.air': -15,
    'pollution.water': -10,
    'pollution.soil': -10,
    industrialActivity: -0.05,
  },
  triggerConditions: [
    'pollution.air above threshold',
    'environmentalRegulations < 0.7',
  ],
  probabilityWeight: 0.3,
};

/**
 * Subsidy-granted — a subsidy program is launched (GDD §148-152; §6 monetary
 * authority). Triggers to stimulate a struggling sector.
 */
export const SUBSIDY_GRANTED: EventDefinition = {
  id: 'event:subsidy-granted',
  name: 'Subsidy Program Granted',
  description:
    'The government launches a subsidy program for a struggling sector (GDD ' +
    '§148-152; §6 monetary authority). Industrial activity in the targeted ' +
    'sector rises.',
  category: 'policy',
  severityRange: ['minor', 'moderate'],
  durationRange: [90, 300],
  effects: {
    industrialActivity: 0.1,
  },
  triggerConditions: [
    'industrialActivity < 0.4',
    'recession active',
  ],
  probabilityWeight: 0.25,
};

// ---------------------------------------------------------------------------
// Biological events (GDD §5 — biological simulation)
// ---------------------------------------------------------------------------

/**
 * Disease-outbreak — a pathogen affects tree health (GDD §5 biological
 * simulation). Triggers under stress + low biodiversity.
 */
export const DISEASE_OUTBREAK: EventDefinition = {
  id: 'event:disease-outbreak',
  name: 'Disease Outbreak',
  description:
    'A pathogen spreads through the region\'s tree population, damaging ' +
    'health (GDD §5 — biological simulation). Low biodiversity and high ' +
    'stress make outbreaks more severe.',
  category: 'biological',
  severityRange: ['minor', 'severe'],
  durationRange: [30, 90],
  effects: {
    biodiversity: -0.1,
    forestCoverage: -0.05,
  },
  triggerConditions: [
    'biodiversity < 0.5',
    'ecosystemResilience < 0.5',
    'season in (spring, summer)',
  ],
  probabilityWeight: 0.7,
};

/**
 * Invasive-species — biodiversity loss as an invader outcompetes natives
 * (GDD §10.3 — biodiversity loss reduces resilience; §5 biological).
 * Triggers via trade/transport in industrialized regions.
 */
export const INVASIVE_SPECIES: EventDefinition = {
  id: 'event:invasive-species',
  name: 'Invasive Species',
  description:
    'An invasive species establishes in the region, outcompeting native ' +
    'species and eroding biodiversity (GDD §10.3 — biodiversity loss; §5 ' +
    'biological). Industrialized regions with high trade are more exposed.',
  category: 'biological',
  severityRange: ['minor', 'severe'],
  durationRange: [60, 200],
  effects: {
    biodiversity: -0.15,
    ecosystemResilience: -0.1,
  },
  triggerConditions: [
    'industrialActivity > 0.5',
    'biodiversity < 0.6',
  ],
  probabilityWeight: 0.5,
};

/**
 * Blight — a fungal/viral blight damages foliage (GDD §5 biological
 * simulation; §10.3 biodiversity loss). Triggers in humid, low-biodiversity
 * regions.
 */
export const BLIGHT: EventDefinition = {
  id: 'event:blight',
  name: 'Blight',
  description:
    'A blight spreads through the region\'s foliage, damaging leaves and ' +
    'stressing trees (GDD §5 — biological simulation). Humid, low-biodiversity ' +
    'regions are most vulnerable.',
  category: 'biological',
  severityRange: ['minor', 'moderate'],
  durationRange: [20, 70],
  effects: {
    forestCoverage: -0.1,
    biodiversity: -0.05,
  },
  triggerConditions: [
    'humidityBaseline > 0.7',
    'biodiversity < 0.5',
    'season in (spring, summer)',
  ],
  probabilityWeight: 0.6,
};

// ---------------------------------------------------------------------------
// Aggregated registry
// ---------------------------------------------------------------------------

/** Environmental event definitions (GDD §10.3). */
export const ENVIRONMENTAL_EVENTS: readonly EventDefinition[] = [
  DROUGHT,
  HEAT_WAVE,
  PEST_OUTBREAK,
  WILDFIRE,
  FLOOD,
];

/** Economic event definitions (GDD §8.5). */
export const ECONOMIC_EVENTS: readonly EventDefinition[] = [
  MARKET_CRASH,
  RESOURCE_SCARCITY,
  RECESSION,
  BOOM,
];

/** Policy event definitions (GDD §148-152, §404-408). */
export const POLICY_EVENTS: readonly EventDefinition[] = [
  CARBON_TAX_INTRODUCED,
  ENVIRONMENTAL_REGULATION_TIGHTENED,
  SUBSIDY_GRANTED,
];

/** Biological event definitions (GDD §5). */
export const BIOLOGICAL_EVENTS: readonly EventDefinition[] = [
  DISEASE_OUTBREAK,
  INVASIVE_SPECIES,
  BLIGHT,
];

/**
 * All event definitions, in a stable order. The EventSystem (P10b) iterates
 * this list (filtered by eligibility) when rolling random events. Content
 * authors add an event by appending to its category array above — it is
 * picked up here automatically.
 */
export const EVENT_DEFINITIONS: readonly EventDefinition[] = [
  ...ENVIRONMENTAL_EVENTS,
  ...ECONOMIC_EVENTS,
  ...POLICY_EVENTS,
  ...BIOLOGICAL_EVENTS,
];
