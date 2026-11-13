/**
 * Retail businesses — supply chain level 4 (P8a — TDD §5.7 / §11, GDD §8.2
 * supply chains, §8.5 markets).
 *
 * Level-4 businesses sell finished goods to end consumers via the commodity
 * markets. The general-store buys fertilizer from the distribution tier and
 * sells into `market:fertilizer`, taking a retail margin. Production here is
 * pass-through like distribution; `efficiency` models the fraction of stocked
 * inventory that sells without spoilage / shrinkage (the retail markup itself
 * is a BusinessSystem pricing concern, modeled via
 * `PROVISIONAL_BUSINESS_OPERATING_MARGIN`, NOT via efficiency > 1 — the
 * `productionStateSchema` caps efficiency at [0,1] and P8a must not break
 * that P0 constraint).
 *
 * R-P8-7 (carry-forward): the retail markup is a valuation profitability
 * concern (`PROVISIONAL_BUSINESS_OPERATING_MARGIN` scales cumulative profit
 * into the valuation), NOT a production-efficiency value. A future phase may
 * add an explicit per-business `markup` field. See docs/business.md §16
 * (R-P8-7).
 *
 * PROVISIONAL: every numeric field per GDD §17 ("detailed resource simulation
 * equations" + business balance). Costs are bigint minor units as string
 * (TDD §10.1).
 */
import type { BusinessTypeDefinition } from '@capitalist-tree/shared';

export const GENERAL_STORE: BusinessTypeDefinition = {
  id: 'business:general-store',
  name: 'General Store',
  description:
    'Consumer-facing retail outlet that sells fertilizer (and other goods) ' +
    'to end consumers via the fertilizer commodity market (GDD §8.2 retail — ' +
    'step 5 of the fertilizer supply chain example; §8.5 fertilizer market). ' +
    'Level-4 supply chain — buys from distribution, sells into ' +
    '`market:fertilizer`. Production is pass-through: outputResourceId matches ' +
    'the input commodity; efficiency models the fraction of stocked inventory ' +
    'that sells without spoilage / shrinkage. The retail markup itself is a ' +
    'BusinessSystem pricing concern (PROVISIONAL_BUSINESS_OPERATING_MARGIN), ' +
    'not a production-efficiency value. Low environmental impact (pillar 4).',
  category: 'retail',
  supplyChainLevel: 4,
  defaultProduction: {
    inputResourceIds: ['fertilizer:balanced-10-10-10'],
    // Pass-through: the output is the same commodity, sold at retail.
    outputResourceId: 'fertilizer:balanced-10-10-10',
    rate: 20, // units sold per operate step (PROVISIONAL)
    efficiency: 0.98, // 2% spoilage / shrinkage (PROVISIONAL)
  },
  baseCost: '60000', // $600.00 (PROVISIONAL)
  baseEmployees: 3,
  baseWageRate: '500', // $5.00 / employee / pay period (PROVISIONAL)
  baseEnvironmentalImpact: {
    carbonEmissions: 0.1, // storefront energy (PROVISIONAL)
    waterConsumption: 0.5,
    soilDegradation: 0,
    pollution: 0,
    landDisturbance: 0.02, // storefront footprint (PROVISIONAL)
    biodiversityImpact: 0,
  },
  baseValuation: '90000', // $900.00 (PROVISIONAL)
  marketParticipation: ['market:fertilizer', 'market:food', 'market:energy'],
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

export const RETAIL_BUSINESSES: readonly BusinessTypeDefinition[] = [
  GENERAL_STORE,
];
