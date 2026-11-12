/**
 * Climate model (TDD §9.2, §13 Environment System; GDD §10, §170).
 *
 * Pure helpers that derive the net radiative forcing from the GHG
 * concentrations and advance `globalTemperature` + `seaLevelRise` toward their
 * equilibria. "Simplified, stable approximations" per TDD §9.2 — NOT a full
 * climate model.
 *
 * The forcing → temperature → sea-level chain (TDD §9.3 "Environmental
 * Feedback"):
 *
 *   forcing = CO2_forcing + CH4_forcing + N2O_forcing + aerosol_forcing
 *   temp_eq = BASELINE_TEMP + forcing * TEMP_SENSITIVITY
 *   temp'   = temp + (temp_eq - temp) * INERTIA * dtDays   (thermal inertia)
 *   seaLevel' = seaLevel + max(0, temp - BASELINE_TEMP)
 *                       * SEA_LEVEL_RISE_RATE * dtYears    (slow, per sim year)
 *
 * - Forcing (W/m^2): CO2 contribution is linearised against the
 *   `PROVISIONAL_ENV_CO2_RADIATIVE_FORCING_PER_PPM` coefficient (the real
 *   log-derived dF≈5.35·ln(C/C0) linearised near the baseline). Methane + N2O
 *   are scaled by their real-world global-warming potentials (28× / 265×) and
 *   the same per-ppm coefficient. Aerosols are added directly (the schema
 *   convention: negative = cooling, positive = warming).
 * - Temperature: moves toward the equilibrium with thermal INERTIA so it does
 *   not jump instantly to the new equilibrium (TDD §9.2 "evolve over long
 *   periods"). The inertia coefficient is small per sim day.
 * - Sea level: rises only with warming above baseline, advanced per sim YEAR
 *   (GDD §170 long-term climate patterns).
 *
 * R-P2-1 RESOLVED (P7d — see docs/environment.md §6 + R-P7-2): the WeatherSystem
 * (slot #2) NO LONGER mirrors the local weather temperature into
 * `environment.globalTemperature` each tick. The EnvironmentSystem (slot #10)
 * is now the sole writer of the climate-scale `globalTemperature` via
 * `stepTemperature`. The previous mirror overwrote this step's climate nudge
 * at the start of every subsequent tick, so the climate-driven trajectory was
 * "dominated by the weather signal". With the mirror removed, the trajectory
 * follows the forcing-driven equilibrium with thermal inertia — exactly the
 * GDD §170 "long-term climate patterns" + TDD §9.2 "evolve over long periods"
 * intent. BiologySystem reads `environment.globalTemperature` (the climate
 * value) for its temperature Liebig factor; the one-tick lag on tick 0 is
 * acceptable for a slowly-evolving climate variable.
 */
import type { EnvironmentState } from '@capitalist-tree/shared';
import {
  PROVISIONAL_DAYS_PER_YEAR,
  PROVISIONAL_ENV_CO2_BASELINE_PPM,
  PROVISIONAL_ENV_CO2_RADIATIVE_FORCING_PER_PPM,
  PROVISIONAL_ENV_SEA_LEVEL_RISE_RATE,
  PROVISIONAL_ENV_TEMP_SENSITIVITY_PER_W_M2,
} from '@capitalist-tree/shared';
import {
  PROVISIONAL_ENV_METHANE_BASELINE_PPM,
  PROVISIONAL_ENV_N2O_BASELINE_PPM,
} from './atmosphere.js';

const SECONDS_PER_DAY = 24 * 60 * 60;
const SECONDS_PER_YEAR = PROVISIONAL_DAYS_PER_YEAR * SECONDS_PER_DAY;

// @provisional (GDD §17: detailed climate model) — baseline global mean
// surface temperature (°C) used as the pre-industrial-ish reference for the
// forcing → temperature mapping. ~14 °C is the real-world global average.
// The starting plot's `globalTemperature` is 18 °C (temperate, per
// initial-state.ts) — above this baseline, so a fresh game has a small
// standing warming signal. Promote to a shared decided constant once
// regional climate baselines land (P9).
export const PROVISIONAL_ENV_BASELINE_TEMP_C = 14; // °C

// @provisional (GDD §17: detailed climate model) — global warming potentials
// (GWP) of methane + nitrous oxide relative to CO2, used to fold their
// concentrations into the radiative forcing alongside CO2. Real-world 100-yr
// GWPs: CH4 ≈ 28, N2O ≈ 265 (IPCC AR5).
export const PROVISIONAL_ENV_METHANE_GWP = 28;
export const PROVISIONAL_ENV_N2O_GWP = 265;

// @provisional (GDD §17: detailed climate model) — fraction of the gap to the
// equilibrium temperature closed per sim day. Small (0.01/day ≈ a ~100-day
// e-folding time) so `globalTemperature` evolves slowly toward the forcing-
// driven equilibrium rather than snapping to it (TDD §9.2 "evolve over long
// periods" + "thermal inertia"). Tunable; promote once playtesting calibrates
// the transient climate response.
export const PROVISIONAL_ENV_TEMP_INERTIA_PER_DAY = 0.01; // fraction per sim day

/**
 * Derive the net radiative forcing (W/m^2) from the atmospheric GHG +
 * aerosol concentrations.
 *
 * Pure: takes the atmosphere, returns the forcing value. The caller writes it
 * to `env.climateForcing`. Sign convention: positive = net warming.
 */
export function deriveClimateForcing(
  atmosphere: EnvironmentState['atmosphere'],
): number {
  // CO2 — linearised against the excess above baseline.
  const co2Excess = Math.max(0, atmosphere.co2Concentration - PROVISIONAL_ENV_CO2_BASELINE_PPM);
  const co2Forcing = co2Excess * PROVISIONAL_ENV_CO2_RADIATIVE_FORCING_PER_PPM;

  // Methane — excess above baseline × GWP × the same per-ppm coefficient.
  const ch4Excess = Math.max(0, atmosphere.methaneConcentration - PROVISIONAL_ENV_METHANE_BASELINE_PPM);
  const ch4Forcing = ch4Excess * PROVISIONAL_ENV_METHANE_GWP * PROVISIONAL_ENV_CO2_RADIATIVE_FORCING_PER_PPM;

  // Nitrous oxide — same shape, larger GWP.
  const n2oExcess = Math.max(0, atmosphere.nitrousOxideConcentration - PROVISIONAL_ENV_N2O_BASELINE_PPM);
  const n2oForcing = n2oExcess * PROVISIONAL_ENV_N2O_GWP * PROVISIONAL_ENV_CO2_RADIATIVE_FORCING_PER_PPM;

  // Aerosols — added directly (schema convention: negative = cooling).
  const aerosolForcing = atmosphere.aerosols;

  return co2Forcing + ch4Forcing + n2oForcing + aerosolForcing;
}

/**
 * Advance `globalTemperature` one tick toward the forcing-driven equilibrium,
 * with thermal inertia so it does not jump instantly.
 *
 * Pure: takes the environment + step length, returns the new temperature. The
 * caller writes it to `env.globalTemperature`.
 */
export function stepTemperature(
  env: EnvironmentState,
  dtSeconds: number,
): number {
  const dtDays = dtSeconds / SECONDS_PER_DAY;
  const equilibrium =
    PROVISIONAL_ENV_BASELINE_TEMP_C + env.climateForcing * PROVISIONAL_ENV_TEMP_SENSITIVITY_PER_W_M2;
  const gap = equilibrium - env.globalTemperature;
  return env.globalTemperature + gap * PROVISIONAL_ENV_TEMP_INERTIA_PER_DAY * dtDays;
}

/**
 * Advance `seaLevelRise` one tick. Rises proportional to warming above the
 * baseline temperature, advanced per sim YEAR (slow — only visible across
 * many sim years of sustained warming, GDD §170).
 *
 * Pure: takes the current rise + temperature + step length, returns the new
 * rise (mm above baseline).
 */
export function stepSeaLevel(
  seaLevelRise: number,
  globalTemperature: number,
  dtSeconds: number,
): number {
  const dtYears = dtSeconds / SECONDS_PER_YEAR;
  const warming = Math.max(0, globalTemperature - PROVISIONAL_ENV_BASELINE_TEMP_C);
  return Math.max(0, seaLevelRise + warming * PROVISIONAL_ENV_SEA_LEVEL_RISE_RATE * dtYears);
}
