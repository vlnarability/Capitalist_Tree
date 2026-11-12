/**
 * Extraction businesses — supply chain level 0 (P8a — TDD §5.7 / §11, GDD §8.2
 * supply chains, §8.5 markets).
 *
 * Level-0 businesses extract raw materials from the environment (water,
 * minerals, timber). They consume no upstream inputs (`inputResourceIds:
 * []`) — their "input" is the environment itself, modeled via
 * `environmentalImpact` (water consumption, land disturbance) rather than
 * inventory resources. Their output feeds level-1 processing businesses or
 * sells directly into a commodity market.
 *
 * PROVISIONAL: every numeric field per GDD §17 ("detailed resource simulation
 * equations" + business balance). Costs are bigint minor units as string
 * (TDD §10.1).
 */
import type { BusinessTypeDefinition } from '@capitalist-tree/shared';

export const WATER_EXTRACTION_PLANT: BusinessTypeDefinition = {
  id: 'business:water-extraction-plant',
  name: 'Water Extraction Plant',
  description:
    'Pumps and treats irrigation water from groundwater + surface sources for ' +
    'sale into the water commodity market (GDD §8.2 raw material extraction, ' +
    '§8.5 water market). Level-0 supply chain — consumes no upstream inputs; ' +
    'its environmental cost is water-table drawdown + land disturbance.',
  category: 'extraction',
  supplyChainLevel: 0,
  defaultProduction: {
    inputResourceIds: [],
    outputResourceId: 'resource:water',
    rate: 100, // litres per operate step (PROVISIONAL)
    efficiency: 0.9,
  },
  baseCost: '50000', // $500.00 (PROVISIONAL)
  baseEmployees: 2,
  baseWageRate: '400', // $4.00 / employee / pay period (PROVISIONAL)
  baseEnvironmentalImpact: {
    carbonEmissions: 0.2, // pump electricity (PROVISIONAL)
    waterConsumption: 50, // net drawdown after treatment losses (PROVISIONAL)
    soilDegradation: 0,
    pollution: 0.01, // treatment runoff (PROVISIONAL)
    landDisturbance: 0.05, // wellhead + access roads (PROVISIONAL)
    biodiversityImpact: 0.01,
  },
  baseValuation: '75000', // $750.00 (PROVISIONAL) — > cost (operating margin)
  marketParticipation: ['market:water'],
  supportedActions: [
    'purchase-business',
    'operate-business',
    'sell-business',
    'take-loan',
    'repay-loan',
    'hire-employees',
    'lay-off-employees',
    'set-business-status',
  ],
};

export const MINERAL_MINE: BusinessTypeDefinition = {
  id: 'business:mineral-mine',
  name: 'Mineral Mine',
  description:
    'Surface mine extracting phosphate rock, potash, and other mineral inputs ' +
    'for the chemical-plant tier (GDD §8.2 raw material extraction). Level-0 ' +
    'supply chain — sells directly to downstream businesses (vertical ' +
    'integration) rather than into a commodity market; its marketParticipation ' +
    'is empty because minerals are not in the GDD §8.5 initial market list. ' +
    'High land disturbance + biodiversity impact (pillar 4).',
  category: 'extraction',
  supplyChainLevel: 0,
  defaultProduction: {
    inputResourceIds: [],
    outputResourceId: 'resource:minerals',
    rate: 50, // units per operate step (PROVISIONAL)
    efficiency: 0.8,
  },
  baseCost: '120000', // $1200.00 (PROVISIONAL)
  baseEmployees: 5,
  baseWageRate: '600', // $6.00 / employee / pay period (PROVISIONAL)
  baseEnvironmentalImpact: {
    carbonEmissions: 0.8, // diesel equipment (PROVISIONAL)
    waterConsumption: 5, // dust suppression (PROVISIONAL)
    soilDegradation: 0.3, // overburden removal (PROVISIONAL)
    pollution: 0.2, // tailings runoff (PROVISIONAL)
    landDisturbance: 0.5, // open-pit footprint (PROVISIONAL)
    biodiversityImpact: 0.4, // habitat loss (PROVISIONAL)
  },
  baseValuation: '180000', // $1800.00 (PROVISIONAL)
  marketParticipation: [], // B2B vertical integration — no commodity market
  supportedActions: [
    'purchase-business',
    'operate-business',
    'sell-business',
    'take-loan',
    'repay-loan',
    'hire-employees',
    'lay-off-employees',
    'set-business-status',
  ],
};

export const EXTRACTION_BUSINESSES: readonly BusinessTypeDefinition[] = [
  WATER_EXTRACTION_PLANT,
  MINERAL_MINE,
];
