/**
 * Environment provisional constants (P7a — TDD §13 Environment System,
 * §5.5 Environmental State, §9.2 Climate Model, §8.3 soil variables;
 * GDD §10 Environment, §28 industrial production, §59–67 sustainability
 * pillars, §170 climate patterns).
 *
 * Every value here corresponds to (or stands in for) an unresolved design
 * decision listed in GDD §17. They live in a dedicated file so tuning is
 * localized to one place. The EnvironmentSystem (P7b) imports these via
 * `@capitalist-tree/shared` — never use magic numbers inside the system.
 *
 * CONVENTION: `PROVISIONAL_ENV_*` / `PROVISIONAL_ENERGY_*` prefix and a
 * `// PROVISIONAL (GDD §17: <item>)` comment pointing at the GDD entry the
 * value resolves. When a value is promoted from "provisional" to "decided"
 * via playtesting, move it to a sibling `decided.ts` and drop the prefix.
 */

// ---------------------------------------------------------------------------
// CLIMATE MODEL — greenhouse gases, radiative forcing, temperature
// (TDD §9.2, GDD §170, §660–661)
// ---------------------------------------------------------------------------

// PROVISIONAL (GDD §17: detailed climate model)
//
// Baseline atmospheric CO2 concentration (ppm) used as the pre-industrial-ish
// reference for radiative-forcing calculations. ~420 ppm matches the current
// real-world value; the EnvironmentSystem (P7b) derives `climateForcing` from
// the delta between `atmosphere.co2Concentration` and this baseline.
export const PROVISIONAL_ENV_CO2_BASELINE_PPM = 420; // ppm

// PROVISIONAL (GDD §17: detailed climate model)
//
// Radiative forcing contributed per ppm of CO2 above the baseline, in W/m^2.
// The log-derived coefficient from the real-world simplified climate response
// (dF ≈ 5.35 × ln(C/C0) → linearised ~0.0182 W/m^2 per ppm near 420 ppm).
// Used by the EnvironmentSystem to convert a CO2 delta into a forcing delta.
export const PROVISIONAL_ENV_CO2_RADIATIVE_FORCING_PER_PPM = 0.0000182; // W/m^2 per ppm

// PROVISIONAL (GDD §17: detailed climate model)
//
// Equilibrium climate sensitivity per W/m^2 of net radiative forcing, in
// Kelvin. ~0.8 K/(W/m^2) corresponds to a ~3 K warming for a doubling of CO2
// (forcing ≈ 3.7 W/m^2), the mid-range IPCC estimate. The EnvironmentSystem
// nudges `globalTemperature` toward `baselineTemp + climateForcing × this`.
export const PROVISIONAL_ENV_TEMP_SENSITIVITY_PER_W_M2 = 0.8; // K per W/m^2

// PROVISIONAL (GDD §17: detailed climate model)
//
// Fraction of the atmospheric emissions burden absorbed by oceans + biosphere
// per simulation day. ~0.005/day ≈ the real-world "airborne fraction" decay
// once emissions stop. Applied by the EnvironmentSystem to
// `atmosphere.emissions` each tick so a one-off release slowly re-equilibrates
// rather than lingering at full strength forever.
export const PROVISIONAL_ENV_EMISSIONS_DECAY_RATE = 0.005; // fraction per sim day

// PROVISIONAL (GDD §17: detailed climate model)
//
// Baseline natural sequestration rate (same units as `atmosphere.emissions`)
// representing steady ocean + terrestrial uptake independent of forest
// coverage. Forest coverage scales this further (GDD §10). P7a leaves it as a
// flat provisional rate; P7b wires it into the atmospheric carbon balance.
export const PROVISIONAL_ENV_SEQUESTRATION_BASELINE = 0.5; // emissions-units per sim day

// ---------------------------------------------------------------------------
// BIODIVERSITY (TDD §5.5, GDD §59–67 sustainability pillars)
// ---------------------------------------------------------------------------

// PROVISIONAL (GDD §17: Environmental recovery timescales)
//
// Per-tick decline of `biodiversity.index` when environmental stress
// (pollution, habitat loss, warming) is present. Small so a single stressed
// tick doesn't collapse the index; compounds over many ticks of sustained
// pressure. The EnvironmentSystem scales this by the magnitude of the stress.
export const PROVISIONAL_ENV_BIODIVERSITY_DECLINE_RATE = 0.001; // per tick

// PROVISIONAL (GDD §17: Environmental recovery timescales)
//
// Per-tick recovery of `biodiversity.index` when stress is removed. Slower
// than the decline rate on purpose — GDD §10.3: "Environmental recovery is
// possible, but the time and resources required should depend on the
// severity." Recovery lags remediation so players feel the cost of prior
// damage.
export const PROVISIONAL_ENV_BIODIVERSITY_RECOVERY_RATE = 0.0005; // per tick

// ---------------------------------------------------------------------------
// SOIL HEALTH DYNAMICS (TDD §8.3, GDD §10.1)
// ---------------------------------------------------------------------------

// PROVISIONAL (GDD §17: detailed resource simulation equations)
//
// Per-tick degradation of `soil.health` from contamination, compaction, and
// over-extraction. The EnvironmentSystem scales this by the soil's stress
// load (contamination level, compaction, nutrient deficit). Small so soil
// degrades gradually under sustained mistreatment rather than collapsing in
// one tick.
export const PROVISIONAL_ENV_SOIL_DEGRADATION_RATE = 0.001; // per tick

// PROVISIONAL (GDD §17: Environmental recovery timescales)
//
// Per-tick recovery of `soil.health` when contamination is removed and organic
// matter is added. Slower than degradation (mirrors the biodiversity
// asymmetry) so remediating damaged soil takes meaningful effort and time.
export const PROVISIONAL_ENV_SOIL_RECOVERY_RATE = 0.0005; // per tick

// ---------------------------------------------------------------------------
// ENERGY POOL (TDD §13 Environment System, GDD §9.1 — resolves R-P6-3)
// ---------------------------------------------------------------------------
//
// P6b1 defined the `energy` equipment category (`solar-panel`, `battery`) and
// `AutomationState.energyConsumption`, but P6 had no energy pool to debit
// (docs/offline-automation.md §6.3 — energy consumption was reported-but-
// unenforced). P7a adds `environment.energy` (stored/capacity/generationRate/
// consumptionRate); P7c wires `energyConsumption` to debit it. The constants
// below are the tuning knobs the EnvironmentSystem + AutomationSystem will use.

// PROVISIONAL (GDD §17: detailed resource simulation equations)
//
// Player's baseline energy consumption per simulation day — the ambient draw
// of keeping the operation running before any automation is added. The
// EnvironmentSystem debits this from `environment.energy.stored` each day so
// even a no-automation player sees the pool matter once solar is installed.
export const PROVISIONAL_ENERGY_BASELINE_CONSUMPTION = 10; // energy-units per sim day

// PROVISIONAL (GDD §17: detailed resource simulation equations)
//
// Energy generated per solar-panel unit per simulation day. With baseline
// consumption = 10 and generation = 5/panel, a player needs ≥2 panels to break
// even on ambient draw alone — surplus only once automation's
// `energyConsumption` is also covered. Tuned so solar is useful but not
// trivially self-sufficient with a single panel.
export const PROVISIONAL_ENERGY_SOLAR_GENERATION_RATE = 5; // energy-units per panel per sim day

// PROVISIONAL (GDD §17: detailed resource simulation equations)
//
// Round-trip storage efficiency of the battery in [0, 1]. Energy routed
// through the battery (charge then discharge) is multiplied by this factor, so
// ~0.85 (typical Li-ion round-trip efficiency) means 15% is lost on each
// cycle. The EnvironmentSystem applies this when surplus generation is banked
// and later drawn back out.
export const PROVISIONAL_ENERGY_BATTERY_EFFICIENCY = 0.85; // 0–1 round-trip

// PROVISIONAL (GDD §17: detailed resource simulation equations)
//
// Default storage capacity of a single battery, in energy-units. Used by the
// v8 -> v9 migration to seed `environment.energy.capacity` on legacy saves
// that have no battery installed yet (capacity 0 would make a freshly-migrated
// save unable to store any surplus even after the player buys a battery —
// instead we seed a modest default the EnvironmentSystem can raise when a
// battery is actually purchased). The migration backfills `stored: 0` so no
// legacy save starts with free energy.
export const PROVISIONAL_ENERGY_BATTERY_CAPACITY_DEFAULT = 100; // energy-units

// ---------------------------------------------------------------------------
// LAND USE (TDD §5.5, GDD §10 — resolves R-P6-4)
// ---------------------------------------------------------------------------
//
// P6b2's `applyEnvironmentalImpact` had no target for `landDisturbance`
// (docs/offline-automation.md §6.4) — it was recorded in the event payload
// only. P7a adds `environment.landUse` { developed, degraded, protected } so
// `landDisturbance` now increments `landUse.degraded`. P7c wires the routing.

// PROVISIONAL (GDD §17: Regional simulation granularity)
//
// Per-tick increment of `landUse.degraded` from industrial / automation
// activity that disturbs land. Small so land degrades gradually under
// sustained development rather than flipping in a single tick. The
// EnvironmentSystem scales this by the aggregate `landDisturbance` of active
// automations + businesses.
export const PROVISIONAL_ENV_LAND_DEGRADATION_RATE = 0.0005; // per tick

// ---------------------------------------------------------------------------
// LONG-TERM CLIMATE CONSEQUENCES (TDD §9.2, GDD §170 — sea level)
// ---------------------------------------------------------------------------

// PROVISIONAL (GDD §17: detailed climate model)
//
// Sea-level rise (mm) per simulation year per degree of warming above the
// climate baseline. ~3 mm/year/°C approximates the real-world current rate
// (~3.4 mm/year at ~1.1 °C above pre-industrial). The EnvironmentSystem
// advances `environment.seaLevelRise` each sim year by
// `max(0, globalTemperature - baselineTemp) × this`. Slow on purpose — sea
// level is a long-term consequence that only becomes visible across many sim
// years of sustained warming (GDD §170 long-term climate patterns).
export const PROVISIONAL_ENV_SEA_LEVEL_RISE_RATE = 3; // mm per sim year per °C above baseline
