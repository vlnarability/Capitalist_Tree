/**
 * Atmosphere dynamics (TDD §13 Environment System, §9.2 Climate Model; GDD §10,
 * §28, §170).
 *
 * Pure helpers that advance the atmospheric greenhouse-gas concentrations one
 * tick at a time. The EnvironmentSystem (`packages/simulation/src/systems/
 * environment.ts`) calls these in order; they never mutate their input.
 *
 * Carbon balance (TDD §9.2 "simplified, stable approximations"):
 *
 *   co2' = co2
 *         + (emissions - sequestration) * EMISSIONS_TO_PPM * dtDays   (net flux)
 *         - max(0, co2 - CO2_BASELINE) * DECAY_RATE * dtDays            (natural sink)
 *
 *   - `emissions` / `sequestration` are rates in abstract "emissions-units per
 *     sim day" (matching PROVISIONAL_ENV_SEQUESTRATION_BASELINE's units).
 *     `EMISSIONS_TO_PPM` converts them to a ppm-per-day concentration delta.
 *   - The natural-sink term removes a fraction of the CO2 *excess above the
 *     pre-industrial baseline* each sim day (ocean + terrestrial uptake). This
 *     is the PROVISIONAL_ENV_EMISSIONS_DECAY_RATE path: a one-off release
 *     slowly re-equilibrates rather than lingering forever.
 *   - Conservation (TDD §18.4): with emissions = sequestration = 0 and
 *     co2 = CO2_BASELINE, the concentration is a fixed point (no CO2 created
 *     from nothing). The test in environment.test.ts asserts this.
 *
 * Methane (CH4) + nitrous oxide (N2O) are longer-lived than CO2 — their
 * natural decay toward baseline is slower (real-world lifetimes ~12 yr / ~100
 * yr). P7b has no source term for them (industrial CH4/N2O emissions land in
 * P7c); they only re-equilibrate toward baseline. Aerosols decay *quickly*
 * (~1 week atmospheric residence) toward zero — they are a transient
 * perturbation, not a stock.
 *
 * Every tuning value here either comes from `@capitalist-tree/shared` (the
 * PROVISIONAL_ENV_* constants from P7a) or is a local @provisional constant
 * flagged with the GDD §17 item it resolves. No magic numbers.
 */
import type { EnvironmentState } from '@capitalist-tree/shared';
import {
  PROVISIONAL_ENV_CO2_BASELINE_PPM,
  PROVISIONAL_ENV_EMISSIONS_DECAY_RATE,
} from '@capitalist-tree/shared';

const SECONDS_PER_DAY = 24 * 60 * 60;

// @provisional (GDD §17: detailed climate model) — conversion from the
// abstract `atmosphere.emissions` rate (emissions-units per sim day) to a CO2
// concentration delta (ppm per sim day). P7b picks 0.1 ppm per emissions-unit
// per day so the baseline sequestration of 0.5 emissions-units/day
// (PROVISIONAL_ENV_SEQUESTRATION_BASELINE) removes 0.05 ppm/day — a slow but
// visible re-equilibration. Promote to a decided shared constant once
// playtesting calibrates the carbon cycle (out of P7b scope — would touch
// packages/shared which P7a has frozen).
export const PROVISIONAL_ENV_EMISSIONS_TO_PPM = 0.1; // ppm per emissions-unit per sim day

// @provisional (GDD §17: detailed climate model) — atmospheric methane (CH4)
// baseline concentration (ppm). Matches the schema default
// (`atmosphere.methaneConcentration.default(1.9)`). Real-world ~1.9 ppm.
export const PROVISIONAL_ENV_METHANE_BASELINE_PPM = 1.9;

// @provisional (GDD §17: detailed climate model) — atmospheric nitrous oxide
// (N2O) baseline concentration (ppm). Matches the schema default
// (`atmosphere.nitrousOxideConcentration.default(0.33)`). Real-world ~0.33 ppm.
export const PROVISIONAL_ENV_N2O_BASELINE_PPM = 0.33;

// @provisional (GDD §17: detailed climate model) — fraction of the CH4 excess
// above baseline absorbed per sim day. ~1/(12*365) ≈ 0.000228/day mirrors the
// real-world ~12-year atmospheric lifetime of methane. Slower than CO2's
// DECAY_RATE on purpose: CH4 is longer-lived.
export const PROVISIONAL_ENV_METHANE_DECAY_RATE = 1 / (12 * 365); // per sim day

// @provisional (GDD §17: detailed climate model) — fraction of the N2O excess
// above baseline absorbed per sim day. ~1/(100*365) ≈ 0.0000274/day mirrors
// the real-world ~100-year atmospheric lifetime of nitrous oxide. Slowest of
// the GHGs: N2O is the longest-lived.
export const PROVISIONAL_ENV_N2O_DECAY_RATE = 1 / (100 * 365); // per sim day

// @provisional (GDD §17: detailed climate model) — fraction of the aerosol
// perturbation removed per sim day. ~1/7 ≈ 0.143/day mirrors the real-world
// ~1-week atmospheric residence time of tropospheric aerosols. Decays quickly
// toward zero (aerosols are a transient forcing, not a stock).
export const PROVISIONAL_ENV_AEROSOL_DECAY_RATE = 1 / 7; // per sim day

/**
 * Advance the atmospheric GHG + aerosol concentrations one tick.
 *
 * Pure: takes the environment state + step length, returns a NEW atmosphere
 * object. The caller assigns it back to `env.atmosphere`.
 */
export function stepAtmosphere(
  env: EnvironmentState,
  dtSeconds: number,
): EnvironmentState['atmosphere'] {
  const dtDays = dtSeconds / SECONDS_PER_DAY;
  const atm = env.atmosphere;

  // --- CO2 ---
  // Net flux from emissions vs sequestration (rates → ppm/day), minus the
  // natural sink on the excess above baseline.
  const co2Excess = Math.max(0, atm.co2Concentration - PROVISIONAL_ENV_CO2_BASELINE_PPM);
  const co2Flux =
    (atm.emissions - atm.sequestration) * PROVISIONAL_ENV_EMISSIONS_TO_PPM; // ppm/day
  const co2Sink = co2Excess * PROVISIONAL_ENV_EMISSIONS_DECAY_RATE; // ppm/day
  const co2Concentration = Math.max(0, atm.co2Concentration + (co2Flux - co2Sink) * dtDays);

  // --- Methane (CH4) ---
  // No source term in P7b (industrial CH4 is P7c); re-equilibrates toward
  // baseline at the slow methane decay rate.
  const ch4Excess = Math.max(0, atm.methaneConcentration - PROVISIONAL_ENV_METHANE_BASELINE_PPM);
  const methaneConcentration = Math.max(
    0,
    atm.methaneConcentration - ch4Excess * PROVISIONAL_ENV_METHANE_DECAY_RATE * dtDays,
  );

  // --- Nitrous oxide (N2O) ---
  // Same shape as CH4 but slower (longest-lived GHG).
  const n2oExcess = Math.max(
    0,
    atm.nitrousOxideConcentration - PROVISIONAL_ENV_N2O_BASELINE_PPM,
  );
  const nitrousOxideConcentration = Math.max(
    0,
    atm.nitrousOxideConcentration - n2oExcess * PROVISIONAL_ENV_N2O_DECAY_RATE * dtDays,
  );

  // --- Aerosols ---
  // Transient perturbation — decays toward zero at the fast aerosol rate.
  const aerosols =
    atm.aerosols >= 0
      ? Math.max(0, atm.aerosols - atm.aerosols * PROVISIONAL_ENV_AEROSOL_DECAY_RATE * dtDays)
      : Math.min(0, atm.aerosols - atm.aerosols * PROVISIONAL_ENV_AEROSOL_DECAY_RATE * dtDays);

  return {
    co2Concentration,
    emissions: atm.emissions,
    sequestration: atm.sequestration,
    methaneConcentration,
    nitrousOxideConcentration,
    aerosols,
  };
}
