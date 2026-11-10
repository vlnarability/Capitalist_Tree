/**
 * Compost — organic-matter-rich low-NPK fertilizer (P2 — TDD §8.2, §8.3).
 *
 * Adds organic matter to the soil (improving long-term soil health) but
 * modest NPK. Used to remediate degraded soils. Lower contamination per
 * unit than synthetic fertilizers (organic, slow-release).
 *
 * PROVISIONAL per GDD §17.
 */
import type { Fertilizer } from '@capitalist-tree/shared';

export const COMPOST: Fertilizer = {
  id: 'fertilizer:compost',
  name: 'Compost (Organic Matter)',
  composition: {
    npk: {
      nitrogen: 2,
      phosphorus: 1,
      potassium: 2,
    },
    slowReleaseFraction: 0.3, // slow-release — 30% immediate, 70% over time (extension point)
    contaminationPerUnit: 0.05, // very low — organic
    organicMatterPerUnit: 5, // significant organic matter contribution
  },
  costMinor: '300', // $3.00 per unit (PROVISIONAL).
};
