/**
 * Irrigation equipment — sprinklers tiers 1–3 (P6b1 — TDD §12, GDD §9).
 *
 * Automatic watering (GDD §9 "initial automation"). Each tier waters the
 * shared soil pool via the `apply-water` action when its policy fires. Higher
 * tiers cost more up front but (provisionally) apply more water per run and
 * waste less to evaporation runoff (lower `waterConsumption` in the
 * environmental impact) — the pillar-4 efficiency-vs-sustainability trade-off.
 *
 * Sprinklers consume `resource:water` from inventory; a policy that fires
 * with no water in inventory is skipped (`insufficient-resources`) rather than
 * throwing (graceful failure, GDD §16.3).
 *
 * PROVISIONAL: every numeric field per GDD §17 ("automation cost/effectiveness
 * balance"). Costs are bigint minor units as string (TDD §10.1).
 */
import type { EquipmentDefinition } from '@capitalist-tree/shared';

export const SPRINKLER_T1: EquipmentDefinition = {
  id: 'equipment:sprinkler-t1',
  name: 'Basic Sprinkler',
  description:
    'A simple oscillating sprinkler that waters the plot on a timer or when the ' +
    'soil gets dry. Entry-level automatic watering (GDD §9 initial automation).',
  category: 'irrigation',
  tier: 1,
  cost: '2000', // $20.00 (PROVISIONAL)
  baseEnergyConsumption: 0.5, // kWh-equiv / sim day (PROVISIONAL)
  baseMaintenanceCost: '5', // $0.05 / sim day (PROVISIONAL)
  baseEnvironmentalImpact: {
    carbonEmissions: 0.05,
    waterConsumption: 1.2, // 20% loss to evaporation/runoff (PROVISIONAL)
    soilDegradation: 0,
    pollution: 0,
    landDisturbance: 0,
    biodiversityImpact: 0,
  },
  supportedActions: ['apply-water'],
  supportedPolicies: ['threshold', 'schedule'],
};

export const SPRINKLER_T2: EquipmentDefinition = {
  id: 'equipment:sprinkler-t2',
  name: 'Drip Irrigation Line',
  description:
    'A drip line that delivers water directly to the root zone, reducing ' +
    'evaporation loss. Improved efficiency over the basic sprinkler (GDD §9).',
  category: 'irrigation',
  tier: 2,
  cost: '8000', // $80.00 (PROVISIONAL)
  baseEnergyConsumption: 1.0,
  baseMaintenanceCost: '15', // $0.15 / sim day (PROVISIONAL)
  baseEnvironmentalImpact: {
    carbonEmissions: 0.04,
    waterConsumption: 0.4, // 5% loss — drip is efficient (PROVISIONAL)
    soilDegradation: 0,
    pollution: 0,
    landDisturbance: 0,
    biodiversityImpact: 0,
  },
  supportedActions: ['apply-water'],
  supportedPolicies: ['threshold', 'schedule'],
  unlockRequirements: { minTreeMaturity: 0.2 },
};

export const SPRINKLER_T3: EquipmentDefinition = {
  id: 'equipment:sprinkler-t3',
  name: 'Industrial Irrigation Array',
  description:
    'A computerized irrigation array with soil-moisture sensors and zone ' +
    'control. Highest efficiency, supports event-driven policies (GDD §9 ' +
    '"industrial irrigation").',
  category: 'irrigation',
  tier: 3,
  cost: '30000', // $300.00 (PROVISIONAL)
  baseEnergyConsumption: 2.5,
  baseMaintenanceCost: '40', // $0.40 / sim day (PROVISIONAL)
  baseEnvironmentalImpact: {
    carbonEmissions: 0.03,
    waterConsumption: 0.2, // near-zero waste with sensor feedback (PROVISIONAL)
    soilDegradation: 0,
    pollution: 0,
    landDisturbance: 0.01, // buried infrastructure (PROVISIONAL)
    biodiversityImpact: 0,
  },
  supportedActions: ['apply-water'],
  supportedPolicies: ['threshold', 'event', 'schedule'],
  unlockRequirements: { minTreeMaturity: 0.5 },
};

export const IRRIGATION_EQUIPMENT: readonly EquipmentDefinition[] = [
  SPRINKLER_T1,
  SPRINKLER_T2,
  SPRINKLER_T3,
];
