/**
 * Player → regional environmental bridge (P11 W6 / RV4-F-H3).
 *
 * Pre-W6, player actions (harvest, operate-business, purchase-equipment)
 * had NO pathway into the P10 regional model — `eventState.global.regions`
 * only moved via stochastic events in `evolveRegions`. The `industrialActivity`
 * lever (the sole driver of pollution accumulation, which in turn drives
 * soil/water/forest/biodiversity decline) was never written by anything.
 * This left the player decoupled from regional state (RV4-F-H3) and made the
 * `last-tree` objective unreachable (RV4-F-H1 — no way to raise
 * `aggregateActivity ≥ 0.6` without stochastic events).
 *
 * This module maps an `EnvironmentalImpact` payload (carried by every
 * BusinessState + AutomationState, copied from the content definition's
 * `baseEnvironmentalImpact` at purchase time) onto the player's HOME REGION
 * (`PLAYER_HOME_REGION_ID`). The downstream `evolveRegions` (next EventSystem
 * tick) then propagates the industrialActivity/pollution change into
 * soil/water/forest/biodiversity, and `aggregateGlobalIndicators` rolls it
 * into `avgBiodiversity` / `avgForestCoverage` / `ecosystemResilience`.
 *
 * Pure: returns a new state; the input is never mutated.
 */
import type { GameState, SimulationEvent } from '@capitalist-tree/shared';
import type { EnvironmentalImpact } from '@capitalist-tree/shared';
import {
  PLAYER_HOME_REGION_ID,
  PROVISIONAL_CARBON_TAX_PRICE_PER_UNIT,
  PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
  PROVISIONAL_ECONOMY_CATEGORY_CARBON_TAX,
  PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
  PROVISIONAL_ENV_REG_EFFECTIVENESS,
} from '@capitalist-tree/shared';
import { transfer } from '../economy/ledger.js';

/** Clamp a value to [0, 1]. */
function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Per-field scale factors mapping an `EnvironmentalImpact` to regional deltas.
 *
 * The impact fields are raw content numbers (e.g. extraction.pollution = 0.01,
 * manufacturing.landDisturbance = 0.1, application.waterConsumption = 30).
 * The scales convert these to meaningful per-action regional indicator deltas:
 *   - industrialActivity: raised by the combined industrial footprint
 *     (pollution + landDisturbance + carbonEmissions×0.1). A heavy
 *     manufacturing operation (~0.4 combined) raises industrialActivity by
 *     ~0.08/tick; a light extraction operation (~0.08 combined) by ~0.016.
 *     Sustained extraction raises the home region to 1.0 in ~30 operations,
 *     pushing the population-weighted aggregate past the 0.6 W5 threshold.
 *   - pollution: added to air (full), water (×0.5), soil (×0.3) — mirrors the
 *     `evolveRegions` accumulation split.
 *   - forestCoverage: reduced by landDisturbance (clearing).
 *   - biodiversity: reduced by biodiversityImpact (habitat loss).
 *   - waterAvailability: reduced by waterConsumption (drawdown).
 *   - soilHealth: reduced by soilDegradation (nutrient depletion).
 *
 * @provisional — tuned so a realistic extraction strategy reaches the W5
 * threshold; final calibration from playtesting.
 */
export const PLAYER_IMPACT_SCALES = {
  industrialActivity: 0.2, // per unit of combined footprint
  pollutionAir: 50, // pollution field → air load
  forestCoverage: 0.5, // landDisturbance → forest loss
  biodiversity: 0.3, // biodiversityImpact → biodiversity loss
  waterAvailability: 0.002, // waterConsumption → water drawdown
  soilHealth: 0.5, // soilDegradation → soil loss
} as const;

/** The combined industrial footprint of an impact (drives industrialActivity). */
function industrialFootprint(impact: EnvironmentalImpact): number {
  return (
    impact.pollution +
    impact.landDisturbance +
    impact.carbonEmissions * 0.1
  );
}

/**
 * Apply a player action's environmental impact to the home region.
 *
 * Returns a new state with the home region's indicators adjusted. If the home
 * region doesn't exist (e.g. regions not yet seeded — the EventSystem seeds
 * them on its first tick), the state is returned unchanged (the impact is
 * silently dropped; it will apply once regions exist).
 *
 * The 0-1 fields (industrialActivity, forestCoverage, biodiversity,
 * waterAvailability, soilHealth) are clamped to [0, 1]. Pollution fields are
 * non-negative (floored at 0).
 *
 * Pure: never mutates the input.
 */
export function applyPlayerEnvironmentalImpact(
  state: GameState,
  impact: EnvironmentalImpact,
): GameState {
  const regions = state.eventState.global.regions;
  const homeIdx = regions.findIndex((r) => r.id === PLAYER_HOME_REGION_ID);
  if (homeIdx === -1) {
    // Regions not seeded yet (EventSystem hasn't run). Drop the impact —
    // it will apply on the next action once regions exist.
    return state;
  }

  const home = regions[homeIdx]!;
  const footprint = industrialFootprint(impact);
  const s = PLAYER_IMPACT_SCALES;

  // P13-B / GAP-25: `governmentPolicy.environmentalRegulations` (0-1) caps
  // industrial pollution output (GDD §3.3). The mitigation factor scales the
  // pollution + industrialActivity DELTAS (not the direct land/water/soil/
  // biodiversity impacts — those are resource extraction, not pollution).
  // At reg=0 → mitigation=1 (no curbing); at reg=1 → mitigation=
  // (1 - EFFECTIVENESS) = 0.2 (deltas cut 80%). @provisional.
  const envReg = state.eventState.global.governmentPolicy.environmentalRegulations;
  const mitigation = 1 - envReg * PROVISIONAL_ENV_REG_EFFECTIVENESS;

  const industrialActivity = clamp01(
    home.industrialActivity + footprint * s.industrialActivity * mitigation,
  );
  const pollution = {
    air: Math.max(
      0,
      home.pollution.air + impact.pollution * s.pollutionAir * mitigation,
    ),
    water: Math.max(
      0,
      home.pollution.water + impact.pollution * s.pollutionAir * 0.5 * mitigation,
    ),
    soil: Math.max(
      0,
      home.pollution.soil + impact.pollution * s.pollutionAir * 0.3 * mitigation,
    ),
  };
  const forestCoverage = clamp01(
    home.forestCoverage - impact.landDisturbance * s.forestCoverage,
  );
  const biodiversity = clamp01(
    home.biodiversity - impact.biodiversityImpact * s.biodiversity,
  );
  const waterAvailability = clamp01(
    home.waterAvailability - impact.waterConsumption * s.waterAvailability,
  );
  const soilHealth = clamp01(
    home.soilHealth - impact.soilDegradation * s.soilHealth,
  );

  const updatedRegion = {
    ...home,
    industrialActivity,
    pollution,
    forestCoverage,
    biodiversity,
    waterAvailability,
    soilHealth,
  };

  return {
    ...state,
    eventState: {
      ...state.eventState,
      global: {
        ...state.eventState.global,
        regions: regions.map((r, i) => (i === homeIdx ? updatedRegion : r)),
      },
    },
  };
}

/**
 * Apply the carbon tax for a player action's carbon emissions (P13-B / GAP-25
 * — GDD §3.3 "Influence governments and environmental regulations"). Charges
 * `impact.carbonEmissions × governmentPolicy.carbonTaxRate ×
 * PROVISIONAL_CARBON_TAX_PRICE_PER_UNIT` (minor units) from `player:personal`
 * → `authority` (sunk as a carbon-tax payment). No-op when `carbonEmissions`
 * or `carbonTaxRate` is zero — so the default `carbonTaxRate = 0` leaves all
 * existing action behaviour unchanged.
 *
 * Throws `InsufficientFundsError` (from the underlying `transfer`) if the
 * player cannot cover the tax — consistent with the `purchase` / import
 * tariff paths. In practice the charge is small (emissions × rate × $1); the
 * caller (operate-business / harvest) surfaces the failure as an action error.
 *
 * Pure: returns a new state + a `transaction-recorded` event when a tax was
 * charged. Never mutates the input.
 */
export function applyCarbonTax(
  state: GameState,
  impact: EnvironmentalImpact,
  timestamp: number,
): { state: GameState; events: SimulationEvent[] } {
  const carbonTaxRate = state.eventState.global.governmentPolicy.carbonTaxRate;
  if (carbonTaxRate <= 0 || impact.carbonEmissions <= 0) {
    return { state, events: [] };
  }
  const amount = BigInt(
    Math.floor(
      impact.carbonEmissions * carbonTaxRate * PROVISIONAL_CARBON_TAX_PRICE_PER_UNIT,
    ),
  );
  if (amount <= 0n) return { state, events: [] };
  const afterTransfer = transfer(state, {
    sourceAccount: PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
    destinationAccount: PROVISIONAL_ECONOMY_AUTHORITY_ACCOUNT_ID,
    amount: amount.toString(10),
    category: PROVISIONAL_ECONOMY_CATEGORY_CARBON_TAX,
    description: `Carbon tax: ${impact.carbonEmissions} emissions × ${(carbonTaxRate * 100).toFixed(1)}%`,
    timestamp,
  });
  // Mirror the new player:personal account balance to `player.personalCash`
  // (P3a's coupling — `transfer()` moves account balances; the denormalized
  // `player.personalCash` field must be synced explicitly, as applyPurchase /
  // applyImport / applyExport do).
  const playerAccount = afterTransfer.economy.accounts.find(
    (a) => a.id === PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
  );
  const playerBalanceAfter =
    playerAccount?.balance ?? afterTransfer.player.personalCash;
  const next =
    playerBalanceAfter !== afterTransfer.player.personalCash
      ? {
          ...afterTransfer,
          player: { ...afterTransfer.player, personalCash: playerBalanceAfter },
        }
      : afterTransfer;
  const events: SimulationEvent[] = [
    {
      type: 'transaction-recorded',
      at: timestamp,
      payload: {
        record: next.economy.transactions[next.economy.transactions.length - 1]!,
      },
    },
  ];
  return { state: next, events };
}
