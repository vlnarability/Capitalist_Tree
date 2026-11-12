/**
 * Fertilization equipment — spreaders tiers 1–3 (P6b1 — TDD §12, GDD §9).
 *
 * Automatic fertilizing (GDD §9 "initial automation"). Each tier applies
 * fertilizer to the soil nutrient pool via the `apply-fertilizer` action when
 * its policy fires (typically a `threshold` on soil NPK levels). Higher tiers
 * apply more precisely, reducing over-application contamination (GDD §8.3
 * environmental feedback) — the pillar-4 efficiency-vs-sustainability trade-off.
 *
 * Spreaders consume a fertilizer from inventory (looked up by `fertilizerId`
 * in `actionParams`); a policy that fires with insufficient units is skipped
 * (`insufficient-resources`).
 *
 * PROVISIONAL: every numeric field per GDD §17. Costs are bigint minor units
 * as string (TDD §10.1).
 */
import type { EquipmentDefinition } from '@capitalist-tree/shared';

export const SPREADER_T1: EquipmentDefinition = {
  id: 'equipment:spreader-t1',
  name: 'Handheld Spreader',
  description:
    'A crank-operated broadcast spreader for even fertilizer coverage on a ' +
    'small plot. Entry-level automatic fertilizing (GDD §9 initial automation).',
  category: 'fertilization',
  tier: 1,
  cost: '1500', // $15.00 (PROVISIONAL)
  baseEnergyConsumption: 0.3,
  baseMaintenanceCost: '4', // $0.04 / sim day (PROVISIONAL)
  baseEnvironmentalImpact: {
    carbonEmissions: 0.03,
    waterConsumption: 0,
    soilDegradation: 0.01, // over-application risk (PROVISIONAL)
    pollution: 0.4, // runoff when mis-timed (PROVISIONAL)
    landDisturbance: 0,
    biodiversityImpact: 0,
  },
  supportedActions: ['apply-fertilizer'],
  supportedPolicies: ['threshold', 'schedule'],
};

export const SPREADER_T2: EquipmentDefinition = {
  id: 'equipment:spreader-t2',
  name: 'Drop Spreader',
  description:
    'A drop spreader that deposits fertilizer directly below the hopper, ' +
    'reducing drift and runoff. More precise than broadcast (GDD §9).',
  category: 'fertilization',
  tier: 2,
  cost: '6000', // $60.00 (PROVISIONAL)
  baseEnergyConsumption: 0.8,
  baseMaintenanceCost: '12', // $0.12 / sim day (PROVISIONAL)
  baseEnvironmentalImpact: {
    carbonEmissions: 0.02,
    waterConsumption: 0,
    soilDegradation: 0,
    pollution: 0.2, // less drift (PROVISIONAL)
    landDisturbance: 0,
    biodiversityImpact: 0,
  },
  supportedActions: ['apply-fertilizer'],
  supportedPolicies: ['threshold', 'schedule'],
  unlockRequirements: { minTreeMaturity: 0.2 },
};

export const SPREADER_T3: EquipmentDefinition = {
  id: 'equipment:spreader-t3',
  name: 'Precision Fertilizer Rig',
  description:
    'A variable-rate rig that reads soil nutrient levels and applies exactly ' +
    'the deficient NPK blend. Supports event-driven policies (GDD §9 advanced).',
  category: 'fertilization',
  tier: 3,
  cost: '25000', // $250.00 (PROVISIONAL)
  baseEnergyConsumption: 2.0,
  baseMaintenanceCost: '35', // $0.35 / sim day (PROVISIONAL)
  baseEnvironmentalImpact: {
    carbonEmissions: 0.02,
    waterConsumption: 0,
    soilDegradation: 0,
    pollution: 0.05, // near-zero waste with sensor feedback (PROVISIONAL)
    landDisturbance: 0,
    biodiversityImpact: 0,
  },
  supportedActions: ['apply-fertilizer'],
  supportedPolicies: ['threshold', 'event', 'schedule'],
  unlockRequirements: { minTreeMaturity: 0.5 },
};

export const FERTILIZATION_EQUIPMENT: readonly EquipmentDefinition[] = [
  SPREADER_T1,
  SPREADER_T2,
  SPREADER_T3,
];
