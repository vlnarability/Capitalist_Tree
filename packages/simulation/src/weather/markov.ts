/**
 * Markov chain weather transitions (TDD §9.1, GDD §4.3).
 *
 * The weather follows a Markov chain: each step the next condition is picked
 * from a per-season transition matrix. The matrix is content data
 * (`packages/content/src/weather/transition-matrices.ts`); this module is the
 * pure engine that rolls the dice.
 *
 * Staleness handling: if the current condition has persisted longer than
 * PROVISIONAL_WEATHER_MAX_DAYS_IN_CONDITION, the "stay in current" probability
 * is reduced and the residual is redistributed proportionally across the
 * other transitions. This prevents indefinite runs of any single condition
 * (especially severe storms / droughts / frosts).
 *
 * Pure: takes the current condition + matrix + RNG, returns the next
 * condition. Caller writes it back to the WeatherState.
 */
import type { Rng } from '../rng.js';
import type { WeatherCondition, WeatherTransitionMatrix } from '@capitalist-tree/shared';
import { PROVISIONAL_WEATHER_MAX_DAYS_IN_CONDITION, PROVISIONAL_WEATHER_STALENESS_BIAS } from '@capitalist-tree/shared';

/**
 * Pick the next weather condition from the matrix given the current condition.
 *
 * The matrix row for `currentCondition` is a probability distribution over
 * the next condition. We roll the RNG once and walk the cumulative
 * distribution to find the chosen next condition.
 *
 * If `daysInCondition` exceeds the staleness threshold, the "stay" entry
 * (current → current) is reduced by the staleness bias, and the residual
 * is redistributed proportionally across the other entries. This makes long
 * runs of any single condition progressively less likely.
 *
 * Pure: takes (matrix, currentCondition, daysInCondition, rng) and returns
 * the next condition. Does not mutate the matrix.
 */
export function pickNextCondition(
  matrix: WeatherTransitionMatrix,
  currentCondition: WeatherCondition,
  daysInCondition: number,
  rng: Rng,
): WeatherCondition {
  const rawRow = matrix.transitions[currentCondition];
  if (!rawRow) {
    // Defensive — should never happen given the schema's enum constraint.
    return currentCondition;
  }

  // Apply staleness bias: reduce the "stay" probability if the condition has
  // persisted beyond the soft cap.
  const row = applyStalenessBias(rawRow, currentCondition, daysInCondition);

  // Walk the cumulative distribution. Roll a uniform [0, 1) and find the
  // first bucket whose cumulative probability exceeds the roll.
  const roll = rng.next();
  let cumulative = 0;
  for (const [nextCond, prob] of Object.entries(row)) {
    cumulative += prob;
    if (roll < cumulative) {
      return nextCond as WeatherCondition;
    }
  }
  // Floating-point drift can leave the cumulative sum at 0.999999 — fall back
  // to the last entry with non-zero probability.
  let fallback: WeatherCondition = currentCondition;
  let maxProb = -1;
  for (const [nextCond, prob] of Object.entries(row)) {
    if (prob > maxProb) {
      maxProb = prob;
      fallback = nextCond as WeatherCondition;
    }
  }
  return fallback;
}

/**
 * Apply the staleness bias to a transition row.
 *
 * If `daysInCondition` exceeds PROVISIONAL_WEATHER_MAX_DAYS_IN_CONDITION,
 * the "stay" entry (current → current) is reduced by the staleness bias
 * fraction. The residual is redistributed proportionally across the other
 * non-zero entries. If all other entries are zero (a self-loop-only row),
 * no redistribution is applied (the bias would be wasted).
 *
 * Pure: returns a new row, does not mutate the input.
 */
function applyStalenessBias(
  row: Partial<Record<WeatherCondition, number>>,
  currentCondition: WeatherCondition,
  daysInCondition: number,
): Record<WeatherCondition, number> {
  if (daysInCondition <= PROVISIONAL_WEATHER_MAX_DAYS_IN_CONDITION) {
    return normalizeRow(row);
  }
  const stayProb = row[currentCondition] ?? 0;
  if (stayProb <= 0) {
    return normalizeRow(row);
  }
  // Sum of other probabilities — what we redistribute the bias into.
  const otherSum = Object.entries(row)
    .filter(([k]) => k !== currentCondition)
    .reduce((acc, [, v]) => acc + (v ?? 0), 0);
  if (otherSum <= 0) {
    // No other transitions to redistribute into — leave the row alone.
    return normalizeRow(row);
  }
  // Reduce the stay probability by the staleness bias fraction.
  const reduction = stayProb * PROVISIONAL_WEATHER_STALENESS_BIAS;
  const newStay = Math.max(0, stayProb - reduction);
  const scale = (otherSum + reduction) / otherSum; // bump others proportionally
  const out: Record<WeatherCondition, number> = normalizeRow(row);
  out[currentCondition] = newStay;
  for (const k of Object.keys(out) as WeatherCondition[]) {
    if (k !== currentCondition) {
      out[k] = (out[k] ?? 0) * scale;
    }
  }
  return out;
}

/**
 * Normalize a partial row into a complete Record<WeatherCondition, number>
 * by filling missing entries with 0. Does not change present values.
 */
function normalizeRow(
  row: Partial<Record<WeatherCondition, number>>,
): Record<WeatherCondition, number> {
  const out = {} as Record<WeatherCondition, number>;
  for (const c of [
    'sunny',
    'cloudy',
    'rain',
    'heavy-rain',
    'drought',
    'frost',
    'heat-wave',
    'wind',
    'severe-storm',
  ] as WeatherCondition[]) {
    out[c] = row[c] ?? 0;
  }
  return out;
}
