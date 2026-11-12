/**
 * Environmental impact routing (P7c — TDD §13 Environment System, §8.3; GDD
 * §9.1 Environmental Impact, §28 industrial production; resolves R-P6-4 from
 * docs/offline-automation.md §6.4).
 *
 * Pure helper that takes an `EnvironmentalImpact` payload (the six GDD §9.1
 * channels emitted by the AutomationSystem's `executeAutomation` when an
 * automation fires) and routes each channel into the correct `EnvironmentState`
 * field, pro-rated by the step fraction of a sim day.
 *
 * GDD §9.1 lists seven real-world impact channels (electricity, fossil fuel,
 * manufacturing emissions, resource extraction, land disruption, chemical
 * pollution, water consumption). The frozen `EnvironmentalImpact` schema
 * (packages/shared/src/schemas/automation.ts — P6b1, NOT modified in P7c)
 * exposes six numeric channels that fold those seven into the closest
 * `EnvironmentState` accumulator:
 *
 *   - `carbonEmissions`      → `atmosphere.emissions`            (accumulate)
 *   - `waterConsumption`     → `freshwater.availability`         (debit, ≥ 0)
 *   - `soilDegradation`      → `soil.health`                     (decline, [0,1])
 *   - `pollution`            → `soil.contamination`              (accumulate, ≥ 0)
 *   - `landDisturbance`      → `landUse.degraded`                (accumulate, [0,1])
 *   - `biodiversityImpact`   → `biodiversity.index`              (decline, [0,1])
 *
 * `landDisturbance` previously had NO target (P6b2 left it payload-only —
 * R-P6-4). P7a added `environment.landUse.degraded`; this helper routes the
 * channel there, closing the gap. The other five channels preserve the exact
 * routing P6b2's private `applyEnvironmentalImpact` (in execute.ts) used, so
 * existing assertions (carbonEmissions → atmosphere.emissions) hold.
 *
 * Why a centralized helper: P6b2 inlined the routing as a private function in
 * `execute.ts`. P7c extracts it here so the mapping is owned by the
 * environment module (single source of truth), unit-testable in isolation,
 * and available for future consumers (e.g. a business/industrial-impact path
 * in P8). The AutomationSystem remains the ONLY caller at present — it
 * applies each automation's impact on fire (slot #9, before the
 * EnvironmentSystem at slot #10). The EnvironmentSystem does NOT re-apply
 * (would double-count); it reads the already-mutated env state. There is no
 * accumulator field on the state for per-tick impacts (the schema is frozen
 * and `SystemContext` does not thread in-step events to systems), so the
 * automation path applies impacts directly — this is the architecturally
 * correct resolution given the frozen schema (R-P6-4).
 *
 * Pure: takes the environment + impact + step length, returns a NEW
 * `EnvironmentState`. The input is NEVER mutated (TDD §4.1, §18.4).
 */
import type { EnvironmentState, EnvironmentalImpact } from '@capitalist-tree/shared';

const SECONDS_PER_DAY = 24 * 60 * 60;

/**
 * Route an `EnvironmentalImpact` payload into the `EnvironmentState`
 * accumulators, pro-rated by the step fraction of a sim day.
 *
 * Each channel is folded into its closest existing field (see the module doc
 * for the full mapping). `landDisturbance` increments `landUse.degraded`
 * (R-P6-4 — previously payload-only). All accumulators are clamped to their
 * physical ranges (`soil.health` / `biodiversity.index` / `landUse.*` in
 * [0,1]; `freshwater.availability` / `soil.contamination` ≥ 0).
 *
 * A zero/neutral impact (every channel 0) is a fixed point — no field moves
 * (conservation: no environmental quantity created from nothing, TDD §18.4).
 *
 * Pure: returns a NEW `EnvironmentState`; the input is not mutated.
 */
export function applyEnvironmentalImpact(
  env: EnvironmentState,
  impact: EnvironmentalImpact,
  dtSeconds: number,
): EnvironmentState {
  const fraction = dtSeconds / SECONDS_PER_DAY;

  const atmosphere = {
    ...env.atmosphere,
    emissions: env.atmosphere.emissions + impact.carbonEmissions * fraction,
  };

  const freshwater = {
    ...env.freshwater,
    availability: Math.max(
      0,
      env.freshwater.availability - impact.waterConsumption * fraction,
    ),
  };

  const soil = {
    ...env.soil,
    contamination: Math.max(0, env.soil.contamination + impact.pollution * fraction),
    health: Math.max(0, Math.min(1, env.soil.health - impact.soilDegradation * fraction)),
  };

  const biodiversity = {
    ...env.biodiversity,
    index: Math.max(
      0,
      Math.min(1, env.biodiversity.index - impact.biodiversityImpact * fraction),
    ),
  };

  // R-P6-4: landDisturbance now has a target — `landUse.degraded`. P6b2 left
  // this channel payload-only; P7a added the field, P7c wires the routing.
  // Each is a fraction in [0,1]; disturbance degrades land, so it increments
  // `degraded` (clamped at 1 — a fully degraded plot can't degrade further).
  const landUse = {
    ...env.landUse,
    degraded: Math.max(0, Math.min(1, env.landUse.degraded + impact.landDisturbance * fraction)),
  };

  return {
    ...env,
    atmosphere,
    freshwater,
    soil,
    biodiversity,
    landUse,
  };
}
