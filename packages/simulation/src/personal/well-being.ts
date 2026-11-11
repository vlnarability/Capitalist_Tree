/**
 * Well-being indicators (P3c — TDD §11, GDD §7.2, §7.3).
 *
 * Pure functions that derive the three primary indicators GDD §7.2 requires:
 *
 *   - **Financial security** — ability to maintain lifestyle and meet
 *     obligations. Derived from real (inflation-adjusted) cash wealth via a
 *     saturating-hyperbola function with diminishing returns (GDD §7.3).
 *   - **Physical health** — influenced by nutrition, housing, environmental
 *     exposure, pollution, and stress. P3c only models the stress of unpaid
 *     bills (the `player.unpaidDays` counter). Other drivers arrive in
 *     later phases (P6 EnvironmentSystem, future social systems).
 *   - **Happiness** — influenced by financial security, leisure,
 *     relationships, environmental surroundings, and accumulated stress.
 *     P3c models a weighted blend of financial security + physical health +
 *     a baseline term (the latter stands in for the unmodelled drivers).
 *
 * ## Diminishing-returns function (GDD §7.3)
 *
 * GDD §7.3 requires:
 *   - The difference between poverty and financial security should be
 *     substantial.
 *   - The difference between being wealthy and extraordinarily wealthy
 *     should be considerably smaller.
 *
 * The saturating hyperbola
 *
 *   security(wealth) = wealth / (wealth + SCALE)
 *
 * satisfies both. At `wealth === 0`, security = 0 (destitute). At
 * `wealth === SCALE`, security = 0.5 (the half-saturation point — picked
 * as the "financial security threshold"). At `wealth → ∞`, security → 1.0
 * (extraordinarily wealthy).
 *
 * The marginal gain per dollar is the derivative `SCALE / (wealth + SCALE)^2`
 * — monotonically decreasing in `wealth`. So:
 *
 *   - $100 → $1_000 (×10): +0.409 security (escapes poverty — substantial)
 *   - $1_000 → $10_000 (×10): +0.409 again (log-scale invariance — same
 *     absolute delta per decade)
 *   - $10_000 → $100_000 (×10): +0.081 (diminishing — the curve is
 *     saturating)
 *   - $100_000 → $1_000_000 (×10): +0.009 (considerably smaller — the
 *     player is already at 0.99)
 *
 * GDD §7.3's "difference between wealthy and extraordinarily wealthy should
 * be considerably smaller" is satisfied: the gain from $100K → $1M (0.009)
 * is roughly 45× smaller than the gain from $100 → $1K (0.409).
 *
 * `SCALE = PROVISIONAL_WELL_BEING_WEALTH_SCALE_MINOR = 100_000 minor = $1_000`
 * — set as the poverty-to-security threshold.
 *
 * ## Real vs nominal purchasing power (GDD §6.3)
 *
 * GDD §6.3 requires that the player experiences the difference between
 * nominal income growth and actual purchasing power. P3c uses P3b's
 * `economy.inflationIndex` (Laspeyres basket of market prices vs base
 * prices) to deflate the nominal cash balance into a real wealth figure
 * before applying the hyperbola:
 *
 *   realWealth = nominalCash / inflationIndex
 *   security   = realWealth / (realWealth + SCALE)
 *
 * A doubling of prices (inflationIndex = 2.0) without a corresponding
 * doubling of the player's cash halves their real wealth, halving their
 * security — exposing GDD §6.3's "Increasing the number of banknotes does
 * not necessarily increase real wealth."
 *
 * All functions here are pure: same (state) → same output. No randomness,
 * no I/O. The PersonalSystem calls `deriveWellBeing` each tick and writes
 * the derived values to `state.player.{health, happiness, financialSecurity}`.
 *
 * P3d integration tests will exercise the cross-system flow (harvest →
 * issuance → inflation → real purchasing power → financial security) end
 * to end.
 */
import type { GameState } from '@capitalist-tree/shared';
import {
  PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID,
  PROVISIONAL_PERSONAL_BILLING_INTERVAL_DAYS,
  PROVISIONAL_WELL_BEING_HAPPINESS_BASELINE,
  PROVISIONAL_WELL_BEING_HAPPINESS_WEIGHT_HEALTH,
  PROVISIONAL_WELL_BEING_HAPPINESS_WEIGHT_SECURITY,
  PROVISIONAL_WELL_BEING_UNPAID_HEALTH_PENALTY_MAX,
  PROVISIONAL_WELL_BEING_UNPAID_HEALTH_PENALTY_PER_DAY,
  PROVISIONAL_WELL_BEING_WEALTH_SCALE_MINOR,
} from '@capitalist-tree/shared';
import { parseAmount, getBalance } from '../economy/ledger.js';

/** Clamp a number to [lo, hi]. */
function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/**
 * Saturating-hyperbola wealth-to-security function.
 *
 *   security(wealth) = wealth / (wealth + SCALE)
 *
 * Monotonically increasing in `wealth`, with monotonically decreasing
 * marginal gain (the derivative `SCALE / (wealth + SCALE)^2` is positive and
 * strictly decreasing — diminishing returns, GDD §7.3).
 *
 * Pure: deterministic given the inputs.
 *
 * @param wealthMinor Nominal wealth in bigint minor units (string or bigint).
 * @param scaleMinor  Half-saturation wealth. At `wealth === scale`, security
 *                    is exactly 0.5.
 */
export function wealthToSecurity(
  wealthMinor: bigint,
  scaleMinor: bigint,
): number {
  if (wealthMinor <= 0n) return 0;
  if (scaleMinor <= 0n) {
    // Defensive: a zero scale means "free wealth" — every dollar instantly
    // saturates. Treat as 1.0 (max security). Should not happen in practice
    // — the constant is positive.
    return 1;
  }
  // Convert to Number for the float division. P3c's economy stays well
  // under 2^53 minor units (~$90 trillion), so this is safe. For very
  // large bigints the conversion loses precision but the curve is already
  // saturated at that point (security ≈ 1.0).
  const w = Number(wealthMinor);
  const s = Number(scaleMinor);
  return w / (w + s);
}

/**
 * Derive the player's physical health from the `unpaidDays` counter.
 *
 * `1 - clamp(unpaidDays × PENALTY_PER_DAY, 0, MAX_PENALTY)`.
 *
 * Each unpaid day removes PENALTY_PER_DAY from health; the total penalty is
 * clamped at MAX_PENALTY (default 0.5) so health never drops below 0.5 from
 * unpaid bills alone. Other health drivers (P6 EnvironmentSystem, future
 * social systems) will add their own penalties on top.
 *
 * Pure: deterministic given `unpaidDays`.
 */
export function derivePhysicalHealth(unpaidDays: number): number {
  if (unpaidDays <= 0) return 1;
  const penalty = clamp(
    unpaidDays * PROVISIONAL_WELL_BEING_UNPAID_HEALTH_PENALTY_PER_DAY,
    0,
    PROVISIONAL_WELL_BEING_UNPAID_HEALTH_PENALTY_MAX,
  );
  return clamp(1 - penalty, 0, 1);
}

/**
 * Derive happiness from financial security + physical health.
 *
 * Weighted blend per GDD §7.2 (happiness is "influenced by financial
 * security, leisure, relationships, environmental surroundings, and
 * accumulated stress"):
 *
 *   happiness = W_SECURITY × security + W_HEALTH × health + W_BASELINE
 *
 * The baseline term captures the unmodelled drivers (leisure, relationships,
 * environment, stress). It's a constant for P3c; later phases will replace
 * it with real derivations.
 *
 * Pure: deterministic given the inputs.
 */
export function deriveHappiness(
  security: number,
  health: number,
): number {
  return clamp(
    PROVISIONAL_WELL_BEING_HAPPINESS_WEIGHT_SECURITY * security +
      PROVISIONAL_WELL_BEING_HAPPINESS_WEIGHT_HEALTH * health +
      PROVISIONAL_WELL_BEING_HAPPINESS_BASELINE,
    0,
    1,
  );
}

/**
 * Result of the well-being derivation. The PersonalSystem writes the three
 * derived indicators to `state.player.{health, happiness, financialSecurity}`
 * each tick; the nominal/real cash values are exposed for the UI (P5+ will
 * surface real purchasing power next to nominal balances).
 */
export interface WellBeing {
  /** Financial security in [0, 1]. Derived from real wealth via the
   *  saturating hyperbola (GDD §7.3). */
  financialSecurity: number;
  /** Physical health in [0, 1]. Derived from `unpaidDays` counter. */
  physicalHealth: number;
  /** Happiness in [0, 1]. Weighted blend of security + health + baseline. */
  happiness: number;
  /** Nominal cash balance (bigint minor units as string). This is the
   *  literal number of banknotes — what the player sees on their balance
   *  display. */
  nominalCashMinor: string;
  /** Real purchasing power (bigint minor units as string, floored to whole
   *  minor units). `nominalCash / inflationIndex`. When inflation is 0
   *  (index = 1.0), real === nominal. As the index rises, real < nominal —
   *  the player's banknotes buy less. */
  realPurchasingPowerMinor: string;
  /** Inflation index used for the deflation. Mirrors
   *  `economy.inflationIndex` for convenience. */
  inflationIndex: number;
  /** `player.unpaidDays` at the time of derivation. Mirrored for the UI. */
  unpaidDays: number;
}

/**
 * Derive the full well-being snapshot from a GameState.
 *
 * Reads:
 *   - `state.economy.accounts[player:personal].balance` (the source of
 *     truth — `player.personalCash` is mirrored by the EconomySystem and
 *     action handlers).
 *   - `state.economy.inflationIndex` (P3b — Laspeyres basket of market
 *     prices vs base prices).
 *   - `state.player.unpaidDays` (P3c — cumulative unpaid living-expense
 *     days).
 *
 * Does NOT mutate state. The PersonalSystem calls this each tick and writes
 * the three indicators back to `state.player.{health, happiness,
 * financialSecurity}`.
 *
 * Pure: deterministic given the state.
 */
export function deriveWellBeing(state: GameState): WellBeing {
  // Nominal cash from the account ledger (the source of truth).
  const nominalCashMinor = getBalance(state, PROVISIONAL_ECONOMY_PLAYER_ACCOUNT_ID);
  const inflationIndex = state.economy.inflationIndex > 0
    ? state.economy.inflationIndex
    : 1.0; // defensive: a fresh state has index = 1.0; never 0 in practice

  // Real purchasing power = nominal / inflation. Floor to whole minor units
  // (no fractional currency, TDD §10.1). Use Number for the division — P3c's
  // magnitudes are well under 2^53.
  const realNumber = Number(nominalCashMinor) / inflationIndex;
  const realFloored = Math.max(0, Math.floor(realNumber));
  const realPurchasingPowerMinor = BigInt(realFloored);

  // Financial security from real wealth via the saturating hyperbola.
  const scaleMinor = parseAmount(
    PROVISIONAL_WELL_BEING_WEALTH_SCALE_MINOR,
    'wealthScale',
  );
  const financialSecurity = wealthToSecurity(
    realPurchasingPowerMinor,
    scaleMinor,
  );

  // Physical health from the unpaidDays counter.
  const physicalHealth = derivePhysicalHealth(state.player.unpaidDays);

  // Happiness from security + health + baseline.
  const happiness = deriveHappiness(financialSecurity, physicalHealth);

  return {
    financialSecurity: clamp(financialSecurity, 0, 1),
    physicalHealth: clamp(physicalHealth, 0, 1),
    happiness: clamp(happiness, 0, 1),
    nominalCashMinor: nominalCashMinor.toString(10),
    realPurchasingPowerMinor: realPurchasingPowerMinor.toString(10),
    inflationIndex,
    unpaidDays: state.player.unpaidDays,
  };
}

/**
 * Convenience: compute the unpaid-days increment when a bill is unpaid.
 *
 * Each unpaid bill represents `PROVISIONAL_PERSONAL_BILLING_INTERVAL_DAYS`
 * days of unpaid living costs (the bill was for a full billing cycle of
 * food/housing/etc). The counter advances by that amount per unpaid bill.
 *
 * Pure: deterministic. Used by the PersonalSystem and the `pay-expense`
 * action handler.
 */
export function unpaidDaysIncrementForOneUnpaidBill(): number {
  return PROVISIONAL_PERSONAL_BILLING_INTERVAL_DAYS;
}
