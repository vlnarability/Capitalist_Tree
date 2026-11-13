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
  if (tier === 0 || PROVISIONAL_RESEARCH_COST_MULTIPLIER === 0) {
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

  const nextState: GameState = {
    ...state,
    progression: {
      ...state.progression,
      research: {
        nodes: updatedNodes,
        totalSpent: totalSpentAfter.toString(10),
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
