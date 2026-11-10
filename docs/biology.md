# Tree Biology (P1)

**Status:** Source-of-truth documentation for Phase 1 (Tree Biology) of *The Capitalist Tree*.
Pairs with `docs/GDD.txt` §5 (Tree Biology), `docs/TDD.txt` §7 (Biological Simulation),
and `docs/simulation.md` (the engine contract). Where this document and the GDD/TDD
disagree, the GDD/TDD win and a fix must be filed here.

This document covers the **biology model as shipped in P1**. Every numeric
constant referenced is `@provisional` per GDD §17 ("detailed photosynthesis and
energy allocation equations"). Provisional constants live in
`packages/shared/src/constants/biology.ts` and `packages/shared/src/constants/provisional.ts`.

---

## 1. Scope

P1 owns the biological behaviour of the original tree:

- `packages/simulation/src/biology/*` — pure biology functions (photosynthesis,
  energy allocation, reserves, growth, seasons, stress, health, death, harvest).
- `packages/simulation/src/systems/biology-system.ts` — replaces the P0 stub,
  the **only writer** to `TreeState` biology fields (rule: biology is internally
  consistent; rendering reads, never writes; GDD §5.1).
- `packages/simulation/src/systems/harvest-system.ts` — replaces the P0 stub
  with a no-op-for-now system that reserves its slot in the registry for P5
  (scheduled harvesting automation).
- `packages/content/src/species/white-oak.ts` — the first playable species.
- New schema files: `packages/shared/src/schemas/species.ts`,
  `actions-biology.ts`, `events-biology.ts`, `harvest.ts`. Composed into the
  existing `GameAction` / `SimulationEvent` unions without breaking existing
  variants.

P1 does **not** modify rendering, the engine core, the RNG, the scheduler,
other systems' files, or the migration registry's existing entries. The system
registry order is unchanged (TDD §4.2; `docs/simulation.md` §3/§4).

---

## 2. Species choice: White Oak (*Quercus alba*)

The GDD asked for "one initial deciduous temperate species (pick oak or maple)".
P1 ships the **White Oak** (`species:white-oak`).

### Why oak over maple

1. **Longevity gives the maturity mechanic weight.** *Quercus alba* routinely
   lives 200–300 years; `matureAgeDays = 200 × 120 = 24000` sim days (≈ 200 sim
   years at `PROVISIONAL_DAYS_PER_YEAR = 120`). The player watches the tree
   grow over many simulated years before structural growth slows. A maple
   (`Acer spp.`) matures in ~30–80 years — too quick for the maturity curve
   to feel meaningful in the early game.

2. **High reserve capacity makes the "mature tree survives one near-total
   defoliation" scenario (TDD §21 #6) biologically defensible.** Real oaks
   survive severe defoliation events (spongy moth / gypsy moth outbreaks,
   late-spring freezes) and rebound from stored reserves. The TDD §21
   acceptance criteria include exactly this scenario.

3. **Recognisable silhouette** for the P4 renderer — the rounded oak canopy
   is iconic and gives the renderer a strong central visual.

4. **Future reproduction hook.** Acorns are an obvious seed-stock input for
   P6+ (GDD §11.2 Genetic Legacy). Maple seeds (samaras) work too but oaks
   carry the stronger cultural association with "an old tree".

5. **Continuity with P0.** The P0 placeholder was `species:proto-oak`
   (`PROVISIONAL_DEFAULT_SPECIES_ID`). Promoting the placeholder to a real
   White Oak species keeps the default species id changing in only one place.

The species data lives in
`packages/content/src/species/white-oak.ts` (rule 5: content is data, never
hardcoded in the engine). `PROVISIONAL_DEFAULT_SPECIES_ID` in
`packages/shared/src/constants/provisional.ts` points at it.

### Species shape

`TreeSpecies` (see `packages/shared/src/schemas/species.ts`) is the
data-driven species definition (TDD §7.7). Highlights:

- `deciduous: boolean` — whether the species sheds leaves seasonally
  (White Oak: `true`).
- `growthRate: number` — dimensionless multiplier on structural growth.
- `matureAgeDays: number` — when structural growth slows to
  `PROVISIONAL_BIOLOGY_MATURE_GROWTH_FRACTION` of sapling rate.
- `maximumHeight`, `maximumTrunkDiameter`, `maximumBranchDevelopment` —
  species ceiling per dimension (asymptotic growth targets).
- `rootDevelopmentRate`, `reserveCapacity`, `waterRequirement`,
  `nutrientRequirement: NutrientState`.
- `temperatureRange: { minimum, optimum, maximum }` — °C triangle curve.
- `photosynthesisRate`, `leafAreaPerLeaf` — photosynthesis inputs.
- `leafDenominationMinor: string` (bigint-as-string) — currency value of one
  harvested leaf. `@provisional` (GDD §17: initial leaf denomination).
- `leafEnergyCost: number` — eu cost to regrow one leaf. `@provisional`.
- `maximumHarvestFraction: number ∈ [0, 1]` — per-action harvest cap.
  `@provisional` (GDD §17: maximum harvesting rates).
- `initial: SpeciesInitialState` — the sapling state the player starts with
  (used by `initializeState` to seed `originalTree`).

Adding a new species means appending a `TreeSpecies` to
`packages/content/src/species/index.ts` — the engine code stays fixed
(rule 5).

---

## 3. TreeState shape (P4 renders this)

P1 extends `TreeState` (`packages/shared/src/schemas/tree.ts`) with two new
fields over the P0 baseline:

| Field | Type | Notes |
|---|---|---|
| `foliage.leafGrowthProgress` | `number ∈ [0, 1)` | Accumulator for fractional leaf growth so per-step energy isn't wasted when it's too small to grow a whole leaf (a sapling allocates ~0.001 eu/step to leaf growth, but a leaf costs 2 eu). See §6 below. |
| `pendingIssuances` | `CurrencyIssuanceRequest[]` | Queue of currency-issuance requests produced by `harvest-leaves` and drained by P3's `EconomySystem`. P1 does **not** credit the player's cash — it queues the request and emits a `harvest-completed` event so P3 can apply monetary-authority policy. |

The remaining `TreeState` fields are unchanged from the TDD §5.4 shape:
`id`, `speciesId`, `isOriginal`, `ageDays`, `alive`, `structure`
(`height`, `trunkDiameter`, `branchDevelopment`, `structuralIntegrity`),
`foliage` (`currentLeaves`, `leafCapacity`, `activeLeafArea`,
`seasonalCondition`, `leafGrowthProgress`), `roots` (`development`,
`absorptionCapacity`), `energy` (`reserves`, `production`, `consumption`),
`water` (`stored`, `capacity`), `nutrients: NutrientState`,
`health ∈ [0, 1]`, `stress ∈ [0, 1]`, `damage: TreeDamageState[]`,
`pendingIssuances: CurrencyIssuanceRequest[]`.

### Derived vs stored

`health` is **stored** on the tree so consumers (P4 renderer, P3 economy
for risk pricing, UI panels) can read it without recomputing — but it is a
**derived** indicator (GDD §5.1: "Overall health should be calculated from
underlying biological factors rather than serving as an independent magic
statistic"). `BiologySystem` recomputes `health` every tick from
`stress`, `reserveFraction`, and `foliageFraction` (see §7 below). The P0
placeholder value `health = 1` is overwritten on the first
`engine.advance(...)` call.

`activeLeafArea` is similarly derived (recomputed every tick from
`currentLeaves`, `leafAreaPerLeaf`, and `effectiveLeafCondition`).

### Schema migration

Adding two fields required bumping `CURRENT_SCHEMA_VERSION` from 1 to 3
and registering two pure migrations in
`packages/shared/src/migrations/defaults.ts`:

- **v1 → v2** (`v1ToV2`): backfills `originalTree.pendingIssuances = []` if a
  v1 save lacks it.
- **v2 → v3** (`v2ToV3`): backfills
  `originalTree.foliage.leafGrowthProgress = 0` if a v2 save lacks it.

Both migrations are pure and do not touch `originalTree.id` or
`originalTree.isOriginal` (GDD §16.1/16.2). The migration framework is
documented in `docs/simulation.md` §10/§11; existing migrations are not
reordered.

---

## 4. Photosynthesis — Liebig's Law of the Minimum

**File:** `packages/simulation/src/biology/photosynthesis.ts`.

Production (in arbitrary "energy units", eu) per step is:

```
production = MAX_PHOTOSYNTHESIS_RATE
           × species.photosynthesisRate
           × effectiveLeaves
           × min(lightF, tempF, waterF, co2F, nutrientF, leafHealthF)
           × stepDays
```

Where:

- `effectiveLeaves = currentLeaves × effectiveLeafCondition(stress, seasonalCondition)`
  — accounts for both leaf health (driven by stress) and seasonal
  senescence (deciduous). `effectiveLeafCondition` is a weighted blend:
  `leafHealth(stress) × LEAF_HEALTH_WEIGHT + seasonalCondition × SEASONAL_CONDITION_WEIGHT`
  with weights `0.7 / 0.3` (`@provisional`).
- `lightF = DAY_LIGHT_FACTOR (1.0)` during daytime, `NIGHT_PHOTOSYNTHESIS_FRACTION (0.25)`
  at night. P2's `WeatherSystem` will modulate this by cloud cover.
- `tempF` — triangle curve between species' `temperatureRange.minimum`,
  `.optimum`, `.maximum`. Zero outside the range.
- `waterF = min(1, water.stored / dailyWaterNeed)` — excess water doesn't
  help (Liebig).
- `co2F = min(1, co2Concentration / CO2_SATURATION_PPM)` — saturates at 400 ppm.
- `nutrientF = min(N/req_N, P/req_P, K/req_K, 1)` — Liebig min of N, P, K.
- `leafHealthF = 1 - stress` — stressed leaves are less efficient (enters
  twice: once via `effectiveLeafCondition` reducing active leaf area, once
  via the Liebig min reducing per-leaf efficiency; the compounding is
  intentional — severe stress both yellows leaves and impairs metabolism).

### Liebig means no unlimited growth from excess fertilizer

Adding more nutrients when **water** is the limiting factor cannot increase
production. The unit test in `packages/simulation/test/biology.test.ts`
("Liebig: excess fertilizer cannot buy growth when water is limiting")
asserts this directly:

```
lowWater    (water=1,   nutrients=1000/1000/1000) → production X
lowWaterLow (water=1,   nutrients=  5/  2/  4)    → production X  (identical)
```

The same applies for any pair of factors: excess of one cannot compensate
for deficiency of another. This is the core biological consistency rule
(GDD §16.9, §5.2).

### Daily water need scales by species max foliage, not sapling leafCapacity

`dailyWaterNeed(tree, species) = species.waterRequirement × (currentLeaves / speciesMaxFoliage)`
where `speciesMaxFoliage = species.initial.leafCapacity + species.maximumBranchDevelopment × LEAF_CAPACITY_PER_BRANCH`.

This prevents a sapling with 25 leaves from being charged 50 L × (25 / 200)
= 6.25 L/day (which would empty its 50 L water buffer in 8 days). It is
instead charged 50 L × (25 / 10200) ≈ 0.12 L/day, matching the sapling's
small transpiration.

### Deciduous winter dormancy

For deciduous species in winter, `photosynthesisForStep` returns 0 directly
(no foliage, dormant). The seasonal condition target for winter is
`PROVISIONAL_BIOLOGY_DECIDUOUS_SEASONAL_FOLIAGE.winter = 0`.

---

## 5. Energy allocation — survival-first

**File:** `packages/simulation/src/biology/energy-allocation.ts`.

Photosynthetic production is distributed across demands in a **survival-first**
priority (GDD §5.2, TDD §7.3):

1. **Maintenance** (respiration) — always paid. If `production < maintenance`,
   the deficit is drawn from reserves (survival first).
2. **Root growth** \
3. **Trunk growth**    \  Discretionary growth, weighted by
4. **Branch growth**   /  `PROVISIONAL_BIOLOGY_ALLOCATION_WEIGHTS` and
5. **Leaf growth**    /   scaled by the maturity multiplier.
6. **Reproduction** — stub (`weight = 0`). The slot exists so allocation
   math doesn't change when reproduction is added in P6+ (GDD §11.2).
7. **Reserves** — the remainder; capped at reserve capacity.

### Maintenance is biomass-driven, not potential-production-driven

```
maintenance_per_day =
  MAINTENANCE_FRACTION × BIOMASS_MAINTENANCE_RATE × biomassScore
  × tempRespFactor × (1 + stress × (STRESS_MAINTENANCE_MULTIPLIER − 1))
```

Where `biomassScore ∈ [0, 4]` is the sum of normalised development fractions
(height, trunk, branch, root — each in [0, 1]). This prevents a sapling
from being charged full-canopy maintenance it cannot afford: at biomass 0.1
and 18 °C, maintenance is ~3 eu/day, well below the ~20 eu/day a 50-leaf
canopy produces.

Deciduous trees in winter pay only `DORMANCY_MAINTENANCE_FRACTION (0.25)`
of normal maintenance — they're dormant, no foliage to maintain, but still
respire through bark and roots (GDD §4.4 winter: "Dependence on stored
energy").

### Allocation weights are survival-first

```typescript
PROVISIONAL_BIOLOGY_ALLOCATION_WEIGHTS = {
  rootGrowth:    0.15,  // roots first — absorption capacity limits survival
  trunkGrowth:   0.10,  // structural core
  branchGrowth:  0.10,  // canopy expansion
  leafGrowth:     0.15,  // foliage regrowth
  reproduction:  0.00,  // stub
}
// Sum = 0.50 → 50% of surplus goes to growth, 50% to reserve storage.
```

The weights sum to less than 1.0 deliberately so a substantial fraction of
surplus goes to reserve storage. This is critical for sapling bootstrap and
for cushioning defoliation events (GDD §5.3). The maturity multiplier
(`maturityMultiplier` in `energy-allocation.ts`) scales structural growth
down as the tree approaches `matureAgeDays`:

```
ageDays / matureAgeDays → growthMult
       0.0            →   1.0   (full sapling rate)
       0.5            →  ~0.55
       1.0+           →   PROVISIONAL_BIOLOGY_MATURE_GROWTH_FRACTION (0.05)
```

Leaf growth is **not** scaled by the maturity multiplier — mature trees
still replace senesced leaves at full rate (GDD §5.5: mature trees "can
remain productive and healthy").

### EnergyAllocation shape

```typescript
interface EnergyAllocation {
  maintenance: number;    // eu/step — always ≥ 0 for living trees
  surplus: number;         // eu/step — production − maintenance + reserveDraw
  reserveDraw: number;    // eu/step — deficit drawn from reserves (≥ 0)
  rootGrowth: number;     // eu/step
  trunkGrowth: number;    // eu/step
  branchGrowth: number;   // eu/step
  leafGrowth: number;     // eu/step — 0 in winter for deciduous
  reproduction: number;   // eu/step — always 0 in P1 (stub)
  reserveStorage: number; // eu/step — capped at reserve capacity
  production: number;     // eu/step — the input production (for diagnostics)
}
```

---

## 6. Growth and maturity

**File:** `packages/simulation/src/biology/growth.ts`.

Each structural dimension grows asymptotically toward its species ceiling
(GDD §5.5: "Growth should approach a species-specific biological ceiling"):

```
delta = eu × GROWTH_CONVERSION_MULTIPLIER × species.growthRate × growthFactor(fractionComplete) × stepDays

growthFactor(frac) = (1 − frac) ^ MATURITY_GROWTH_CURVE_EXPONENT
```

With `MATURITY_GROWTH_CURVE_EXPONENT = 2.0` (`@provisional`), growth slows
quadratically near the ceiling: at `frac = 0.5` the factor is 0.25, at
`frac = 0.95` it is 0.0025. The result is clamped at `maximum` so growth
**never exceeds** the species ceiling (TDD §18.4 invariant).

### Leaf growth uses a fractional accumulator

Per-step leaf-growth energy is often too small to grow a whole leaf (a
sapling allocates ~0.001 eu/step to leaf growth, but a leaf costs 2 eu).
Without accumulation the tree would never regrow leaves after winter
senescence. The `leafGrowthProgress` accumulator stores the fractional
progress toward the next leaf:

```
accumulated = leafGrowthProgress + (alloc.leafGrowth / leafEnergyCost)
newLeaves   = min(capacityRoom, floor(accumulated))
leafGrowthProgress = accumulated − newLeaves  // remainder carries over
```

This keeps `currentLeaves` an integer (TDD §18.4) without wasting the
per-step surplus. The accumulator is the new v2 → v3 migration field.

### Leaf capacity grows with branch development

```
leafCapacity = species.initial.leafCapacity + branchDevelopment × LEAF_CAPACITY_PER_BRANCH
```

For White Oak: `200 + branchDevelopment × 100`. A mature oak with
`branchDevelopment = 100` has a `leafCapacity` of `200 + 10000 = 10200`.

### Budding fallback for bootstrap

If the tree has fewer than 30 leaves but the season supports foliage
(`seasonalCondition > 0.3` — spring/summer/autumn, not winter) and reserves
are healthy (> 10 % of capacity), `BiologySystem` invests reserves into
emergency budding so a sapling can bootstrap from a few starter leaves and
a defoliated mature tree can recover. The cost is `buddingLeaves × leafEnergyCost`,
deducted from reserves.

---

## 7. Energy reserves

**File:** `packages/simulation/src/biology/reserves.ts`.

```
new_reserves = clamp(
  previous_reserves + reserveStorage − reserveDraw − recoveryCost,
  0, capacity
)
```

### Reserve capacity scales with biomass

```
capacity = max(1, species.initial.reserveCapacity
                 + species.reserveCapacity × (biomassScore / 4) × RESERVE_CAPACITY_DEVELOPMENT_GAIN)
```

`biomassScore ∈ [0, 4]`. A sapling (biomass ≈ 0.1) has capacity close to
`initial.reserveCapacity` (≈ 120 eu for White Oak); a mature tree
(biomass = 4) reaches `species.reserveCapacity × DEVELOPMENT_GAIN` (≈ 1000
eu). This matches GDD §5.3 ("Young trees have relatively small reserves;
mature, healthy trees can accumulate larger reserves") without inflating
sapling capacity.

### Reserves cushion maintenance deficits and stress recovery

- If `production < maintenance`, the deficit is drawn from reserves
  (`reserveDraw > 0`).
- Stress recovery (`updateStress`) spends energy at
  `STRESS_RECOVERY_ENERGY_COST` eu per unit of stress reduced — also drawn
  from reserves.
- Deciduous trees in winter draw on reserves for dormancy maintenance
  (GDD §4.4: "Dependence on stored energy").

### Reserve depletion raises mortality

When `reserveFraction = reserves / capacity < DEATH_RESERVE_CRITICAL_FRACTION (0.1)`,
the tree accumulates critical-state stress every day and the mortality
check (§9 below) starts drawing against a daily death probability.

---

## 8. Stress, health, and seasons

### Stress accumulation and recovery

**File:** `packages/simulation/src/biology/stress.ts`.

Stress ∈ [0, 1] accumulates when:

- **Water deficiency** — `waterFactor < 0.5`. Adds `WATER_STRESS_PER_DAY × (0.5 − waterF) × 2 × stepDays`.
- **Nutrient deficiency** — any nutrient < 50 % of requirement. Same form.
- **Low reserves** — `reserveFraction < DEATH_RESERVE_CRITICAL_FRACTION`. Adds proportional stress.
- **Active damage records** — each unresolved damage record contributes.
- **Winter dormancy for deciduous trees** — mild stress from reserve draw.

Stress decays when conditions are favourable (`waterF ≥ 0.5`,
`nutrientF ≥ 0.5`, `reserveFraction ≥ critical`) at
`STRESS_RECOVERY_RATE (0.1)` per day. Recovery costs
`STRESS_RECOVERY_ENERGY_COST (5.0)` eu per unit stress reduced — paid from
reserves.

### Derived health

**File:** `packages/simulation/src/biology/health.ts`.

```
health = W_STRESS × (1 − stress) + W_RESERVES × reserveFraction + W_FOLIAGE × foliageFraction
```

With weights `0.5 / 0.3 / 0.2` (sum = 1.0). Dead trees have `health = 0`.
The `BiologySystem` writes the recomputed value back to `tree.health`
every tick.

### Seasons (deciduous)

**File:** `packages/simulation/src/biology/seasons.ts`.

`foliage.seasonalCondition ∈ [0, 1]` approaches a season-specific target
each day at `PROVISIONAL_BIOLOGY_SEASONAL_TRANSITION_RATE (0.2)` per day
(~5 days for a full transition):

| Season | `seasonalCondition` target | Phenology |
|---|---|---|
| spring | 0.6 | Budding — partial canopy |
| summer | 1.0 | Full canopy, peak photosynthesis |
| autumn | 0.5 | Senescence begins |
| winter | 0.0 | Full dormancy, no foliage |

`currentLeaves` is capped at `floor(leafCapacity × seasonalCondition)` —
the tree naturally loses leaves in autumn/winter and regrows them in
spring/summer. Evergreen species keep `seasonalCondition = 1` year-round;
P1 ships only a deciduous species but the engine handles both.

---

## 9. Tree death

**File:** `packages/simulation/src/biology/death.ts`.

Death can result from (GDD §5.6):

1. **Repeated severe defoliation** — ≥ `DEATH_DEFOLIATION_COUNT (2)`
   severe defoliations (≥ 50 % of foliage removed in one action) within
   `DEATH_DEFOLIATION_WINDOW_DAYS (60)` sim days. The mortality check uses
   a doubled daily probability for repeat events.
2. **Exhausted reserves + critical stress** — `reserveFraction < 0.1`
   **and** `stress ≥ 0.9`. Daily probability scales with stress overage.
3. **Severe drought / prolonged nutrient deficiency** — tracked via
   accumulated stress (which raises the maintenance multiplier and
   eventually crosses the critical threshold).
4. **Disease / pest damage** — recorded in `tree.damage[]`; future phases
   (P6+) populate these. P1 only records `severe-defoliation` damage.

### Death is permanent for the original tree (GDD §16.3)

Once `alive = false`, the tree persists as a stump / dead trunk. The
`BiologySystem` short-circuits (`health = 0`, no further biological
updates) but the tree remains in the game — death does not end the game,
and the original tree cannot be replaced (GDD §16.2). The schema superRefine
in `packages/shared/src/schemas/game-state.ts` enforces
`originalTree.isOriginal === true` and `originalTree.id === 'original'`
across saves.

### Mortality is RNG-driven and deterministic

`checkMortality` consumes a `Rng` forked from the root RNG via
`ctx.rng.fork('BiologySystem')`. Same seed → same mortality outcome. The
RNG position is persisted in `GameState.rngState` so determinism survives
save/load (TDD §18.3).

### Emitted events

- `tree-died` — emitted once when the tree dies, with a `cause` code
  (`'reserves-exhausted' | 'stress' | 'defoliation' | 'structural' | 'unknown'`)
  and a free-form `detail` diagnostic.
- `biology-notification` — soft signal for low reserves, drought stress,
  nutrient deficiency, defoliation-stress. Severity ∈ `info | warning | critical`.

---

## 10. Harvesting

**Files:** `packages/simulation/src/biology/harvest.ts` (pure function),
`packages/simulation/src/actions/handlers.ts` (`harvest-leaves` action handler),
`packages/simulation/src/systems/harvest-system.ts` (slot-reserving no-op).

### HarvestResult shape (P3 consumes)

```typescript
interface HarvestResult {
  treeId: string;
  leavesHarvested: number;       // actual leaves removed (capped)
  foliageBefore: number;
  foliageAfter: number;          // === foliageBefore − leavesHarvested
  activeLeafAreaBefore: number;
  activeLeafAreaAfter: number;
  photosyntheticCapacityBefore: number;  // eu/day
  photosyntheticCapacityAfter: number;
  stressInduced: number;        // ∈ [0, 1] — added to tree.stress
  energyCost: number;            // eu cost the tree will pay to regrow
  currencyIssuance: CurrencyIssuanceRequest;  // P3 fulfils
  at: number;                   // sim seconds
}

interface CurrencyIssuanceRequest {
  treeId: string;
  amount: string;               // bigint minor units (TDD §10.1)
  currencyId: string;
  source: string;               // 'harvest-leaves' for audit trail
}
```

The `harvest-leaves` action handler:

1. Calls the pure `harvestLeaves(tree, ctx, requestedLeaves, at, currencyId)`.
2. Applies the result to the tree's foliage (`currentLeaves`, `activeLeafArea`).
3. Adds `result.stressInduced` to `tree.stress`.
4. Records a `severe-defoliation` damage entry if `fractionRemoved ≥ 0.5`
   (used by the mortality check for repeated-event tracking).
5. **Queues** `result.currencyIssuance` on `tree.pendingIssuances` for P3's
   `EconomySystem` to drain (P1 does NOT mutate `state.economy` directly —
   rule: every money movement is a transaction).
6. Emits `harvest-completed` carrying the full `HarvestResult` and (if
   severe) a `defoliation` event with `repeated: boolean`.

### Invariants (TDD §18.4)

- `leavesHarvested ≥ 0`.
- `leavesHarvested ≤ foliageBefore`.
- `leavesHarvested ≤ floor(foliageBefore × species.maximumHarvestFraction)`
  (per-action harvest cap; `@provisional` per GDD §17).
- `foliageAfter = foliageBefore − leavesHarvested` — **no negative leaf
  counts**, ever.
- Currency issuance is exactly
  `BigInt(leavesHarvested) × BigInt(species.leafDenominationMinor)` — no
  money is generated from nonexistent leaves.
- A dead tree yields zero leaves (the pure function short-circuits).

### Sustainable harvest estimate (GDD §5.4)

`estimateSustainableHarvest(tree, ctx)` returns a
`SustainableHarvestEstimate`:

```typescript
{
  treeId: string;
  leavesPerDay: number;       // floor(regrowablePerDay × SAFETY_MARGIN)
  fractionOfFoliage: number; // leavesPerDay / currentLeaves (∈ [0, 1])
  productionPerDay: number;
  maintenancePerDay: number;
}
```

Where `regrowablePerDay = max(0, production − maintenance) / leafEnergyCost`
and `SAFETY_MARGIN = 0.8`. The estimate is a **soft guideline** — the player
is free to harvest more or less (GDD §5.4: "The game should expose an
estimated sustainable harvest level without forcing the player to follow
it"). If maintenance exceeds production, `leavesPerDay = 0`.

### HarvestSystem (slot 5 in the registry)

`packages/simulation/src/systems/harvest-system.ts` is a **no-op** for P1:
harvesting is action-driven (the `harvest-leaves` `GameAction`), not
tick-driven. The system exists in the registry for two reasons:

1. **Ordering** — TDD §4.2 fixes the slot between `BiologySystem` (3) and
   `EconomySystem` (6) so future phases can read harvest outputs in the
   correct order.
2. **Future scheduled-harvest** — automated harvesting equipment (P5) will
   produce scheduled harvest events that this system processes here.

P3's `EconomySystem` drains `tree.pendingIssuances` — `HarvestSystem` does
NOT touch that queue.

### `harvest` GameAction (P5 dispatches)

```typescript
type HarvestLeavesAction = {
  type: 'harvest-leaves';
  payload: {
    treeId: string;          // MUST match originalTree.id (or, later, an owned tree id)
    requestedLeaves: number; // capped by available foliage + species.maximumHarvestFraction
  };
};
```

Registered in the `gameActionSchema` discriminated union
(`packages/shared/src/schemas/actions.ts`) without loosening it. The
handler in `packages/simulation/src/actions/handlers.ts` is registered in
`actionHandlers` and routed automatically by `executeAction`. Unknown
action types raise `UnknownActionError`.

---

## 11. Provisional constants (GDD §17)

All biology tuning constants live in
`packages/shared/src/constants/biology.ts` (and a few in
`provisional.ts`). Each is marked with a `// PROVISIONAL (GDD §17: <item>)`
comment pointing at the unresolved design decision it resolves.

Notable `@provisional` constants:

| Constant | Default | Resolves |
|---|---|---|
| `PROVISIONAL_DEFAULT_SPECIES_ID` | `'species:white-oak'` | GDD §17: initial tree species |
| `PROVISIONAL_BIOLOGY_DEFAULT_LEAF_DENOMINATION_MINOR` | `'100'` ($1.00) | GDD §17: initial leaf denomination and production rules |
| `PROVISIONAL_BIOLOGY_DEFAULT_MAX_HARVEST_FRACTION` | `0.5` | GDD §17: maximum harvesting rates |
| `PROVISIONAL_BIOLOGY_MAX_PHOTOSYNTHESIS_RATE` | `1.0` | GDD §17: detailed photosynthesis equations |
| `PROVISIONAL_BIOLOGY_BIOMASS_MAINTENANCE_RATE` | `50.0` | GDD §17: detailed energy allocation equations |
| `PROVISIONAL_BIOLOGY_ALLOCATION_WEIGHTS` | `{root:0.15, trunk:0.10, branch:0.10, leaf:0.15, reproduction:0}` | GDD §17: detailed energy allocation equations |
| `PROVISIONAL_BIOLOGY_DEATH_DEFOLIATION_COUNT` | `2` | GDD §5.6: tree death |
| `PROVISIONAL_BIOLOGY_DEATH_DEFOLIATION_WINDOW_DAYS` | `60` | GDD §5.6: tree death |
| `PROVISIONAL_BIOLOGY_DEATH_RESERVE_CRITICAL_FRACTION` | `0.1` | GDD §5.6: tree death |
| `PROVISIONAL_BIOLOGY_DECIDUOUS_SEASONAL_FOLIAGE` | `{spring:0.6, summer:1.0, autumn:0.5, winter:0.0}` | GDD §4.4: seasons |
| `PROVISIONAL_BIOLOGY_MATURE_GROWTH_FRACTION` | `0.05` | GDD §5.5: tree maturity |
| `PROVISIONAL_BIOLOGY_MATURITY_GROWTH_CURVE_EXPONENT` | `2.0` | GDD §5.5: tree maturity |
| `PROVISIONAL_BIOLOGY_NIGHT_PHOTOSYNTHESIS_FRACTION` | `0.25` | GDD §17: photosynthesis equations (sapling bootstrap) |
| `PROVISIONAL_BIOLOGY_SUSTAINABLE_HARVEST_SAFETY_MARGIN` | `0.8` | GDD §5.4: harvesting |

When a value is promoted from "provisional" to "decided" via playtesting,
it moves to a sibling `decided.ts` and the `PROVISIONAL_` prefix is
dropped (per `docs/simulation.md` §12 convention).

---

## 12. Test coverage

P1 ships **76 new tests** across two files (145 total in the repo):

- `packages/simulation/test/biology.test.ts` — 53 unit tests of pure
  biology functions: Liebig factors, photosynthesis, energy allocation,
  growth, reserves, seasons, health, stress, mortality, harvest, and
  determinism. Maps directly to TDD §18.1's biology invariants.
- `packages/simulation/test/biology-system.test.ts` — 23 integration
  tests of the full `BiologySystem` pipeline via `engine.advance` and
  `engine.executeAction`: deciduous seasonal behaviour, reserve dynamics,
  harvest action integration, tree death persistence, mature-tree-survives-
  one-defoliation, repeated-defoliation-kills, determinism, non-mutation,
  and invariant bounds over 1000-step runs.

The TDD §21 acceptance criteria addressed by P1:

| # | Criterion | P1 Status |
|---|---|---|
| 3 | The tree grows through simulated biological processes. | **PASS** — `grow-sapling.ts` script grows a sapling 5 sim years; height 0.5 → 3.14 m, leaf capacity 200 → 499, reserves 120 → 256 eu, health 71 %. |
| 5 | Harvesting reduces foliage and photosynthetic capacity. | **PASS** — `harvest-leaves` action reduces `currentLeaves` and `activeLeafArea`; `photosyntheticCapacityAfter < photosyntheticCapacityBefore` (test). |
| 6 | Energy reserves compensate for reduced foliage. | **PASS** — when `production < maintenance`, `reserveDraw > 0`; `reserves decline when maintenance > production` (test); mature tree survives one near-total defoliation via reserve cushioning (test). |
| 7 | Repeated harvesting can cause irreversible damage or death. | **PASS** — `repeated severe defoliation eventually kills the tree` (test); `alive = false` persists across ticks (test); `tree-died` event emitted. |

---

## 13. Headless sanity script

`packages/simulation/scripts/grow-sapling.ts` boots the engine with the
default `GameConfig` (White Oak sapling) and advances the simulation by
several in-game years under stub weather / resources / economy / etc.
systems. Prints the initial and final tree state, an event summary, an
invariant check, a growth summary, and a determinism check.

```
pnpm tsx packages/simulation/scripts/grow-sapling.ts [years] [seed]
# defaults: 5 years, seed 42
```

Sample output (5 sim years, seed 42):

```
--- Growth summary ---
  Height: 0.50m → 3.14m (+264cm)
  Trunk:  0.010m → 1.011m
  Branches: 0.0 → 3.0
  Leaf capacity: 200 → 499
  Reserves: 120 → 256 eu
  Alive: true

--- Determinism check (TDD §18.3) ---
  Same seed + same duration → identical state: PASS
  Same seed + same duration → identical events: PASS
```

The script is a CLI tool (uses `console.log` for stdout); the
import-boundary test walks `packages/simulation/src/` only, so it never
impacts the simulation's purity contract.

---

## 14. Gaps and out-of-scope items

P1 is **strictly within scope** (TDD Milestone 2: First Tree). The
following are explicitly **deferred** to later phases (documented so P2+
agents know what's missing):

- **Weather-driven photosynthesis modulation** (cloud cover, frost, heat
  waves, severe storms). P2's `WeatherSystem` populates a `WeatherState`
  the biology module will read via `BiologyContext`. P1's `lightFactor`
  only distinguishes day vs. night.
- **Resource simulation** (water/nutrients/soil). P2's `ResourceSystem`
  owns the full uptake model (rainfall, irrigation, soil depletion).
  P1's `BiologySystem` has a placeholder uptake so the sapling survives
  long enough to be grown for several sim years — `applyPlaceholderResources`
  in `biology-system.ts`, marked clearly.
- **Currency issuance fulfilment**. P1 emits the
  `CurrencyIssuanceRequest` and the `harvest-completed` event but does
  not credit the player's cash. P3's `EconomySystem` drains
  `tree.pendingIssuances` and applies monetary-authority policy.
- **Personal expenses, business, automation, environment, progression**.
  All remain P0 stubs. P1 does not touch their files.
- **Reproduction** (acorns / Genetic Legacy). P6+. The `reproduction`
  allocation slot exists and is wired to weight `0.0` so the allocation
  math doesn't change when reproduction is added.
- **Disease / pest damage**. P6+. The `tree.damage[]` array and
  `TreeDamageState` schema exist; P1 only records `severe-defoliation`
  damage entries.
- **Regional temperature variation**. P6's `EnvironmentSystem` will
  introduce regional temperature. P1's starting plot is at a temperate
  18 °C (`@provisional`).

---

## 15. Carry-forward (R) items for later phases

These are items the spec called out as carry-forward / migration concerns
that downstream agents should be aware of:

- **R1: `TreeState.health` is stored but derived.** P0 left it at `1.0`;
  P1's `BiologySystem` recomputes it every tick from `stress`,
  `reserveFraction`, and `foliageFraction`. P3 (EconomySystem) and P4
  (renderer) read it but must not write it — biology is the only writer
  (GDD §5.1).
- **R2: `GameState` shape changed in P1** — two new `TreeState` fields
  (`foliage.leafGrowthProgress`, `pendingIssuances`). Schema version
  bumped 1 → 3 with two pure migrations registered
  (`v1ToV2`, `v2ToV3`) in `packages/shared/src/migrations/defaults.ts`.
  Existing migration order is unchanged. P2+ agents that change the
  shape must bump `CURRENT_SCHEMA_VERSION` again and register a new
  migration.
- **R3: `pendingIssuances` queue on `originalTree` is the P1 ↔ P3
  contract.** P1 queues `CurrencyIssuanceRequest` objects on this array;
  P3's `EconomySystem` drains them each tick. P4's renderer may read the
  queue length for a "pending harvest" UI indicator but must not mutate it.
- **R4: Harvest action emits a `harvest-completed` event carrying the
  full `HarvestResult`** — P3 reads `payload.result.currencyIssuance` to
  fulfil currency creation. P4 reads `payload.result.leavesHarvested`,
  `stressInduced`, etc. for visual feedback. The event payload shape is
  part of the determinism contract (TDD §18.3) — do not change without a
  migration or a versioned event type.
- **R5: `BiologySystem` uses `ctx.rng.fork('BiologySystem')` for the
  mortality check.** This is a stateless per-step fork (no
  save/load-persisted child state) — see `docs/simulation.md` §6 note.
  If a future system needs its sub-stream to survive save/load, it must
  persist the child's state itself.

---

## 16. File map

```
packages/
├── content/src/species/
│   ├── white-oak.ts          # NEW (P1) — White Oak species data
│   └── index.ts              # MODIFIED — exports WHITE_OAK, findSpeciesById
├── shared/src/
│   ├── constants/
│   │   ├── biology.ts         # NEW (P1) — biology provisional constants
│   │   ├── provisional.ts     # MODIFIED — PROVISIONAL_DEFAULT_SPECIES_ID, CURRENT_SCHEMA_VERSION=3
│   │   └── index.ts           # MODIFIED — re-exports biology.ts
│   ├── schemas/
│   │   ├── species.ts         # NEW (P1) — TreeSpecies schema
│   │   ├── harvest.ts         # NEW (P1) — HarvestResult, CurrencyIssuanceRequest, SustainableHarvestEstimate
│   │   ├── actions-biology.ts # NEW (P1) — HarvestLeavesAction variant
│   │   ├── events-biology.ts  # NEW (P1) — harvest-completed, tree-died, defoliation, biology-notification
│   │   ├── actions.ts         # MODIFIED — adds harvest-leaves to GameAction union
│   │   ├── events.ts          # MODIFIED — adds biology events to SimulationEvent union
│   │   ├── tree.ts            # MODIFIED — adds leafGrowthProgress, pendingIssuances fields
│   │   └── index.ts           # MODIFIED — re-exports new schemas
│   └── migrations/
│       └── defaults.ts        # MODIFIED — registers v1ToV2, v2ToV3
└── simulation/src/
    ├── biology/               # NEW (P1) — pure biology functions
    │   ├── types.ts            #   BiologyContext + helpers
    │   ├── photosynthesis.ts   #   Liebig photosynthesis
    │   ├── energy-allocation.ts#   Survival-first allocation
    │   ├── reserves.ts         #   Capacity scaling + deltas
    │   ├── growth.ts           #   Asymptotic growth + leaf accumulator
    │   ├── seasons.ts          #   Deciduous seasonal behaviour
    │   ├── stress.ts           #   Stress accumulation/recovery
    │   ├── health.ts           #   Derived health
    │   ├── death.ts            #   Mortality check
    │   ├── harvest.ts          #   Pure harvestLeaves + sustainable estimate
    │   ├── species-registry.ts #   getSpeciesOrFail
    │   └── index.ts            #   Public surface
    ├── systems/
    │   ├── biology-system.ts   # REPLACES STUB (P1) — the only TreeState biology writer
    │   ├── harvest-system.ts   # REPLACES STUB (P1) — slot-reserving no-op
    │   ├── index.ts            # MODIFIED — imports biologySystem, harvestSystem from new files (registry order unchanged)
    │   └── stubs.ts            # MODIFIED — removes biologySystem, harvestSystem exports
    ├── actions/
    │   └── handlers.ts         # MODIFIED — adds harvestLeavesHandler
    ├── initial-state.ts        # MODIFIED — seeds originalTree from species.initial
    ├── index.ts                # MODIFIED — re-exports biology module
    ├── scripts/
    │   └── grow-sapling.ts     # NEW (P1) — headless sanity script
    └── test/
        ├── biology.test.ts             # NEW (P1) — 53 unit tests
        ├── biology-system.test.ts      # NEW (P1) — 23 integration tests
        └── _biology-helpers.ts         # NEW (P1) — test fixtures
```

`docs/biology.md` (this file) is the human-readable model documentation;
`docs/simulation.md` is the engine contract (unchanged in P1).
