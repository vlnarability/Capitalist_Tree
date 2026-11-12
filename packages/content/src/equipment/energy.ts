/**
 * Energy equipment (P6b1 — TDD §12, GDD §9.1 "Environmental Impact").
 *
 * Energy equipment offsets the `energyConsumption` of other automation —
 * pillar 4 (GDD §9.1) warns that automation introduces electricity / fossil
 * fuel consumption. A solar panel generates energy; a battery stores surplus
 * for night or peak demand. Neither executes actions, so `supportedActions`
 * is empty; they participate in the energy ledger P6b2 will wire.
 *
 * Solar panels have negative net carbon impact (they displace grid
 * emissions); batteries have manufacturing emissions amortized over their
 * lifetime.
 *
 * PROVISIONAL: every numeric field per GDD §17. Costs are bigint minor units
 * as string (TDD §10.1).
 */
import type { EquipmentDefinition } from '@capitalist-tree/shared';

export const SOLAR_PANEL: EquipmentDefinition = {
  id: 'equipment:solar-panel',
  name: 'Solar Panel',
  description:
    'A photovoltaic panel that generates energy to offset the consumption of ' +
    'other equipment. Displaces grid electricity, reducing net carbon impact ' +
    '(GDD §9.1 environmental impact).',
  category: 'energy',
  tier: 1,
  cost: '10000', // $100.00 (PROVISIONAL)
  baseEnergyConsumption: 0, // produces, not consumes (PROVISIONAL)
  baseMaintenanceCost: '10', // $0.10 / sim day (PROVISIONAL)
  baseEnvironmentalImpact: {
    // Negative carbon — displaces grid emissions (PROVISIONAL).
    carbonEmissions: -0.2,
    waterConsumption: 0,
    soilDegradation: 0,
    pollution: 0,
    landDisturbance: 0.01, // footprint + mounting (PROVISIONAL)
    biodiversityImpact: 0,
  },
  supportedActions: [], // generates energy, no action executed
  supportedPolicies: ['schedule'],
};

export const BATTERY: EquipmentDefinition = {
  id: 'equipment:battery',
  name: 'Energy Storage Battery',
  description:
    'A battery that stores surplus generated energy for night or peak demand, ' +
    'smoothing the load on solar-powered equipment (GDD §9.1).',
  category: 'energy',
  tier: 1,
  cost: '8000', // $80.00 (PROVISIONAL)
  baseEnergyConsumption: 0, // stores, not consumes (PROVISIONAL)
  baseMaintenanceCost: '8', // $0.08 / sim day (PROVISIONAL)
  baseEnvironmentalImpact: {
    // Manufacturing emissions amortized over lifetime (PROVISIONAL).
    carbonEmissions: 0.05,
    waterConsumption: 0,
    soilDegradation: 0,
    pollution: 0.02, // end-of-life disposal risk (PROVISIONAL)
    landDisturbance: 0,
    biodiversityImpact: 0,
  },
  supportedActions: [], // stores energy, no action executed
  supportedPolicies: ['schedule'],
};

export const ENERGY_EQUIPMENT: readonly EquipmentDefinition[] = [SOLAR_PANEL, BATTERY];
