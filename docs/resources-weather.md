# Resources + Weather (P2)

**Status:** Source-of-truth documentation for Phase 2 (Resources + Weather) of
*The Capitalist Tree*.
Pairs with `docs/GDD.txt` §4.3 (Weather), §4.4 (Seasons), §10 (Environmental
Simulation), `docs/TDD.txt` §8 (Resource Simulation), §9 (Weather and Climate),
and `docs/simulation.md` (the engine contract). Where this document and the
GDD/TDD disagree, the GDD/TDD win and a fix must be filed here.

This document covers the **resources + weather models as shipped in P2**.
Every numeric constant referenced is `@provisional` per GDD §17 ("detailed
resource simulation equations" + "detailed climate model"). Provisional
constants live in `packages/shared/src/constants/resources.ts` and
`packages/shared/src/constants/provisional.ts`.

---

## 1. Scope

P2 owns the resource + weather behaviour of the original tree's plot:

- `packages/simulation/src/resources/*` — pure resource functions
  (water balance, nutrient balance, soil health derivation).
- `packages/simulation/src/weather/*` — pure weather functions (Markov
  chain, weather effects).
- `packages/simulation/src/systems/weather-system.ts` — replaces the P0 stub
  at registry slot #2. The **only writer** to `state.world.weather` and
  `state.rngStreams.weather`.
- `packages/simulation/src/systems/resource-system.ts` — replaces the P0 stub
  at registry slot #4. The **only writer** to
  `state.world.environment.soil.{soilWater, nutrients, contamination,
  organicMatter, health}`, `state.world.environment.freshwater.{availability,
  groundwater}`, `originalTree.water.stored`, and `originalTree.nutrients`.
- `packages/content/src/weather/*` — climate baseline, transition matrices,
  event definitions (pure data).
- `packages/content/src/fertilizers/*` — three starter fertilizers (balanced
  10-10-10, urea 46-0-0, compost).
- New schema files: `packages/shared/src/schemas/{weather,fertilizer,
  actions-resources,events-resources}.ts`, plus extensions to `environment.ts`
  and `game-state.ts`.
- `packages/simulation/src/actions/handlers.ts` — adds `apply-water` and
  `apply-fertilizer` action handlers.

P2 does **not** modify rendering, biology, the engine core, the RNG, the
scheduler, or the migration registry's existing entries. The system execution
order is unchanged (P2 only swaps two stubs with real implementations).

---

## 2. The P1 → P2 contract: who owns what (R-P2-1)

P1's `BiologySystem` had a placeholder (`applyPlaceholderResources`) that
mirrored `env.freshwater.availability → tree.water.stored` and
`env.soil.nutrients → tree.nutrients` WITHOUT decrementing env. This violated
conservation (TDD §18.4 invariant) and duplicated the soil water + nutrient
balance that P2 owns.

**P2 contract (replaces the placeholder):**

- `ResourceSystem` owns the full water + nutrient balance:
  - Water: rainfall + irrigation in, evaporation + drainage + tree uptake +
    runoff out. Tree uptake is Liebig-capped by root capacity + soil water +
    buffer room; transferred from `env.soil.soilWater` to
    `originalTree.water.stored`.
  - Nutrients: replenishment + fertilizer in, leaching + tree absorption out.
    Tree absorption is Liebig-capped by root capacity + soil nutrients;
    transferred from `env.soil.nutrients` to `originalTree.nutrients`.
- `BiologySystem` reads `tree.water.stored` (via `photosynthesis.waterFactor`)
  and `tree.nutrients` (via `photosynthesis.nutrientFactor`) to compute the
  Liebig min for photosynthesis. ResourceSystem keeps those fields populated.

The BiologySystem is **internally consistent** (GDD §16.9: derived health,
energy allocation, etc. all read the same underlying values). ResourceSystem
is the **only writer** to soil/tree water + nutrients; BiologySystem reads but
never writes those fields.

**Backwards-compat shim (RESOLVED in P7d — see R-P2-1):** P1's BiologySystem
reads `environment.globalTemperature` for the temperature Liebig factor. P2's
WeatherSystem originally mirrored the per-step local temperature
(`state.world.weather.temperature`) to
`state.world.environment.globalTemperature` each tick so the existing biology
code kept working unchanged. P7d removed the mirror (the EnvironmentSystem,
slot #10, now owns `globalTemperature` via the climate model — see
`docs/environment.md` §6): the previous per-tick overwrite dominated the
climate-driven trajectory. BiologySystem now reads the climate-scale
`globalTemperature` (seeded at 18 °C by initial-state, evolved by
`stepTemperature`); a future refactor of biology to read
`state.world.weather.temperature` directly remains open but no longer blocks
the climate model.

---

## 3. Water model (TDD §8.1, GDD §10.1)

**File:** `packages/simulation/src/resources/water.ts`.

Per-step water balance across two coupled pools:

```
SOIL WATER POOL (env.soil.soilWater):
  soilWater' = max(0, soilWater + rainfall + irrigation
                       - evaporation - drainage - treeUptake - runoff)

TREE WATER BUFFER (originalTree.water.stored):
  treeWater' = clamp(treeWater - transpiration + treeUptake, 0, capacity)
```

Where:

- **Rainfall** comes from WeatherSystem (per-condition rate × intensity ×
  `stepDays`).
- **Irrigation** comes from the `apply-water` action handler (already added
  to `soilWater` before the tick runs).
- **Evaporation** scales with temperature + per-condition multiplier.
- **Drainage** is a fraction of soil water per day (recharges groundwater).
- **Transpiration** = `dailyWaterNeed × stepDays` (water the tree consumes
  from its internal buffer; the biology module's `dailyWaterNeed` scales
  with foliage so a sapling transpires much less than a mature canopy).
- **Tree uptake** = `min(rootCap × stepDays, availableForUptake, bufferRoom)`
  where:
  - `availableForUptake = max(0, soilWater + rainfall - evaporation - drainage)`
  - `bufferRoom = max(0, treeWaterCapacity - max(0, treeWater - transpiration))`
  - `rootCap = dailyWaterNeed × MAX_UPTAKE_FRACTION × rootAbsorptionCapacity × stepDays`
- **Runoff** = `max(0, postUptakeSoil - SOIL_WATER_CAPACITY)` (excess leaves
  the plot).

### Conservation (TDD §18.4 invariant)

```
soilWater_after + treeWater_after + evaporation + drainage + runoff
  + transpiration
= soilWater_before + treeWater_before + rainfall + irrigation
```

The `treeUptake` term cancels — it moves water from the soil pool to the tree
buffer (a transfer, not a loss). This is the GDD §10.1 contract that "water
flows through the system" (TDD §8.1: "Rainfall / Irrigation in;
Evaporation / Drainage / Plant uptake / Runoff out").

`env.freshwater.availability` is kept in sync with the soil water + groundwater
via `computeFreshwaterAvailability` (soilWater + 0.1 × groundwater — groundwater
is less accessible than soil water). BiologySystem no longer reads this field
directly; the schema field is kept for downstream consumers (none in P2) and
for v3 → v4 migrated saves.

### Per-tree uptake is Liebig-capped

Tree uptake is `min(rootCap, availableForUptake, bufferRoom)`:

- **Root cap** — a sapling root (absorptionCapacity = 0.3) absorbs
  proportionally less than a mature root (1.0). Decoupled from transpiration
  (`MAX_UPTAKE_FRACTION = 1.5`) so the buffer can refill faster than it drains.
- **Soil water** — uptake is limited by what's actually in the soil (a tree
  cannot drink from an empty soil; drought stress emerges naturally).
- **Buffer room** — uptake stops when the tree's internal water buffer is
  full (the tree cannot absorb more water than its storage can hold).

This is the GDD §10.1 rule: per-tree uptake limited by root capacity AND soil
water (Liebig). Excess water in either dimension does NOT increase growth
beyond the bottleneck.

### Pure functions

- `computeWaterBalance({ soilWater, treeWater, treeWaterCapacity,
  dailyWaterNeedL, rainfall, evaporationRatePerDay, rootAbsorptionCapacity,
  stepDays })` → `WaterBalance`
- `applyWaterBalance(env, tree, balance)` — mutates `env.soil.soilWater`,
  `env.freshwater.groundwater`, `env.freshwater.availability`, and
  `tree.water.stored`. Caller deep-copies state first.
- `applyWaterToSoil(soilWaterBefore, litres, capacity, at)` — used by the
  `apply-water` action handler; returns soil water after + runoff.
- `computeSoilEvaporationRate(weatherEvent, localTempC)` — wraps
  `weather.computeEvaporationRate` with the resource module's base rate.

---

## 4. Nutrient model (TDD §8.2, GDD §10.1)

**File:** `packages/simulation/src/resources/nutrients.ts`.

The nutrient model tracks N, P, K in TWO coupled pools:

```
SOIL NUTRIENT POOL (env.soil.nutrients):
  - Inputs: fertilizer (from apply-fertilizer action), background
    replenishment (mineral weathering + organic matter decomposition).
  - Outputs: leaching (when soil is saturated — GDD §10.3 environmental
    feedback), tree absorption (transferred to tree buffer).

TREE NUTRIENT BUFFER (originalTree.nutrients):
  - Inputs: absorption from soil (Liebig-capped by root capacity + soil
    nutrient availability).
  - Outputs: consumption (scales with foliage).
```

Per-step balance per nutrient (N, P, K):

```
soilNutrient' = max(0, soilNutrient + replenished - leached - treeAbsorbed)
treeNutrient' = max(0, treeNutrient - consumed + treeAbsorbed)
```

Where:

- `replenished = REPLENISH_PER_DAY × SOIL_NUTRIENT_CAPACITY × stepDays`
- `leached = soilNutrient × leachRate × stepDays`
  where `leachRate = LEACHING_RATE × saturationFraction` (saturation scaled
  by soil water content; **zero below field capacity**).
- `consumed = species.nutrientRequirement.X × foliageFraction × stepDays`
  (foliageFraction = `currentLeaves / speciesMaxFoliage`, matching the
  biology module's `dailyWaterNeed` scaling).
- `treeAbsorbed = min(rootCap × stepDays, soilNutrientAfterLeach)`
  where `rootCap = species.nutrientRequirement.X × foliageFraction
  × MAX_UPTAKE_FRACTION × rootAbsorptionCapacity`.

### Conservation

```
soilNutrient_after + treeNutrient_after + leached + consumed
= soilNutrient_before + treeNutrient_before + replenished
```

The `treeAbsorbed` term cancels — it moves nutrients from the soil pool to
the tree buffer (a transfer, not a loss).

### Fertilizer products are data (TDD §8.2)

Each fertilizer is a pure data object in
`packages/content/src/fertilizers/`:

| Fertilizer | N | P | K | Contamination / unit | Organic matter / unit |
|---|---|---|---|---|---|
| `fertilizer:balanced-10-10-10` | 10 | 10 | 10 | 0.5 | 0 |
| `fertilizer:urea-46-0-0` | 46 | 0 | 0 | 0.8 | 0 |
| `fertilizer:compost` | 2 | 1 | 2 | 0.05 | 5 |

Each unit of fertilizer adds the full NPK composition to the soil. If the
soil is at nutrient capacity, the excess is converted to contamination
(GDD §8.3 over-application harm). The contamination scales linearly with
soil saturation: at zero capacity, all excess becomes contamination; at full
capacity, the contamination is the full `contaminationPerUnit`.

Adding a new fertilizer means appending to `ALL_FERTILIZERS` in
`packages/content/src/fertilizers/index.ts` — the engine code stays fixed
(rule 5: content is data).

### Over-application harms soil (GDD §8.3)

The `applyFertilizer` pure function enforces:

- `nutrientsAfter.X = min(capacity, nutrientsBefore.X + npk.X × units)` per
  nutrient.
- `nutrientsOverflowed.X = max(0, npk.X × units - nutrientsAdded.X)`.
- `contaminationFromOverflow = totalOverflow × CONTAMINATION_PER_EXCESS_NUTRIENT
  × soilSaturationFraction`.
- `contaminationIntrinsic = fertilizer.composition.contaminationPerUnit × units`
  (always added — captures the rule that "excessive or inappropriate
  application can damage soil or contaminate surrounding environments",
  independent of soil capacity).

The unit test "over-application (above capacity) adds contamination from
overflow" asserts this directly.

### Slow-release is a stub

`fertilizer.composition.slowReleaseFraction` exists in the schema (default
`1.0` = all immediate) but P2 treats all fertilizer as immediately
bioavailable. Slow-release dynamics are an extension point (TDD §8.2
"Additional nutrients can be added later"); the schema field is in place so
future content / systems can read it without another migration.

---

## 5. Soil derived health (TDD §8.3, GDD §10.1)

**File:** `packages/simulation/src/resources/soil.ts`.

Soil health is a DERIVED indicator — it is NOT an independent stat. It is
recomputed each tick by `computeSoilHealth(env)`:

```
health = w_organic * organicFrac
       + w_nutrients * nutrientFrac
       + w_moisture * moistureFrac
       + w_contamination * (1 - contaminationFrac)
       + w_ph * phFrac                     // stub: 1.0 (extension point)
       + w_compaction * (1 - compactionFrac)  // stub: 1.0
       + w_microbial * microbialFrac       // stub: 1.0
```

Where each `*Frac` is in `[0, 1]`. Weights sum to 1.0 (defined in
`PROVISIONAL_RESOURCE_SOIL_HEALTH_WEIGHTS`). Stubbed factors (pH, compaction,
microbial activity) contribute their full weight (factor = 1.0) until P6+
extends them — keeping the derived health in a sensible range.

| Factor | Computation | Weights |
|---|---|---|
| Organic matter | `min(1, organicMatter / ORGANIC_MATTER_SATURATION)` | 0.25 |
| Nutrients | Liebig min of N, P, K vs capacity | 0.30 |
| Moisture | triangle: 0 at 0%, 1 at IDEAL%, 0 at 100% | 0.20 |
| Contamination | `1 - min(1, contamination / CONTAMINATION_FULL_DEGRADE)` | 0.15 |
| pH | stub = 1.0 (P6+) | 0.10 |
| Compaction | stub = 1.0 (P6+) | 0.00 |
| Microbial | stub = 1.0 (P6+) | 0.00 |

The schema fields for `ph`, `compaction`, `microbialActivity` exist on
`EnvironmentState.soil` so future systems can read them; P2 leaves them at
neutral defaults (`ph = 6.5`, `compaction = 0`, `microbialActivity = 1.0`).

The ResourceSystem recomputes `env.soil.health` each tick (step 5 in the
pipeline below).

---

## 6. Weather (TDD §9, GDD §4.3)

**Files:** `packages/simulation/src/weather/*` (engine),
`packages/content/src/weather/*` (data).

### Weather conditions

Nine conditions per GDD §4.3, defined as a tuple in
`packages/shared/src/schemas/weather.ts`:

```typescript
WEATHER_CONDITIONS = [
  'sunny',
  'cloudy',
  'rain',
  'heavy-rain',
  'drought',
  'frost',
  'heat-wave',
  'wind',
  'severe-storm',
] as const;
```

### WeatherState (TDD §9.1)

```typescript
interface WeatherState {
  condition: WeatherCondition;
  temperature: number;      // °C, local — derived from climate baseline + condition delta + intensity
  intensity: number;       // [0, 1] — how strong the condition is
  prevCondition: WeatherCondition | null;
  daysInCondition: number; // counts consecutive days in the current condition
}
```

Lives at `state.world.weather`. Written once per step by WeatherSystem (slot
#2). Read by ResourceSystem (slot #4) for rainfall + evaporation input; read
indirectly by BiologySystem (slot #3) via `environment.globalTemperature`
(R-P2-1 backwards-compat shim); read by P4's renderer (to display weather).

### Markov chain weather transitions (TDD §9.1)

Weather follows a Markov chain: each step the next condition is picked from a
per-season transition matrix. The matrix is content data
(`packages/content/src/weather/transition-matrices.ts`); the engine module
`packages/simulation/src/weather/markov.ts` is the pure engine that rolls the
dice.

**Staleness handling:** if `daysInCondition` exceeds
`PROVISIONAL_WEATHER_MAX_DAYS_IN_CONDITION` (14 days), the "stay" entry
(current → current) is reduced by `PROVISIONAL_WEATHER_STALENESS_BIAS` (0.3),
and the residual is redistributed proportionally across the other transitions.
This prevents indefinite runs of any single condition (especially severe
storms / droughts / frosts).

Each transition matrix row MUST sum to ~1.0 (validated at module load — a
malformed matrix fails fast rather than producing weird weather).

P2 ships one matrix set for the temperate climate (`climate:temperate`).
P6/P9 will add regional matrices; the engine code stays fixed.

### Per-condition static effects (TDD §9.3)

Each condition has a `WeatherEventDefinition` (pure data in
`packages/content/src/weather/event-definitions.ts`):

```typescript
interface WeatherEventDefinition {
  condition: WeatherCondition;
  label: string;
  rainfallLPerDay: number;
  evaporationMultiplier: number;
  lightFactorMultiplier: number;
  temperatureDeltaC: number;
  canDamage: boolean;
  damageType?: 'storm' | 'frost' | 'heat' | 'wind' | 'drought';
}
```

The values mirror the constants in `packages/shared/src/constants/resources.ts`
(`PROVISIONAL_WEATHER_RAINFALL_L_PER_DAY`, etc.) but are exposed as data so
future climates / mods can override per-condition behaviour without touching
engine code (rule 5: content is data).

### Climate baseline (TDD §9.2, GDD §10.2)

Each region has a `ClimateBaseline` (pure data in
`packages/content/src/weather/climate-baselines.ts`):

```typescript
interface ClimateBaseline {
  id: string;                      // 'climate:temperate'
  name: string;
  seasonalBaseTemp: { spring, summer, autumn, winter };  // °C
  climateShiftHook: {
    baselineTempC: number;             // global average (~14°C)
    tempShiftPerDegreeC: number;       // 1:1 warming → baseline shift
    droughtProbShiftPerDegreeC: number; // 2% more drought per degree
  };
}
```

P2 ships a single baseline (`climate:temperate`, USDA hardiness zone 5-6 —
roughly southern Ontario / upstate NY / central Europe). P6/P9 add regional
climate data; the engine code stays fixed.

**Climate-shift hook:** the hook is in place but the actual shift is a no-op
in P2. When P6's `EnvironmentSystem` raises
`environment.globalTemperature` above the baseline (~14°C), a future revision
of WeatherSystem will shift the baseline temperatures and transition
probabilities. P2 leaves the hook to keep the schema stable across phases.
See R-P2-3.

### Local temperature derivation

```typescript
localTemp = climate.seasonalBaseTemp[season]
          + eventDef.temperatureDeltaC × (0.5 + intensity × 0.5)
```

At `intensity = 0`, the delta is halved (50% effect). At `intensity = 1`, the
delta is full. A high-intensity heat wave is hotter than a weak one; a
high-intensity frost is colder.

### RNG + persistence (TDD §18.3)

WeatherSystem consumes a `Rng` forked from the root RNG via
`ctx.rng.fork('WeatherSystem')` on the FIRST tick. The child's state is then
persisted on `state.rngStreams.weather` (a new top-level GameState field added
by P2). On subsequent ticks, WeatherSystem restores the child from
`state.rngStreams.weather` and continues the sequence. This makes the weather
sequence reproducible given seed + step count — the same seed + same step count
always produces the identical weather sequence, even across save/load.

```typescript
// First tick:
const weatherRng = ctx.rng.fork('WeatherSystem');
// ... use weatherRng ...
state.rngStreams.weather = weatherRng.getState();

// Subsequent ticks:
const weatherRng = Rng.fromState(state.rngStreams.weather);
// ... use weatherRng ...
state.rngStreams.weather = weatherRng.getState();
```

If `rngStreams.weather` is the zero state (e.g. a v3 save migrated to v4),
WeatherSystem forks fresh from the root RNG. This is the migration path: v3
saves don't have the field, so the migration backfills `[0, 0, 0, 0]`, and
WeatherSystem initializes the sub-stream on first tick.

The persistence is verified by `weather.test.ts`:
> save->load->advance 1000 == advance 2000 from start (weather)

---

## 7. WeatherSystem pipeline (slot #2)

**File:** `packages/simulation/src/systems/weather-system.ts`.

Each step:

1. Restore the persisted weather RNG sub-stream from
   `state.rngStreams.weather`. If zero (uninitialized, e.g. a migrated v3
   save), fork from the root RNG to seed it.
2. Look up the active climate baseline + transition matrix by season.
3. Roll the Markov chain to pick the next condition.
4. Roll a fresh intensity in `[0, 1]`.
5. Compute the local temperature (climate baseline + condition delta,
   intensity-modulated).
6. Update `state.world.weather.{condition, temperature, intensity,
   prevCondition, daysInCondition}`.
7. **R-P2-1 (resolved P7d):** NO LONGER mirrors the local temperature to
   `state.world.environment.globalTemperature`. The EnvironmentSystem (slot
   #10) owns the climate-scale `globalTemperature` via the climate model
   (`stepTemperature`); the previous per-tick mirror dominated the
   climate-driven trajectory. WeatherSystem writes ONLY the weather-scale
   `state.world.weather.temperature`.
8. If the new condition is damage-capable and intensity exceeds the threshold
   (`PROVISIONAL_WEATHER_DAMAGE_INTENSITY_THRESHOLD` = 0.6), emit a
   `weather-damage` event.
9. If the condition changed, emit a `weather-changed` event.
10. Persist the weather RNG sub-stream back to `state.rngStreams.weather`.

The system is pure: it deep-copies the input state, mutates the copy, and
returns the new state. The input is NEVER mutated.

---

## 8. ResourceSystem pipeline (slot #4)

**File:** `packages/simulation/src/systems/resource-system.ts`.

Runs once per simulation step AFTER BiologySystem so the resource model reacts
to the new weather + the tree's just-computed biological activity.

Each step:

1. Read the weather (just produced by WeatherSystem).
2. **Water balance** (coupled soil + tree pools):
   - Inputs: rainfall (from weather), irrigation (already applied by the
     `apply-water` action handler — appears in `env.soil.soilWater`).
   - Outputs: evaporation (temp-modulated), drainage (recharges groundwater),
     tree uptake (Liebig-capped by root capacity + soil water + buffer room;
     transferred to `tree.water.stored`), runoff (excess above capacity).
   - Tree transpiration: removed from `tree.water.stored` (the tree's
     consumption, based on `dailyWaterNeed` from the biology module).
   - Apply the balance to `env.soil.soilWater`, `env.freshwater.groundwater`,
     `env.freshwater.availability`, AND `originalTree.water.stored`.
3. **Nutrient balance** (coupled soil + tree pools):
   - Soil: replenishment (slow background mineral weathering) + leaching
     (when soil is saturated — GDD §10.3).
   - Tree: consumption (scales with foliage) + absorption (Liebig-capped by
     root capacity + soil nutrients).
   - Apply the balance to `env.soil.nutrients` AND `originalTree.nutrients`.
4. Add organic matter replenishment (slow background decomposition).
5. Recompute derived soil health from organic matter, nutrients, moisture,
   contamination (+ stubbed extension-point factors).
6. Emit `resource-notification` events for adverse conditions (low soil water,
   high contamination, low soil health).

If the tree is dead, it no longer transpires or absorbs. Soil still evolves
(rainfall, evaporation, drainage, leaching) but tree uptake is zero.

---

## 9. Provisional constants (GDD §17)

All P2 tuning constants live in
`packages/shared/src/constants/resources.ts` (and a few in
`provisional.ts`). Each is marked with a `// PROVISIONAL (GDD §17: <item>)`
comment pointing at the unresolved design decision it resolves.

### Water model

| Constant | Default | Resolves |
|---|---|---|
| `PROVISIONAL_RESOURCE_SOIL_WATER_CAPACITY` | `150` L/m² | GDD §17: detailed resource simulation equations |
| `PROVISIONAL_RESOURCE_DRAINAGE_RATE_PER_DAY` | `0.05` | GDD §17: detailed resource simulation equations |
| `PROVISIONAL_RESOURCE_EVAPORATION_RATE_PER_DAY` | `0.02` | GDD §17: detailed resource simulation equations |
| `PROVISIONAL_RESOURCE_EVAPORATION_BASE_TEMP_C` | `15` | GDD §17: detailed resource simulation equations |
| `PROVISIONAL_RESOURCE_MAX_UPTAKE_FRACTION` | `1.5` | GDD §17: detailed resource simulation equations |
| `PROVISIONAL_RESOURCE_INITIAL_SOIL_WATER` | `100` L | GDD §17: detailed resource simulation equations |
| `PROVISIONAL_RESOURCE_INITIAL_FRESHWATER_AVAILABILITY` | `1000` L | GDD §17: detailed resource simulation equations |
| `PROVISIONAL_RESOURCE_INITIAL_GROUNDWATER` | `500` L | GDD §17: detailed resource simulation equations |

### Nutrient model

| Constant | Default | Resolves |
|---|---|---|
| `PROVISIONAL_RESOURCE_LEACHING_RATE_PER_DAY` | `0.10` | GDD §17: detailed resource simulation equations |
| `PROVISIONAL_RESOURCE_NUTRIENT_REPLENISH_PER_DAY` | `0.001` | GDD §17: detailed resource simulation equations |
| `PROVISIONAL_RESOURCE_SOIL_NUTRIENT_CAPACITY` | `200` | GDD §17: detailed resource simulation equations |
| `PROVISIONAL_RESOURCE_CONTAMINATION_PER_EXCESS_NUTRIENT` | `0.05` | GDD §17: detailed resource simulation equations |
| `PROVISIONAL_RESOURCE_INITIAL_SOIL_NUTRIENTS` | `{N:50, P:50, K:50}` | GDD §17: detailed resource simulation equations |
| `PROVISIONAL_RESOURCE_INITIAL_ORGANIC_MATTER` | `50` | GDD §17: detailed resource simulation equations |
| `PROVISIONAL_RESOURCE_ORGANIC_MATTER_REPLENISH_PER_DAY` | `0.001` | GDD §17: detailed resource simulation equations |

### Soil health derivation

| Constant | Default | Resolves |
|---|---|---|
| `PROVISIONAL_RESOURCE_SOIL_HEALTH_WEIGHTS` | `{om:0.25, n:0.30, m:0.20, c:0.15, ph:0.10, compaction:0.00, microbial:0.00}` | GDD §17: detailed resource simulation equations |
| `PROVISIONAL_RESOURCE_ORGANIC_MATTER_SATURATION` | `100` | GDD §17: detailed resource simulation equations |
| `PROVISIONAL_RESOURCE_IDEAL_SOIL_WATER_FRACTION` | `0.5` | GDD §17: detailed resource simulation equations |
| `PROVISIONAL_RESOURCE_CONTAMINATION_FULL_DEGRADE` | `100` | GDD §17: detailed resource simulation equations |

### Weather model

| Constant | Default | Resolves |
|---|---|---|
| `PROVISIONAL_WEATHER_DEFAULT_CLIMATE_ID` | `'climate:temperate'` | GDD §17: detailed climate model |
| `PROVISIONAL_WEATHER_INITIAL_CONDITION` | `'sunny'` | GDD §17: detailed climate model |
| `PROVISIONAL_WEATHER_INITIAL_INTENSITY` | `0.5` | GDD §17: detailed climate model |
| `PROVISIONAL_WEATHER_MAX_DAYS_IN_CONDITION` | `14` | GDD §17: detailed climate model |
| `PROVISIONAL_WEATHER_STALENESS_BIAS` | `0.3` | GDD §17: detailed climate model |
| `PROVISIONAL_WEATHER_CLIMATE_SHIFT_BASELINE_TEMP_C` | `14` | GDD §17: detailed climate model |
| `PROVISIONAL_WEATHER_TEMP_DELTAS_C` | per-condition table | GDD §17: detailed climate model |
| `PROVISIONAL_WEATHER_RAINFALL_L_PER_DAY` | per-condition table | GDD §17: detailed climate model |
| `PROVISIONAL_WEATHER_EVAPORATION_MULT` | per-condition table | GDD §17: detailed climate model |
| `PROVISIONAL_WEATHER_LIGHT_FACTOR_MULT` | per-condition table | GDD §17: detailed climate model |
| `PROVISIONAL_WEATHER_DAMAGE_INTENSITY_THRESHOLD` | `0.6` | GDD §17: detailed climate model |
| `PROVISIONAL_WEATHER_DAMAGE_SEVERITY_SCALE` | `0.5` | GDD §17: detailed climate model |

When a value is promoted from "provisional" to "decided" via playtesting,
it moves to a sibling `decided.ts` and the `PROVISIONAL_` prefix is dropped
(per `docs/simulation.md` §12 convention).

---

## 10. Schema migration (v3 → v4)

`CURRENT_SCHEMA_VERSION` is bumped from `3` to `4` in
`packages/shared/src/constants/provisional.ts`. The v3 → v4 migration
(`packages/shared/src/migrations/defaults.ts`) is pure and backfills four
new GameState shapes:

1. **`world.weather: WeatherState`** — defaults to `{condition: 'sunny',
   temperature: 18, intensity: 0.5, prevCondition: null, daysInCondition: 0}`
   (a sunny spring day at 18 °C — matches P1's day-0 starting temperature).
2. **`rngStreams.weather: RngState`** — defaults to `[0, 0, 0, 0]`
   (WeatherSystem initializes the sub-stream on first tick if zero).
3. **`world.environment.soil.soilWater: number`** — defaults to
   `PROVISIONAL_RESOURCE_INITIAL_SOIL_WATER` (100 L).
4. **`world.environment.soil.{ph, compaction, microbialActivity}: number`**
   — extension-point stubs for the soil health derivation; defaults to
   `6.5 / 0 / 1.0` respectively.

Each field is backfilled only if missing — fields added by other migrations
or by a v3+ save that already includes them are left untouched. This makes the
migration idempotent under repeated application (defensive — the migration
framework doesn't re-run migrations, but tests do).

The migration does NOT touch `originalTree.id` or `originalTree.isOriginal`
(GDD §16.1/16.2). The schema superRefine continues to enforce those
invariants after migration.

---

## 11. Test coverage

P2 ships **85 new tests** across four files (233 total in the repo):

- `packages/simulation/test/resources.test.ts` — 38 unit tests of the pure
  resource functions: water balance conservation, nutrient balance
  conservation, fertilizer application, over-application contamination, soil
  health derivation, evaporation, leaching, Liebig-style uptake caps.
  Maps to TDD §18.1's resource invariants.
- `packages/simulation/test/weather.test.ts` — 33 tests of the pure weather
  functions + WeatherSystem integration via `engine.advance`: Markov chain
  transitions, staleness bias, local temperature derivation, rainfall +
  evaporation scaling, damage thresholds, per-season distribution sanity over
  5 sim years, determinism, RNG-state persistence across save/load.
- `packages/simulation/test/resources-system.test.ts` — 12 integration tests
  of the full ResourceSystem + WeatherSystem pipeline via `engine.advance`
  and `engine.executeAction`: water + nutrient bounds over a season, derived
  soil health recomposition, `apply-water` and `apply-fertilizer` action
  handlers (including capacity caps, contamination on over-application),
  resource-notification emission under stress, determinism across save/load.
- `packages/shared/test/migrations.test.ts` — 2 new tests covering the
  v3 → v4 migration (backfill + idempotency).

The TDD §21 acceptance criteria addressed by P2:

| # | Criterion | P2 Status |
|---|---|---|
| 8 | Water and nutrient cycles function correctly. | **PASS** — water balance conserves (8 tests); nutrient balance conserves (8 tests); excess fertilizer raises contamination (4 tests). |
| 9 | Weather affects tree growth. | **PARTIAL** — weather drives rainfall + evaporation + temperature + damage events; BiologySystem reads temperature via `environment.globalTemperature` (mirrored from `state.world.weather.temperature`); biology reading `state.world.weather.condition` directly is R-P2-1. |
| 18 | Simulation results are deterministic. | **PASS** — same seed → identical state + events; save/load preserves weather RNG position (3 tests). |

---

## 12. Headless sanity script

`packages/simulation/scripts/perf-check.ts` boots the engine with the default
`GameConfig` (White Oak sapling), advances the simulation by several in-game
years under the real WeatherSystem + ResourceSystem (no stubs), and prints:

- Initial + final soil water, soil nutrients (N/P/K), organic matter,
  contamination, derived health.
- Initial + final tree water, tree nutrients.
- Initial + final weather condition + temperature + intensity.
- Persisted weather RNG sub-stream state.
- Per-season weather distribution over the run.
- Invariant checks (finite, non-negative, capacity-bounded, health in [0,1]).
- Determinism check (same seed → identical state).
- Save/load round-trip determinism check (save halfway → load → advance →
  equal to straight-through advance).

Sample output (2 sim years, seed 42):

```
--- Per-season weather distribution (over 2 sim years) ---
  spring   total=60  sunny=31.7%  cloudy=31.7%  rain=20.0%  ...  frost=8.3%  wind=8.3%
  summer   total=60  sunny=36.7%  cloudy=21.7%  rain=16.7%  ...  drought=15.0%  heat-wave=5.0%
  autumn   total=60  sunny=25.0%  cloudy=38.3%  rain=16.7%  ...  wind=13.3%  severe-storm=1.7%
  winter   total=60  sunny=16.7%  cloudy=35.0%  rain=10.0%  ...  frost=21.7%  heavy-rain=10.0%
```

The seasonal distribution matches the design intent in the transition
matrices: summer has more sunny than winter, winter has more frost than
summer, severe storms are rare (< 2%), autumn has more wind than summer.

```
pnpm tsx packages/simulation/scripts/perf-check.ts [years] [seed]
# defaults: 5 years, seed 42
```

The script is a CLI tool (uses `console.log` for stdout); the import-boundary
test walks `packages/simulation/src/` only, so it never impacts the
simulation's purity contract.

---

## 13. Gaps and out-of-scope items

P2 is **strictly within scope** (TDD Milestone 6 partial: Environmental
Simulation — water + nutrients + soil + weather). The following are
explicitly **deferred** to later phases:

- **Climate shift hook is a no-op.** P2 leaves the `ClimateBaseline.climateShiftHook`
  in place; P6's `EnvironmentSystem` will plumb a real globalTemperature
  trajectory (driven by emissions + sequestration) and WeatherSystem will
  apply the shift. See R-P2-3.
- **Weather-damage events emitted but not consumed by biology.** WeatherSystem
  emits `weather-damage` when a damage-capable condition exceeds the
  intensity threshold. P1 (or a future biology refactor) records the
  appropriate `tree.damage[]` entry from the event payload. P2 does NOT
  modify `tree.damage[]` directly — biology is the only writer to TreeState
  biology fields (rule: rendering reads, never writes; biology is internally
  consistent; GDD §5.1). See R-P2-2.
- **Biology reads `state.world.weather.condition` indirectly.** P1's
  photosynthesis reads `environment.globalTemperature` for the temperature
  Liebig factor. P2's WeatherSystem mirrors `state.world.weather.temperature`
  to `environment.globalTemperature` each tick so biology keeps working
  unchanged. A future refactor of biology to read `state.world.weather.*`
  directly (light factor multiplier, condition-based damage) is R-P2-1.
- **Soil pH / compaction / microbial dynamics.** P2 leaves the schema fields
  in place but the soil health derivation uses stub factors (factor = 1.0).
  P6+ will model pH dynamics (acid rain, liming), compaction (equipment
  traffic), and microbial dynamics (compost tea, fungicides).
- **Slow-release fertilizer.** P2 treats all fertilizer as immediately
  bioavailable. The schema field `slowReleaseFraction` exists; future content
  / systems can use it without another migration.
- **Personal cash + inventory transactions for `apply-water` /
  `apply-fertilizer`.** P2 only mutates the soil state. P3's EconomySystem
  will hook into the `water-applied` / `fertilizer-applied` events to drain
  the player's cash and inventory.
- **Regional environments.** P2 ships a single climate (`climate:temperate`)
  + transition matrix set. P6/P9 add regional climate data; the engine code
  stays fixed (rule 5: content is data).

---

## 14. Carry-forward (R) items for later phases

These are items the spec called out as carry-forward / migration concerns
that downstream agents should be aware of:

- **R-P2-1: BiologySystem reads weather indirectly via
  `environment.globalTemperature` — mirror RESOLVED in P7d.** P1's
  `photosynthesis.ts` `temperatureFactor` reads `ctx.environment.globalTemperature`.
  P2's WeatherSystem originally mirrored the per-step local temperature
  (`state.world.weather.temperature`) to `environment.globalTemperature` each
  tick so biology kept working unchanged. P7d removed the mirror: the
  EnvironmentSystem (slot #10) now owns `globalTemperature` via the climate
  model (`stepTemperature`), so the climate-driven trajectory is no longer
  dominated by the weather signal (see `docs/environment.md` §6 + R-P7-2).
  BiologySystem reads the climate-scale `globalTemperature` (seeded at 18 °C,
  evolved by forcing + thermal inertia); a one-tick lag on tick 0 is
  acceptable for a slowly-evolving climate variable. A future refactor of
  biology to read `state.world.weather.{condition, temperature, intensity}`
  directly (for cloud-cover light modulation, frost damage, etc.) remains open
  but no longer blocks the climate model. P3 (EconomySystem) and P4 (renderer)
  may also read `state.world.weather` directly.
- **R-P2-2: `weather-damage` events are emitted but not yet consumed.** P2's
  WeatherSystem emits a `weather-damage` event whenever a damage-capable
  condition (severe storm, frost, heat wave, wind, drought) exceeds the
  intensity threshold (`PROVISIONAL_WEATHER_DAMAGE_INTENSITY_THRESHOLD`).
  The event payload carries `{condition, intensity, damageType, severity,
  treeIds}`. P1 (or a future biology refactor) records the appropriate
  `tree.damage[]` entry from the payload; P2 does NOT modify `tree.damage[]`
  directly (biology is the only writer to TreeState biology fields).
- **R-P2-3: Climate-shift hook is a no-op.** The `ClimateBaseline.climateShiftHook`
  field exists in the schema but WeatherSystem does NOT apply the shift yet.
  P6's `EnvironmentSystem` will plumb a real globalTemperature trajectory
  (driven by `atmosphere.emissions` + `atmosphere.sequestration`); a future
  revision of WeatherSystem will shift the baseline temperatures and
  transition probabilities based on the hook's parameters.
- **R-P2-4: GameState shape changed in P2** — `world.weather`, `rngStreams.weather`,
  `world.environment.soil.{soilWater, ph, compaction, microbialActivity}`.
  Schema version bumped 3 → 4 with one pure migration registered
  (`v3ToV4`) in `packages/shared/src/migrations/defaults.ts`. Existing
  migration order is unchanged. P3+ agents that change the shape must bump
  `CURRENT_SCHEMA_VERSION` again and register a new migration.
- **R-P2-5: `apply-water` / `apply-fertilizer` actions emit events but
  don't move money.** P2 only mutates soil state + emits
  `water-applied` / `fertilizer-applied` events. P3's EconomySystem
  will drain the player's cash + inventory based on the event payloads.
- **R-P2-6: `pendingIssuances` queue on `originalTree` is the P1 ↔ P3
  contract.** P2's ResourceSystem does NOT touch this queue. P3's
  EconomySystem drains it each tick.
- **R-P2-7: WeatherSystem uses a persisted RNG sub-stream.** Unlike
  BiologySystem's mortality RNG (which is a stateless per-step fork —
  see `docs/biology.md` R5), WeatherSystem persists its child RNG state
  on `state.rngStreams.weather` so the Markov chain sequence survives
  save/load. Future systems that need persistent sub-streams (e.g. a
  pest-outbreak RNG in P6+) should add fields to `rngStreams`.

---

## 15. File map

```
packages/
├── content/src/
│   ├── fertilizers/                       # NEW (P2) — fertilizer data
│   │   ├── balanced-10-10-10.ts            #   Balanced 10-10-10 NPK
│   │   ├── urea-46-0-0.ts                 #   Urea 46-0-0 (nitrogen)
│   │   ├── compost.ts                     #   Compost (organic matter)
│   │   └── index.ts                        #   ALL_FERTILIZERS, findFertilizerById
│   ├── weather/                           # NEW (P2) — weather data
│   │   ├── climate-baselines.ts            #   TEMPERATE_CLIMATE, findClimateById
│   │   ├── event-definitions.ts            #   WEATHER_EVENT_MAP, findWeatherEvent
│   │   ├── transition-matrices.ts         #   ALL_TRANSITION_MATRICES, findTransitionMatrix
│   │   └── index.ts                        #   Public surface
│   └── index.ts                            # MODIFIED — re-exports weather + fertilizers
├── shared/src/
│   ├── constants/
│   │   ├── resources.ts                    # NEW (P2) — resource + weather provisional constants
│   │   ├── provisional.ts                  # MODIFIED — CURRENT_SCHEMA_VERSION=4, weather constants
│   │   └── index.ts                        # MODIFIED — re-exports resources.ts
│   ├── schemas/
│   │   ├── weather.ts                      # NEW (P2) — WeatherState, ClimateBaseline, WeatherEventDefinition, WeatherTransitionMatrix
│   │   ├── fertilizer.ts                   # NEW (P2) — Fertilizer, FertilizerApplicationResult, WaterApplicationResult
│   │   ├── actions-resources.ts            # NEW (P2) — ApplyWaterAction, ApplyFertilizerAction
│   │   ├── events-resources.ts             # NEW (P2) — weather-damage, water-applied, fertilizer-applied, resource-notification
│   │   ├── environment.ts                  # MODIFIED — adds world.weather, soil.soilWater, soil.{ph, compaction, microbialActivity}
│   │   ├── actions.ts                      # MODIFIED — adds apply-water, apply-fertilizer to GameAction union
│   │   ├── events.ts                       # MODIFIED — adds resource + weather events to SimulationEvent union
│   │   ├── game-state.ts                   # MODIFIED — adds rngStreams field with weather sub-stream
│   │   └── index.ts                        # MODIFIED — re-exports new schemas
│   └── migrations/
│       └── defaults.ts                     # MODIFIED — registers v3ToV4
└── simulation/src/
    ├── resources/                         # NEW (P2) — pure resource functions
    │   ├── water.ts                        #   Water balance + applyWaterBalance
    │   ├── nutrients.ts                    #   Nutrient balance + applyFertilizer + applyWaterToSoil
    │   ├── soil.ts                         #   Derived soil health
    │   ├── types.ts                        #   ResourceContext
    │   └── index.ts                        #   Public surface
    ├── weather/                           # NEW (P2) — pure weather functions
    │   ├── markov.ts                       #   pickNextCondition (Markov chain)
    │   ├── effects.ts                      #   computeLocalTemperature, computeRainfall, computeEvaporationRate, shouldEmitDamage, computeDamageSeverity
    │   ├── types.ts                        #   WeatherContext
    │   └── index.ts                        #   Public surface
    ├── systems/
    │   ├── weather-system.ts              # REPLACES STUB (P2) — the only writer to state.world.weather + rngStreams.weather
    │   ├── resource-system.ts             # REPLACES STUB (P2) — the only writer to soil.{soilWater, nutrients, contamination, organicMatter, health}, freshwater, tree.water.stored, tree.nutrients
    │   ├── biology-system.ts              # MODIFIED — removes applyPlaceholderResources (P1 stopgap); documents P2 contract (R-P2-1)
    │   ├── stubs.ts                        # MODIFIED — removes weatherSystem, resourceSystem exports
    │   └── index.ts                        # MODIFIED — imports weatherSystem, resourceSystem from new files (registry order unchanged)
    ├── actions/
    │   └── handlers.ts                     # MODIFIED — adds applyWaterHandler, applyFertilizerHandler
    ├── initial-state.ts                   # MODIFIED — seeds world.weather, rngStreams.weather, soil.soilWater, soil.{ph, compaction, microbialActivity}
    ├── index.ts                            # MODIFIED — re-exports resources + weather modules
    ├── scripts/
    │   └── perf-check.ts                   # NEW (P2) — headless sanity script
    └── test/
        ├── resources.test.ts               # NEW (P2) — 38 unit tests of pure resource functions
        ├── weather.test.ts                 # NEW (P2) — 33 tests of pure weather + WeatherSystem integration
        └── resources-system.test.ts        # NEW (P2) — 12 integration tests via engine.advance + engine.executeAction
```

`docs/resources-weather.md` (this file) is the human-readable model
documentation; the source-of-truth for invariants is the test suite.
