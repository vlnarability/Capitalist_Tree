/**
 * Research pure helpers (P9b — TDD §5.7 / §11, GDD §11.2 genetic legacy
 * unlocks research, §11.1 Expansion).
 *
 * The research tree is content-defined
 * (`packages/content/src/progression/research/`); these helpers read a
 * ResearchNodeDefinition to validate an `unlock-research` action against the
 * per-save ResearchNodeState records on `state.progression.research`.
 *
 *   - `unlockResearchNode(state, nodeId, tick)` : the pure transform — checks
 *     prerequisites (all prerequisite node ids must be unlocked), checks cost
 *     (geneticLegacyPoints >= node.cost × PROVISIONAL_RESEARCH_COST_MULTIPLIER
 *     tier scaling), debits the cost, sets the node record to
 *     `unlocked: true` / `unlockedAt: tick`, adds the cost to
 *     `research.totalSpent`. Returns `{ state, event }` (the
 *     `research-unlocked` SimulationEvent) on success; throws
 *     `UnknownResearchNodeError` / `ResearchPrerequisitesNotMetError` /
 *     `InsufficientGeneticLegacyError` on failure (matching the business
 *     pattern: typed errors propagate to `executeAction` for the caller to
 *     surface).
 *   - `getUnlockedResearch(state)` : list of unlocked node ids (used by the UI
 *     and by other systems to gate features that depend on a research node).
 *   - `isResearchUnlocked(state, nodeId)` : boolean gate (used by other
 *     systems to check whether a feature unlocked by a research node is
 *     available).
 *   - `ensureResearchNodeRecord(state, definition)` : upsert a ResearchNodeState
 *     record for a definition (copied from the definition at record-creation
 *     time so the unlock decision is self-contained on the save — TDD §18.3
 *     determinism). Used by `unlockResearchNode` and by the activate-trait
 *     flow when a trait's `availabilityRequirement` research node needs a
 *     record.
 *
 * Genetic-legacy point amounts use bigint minor-units strings (TDD §10.1 — the
 * prestige currency is tracked with the same precision discipline as money,
 * never floating point).
 *
 * Pure: every helper takes state + params and returns a new state (and events
 * where applicable) without mutating the input (TDD §4.1, §18.4). The input is
 * NEVER mutated — callers deep-copy on entry; these helpers build new objects
 * via spread.
 */
import type {
  GameState,
  ResearchNodeDefinition,
  ResearchNodeState,
  SimulationEvent,
} from '@capitalist-tree/shared';
import { PROVISIONAL_RESEARCH_COST_MULTIPLIER } from '@capitalist-tree/shared';
import { getResearchNodeById } from '@capitalist-tree/content';
import {
  UnknownResearchNodeError,
  ResearchPrerequisitesNotMetError,
  InsufficientGeneticLegacyError,
} from './errors.js';

// ---------------------------------------------------------------------------
// Local @provisional constants (GDD §17 — research tree balance)
// ---------------------------------------------------------------------------

// PROVISIONAL (GDD §17: Prestige and Generational Progression — §11.2)
//
// The cost-scaling formula documented in
// `packages/shared/src/constants/progression.ts` is
//   effectiveCost = definition.cost * (1 + tier * PROVISIONAL_RESEARCH_COST_MULTIPLIER)
// where `tier` = the node's prerequisite depth (0 for root nodes with no
// prerequisites, 1 for nodes whose prerequisites are all roots, etc.). Deeper
// research is more expensive, rewarding players who build a broad foundation
// before specializing. PROVISIONAL — tuned during playtesting.

/**
 * Compute the prerequisite-chain depth (tier) of a research node, resolving
 * prerequisites transitively against the content registry. Root nodes (no
 * prerequisites) are tier 0; a node whose prerequisites are all roots is tier
 * 1; etc. Cycles are defensively guarded by a visited-set (content should not
 * define cycles, but the resolver never infinite-loops).
 *
 * Pure: reads only the content registry.
 */
export function researchNodeTier(nodeId: string): number {
  const visited = new Set<string>();
  const depth = (id: string): number => {
    if (visited.has(id)) return 0; // defensive cycle guard
    visited.add(id);
    const def = getResearchNodeById(id);
    if (!def || def.prerequisites.length === 0) return 0;
    let max = 0;
    for (const prereq of def.prerequisites) {
      max = Math.max(max, depth(prereq) + 1);
    }
    return max;
  };
  return depth(nodeId);
}

/**
 * Compute the effective genetic-legacy cost of unlocking a research node,
 * applying the tier-scaling multiplier (GDD §17 — deeper research costs more).
 *
 *   effectiveCost = definition.cost * (1 + tier * PROVISIONAL_RESEARCH_COST_MULTIPLIER)
 *
 * Returns the cost as a bigint (genetic-legacy points are integers; the
 * definition cost is a bigint string). The multiplier is rounded to the
 * nearest integer so the debited amount is always a whole point count.
 *
 * Pure: reads only the definition + content registry.
 */
export function effectiveResearchCost(
  definition: ResearchNodeDefinition,
): bigint {
  const base = BigInt(definition.cost);
  const tier = researchNodeTier(definition.id);
  if (tier === 0) {
    // Root nodes (no prerequisites) are tier 0 → factor = 1 → no scaling.
    // (If PROVISIONAL_RESEARCH_COST_MULTIPLIER were ever 0 the formula below
    // would also yield factor = 1, so the no-scaling case is fully covered.)
    return base;
  }
  const factor = 1 + tier * PROVISIONAL_RESEARCH_COST_MULTIPLIER;
  // Round to nearest integer point (genetic-legacy points are whole).
  return BigInt(Math.max(1, Math.round(Number(base) * factor)));
}

// ---------------------------------------------------------------------------
// Record upsert
// ---------------------------------------------------------------------------

/**
 * Upsert a ResearchNodeState record for a definition, copying `categoryId`,
 * `prerequisites`, and `cost` from the definition at record-creation time so
 * the unlock decision is self-contained on the save (TDD §18.3 — the save
 * fully describes the result without re-resolving the definition). If a
 * record already exists for the node id, it is returned unchanged (the
 * definition-derived fields are NOT overwritten — they were stamped at first
 * encounter; only the `unlocked` / `unlockedAt` fields mutate later via
 * `unlockResearchNode`).
 *
 * Pure: returns a new `nodes` array (and the index of the record within it).
 */
export function ensureResearchNodeRecord(
  nodes: readonly ResearchNodeState[],
  definition: ResearchNodeDefinition,
): { nodes: ResearchNodeState[]; index: number } {
  const existingIndex = nodes.findIndex((n) => n.id === definition.id);
  if (existingIndex >= 0) {
    return { nodes: [...nodes], index: existingIndex };
  }
  const record: ResearchNodeState = {
    id: definition.id,
    categoryId: definition.category,
    unlocked: false,
    unlockedAt: 0,
    prerequisites: [...definition.prerequisites],
    cost: definition.cost,
  };
  return { nodes: [...nodes, record], index: nodes.length };
}

// ---------------------------------------------------------------------------
// Research→trait wiring (P9c — resolves P9b deferred item #6)
// ---------------------------------------------------------------------------

/**
 * The trait ids a research node's `effects.unlocks` makes available for
 * acquisition (GDD §11.2 — genetic legacy unlocks genetic modifications). A
 * node's `effects.unlocks` is an optional list of content ids (equipment /
 * business types / trait ids); only the ids prefixed `trait:` are routed to
 * `genetics.availableTraits`. Non-trait unlocks (equipment ids like
 * `'equipment:carbon-capture-unit'`, ownership ids like
 * `'ownership:corporation'`, etc.) are NOT extracted here — their wiring into
 * the equipment / business systems is a future task (R-P9-N). The
 * `unlock-research` event carries the node id; downstream systems read
 * `effects.unlocks` from the content definition for the non-trait branches.
 *
 * Pure: reads only the definition.
 */
export function extractTraitUnlocks(
  definition: ResearchNodeDefinition,
): string[] {
  const unlocks = definition.effects.unlocks;
  if (!unlocks || unlocks.length === 0) return [];
  return unlocks.filter((id) => id.startsWith('trait:'));
}

/**
 * Merge a list of trait ids into the lineage's `availableTraits`, preserving
 * insertion order and skipping ids already present (idempotent — a re-unlock
 * of a node whose traits are already available does not duplicate them).
 *
 * Pure: returns a new array.
 */
export function mergeTraitUnlocks(
  availableTraits: readonly string[],
  traitUnlocks: readonly string[],
): string[] {
  const existing = new Set(availableTraits);
  const merged = [...availableTraits];
  for (const id of traitUnlocks) {
    if (!existing.has(id)) {
      merged.push(id);
      existing.add(id);
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Queries (used by other systems + the UI to gate features)
// ---------------------------------------------------------------------------

/**
 * The list of research node ids that have been unlocked on this save
 * (`research.nodes.filter(n => n.unlocked).map(n => n.id)`). Returned in the
 * order the records appear on the save (insertion order). Pure read.
 */
export function getUnlockedResearch(state: GameState): string[] {
  return state.progression.research.nodes
    .filter((n) => n.unlocked)
    .map((n) => n.id);
}

/**
 * Boolean gate: has `nodeId` been unlocked on this save? Used by other systems
 * (biology / automation / business / environment / energy) to gate features
 * that a research node unlocks (GDD §11.2 — genetic legacy unlocks research,
 * which unlocks content + multipliers). Returns `false` for unknown node ids
 * (defensive — content may add nodes after a save was written). Pure read.
 */
export function isResearchUnlocked(state: GameState, nodeId: string): boolean {
  return state.progression.research.nodes.some(
    (n) => n.id === nodeId && n.unlocked,
  );
}

// ---------------------------------------------------------------------------
// unlockResearchNode — the pure transform
// ---------------------------------------------------------------------------

/**
 * Result of `unlockResearchNode` — a new state + the `research-unlocked`
 * SimulationEvent carrying the node id, the cost spent (effective cost, after
 * tier scaling), and the resulting genetic-legacy balance.
 */
export interface UnlockResearchResult {
  readonly state: GameState;
  readonly event: SimulationEvent;
}

/**
 * Spend genetic-legacy points to unlock a research node (GDD §11.2 — genetic
 * legacy unlocks research). The pure transform:
 *
 *   1. Resolve the node via `getResearchNodeById` (content gate — unknown id
 *      throws `UnknownResearchNodeError`).
 *   2. Upsert the node's ResearchNodeState record (so the save describes the
 *      node even before unlock — TDD §18.3).
 *   3. If the record is already `unlocked`, the call is idempotent — return
 *      the state unchanged (no double-spend) with a no-op event marker. (The
 *      action handler treats this as success without re-emitting.)
 *   4. Verify every `definition.prerequisites` research node id is already
 *      unlocked on the save (throws `ResearchPrerequisitesNotMetError` listing
 *      the missing prerequisites).
 *   5. Compute the effective cost via `effectiveResearchCost` (tier-scaled).
 *   6. Verify the player has at least the effective cost in
 *      `prestige.geneticLegacyPoints` (throws
 *      `InsufficientGeneticLegacyError`).
 *   7. Debit the cost from `geneticLegacyPoints`, add it to
 *      `research.totalSpent`, and flip the node record to `unlocked: true` /
 *      `unlockedAt: tick`.
 *   8. P9c — research→trait wiring (resolves P9b deferred item #6): the
 *      node's `effects.unlocks` trait ids (those prefixed `trait:`) are added
 *      to `genetics.availableTraits` so the lineage can acquire them via
 *      `activate-trait` (GDD §11.2). Non-trait unlocks are NOT routed here
 *      (future task R-P9-N). The idempotent path (already unlocked) does not
 *      re-add — the traits are already available.
 *
 * `tick` is the simulation second at which the unlock runs — explicit so the
 * event payload + state stamp are deterministic given (state, nodeId, tick)
 * (TDD §18.3). The returned `event` is the `research-unlocked` event; the
 * caller (the action handler) wraps it into the events array.
 *
 * Pure: returns a new state, never mutates input. Deterministic given
 * (state, nodeId, tick).
 */
export function unlockResearchNode(
  state: GameState,
  nodeId: string,
  tick: number,
): UnlockResearchResult {
  const definition = getResearchNodeById(nodeId);
  if (!definition) {
    throw new UnknownResearchNodeError(nodeId);
  }

  // Upsert the node record (self-contained save — TDD §18.3).
  const { nodes: nodesWithRecord, index: recordIndex } =
    ensureResearchNodeRecord(state.progression.research.nodes, definition);
  const record = nodesWithRecord[recordIndex]!;

  // Idempotent — already unlocked. Return state unchanged (the nodes array may
  // have gained a record if this was the first encounter, but that is a
  // read-only enrichment that does not double-spend). Emit a no-op marker
  // event so the caller can detect the idempotent path (the action handler
  // drops it).
  if (record.unlocked) {
    const nextState: GameState =
      nodesWithRecord === state.progression.research.nodes
        ? state
        : {
            ...state,
            progression: {
              ...state.progression,
              research: {
                ...state.progression.research,
                nodes: nodesWithRecord,
              },
            },
          };
    const event: SimulationEvent = {
      type: 'research-unlocked',
      at: tick,
      payload: {
        researchNodeId: nodeId,
        cost: '0',
        geneticLegacyPointsAfter:
          nextState.progression.prestige.geneticLegacyPoints,
      },
    };
    return { state: nextState, event };
  }

  // Prerequisite gate (GDD §11.2 — research is gated by prerequisite chains).
  const missing: string[] = [];
  for (const prereq of definition.prerequisites) {
    if (!isResearchUnlocked(state, prereq)) {
      missing.push(prereq);
    }
  }
  if (missing.length > 0) {
    throw new ResearchPrerequisitesNotMetError(nodeId, missing);
  }

  // Cost gate (GDD §11.2 — genetic legacy funds research).
  const cost = effectiveResearchCost(definition);
  const available = BigInt(state.progression.prestige.geneticLegacyPoints);
  if (available < cost) {
    throw new InsufficientGeneticLegacyError(
      nodeId,
      cost.toString(10),
      available.toString(10),
    );
  }

  // Debit + flip the record + add to totalSpent (bigint string arithmetic —
  // TDD §10.1 precision discipline).
  const balanceAfter = available - cost;
  const totalSpentAfter =
    BigInt(state.progression.research.totalSpent) + cost;
  const updatedNodes: ResearchNodeState[] = nodesWithRecord.map((n, i) =>
    i === recordIndex
      ? { ...n, unlocked: true, unlockedAt: tick }
      : n,
  );

  // P9c — research→trait wiring (resolves P9b deferred item #6). When a
  // research node is unlocked, its `effects.unlocks` lists the content ids
  // the node makes available. Trait ids (those prefixed `trait:`) are added
  // to `genetics.availableTraits` so the lineage can acquire them via
  // `activate-trait` (GDD §11.2 — genetic legacy unlocks genetic
  // modifications). Non-trait unlocks (equipment ids, ownership-structure
  // ids, etc.) are NOT routed here — their wiring into the equipment /
  // business systems is a future task (R-P9-N). The unlock-research event
  // already carries the node id; downstream systems read `effects.unlocks`
  // from the content definition for the non-trait branches.
  const traitUnlocks = extractTraitUnlocks(definition);
  const availableTraitsAfter =
    traitUnlocks.length === 0
      ? state.progression.genetics.availableTraits
      : mergeTraitUnlocks(
          state.progression.genetics.availableTraits,
          traitUnlocks,
        );

  const nextState: GameState = {
    ...state,
    progression: {
      ...state.progression,
      research: {
        nodes: updatedNodes,
        totalSpent: totalSpentAfter.toString(10),
      },
      genetics: {
        ...state.progression.genetics,
        availableTraits: availableTraitsAfter,
        // originalLineageId preserved verbatim (NEVER modified — GDD §11.2).
        originalLineageId: state.progression.genetics.originalLineageId,
      },
      prestige: {
        ...state.progression.prestige,
        geneticLegacyPoints: balanceAfter.toString(10),
      },
    },
  };

  const event: SimulationEvent = {
    type: 'research-unlocked',
    at: tick,
    payload: {
      researchNodeId: nodeId,
      cost: cost.toString(10),
      geneticLegacyPointsAfter: balanceAfter.toString(10),
    },
  };

  return { state: nextState, event };
}
