/**
 * Harvesting equipment — harvesters tiers 1–3 (P6b1 — TDD §12, GDD §9).
 *
 * Automatic harvesting (GDD §9 "initial automation"). Each tier harvests
 * mature leaves via the `harvest-leaves` action when its policy fires
 * (typically a `threshold` on mature leaf count, or an `event` policy
 * listening for a leaf-maturity event). Higher tiers harvest more leaves per
 * run and damage the tree less — the pillar-4 efficiency-vs-sustainability
 * trade-off.
 *
 * Harvesters produce `pendingIssuances` (currency) rather than consuming
 * resources; a policy that fires with no mature leaves is skipped
 * (`condition-not-met`) rather than throwing.
 *
 * PROVISIONAL: every numeric field per GDD §17. Costs are bigint minor units
 * as string (TDD §10.1).
 */
import type { EquipmentDefinition } from '@capitalist-tree/shared';

export const HARVESTER_T1: EquipmentDefinition = {
  id: 'equipment:harvester-t1',
  name: 'Harvest Basket',
  description:
    'A motorized basket agitator that shakes loose ripe leaves into a ' +
    'collection bin. Entry-level automatic harvesting (GDD §9 initial ' +
    'automation). Manual power — no energy draw.',
  category: 'harvesting',
  tier: 1,
  cost: '1000', // $10.00 (PROVISIONAL)
  baseEnergyConsumption: 0, // manual (PROVISIONAL)
  baseMaintenanceCost: '3', // $0.03 / sim day (PROVISIONAL)
  baseEnvironmentalImpact: {
    carbonEmissions: 0,
    waterConsumption: 0,
    soilDegradation: 0,
    pollution: 0,
    landDisturbance: 0,
    biodiversityImpact: 0,
  },
  supportedActions: ['harvest-leaves'],
  supportedPolicies: ['threshold', 'schedule'],
};

export const HARVESTER_T2: EquipmentDefinition = {
  id: 'equipment:harvester-t2',
  name: 'Mechanical Shaker',
  description:
    'A tractor-mounted shaker that dislodges leaves from the whole canopy in ' +
    'one pass. Higher throughput than the basket, at the cost of mild canopy ' +
    'stress (GDD §9).',
  category: 'harvesting',
  tier: 2,
  cost: '12000', // $120.00 (PROVISIONAL)
  baseEnergyConsumption: 3.0,
  baseMaintenanceCost: '25', // $0.25 / sim day (PROVISIONAL)
  baseEnvironmentalImpact: {
    carbonEmissions: 0.15, // fossil-fuel-equivalent (PROVISIONAL)
    waterConsumption: 0,
    soilDegradation: 0.02, // compaction from equipment traffic (PROVISIONAL)
    pollution: 0.05,
    landDisturbance: 0.02,
    biodiversityImpact: 0,
  },
  supportedActions: ['harvest-leaves'],
  supportedPolicies: ['threshold', 'event', 'schedule'],
  unlockRequirements: { minTreeMaturity: 0.3 },
};

export const HARVESTER_T3: EquipmentDefinition = {
  id: 'equipment:harvester-t3',
  name: 'Autonomous Harvester',
  description:
    'A self-navigating harvester that monitors leaf maturity and harvests ' +
    'only ripe leaves with minimal canopy disturbance. Supports event-driven ' +
    'policies (GDD §9 "autonomous equipment").',
  category: 'harvesting',
  tier: 3,
  cost: '50000', // $500.00 (PROVISIONAL)
  baseEnergyConsumption: 5.0,
  baseMaintenanceCost: '50', // $0.50 / sim day (PROVISIONAL)
  baseEnvironmentalImpact: {
    carbonEmissions: 0.1,
    waterConsumption: 0,
    soilDegradation: 0.01,
    pollution: 0.02,
    landDisturbance: 0.01,
    biodiversityImpact: 0,
  },
  supportedActions: ['harvest-leaves'],
  supportedPolicies: ['threshold', 'event', 'schedule'],
  unlockRequirements: { minTreeMaturity: 0.6 },
};

export const HARVESTING_EQUIPMENT: readonly EquipmentDefinition[] = [
  HARVESTER_T1,
  HARVESTER_T2,
  HARVESTER_T3,
];
