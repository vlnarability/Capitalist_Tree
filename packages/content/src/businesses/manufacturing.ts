/**
 * Manufacturing businesses — supply chain level 2 (P8a — TDD §5.7 / §11,
 * GDD §8.2 supply chains, §8.5 markets).
 *
 * Level-2 businesses manufacture finished goods from processed intermediates.
 * The fertilizer-factory turns chemicals into the `fertilizer:balanced-10-10-10`
 * commodity sold into the `market:fertilizer` market (step 3 of GDD §8.2's
 * fertilizer supply chain example). The equipment-factory turns lumber + steel
 * into equipment goods (the `market:equipment` market — GDD §8.5 lists
 * equipment but P3b deferred its MarketState; P8a does not add the live market,
 * so `marketParticipation` lists the market id the BusinessSystem will target
 * once the market exists).
 *
 * PROVISIONAL: every numeric field per GDD §17 ("detailed resource simulation
 * equations" + business balance). Costs are bigint minor units as string
 * (TDD §10.1).
 */
import type { BusinessTypeDefinition } from '@capitalist-tree/shared';

export const FERTILIZER_FACTORY: BusinessTypeDefinition = {
  id: 'business:fertilizer-factory',
  name: 'Fertilizer Factory',
  description:
    'Manufactures balanced NPK fertilizer from chemical precursors for sale ' +
    'into the fertilizer commodity market (GDD §8.2 fertilizer manufacturing — ' +
    'step 3 of the supply chain example; §8.5 fertilizer market). Level-2 ' +
    'supply chain — buys chemicals from upstream, sells fertilizer into ' +
    '`market:fertilizer` and to downstream distribution. Moderate energy + ' +
    'pollution (pillar 4).',
  category: 'manufacturing',
  supplyChainLevel: 2,
  defaultProduction: {
    inputResourceIds: ['resource:chemicals'],
    outputResourceId: 'fertilizer:balanced-10-10-10',
    rate: 25, // units of fertilizer per operate step (PROVISIONAL)
    efficiency: 0.9,
  },
  baseCost: '300000', // $3000.00 (PROVISIONAL)
  baseEmployees: 10,
  baseWageRate: '750', // $7.50 / employee / pay period (PROVISIONAL)
  baseEnvironmentalImpact: {
    carbonEmissions: 1.0, // process heat (PROVISIONAL)
    waterConsumption: 10,
    soilDegradation: 0,
    pollution: 0.3, // nutrient runoff if mismanaged (PROVISIONAL)
    landDisturbance: 0.05,
    biodiversityImpact: 0.02,
  },
  baseValuation: '450000', // $4500.00 (PROVISIONAL)
  marketParticipation: ['market:fertilizer', 'market:energy'],
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

export const EQUIPMENT_FACTORY: BusinessTypeDefinition = {
  id: 'business:equipment-factory',
  name: 'Equipment Factory',
  description:
    'Manufactures automation + irrigation equipment from lumber + steel for ' +
    'sale into the equipment commodity market (GDD §8.2 manufacturing, §8.5 ' +
    'equipment market — P3b deferred the live MarketState for equipment, so ' +
    'this business targets a market id that will exist once P8c+ adds it). ' +
    'Level-2 supply chain — buys processed materials, sells equipment goods. ' +
    'Moderate carbon + land disturbance (pillar 4).',
  category: 'manufacturing',
  supplyChainLevel: 2,
  defaultProduction: {
    inputResourceIds: ['resource:lumber', 'resource:steel'],
    outputResourceId: 'resource:equipment',
    rate: 8, // units of equipment per operate step (PROVISIONAL)
    efficiency: 0.82,
  },
  baseCost: '400000', // $4000.00 (PROVISIONAL)
  baseEmployees: 12,
  baseWageRate: '800', // $8.00 / employee / pay period (PROVISIONAL)
  baseEnvironmentalImpact: {
    carbonEmissions: 1.2, // assembly line energy (PROVISIONAL)
    waterConsumption: 5,
    soilDegradation: 0,
    pollution: 0.1, // solvent emissions (PROVISIONAL)
    landDisturbance: 0.1, // factory footprint (PROVISIONAL)
    biodiversityImpact: 0.03,
  },
  baseValuation: '600000', // $6000.00 (PROVISIONAL)
  marketParticipation: ['market:equipment', 'market:energy'],
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

export const MANUFACTURING_BUSINESSES: readonly BusinessTypeDefinition[] = [
  FERTILIZER_FACTORY,
  EQUIPMENT_FACTORY,
];
