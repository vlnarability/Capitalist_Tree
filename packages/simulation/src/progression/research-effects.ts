/**
 * Research-effects aggregator (W43 — wires the previously description-only
 * research node effects into the engine).
 *
 * Pure helper used by the EventSystem (slot #12,
 * `packages/simulation/src/systems/events.ts`) to sum the typed simulation
 * bonuses of every UNLOCKED research node on the save. The EventSystem's
 * `evolveRegions` adds `biodiversityRecoveryBonus` to the per-day biodiversity
 * recovery term + `soilHealthRecoveryBonus` to the soilHealth recovery term;
 * `aggregateGlobalIndicators` adds `ecosystemResilienceBonus` to the derived
 * resilience index.
 *
 * Pre-W43 the biodiversity-enhancement + soil-restoration nodes declared
 * effects as a description-only string (`effects.description`) with a generic
 * `multiplier` no code consumed — researching them did nothing. W43 adds typed
 * `effects.bonuses` (researchBonusesSchema) + this aggregator + the EventSystem
 * consumers, so the nodes actually take effect.
 *
 * Determinism: same `state` → same result. No RNG, no clock reads. The
 * aggregator reads `state.progression.research.nodes` (the persisted unlock
 * records) + resolves each unlocked node's definition via the content registry
 * (`getResearchNodeById`) — definitions are static content, so the result is
 * fully determined by the save.
 */
import type { GameState } from '@capitalist-tree/shared';
import { getResearchNodeById } from '@capitalist-tree/content';

/**
 * Summed typed bonuses from all unlocked research nodes. Each field defaults
 * to 0 (no relevant research unlocked). The EventSystem adds these to the
 * corresponding per-tick recovery / derivation terms.
 */
export interface AggregatedResearchBonuses {
  /** Sum of `biodiversityRecoveryBonus` across unlocked nodes (GDD §10.3). */
  readonly biodiversityRecoveryBonus: number;
  /** Sum of `ecosystemResilienceBonus` across unlocked nodes (GDD §17). */
  readonly ecosystemResilienceBonus: number;
  /** Sum of `soilHealthRecoveryBonus` across unlocked nodes (GDD §10.3). */
  readonly soilHealthRecoveryBonus: number;
}

const ZERO_BONUSES: AggregatedResearchBonuses = {
  biodiversityRecoveryBonus: 0,
  ecosystemResilienceBonus: 0,
  soilHealthRecoveryBonus: 0,
};

/**
 * Sum the typed simulation bonuses of every UNLOCKED research node on the
 * save. Returns a frozen-zero object when no nodes are unlocked or when no
 * unlocked node declares typed bonuses (the common case pre-W43 + for nodes
 * that grant only unlocks / multiplier). Pure + deterministic.
 *
 * @param state - The full game state (reads `state.progression.research.nodes`).
 * @returns The summed bonuses (each field ≥ 0).
 */
export function aggregateResearchEffects(state: GameState): AggregatedResearchBonuses {
  const nodes = state.progression.research.nodes;
  if (nodes.length === 0) {
    return ZERO_BONUSES;
  }

  let biodiversityRecoveryBonus = 0;
  let ecosystemResilienceBonus = 0;
  let soilHealthRecoveryBonus = 0;

  for (const node of nodes) {
    if (!node.unlocked) {
      continue;
    }
    const definition = getResearchNodeById(node.id);
    if (definition === undefined) {
      // Unknown node id on the save (should not happen — the unlock-research
      // handler validates the id — but defensive: skip rather than throw, so
      // a content-registry change can't brick an old save).
      continue;
    }
    const bonuses = definition.effects.bonuses;
    if (bonuses === undefined) {
      // Node has no typed bonuses (only description / unlocks / multiplier).
      continue;
    }
    // `?? 0` — the content node definitions are plain TS objects (not Zod-
    // parsed at runtime), so the schema's `.default(0)` does NOT fill omitted
    // fields. A node that declares only `biodiversityRecoveryBonus` leaves
    // `soilHealthRecoveryBonus` as `undefined`; without the fallback the sum
    // would become NaN. (Saves loaded through Zod get the defaults, but the
    // engine reads the content registry directly here.)
    biodiversityRecoveryBonus += bonuses.biodiversityRecoveryBonus ?? 0;
    ecosystemResilienceBonus += bonuses.ecosystemResilienceBonus ?? 0;
    soilHealthRecoveryBonus += bonuses.soilHealthRecoveryBonus ?? 0;
  }

  return {
    biodiversityRecoveryBonus,
    ecosystemResilienceBonus,
    soilHealthRecoveryBonus,
  };
}
