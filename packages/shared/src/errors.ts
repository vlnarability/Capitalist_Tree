/**
 * Typed errors used across shared, simulation, and the web app.
 *
 * Each error is a real `class` so callers can use `instanceof` for routing
 * (e.g. surface "unknown schema version" to the user without silently
 * discarding the save).
 */

/** A save's schemaVersion is not registered in the migration registry. */
export class UnknownSchemaVersionError extends Error {
  readonly actual: number;
  readonly known: readonly number[];

  constructor(actual: number, known: readonly number[]) {
    super(
      `Unknown save schemaVersion ${actual}. Known versions: ${known.join(', ')}. ` +
        `Refusing to silently discard the save — register a migration or upgrade the game.`,
    );
    this.name = 'UnknownSchemaVersionError';
    this.actual = actual;
    this.known = known;
  }
}

/** A save failed Zod validation. Wraps the underlying ZodError. */
export class SaveValidationError extends Error {
  readonly issues: readonly unknown[];

  constructor(message: string, issues: readonly unknown[]) {
    super(message);
    this.name = 'SaveValidationError';
    this.issues = issues;
  }
}

/** A GameAction with an unknown `type` was passed to executeAction. */
export class UnknownActionError extends Error {
  readonly actionType: string;

  constructor(actionType: string) {
    super(
      `Unknown GameAction type "${actionType}". P1/P3 should extend the GameAction union in @capitalist-tree/shared.`,
    );
    this.name = 'UnknownActionError';
    this.actionType = actionType;
  }
}

/** Generic invariant violation raised by the engine or a system. */
export class SimulationInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SimulationInvariantError';
  }
}
