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
