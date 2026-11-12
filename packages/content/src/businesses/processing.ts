/**
 * Processing businesses — supply chain level 1 (P8a — TDD §5.7 / §11, GDD §8.2
 * supply chains, §8.5 markets).
 *
 * Level-1 businesses chemically or mechanically process raw materials from
 * level-0 extraction into intermediate inputs for level-2 manufacturing.
 * They consume upstream resources (`resource:minerals`, `resource:timber`)
 * and produce intermediates (`resource:chemicals`, `resource:lumber`) that
 * feed the next tier. Like extraction, they typically sell B2B to downstream
 * businesses rather than into a commodity market — vertical integration.
 *
 * PROVISIONAL: every numeric field per GDD §17 ("detailed resource simulation
 * equations" + business balance). Costs are bigint minor units as string
 * (TDD §10.1).
 */
import type { BusinessTypeDefinition } from '@capitalist-tree/shared';

export const CHEMICAL_PLANT: BusinessTypeDefinition = {
  id: 'business:chemical-plant',
  name: 'Chemical Plant',
  description:
    'Processes raw minerals into chemical precursors (ammonia, phosphoric ' +
    'acid) for the fertilizer-factory tier (GDD §8.2 chemical production — ' +
    'step 2 of the fertilizer supply chain example). Level-1 supply chain — ' +
    'buys minerals from upstream mineral-mine, sells chemicals downstream. ' +
    'High energy consumption + pollution (pillar 4).',
  category: 'processing',
  supplyChainLevel: 1,
  defaultProduction: {
    inputResourceIds: ['resource:minerals'],
    outputResourceId: 'resource:chemicals',
    rate: 40, // units of chemicals per operate step (PROVISIONAL)
    efficiency: 0.85,
  },
  baseCost: '200000', // $2000.00 (PROVISIONAL)
  baseEmployees: 8,
  baseWageRate: '700', // $7.00 / employee / pay period (PROVISIONAL)
  baseEnvironmentalImpact: {
    carbonEmissions: 1.5, // process heat + feedstock (PROVISIONAL)
    waterConsumption: 20, // cooling + process water (PROVISIONAL)
    soilDegradation: 0,
    pollution: 0.6, // chemical effluent (PROVISIONAL)
    landDisturbance: 0.1,
    biodiversityImpact: 0.05,
  },
  baseValuation: '300000', // $3000.00 (PROVISIONAL)
  marketParticipation: ['market:energy'], // buys energy; sells B2B
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

export const SAWMILL: BusinessTypeDefinition = {
  id: 'business:sawmill',
  name: 'Sawmill',
  description:
    'Processes raw timber into lumber for the equipment-factory tier ' +
    '(GDD §8.2 mechanical processing). Level-1 supply chain — buys timber, ' +
    'sells lumber downstream. Moderate land disturbance + carbon from ' +
    'machinery (pillar 4).',
  category: 'processing',
  supplyChainLevel: 1,
  defaultProduction: {
    inputResourceIds: ['resource:timber'],
    outputResourceId: 'resource:lumber',
    rate: 30, // units of lumber per operate step (PROVISIONAL)
    efficiency: 0.88,
  },
  baseCost: '80000', // $800.00 (PROVISIONAL)
  baseEmployees: 4,
  baseWageRate: '550', // $5.50 / employee / pay period (PROVISIONAL)
  baseEnvironmentalImpact: {
    carbonEmissions: 0.4, // saw machinery (PROVISIONAL)
    waterConsumption: 2,
    soilDegradation: 0.02,
    pollution: 0.05, // sawdust runoff (PROVISIONAL)
    landDisturbance: 0.08,
    biodiversityImpact: 0.02,
  },
  baseValuation: '110000', // $1100.00 (PROVISIONAL)
  marketParticipation: ['market:energy'],
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

export const PROCESSING_BUSINESSES: readonly BusinessTypeDefinition[] = [
  CHEMICAL_PLANT,
  SAWMILL,
];
