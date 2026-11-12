/**
 * Energy pool helpers (P7c — TDD §13 Environment System; GDD §9.1 Environmental
 * Impact, §28 industrial production, §59–67 sustainability pillars; resolves
 * R-P6-3 from docs/offline-automation.md §6.3).
 *
 * P6b1 defined the `energy` equipment category (`solar-panel`, `battery`) and
 * `AutomationState.energyConsumption`, but P6 had no energy pool to debit —
 * consumption was reported-but-unenforced. P7a added `environment.energy`
 * { stored, capacity, generationRate, consumptionRate }; P7c wires the pool.
 * These pure helpers own the energy-pool MATH; the callers are the
 * AutomationSystem (slot #9 — on-fire consumption debit + passive solar
 * generation) and the EnvironmentSystem (slot #10 — baseline consumption +
 * battery-derived capacity). Keeping the math in the environment module
 * preserves the layering: automation consumes environment helpers, never the
 * reverse (matching how `execute.ts` consumes `environment/impact.ts`).
 *
 *   - `computeEnergyDebit` / `hasEnergy` / `debitEnergy` — the on-fire draw.
 *     When an automation with `energyConsumption > 0` fires, the per-tick draw
 *     (`energyConsumption × stepSeconds / SECONDS_PER_DAY`, matching the
 *     maintenance pro-rating pattern) is debited from `energy.stored`. If the
 *     pool has less than the draw, the automation is skipped (reason
 *     `insufficient-resources` — the frozen `automation-skipped` reason enum
 *     has no `insufficient-energy` variant, so the energy shortfall reuses the
 *     resources reason; semantically energy IS a resource).
 *   - `daylightFactor` — the fraction of full sun available this tick, from
 *     the WeatherSystem's just-produced weather (the condition's
 *     `lightFactorMultiplier`) crossed with the day/night cycle.
 *   - `generateSolarEnergy` — passive generation from active solar-panel
 *     automations: `PROVISIONAL_ENERGY_SOLAR_GENERATION_RATE × panelCount ×
 *     dtDays × daylightFactor`, capped at `energy.capacity`.
 *   - `deriveEnergyCapacity` — the battery passive effect: each active battery
 *     raises the pool's effective capacity.
 *   - `applyBaselineEnergyConsumption` — the player's ambient draw
 *     (`PROVISIONAL_ENERGY_BASELINE_CONSUMPTION × dtDays`), applied by the
 *     EnvironmentSystem each tick so the pool matters even with no automation.
 *
 * Design choice — passive vs on-fire: solar generation + battery capacity are
 * PASSIVE (applied every tick the automation is enabled), while energy
 * consumption is ON-FIRE (debited when the automation's action runs, with the
 * shortfall gating the fire). Energy generation/storage is continuous (a panel
 * produces whenever the sun shines); energy consumption is discrete (the
 * equipment draws power when its action runs). This matches the task brief's
 * "handle them inline in the AutomationSystem's execute path without new
 * action types; prefer the approach that fits the existing architecture" — the
 * AutomationSystem already iterates every automation every tick, so a passive
 * pre-pass for energy generation fits without new action types or schema
 * changes (no `generate-energy` action needed; `supportedActions: []` stays).
 *
 * All helpers are PURE: they take state fragments + step length and return new
 * numbers / objects, never mutating their input (TDD §4.1, §18.4). Every
 * tuning value comes from `@capitalist-tree/shared` `PROVISIONAL_ENERGY_*` —
 * no magic numbers.
 */
import type { EnvironmentState, WeatherState } from '@capitalist-tree/shared';
import {
  PROVISIONAL_ENERGY_BASELINE_CONSUMPTION,
  PROVISIONAL_ENERGY_SOLAR_GENERATION_RATE,
  PROVISIONAL_ENERGY_BATTERY_CAPACITY_DEFAULT,
} from '@capitalist-tree/shared';
import { WEATHER_EVENT_MAP } from '@capitalist-tree/content';

const SECONDS_PER_DAY = 24 * 60 * 60;

/**
 * The per-fire energy draw of an automation, pro-rated by the step fraction of
 * a sim day. `energyConsumption` is a rate (energy-units per sim day, matching
 * the equipment `baseEnergyConsumption`); on a fire we settle one tick's worth
 * (`rate × dtDays`) — the same pro-rating pattern `applyMaintenance` uses for
 * the daily maintenance cost. Returns 0 when `energyConsumption` is 0
 * (equipment that produces or senses rather than consumes — solar-panel,
 * battery, harvester-t1).
 */
export function computeEnergyDebit(energyConsumption: number, stepSeconds: number): number {
  if (energyConsumption <= 0) return 0;
  return energyConsumption * (stepSeconds / SECONDS_PER_DAY);
}

/**
 * Whether the energy pool has enough stored to cover the automation's per-fire
 * draw. Always true when the automation has no energy consumption
 * (`energyConsumption <= 0`). The caller (executeAutomation) emits
 * `automation-skipped` with reason `insufficient-resources` when this returns
 * false (the frozen reason enum has no `insufficient-energy` variant — energy
 * is treated as a resource).
 */
export function hasEnergy(
  env: EnvironmentState,
  energyConsumption: number,
  stepSeconds: number,
): boolean {
  const debit = computeEnergyDebit(energyConsumption, stepSeconds);
  if (debit <= 0) return true;
  return env.energy.stored >= debit;
}

/**
 * Debit the automation's per-fire energy draw from `energy.stored`, clamped at
 * 0 (the pool cannot go negative). Returns the new `stored` value. Pure: takes
 * the env + rate + step, returns a number.
 */
export function debitEnergy(
  env: EnvironmentState,
  energyConsumption: number,
  stepSeconds: number,
): number {
  const debit = computeEnergyDebit(energyConsumption, stepSeconds);
  return Math.max(0, env.energy.stored - debit);
}

/**
 * The fraction of full sun available this tick (in [0, 1]) from the
 * WeatherSystem's just-produced weather crossed with the day/night cycle.
 *
 *   daylightFactor = isDaytime ? lightFactorMultiplier : 0
 *
 * `lightFactorMultiplier` comes from the weather condition's
 * `WeatherEventDefinition` (sunny → ~1, cloudy → ~0.5, rain → lower, etc.).
 * The day/night cycle uses the sim clock: the first half of each sim day
 * (elapsedSeconds % SECONDS_PER_DAY in [0, SECONDS_PER_DAY/2)) is day, the
 * second half is night (no solar generation). @provisional — the exact
 * day/night split + per-condition sun curve are GDD §17 tuning; this is a
 * deterministic, physically-reasonable proxy.
 *
 * Pure: deterministic given (weather, elapsedSeconds).
 */
export function daylightFactor(weather: WeatherState, elapsedSeconds: number): number {
  const timeOfDay = elapsedSeconds % SECONDS_PER_DAY;
  const isDaytime = timeOfDay < SECONDS_PER_DAY / 2;
  if (!isDaytime) return 0;
  const event = WEATHER_EVENT_MAP[weather.condition];
  const lightMultiplier = event ? event.lightFactorMultiplier : 1;
  return Math.max(0, Math.min(1, lightMultiplier));
}

/**
 * Passive solar generation: energy added to `stored` this tick from
 * `panelCount` active solar-panel automations. Pro-rated by the step fraction
 * of a sim day and scaled by the daylight factor (sun × weather × day/night).
 * Capped at `energy.capacity` — surplus above the battery capacity is lost
 * (wasted, not banked) until the player installs more batteries.
 *
 *   gen = PROVISIONAL_ENERGY_SOLAR_GENERATION_RATE × panelCount × dtDays × daylightFactor
 *   stored' = min(capacity, stored + gen)
 *
 * Pure: takes the env + weather + clock + counts, returns the new `stored`.
 */
export function generateSolarEnergy(
  env: EnvironmentState,
  panelCount: number,
  weather: WeatherState,
  elapsedSeconds: number,
  stepSeconds: number,
): number {
  if (panelCount <= 0) return env.energy.stored;
  const dtDays = stepSeconds / SECONDS_PER_DAY;
  const sun = daylightFactor(weather, elapsedSeconds);
  const gen = PROVISIONAL_ENERGY_SOLAR_GENERATION_RATE * panelCount * dtDays * sun;
  return Math.min(env.energy.capacity, env.energy.stored + gen);
}

/**
 * The energy pool's effective capacity given `batteryCount` active battery
 * automations (the battery passive effect — each battery raises the pool's
 * storage ceiling).
 *
 *   capacity = PROVISIONAL_ENERGY_BATTERY_CAPACITY_DEFAULT × (1 + batteryCount)
 *
 * The base default (P7a migration seed) gives a freshly-migrated save a modest
 * bank so a panel's surplus isn't instantly wasted before the player buys a
 * battery; each active battery adds another default-capacity's worth. Pure.
 */
export function deriveEnergyCapacity(batteryCount: number): number {
  return PROVISIONAL_ENERGY_BATTERY_CAPACITY_DEFAULT * (1 + Math.max(0, batteryCount));
}

/**
 * Apply the player's baseline (ambient) energy consumption for one tick — the
 * draw of keeping the operation running before any automation is added. The
 * EnvironmentSystem debits this from `energy.stored` each tick so the pool
 * matters even for a no-automation player once solar is installed. Clamped at
 * 0 (the pool cannot go negative; an empty pool simply can't power further
 * draws — automations that fire afterwards hit the `insufficient-energy`
 * gate). Pure: returns the new `stored`.
 */
export function applyBaselineEnergyConsumption(
  env: EnvironmentState,
  stepSeconds: number,
): number {
  const dtDays = stepSeconds / SECONDS_PER_DAY;
  const debit = PROVISIONAL_ENERGY_BASELINE_CONSUMPTION * dtDays;
  return Math.max(0, env.energy.stored - debit);
}
