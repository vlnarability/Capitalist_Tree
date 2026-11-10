/**
 * GameAction handlers.
 *
 * `executeAction(state, action)` dispatches here based on `action.type`.
 * Each handler is pure: it returns a new state (and optionally events)
 * without mutating the input.
 *
 * HOW TO ADD A NEW ACTION (P1/P3):
 *   1. Add a new variant to `gameActionSchema` in
 *      `packages/shared/src/schemas/actions.ts`.
 *   2. Add a handler function here.
 *   3. Register the handler in `actionHandlers` below.
 *   4. `executeAction` automatically routes by `action.type`.
 */
import type {
  CurrencyIssuanceRequest,
  GameState,
  GameAction,
  HarvestLeavesAction,
  HarvestResult,
  SimulationEvent,
  SetSpeedAction,
  TreeDamageState,
  TreeState,
} from '@capitalist-tree/shared';
import {
  PROVISIONAL_BIOLOGY_HARVEST_STRESS_PER_LEAF_FRACTION,
  UnknownActionError,
} from '@capitalist-tree/shared';
import type { SystemResult } from '../systems/system.js';
import {
  biologyContextFromState,
  harvestLeaves,
  getSpeciesOrFail,
  SEVERE_DEFOLIATION_FRACTION,
  type BiologyContext,
} from '../biology/index.js';

export type ActionListener<A extends GameAction = GameAction> = (
  state: GameState,
  action: A,
) => SystemResult;

const noOp: ActionListener = (state) => ({ state, events: [] });

const setSpeed: ActionListener<SetSpeedAction> = (state, action) => {
  const next: GameState = {
    ...state,
    clock: {
      ...state.clock,
      speedMultiplier: action.payload.multiplier,
    },
  };
  const events: SimulationEvent[] = [
    {
      type: 'system',
      at: state.clock.elapsedSeconds,
      payload: {
        systemId: 'ActionProcessor',
        message: `Speed set to ${action.payload.multiplier}x`,
      },
    },
  ];
  return { state: next, events };
};

/**
 * `harvest-leaves` action handler (P1 — TDD §7.5).
 *
 * Calls the pure `harvestLeaves` biology function, applies the result to the
 * tree's state (foliage reduction, stress, damage record if severe), queues
 * the `CurrencyIssuanceRequest` on `tree.pendingIssuances` for P3's
 * EconomySystem to drain, and emits a `harvest-completed` SimulationEvent
 * carrying the full `HarvestResult`.
 *
 * Emits a `defoliation` event when >= 50% of pre-harvest foliage is removed in
 * a single action — used by the mortality check (repeated severe defoliations
 * raise death risk).
 *
 * Invariants enforced by the pure `harvestLeaves` function:
 *   - leavesHarvested <= foliageBefore * species.maximumHarvestFraction
 *   - foliageAfter === foliageBefore - leavesHarvested
 *   - No negative leaf counts (TDD §18.4).
 *   - Currency issuance is exactly leavesHarvested * species.leafDenominationMinor.
 *
 * P1 does NOT mutate `state.economy` directly — it queues the issuance for P3.
 */
const harvestLeavesHandler: ActionListener<HarvestLeavesAction> = (state, action) => {
  const next: GameState = {
    ...state,
    originalTree: { ...state.originalTree },
  };
  const tree = next.originalTree as TreeState;

  // Resolve the tree (P1: only the original tree is harvestable).
  if (action.payload.treeId !== tree.id) {
    throw new Error(
      `harvest-leaves: unknown treeId "${action.payload.treeId}". P1 only supports the original tree ("${tree.id}").`,
    );
  }
  // GDD §16.3: tree death does not end the game, but a dead tree has no leaves
  // to harvest. The pure function caps to 0 leaves harvested in that case.
  if (!tree.alive) {
    return {
      state: next,
      events: [
        {
          type: 'biology-notification',
          at: state.clock.elapsedSeconds,
          payload: {
            treeId: tree.id,
            severity: 'warning',
            code: 'harvest-dead-tree',
            message: 'Cannot harvest leaves from a dead tree.',
          },
        },
      ],
    };
  }

  const species = getSpeciesOrFail(tree.speciesId);
  // Actions execute between steps — stepSeconds/stepDays = 0.
  const ctx: BiologyContext = biologyContextFromState(
    next,
    state.clock.elapsedSeconds,
    0,
    0,
    species,
  );

  // Determine the currency id from the economy's default market.
  const currencyId =
    next.economy.markets.find((m) => m.commodityId.startsWith('currency:'))?.commodityId ??
    'currency:leaf-dollar';

  const result: HarvestResult = harvestLeaves(
    tree,
    ctx,
    action.payload.requestedLeaves,
    state.clock.elapsedSeconds,
    currencyId,
  );

  // Apply the harvest result to the tree's foliage.
  tree.foliage = {
    ...tree.foliage,
    currentLeaves: result.foliageAfter,
    activeLeafArea: result.activeLeafAreaAfter,
  };

  // Apply immediate stress (GDD §5.4: harvesting induces stress).
  tree.stress = Math.min(1, tree.stress + result.stressInduced);

  // Record a severe-defoliation damage entry if >= 50% of foliage was removed.
  // The BiologySystem prunes old damage records and counts these for mortality.
  const fractionRemoved =
    result.foliageBefore > 0 ? result.leavesHarvested / result.foliageBefore : 0;
  const damage: TreeDamageState[] = [...tree.damage];
  if (fractionRemoved >= SEVERE_DEFOLIATION_FRACTION) {
    damage.push({
      type: 'severe-defoliation',
      severity: Math.min(1, fractionRemoved),
      appliedAt: state.clock.elapsedSeconds,
    });
  }
  tree.damage = damage;

  // Queue the CurrencyIssuanceRequest for P3's EconomySystem to drain.
  // P1 does NOT credit the player's cash here — that's P3's job, after
  // applying monetary authority policy (issuance limits, inflation, etc.).
  const issuance: CurrencyIssuanceRequest = result.currencyIssuance;
  tree.pendingIssuances = [...tree.pendingIssuances, issuance];

  // Build the events.
  const events: SimulationEvent[] = [
    {
      type: 'harvest-completed',
      at: state.clock.elapsedSeconds,
      payload: {
        treeId: tree.id,
        result,
      },
    },
  ];
  if (fractionRemoved >= SEVERE_DEFOLIATION_FRACTION) {
    // Count prior severe defoliations within the window to flag "repeated".
    const windowSeconds =
      60 * 24 * 60 * 60; // PROVISIONAL_BIOLOGY_DEATH_DEFOLIATION_WINDOW_DAYS days in seconds.
    const cutoff = state.clock.elapsedSeconds - windowSeconds;
    const priorCount = tree.damage.filter(
      (d) => d.type === 'severe-defoliation' && d.appliedAt < state.clock.elapsedSeconds && d.appliedAt >= cutoff,
    ).length;
    events.push({
      type: 'defoliation',
      at: state.clock.elapsedSeconds,
      payload: {
        treeId: tree.id,
        fractionRemoved,
        repeated: priorCount >= 1,
      },
    });
  }

  // Reference the stress constant to ensure the import is used (for future
  // per-leaf tuning — the actual stress computation lives in harvestLeaves).
  void PROVISIONAL_BIOLOGY_HARVEST_STRESS_PER_LEAF_FRACTION;

  return { state: next, events };
};

export const actionHandlers: Record<string, ActionListener> = {
  'no-op': noOp,
  'set-speed': setSpeed as ActionListener,
  'harvest-leaves': harvestLeavesHandler as ActionListener,
};

/** Dispatch a GameAction to its handler. Raises UnknownActionError for unknown types. */
export function dispatch(state: GameState, action: GameAction): SystemResult {
  const handler = actionHandlers[action.type];
  if (!handler) {
    throw new UnknownActionError(action.type);
  }
  return handler(state, action);
}
