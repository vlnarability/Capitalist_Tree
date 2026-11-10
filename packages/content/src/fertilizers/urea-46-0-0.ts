/**
 * Urea (46-0-0) — high-nitrogen fertilizer (P2 — TDD §8.2).
 *
 * A nitrogen-only fertilizer. Useful when the soil is nitrogen-deficient
 * but P and K are fine. Higher contamination per unit than balanced NPK
 * because nitrogen leaches easily (GDD §10.3: environmental feedback).
 *
 * PROVISIONAL per GDD §17.
 */
import type { Fertilizer } from '@capitalist-tree/shared';

export const UREA_46_0_0: Fertilizer = {
  id: 'fertilizer:urea-46-0-0',
  name: 'Urea 46-0-0 (Nitrogen)',
  composition: {
    npk: {
      nitrogen: 46,
      phosphorus: 0,
      potassium: 0,
    },
    slowReleaseFraction: 1.0,
    contaminationPerUnit: 0.8, // nitrogen leaches easily → more contamination
    organicMatterPerUnit: 0,
  },
  costMinor: '800', // $8.00 per unit (PROVISIONAL — nitrogen-heavy).
};
