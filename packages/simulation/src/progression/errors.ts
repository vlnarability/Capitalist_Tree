/**
 * Typed errors for the progression module (P9b — TDD §5.7 / §11, GDD §11
 * Progression and Generations, §12 Player Objectives).
 *
 * Each error is a real `class` so callers can use `instanceof` for routing
 * (e.g. the UI surfaces "unknown research node" as a toast without crashing
 * the engine). The ProgressionSystem itself never throws for graceful failure
 * conditions — it converts them into events where applicable (e.g. a
 * throttled achievement check that finds nothing to unlock emits nothing).
 * These errors are for *programmer* mistakes or player-action rejections: an
 * `unlock-research` action referencing a node id that does not exist, a node
 * whose prerequisites are not yet unlocked, insufficient genetic-legacy
 * points, an `activate-trait` against a trait the lineage has not acquired, a
 * `prestige-reset` fired before the minimum generation duration has elapsed.
 *
 * The errors are NOT part of the saved GameState — they are runtime-only
 * signals, mirroring the business module's `business/errors.ts` + the
 * automation module's `automation/errors.ts` pattern. They live here (not in
 * `@capitalist-tree/shared`) because P9a froze the shared error surface
 * (`packages/shared/` is read-only per the P9b task contract); P9b stays in
 * the simulation package.
 *
 * @provisional — a future phase that promotes progression errors to the shared
 * package (so the web app imports them from `@capitalist-tree/shared`) would
 * move these classes verbatim. The `name` strings are part of the public
 * interface — do NOT rename.
 */

/**
 * An `unlock-research` action referenced an unknown `researchNodeId` — no
 * ResearchNodeDefinition with that id is registered in
 * `packages/content/src/progression/research/`. Thrown rather than silently
 * no-op'ing so the caller gets a clear signal (and a UI can avoid offering the
 * option until the node is registered). Mirrors `UnknownBusinessTypeError`.
 */
export class UnknownResearchNodeError extends Error {
  readonly researchNodeId: string;

  constructor(researchNodeId: string) {
    super(
      `Unknown research node "${researchNodeId}". Register the node in ` +
        `packages/content/src/progression/research/ (getResearchNodeById).`,
    );
    this.name = 'UnknownResearchNodeError';
    this.researchNodeId = researchNodeId;
  }
}

/**
 * An `unlock-research` action targeted a node whose `prerequisites` are not
 * all unlocked yet (GDD §11.2 — research is gated by prerequisite chains).
 * Thrown so the caller gets a clear signal that the prerequisite chain must be
 * completed first, rather than the engine silently spending the player's
 * genetic-legacy points on a node whose effects depend on a prerequisite.
 */
export class ResearchPrerequisitesNotMetError extends Error {
  readonly researchNodeId: string;
  readonly missingPrerequisites: readonly string[];

  constructor(
    researchNodeId: string,
    missingPrerequisites: readonly string[],
  ) {
    super(
      `Research prerequisites not met for "${researchNodeId}": ` +
        `the following prerequisite nodes are not yet unlocked [${missingPrerequisites.join(', ')}]. ` +
        `Unlock them first (GDD §11.2 — research is gated by prerequisite chains).`,
    );
    this.name = 'ResearchPrerequisitesNotMetError';
    this.researchNodeId = researchNodeId;
    this.missingPrerequisites = missingPrerequisites;
  }
}

/**
 * An `unlock-research` action would spend more genetic-legacy points than the
 * player has (GDD §11.2 — genetic legacy is the prestige currency that funds
 * research). Thrown rather than silently no-op'ping so the caller can surface
 * "not enough genetic-legacy points" to the player. Mirrors the economy
 * module's `InsufficientFundsError`.
 */
export class InsufficientGeneticLegacyError extends Error {
  readonly researchNodeId: string;
  readonly cost: string;
  readonly available: string;

  constructor(researchNodeId: string, cost: string, available: string) {
    super(
      `Insufficient genetic-legacy points to unlock "${researchNodeId}": ` +
        `cost ${cost}, available ${available}. Earn more by completing ` +
        `generations via prestige-reset (GDD §11.2 / §11.3).`,
    );
    this.name = 'InsufficientGeneticLegacyError';
    this.researchNodeId = researchNodeId;
    this.cost = cost;
    this.available = available;
  }
}

/**
 * An `activate-trait` / `deactivate-trait` action referenced an unknown
 * `traitId` — no GeneticTraitDefinition with that id is registered in
 * `packages/content/src/progression/genetics/`. Thrown so the caller gets a
 * clear signal rather than the engine silently no-op'ing. Mirrors
 * `UnknownBusinessTypeError`.
 */
export class UnknownTraitError extends Error {
  readonly traitId: string;

  constructor(traitId: string) {
    super(
      `Unknown genetic trait "${traitId}". Register the trait in ` +
        `packages/content/src/progression/genetics/ (getTraitById).`,
    );
    this.name = 'UnknownTraitError';
    this.traitId = traitId;
  }
}

/**
 * An `activate-trait` action targeted a trait the lineage has not acquired
 * (the trait is neither in `genetics.activeTraits` nor in
 * `genetics.availableTraits`). GDD §11.2 — genetic material must be unlocked
 * via research before it can be expressed. Thrown so the caller gets a clear
 * signal that the prerequisite research must be unlocked first.
 */
export class TraitNotAcquiredError extends Error {
  readonly traitId: string;

  constructor(traitId: string) {
    super(
      `Trait "${traitId}" is not acquired by the lineage. Unlock the ` +
        `prerequisite research node first (GDD §11.2 — genetic legacy ` +
        `unlocks genetic modifications), then the trait becomes available.`,
    );
    this.name = 'TraitNotAcquiredError';
    this.traitId = traitId;
  }
}

/**
 * A `prestige-reset` action was fired before the minimum generation duration
 * has elapsed (PROVISIONAL_PRESTIGE_GENERATION_MIN_DURATION_DAYS sim days
 * since the current generation started — GDD §11.3 / §17). Thrown so the
 * caller gets a clear signal that the player cannot instant-reset farm
 * genetic-legacy points. The threshold is provisional (GDD §17).
 */
export class GenerationTooEarlyError extends Error {
  readonly generationNumber: number;
  readonly daysElapsed: number;
  readonly minDays: number;

  constructor(generationNumber: number, daysElapsed: number, minDays: number) {
    super(
      `Cannot prestige-reset generation ${generationNumber}: only ` +
        `${daysElapsed} sim days have elapsed (minimum ${minDays}). ` +
        `PROVISIONAL (GDD §17) — prevents instant-reset farming.`,
    );
    this.name = 'GenerationTooEarlyError';
    this.generationNumber = generationNumber;
    this.daysElapsed = daysElapsed;
    this.minDays = minDays;
  }
}
