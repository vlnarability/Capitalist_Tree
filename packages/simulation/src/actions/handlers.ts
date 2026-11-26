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
  PlantSeedAction,
  CutDownTreeAction,
  HarvestResult,
  SimulationEvent,
  SetSpeedAction,
  TreeDamageState,
  TreeState,
  TransactionRecord,
  ApplyWaterAction,
  ApplyFertilizerAction,
  FertilizerApplicationResult,
  WaterApplicationResult,
  PurchaseAction,
  ImportCommodityAction,
  ExportCommodityAction,
} from '@capitalist-tree/shared';
import {
  PROVISIONAL_BIOLOGY_HARVEST_STRESS_PER_LEAF_FRACTION,
  PROVISIONAL_BIOLOGY_DEATH_DEFOLIATION_WINDOW_DAYS,
  PROVISIONAL_BIOLOGY_WEAR_PER_DAMAGE,
  PROVISIONAL_BIOLOGY_WEAR_DEATH_THRESHOLD,
  PROVISIONAL_RESOURCE_SOIL_WATER_CAPACITY,
  PROVISIONAL_PROGRESSION_LEGACY_POINTS_PER_SEED,
  PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
  PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
  UnknownActionError,
} from '@capitalist-tree/shared';
import type { SystemResult } from '../systems/system.js';
import {
  biologyContextFromState,
  harvestLeaves,
  computeTimberYield,
  getSpeciesOrFail,
  SEVERE_DEFOLIATION_FRACTION,
  type BiologyContext,
} from '../biology/index.js';
import { findFertilizerById } from '@capitalist-tree/content';
import { applyFertilizer, applyWaterToSoil } from '../resources/index.js';
import {
  applyPurchase,
  applyImport,
  applyExport,
  transfer,
  getBalance,
  InsufficientFundsError,
  InsufficientInventoryError,
  UnknownMarketError,
  payExpenseHandler,
  transferHandler,
  sellTreeHandler,
  performLaborHandler,
  buyToolHandler,
} from '../economy/index.js';
import {
  setAutomationPolicyHandler,
  enableAutomationHandler,
  disableAutomationHandler,
  purchaseEquipmentHandler,
} from '../automation/actions.js';
import {
  purchaseBusinessHandler,
  operateBusinessHandler,
  sellBusinessHandler,
  takeLoanHandler,
  repayLoanHandler,
  hireEmployeesHandler,
  layOffEmployeesHandler,
  setBusinessStatusHandler,
  restructureOwnershipHandler,
} from '../business/actions.js';
import { applyPlayerEnvironmentalImpact } from '../environment/player-impact.js';
import {
  unlockResearchHandler,
  activateTraitHandler,
  deactivateTraitHandler,
  prestigeResetHandler,
  recordHistoricalEventHandler,
} from '../progression/actions.js';
import { InsufficientSeedsError } from '../progression/errors.js';
import {
  scheduleEventHandler,
  cancelEventHandler,
  triggerEventHandler,
  resolveEventHandler,
  setGovernmentPolicyHandler,
  setMonetaryPolicyHandler,
  lobbyGovernmentHandler,
} from '../events/actions.js';

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
  // H2 (zero-issuance fix): a LIVE tree with no foliage (fully harvested, or a
  // deciduous tree in winter after leaf drop) has nothing to harvest. Pre-H2
  // the handler fell through to `harvestLeaves`, which computed leavesHarvested
  // = 0 + queued a `CurrencyIssuanceRequest` with amount '0'; P3's
  // `drainPendingIssuances` then rejected it (validateAmount requires > 0) +
  // emitted a noisy `issuance-rejected` event every time the player (or a bot)
  // harvested a bare tree. W47 fixed the last-leaf case (foliage === 1, fraction
  // rounds to 0); this guard closes the foliage === 0 case at the source so no
  // zero-amount issuance is ever queued. The dead-tree guard above + this one
  // together ensure `harvestLeaves` is only reached with foliage >= 1.
  if (tree.foliage.currentLeaves <= 0) {
    return {
      state: next,
      events: [
        {
          type: 'biology-notification',
          at: state.clock.elapsedSeconds,
          payload: {
            treeId: tree.id,
            severity: 'info',
            code: 'harvest-no-foliage',
            message: 'This tree has no leaves to harvest right now.',
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

  // Record a severe-defoliation damage entry if the harvest intended to remove
  // >= SEVERE_DEFOLIATION_FRACTION of foliage. We use the INTENDED fraction
  // (min(requested, maximumHarvestFraction)) — NOT the floor-rounded actual
  // leavesHarvested/foliageBefore — so that a genuine max-rate harvest on a
  // non-even foliage count (e.g. 56/112.33 = 0.4987 after Math.floor, or
  // 1500/3001 = 0.4998 on an odd integer) still registers as severe. Otherwise
  // the repeated-defoliation mortality counter under-counts + a tree harvested
  // at the maximum rate 8× can survive (TDD §21 #6 regression). The
  // leavesHarvested > 0 guard avoids recording severe for the degenerate
  // 1-leaf case where floor rounds the removal to 0.
  const fractionRemoved =
    result.foliageBefore > 0 ? result.leavesHarvested / result.foliageBefore : 0;
  const requestedFraction =
    result.foliageBefore > 0 ? action.payload.requestedLeaves / result.foliageBefore : 0;
  const intendedFraction = Math.min(requestedFraction, ctx.species.maximumHarvestFraction);
  const effectiveFraction = Math.max(fractionRemoved, intendedFraction);
  const isSevere =
    result.leavesHarvested > 0 && intendedFraction >= SEVERE_DEFOLIATION_FRACTION;
  const damage: TreeDamageState[] = [...tree.damage];
  if (isSevere) {
    const sev = Math.min(1, effectiveFraction);
    damage.push({
      type: 'severe-defoliation',
      severity: sev,
      appliedAt: state.clock.elapsedSeconds,
    });
    // P12-C redesign: over-pruning/over-harvesting is a neglect signal —
    // accumulate the severe-defoliation severity into the monotonic wear
    // counter (drives the chronic-neglect mortality path in death.ts).
    tree.wear += sev * PROVISIONAL_BIOLOGY_WEAR_PER_DAMAGE;
  }
  tree.damage = damage;

  // Queue the CurrencyIssuanceRequest for P3's EconomySystem to drain.
  // P1 does NOT credit the player's cash here — that's P3's job, after
  // applying monetary authority policy (issuance limits, inflation, etc.).
  //
  // W47 (last-leaf harvest fix): skip queuing when nothing was harvested.
  // Pre-W47 a 0-leaf harvest (the floor-rounded fraction trap on foliage===1,
  // or a requestedLeaves===0 edge case) still queued an issuance with
  // amount '0', which the monetary authority later rejected with the scary
  // "Issuance amount '0' is not a valid positive bigint string" error. With
  // the harvest.ts maxByFraction fix the 1-leaf case now harvests 1, but this
  // guard remains as defense-in-depth: no issuance request unless real leaves
  // were harvested.
  if (result.leavesHarvested > 0) {
    tree.pendingIssuances = [...tree.pendingIssuances, result.currencyIssuance];
  }

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
  if (isSevere) {
    // Count prior severe defoliations within the window to flag "repeated".
    const windowSeconds =
      PROVISIONAL_BIOLOGY_DEATH_DEFOLIATION_WINDOW_DAYS * 24 * 60 * 60;
    const cutoff = state.clock.elapsedSeconds - windowSeconds;
    const priorCount = tree.damage.filter(
      (d) => d.type === 'severe-defoliation' && d.appliedAt < state.clock.elapsedSeconds && d.appliedAt >= cutoff,
    ).length;
    events.push({
      type: 'defoliation',
      at: state.clock.elapsedSeconds,
      payload: {
        treeId: tree.id,
        fractionRemoved: effectiveFraction,
        repeated: priorCount >= 1,
      },
    });
  }

  // Reference the stress constant to ensure the import is used (for future
  // per-leaf tuning — the actual stress computation lives in harvestLeaves).
  void PROVISIONAL_BIOLOGY_HARVEST_STRESS_PER_LEAF_FRACTION;

  // P11 (W6 / RV4-F-H3): harvesting leaves is a light extraction — it nudges
  // the home region's industrialActivity (the player is harvesting the tree's
  // production) and slightly reduces forestCoverage (canopy thinning). The
  // impact is small per-leaf so casual harvesting is sustainable, but
  // aggressive harvesting contributes to regional deforestation pressure.
  const leavesHarvested = action.payload.requestedLeaves ?? 1;
  const withRegionalImpact = applyPlayerEnvironmentalImpact(next, {
    carbonEmissions: 0,
    waterConsumption: 0,
    soilDegradation: 0,
    pollution: 0.002 * leavesHarvested,
    landDisturbance: 0.003 * leavesHarvested,
    biodiversityImpact: 0.001 * leavesHarvested,
  });

  return { state: withRegionalImpact, events };
};

/**
 * `plant-seed` action handler (GAP-19 / GDD §11.2 — Genetic Legacy: the seed
 * production → planting loop). Consumes ONE seed from the tree's `seeds`
 * accumulator + credits `PROVISIONAL_PROGRESSION_LEGACY_POINTS_PER_SEED`
 * genetic-legacy points to `prestige.geneticLegacyPoints` (the prestige currency
 * that funds `unlock-research`). A mid-generation earning mechanism that
 * supplements the generation-end prestige bonus — gives the player a reason to
 * accumulate + plant seeds between prestige resets.
 *
 *   1. Resolves the tree (P1: only the original tree — rejects if `treeId`
 *      doesn't match `originalTree.id`).
 *   2. Verifies `tree.seeds >= 1` (rejects with `InsufficientSeedsError` if 0 —
 *      the tree has produced no seeds to plant yet).
 *   3. Decrements `tree.seeds` by 1.
 *   4. Credits the per-seed points to `geneticLegacyPoints` (bigint string
 *      arithmetic — TDD §10.1, same precision discipline as unlock-research).
 *   5. Emits a `seed-planted` event carrying the seeds consumed, the seeds
 *      remaining, the points gained, + the resulting balance.
 *
 * A dead tree's stored seeds remain plantable (the genetic legacy persists after
 * death — GDD §16.3: tree death does not end the game; the lineage continues).
 *
 * Pure: returns a new state + events. Deterministic given (state, action).
 */
const plantSeedHandler: ActionListener<PlantSeedAction> = (state, action) => {
  const next: GameState = {
    ...state,
    originalTree: { ...state.originalTree },
    progression: {
      ...state.progression,
      prestige: { ...state.progression.prestige },
    },
  };
  const tree = next.originalTree as TreeState;

  // Resolve the tree (P1: only the original tree can plant a seed).
  if (action.payload.treeId !== tree.id) {
    throw new Error(
      `plant-seed: unknown treeId "${action.payload.treeId}". P1 only supports the original tree ("${tree.id}").`,
    );
  }
  // Gate: the tree must have produced at least one seed (the BiologySystem
  // seed-dispersed flow, fed by alloc.reproduction, gated on the fruiting age).
  if (tree.seeds < 1) {
    throw new InsufficientSeedsError(tree.id, tree.seeds);
  }

  // Consume one seed + credit the per-seed genetic-legacy points (bigint string
  // arithmetic — TDD §10.1). The points fund unlock-research (GDD §11.2).
  const seedsRemaining = tree.seeds - 1;
  tree.seeds = seedsRemaining;
  const gained = PROVISIONAL_PROGRESSION_LEGACY_POINTS_PER_SEED;
  const balanceAfter = BigInt(next.progression.prestige.geneticLegacyPoints) + BigInt(gained);
  next.progression.prestige.geneticLegacyPoints = balanceAfter.toString(10);

  const event: SimulationEvent = {
    type: 'seed-planted',
    at: action.payload.tick,
    payload: {
      treeId: tree.id,
      seedsConsumed: 1,
      seedsRemaining,
      legacyPointsGained: gained,
      geneticLegacyPointsAfter: next.progression.prestige.geneticLegacyPoints,
    },
  };
  return { state: next, events: [event] };
};

/**
 * `apply-water` action handler (P2 — TDD §8.1).
 *
 * Adds water to the soil water pool (capped at soil water capacity; excess
 * becomes runoff). P2 only mutates the soil water state — it does NOT touch
 * the player's cash (P3's EconomySystem will handle the purchase transaction
 * when the irrigation action is wired into the economy).
 *
 * Emits a `water-applied` event carrying the full WaterApplicationResult.
 *
 * Invariants enforced by the pure `applyWaterToSoil` function:
 *   - soilWaterAfter >= 0
 *   - soilWaterAfter <= PROVISIONAL_RESOURCE_SOIL_WATER_CAPACITY
 *   - runoff = max(0, soilWaterBefore + litres - capacity)
 *   - No negative water additions (litres >= 0 enforced by the schema).
 */
const applyWaterHandler: ActionListener<ApplyWaterAction> = (state, action) => {
  const next: GameState = {
    ...state,
    world: {
      ...state.world,
      environment: {
        ...state.world.environment,
        soil: { ...state.world.environment.soil },
      },
    },
  };
  const soil = next.world.environment.soil;

  const result: WaterApplicationResult = applyWaterToSoil(
    soil.soilWater,
    action.payload.litres,
    PROVISIONAL_RESOURCE_SOIL_WATER_CAPACITY,
    state.clock.elapsedSeconds,
  );
  soil.soilWater = result.soilWaterAfter;

  const events: SimulationEvent[] = [
    {
      type: 'water-applied',
      at: state.clock.elapsedSeconds,
      payload: result,
    },
  ];

  return { state: next, events };
};

/**
 * `apply-fertilizer` action handler (P2 — TDD §8.2, §8.3).
 *
 * Applies NPK to the soil nutrient pool (capped at soil nutrient capacity;
 * excess converts to contamination per GDD §8.3 over-application harm).
 * Adds organic matter if the fertilizer has any. P2 only mutates the soil
 * state — it does NOT touch the player's cash or inventory (P3 will handle
 * the purchase + inventory deduction when the action is wired into the
 * economy).
 *
 * Emits a `fertilizer-applied` event carrying the full FertilizerApplicationResult.
 *
 * Invariants enforced by the pure `applyFertilizer` function:
 *   - nutrientsAfter <= PROVISIONAL_RESOURCE_SOIL_NUTRIENT_CAPACITY (per nutrient)
 *   - contaminationAfter >= contaminationBefore
 *   - nutrientsAdded = nutrientsAfter - nutrientsBefore (no free nutrients)
 */
const applyFertilizerHandler: ActionListener<ApplyFertilizerAction> = (state, action) => {
  const fertilizer = findFertilizerById(action.payload.fertilizerId);
  if (!fertilizer) {
    throw new Error(
      `apply-fertilizer: unknown fertilizer id "${action.payload.fertilizerId}". ` +
        `Register the fertilizer in packages/content/src/fertilizers/index.ts.`,
    );
  }

  const next: GameState = {
    ...state,
    world: {
      ...state.world,
      environment: {
        ...state.world.environment,
        soil: { ...state.world.environment.soil },
      },
    },
  };
  const soil = next.world.environment.soil;

  const result: FertilizerApplicationResult = applyFertilizer(
    next.world.environment,
    fertilizer,
    action.payload.units,
    state.clock.elapsedSeconds,
  );

  // Apply the result to the soil state.
  soil.nutrients = { ...result.nutrientsAfter };
  soil.contamination = result.contaminationAfter;
  soil.organicMatter = Math.max(0, soil.organicMatter + result.organicMatterAdded);

  const events: SimulationEvent[] = [
    {
      type: 'fertilizer-applied',
      at: state.clock.elapsedSeconds,
      payload: result,
    },
  ];

  return { state: next, events };
};

/**
 * `purchase` action handler (P3b — TDD §10.5, §10.6, GDD §8.5).
 *
 * Player buys `quantity` units of a commodity from a market. Cash flows
 * from `player:personal` to `market:<id>` via P3a's `transfer()` (category
 * `'purchase'`). Inventory is credited with
 * `{ resourceId: market.commodityId, quantity }` (incrementing if the
 * resource is already in inventory). Market supply is drawn down by
 * `quantity`; market demand is bumped by `quantity` (the active-buyer
 * signal that will raise prices on the next EconomySystem tick).
 *
 * Invariants enforced by the pure `applyPurchase` function:
 *   - Market exists (throws `UnknownMarketError` otherwise).
 *   - Player has sufficient funds (throws `InsufficientFundsError`
 *     otherwise — the underlying `transfer()` enforces this).
 *   - Transaction recorded with category `'purchase'` and the correct
 *     source/destination accounts.
 *   - Money never silently created or destroyed — the transfer is a
 *     real-account-to-real-account transfer; conservation invariant holds.
 *
 * Emits a `transaction-recorded` event (carried from `transfer()`) plus a
 * `purchase-completed` event carrying the full result (unit price, total
 * cost, post-purchase market snapshot, resulting player balance).
 */
const purchaseHandler: ActionListener<PurchaseAction> = (state, action) => {
  const result = applyPurchase(state, {
    marketId: action.payload.marketId,
    quantity: action.payload.quantity,
    timestamp: state.clock.elapsedSeconds,
  });
  return { state: result.state, events: result.events };
};

// P13-B / GAP-24: import-commodity — buy from the foreign market at the
// domestic price + a tariff surcharge (base → external:default, tariff → authority).
const importCommodityHandler: ActionListener<ImportCommodityAction> = (state, action) => {
  const result = applyImport(state, {
    marketId: action.payload.marketId,
    quantity: action.payload.quantity,
    timestamp: state.clock.elapsedSeconds,
  });
  return { state: result.state, events: result.events };
};

// P13-B / GAP-24: export-commodity — sell inventory abroad at the domestic
// price; revenue issued from the authority (mint) → player (foreign buyer pays
// into the domestic economy). Inventory debited.
const exportCommodityHandler: ActionListener<ExportCommodityAction> = (state, action) => {
  const result = applyExport(state, {
    marketId: action.payload.marketId,
    quantity: action.payload.quantity,
    timestamp: state.clock.elapsedSeconds,
  });
  return { state: result.state, events: result.events };
};

// Re-export the typed errors so the action layer (or a UI) can catch them.
// The errors are NOT part of the saved GameState — they are runtime-only
// signals. The handler above lets them propagate to `executeAction`, which
// surfaces them as exceptions for the engine caller to handle (P3c may
// wrap them into `notification` events for the UI).
export { InsufficientFundsError, InsufficientInventoryError, UnknownMarketError };

/**
 * `cut-down-tree` handler (W-axe — player fells the original tree for timber).
 *
 * Requires axe ownership (gated on `state.inventory.items` containing
 * `tool:axe`). Kills the tree (alive=false, stress=1, health=0, wear past the
 * death threshold, foliage cleared, + an `axed` damage entry), maxes
 * exploitation (trashes the home region's environment via
 * `applyPlayerEnvironmentalImpact` — the codebase has no `exploitation` field,
 * so the regional industrialActivity spike + forest/biodiversity/soil crater
 * is the visible "max exploitation" signal), then sells the wood in one shot
 * (authority → player:personal issuance, category `'timber'`). The axe is NOT
 * consumed (reusable across generations).
 *
 * Graceful-rejects (no throw) if the tree is already dead or the player owns
 * no axe — matches the harvest-dead-tree / pay-expense no-throw pattern.
 */
const cutDownTreeHandler: ActionListener<CutDownTreeAction> = (state, action) => {
  const timestamp = action.payload.tick;

  // Resolve the tree (only the original tree is fellable).
  if (action.payload.treeId !== state.originalTree.id) {
    throw new Error(
      `cut-down-tree: unknown treeId "${action.payload.treeId}". Only the original tree ("${state.originalTree.id}") is fellable.`,
    );
  }

  // Guard 1: already dead — a stump has no merchantable wood.
  if (!state.originalTree.alive) {
    return {
      state,
      events: [
        {
          type: 'play-sound',
          at: timestamp,
          payload: { soundId: 'sfx:error' },
        },
        {
          type: 'biology-notification',
          at: timestamp,
          payload: {
            treeId: state.originalTree.id,
            severity: 'warning',
            code: 'cut-dead-tree',
            message: 'The tree is already dead — nothing to fell.',
          },
        },
      ],
    };
  }

  // Guard 2: no axe — the player must own one to cut.
  const hasAxe = state.inventory.items.some(
    (i) => i.resourceId === 'tool:axe' && i.quantity > 0,
  );
  if (!hasAxe) {
    return {
      state,
      events: [
        {
          type: 'play-sound',
          at: timestamp,
          payload: { soundId: 'sfx:error' },
        },
        {
          type: 'biology-notification',
          at: timestamp,
          payload: {
            treeId: state.originalTree.id,
            severity: 'warning',
            code: 'no-axe',
            message: 'You need an axe to cut down the tree. Buy one with the buy-tool action.',
          },
        },
      ],
    };
  }

  // Compute the timber yield BEFORE mutating (biomassScore × quality × value).
  const tree = state.originalTree;
  const species = getSpeciesOrFail(tree.speciesId);
  const timber = computeTimberYield(tree, species);

  // Kill the tree: alive=false, stress=1, health=0, wear past the death
  // threshold (so checkMortality agrees the tree is dead), foliage cleared,
  // + a damage entry recording the axe.
  const killedTree: TreeState = {
    ...tree,
    alive: false,
    stress: 1,
    health: 0,
    wear: Math.max(tree.wear, PROVISIONAL_BIOLOGY_WEAR_DEATH_THRESHOLD + 1),
    foliage: { ...tree.foliage, currentLeaves: 0 },
    damage: [
      ...tree.damage,
      { type: 'axed', severity: 1, appliedAt: timestamp } as TreeDamageState,
    ],
  };

  // Max exploitation: trash the home region's environment (visible to the
  // DR-1 recovery tests). applyPlayerEnvironmentalImpact scales + writes to
  // the home region's industrialActivity / pollution / forestCoverage / etc.
  const maxImpact = {
    carbonEmissions: 1.0,
    waterConsumption: 0.5,
    soilDegradation: 1.0,
    pollution: 1.0,
    landDisturbance: 1.0,
    biodiversityImpact: 1.0,
  };
  let next = applyPlayerEnvironmentalImpact(
    { ...state, originalTree: killedTree },
    maxImpact,
  );

  const events: SimulationEvent[] = [];
  // W68: play the notify chime for a successful cut.
  events.push({ type: 'play-sound', at: timestamp, payload: { soundId: 'sfx:notify' } });

  // Sell the wood: authority → player:personal (issuance — money enters
  // circulation). The dead tree won't tick to drain a queued issuance, so a
  // direct transfer (not pendingIssuances) is the right path. Skip the
  // transfer if the yield is 0 (a sapling has no merchantable wood) —
  // transfer() rejects amount=0.
  let playerBalanceAfter = getBalance(next, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID);
  if (timber.amountMinor !== '0') {
    const requestId = `timber:${state.metadata.saveId}:${timestamp}:${tree.id}`;
    next = transfer(next, {
      sourceAccount: PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
      destinationAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
      amount: timber.amountMinor,
      category: 'timber',
      description: `Timber sale: felled ${tree.speciesId} (${timber.woodUnits.toFixed(2)} biomass units, quality ${timber.qualityFactor.toFixed(2)})`,
      timestamp,
      requestId,
    });
    const transaction: TransactionRecord =
      next.economy.transactions[next.economy.transactions.length - 1]!;
    playerBalanceAfter = getBalance(next, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID);
    events.push({
      type: 'transaction-recorded',
      at: timestamp,
      payload: { record: transaction },
    });
  }
  next = {
    ...next,
    player: { ...next.player, personalCash: playerBalanceAfter.toString(10) },
  };

  events.push({
    type: 'biology-notification',
    at: timestamp,
    payload: {
      treeId: tree.id,
      severity: 'info',
      code: 'tree-cut-down',
      message:
        timber.amountMinor === '0'
          ? 'Felled the tree, but it had no merchantable wood (too young). The tree is dead; exploitation maxed.'
          : `Felled the tree for timber. Yield: ${(Number(timber.amountMinor) / 100).toFixed(2)} currency. The tree is dead; exploitation maxed.`,
    },
  });

  return { state: next, events };
};

export const actionHandlers: Record<string, ActionListener> = {
  'no-op': noOp,
  'set-speed': setSpeed as ActionListener,
  'harvest-leaves': harvestLeavesHandler as ActionListener,
  'plant-seed': plantSeedHandler as ActionListener,
  'cut-down-tree': cutDownTreeHandler as ActionListener,
  'apply-water': applyWaterHandler as ActionListener,
  'apply-fertilizer': applyFertilizerHandler as ActionListener,
  'purchase': purchaseHandler as ActionListener,
  'buy-tool': buyToolHandler as ActionListener,
  'import-commodity': importCommodityHandler as ActionListener,
  'export-commodity': exportCommodityHandler as ActionListener,
  'pay-expense': payExpenseHandler as ActionListener,
  'transfer': transferHandler as ActionListener,
  'sell-tree': sellTreeHandler as ActionListener,
  'perform-labor': performLaborHandler as ActionListener,
  'set-automation-policy': setAutomationPolicyHandler as ActionListener,
  'enable-automation': enableAutomationHandler as ActionListener,
  'disable-automation': disableAutomationHandler as ActionListener,
  'purchase-equipment': purchaseEquipmentHandler as ActionListener,
  // P8b: business actions (TDD §5.7 / §11, GDD §8).
  'purchase-business': purchaseBusinessHandler as ActionListener,
  'operate-business': operateBusinessHandler as ActionListener,
  'sell-business': sellBusinessHandler as ActionListener,
  'take-loan': takeLoanHandler as ActionListener,
  'repay-loan': repayLoanHandler as ActionListener,
  'hire-employees': hireEmployeesHandler as ActionListener,
  'lay-off-employees': layOffEmployeesHandler as ActionListener,
  'set-business-status': setBusinessStatusHandler as ActionListener,
  'restructure-ownership': restructureOwnershipHandler as ActionListener,
  // P9b: progression actions (TDD §5.7 / §11, GDD §11 / §12).
  'unlock-research': unlockResearchHandler as ActionListener,
  'activate-trait': activateTraitHandler as ActionListener,
  'deactivate-trait': deactivateTraitHandler as ActionListener,
  'prestige-reset': prestigeResetHandler as ActionListener,
  'record-historical-event': recordHistoricalEventHandler as ActionListener,
  // P10b: EventSystem actions (TDD §6.4, GDD §10 / §148-152 / §404-408).
  'schedule-event': scheduleEventHandler as ActionListener,
  'cancel-event': cancelEventHandler as ActionListener,
  'trigger-event': triggerEventHandler as ActionListener,
  'resolve-event': resolveEventHandler as ActionListener,
  'set-government-policy': setGovernmentPolicyHandler as ActionListener,
  'lobby-government': lobbyGovernmentHandler as ActionListener,
  'set-monetary-policy': setMonetaryPolicyHandler as ActionListener,
};

/** Dispatch a GameAction to its handler. Raises UnknownActionError for unknown types. */
export function dispatch(state: GameState, action: GameAction): SystemResult {
  const handler = actionHandlers[action.type];
  if (!handler) {
    throw new UnknownActionError(action.type);
  }
  return handler(state, action);
}
