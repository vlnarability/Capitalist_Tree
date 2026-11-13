/**
 * Distribution businesses — supply chain level 3 (P8a — TDD §5.7 / §11, GDD §8.2
 * supply chains, §8.5 markets).
 *
 * Level-3 businesses move finished goods from manufacturers to retailers.
 * The distribution-company buys fertilizer from the factory and resells it
 * to the general-store, taking a margin on the throughput. Production here
 * is pass-through: `outputResourceId` matches the input commodity, and the
 * "production" is the logistics throughput (rate × efficiency models the
 * fraction of input that reaches retail without spoilage / handling loss).
 *
 * PROVISIONAL: every numeric field per GDD §17 ("detailed resource simulation
 * equations" + business balance). Costs are bigint minor units as string
 * (TDD §10.1).
 */
import type { BusinessTypeDefinition } from '@capitalist-tree/shared';

export const DISTRIBUTION_COMPANY: BusinessTypeDefinition = {
  id: 'business:distribution-company',
  name: 'Distribution Company',
  description:
    'Wholesale logistics business that moves finished fertilizer from the ' +
    'factory to retail (GDD §8.2 distribution — step 4 of the fertilizer ' +
    'supply chain example). Level-3 supply chain — buys fertilizer upstream, ' +
    'sells fertilizer downstream (pass-through with a logistics margin). ' +
    'Production is throughput: outputResourceId matches the input commodity; ' +
    'rate × efficiency models the fraction that reaches retail without ' +
    'spoilage / handling loss. Moderate carbon from transport (pillar 4).',
  category: 'distribution',
  supplyChainLevel: 3,
  defaultProduction: {
    inputResourceIds: ['fertilizer:balanced-10-10-10'],
    // Pass-through: the output is the same commodity, ready for retail.
    outputResourceId: 'fertilizer:balanced-10-10-10',
    rate: 60, // units throughput per operate step (PROVISIONAL)
    efficiency: 0.95, // 5% logistics loss (PROVISIONAL)
  },
  baseCost: '150000', // $1500.00 (PROVISIONAL)
  baseEmployees: 6,
  baseWageRate: '650', // $6.50 / employee / pay period (PROVISIONAL)
  baseEnvironmentalImpact: {
    carbonEmissions: 0.6, // truck fleet (PROVISIONAL)
    waterConsumption: 0,
    soilDegradation: 0,
    pollution: 0.05, // exhaust (PROVISIONAL)
    landDisturbance: 0.05, // warehouse footprint (PROVISIONAL)
    biodiversityImpact: 0.01,
  },
  baseValuation: '220000', // $2200.00 (PROVISIONAL)
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

export const DISTRIBUTION_BUSINESSES: readonly BusinessTypeDefinition[] = [
  DISTRIBUTION_COMPANY,
];
