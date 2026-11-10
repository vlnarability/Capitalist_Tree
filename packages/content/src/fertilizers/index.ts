/**
 * Fertilizer content registry (P2 — TDD §8.2, GDD §10.1).
 *
 * Each fertilizer is a pure data object. The `apply-fertilizer` action
 * handler looks up a fertilizer by id via `findFertilizerById`; content
 * authors add new fertilizers by appending to `ALL_FERTILIZERS`.
 *
 * The engine imports this module directly so that the action handler can
 * resolve fertilizer ids. Tests can inject their own fertilizers via
 * direct lookup if needed.
 *
 * PROVISIONAL per GDD §17 ("detailed resource simulation equations").
 */
import type { Fertilizer } from '@capitalist-tree/shared';
import { BALANCED_10_10_10 } from './balanced-10-10-10.js';
import { UREA_46_0_0 } from './urea-46-0-0.js';
import { COMPOST } from './compost.js';

export { BALANCED_10_10_10 } from './balanced-10-10-10.js';
export { UREA_46_0_0 } from './urea-46-0-0.js';
export { COMPOST } from './compost.js';

/** All known fertilizers. Add new fertilizers here. */
export const ALL_FERTILIZERS: readonly Fertilizer[] = [
  BALANCED_10_10_10,
  UREA_46_0_0,
  COMPOST,
];

/** Look up a fertilizer by id. Returns the fertilizer or `undefined` if unknown. */
export function findFertilizerById(fertilizerId: string): Fertilizer | undefined {
  return ALL_FERTILIZERS.find((f) => f.id === fertilizerId);
}
