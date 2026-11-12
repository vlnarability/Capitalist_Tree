# Environment & Climate (P7 — final)

**Status:** Source-of-truth contract for the P7 Environment (P7a–P7d)
implementation. Built on `docs/GDD.txt` §10 (Environmental Simulation), §28
(industrial production / pollution / climate), §59–67 (sustainability
pillars — short-term profit vs long-term viability), §9.1 (Environmental
Impact), §170 (long-term climate patterns); and `docs/TDD.txt` §13
(Environmental Accounting), §5.5 (Environmental State), §8.3 (soil
variables), §9.2 (Climate Model — "simplified, stable approximations"),
§9.3 (Environmental Feedback).

P7 is the last sub-task of Phase 7. It supersedes the P0 stub in
`packages/simulation/src/systems/stubs.ts` — the `EnvironmentSystem` is now a
real, pure, deterministic system (P7b). P7a added the `EnvironmentState`
schema fields (methane/N2O/aerosols, climateForcing, seaLevelRise, energy
pool, landUse) + 15 `PROVISIONAL_ENV_*` / `PROVISIONAL_ENERGY_*` constants;
P7b built the atmosphere / climate / water / soil / biodiversity pure
helpers + the EnvironmentSystem; P7c wired the environmental-impact routing
+ energy pool + solar/battery execution + resourceConsumption derivation
(resolving R-P6-3 / R-P6-4 / R-P6-6 from `docs/offline-automation.md`); P7d
wrote this document + resolved the R-P2-1 weather overlap + analysed the
deferred RNG fork (R-P7-1). The remaining stubbed systems (Business,
Progression, Event) stay stubbed until P8+.

This document is paired with `docs/GDD.txt` and `docs/TDD.txt`. Where this
document and the GDD/TDD disagree, the GDD/TDD win and a fix must be filed
against this document.

> **Scope flag.** Every `@provisional` constant in this document corresponds
> to (or stands in for) an unresolved design decision listed in `GDD §17`.
> They live in `packages/shared/src/constants/environment.ts` under the
> `PROVISIONAL_ENV_*` / `PROVISIONAL_ENERGY_*` prefixes, plus a handful of
> local `@provisional` constants inside the environment helper modules
> (`packages/simulation/src/environment/*.ts`) flagged with the GDD §17 item
> they resolve. P8+ playtesting will calibrate them; until then the engine
> NEVER hardcodes tuning numbers, only imports.

---

## 1. Public interfaces at a glance

| Surface                                        | Location                                                        | P7 phase |
|------------------------------------------------|-----------------------------------------------------------------|----------|
| `EnvironmentState` schema (atmosphere, soil, freshwater, biodiversity, climate, energy, landUse) | `packages/shared/src/schemas/environment.ts` | P2 + P7a |
| Environment constants (`PROVISIONAL_ENV_*`, `PROVISIONAL_ENERGY_*`) | `packages/shared/src/constants/environment.ts` | P7a |
| Migration v8→v9 (atmosphere CH4/N2O/aerosols, climateForcing, seaLevelRise, energy, landUse) | `packages/shared/src/migrations/registry.ts` | P7a |
| `atmosphere.ts` — CO2/CH4/N2O/aerosol dynamics | `packages/simulation/src/environment/atmosphere.ts`            | P7b      |
| `climate.ts` — forcing + temperature + sea level | `packages/simulation/src/environment/climate.ts`             | P7b      |
| `water.ts` — regional freshwater reserve       | `packages/simulation/src/environment/water.ts`                 | P7b      |
| `soil.ts` — extension-point dynamics + health nudge | `packages/simulation/src/environment/soil.ts`              | P7b      |
| `biodiversity.ts` — index + species populations | `packages/simulation/src/environment/biodiversity.ts`         | P7b      |
| `impact.ts` — `applyEnvironmentalImpact` (6 GDD §9.1 channels) | `packages/simulation/src/environment/impact.ts` | P7c |
| `energy.ts` — energy pool math (debit/solar/capacity/baseline) | `packages/simulation/src/environment/energy.ts` | P7c |
| `systems/environment.ts` — `EnvironmentSystem` (registry slot #10) | `packages/simulation/src/systems/environment.ts` | P7b/P7c |
| Solar pre-pass + on-fire energy debit (in AutomationSystem) | `packages/simulation/src/systems/automation.ts` + `automation/execute.ts` | P7c |
| `resourceConsumption` derivation at purchase   | `packages/simulation/src/automation/actions.ts`                | P7c      |

The EnvironmentSystem does NOT register an action — environmental evolution
is tick-driven (slot #10), and environmental *impact* is routed inline by
the AutomationSystem (slot #9) on each fire via the centralized
`applyEnvironmentalImpact` helper (see §8). No `generate-energy` /
`apply-impact` action exists (P7c handles both inline to fit the existing
architecture — see R-P7-8).

---

## 2. Environment state (TDD §5.5, §8.3, §9.2)

`EnvironmentState` (`packages/shared/src/schemas/environment.ts`) is the
global environmental state. P2 shipped the base shape (atmosphere CO2,
soil, freshwater, biodiversity, forestCoverage, ecosystemResilience,
globalTemperature); P7a extended it with the richer climate + energy +
land-use fields. The full shape:

```typescript
interface EnvironmentState {
  atmosphere: {
    co2Concentration: number;              // ppm — P2
    emissions: number;                     // emissions-units/day — P2
    sequestration: number;                 // emissions-units/day — P2
    methaneConcentration: number;          // ppm — P7a (CH4, ~28× CO2 GWP)
    nitrousOxideConcentration: number;     // ppm — P7a (N2O, ~265× CO2 GWP)
    aerosols: number;                      // W/m^2 — P7a (neg=cooling, pos=warming)
  };
  soil: {
    health: number;                        // [0,1] — P2 (derived)
    organicMatter: number;                 // P2
    contamination: number;                 // P2
    nutrients: NutrientState;              // P2 (N/P/K)
    soilWater: number;                     // L — P2 (ResourceSystem-owned)
    ph: number;                            // 0-14 — P2 stub (extension point)
    compaction: number;                    // [0,1] — P2 stub (extension point)
    microbialActivity: number;             // [0,1+] — P2 stub (extension point)
  };
  freshwater: {
    availability: number;                  // L — P2
    groundwater: number;                   // L — P2
    contamination: number;                 // P2
  };
  biodiversity: {
    index: number;                         // [0,1] — P2
    speciesPopulations: SpeciesPopulation[]; // P2
  };
  forestCoverage: number;                  // [0,1] — P2
  ecosystemResilience: number;             // [0,1] — P2
  globalTemperature: number;               // °C — P2 (P7d: EnvironmentSystem-owned)
  climateForcing: number;                  // W/m^2 — P7a (derived from GHG)
  seaLevelRise: number;                    // mm — P7a (long-term warming)
  energy: {
    stored: number;                        // energy-units — P7a (P7c wired)
    capacity: number;                      // energy-units — P7a (battery raises)
    generationRate: number;                // reserved — P7a (R-P7-4: unused)
    consumptionRate: number;               // reserved — P7a (R-P7-4: unused)
  };
  landUse: {
    developed: number;                     // [0,1] — P7a
    degraded: number;                      // [0,1] — P7a (landDisturbance target)
    protected: number;                     // [0,1] — P7a
  };
}
```

### P2 stubs vs P7 additions

| Field | Origin | Owner / status |
|---|---|---|
| `atmosphere.co2Concentration`, `emissions`, `sequestration` | P2 | EnvironmentSystem advances (P7b `stepAtmosphere`). |
| `atmosphere.methaneConcentration`, `nitrousOxideConcentration`, `aerosols` | **P7a** | EnvironmentSystem advances (P7b). No industrial source term yet (R-P7-3). |
| `soil.health`, `organicMatter`, `contamination`, `nutrients`, `soilWater` | P2 | ResourceSystem (slot #4) owns the base dynamics; EnvironmentSystem nudges `health` (see §6). |
| `soil.ph`, `compaction`, `microbialActivity` | P2 stubs | Extension points. P7b populates `compaction` (decay) + `microbialActivity` (organic-matter target); `ph` stays at 6.5. |
| `freshwater.availability`, `groundwater`, `contamination` | P2 | ResourceSystem syncs `availability`; EnvironmentSystem advances the regional reserve (see §5). |
| `biodiversity.index`, `speciesPopulations` | P2 | EnvironmentSystem advances (P7b `stepBiodiversity`). |
| `forestCoverage`, `ecosystemResilience`, `globalTemperature` | P2 | EnvironmentSystem derives `forestCoverage` + `ecosystemResilience`; owns `globalTemperature` via the climate model (P7d — R-P2-1 resolved). |
| `climateForcing`, `seaLevelRise` | **P7a** | EnvironmentSystem derives / advances (P7b). |
| `energy.{stored,capacity,generationRate,consumptionRate}` | **P7a** | P7c wired `stored` + `capacity`; `generationRate` / `consumptionRate` reserved (R-P7-4). |
| `landUse.{developed,degraded,protected}` | **P7a** | P7c routes `landDisturbance → degraded` (R-P6-4). |

All P7a fields have Zod `.default(...)` so v8 saves parse cleanly under v9;
the v8→v9 migration backfills them explicitly. `CURRENT_SCHEMA_VERSION = 9`.

---

## 3. Atmosphere model (TDD §9.2, §13; GDD §10, §28, §170)

**File:** `packages/simulation/src/environment/atmosphere.ts`.

The atmosphere advances four stocks one tick at a time. The carbon balance
(TDD §9.2 "simplified, stable approximations"):

```
co2' = co2
      + (emissions - sequestration) * EMISSIONS_TO_PPM * dtDays   (net flux)
      - max(0, co2 - CO2_BASELINE) * EMISSIONS_DECAY_RATE * dtDays (natural sink)
```

- `emissions` / `sequestration` are rates in abstract "emissions-units per
  sim day" (matching `PROVISIONAL_ENV_SEQUESTRATION_BASELINE`). The
  `PROVISIONAL_ENV_EMISSIONS_TO_PPM` (local @provisional = 0.1) converts
  them to a ppm-per-day concentration delta.
- The natural-sink term removes a fraction of the CO2 **excess above the
  pre-industrial baseline** each sim day (ocean + terrestrial uptake). A
  one-off release slowly re-equilibrates rather than lingering forever.
- **Conservation** (TDD §18.4): with `emissions = sequestration = 0` and
  `co2 = CO2_BASELINE`, the concentration is a fixed point — no CO2 created
  from nothing (asserted in `environment.test.ts`).

Methane (CH4) + nitrous oxide (N2O) are longer-lived than CO2 — their
natural decay toward baseline is slower (real-world lifetimes ~12 yr / ~100
yr, mirrored by `PROVISIONAL_ENV_METHANE_DECAY_RATE` / `N2O_DECAY_RATE`).
**P7b has no source term for them** (industrial CH4/N2O emissions land in a
future phase — the frozen `EnvironmentalImpact` schema has no
`methaneEmissions` / `nitrousOxideEmissions` channel, R-P7-3); they only
re-equilibrate toward baseline. Aerosols decay *quickly* (~1-week
atmospheric residence, `PROVISIONAL_ENV_AEROSOL_DECAY_RATE = 1/7`) toward
zero — they are a transient perturbation, not a stock.

### Emissions-to-PPM conversion

`emissions` is an abstract rate, not a mass. The conversion
`PROVISIONAL_ENV_EMISSIONS_TO_PPM = 0.1` (ppm per emissions-unit per sim
day) is a local @provisional constant chosen so the baseline sequestration
of 0.5 emissions-units/day removes 0.05 ppm/day — a slow but visible
re-equilibration. It promotes to a shared decided constant once playtesting
calibrates the carbon cycle (P7a froze `packages/shared`).

---

## 4. Climate model (TDD §9.2, §13; GDD §170)

**File:** `packages/simulation/src/environment/climate.ts`.

The forcing → temperature → sea-level chain (TDD §9.3 "Environmental
Feedback"):

```
forcing   = CO2_forcing + CH4_forcing + N2O_forcing + aerosol_forcing
temp_eq   = BASELINE_TEMP + forcing * TEMP_SENSITIVITY
temp'     = temp + (temp_eq - temp) * INERTIA * dtDays        (thermal inertia)
seaLevel' = seaLevel + max(0, temp - BASELINE_TEMP)
                      * SEA_LEVEL_RISE_RATE * dtYears          (slow, per sim year)
```

- **Forcing** (W/m^2): CO2 contribution is linearised against the excess
  above baseline × `PROVISIONAL_ENV_CO2_RADIATIVE_FORCING_PER_PPM` (the
  real-world log-derived `dF ≈ 5.35·ln(C/C0)` linearised near 420 ppm).
  Methane + N2O are scaled by their real-world global-warming potentials
  (`PROVISIONAL_ENV_METHANE_GWP = 28`, `N2O_GWP = 265`) and the same
  per-ppm coefficient. Aerosols are added directly (schema convention:
  negative = cooling, positive = warming). Sign: positive = net warming.
- **Temperature** moves toward the equilibrium with thermal **inertia**
  (`PROVISIONAL_ENV_TEMP_INERTIA_PER_DAY = 0.01` ≈ a ~100-day e-folding
  time) so it does NOT jump instantly to the new equilibrium (TDD §9.2
  "evolve over long periods"). This is the key difference from a
  step-function climate: a sustained emissions trajectory produces a
  gradual warming, not a discontinuity.
- **Sea level** rises only with warming above baseline, advanced per sim
  **year** (`PROVISIONAL_ENV_SEA_LEVEL_RISE_RATE = 3` mm/year/°C ≈ the
  real-world current rate). Slow on purpose — sea level is a long-term
  consequence visible only across many sim years of sustained warming
  (GDD §170).

### R-P2-1 resolved (P7d) — EnvironmentSystem owns globalTemperature

P2's WeatherSystem (slot #2) originally mirrored the per-step **local**
weather temperature (`state.world.weather.temperature`) into
`environment.globalTemperature` each tick for P1 backwards-compatibility.
The EnvironmentSystem (slot #10) ran after it and nudged `globalTemperature`
via `stepTemperature` — but the WeatherSystem overwrote that nudge at the
start of every subsequent tick, so the climate-driven trajectory was
"dominated by the weather signal" (the climate model's slow inertia was
invisible).

**P7d removed the mirror** (`packages/simulation/src/systems/weather-system.ts`
step 7). The EnvironmentSystem is now the **sole writer** of the
climate-scale `globalTemperature` via `stepTemperature`. WeatherSystem
writes ONLY the weather-scale `state.world.weather.temperature`. BiologySystem
reads `environment.globalTemperature` (the climate value) for its temperature
Liebig factor; a one-tick lag on tick 0 (before the EnvironmentSystem has
run) is acceptable for a slowly-evolving climate variable — the initial
18 °C seed (from `initial-state.ts`) is a sensible starting point.

The pure `stepTemperature` function was always correct + unit-tested in
isolation; the integration test previously only asserted finiteness (because
the mirror dominated). Post-R-P2-1 the integration test still asserts
finiteness, but the climate trajectory now genuinely follows the
forcing-driven equilibrium (see R-P7-2).

---

## 5. Water cycle (TDD §13, §5.5; GDD §10.1)

**File:** `packages/simulation/src/environment/water.ts`.

The EnvironmentSystem advances the **regional freshwater reserve** one tick:

```
availability' = max(0, availability + rainfall - evaporation)        (L)
groundwater'  = max(0, groundwater + rainfall * RECHARGE_FRACTION)   (L, slow)
contamination' = max(0, contamination * (1 - DECAY_RATE * dtDays))   (slow decay)
```

- `rainfall` comes from the WeatherSystem's just-produced weather (condition
  × intensity, via the content `WEATHER_EVENT_MAP` — same source the
  ResourceSystem uses).
- `evaporation` scales with the local air temperature above the base temp
  (mirrors `resources/water.ts`'s evaporation curve so the two systems
  agree).
- `groundwater` recharges from a small fraction of the rainfall (slow deep
  percolation).
- `contamination` decays slowly toward zero (natural attenuation /
  dilution).

### Overlap with ResourceSystem (R-P2-1 family — carry-forward)

The ResourceSystem (slot #4) **also** writes `freshwater.availability`: it
syncs it to `soilWater + 0.1×groundwater` as a per-plot soil-moisture proxy
for legacy consumers. The EnvironmentSystem (slot #10) runs after it, so
this step's regional-reserve value is what persists in the returned state —
but ResourceSystem overwrites it again next tick. The two notions of
"availability" (regional reserve vs per-plot proxy) share one schema field
pending a regional-granularity refactor (GDD §10.2, §17 — "Regional
simulation granularity"). The pure `stepFreshwater` function is correct +
unit-tested in isolation; the integration test asserts finiteness +
non-negativity only.

---

## 6. Soil model (TDD §13, §8.3; GDD §10.1)

**File:** `packages/simulation/src/environment/soil.ts`.

The ResourceSystem (slot #4) already derives `soil.health` each tick from
the base factors (organic matter, nutrients, moisture, contamination) via
`computeSoilHealth` — with the extension-point factors (pH, compaction,
microbial activity) stubbed at full contribution (factor = 1.0). The
EnvironmentSystem (slot #10) runs after it and:

1. **Decays `compaction`** slowly toward 0 (root penetration + natural
   loosening undo past compaction) at `PROVISIONAL_ENV_COMPACTION_DECAY_RATE`.
2. **Moves `microbialActivity`** toward a target derived from
   `organicMatter` (more organic matter → more microbial activity; the two
   are coupled in real soils) at `PROVISIONAL_ENV_MICROBIAL_RESPONSE_RATE`.
3. **Nudges `health`** with the ENV-specific degradation + recovery rates:

   ```
   health -= contaminationStress * DEGRADATION_RATE * dtDays
   health += organicRecovery    * RECOVERY_RATE    * dtDays
   ```

   Recovery is slower than degradation
   (`PROVISIONAL_ENV_SOIL_RECOVERY_RATE` <
   `PROVISIONAL_ENV_SOIL_DEGRADATION_RATE`) — GDD §10.3 "recovery ...
   depends on the severity ... recovery lags remediation". The nudge is
   applied ON TOP of the ResourceSystem's derived value, so the final
   health reflects both the static factor model and the dynamic evolution.

The EnvironmentSystem does NOT touch `soil.soilWater`, `soil.nutrients`, or
the base `soil.organicMatter` / `soil.contamination` accumulators — those
are the ResourceSystem's fields (rule: biology/resources consistent, the
EnvironmentSystem reads biology/resources outputs but does not modify
them).

### Overlap with ResourceSystem's computeSoilHealth

Both systems write `soil.health`. ResourceSystem's write is the static
derivation; the EnvironmentSystem's is a dynamic nudge layered on top. The
layering is intentional (the ENV rates are slower + asymmetric) but a
future refactor may fold both into one owner. The pure `stepSoil` function
is unit-tested in isolation.

---

## 7. Biodiversity (TDD §13, §5.5; GDD §10.1, §59–67)

**File:** `packages/simulation/src/environment/biodiversity.ts`.

```
stress = w_pollution  * pollutionStress
       + w_deforest   * (1 - forestCoverage)
       + w_tempAnom   * tempAnomaly * TEMP_STRESS_PER_DEGREE
       + w_soil       * (1 - soil.health)
       + w_water      * freshwaterContamination

if stress > STRESS_THRESHOLD:
  index -= DECLINE_RATE * stress * dtDays              (decline scales with stress)
else:
  index += RECOVERY_RATE * (1 - stress) * dtDays       (recovery scales with headroom)

speciesPopulations[i] *= newIndex / oldIndex            (populations track the index)
```

Decline is faster than recovery (`DECLINE_RATE > RECOVERY_RATE`) — GDD §10.3
"Environmental recovery is possible, but the time and resources required
should depend on the severity"; recovery lags remediation so players feel
the cost of prior damage. Some losses (species extinction) are irreversible
within the current world (GDD §10.3) — modelled by clamping at 0 and NOT
auto-reviving extinct (population = 0) species.

The index declines under the GDD §59–67 sustainability-pillar stressors
(pollution, habitat loss, warming) and recovers when stress is removed —
the core "unsustainable strategies should emerge through accumulated ...
environmental degradation" (GDD §59) mechanic. `forestCoverage` is derived
(see §8 below) from the originalTree's biology outputs, so a player who
harvests too aggressively (low canopy) directly stresses biodiversity.

---

## 8. Environmental impact routing (P7c — TDD §13, §8.3; GDD §9.1)

**File:** `packages/simulation/src/environment/impact.ts`.

`applyEnvironmentalImpact(env, impact, dtSeconds)` is the centralized pure
helper that routes an `EnvironmentalImpact` payload into the
`EnvironmentState` accumulators, pro-rated by the step fraction of a sim
day. GDD §9.1 lists seven real-world impact channels (electricity, fossil
fuel, manufacturing emissions, resource extraction, land disruption,
chemical pollution, water consumption); the frozen
`EnvironmentalImpact` schema (`packages/shared/src/schemas/automation.ts` —
P6b1, NOT modified in P7c) exposes six numeric channels that fold those
seven into the closest `EnvironmentState` accumulator:

| Channel              | Target field              | Effect        |
|----------------------|----------------------------|---------------|
| `carbonEmissions`    | `atmosphere.emissions`     | accumulate    |
| `waterConsumption`   | `freshwater.availability`  | debit, ≥ 0    |
| `soilDegradation`    | `soil.health`              | decline, [0,1]|
| `pollution`          | `soil.contamination`       | accumulate    |
| `landDisturbance`    | `landUse.degraded`         | accumulate, [0,1] |
| `biodiversityImpact` | `biodiversity.index`       | decline, [0,1]|

`landDisturbance` previously had NO target (P6b2 left it payload-only —
R-P6-4). P7a added `environment.landUse.degraded`; **P7c routes the channel
there, closing the gap** (resolves R-P6-4 from
`docs/offline-automation.md` §6.4). The other five channels preserve the
exact routing P6b2's private helper used, so existing assertions hold.

### Why centralized

P6b2 inlined the routing as a private function in `execute.ts`. P7c
extracts it into the environment module so the mapping is owned by a single
source of truth, unit-testable in isolation, and available for future
consumers (e.g. a business/industrial-impact path in P8). The
AutomationSystem remains the ONLY caller at present — it applies each
automation's impact on fire (slot #9, before the EnvironmentSystem at slot
#10). The EnvironmentSystem does NOT re-apply (would double-count); it
reads the already-mutated env state.

A zero/neutral impact (every channel 0) is a fixed point — no field moves
(conservation: no environmental quantity created from nothing, TDD §18.4).
Pure: returns a NEW `EnvironmentState`; the input is not mutated.

---

## 9. Energy pool (P7c — TDD §13; GDD §9.1 — resolves R-P6-3)

**File:** `packages/simulation/src/environment/energy.ts`.

P6b1 defined the `energy` equipment category (`solar-panel`, `battery`) and
`AutomationState.energyConsumption`, but P6 had no energy pool to debit —
consumption was reported-but-unenforced (`docs/offline-automation.md`
§6.3). P7a added `environment.energy` { stored, capacity, generationRate,
consumptionRate }; **P7c wires the pool**.

### The energy path

- **Solar generation (passive, every tick):** the AutomationSystem (slot
  #9) runs a solar pre-pass BEFORE the fire loop.
  `generateSolarEnergy(env, panelCount, weather, elapsedSeconds, stepSeconds)`
  computes `PROVISIONAL_ENERGY_SOLAR_GENERATION_RATE × panelCount × dtDays ×
  daylightFactor`, capped at `energy.capacity` (surplus above the battery
  ceiling is lost until the player installs more batteries). Banked into
  `energy.stored`.
- **Battery capacity (passive, every tick):** the EnvironmentSystem (slot
  #10) calls `deriveEnergyCapacity(batteryCount)` →
  `PROVISIONAL_ENERGY_BATTERY_CAPACITY_DEFAULT × (1 + batteryCount)`. Each
  active battery raises the storage ceiling.
- **Baseline ambient consumption (every tick):** the EnvironmentSystem
  calls `applyBaselineEnergyConsumption(env, stepSeconds)` → debits
  `PROVISIONAL_ENERGY_BASELINE_CONSUMPTION × dtDays` from `stored` (clamped
  at 0). Even a no-automation player sees the pool matter once solar is
  installed.
- **Automation `energyConsumption` (on-fire):** `executeAutomation`
  pre-checks `hasEnergy(env, energyConsumption, stepSeconds)` before the
  action runs; if the pool is short, the automation is **skipped with
  reason `insufficient-resources`** (the frozen `automation-skipped` reason
  enum has no `insufficient-energy` variant — energy IS a resource,
  R-P7-7) and `lastRunAt` is NOT advanced (retries next tick when solar
  replenishes the pool). On a successful fire, `debitEnergy` debits the
  per-fire draw (`energyConsumption × dtDays`) from `stored` (clamped at 0).

### Design choice — passive vs on-fire

Solar generation + battery capacity are **passive** (applied every tick the
automation is enabled), while energy consumption is **on-fire** (debited
when the automation's action runs, with the shortfall gating the fire).
Energy generation/storage is continuous (a panel produces whenever the sun
shines); energy consumption is discrete (the equipment draws power when its
action runs). This fits the existing architecture — the AutomationSystem
already iterates every automation every tick, so a passive pre-pass for
energy generation needs no new action types or schema changes (R-P7-8).

### `daylightFactor` (R-P7-5)

`daylightFactor(weather, elapsedSeconds)` is the fraction of full sun
available this tick: `isDaytime ? lightFactorMultiplier : 0`. The day/night
cycle uses the sim clock (first half of each sim day = day). The exact
day/night split + per-condition sun curve are @provisional GDD §17 tuning;
this is a deterministic, physically-reasonable proxy.

### Reserved fields (R-P7-4)

`energy.generationRate` / `consumptionRate` are **reserved but unused**.
P7c uses event-driven `stored` mutation (solar pre-pass + on-fire debit +
baseline consumption), not a continuous-rate model. The fields exist so a
future continuous-rate energy model can read them without a schema
migration.

---

## 10. resourceConsumption derivation (P7c — resolves R-P6-6)

**File:** `packages/simulation/src/automation/actions.ts` (`deriveResourceConsumption`).

P6b2 seeded `resourceConsumption: []` for every freshly-purchased automation,
so automations that feed a resource-consuming action (e.g. `apply-water`)
did not pre-check inventory for the resource itself. **P7c derives the
array from the equipment's `supportedActions`** at purchase time:

| `supportedActions` entry | Derived `resourceConsumption` |
|---|---|
| `apply-water` | `[{ resourceId: 'resource:water', amount: PROVISIONAL_AUTOMATION_WATER_PER_FIRE (5) }]` |
| `apply-fertilizer` | `[{ resourceId: 'resource:fertilizer', amount: PROVISIONAL_AUTOMATION_FERTILIZER_PER_FIRE (1) }]` |
| `harvest-leaves` | `[]` (harvesting produces `pendingIssuances` currency, consumes no inventory resource) |
| monitoring/energy (empty `supportedActions`) | `[]` |

Duplicate actions on one equipment merge by `resourceId` (sum amounts).
Resolves R-P6-6 (`docs/offline-automation.md` §6.6).

### Nominal amounts (R-P7-6)

The per-fire amounts (`PROVISIONAL_AUTOMATION_WATER_PER_FIRE = 5`,
`FERTILIZER_PER_FIRE = 1`) are **nominal local constants** — the exact
per-fire draw depends on the policy's `actionParams` (e.g. `apply-water`
litres), which are not known at purchase. These nominal values gate the
inventory pre-check ("does the player have water / fertilizer to run
this?") until a future phase derives the amount from the policy's
`actionParams` at fire time.

---

## 11. EnvironmentSystem per-tick contract (TDD §4.2, §13)

`EnvironmentSystem` (`packages/simulation/src/systems/environment.ts`)
replaces the P0 stub at **registry slot #10**. It runs once per simulation
step AFTER all other production systems (resources, biology, economy,
personal, automation) so it can aggregate their environmental impacts.

```text
execute(state, ctx):
  1. (RNG fork DEFERRED — R-P7-1, see §12. The transforms are deterministic;
     no ctx.rng.fork call. A determinism test pins zero root draws.)
  2. derive forestCoverage from originalTree biology outputs (READ ONLY).
  3. stepAtmosphere         — advance CO2 / CH4 / N2O / aerosol concentrations.
  4. deriveClimateForcing   — net radiative forcing from the new atmosphere.
  5. stepTemperature        — nudge globalTemperature toward equilibrium (inertia).
  6. stepSeaLevel           — advance sea level with sustained warming.
  7. stepFreshwater         — regional freshwater reserve (rainfall/evap/recharge).
  8. stepSoil               — compaction decay + microbial target + health nudge.
  9. stepBiodiversity       — index + species populations (stress-driven).
 10. deriveEcosystemResilience — from biodiversity + forestCoverage + soil.health.
 10b. Energy pool reconciliation (P7c):
       - deriveEnergyCapacity(batteryCount) → energy.capacity.
       - applyBaselineEnergyConsumption → debit ambient draw from stored.
       (Solar generation was banked by AutomationSystem slot #9 this tick;
        automation energyConsumption debited on-fire by executeAutomation.)
 11. pushEnvironmentNotifications — emit `notification` events when key
       thresholds cross (temp anomaly > 2 °C / 4 °C; biodiversity < 0.3 /
       0.15; soil.health < 0.3 / 0.15). Reuses the existing `notification`
       SimulationEvent variant (no new schema — P7a froze shared).
```

The system is pure: it deep-copies the input state, mutates the copy, and
returns the new state. The input is NEVER mutated (TDD §4.1, §18.4).
Rendering reads only — the rendering layer MUST NOT execute environmental
evolution independently. This system is the single engine-side driver.

### forestCoverage derivation (READ ONLY)

`forestCoverage` is derived from the originalTree's biology outputs (canopy
fullness + age-based maturity), NOT stored independently. A single mature
tree is treated as a small forest-stand proxy: coverage grows with canopy
fullness (`currentLeaves / leafCapacity`) and age-based maturity, from a
0.1 floor (a sapling already casts some shade) up to ~0.8 (a fully mature,
full-canopy tree). @provisional — promote to a decided mapping once the
regional forest model lands (P9).

### ecosystemResilience derivation

`ecosystemResilience = 0.4 × biodiversity.index + 0.3 × forestCoverage +
0.3 × soil.health` (clamped to [0,1]). Weights sum to 1.0; @provisional
(GDD §10.1 "ecosystem resilience: biodiversity, habitat quality, ecosystem
connectivity").

---

## 12. Determinism contract (TDD §18.3)

Given the same initial state, seed, player actions, and duration, the
EnvironmentSystem produces the same final `EnvironmentState` + events. The
module upholds this by construction:

- All transforms are pure arithmetic on the current env state (no
  randomness — the RNG fork is deferred, R-P7-1).
- `forestCoverage` is derived deterministically from the originalTree's
  biology outputs (which are themselves deterministic given the seed).
- The climate model uses no randomness (forcing is derived from GHG
  concentrations; temperature is an inertia-weighted nudge).

Save/load preserves all env fields (`atmosphere.*`, `soil.*`,
`freshwater.*`, `biodiversity.*`, `forestCoverage`, `ecosystemResilience`,
`globalTemperature`, `climateForcing`, `seaLevelRise`, `energy.*`,
`landUse.*`) via the v8→v9 migration + Zod defaults. Verified in
`environment.test.ts` (determinism: same seed → same state; purity: input
not mutated; conservation: CO2 fixed point at baseline) +
`environment-impact.test.ts` + `energy-pool.test.ts` +
`automation-energy-e2e.test.ts`.

### The RNG fork deferral (R-P7-1 — carry-forward, see §13)

The EnvironmentSystem does NOT fork the RNG. `Rng.fork()` advances the
shared root RNG by exactly one draw **by design**
(`packages/simulation/src/rng.ts`: `fork()` calls `this.next()` to seed the
child — "the parent advances by exactly one draw to seed the fork"). The
EnvironmentSystem runs at slot #10, AFTER BiologySystem (slot #3) +
WeatherSystem (slot #2); a fork here would advance the root at the END of
the tick, shifting the child seed BiologySystem's `fork('BiologySystem')`
derives on the NEXT tick → the mortality roll sequence changes → the
offline-catch-up "starved tree dies" test (seed=3, calibrated to the
current sequence) flips from dies-in-1-chunk to survives. **Verified
empirically in P7d** (adding the fork broke the test; reverting restored
it). A determinism test (`environment.test.ts` "RNG determinism") pins the
no-fork contract: `execute()` consumes zero root draws, a full
`engine.advance` persists the same root RNG whether or not the
EnvironmentSystem runs, and the starved tree still dies.

---

## 13. Carry-forward / known gaps (R-P7 items)

P7 surfaced eight carry-forward items. The frozen-schema constraint (P7a
froze `packages/shared`) shapes several of them.

### R-P7-1: RNG fork deferred (carry-forward)

The EnvironmentSystem does NOT call `ctx.rng.fork('EnvironmentSystem')`.
`fork()` advances the root RNG by one draw by design (rng.ts:137-148);
adding a third per-step fork (on top of BiologySystem's +
AutomationSystem's) shifts the BiologySystem mortality sequence and breaks
the calibrated seed=3 catch-up death test (verified empirically in P7d).
**Status: deferred.** The fork lands when (a) stochastic environmental
events (wildfire rolls, extreme-weather spikes) arrive AND (b) the
catch-up death test is retuned for the shifted sequence, OR `fork()` is
refactored to support a non-advancing sub-stream derivation (a deeper
change that retunes every system's sequence — out of P7d scope). A
determinism test pins the current (no-fork) behaviour.

### R-P7-2: WeatherSystem globalTemperature mirror — RESOLVED (P7d)

P7b flagged: "WeatherSystem mirrors localTemp to globalTemperature each
tick, so the climate-driven temperature trajectory is dominated by weather
until that lands." **P7d resolved it:** the mirror was removed
(`weather-system.ts` step 7); the EnvironmentSystem is now the sole writer
of the climate-scale `globalTemperature` via `stepTemperature`. This was
the P2-era R-P2-1 carry-forward (`docs/resources-weather.md`); resolving it
here unblocks the climate model (GDD §170 long-term patterns now genuinely
emerge from the forcing trajectory). See §4.

### R-P7-3: CH4 / N2O / aerosols channels not in EnvironmentalImpact (frozen)

The `EnvironmentalImpact` schema (P6b1, frozen) exposes six channels
(`carbonEmissions`, `waterConsumption`, `soilDegradation`, `pollution`,
`landDisturbance`, `biodiversityImpact`) — there is no
`methaneEmissions` / `nitrousOxideEmissions` / `aerosols` channel. As a
result, the atmosphere CH4/N2O/aerosol stocks only **decay** toward
baseline (P7b `stepAtmosphere`); they have no industrial source term.
Industrial CH4/N2O/aerosol emissions land in a future phase that extends
the schema (out of P7 scope — would unfreeze `packages/shared`).

### R-P7-4: energy.generationRate / consumptionRate reserved but unused

P7c uses event-driven `stored` mutation (solar pre-pass + on-fire debit +
baseline consumption), not a continuous-rate model. The
`generationRate` / `consumptionRate` fields are reserved at their P7a
defaults (0) so a future continuous-rate energy model can read them
without a schema migration.

### R-P7-5: daylightFactor day/night split is a @provisional proxy

`daylightFactor(weather, elapsedSeconds)` uses a simple first-half-of-day
= day proxy crossed with the weather condition's `lightFactorMultiplier`.
The exact day/night split + per-condition sun curve are GDD §17 tuning;
this is a deterministic, physically-reasonable placeholder.

### R-P7-6: resourceConsumption amounts are nominal local constants

`PROVISIONAL_AUTOMATION_WATER_PER_FIRE = 5` and
`PROVISIONAL_AUTOMATION_FERTILIZER_PER_FIRE = 1` gate the inventory
pre-check at purchase. The exact per-fire draw depends on the policy's
`actionParams` (not known at purchase); a future phase derives the amount
from `actionParams` at fire time.

### R-P7-7: insufficient-energy reuses 'insufficient-resources' reason

The frozen `automation-skipped` reason enum has no `insufficient-energy`
variant. An energy shortfall reuses `insufficient-resources` (energy IS a
resource). Semantically correct but coarser-grained than a dedicated
reason; unfreezing the enum to add `insufficient-energy` is a future
schema change.

### R-P7-8: solar / battery are passive (every tick), not on-fire

Solar generation + battery capacity are applied every tick the automation
is enabled (passive), while energy consumption is on-fire. This is an
architecture choice: energy generation/storage is continuous (a panel
produces whenever the sun shines); energy consumption is discrete (the
equipment draws power when its action runs). It fits the existing
AutomationSystem iteration without new action types or schema changes
(`supportedActions: []` stays for solar-panel / battery).

---

## 14. @provisional constants (GDD §17 pointers)

All environment tuning constants live in
`packages/shared/src/constants/environment.ts` (the shared `PROVISIONAL_ENV_*`
/ `PROVISIONAL_ENERGY_*`) plus local `@provisional` constants inside the
helper modules (`packages/simulation/src/environment/*.ts`). Each is marked
with a `// PROVISIONAL (GDD §17: <item>)` comment.

### Shared constants (`packages/shared/src/constants/environment.ts`)

| Constant                                              | Value        | Resolves (GDD §17) |
|-------------------------------------------------------|--------------|--------------------|
| `PROVISIONAL_ENV_CO2_BASELINE_PPM`                    | 420          | detailed climate model |
| `PROVISIONAL_ENV_CO2_RADIATIVE_FORCING_PER_PPM`       | 0.0000182    | detailed climate model |
| `PROVISIONAL_ENV_TEMP_SENSITIVITY_PER_W_M2`           | 0.8          | detailed climate model |
| `PROVISIONAL_ENV_EMISSIONS_DECAY_RATE`                | 0.005        | detailed climate model |
| `PROVISIONAL_ENV_SEQUESTRATION_BASELINE`              | 0.5          | detailed climate model |
| `PROVISIONAL_ENV_BIODIVERSITY_DECLINE_RATE`           | 0.001        | Environmental recovery timescales |
| `PROVISIONAL_ENV_BIODIVERSITY_RECOVERY_RATE`          | 0.0005       | Environmental recovery timescales |
| `PROVISIONAL_ENV_SOIL_DEGRADATION_RATE`               | 0.001        | detailed resource simulation equations |
| `PROVISIONAL_ENV_SOIL_RECOVERY_RATE`                  | 0.0005       | Environmental recovery timescales |
| `PROVISIONAL_ENERGY_BASELINE_CONSUMPTION`             | 10           | detailed resource simulation equations |
| `PROVISIONAL_ENERGY_SOLAR_GENERATION_RATE`            | 5            | detailed resource simulation equations |
| `PROVISIONAL_ENERGY_BATTERY_EFFICIENCY`               | 0.85         | detailed resource simulation equations |
| `PROVISIONAL_ENERGY_BATTERY_CAPACITY_DEFAULT`         | 100          | detailed resource simulation equations |
| `PROVISIONAL_ENV_LAND_DEGRADATION_RATE`               | 0.0005       | Regional simulation granularity |
| `PROVISIONAL_ENV_SEA_LEVEL_RISE_RATE`                 | 3            | detailed climate model |

### Local @provisional constants (helper modules)

| Constant | Value | Location | Resolves |
|---|---|---|---|
| `PROVISIONAL_ENV_EMISSIONS_TO_PPM` | 0.1 | `atmosphere.ts` | detailed climate model |
| `PROVISIONAL_ENV_METHANE_BASELINE_PPM` | 1.9 | `atmosphere.ts` | detailed climate model |
| `PROVISIONAL_ENV_N2O_BASELINE_PPM` | 0.33 | `atmosphere.ts` | detailed climate model |
| `PROVISIONAL_ENV_METHANE_DECAY_RATE` | 1/(12×365) | `atmosphere.ts` | detailed climate model |
| `PROVISIONAL_ENV_N2O_DECAY_RATE` | 1/(100×365) | `atmosphere.ts` | detailed climate model |
| `PROVISIONAL_ENV_AEROSOL_DECAY_RATE` | 1/7 | `atmosphere.ts` | detailed climate model |
| `PROVISIONAL_ENV_BASELINE_TEMP_C` | 14 | `climate.ts` | detailed climate model |
| `PROVISIONAL_ENV_METHANE_GWP` | 28 | `climate.ts` | detailed climate model |
| `PROVISIONAL_ENV_N2O_GWP` | 265 | `climate.ts` | detailed climate model |
| `PROVISIONAL_ENV_TEMP_INERTIA_PER_DAY` | 0.01 | `climate.ts` | detailed climate model |
| `PROVISIONAL_ENV_GROUNDWATER_RECHARGE_FRACTION` | 0.05 | `water.ts` | detailed resource simulation equations |
| `PROVISIONAL_ENV_FRESHWATER_CONTAMINATION_DECAY_RATE` | 0.01 | `water.ts` | Environmental recovery timescales |
| `PROVISIONAL_ENV_COMPACTION_DECAY_RATE` | 0.005 | `soil.ts` | Environmental recovery timescales |
| `PROVISIONAL_ENV_MICROBIAL_RESPONSE_RATE` | 0.05 | `soil.ts` | detailed resource simulation equations |
| `PROVISIONAL_ENV_BIODIVERSITY_STRESS_THRESHOLD` | 0.3 | `biodiversity.ts` | Environmental recovery timescales |
| `PROVISIONAL_ENV_BIODIVERSITY_TEMP_STRESS_PER_DEGREE` | 0.1 | `biodiversity.ts` | detailed climate model |
| `PROVISIONAL_ENV_BIODIVERSITY_STRESS_WEIGHTS` | {pollution:0.3, deforestation:0.3, tempAnomaly:0.2, soil:0.1, water:0.1} | `biodiversity.ts` | detailed resource simulation equations |
| `PROVISIONAL_AUTOMATION_WATER_PER_FIRE` | 5 | `automation/actions.ts` | automation cost/effectiveness balance |
| `PROVISIONAL_AUTOMATION_FERTILIZER_PER_FIRE` | 1 | `automation/actions.ts` | automation cost/effectiveness balance |

When a value is promoted from "provisional" to "decided" via playtesting,
move it to a sibling `decided.ts` and drop the `PROVISIONAL_` prefix
(matching the convention in `packages/shared/src/constants/`).

---

## 15. Public interfaces (signatures)

### 15.1 EnvironmentSystem

```typescript
// packages/simulation/src/systems/environment.ts
export const environmentSystem: System;  // registry slot #10
```

### 15.2 Environment pure helpers

```typescript
// packages/simulation/src/environment/atmosphere.ts
export function stepAtmosphere(env: EnvironmentState, dtSeconds: number): EnvironmentState['atmosphere'];

// packages/simulation/src/environment/climate.ts
export function deriveClimateForcing(atmosphere: EnvironmentState['atmosphere']): number;
export function stepTemperature(env: EnvironmentState, dtSeconds: number): number;
export function stepSeaLevel(seaLevelRise: number, globalTemperature: number, dtSeconds: number): number;

// packages/simulation/src/environment/water.ts
export function stepFreshwater(env: EnvironmentState, weather: WeatherState, dtSeconds: number): EnvironmentState['freshwater'];

// packages/simulation/src/environment/soil.ts
export function microbialTarget(organicMatter: number): number;
export function stepSoil(env: EnvironmentState, dtSeconds: number): EnvironmentState['soil'];

// packages/simulation/src/environment/biodiversity.ts
export function computeBiodiversityStress(env: EnvironmentState): number;
export function stepBiodiversity(env: EnvironmentState, dtSeconds: number): EnvironmentState['biodiversity'];

// packages/simulation/src/environment/impact.ts (P7c)
export function applyEnvironmentalImpact(
  env: EnvironmentState,
  impact: EnvironmentalImpact,
  dtSeconds: number,
): EnvironmentState;

// packages/simulation/src/environment/energy.ts (P7c)
export function computeEnergyDebit(energyConsumption: number, stepSeconds: number): number;
export function hasEnergy(env: EnvironmentState, energyConsumption: number, stepSeconds: number): boolean;
export function debitEnergy(env: EnvironmentState, energyConsumption: number, stepSeconds: number): number;
export function daylightFactor(weather: WeatherState, elapsedSeconds: number): number;
export function generateSolarEnergy(env: EnvironmentState, panelCount: number, weather: WeatherState, elapsedSeconds: number, stepSeconds: number): number;
export function deriveEnergyCapacity(batteryCount: number): number;
export function applyBaselineEnergyConsumption(env: EnvironmentState, stepSeconds: number): number;
```

---

## 16. Test inventory (post-P7d)

| File                                                            | Phase | Scope                                  |
|-----------------------------------------------------------------|-------|----------------------------------------|
| `packages/simulation/test/environment.test.ts`                  | P7b/P7d | 47 tests: atmosphere (CO2/CH4/N2O/aerosol decay + conservation), climate (forcing + temperature inertia + sea level), water, soil, biodiversity, EnvironmentSystem integration (slot #10, forestCoverage, resilience, notifications, long-run finiteness, determinism, conservation), + 3 P7d RNG-determinism tests (zero root draws, full-advance RNG unchanged, starved-tree mortality unperturbed). |
| `packages/simulation/test/environment-impact.test.ts`           | P7c   | 18 tests: `applyEnvironmentalImpact` — all six GDD §9.1 channels routed correctly; `landDisturbance → landUse.degraded` (R-P6-4); zero-impact fixed point; clamping; pro-rating; purity. |
| `packages/simulation/test/energy-pool.test.ts`                  | P7c   | 30 tests: energy debit/solar/capacity/baseline helpers; daylightFactor; insufficient-energy → `insufficient-resources`; battery capacity scaling. |
| `packages/simulation/test/automation-energy-e2e.test.ts`        | P7c   | 11 tests: end-to-end solar generation + on-fire debit + insufficient-energy skip; battery capacity passive effect. |

The P7d RNG-determinism tests pin the R-P7-1 carry-forward: the
EnvironmentSystem consumes zero root RNG draws (no fork), a full
`engine.advance` persists the same root RNG whether or not the
EnvironmentSystem runs, and the starved-tree mortality outcome is
unperturbed.

---

## 17. File map

```
packages/
├── shared/src/
│   ├── constants/
│   │   └── environment.ts            # NEW (P7a) — 15 PROVISIONAL_ENV_* / PROVISIONAL_ENERGY_*
│   ├── schemas/
│   │   └── environment.ts            # MODIFIED (P2 base + P7a) — CH4/N2O/aerosols, climateForcing,
│   │                                  #   seaLevelRise, energy, landUse
│   └── migrations/
│       └── registry.ts               # MODIFIED (P7a) — v8→v9 migration
└── simulation/src/
    ├── environment/                  # NEW (P7b/P7c) — pure environment helpers
    │   ├── atmosphere.ts             #   CO2/CH4/N2O/aerosol dynamics
    │   ├── climate.ts                #   forcing + temperature (inertia) + sea level
    │   ├── water.ts                  #   regional freshwater reserve
    │   ├── soil.ts                   #   compaction/microbial/health nudge
    │   ├── biodiversity.ts           #   index + species populations (stress-driven)
    │   ├── impact.ts                 #   applyEnvironmentalImpact (P7c, 6 channels, R-P6-4)
    │   ├── energy.ts                 #   energy pool math (P7c, R-P6-3)
    │   └── index.ts                  #   public surface
    ├── systems/
    │   ├── environment.ts            # REPLACES STUB (P7b/P7c) — registry slot #10
    │   └── index.ts                  # MODIFIED — imports environmentSystem
    ├── automation/
    │   ├── execute.ts                # MODIFIED (P7c) — on-fire energy debit + centralized impact routing
    │   └── actions.ts                # MODIFIED (P7c) — deriveResourceConsumption (R-P6-6)
    └── test/
        ├── environment.test.ts       # NEW (P7b) + P7d RNG-determinism tests
        ├── environment-impact.test.ts # NEW (P7c)
        ├── energy-pool.test.ts       # NEW (P7c)
        └── automation-energy-e2e.test.ts # NEW (P7c)
```

`docs/environment.md` (this file) is the human-readable model documentation;
`docs/resources-weather.md` (R-P2-1 updated) + `docs/offline-automation.md`
(R-P6-3/R-P6-4/R-P6-6 resolved) are the paired carry-forward records. The
source-of-truth for invariants is the test suite.
