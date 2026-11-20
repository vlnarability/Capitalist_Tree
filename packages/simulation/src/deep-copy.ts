/**
 * Deep-copy helper. Used by `SimulationEngine.advance` and `executeAction` to
 * guarantee non-mutation of input state (TDD §4.1: "pure state transformation").
 *
 * We prefer `structuredClone` (built into Node 24 and modern browsers) and
 * fall back to a JSON-based copy if unavailable. The GameState contains only
 * JSON-serializable values (bigints are stored as strings), so JSON fallback
 * is safe.
 */
export function deepCopy<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Keep only the most recent (tail) `maxItems` entries of an array.
 *
 * P11 (W12 / RV5-F2): used to bound `economy.transactions`,
 * `economy.processedRequestIds`, and `eventState.scheduler.history` so a
 * long-running game doesn't accumulate millions of entries (save bloat +
 * slow load). Returns the array unchanged if it's within the cap; otherwise
 * returns a new array with only the last `maxItems` entries.
 *
 * Pure: never mutates the input. Returns the SAME reference when no pruning
 * is needed (so callers that check reference equality aren't false-triggered).
 */
export function capTail<T>(arr: T[], maxItems: number): T[] {
  if (arr.length <= maxItems) return arr;
  return arr.slice(arr.length - maxItems);
}
