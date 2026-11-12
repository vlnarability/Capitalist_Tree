/**
 * Application businesses — supply chain level 5 (P8a — TDD §5.7 / §11, GDD §8.2
 * supply chains, §8.5 markets).
 *
 * Level-5 businesses are the end-use application tier — they consume finished
 * goods from the supply chain and produce something new. The farm applies
 * fertilizer + seeds + water to grow food (GDD §8.2 agricultural application
 * — step 6 of the fertilizer supply chain example). It buys fertilizer,
 * seeds, and water from commodity markets and sells food into `market:food`.
 * This closes the supply chain loop: the fertilizer that started as raw
 * minerals in the mineral-mine ends up applied to soil to grow food the
 * player (or other businesses) consume.
 *
 * PROVISIONAL: every numeric field per GDD §17 ("detailed resource simulation
 * equations" + business balance). Costs are bigint minor units as string
 * (TDD §10.1).
 */
import type { BusinessTypeDefinition } from '@capitalist-tree/shared';

export const FARM: BusinessTypeDefinition = {
  id: 'business:farm',
  name: 'Farm',
  description:
    'Agricultural application business that applies fertilizer + seeds + water ' +
    'to grow food for sale into the food commodity market (GDD §8.2 ' +
    'agricultural application — step 6 of the fertilizer supply chain ' +
    'example; §8.5 food + water + fertilizer + seeds markets). Level-5 ' +
    'supply chain — buys fertilizer, seeds, and water from commodity ' +
    'markets, sells food into `market:food`. Closes the supply chain loop: ' +
    'minerals extracted at level 0 end up applied to soil here to grow food. ' +
    'Moderate water consumption + land disturbance + biodiversity impact ' +
    '(pillar 4 — monoculture pressure).',
  category: 'application',
  supplyChainLevel: 5,
  defaultProduction: {
    inputResourceIds: [
      'fertilizer:balanced-10-10-10',
      'resource:seeds',
      'resource:water',
    ],
    outputResourceId: 'resource:food',
    rate: 15, // units of food per operate step (PROVISIONAL)
    efficiency: 0.8, // 20% loss to pests / weather / spoilage (PROVISIONAL)
  },
  baseCost: '90000', // $900.00 (PROVISIONAL)
  baseEmployees: 4,
  baseWageRate: '450', // $4.50 / employee / pay period (PROVISIONAL)
  baseEnvironmentalImpact: {
    carbonEmissions: 0.3, // tillage + transport (PROVISIONAL)
    waterConsumption: 30, // irrigation (PROVISIONAL)
    soilDegradation: 0.05, // monoculture nutrient depletion (PROVISIONAL)
    pollution: 0.1, // fertilizer runoff (PROVISIONAL)
    landDisturbance: 0.15, // cleared fields (PROVISIONAL)
    biodiversityImpact: 0.2, // monoculture habitat loss (PROVISIONAL)
  },
  baseValuation: '130000', // $1300.00 (PROVISIONAL)
  marketParticipation: [
    'market:fertilizer',
    'market:seeds',
    'market:water',
    'market:food',
    'market:energy',
  ],
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

export const APPLICATION_BUSINESSES: readonly BusinessTypeDefinition[] = [
  FARM,
];
