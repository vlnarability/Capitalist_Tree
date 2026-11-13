/**
 * Progression action handlers (P9b — TDD §5.7 / §11, GDD §11 Progression and
 * Generations, §12 Player Objectives).
 *
 * Five player-facing actions live here, registered in the action dispatch
 * (`packages/simulation/src/actions/handlers.ts`) and dispatched by
 * `executeAction` via the `actionHandlers` map:
 *
 *   - `unlock-research`: spend genetic-legacy points to unlock a research
 *     node (GDD §11.2 — genetic legacy unlocks research). Delegates to the
 *     pure `unlockResearchNode`. Emits `research-unlocked`.
 *   - `activate-trait`: activate (express) a genetic trait the lineage has
 *     acquired (GDD §11.2 — modifications have trade-offs; the player toggles
 *     which are expressed). Moves a trait from `availableTraits` into
 *     `activeTraits` (or re-activates a deactivated one) with the requested
 *     magnitude (clamped to [0, 1], defaulting to
 *     PROVISIONAL_TRAIT_MAGNITUDE_DEFAULT). Emits `trait-activated`.
 *   - `deactivate-trait`: deactivate a trait (toggle it off, dropping its
 *     trade-off at the cost of its benefit). Sets the trait state's
 *     `active: false` — the trait remains acquired (genetic material preserved
 *     across the lineage — GDD §11.2). Emits `trait-deactivated`.
 *   - `prestige-reset`: establish a new generation (GDD §11.3). Delegates to
 *     the pure `applyPrestigeReset` (the progression-state-side skeleton).
 *     Emits `generation-established`. NOTE: the full play-state reset (cash /
 *     businesses / inventory / originalTree replant / trait inheritance) is
 *     P9c's scope — P9b implements the skeleton (compute potential, record
 *     history, increment generation, preserve research fraction) and the
 *     `generation-established` event still fires.
 *   - `record-historical-event`: record a historical event id against the
 *     lineage (GDD §11.3 rewards: historical records). Idempotent — a
 *     duplicate `eventId` is a no-op (mirrors P6b2's enable/disable-automation
 *     idempotency). Emits `historical-event-recorded`.
 *
 * All handlers are pure: they return a new state + events without mutating
 * the input. Deterministic given (state, action) (TDD §18.3). Genetic-legacy
 * point amounts use bigint minor-units strings (TDD §10.1).
 *
 * `originalLineageId` is NEVER modified by any progression action — GDD §11.2
 * "the original tree's lineage should remain identifiable". The
 * `originalLineageId` guard test pins this across every action.
 */
import type {
  GameState,
  SimulationEvent,
  GeneticTraitState,
  UnlockResearchAction,
  ActivateTraitAction,
  DeactivateTraitAction,
  PrestigeResetAction,
  RecordHistoricalEventAction,
} from '@capitalist-tree/shared';
import { PROVISIONAL_TRAIT_MAGNITUDE_DEFAULT } from '@capitalist-tree/shared';
import { getTraitById } from '@capitalist-tree/content';
import type { ActionListener } from '../actions/handlers.js';
import { unlockResearchNode } from './research.js';
import { applyPrestigeReset, generationDurationStatus } from './prestige.js';
import {
  UnknownTraitError,
  TraitNotAcquiredError,
  GenerationTooEarlyError,
} from './errors.js';

// ---------------------------------------------------------------------------
// unlock-research
// ---------------------------------------------------------------------------

/**
 * `unlock-research` action handler (P9b — GDD §11.2 genetic legacy unlocks
 * research).
 *
 * Delegates to the pure `unlockResearchNode(state, researchNodeId, tick)`.
 * The pure helper debits the (tier-scaled) cost from
 * `prestige.geneticLegacyPoints`, adds it to `research.totalSpent`, flips the
 * node record to `unlocked: true` / `unlockedAt: tick`, and returns the
 * `research-unlocked` event. Throws `UnknownResearchNodeError` /
 * `ResearchPrerequisitesNotMetError` / `InsufficientGeneticLegacyError` on
 * failure (the errors propagate to `executeAction` for the caller to surface).
 *
 * Idempotent path: if the node is already unlocked, `unlockResearchNode`
 * returns state unchanged with a zero-cost marker event; the handler drops
 * the event (no re-emission on a replayed unlock — TDD §18.3 idempotency).
 *
 * Pure: returns a new state + events. Deterministic given (state, action).
 */
export const unlockResearchHandler: ActionListener<UnlockResearchAction> = (
  state,
  action,
) => {
  const { researchNodeId, tick } = action.payload;
  const result = unlockResearchNode(state, researchNodeId, tick);
  // Idempotent path: if the node was already unlocked, unlockResearchNode
  // returns state unchanged with a zero-cost marker event. Narrow to the
  // research-unlocked event type to read `cost` safely off the union
  // payload, then drop the marker (no re-emission on a replayed unlock —
  // TDD §18.3 idempotency).
  if (
    result.event.type === 'research-unlocked' &&
    result.event.payload.cost === '0'
  ) {
    return { state: result.state, events: [] };
  }
  return { state: result.state, events: [result.event] };
};

// ---------------------------------------------------------------------------
// activate-trait
// ---------------------------------------------------------------------------

/**
 * `activate-trait` action handler (P9b — GDD §11.2 genetic modifications with
 * trade-offs).
 *
 *   1. Resolve the trait via `getTraitById` (content gate — unknown id throws
 *      `UnknownTraitError`).
 *   2. Locate the trait's acquisition record on `genetics.activeTraits`
 *      (already-acquired traits stay there with `active: true|false`). If the
 *      trait is not yet acquired but is in `genetics.availableTraits` (unlocked
 *      via research but not yet expressed), move it into `activeTraits` with
 *      the requested magnitude + `generation: currentGeneration`. If the trait
 *      is neither acquired nor available, throw `TraitNotAcquiredError`.
 *   3. Set `active: true` + `magnitude` (clamped to [0, 1], defaulting to
 *      PROVISIONAL_TRAIT_MAGNITUDE_DEFAULT when the payload omits it).
 *   4. Remove the trait id from `availableTraits` (it is now expressed).
 *   5. Emit `trait-activated` carrying the trait id, the magnitude, and the
 *      generation in which the trait was acquired.
 *
 * Pure: returns a new state + events. Deterministic given (state, action).
 */
export const activateTraitHandler: ActionListener<ActivateTraitAction> = (
  state,
  action,
) => {
  const { traitId, magnitude } = action.payload;
  const definition = getTraitById(traitId);
  if (!definition) {
    throw new UnknownTraitError(traitId);
  }

  const genetics = state.progression.genetics;
  const currentGeneration = state.progression.prestige.currentGeneration;
  const requestedMagnitude =
    magnitude === undefined
      ? PROVISIONAL_TRAIT_MAGNITUDE_DEFAULT
      : Math.max(0, Math.min(1, magnitude));

  const existingIndex = genetics.activeTraits.findIndex(
    (t) => t.traitId === traitId,
  );
  const isAvailable = genetics.availableTraits.includes(traitId);

  if (existingIndex < 0 && !isAvailable) {
    throw new TraitNotAcquiredError(traitId);
  }

  let newActiveTraits: GeneticTraitState[];
  let newAvailableTraits: string[];
  let acquiredGeneration: number;

  if (existingIndex >= 0) {
    // Already acquired — toggle back on / update magnitude.
    const existing = genetics.activeTraits[existingIndex]!;
    acquiredGeneration = existing.generation;
    newActiveTraits = genetics.activeTraits.map((t, i) =>
      i === existingIndex
        ? { ...t, active: true, magnitude: requestedMagnitude }
        : t,
    );
    newAvailableTraits = genetics.availableTraits;
  } else {
    // Newly expressed — move from availableTraits into activeTraits.
    acquiredGeneration = currentGeneration;
    const newRecord: GeneticTraitState = {
      traitId,
      active: true,
      generation: currentGeneration,
      magnitude: requestedMagnitude,
    };
    newActiveTraits = [...genetics.activeTraits, newRecord];
    newAvailableTraits = genetics.availableTraits.filter((id) => id !== traitId);
  }

  const next: GameState = {
    ...state,
    progression: {
      ...state.progression,
      genetics: {
        ...genetics,
        activeTraits: newActiveTraits,
        availableTraits: newAvailableTraits,
        // originalLineageId preserved verbatim (NEVER modified — GDD §11.2).
        originalLineageId: genetics.originalLineageId,
      },
    },
  };

  const event: SimulationEvent = {
    type: 'trait-activated',
    at: state.clock.elapsedSeconds,
    payload: {
      traitId,
      magnitude: requestedMagnitude,
      generation: acquiredGeneration,
    },
  };

  return { state: next, events: [event] };
};

// ---------------------------------------------------------------------------
// deactivate-trait
// ---------------------------------------------------------------------------

/**
 * `deactivate-trait` action handler (P9b — GDD §11.2 modifications have
 * trade-offs; the player toggles them off).
 *
 * Sets the trait state's `active: false` — the trait REMAINS acquired by the
 * lineage (genetic material preserved across the lineage — GDD §11.2); only
 * its expression is suspended. The trait stays in `activeTraits` with
 * `active: false` so the lineage retains the genetic material and can
 * re-express it later via `activate-trait`.
 *
 * Throws `UnknownTraitError` if the trait id is not a registered definition,
 * and `TraitNotAcquiredError` if the trait is not in `activeTraits` (it was
 * never acquired, so there is nothing to deactivate).
 *
 * Idempotent — deactivating an already-deactivated trait is a no-op (the
 * trait is already `active: false`; no event is emitted), mirroring P6b2's
 * enable/disable-automation idempotency.
 *
 * Pure: returns a new state + events. Deterministic given (state, action).
 */
export const deactivateTraitHandler: ActionListener<DeactivateTraitAction> = (
  state,
  action,
) => {
  const { traitId } = action.payload;
  const definition = getTraitById(traitId);
  if (!definition) {
    throw new UnknownTraitError(traitId);
  }

  const genetics = state.progression.genetics;
  const existingIndex = genetics.activeTraits.findIndex(
    (t) => t.traitId === traitId,
  );
  if (existingIndex < 0) {
    throw new TraitNotAcquiredError(traitId);
  }

  const existing = genetics.activeTraits[existingIndex]!;
  // Idempotent — already deactivated.
  if (!existing.active) {
    return { state, events: [] };
  }

  const newActiveTraits = genetics.activeTraits.map((t, i) =>
    i === existingIndex ? { ...t, active: false } : t,
  );

  const next: GameState = {
    ...state,
    progression: {
      ...state.progression,
      genetics: {
        ...genetics,
        activeTraits: newActiveTraits,
        // originalLineageId preserved verbatim (NEVER modified — GDD §11.2).
        originalLineageId: genetics.originalLineageId,
      },
    },
  };

  const event: SimulationEvent = {
    type: 'trait-deactivated',
    at: state.clock.elapsedSeconds,
    payload: { traitId },
  };

  return { state: next, events: [event] };
};

// ---------------------------------------------------------------------------
// prestige-reset
// ---------------------------------------------------------------------------

/**
 * `prestige-reset` action handler (P9b — GDD §11.3 Prestige is generational
 * progress, NOT a numerical reset-for-multiplier).
 *
 *   1. Verify the minimum generation duration has elapsed
 *      (`PROVISIONAL_PRESTIGE_GENERATION_MIN_DURATION_DAYS` sim days since
 *      the current generation started — rejects with `GenerationTooEarlyError`
 *      if not). Prevents instant-reset farming (GDD §17).
 *   2. Delegate to the pure `applyPrestigeReset(state, newTreeSpeciesId,
 *      tick)` for the progression-state-side skeleton: credit earned points,
 *      increment generation counters, finalise + append history entries,
 *      preserve the research fraction, preserve `originalLineageId` +
 *      `activeTraits` + `geneticLegacyPoints` + `historicalRecords`.
 *   3. Emit `generation-established` carrying the new generation number, the
 *      previous generation number, the points earned, the resulting balance,
 *      the new prestige multiplier, and the new species.
 *
 * DEFERRED TO P9c: the full play-state reset (clearing cash / accounts /
 * businesses / automation / inventory, replanting originalTree as a sapling
 * of `newTreeSpeciesId`, re-seeding the economy, trait-inheritance mechanics).
 * P9b does NOT touch the play state — the skeleton is testable in isolation,
 * and the `generation-established` event still fires so downstream systems /
 * the UI can react. The P9c reset will be atomic and will land alongside the
 * trait-inheritance design.
 *
 * Pure: returns a new state + events. Deterministic given (state, action).
 * `originalLineageId` is preserved verbatim (NEVER modified — GDD §11.2).
 */
export const prestigeResetHandler: ActionListener<PrestigeResetAction> = (
  state,
  action,
) => {
  const { newTreeSpeciesId, tick } = action.payload;
  const status = generationDurationStatus(state, tick);
  if (!status.canPrestige) {
    throw new GenerationTooEarlyError(
      state.progression.prestige.currentGeneration,
      status.daysElapsed,
      status.minDays,
    );
  }
  const result = applyPrestigeReset(state, newTreeSpeciesId, tick);
  return { state: result.state, events: [result.event] };
};

// ---------------------------------------------------------------------------
// record-historical-event
// ---------------------------------------------------------------------------

/**
 * `record-historical-event` action handler (P9b — GDD §11.3 rewards:
 * historical records; the original tree remains permanently represented in
 * the player's history).
 *
 * Appends `eventId` to `prestige.historicalRecords` (idempotent — a duplicate
 * `eventId` is a no-op, mirroring P6b2's enable/disable-automation
 * idempotency). Emits a `historical-event-recorded` event carrying the event
 * id + title + the resulting record count. The descriptive `title` /
 * `description` ride along on the event for the UI / audit log; the persisted
 * record is just the id (canonical content lookup is by id).
 *
 * Pure: returns a new state + events. Deterministic given (state, action).
 */
export const recordHistoricalEventHandler: ActionListener<
  RecordHistoricalEventAction
> = (state, action) => {
  const { eventId, title, tick } = action.payload;
  const records = state.progression.prestige.historicalRecords;

  // Idempotent — already recorded.
  if (records.includes(eventId)) {
    return { state, events: [] };
  }

  const next: GameState = {
    ...state,
    progression: {
      ...state.progression,
      prestige: {
        ...state.progression.prestige,
        historicalRecords: [...records, eventId],
      },
    },
  };

  const recordsAfter = next.progression.prestige.historicalRecords.length;
  const event: SimulationEvent = {
    type: 'historical-event-recorded',
    at: tick,
    payload: {
      eventId,
      title,
      recordsAfter,
    },
  };

  return { state: next, events: [event] };
};
