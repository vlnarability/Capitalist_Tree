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

/**
 * The original tree cannot be sold or transferred (GDD §16.1, §16.2; TDD §18.4,
 * TDD §21.12). Thrown by the `sell-tree` action handler when `target === 'original'`
 * (or `target === state.originalTree.id`, which is `'original'` by the schema
 * invariant).
 *
 * The schema-layer `superRefine` on `gameStateSchema` catches *persisted*
 * corruption (a save where `originalTree.isOriginal === false`); this runtime
 * error catches *action attempts* (e.g. a buggy UI dispatching a "sell"
 * action against the original tree). Together they enforce the GDD §16.1/§16.2
 * constraint at both layers.
 *
 * P3c addition (TDD §18.4 — "No accidental sale or transfer of the original
 * tree"). The error is a real `class` so callers can use `instanceof` for
 * routing (e.g. the UI shows a "You can't sell the original tree" toast
 * instead of crashing).
 */
export class OriginalTreeNotTransferableError extends Error {
  readonly treeId: string;

  constructor(treeId: string) {
    super(
      `The original tree ("${treeId}") cannot be sold or transferred (GDD §16.1, §16.2). ` +
        `The original tree is sacred — it survives generations and major game progression.`,
    );
    this.name = 'OriginalTreeNotTransferableError';
    this.treeId = treeId;
  }
}

/**
 * A `sell-tree` action targeted a non-original tree (future P8 — additional
 * trees, business-owned orchards). P3c only knows about the original tree;
 * selling non-original trees is not yet implemented. Thrown rather than
 * silently no-op'ing so the caller gets a clear signal that the action had
 * no effect (and a UI can avoid offering the option until P8 lands).
 *
 * P3c addition. P8 will replace this throw with a real sale flow that
 * transfers the tree's value to the player's cash + records a `tree-sold`
 * transaction.
 */
export class TreeSaleNotImplementedError extends Error {
  readonly treeId: string;

  constructor(treeId: string) {
    super(
      `Selling tree "${treeId}" is not implemented yet (P3c). Only the original tree ` +
        `is recognized by P3c; selling additional trees arrives in P8 (Expansion and Economy).`,
    );
    this.name = 'TreeSaleNotImplementedError';
    this.treeId = treeId;
  }
}

/**
 * The system clock rolled backwards past the offline catch-up tolerance
 * (P6a — TDD §14.4, GDD §4.2).
 *
 * Thrown by `catchUp(state, nowMs)` when `nowMs` is more than
 * `PROVISIONAL_OFFLINE_BACKWARDS_CLOCK_TOLERANCE_MS` behind
 * `state.metadata.lastSimulatedAt`. TDD §14.4: "The game should have
 * safeguards against extreme offline catch-up periods and unreasonable
 * system clock changes."
 *
 * A backwards clock could mean:
 *   - The player manually set the clock back to farm leaves offline.
 *   - A system restore from backup restored an older clock.
 *   - An NTP step backwards (rare, usually small).
 *
 * The tolerance absorbs small jitter (a few ms from `Date.now()` rounding
 * or an NTP micro-step); a larger jump is treated as tampering and the
 * processor refuses rather than silently producing a nonsense state
 * (e.g. negative elapsed time, or re-processing already-simulated
 * chunks).
 *
 * The error is a real `class` so the apps/web consumer can use
 * `instanceof` to route it to a "your clock changed — refusing to catch
 * up" toast rather than crashing. The state is NOT mutated by the
 * failed catch-up call — the consumer can still load and play from the
 * pre-catch-up save (or surface a "load anyway?" dialog).
 *
 * P6a addition (TDD §14.4).
 */
export class OfflineClockTamperedError extends Error {
  readonly lastSimulatedAt: number;
  readonly nowMs: number;
  /** How far backwards the clock moved, in ms (always > tolerance). */
  readonly backwardsMs: number;

  constructor(lastSimulatedAt: number, nowMs: number, backwardsMs: number) {
    super(
      `Offline catch-up refused: system clock moved backwards by ${backwardsMs} ms ` +
        `(lastSimulatedAt=${lastSimulatedAt}, nowMs=${nowMs}). ` +
        `This exceeds the offline catch-up tolerance — refusing to simulate ` +
        `to avoid corrupting state or re-processing already-simulated chunks. ` +
        `(GDD §4.2, TDD §14.4)`,
    );
    this.name = 'OfflineClockTamperedError';
    this.lastSimulatedAt = lastSimulatedAt;
    this.nowMs = nowMs;
    this.backwardsMs = backwardsMs;
  }
}
