/**
 * Monitoring equipment (P6b1 — TDD §12, GDD §9 "environmental monitoring").
 *
 * Monitoring equipment produces *readings* that drive `threshold` policies
 * rather than executing actions directly, so `supportedActions` is empty.
 * A soil sensor enables threshold policies on soil moisture / NPK; a weather
 * station enables event-driven policies on weather transitions. They are the
 * sensing layer that makes reactive automation possible (GDD §9).
 *
 * Low energy draw, low environmental impact. No recurring resource
 * consumption — they observe, they do not consume.
 *
 * PROVISIONAL: every numeric field per GDD §17. Costs are bigint minor units
 * as string (TDD §10.1).
 */
import type { EquipmentDefinition } from '@capitalist-tree/shared';

export const SOIL_SENSOR: EquipmentDefinition = {
  id: 'equipment:soil-sensor',
  name: 'Soil Moisture & Nutrient Sensor',
  description:
    'A probe that reports soil water content, pH, and NPK levels continuously, ' +
    'enabling threshold-driven irrigation and fertilization policies (GDD §9 ' +
    'environmental monitoring).',
  category: 'monitoring',
  tier: 1,
  cost: '500', // $5.00 (PROVISIONAL)
  baseEnergyConsumption: 0.05, // kWh-equiv / sim day (PROVISIONAL)
  baseMaintenanceCost: '2', // $0.02 / sim day (PROVISIONAL)
  baseEnvironmentalImpact: {
    carbonEmissions: 0.01,
    waterConsumption: 0,
    soilDegradation: 0,
    pollution: 0,
    landDisturbance: 0,
    biodiversityImpact: 0,
  },
  supportedActions: [], // sensing only — no action executed
  supportedPolicies: ['threshold'],
};

export const WEATHER_STATION: EquipmentDefinition = {
  id: 'equipment:weather-station',
  name: 'Weather Station',
  description:
    'A station that tracks conditions and emits events on weather transitions, ' +
    'enabling event-driven automation (e.g. pause irrigation before a storm). ' +
    'GDD §9 environmental monitoring.',
  category: 'monitoring',
  tier: 1,
  cost: '1500', // $15.00 (PROVISIONAL)
  baseEnergyConsumption: 0.1,
  baseMaintenanceCost: '5', // $0.05 / sim day (PROVISIONAL)
  baseEnvironmentalImpact: {
    carbonEmissions: 0.02,
    waterConsumption: 0,
    soilDegradation: 0,
    pollution: 0,
    landDisturbance: 0,
    biodiversityImpact: 0,
  },
  supportedActions: [], // sensing only — no action executed
  supportedPolicies: ['event', 'threshold'],
};

export const MONITORING_EQUIPMENT: readonly EquipmentDefinition[] = [
  SOIL_SENSOR,
  WEATHER_STATION,
];
