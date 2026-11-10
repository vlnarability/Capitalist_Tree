/**
 * Balanced 10-10-10 NPK fertilizer (P2 — TDD §8.2).
 *
 * A general-purpose all-purpose fertilizer with equal parts N, P, K (10 units
 * each per application). The "default" fertilizer a new player would buy.
 *
 * Adds modest contamination when over-applied (synthetic fertilizer, no
 * organic matter contribution). PROVISIONAL per GDD §17.
 */
import type { Fertilizer } from '@capitalist-tree/shared';

export const BALANCED_10_10_10: Fertilizer = {
  id: 'fertilizer:balanced-10-10-10',
  name: 'Balanced 10-10-10 NPK',
  composition: {
    npk: {
      nitrogen: 10,
      phosphorus: 10,
      potassium: 10,
    },
    slowReleaseFraction: 1.0,
    contaminationPerUnit: 0.5,
    organicMatterPerUnit: 0,
  },
  // P3 will wire the actual cost; P2 leaves the field optional for forward-compat.
  costMinor: '500', // $5.00 per unit (PROVISIONAL).
};
