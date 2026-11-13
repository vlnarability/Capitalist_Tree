# Progression & Generations (P9 — final)

**Status:** Source-of-truth contract for the P9 Progression & Generations
(P9a–P9d) implementation. Built on `docs/GDD.txt` §11 (Progression and
Generations) — §11.1 (Expansion), §11.2 (Genetic Legacy — the seven traits
with trade-offs; the original tree's lineage stays identifiable), §11.3
(Prestige — generational progress, NOT a numerical reset-for-multiplier);
and §12 (Player Objectives — six objectives tracked independently, may
overlap); and `docs/TDD.txt` §5.1 / §5.7 (`progression: ProgressionState`),
line 199 (ProgressionSystem — research, genetics, achievements), and
Milestone 8 (Generational Progression).

P9 is the last sub-task of Phase 9. It supersedes the P0 stub in
`packages/simulation/src/systems/stubs.ts` — the `ProgressionSystem` is now a
real, pure, deterministic system (P9b) at registry slot #11. P9a added the
`progressionStateSchema` (research + genetics + achievements + prestige +
generationHistory) + 5 progression action schemas + 6 progression event
variants + the content registry (14 `ResearchNodeDefinition`s across 5
categories, 7 `GeneticTraitDefinition`s, 12 `AchievementDefinition`s) + 7
`PROVISIONAL_PRESTIGE_*` / `PROVISIONAL_RESEARCH_*` / `PROVISIONAL_TRAIT_*` /
`PROVISIONAL_ACHIEVEMENT_*` constants + the v11→v12 migration; P9b built the
ProgressionSystem + the pure research/achievement/prestige helpers + the 5
action handlers + the typed-error surface; P9c wired the full prestige-reset
(cash / businesses / automation / inventory / environment reset + originalTree
replant + economy re-seed) + trait inheritance across generations (`inheritTraits`
— re-stamp generation, magnitude mutation via seeded FNV-1a) + the trait-effects
helper (`applyTraitEffects`) + the research→trait wiring (`effects.unlocks`
trait ids auto-populate `availableTraits`); P9d wrote this document + verified
the carry-forward list + ran the full suite. The remaining stubbed system
(EventSystem at slot #12) stays a no-op stub until a later phase.

This document is paired with `docs/GDD.txt` and `docs/TDD.txt`. Where this
document and the GDD/TDD disagree, the GDD/TDD win and a fix must be filed
against this document.

> **Scope flag.** Every `@provisional` constant in this document corresponds
> to (or stands in for) an unresolved design decision listed in `GDD §17`
> (Prestige and Generational Progression — §11.2 / §11.3 / §12). They live in
> `packages/shared/src/constants/progression.ts` under the
> `PROVISIONAL_PRESTIGE_*` / `PROVISIONAL_RESEARCH_*` / `PROVISIONAL_TRAIT_*` /
> `PROVISIONAL_ACHIEVEMENT_*` prefixes, plus a handful of local `@provisional`
> constants inside the progression helper modules
> (`packages/simulation/src/progression/*.ts`) — the prestige-multiplier growth
> rate (R-P9-7), the trait-mutation delta, the per-trait effect coefficients,
> and the achievement evaluation thresholds (R-P9-4). P10+ playtesting will
> calibrate them; until then the engine NEVER hardcodes tuning numbers, only
> imports.

---

## 1. Public interfaces at a glance

| Surface                                        | Location                                                        | P9 phase |
|------------------------------------------------|-----------------------------------------------------------------|----------|
| `ProgressionState` schema (research, genetics, achievements, prestige, generationHistory) | `packages/shared/src/schemas/progression.ts` | P0 stub + P9a |
| Progression action schemas (5 variants)        | `packages/shared/src/schemas/actions-progression.ts`           | P9a      |
| Progression event schemas (6 variants)         | `packages/shared/src/schemas/events-progression.ts`            | P9a      |
| Progression constants (`PROVISIONAL_PRESTIGE_*`, `PROVISIONAL_RESEARCH_*`, `PROVISIONAL_TRAIT_*`, `PROVISIONAL_ACHIEVEMENT_*`) | `packages/shared/src/constants/progression.ts` | P9a |
| Migration v11→v12 (restructure progression stub → full ProgressionState) | `packages/shared/src/migrations/defaults.ts` (`v11ToV12`) | P9a |
| Progression content — 14 research nodes / 7 traits / 12 achievements | `packages/content/src/progression/`                      | P9a      |
| `research.ts` — `unlockResearchNode` + tier-scaled cost + research→trait wiring | `packages/simulation/src/progression/research.ts` | P9b/P9c |
| `achievements.ts` — `checkAchievements` + throttle + per-achievement progress | `packages/simulation/src/progression/achievements.ts` | P9b |
| `prestige.ts` — `computePrestigeEarned` + full `applyPrestigeReset` + duration guard | `packages/simulation/src/progression/prestige.ts` | P9b/P9c |
| `genetics.ts` — `inheritTraits` + `mutateTraitMagnitude` + `getActiveTraitEffects` | `packages/simulation/src/progression/genetics.ts` | P9c |
| `trait-effects.ts` — `applyTraitEffects` + `BiologyParameters` multiplier set | `packages/simulation/src/progression/trait-effects.ts` | P9c |
| `actions.ts` — 5 action handlers               | `packages/simulation/src/progression/actions.ts`               | P9b/P9c  |
| `errors.ts` — 6 typed errors                   | `packages/simulation/src/progression/errors.ts`                | P9b      |
| `systems/progression.ts` — `ProgressionSystem` (registry slot #11) | `packages/simulation/src/systems/progression.ts`       | P9b      |

The `engine.executeAction` dispatch table
(`packages/simulation/src/actions/handlers.ts`) registers these P9b
actions:

| Action                    | Handler                      | P9 phase | Notes                                             |
|---------------------------|------------------------------|---------|---------------------------------------------------|
| `unlock-research`         | `unlockResearchHandler`      | P9b     | Debits the tier-scaled genetic-legacy cost from `prestige.geneticLegacyPoints`, adds it to `research.totalSpent`, flips the node's `ResearchNodeState` to `unlocked`, and (P9c) auto-populates `genetics.availableTraits` from the node's `effects.unlocks` trait ids. Throws `UnknownResearchNodeError` / `ResearchPrerequisitesNotMetError` / `InsufficientGeneticLegacyError`. Idempotent on a re-dispatched unlock. |
| `activate-trait`          | `activateTraitHandler`       | P9b     | Moves a trait from `availableTraits` into `activeTraits` (or re-activates a deactivated one) with the requested `magnitude` (clamped [0,1], default `PROVISIONAL_TRAIT_MAGNITUDE_DEFAULT`). Throws `UnknownTraitError` / `TraitNotAcquiredError`. |
| `deactivate-trait`        | `deactivateTraitHandler`     | P9b     | Sets the trait's `active: false` — the trait STAYS acquired (genetic material preserved); only its expression is suspended. Idempotent. |
| `prestige-reset`          | `prestigeResetHandler`       | P9b/P9c | Enforces the min-generation-duration guard (`GenerationTooEarlyError`), then delegates to `applyPrestigeReset` for the FULL reset (credit points, increment generation, finalize+append history, preserve research fraction, replant originalTree, reset player/businesses/automation/inventory/environment, re-seed economy, carry traits via `inheritTraits`). |
| `record-historical-event` | `recordHistoricalEventHandler` | P9b   | Appends `eventId` to `prestige.historicalRecords`. Idempotent (duplicate id is a no-op). |

---

## 2. Progression state (TDD §5.1 / §5.7)

`ProgressionState` (`packages/shared/src/schemas/progression.ts`) is the
single progression slice on `GameState`. P0 shipped a minimal stub
(`{ research: [{id, completedAt}], achievements: [{id, completedAt}],
geneticLegacy: number }`); P9a replaces that stub with the full shape
required by GDD §11 (Genetic Legacy, Prestige) and §12 (Player Objectives).
The v11→v12 migration restructures a v11 save's progression field into this
shape so legacy saves load cleanly. The full shape:

```typescript
interface ProgressionState {
  research: {                          // P9a
    nodes: ResearchNodeState[];        //   per-save unlock records (one per encountered node)
    totalSpent: string;                //   cumulative genetic-legacy points spent (bigint string)
  };
  genetics: {                          // P9a
    activeTraits: GeneticTraitState[]; //   traits the lineage has acquired (active OR held in reserve)
    availableTraits: string[];         //   trait ids unlocked via research, not yet acquired
    originalLineageId: string;         //   the ORIGINAL TREE's permanent genetic identity (NEVER reset)
  };
  achievements: {                      // P9a
    tracked: AchievementState[];       //   per-save achievement records (progress + unlocked flag)
  };
  prestige: {                          // P9a (PrestigeState)
    geneticLegacyPoints: string;       //   prestige currency (bigint minor-units string)
    totalGenerations: number;          //   count of generations established (0 until first prestige)
    currentGeneration: number;         //   generation the player is playing (1 = original tree)
    prestigeMultiplier: number;        //   derived bonus to genetic-legacy earnings (NOT a wealth multiplier)
    historicalRecords: string[];       //   historical-event ids recorded for the lineage
  };
  generationHistory: GenerationHistoryEntry[]; // P9a — per-generation history (GDD §11.3)
}

interface ResearchNodeState {          // P9a
  id: string;                          //   matches a ResearchNodeDefinition.id
  categoryId: ResearchCategory;        //   copied from the definition at record-creation time
  unlocked: boolean;                   //   whether the genetic-legacy cost has been paid
  unlockedAt: number;                  //   sim second of unlock (0 until unlocked)
  prerequisites: string[];             //   copied from the definition (self-contained save)
  cost: string;                        //   copied from the definition (bigint string)
}

interface GeneticTraitState {          // P9a
  traitId: string;                     //   matches a GeneticTraitDefinition.id
  active: boolean;                     //   whether the trait is currently expressed (toggleable)
  generation: number;                  //   generation that acquired the trait (1 = original lineage)
  magnitude: number;                   //   expression strength, 0 (dormant) to 1 (fully expressed)
}

interface AchievementState {           // P9a
  id: string;                          //   matches an AchievementDefinition.id
  unlocked: boolean;                   //   whether the achievement is complete
  unlockedAt: number;                  //   sim second of completion (0 until then)
  progress: number;                    //   0 (not started) to 1 (complete) — the UI reads this for bars
}

interface GenerationHistoryEntry {     // P9a
  generationNumber: number;            //   1 = the original tree
  treeSpeciesId: string;               //   species played in that generation (GDD §11.1)
  startDate: number;                   //   sim second the generation started
  endDate: number | null;              //   sim second it ended (null while outcome === 'ongoing')
  outcome: 'ongoing' | 'completed' | 'failed';
  prestigeEarned: string;              //   genetic-legacy points the generation contributed (bigint string)
}
```

### P0 stub vs P9a additions

| Field | Origin | Owner / status |
|---|---|---|
| `research` (was `{id, completedAt}[]`) | P0 stub → **P9a** | P0 tracked a flat `{id, completedAt}` array. P9a restructures it into `{nodes: ResearchNodeState[], totalSpent}` — each node carries its `categoryId` / `prerequisites` / `cost` copied from the definition so the unlock decision is self-contained on the save (TDD §18.3 determinism). |
| `genetics` (was absent) | **P9a** | The P0 stub had no genetics field. P9a adds `{activeTraits, availableTraits, originalLineageId}`. `originalLineageId` defaults to `'original'` (matching `originalTree.id`) and is NEVER modified across prestige resets (GDD §11.2 — the original tree's lineage stays identifiable). |
| `achievements` (was `{id, completedAt}[]`) | P0 stub → **P9a** | P0 tracked a flat `{id, completedAt}` array. P9a restructures it into `{tracked: AchievementState[]}` with a continuous `progress` (0–1) the UI reads for progress bars. |
| `prestige` (was `geneticLegacy: number`) | P0 stub → **P9a** | P0 had a provisional `geneticLegacy: number`. P9a replaces it with the full `PrestigeState` — `geneticLegacyPoints` (bigint string, TDD §10.1 precision), generation counters, the derived `prestigeMultiplier`, and `historicalRecords`. |
| `generationHistory` (was absent) | **P9a** | The P0 stub had no history. P9a adds the per-generation history (GDD §11.3 — the original tree remains permanently represented in the player's history). |

`CURRENT_SCHEMA_VERSION = 12` (P9a). Every new field carries a Zod
`.default(...)` AND an explicit migration backfill in `v11ToV12`, so v11 saves
parse cleanly under v12 and a hand-constructed v12 state with a partial
progression still validates. Money-like fields (`geneticLegacyPoints`,
`prestigeEarned`, `research.totalSpent`, `ResearchNodeState.cost`) are bigint
minor-units strings (TDD §10.1) — the prestige currency is tracked with the
same precision discipline as money, never floating point.

---

## 3. Research tree (P9b — GDD §11.1 Expansion, §11.2 genetic legacy unlocks research)

**File:** `packages/content/src/progression/research/nodes.ts` (content) +
`packages/simulation/src/progression/research.ts` (pure helpers).

The research tree spans the simulation's five pillars (GDD §11.1 — expansion
into additional trees, species, properties, commercial forestry, regional
businesses, global operations). 14 `ResearchNodeDefinition`s are split one
file per category (rule 5 — content is data, never hardcoded in engine logic):

| Category    | Node id                              | Prerequisites                       | Cost (GLP) | Tier | Effects                                          |
|-------------|--------------------------------------|-------------------------------------|------------|------|--------------------------------------------------|
| biology     | `research:improved-photosynthesis`   | `[]`                                | `'10'`     | 0    | +0.1 photosynthesis; unlocks 4 traits            |
| biology     | `research:drought-resistance-breeding` | `['research:improved-photosynthesis']` | `'15'`   | 1    | unlocks `trait:deep-roots`                       |
| biology     | `research:pest-resistance-breeding`  | `['research:improved-photosynthesis']` | `'20'`   | 1    | unlocks pest-resistance + cold-resistance        |
| automation  | `research:advanced-irrigation`       | `[]`                                | `'12'`     | 0    | +0.1 irrigation efficiency                       |
| automation  | `research:precision-fertilization`   | `['research:advanced-irrigation']`  | `'18'`     | 1    | +0.1 fertilization efficiency                     |
| automation  | `research:autonomous-harvesting`     | `['research:precision-fertilization']` | `'25'`   | 2    | +0.15 harvest efficiency                          |
| business    | `research:supply-chain-optimization` | `[]`                                | `'20'`     | 0    | +0.1 business operating efficiency               |
| business    | `research:market-analysis`           | `['research:supply-chain-optimization']` | `'15'` | 1    | +0.1 market-sale revenue capture                  |
| business    | `research:corporate-structure`       | `['research:market-analysis']`      | `'30'`     | 2    | unlocks 5 ownership structures                   |
| environment | `research:carbon-capture`            | `[]`                                | `'22'`     | 0    | +0.1 sequestration; unlocks carbon-capture unit  |
| environment | `research:soil-restoration`          | `[]`                                | `'16'`     | 0    | +0.1 soil recovery                               |
| environment | `research:biodiversity-enhancement`  | `['research:soil-restoration']`     | `'24'`     | 1    | +0.1 biodiversity + resilience                    |
| energy      | `research:solar-efficiency`          | `[]`                                | `'14'`     | 0    | +0.1 solar generation rate                        |
| energy      | `research:battery-technology`        | `['research:solar-efficiency']`     | `'19'`     | 1    | +0.1 energy capacity                              |

`getResearchNodeById` (`packages/content/src/progression/research/index.ts`)
is the canonical lookup; the `unlock-research` handler resolves
`researchNodeId` through it (unknown id → `UnknownResearchNodeError`).

### `unlockResearchNode` — the pure transform

The pure helper (`unlockResearchNode(state, nodeId, tick)`) validates + applies
an unlock:

1. **Content gate** — resolve the node via `getResearchNodeById`; unknown id
   throws `UnknownResearchNodeError`.
2. **Upsert the node record** (`ensureResearchNodeRecord`) — copies
   `categoryId` / `prerequisites` / `cost` from the definition so the save
   describes the node even before unlock (TDD §18.3 — the save fully describes
   the result without re-resolving the definition).
3. **Idempotent path** — if the record is already `unlocked`, return the state
   unchanged (no double-spend) with a zero-cost marker event (the action
   handler drops it).
4. **Prerequisite gate** — verify every `definition.prerequisites` node id is
   already unlocked; throw `ResearchPrerequisitesNotMetError` listing the
   missing ones.
5. **Cost gate** — compute the **tier-scaled** effective cost via
   `effectiveResearchCost`; throw `InsufficientGeneticLegacyError` if the
   balance is short.
6. **Debit + flip** — debit the cost from `geneticLegacyPoints` (bigint string
   arithmetic), add it to `research.totalSpent`, flip the record to
   `unlocked: true` / `unlockedAt: tick`.
7. **P9c research→trait wiring** — the node's `effects.unlocks` trait ids
   (those prefixed `trait:`) are merged into `genetics.availableTraits` so the
   lineage can acquire them via `activate-trait` (GDD §11.2). Non-trait
   unlocks are NOT routed here (R-P9-3).

### Tier-scaled cost (`PROVISIONAL_RESEARCH_COST_MULTIPLIER`)

```
tier           = prerequisite-chain depth (0 for roots, 1 for nodes whose prereqs are roots, …)
effectiveCost  = round(definition.cost × (1 + tier × PROVISIONAL_RESEARCH_COST_MULTIPLIER))
```

`researchNodeTier` resolves the depth transitively against the content
registry (with a defensive cycle guard). Root nodes (tier 0) pay the flat
definition cost; deeper research costs more, rewarding players who build a
broad foundation before specializing. The multiplier is rounded to the nearest
integer so the debited amount is always a whole point count (genetic-legacy
points are integers).

### Research→trait wiring (P9c — resolves P9b deferred item #6)

When a research node is unlocked, `extractTraitUnlocks(definition)` reads
`effects.unlocks` and returns only the ids prefixed `trait:`;
`mergeTraitUnlocks` appends them to `genetics.availableTraits` idempotently
(insertion order preserved, duplicates skipped). This is how
`research:improved-photosynthesis` makes `trait:rapid-growth` /
`trait:large-foliage` / `trait:thick-trunk` / `trait:efficient-photosynthesis`
available for acquisition, and `research:drought-resistance-breeding` makes
`trait:deep-roots` available (GDD §11.2 — genetic legacy unlocks genetic
modifications).

### R-P9-3 — non-trait unlocks not wired

A node's `effects.unlocks` may also list non-trait ids — equipment ids
(`'equipment:carbon-capture-unit'`), ownership-structure ids
(`'ownership:corporation'`, …). `unlockResearchNode` stamps the node record +
emits the `research-unlocked` event, but other systems do NOT yet read
`effects.unlocks` beyond the `trait:` branch — the equipment / business
systems do not gate on research unlocks. Flagged in `research.ts` at the
`extractTraitUnlocks` doc, the `unlockResearchNode` step-7 doc, and the inline
wiring comment. A future phase wires the non-trait branches (the
`research-unlocked` event already carries the node id; downstream systems read
`effects.unlocks` from the content definition).

---

## 4. Genetic traits (P9c — GDD §11.2 Genetic Legacy)

**File:** `packages/content/src/progression/genetics/traits.ts` (content) +
`packages/simulation/src/progression/genetics.ts` (pure helpers).

The seven genetic modifications from GDD §11.2's table, each with a benefit
AND a meaningful trade-off (GDD §11.2: "Genetic modifications should have
meaningful trade-offs"). The `availabilityRequirement` maps each trait to the
research node that unlocks it for acquisition (content-defined, not hardcoded
— rule 5):

| Trait id                       | Family          | Benefit                              | Trade-off                              | Unlocked by research node |
|--------------------------------|-----------------|--------------------------------------|----------------------------------------|---------------------------|
| `trait:rapid-growth`           | `growth`        | +20% growth rate                     | +30% resource (water + nutrients) demand | `improved-photosynthesis` |
| `trait:large-foliage`          | `foliage`       | +25% leaf capacity / harvest yield   | +30% water requirements                | `improved-photosynthesis` |
| `trait:deep-roots`             | `roots`         | +40% drought resistance              | −15% early-development rate            | `drought-resistance-breeding` |
| `trait:thick-trunk`            | `trunk`         | +30% energy + water reserve capacity | −20% structural growth rate            | `improved-photosynthesis` |
| `trait:pest-resistance`        | `resistance`    | −50% pest-outbreak damage vulnerability | −10% growth rate                     | `pest-resistance-breeding` |
| `trait:cold-resistance`        | `resistance`    | +50% frost survival; +20% winter photosynthesis | −15% warm-climate performance | `pest-resistance-breeding` |
| `trait:efficient-photosynthesis` | `photosynthesis` | +25% energy production per leaf area | −10% maximum growth ceiling          | `improved-photosynthesis` |

`getTraitById` (`packages/content/src/progression/genetics/index.ts`) is the
canonical lookup; the `activate-trait` / `deactivate-trait` handlers resolve
`traitId` through it (unknown id → `UnknownTraitError`).

### Activate / deactivate (toggleable expression)

A trait's `active` flag distinguishes a trait the player is currently
expressing from one held in reserve (GDD §11.2 — modifications have
trade-offs, so the player toggles which are expressed). The `activate-trait`
handler moves a trait from `availableTraits` into `activeTraits` (or
re-activates a deactivated one) with the requested `magnitude` (clamped [0,1],
defaulting to `PROVISIONAL_TRAIT_MAGNITUDE_DEFAULT = 0.75`). The
`deactivate-trait` handler sets `active: false` — the trait STAYS acquired
(genetic material is preserved across the lineage); only its expression is
suspended, so the lineage can re-express it later. Both benefits AND
trade-offs of a deactivated trait are dropped (the player toggled it off).

### Trait inheritance across generations (P9c — `inheritTraits`)

When a `prestige-reset` establishes a new generation, `inheritTraits(state,
newGeneration)` carries the lineage's acquired traits forward (GDD §11.2 —
genetic material is preserved across generations). Every entry on
`genetics.activeTraits` carries forward — whether `active: true` or held in
reserve with `active: false`. For each carried trait:

- `traitId` is preserved (the genetic modification is the same one).
- `active` is preserved (an expressed trait stays expressed; a reserved one
  stays reserved).
- `generation` is re-stamped to `newGeneration` (the generation now carrying
  the trait — the lineage's genetic material moves forward with each
  generation).
- `magnitude` is lightly mutated via `mutateTraitMagnitude` — a perturbation
  of `± PROVISIONAL_TRAIT_MUTATION_DELTA` (0.05 = ±5% per generation), clamped
  to [0,1].

`availableTraits` (genetic potential unlocked via research) and
`originalLineageId` (the permanent lineage id) are preserved verbatim by
`inheritTraits`.

### Seeded FNV-1a mutation (NOT a root fork)

`mutateTraitMagnitude` is caller-supplied an `Rng` so the helper is pure +
testable. `inheritTraits` derives an **INDEPENDENT seeded RNG per carried
trait** from a deterministic FNV-1a hash of
`(originalLineageId, newGeneration, traitId)` — this consumes ZERO root RNG
draws (R-P9-1). The lineage's RNG determinism contract (same seed → same
mutations) is preserved because the hash inputs are all on the save. A
magnitude of 0 stays in `[0, 2×delta]` (it can only drift up — a dormant
trait cannot go negative); a magnitude of 1 stays in `[1 − 2×delta, 1]`.

### `originalLineageId` — permanent lineage identity

`genetics.originalLineageId` is set once at game start (default `'original'`,
matching `originalTree.id`) and NEVER modified across prestige resets (GDD
§11.2 last sentence — "the original tree's lineage should remain
identifiable"). A trait acquired in generation 1 belongs to the original
lineage; its `generation` field records which generation acquired it, while
`originalLineageId` records the permanent lineage. The
`originalLineageId` guard test pins this across every action + every prestige
reset.

### `getActiveTraitEffects`

A pure read returning a map of `traitId → { benefit, tradeOff, magnitude }`
for every trait the lineage is currently EXPRESSING (`active: true`).
Deactivated traits are excluded. Unknown trait ids (defensive — content may
add traits after a save was written) are skipped. Used by `trait-effects.ts`
(and, in a future task R-P9-2, by the BiologySystem to wire the multipliers).

---

## 5. Trait effects (P9c — GDD §11.2 genetic modifications have meaningful trade-offs)

**File:** `packages/simulation/src/progression/trait-effects.ts`.

This module turns the human-readable `benefit` / `tradeOff` strings on the
content definitions into concrete numeric multipliers on a `BiologyParameters`
object. A trait's `magnitude` (0–1) scales both its benefit AND its trade-off
— a half-expressed trait grants half the benefit AND half the trade-off.

### `BiologyParameters` — the multiplier set

```typescript
interface BiologyParameters {
  growthRateMultiplier: number;             // height / trunk / branch growth
  earlyGrowthMultiplier: number;            // early-development growth (deep-roots trade-off)
  structuralGrowthMultiplier: number;       // trunk-density growth (thick-trunk trade-off)
  maxGrowthMultiplier: number;              // growth ceiling (efficient-photosynthesis trade-off)
  productionCapacityMultiplier: number;     // leaf capacity / harvest yield
  energyProductionMultiplier: number;       // energy production per leaf area
  waterDemandMultiplier: number;            // water requirement
  droughtResistanceMultiplier: number;      // drought resistance (deep-roots benefit)
  reservesCapacityMultiplier: number;       // energy + water reserve capacity
  pestVulnerabilityMultiplier: number;      // pest-outbreak damage vulnerability (LOWER is better)
  frostSurvivalMultiplier: number;          // frost survival probability
  warmClimatePerformanceMultiplier: number; // warm-climate performance (cold-resistance trade-off; LOWER is a penalty)
}
```

`defaultBiologyParameters()` returns the neutral set (every multiplier 1.0 —
no trait effects). It is the starting point for `applyTraitEffects`.

### `applyTraitEffects` — folding the multipliers

`applyTraitEffects(biologyState, activeTraits)` folds each active
(`active: true`) trait's benefit + trade-off into the parameter set, returning
a new `BiologyParameters`. Only expressed traits apply — a deactivated
trait's benefit AND trade-off are both dropped. Unknown trait ids are skipped
defensively. Per-trait effects (magnitude `m`, 0–1, scales the coefficient):

| Trait                     | Benefit field × factor              | Trade-off field × factor              |
|---------------------------|--------------------------------------|---------------------------------------|
| rapid-growth              | `growthRateMultiplier × (1 + m·0.20)` | `waterDemandMultiplier × (1 + m·0.30)` |
| large-foliage             | `productionCapacityMultiplier × (1 + m·0.25)` | `waterDemandMultiplier × (1 + m·0.30)` |
| deep-roots                | `droughtResistanceMultiplier × (1 + m·0.40)` | `earlyGrowthMultiplier × (1 − m·0.15)` |
| thick-trunk               | `reservesCapacityMultiplier × (1 + m·0.30)` | `structuralGrowthMultiplier × (1 − m·0.20)` |
| pest-resistance           | `pestVulnerabilityMultiplier × (1 − m·0.50)` | `growthRateMultiplier × (1 − m·0.10)` |
| cold-resistance           | `frostSurvivalMultiplier × (1 + m·0.50)` | `warmClimatePerformanceMultiplier × (1 − m·0.15)` |
| efficient-photosynthesis  | `energyProductionMultiplier × (1 + m·0.25)` | `maxGrowthMultiplier × (1 − m·0.10)` |

The per-trait coefficients are local `@provisional` constants (GDD §17 —
genetic modification balance) — the content definitions describe them in
human-readable form, and these constants are the engine-side interpretation.
Tuned during playtesting.

### Stacking — multiplicative

Multiple active traits stack **multiplicatively** for the multiplier fields:
each trait's factor multiplies the cumulative product. A trait that touches a
field another trait already touched compounds — e.g. rapid-growth
(+20% growth at magnitude 1) + pest-resistance (−10% growth at magnitude 1)
→ `growthRateMultiplier = 1.2 × 0.9 = 1.08`. This keeps each trait's effect
proportional to its magnitude and lets benefits and trade-offs from different
traits interact naturally.

### R-P9-2 — BiologySystem wiring deferred

The BiologySystem (slot #3) is the intended consumer of these multipliers —
it would call
`applyTraitEffects(defaultBiologyParameters(), state.progression.genetics.
activeTraits)` each tick and apply the resulting multipliers to its
photosynthesis / growth / water-demand / reserve / stress computations. P9c
provides the pure helper + is fully tested here, but does NOT wire it into
the BiologySystem (stay in scope — the task contract forbids modifying the
BiologySystem logic; its per-tick computation would need restructuring to
consume the multiplier set). The wiring is a one-line call when it lands.
Flagged in `trait-effects.ts` at the `WIRING` doc (line 18) and the
`BiologyParameters` field doc, and in `genetics.ts` at the
`getActiveTraitEffects` future-task note.

---

## 6. Achievement tracking (P9b — GDD §12 Player Objectives)

**File:** `packages/content/src/progression/achievements/definitions.ts`
(content) + `packages/simulation/src/progression/achievements.ts` (pure helpers).

12 `AchievementDefinition`s — the six GDD §12 objective achievements plus six
incremental `milestone` achievements. GDD §12: the objectives "are tracked
independently and may overlap" — each individual achievement fires at most
once, but a player can pursue several in the same playthrough.

| Bucket       | Achievement id                     | Objective category | Completion criteria (descriptive) |
|--------------|------------------------------------|--------------------|-----------------------------------|
| objective    | `achievement:wealthiest-being`    | `wealth`           | personalCash ≥ threshold AND control ≥ 25% of monetary supply |
| objective    | `achievement:great-restoration`    | `restoration`      | biodiversity + forestCoverage + soil.health + ecosystemResilience all > 0.8 |
| objective    | `achievement:last-tree`            | `destruction`      | biodiversity < 0.2 + forestCoverage < 0.1 + landUse.degraded > 0.8 + cumulative extraction > threshold |
| objective    | `achievement:natural-balance`      | `balance`          | originalTree alive + financialSecurity > 0.8 + ecosystem self-sustaining |
| objective    | `achievement:industrial-empire`    | `industrial`       | own ≥ 1 business at each of the 6 supply-chain levels |
| objective    | `achievement:generational-legacy`  | `generational`     | totalGenerations ≥ threshold AND ≥ 1 trait carried across each boundary |
| milestone    | `achievement:first-business`       | `milestone`        | businesses.length ≥ 1 |
| milestone    | `achievement:first-million`        | `milestone`        | personalCash ≥ 1,000,000 minor units |
| milestone    | `achievement:first-generation`     | `milestone`        | totalGenerations ≥ 1 |
| milestone    | `achievement:1000-days-survived`   | `milestone`        | originalTree alive AND clock.day ≥ 1000 |
| milestone    | `achievement:first-trait`          | `milestone`        | activeTraits.length ≥ 1 |
| milestone    | `achievement:research-pioneer`     | `milestone`        | ≥ 1 unlocked research node |

`getAchievementById` (`packages/content/src/progression/achievements/index.ts`)
is the canonical lookup. The `completionCriteria` strings are descriptive
(rule 5 — content is data); the *evaluation* logic lives in the simulation
helper, reading the relevant live state per the achievement's
`objectiveCategory` + id.

### `checkAchievements` — the throttled evaluation

The pure helper (`checkAchievements(state, currentTick)`):

1. **Seed** (`seedTrackedAchievements`) — ensure every known achievement has
   a `tracked` record (idempotent; missing ones are appended).
2. For each tracked achievement **not yet unlocked**, recompute its `progress`
   (0–1) via `evaluateAchievementProgress` against the current state.
3. When `progress` reaches 1, flip `unlocked: true` + stamp
   `unlockedAt = currentTick`, emit `achievement-unlocked` (carrying the id +
   objective category so the UI can group by GDD §12 objective).
4. Already-unlocked achievements are NOT re-evaluated (idempotent — an
   achievement unlocks once). The `progress` of an unlocked achievement is
   left at 1.

Progress is a continuous fraction where reasonable (wealth / restoration /
balance / generational) so the UI can show a progress bar; binary achievements
(milestones like first-business, first-trait, research-pioneer) return 0 or 1.

### Throttle (`PROVISIONAL_ACHIEVEMENT_CHECK_INTERVAL_TICKS`)

The evaluation reads across many systems (cash, biodiversity,
forestCoverage, generation count, business ownership), so running it every
tick is wasteful (GDD §17). The ProgressionSystem calls `checkAchievements`
only when `shouldCheckAchievements` returns true — `tickIndex %
PROVISIONAL_ACHIEVEMENT_CHECK_INTERVAL_TICKS === 0` where
`tickIndex = floor(now / stepSeconds)` — OR on the first tick, when `tracked`
is empty and must be seeded (so a player who already meets a criterion gets
the achievement promptly). The throttle is deterministic given `(now,
stepSeconds)` — no persisted last-checked field is needed (the schema's
`AchievementState` has no such field; P9a froze the schema).

### R-P9-4 — achievement thresholds are local PROVISIONAL constants

The `AchievementDefinition.completionCriteria` strings reference
`PROVISIONAL_ACHIEVEMENT_*` thresholds descriptively (e.g. "personalCash ≥
PROVISIONAL_ACHIEVEMENT_WEALTH_THRESHOLD"). P9a did not stamp these as
constants in `packages/shared` (the shared progression constants file holds
only the cadence + prestige-economy constants). P9b defines them in
`achievements.ts` as local `@provisional` tuning values — the wealth threshold
(`10_000_000n`), the supply share (`0.25`), the generations threshold (`3`),
the supply-chain levels (`6`), the restoration threshold (`0.8`), the
destruction thresholds, the balance financial-security (`0.8`), the extraction
sinks threshold (`1_000_000n`). They are pure data — promote them to
`packages/shared/src/constants/progression.ts` (dropping the local prefix)
once playtesting settles the thresholds. Flagged in `achievements.ts` at the
local-thresholds section header (R-P9-4).

### R-P9-5 — LAST_TREE "cumulative extraction" proxied via `economy.totalSinks`

The Last Tree achievement's "cumulative extraction (water + minerals + timber)
exceeds threshold" criterion has no dedicated schema field — the simulation
does not yet track a cumulative-extraction counter. P9b approximates it by
checking that `economy.totalSinks` (the cumulative currency-sink total — every
wage / purchase / repayment sinks to the authority) exceeds a provisional
minor-unit threshold (`PROVISIONAL_ACHIEVEMENT_EXTRACTION_SINKS_THRESHOLD =
1_000_000n`). This is a coarse proxy — extraction and money-sinks are not the
same thing, but sinks correlate with industrial extraction activity. A real
extraction ledger lands in a later phase. Flagged in `achievements.ts` at the
const declaration + the inline proxy comment (R-P9-5).

### R-P9-6 — NATURAL_BALANCE "ecosystem self-sustaining" proxied via `ecosystemResilience > 0.8`

The Natural Balance achievement's "ecosystem self-sustaining (net biodiversity
+ forestCoverage stable or rising across a full sim year with no player
intervention)" criterion requires a year-over-year stability check the
simulation does not yet perform. P9b proxies it by checking
`ecosystemResilience > 0.8` (the EnvironmentSystem's derived resilience —
itself a weighted blend of biodiversity + forestCoverage + soil.health). A
real self-sustaining check (a sliding window of env indicators with no player
intervention) is deferred. Flagged in `achievements.ts` at the inline proxy
comment (R-P9-6).

---

## 7. Prestige & generational reset (P9c — GDD §11.3 Prestige)

**File:** `packages/simulation/src/progression/prestige.ts`.

GDD §11.3 is explicit: "Prestige should represent generational progress
rather than simply resetting the game for a numerical multiplier." The
prestige currency is genetic-legacy points (GDD §11.2 Genetic Legacy), earned
by completing a generation and spent on `unlock-research` + `activate-trait`.

### `computePrestigeEarned` — the prestige potential (pure read)

The genetic-legacy points the player WOULD earn if they prestige-reset now:

```
earned = (base + activeTraitCount × traitMultiplier) × prestigeMultiplier

base             = PROVISIONAL_PRESTIGE_BASE_LEGACY_POINTS_PER_GENERATION  (10)
activeTraitCount = genetics.activeTraits.filter(t => t.active).length       (only expressed traits count)
traitMultiplier  = PROVISIONAL_PRESTIGE_LEGACY_MULTIPLIER_PER_TRAIT        (2)
prestigeMultiplier = prestige.prestigeMultiplier                            (the derived bonus)
```

Returns a bigint (genetic-legacy points are whole integers); the
floating-point product is rounded to the nearest integer. Only traits
currently being expressed count toward the bonus — GDD §11.2 modifications
have trade-offs, so the player toggles which are expressed, and the prestige
reward reflects the expressed genetic legacy. Pure read — does NOT mutate.

### `applyPrestigeReset` — the FULL generational reset (P9c)

`applyPrestigeReset(state, newTreeSpeciesId, tick)` resolves P9b deferred
item #1 — the full play-state reset, not just the progression-state skeleton:

1. **Resolve the new species** (`findSpeciesById`) — the originalTree is
   replanted as a sapling of this species. Unknown id throws (the
   prestige-reset cannot replant an unregistered species). This helper is the
   gatekeeper (the schema only requires a non-empty string).
2. **Compute + credit earned points** — `computePrestigeEarned(state)`
   credited to `geneticLegacyPoints` (the currency only grows across resets).
3. **Increment generation counters** — `totalGenerations` +
   `currentGeneration`.
4. **Recompute prestige multiplier** —
   `prestigeMultiplier = 1 + PROVISIONAL_PRESTIGE_MULTIPLIER_PER_GENERATION ×
   totalGenerations` (after increment — the new generation enjoys the grown
   bonus). R-P9-7: this growth constant is a LOCAL `@provisional`, NOT
   promoted to a shared `PROVISIONAL_PRESTIGE_` constant.
5. **Finalise the current history entry** — `endDate: tick`,
   `outcome: 'completed'`, `prestigeEarned: <earned>`. If no history exists
   yet (first prestige), synthesise the generation-1 entry from the original
   tree's current species.
6. **Append the new generation's history entry** — `generationNumber:
   currentGeneration` (after increment), `treeSpeciesId: newTreeSpeciesId`,
   `startDate: tick`, `endDate: null`, `outcome: 'ongoing'`,
   `prestigeEarned: '0'`.
7. **Preserve the research fraction** — the first
   `floor(unlockedNodes.length × PROVISIONAL_PRESTIGE_PRESERVED_RESOURCES)`
   unlocked nodes (insertion order — deterministic) stay unlocked; the rest
   are flipped back to `unlocked: false` (the records stay so the player can
   see the node was once unlocked, but they must re-pay to unlock it).
   `research.totalSpent` is preserved verbatim (a cumulative historical
   tally).
8. **P9c trait inheritance** — `inheritTraits(state, newGenerationNumber)`
   carries the lineage's `activeTraits` into the new generation (re-stamped
   generation + lightly mutated magnitude); `availableTraits` +
   `originalLineageId` preserved verbatim.
9. **P9c play-state reset** — CLEAR / re-seed the per-generation play state
   by borrowing slices from a fresh
   `initializeState({...DEFAULT_GAME_CONFIG, speciesId: newTreeSpeciesId,
   seed: <old seed>})` template (guarantees the reset slices EXACTLY match a
   fresh game of the new species — correct sapling biology, baseline
   environment, re-seeded economy, starting cash — without duplicating the
   initial-state construction logic):
   - **`originalTree` REPLANTED** as a sapling of `newTreeSpeciesId` (age 0,
     alive, biology reset to the species' `initial` block). The tree's `id`
     stays `'original'` + `isOriginal` stays `true` (GDD §16.1 / §16.2) — the
     original tree is the PERMANENT anchor; only its biological state resets.
     `originalLineageId` (the genetic identity) is preserved separately on
     `genetics`.
   - **`player` reset** to the starting baseline (personalCash =
     startingPersonalCash, health/happiness/financialSecurity neutral,
     unpaidDays 0, livingExpenses zeroed — a new generation starts fresh
     financially).
   - **`businesses` CLEARED** (the commercial empire does not survive
     generations — GDD §11.3).
   - **`automation` CLEARED.**
   - **`inventory` CLEARED.**
   - **`world.environment` RESET** to the ecological baseline (a new
     generation starts fresh ecologically — GDD §11.3 reward: new starting
     environments). The persisted `rngStreams.weather` is preserved so the
     WeatherSystem sequence stays deterministic across the reset. The old
     `world.regionId` is preserved (the plot is the same across generations).
   - **`economy` RE-SEEDED** (markets back to base prices + initial supply,
     accounts reset to the starting cash distribution, monetarySupply /
     totalIssued / totalSinks reset to the starting values, monetaryAuthority
     structure preserved with fresh policy). The conservation invariant is
     re-established at the new generation's start.
10. **PRESERVE non-play state** — `metadata`, `clock` (the game does not
    rewind — the prestige-reset is an action at `tick`), `history`
    (snapshots/archive), `rngState` (root RNG — prestige-reset consumes ZERO
    root RNG draws; `inheritTraits` derives independent seeded rngs, R-P9-1),
    `rngStreams`, and `scheduler`. The template's RNG (root + weather fork) is
    DISCARDED — the old state's `rngState` + `rngStreams` are preserved so the
    simulation's RNG determinism contract survives the reset (TDD §18.3).

Also PRESERVED across the reset (GDD §11.2 / §11.3): `geneticLegacyPoints`
(which grew in step 2), `historicalRecords`, `availableTraits`, and
`achievements` (permanent — GDD §12). The returned `event` is the
`generation-established` SimulationEvent carrying the new generation number,
the previous generation number, the points earned, the resulting balance, the
new prestige multiplier, and the new species.

### R-P9-7 — prestigeMultiplier growth is a local const

The prestige-multiplier growth rate
(`PROVISIONAL_PRESTIGE_MULTIPLIER_PER_GENERATION = 0.1`, giving
`prestigeMultiplier = 1 + 0.1 × totalGenerations` after increment) lives as a
LOCAL `@provisional` const in `prestige.ts`, NOT promoted to a shared
`PROVISIONAL_PRESTIGE_*` constant in `packages/shared/src/constants/
progression.ts`. P9a froze the shared constants file at the 7 cadence /
prestige-economy / research / trait constants before the multiplier curve was
tuned; promoting it would need a constants-file addition (backward-compatible,
no migration). Flagged in `prestige.ts` at the const declaration (R-P9-7).

---

## 8. ProgressionSystem per-tick contract (slot #11)

`ProgressionSystem` (`packages/simulation/src/systems/progression.ts`)
replaces the P0 stub at **registry slot #11**. It runs once per simulation
step AFTER every gameplay system (TimeSystem #1 → EnvironmentSystem #10) and
BEFORE the EventSystem (#12, currently a no-op stub). Slot #11 was reserved
for "research/achievements; depends on everything" — the achievement
evaluation reads across many systems (cash, biodiversity, forestCoverage,
generation count, business ownership), so it runs last among the gameplay
systems to see the fully-updated state for the step.

```text
execute(state, ctx):
  1. Deep-copy the input state (TDD §4.1, §18.4 — never mutate the input).
  2. (RNG fork DEFERRED — R-P9-1, see §10. The transforms are deterministic;
     no ctx.rng.fork call. A determinism test pins zero root draws.)
  3. Seed `progression.achievements.tracked` if empty (idempotent — one
     AchievementState record per known AchievementDefinition). On the first
     tick (tracked empty) the achievement check runs REGARDLESS so a player
     who already meets a criterion gets the achievement promptly.
  4. Throttled achievement check — only every
     PROVISIONAL_ACHIEVEMENT_CHECK_INTERVAL_TICKS ticks (the evaluation reads
     across many systems, so running it every tick is wasteful — GDD §17).
     The throttle is `tickIndex % interval === 0` where
     `tickIndex = floor(ctx.now / ctx.stepSeconds)`. If neither the
     first-tick-seed path nor the throttle fires, return early (no state
     change, no events).
  5. checkAchievements(next, ctx.now) — recompute each tracked achievement's
     progress; flip to unlocked + stamp unlockedAt + emit achievement-unlocked
     when progress reaches 1.
```

The system is pure: it deep-copies the input state, mutates the copy, and
returns the new state. The input is NEVER mutated (TDD §4.1, §18.4). Rendering
reads only — the rendering layer MUST NOT evaluate achievements independently.
This system is the single engine-side driver of achievement unlocking; the UI
dispatches progression actions (unlock-research, activate-trait,
prestige-reset, …) but never runs achievement evaluation.

The system does NOT register per-tick research / trait / prestige transforms —
those are player-driven actions dispatched via `executeAction`. The system's
only tick-driven responsibility is achievement evaluation; the pure helpers
(`unlockResearchNode`, `applyPrestigeReset`, `inheritTraits`,
`applyTraitEffects`) are invoked by the action handlers, not by the system.

---

## 9. The five action handlers (P9b/P9c — TDD §5.7 / §11)

**File:** `packages/simulation/src/progression/actions.ts` (registered in
`packages/simulation/src/actions/handlers.ts`).

| Handler | Action | Effect |
|---|---|---|
| `unlockResearchHandler` | `unlock-research` | Delegates to `unlockResearchNode(state, researchNodeId, tick)`. Debits the tier-scaled cost, flips the node record, adds to `totalSpent`, (P9c) merges trait unlocks into `availableTraits`. Emits `research-unlocked`. Idempotent path (already unlocked) drops the marker event. Throws `UnknownResearchNodeError` / `ResearchPrerequisitesNotMetError` / `InsufficientGeneticLegacyError`. |
| `activateTraitHandler` | `activate-trait` | Resolve trait via `getTraitById` (content gate). Move from `availableTraits` into `activeTraits` (or re-activate a deactivated one) with `magnitude` clamped [0,1] (default `PROVISIONAL_TRAIT_MAGNITUDE_DEFAULT`). Stamp `generation: currentGeneration` for a newly expressed trait; preserve the existing `generation` for a re-activation. Remove from `availableTraits`. Emits `trait-activated`. Throws `UnknownTraitError` / `TraitNotAcquiredError`. |
| `deactivateTraitHandler` | `deactivate-trait` | Resolve trait. Set `active: false` — the trait STAYS in `activeTraits` (genetic material preserved). Idempotent (already deactivated → no event). Emits `trait-deactivated`. Throws `UnknownTraitError` / `TraitNotAcquiredError`. |
| `prestigeResetHandler` | `prestige-reset` | Enforce the min-generation-duration guard via `generationDurationStatus` (`GenerationTooEarlyError` if `daysElapsed < PROVISIONAL_PRESTIGE_GENERATION_MIN_DURATION_DAYS`). Delegate to `applyPrestigeReset` for the FULL reset (§7). Emits `generation-established`. |
| `recordHistoricalEventHandler` | `record-historical-event` | Append `eventId` to `prestige.historicalRecords` (idempotent — duplicate is a no-op, mirroring P6b2's enable/disable-automation idempotency). Emits `historical-event-recorded` with the resulting record count. |

All handlers are pure: they return a new state + events without mutating the
input. Deterministic given `(state, action)` (TDD §18.3). `originalLineageId`
is NEVER modified by any progression action — GDD §11.2 "the original tree's
lineage should remain identifiable". The `originalLineageId` guard test pins
this across every action.

### The prestige-reset min-duration guard

The pure `applyPrestigeReset` helper is UNGUARDED (it trusts its caller); the
`prestigeResetHandler` is the gatekeeper — it calls
`generationDurationStatus(state, tick)` BEFORE delegating, and throws
`GenerationTooEarlyError(generationNumber, daysElapsed, minDays)` if
`daysElapsed < PROVISIONAL_PRESTIGE_GENERATION_MIN_DURATION_DAYS` (120 sim
days). This prevents instant-reset farming (GDD §17). The split keeps the pure
helper testable in isolation (the prestige-reset tests drive
`applyPrestigeReset` directly with a long-elapsed state) while the handler
enforces the player-facing guard.

---

## 10. Determinism contract (TDD §18.3)

Given the same initial state, seed, player actions, and duration, the
ProgressionSystem + the progression action handlers produce the same final
state + events. The module upholds this by construction:

- All transforms are pure arithmetic on the current progression + game state
  (no randomness — the RNG fork is deferred, R-P9-1).
- `tick` is an explicit action payload field (`unlock-research`,
  `prestige-reset`, `record-historical-event`) so the event `at` + state
  stamps are deterministic given `(state, action)` (TDD §18.3 — the save
  fully describes the result).
- The achievement throttle is deterministic given `(now, stepSeconds)` — no
  persisted last-checked field (the schema's `AchievementState` has no such
  field; P9a froze the schema).
- `unlockResearchNode` upserts the node record (copying definition-derived
  fields) so the unlock decision is self-contained on the save.
- The prestige-reset borrows play-state slices from a fresh
  `initializeState({...DEFAULT_GAME_CONFIG, speciesId, seed})` template —
  deterministic given `(seed, speciesId)` — and DISCARDS the template's RNG,
  preserving the old state's `rngState` + `rngStreams`.

Save/load preserves all progression fields via the v11→v12 migration + Zod
defaults. Verified in `progression.test.ts` (determinism: same seed → same
progression state; purity: input not mutated) + the prestige-reset + genetics
+ trait-effects + research test files.

### The RNG fork deferral (R-P9-1 — carry-forward, see §11)

The ProgressionSystem does NOT call `ctx.rng.fork('ProgressionSystem')`.
`Rng.fork()` advances the shared root RNG by exactly one draw **by design**
(`packages/simulation/src/rng.ts`: `fork()` calls `this.next()` to seed the
child — "the parent advances by exactly one draw to seed the fork"). The
persisted `GameState.rngState` is the root state AFTER all per-step forks
(`simulation.ts` runOneStep persists `rng.getState()` after the system loop).
So at step N+1, every system that forks (BiologySystem #3, AutomationSystem
#9) rebuilds its child seed from a root state that includes step N's fork
count. Adding a ProgressionSystem fork at #11 adds one draw per step to that
accumulated root state, which shifts the child seeds BiologySystem +
AutomationSystem derive at every subsequent tick — breaking the calibrated
mortality / catch-up death sequences pinned by the P7d / P8b determinism
tests (the crippled-tree "starved tree still dies" test is calibrated to the
current 2-fork-per-step root sequence and flips dies → survives if a third
per-step fork lands).

The slot-#11 / no-op-EventSystem reasoning holds only WITHIN a single tick
(ProgressionSystem's fork cannot shift a downstream forking system in the
SAME tick, because EventSystem #12 is a no-op). But ACROSS ticks the
accumulated root state shifts every downstream forker's child seed — that is
the perturbation R-P9-1 avoids. The fork matches the R-P7-1 (EnvironmentSystem
no-fork) + R-P8-1 (BusinessSystem no-fork) precedent.

**The prestige-reset, however, is a rare discrete player ACTION (not a
per-tick system call), so forking the root RNG ONCE per generation would
technically be safe.** But to keep the prestige-reset's RNG footprint
provably zero (no risk of perturbing any downstream sequence, no test
breakage), `inheritTraits` derives an INDEPENDENT seeded RNG per carried trait
from a deterministic FNV-1a hash of `(originalLineageId, newGeneration,
traitId)` — this consumes ZERO root RNG draws. The lineage's RNG determinism
contract (same seed → same mutations) is preserved because the hash inputs
are all on the save.

Three determinism tests in `progression.test.ts` pin the no-fork contract:
the root RNG state is unchanged across a `ProgressionSystem.execute` when the
achievement check is throttled off, a full `engine.advance` persists the same
root RNG whether or not the ProgressionSystem runs, and the BiologySystem /
AutomationSystem RNG sequences are unaffected.

**Status: deferred.** The fork lands when (a) stochastic progression
mechanics arrive AND (b) the downstream RNG sequences are retuned, OR
`fork()` is refactored to a non-advancing sub-stream derivation (a deeper
change that retunes every system's sequence — out of P9d scope).

---

## 11. Carry-forward / known gaps (R-P9 items)

P9 surfaced seven carry-forward items. The frozen-schema constraint (P9a
froze `packages/shared`) shapes several of them; each is flagged in the
source with a `// R-P9-N:` comment at the relevant file:line (documentation
comments only — no logic changes).

### R-P9-1: RNG fork deferred (carry-forward)

The ProgressionSystem at slot #11 does NOT call `ctx.rng.fork('ProgressionSystem')`.
Same root cause as R-P7-1 (EnvironmentSystem) + R-P8-1 (BusinessSystem):
`fork()` advances the root RNG by one draw by design
(`packages/simulation/src/rng.ts`); the persisted `rngState` accumulates every
per-step fork, so a fork here would shift the BiologySystem (#3) +
AutomationSystem (#9) child seeds at every subsequent tick and break the
calibrated mortality / catch-up death sequences pinned by the P7d / P8b
determinism tests. The prestige-reset's trait inheritance (`inheritTraits`)
derives INDEPENDENT seeded RNGs per carried trait (FNV-1a hash of
`(originalLineageId, newGeneration, traitId)`) so it consumes ZERO root RNG
draws — the discrete-action path is provably zero-footprint. **Status:
deferred** — lands when stochastic progression mechanics arrive AND the
downstream sequences are retuned, OR `fork()` is refactored to a
non-advancing sub-stream derivation. References: `genetics.ts` (file doc +
`mutateTraitMagnitude` / `inheritTraits` / `hashStringToSeed` docs),
`prestige.ts` (file doc + step-10 preserve note + inline `rngState` comment),
`actions.ts` (`prestigeResetHandler` doc), `systems/progression.ts` (file doc
+ inline `@provisional` block). Three determinism tests pin it.

### R-P9-2: BiologySystem trait-effects wiring deferred

The pure `applyTraitEffects` helper + the `BiologyParameters` multiplier set
exist and are fully tested (`trait-effects.ts`, 16 tests). The BiologySystem
(slot #3) is the intended consumer — it would call
`applyTraitEffects(defaultBiologyParameters(), activeTraits)` each tick and
apply the multipliers to its photosynthesis / growth / water-demand / reserve
/ stress computations. P9c provides the helper but does NOT wire it into the
BiologySystem (stay in scope — the task contract forbids modifying the
BiologySystem logic; its per-tick computation would need restructuring to
consume the multiplier set). The wiring is a one-line call when it lands.
References: `trait-effects.ts:18` (`WIRING` doc) + `trait-effects.ts:54`
(`BiologyParameters` field doc) + `genetics.ts:228` (`getActiveTraitEffects`
future-task note).

### R-P9-3: Non-trait research unlocks not wired

`unlockResearchNode` stamps the node record + emits `research-unlocked`, and
(P9c) the `effects.unlocks` trait ids (prefixed `trait:`) auto-populate
`genetics.availableTraits`. But other systems do NOT yet read
`effects.unlocks` beyond the `trait:` branch — the equipment / business
systems do not gate on research unlocks (e.g.
`research:corporate-structure`'s `ownership:corporation` unlock, or
`research:carbon-capture`'s `equipment:carbon-capture-unit` unlock, are
stamped but not enforced). The `research-unlocked` event already carries the
node id; downstream systems read `effects.unlocks` from the content
definition for the non-trait branches when they land. References:
`research.ts:170` (`extractTraitUnlocks` doc), `research.ts:273`
(`unlockResearchNode` step-7 doc), `research.ts:371` (inline wiring comment),
`progression-research.test.ts:8` (test-file doc).

### R-P9-4: Achievement thresholds are local PROVISIONAL constants

The achievement evaluation thresholds (wealth 10M minor, supply share 0.25,
generations 3, supply-chain levels 6, restoration 0.8, destruction bounds,
balance financial-security 0.8, extraction sinks 1M minor) live as local
`@provisional` constants in `achievements.ts`, NOT promoted to
`packages/shared/src/constants/progression.ts` (P9a froze the shared file at
the 7 cadence / prestige-economy / research / trait constants). They are pure
data — promote them to shared (dropping the local prefix) once playtesting
settles the thresholds. Reference: `achievements.ts` local-thresholds section
header (R-P9-4).

### R-P9-5: LAST_TREE "cumulative extraction" proxied via `economy.totalSinks`

The Last Tree achievement's "cumulative extraction (water + minerals + timber)
exceeds threshold" criterion has no dedicated schema field — the simulation
does not yet track a cumulative-extraction counter. P9b approximates it by
checking that `economy.totalSinks` exceeds
`PROVISIONAL_ACHIEVEMENT_EXTRACTION_SINKS_THRESHOLD` (1_000_000n minor). A
coarse proxy — extraction and money-sinks are not the same thing, but sinks
correlate with industrial extraction activity. A real extraction ledger lands
in a later phase. References: `achievements.ts` const declaration
(R-P9-5) + inline proxy comment (R-P9-5).

### R-P9-6: NATURAL_BALANCE "ecosystem self-sustaining" proxied via `ecosystemResilience > 0.8`

The Natural Balance achievement's "ecosystem self-sustaining (net biodiversity
+ forestCoverage stable or rising across a full sim year with no player
intervention)" criterion requires a year-over-year stability check the
simulation does not yet perform. P9b proxies it by checking
`ecosystemResilience > 0.8` (the EnvironmentSystem's derived resilience).
A real self-sustaining check (a sliding window of env indicators with no
player intervention) is deferred. Reference: `achievements.ts` inline proxy
comment (R-P9-6).

### R-P9-7: prestigeMultiplier growth is a local const

The prestige-multiplier growth rate
(`PROVISIONAL_PRESTIGE_MULTIPLIER_PER_GENERATION = 0.1`, giving
`prestigeMultiplier = 1 + 0.1 × totalGenerations` after increment) lives as a
LOCAL `@provisional` const in `prestige.ts`, NOT promoted to a shared
`PROVISIONAL_PRESTIGE_*` constant. P9a froze the shared constants file before
the multiplier curve was tuned; promoting it would need a constants-file
addition (backward-compatible, no migration). Reference: `prestige.ts` const
declaration (R-P9-7).

---

## 12. @provisional constants (GDD §17 pointers)

All progression tuning constants live in
`packages/shared/src/constants/progression.ts` (the shared
`PROVISIONAL_PRESTIGE_*` / `PROVISIONAL_RESEARCH_*` / `PROVISIONAL_TRAIT_*` /
`PROVISIONAL_ACHIEVEMENT_*`) plus local `@provisional` constants inside the
helper modules (`packages/simulation/src/progression/*.ts`). Each shared
constant is marked with a `// PROVISIONAL (GDD §17: <item>)` comment.

### Shared constants (`packages/shared/src/constants/progression.ts`)

| Constant                                              | Value  | Resolves (GDD §17) |
|-------------------------------------------------------|--------|--------------------|
| `PROVISIONAL_PRESTIGE_BASE_LEGACY_POINTS_PER_GENERATION` | 10   | Prestige and Generational Progression — §11.3 |
| `PROVISIONAL_PRESTIGE_LEGACY_MULTIPLIER_PER_TRAIT`    | 2      | Prestige and Generational Progression — §11.2 / §11.3 |
| `PROVISIONAL_PRESTIGE_GENERATION_MIN_DURATION_DAYS`   | 120    | Prestige and Generational Progression — §11.3 |
| `PROVISIONAL_PRESTIGE_PRESERVED_RESOURCES`            | 0.5    | Prestige and Generational Progression — §11.3 |
| `PROVISIONAL_RESEARCH_COST_MULTIPLIER`                | 0.25   | Prestige and Generational Progression — §11.2 |
| `PROVISIONAL_TRAIT_MAGNITUDE_DEFAULT`                 | 0.75   | Prestige and Generational Progression — §11.2 |
| `PROVISIONAL_ACHIEVEMENT_CHECK_INTERVAL_TICKS`        | 60     | Prestige and Generational Progression — §12 |

### Local @provisional constants (helper modules)

| Constant | Value | Location | Resolves (GDD §17) |
|---|---|---|---|
| `PROVISIONAL_PRESTIGE_MULTIPLIER_PER_GENERATION` (R-P9-7) | 0.1 | `prestige.ts` | Prestige and Generational Progression — §11.3 |
| `PROVISIONAL_TRAIT_MUTATION_DELTA` | 0.05 | `genetics.ts` | Prestige and Generational Progression — §11.2 |
| `PROVISIONAL_RAPID_GROWTH_GROWTH_GAIN` | 0.2 | `trait-effects.ts` | §11.2 Rapid Growth |
| `PROVISIONAL_RAPID_GROWTH_WATER_GAIN` | 0.3 | `trait-effects.ts` | §11.2 Rapid Growth |
| `PROVISIONAL_LARGE_FOLIAGE_PRODUCTION_GAIN` | 0.25 | `trait-effects.ts` | §11.2 Large Foliage |
| `PROVISIONAL_LARGE_FOLIAGE_WATER_GAIN` | 0.3 | `trait-effects.ts` | §11.2 Large Foliage |
| `PROVISIONAL_DEEP_ROOTS_DROUGHT_GAIN` | 0.4 | `trait-effects.ts` | §11.2 Deep Roots |
| `PROVISIONAL_DEEP_ROOTS_EARLY_PENALTY` | 0.15 | `trait-effects.ts` | §11.2 Deep Roots |
| `PROVISIONAL_THICK_TRUNK_RESERVES_GAIN` | 0.3 | `trait-effects.ts` | §11.2 Thick Trunk |
| `PROVISIONAL_THICK_TRUNK_STRUCTURAL_PENALTY` | 0.2 | `trait-effects.ts` | §11.2 Thick Trunk |
| `PROVISIONAL_PEST_RESISTANCE_VULN_REDUCTION` | 0.5 | `trait-effects.ts` | §11.2 Pest Resistance |
| `PROVISIONAL_PEST_RESISTANCE_GROWTH_PENALTY` | 0.1 | `trait-effects.ts` | §11.2 Pest Resistance |
| `PROVISIONAL_COLD_RESISTANCE_FROST_GAIN` | 0.5 | `trait-effects.ts` | §11.2 Cold Resistance |
| `PROVISIONAL_COLD_RESISTANCE_WARM_PENALTY` | 0.15 | `trait-effects.ts` | §11.2 Cold Resistance |
| `PROVISIONAL_EFFICIENT_PHOTOSYNTHESIS_ENERGY_GAIN` | 0.25 | `trait-effects.ts` | §11.2 Efficient Photosynthesis |
| `PROVISIONAL_EFFICIENT_PHOTOSYNTHESIS_MAX_PENALTY` | 0.1 | `trait-effects.ts` | §11.2 Efficient Photosynthesis |
| `PROVISIONAL_ACHIEVEMENT_WEALTH_THRESHOLD` (R-P9-4) | `10_000_000n` | `achievements.ts` | §12 The Wealthiest Being |
| `PROVISIONAL_ACHIEVEMENT_WEALTH_SUPPLY_SHARE` (R-P9-4) | 0.25 | `achievements.ts` | §12 The Wealthiest Being |
| `PROVISIONAL_ACHIEVEMENT_GENERATIONS_THRESHOLD` (R-P9-4) | 3 | `achievements.ts` | §12 The Generational Legacy |
| `PROVISIONAL_ACHIEVEMENT_SUPPLY_CHAIN_LEVELS` (R-P9-4) | 6 | `achievements.ts` | §12 The Industrial Empire |
| `PROVISIONAL_ACHIEVEMENT_RESTORATION_THRESHOLD` (R-P9-4) | 0.8 | `achievements.ts` | §12 The Great Restoration |
| `PROVISIONAL_ACHIEVEMENT_DESTRUCTION_BIODIVERSITY_MAX` (R-P9-4) | 0.2 | `achievements.ts` | §12 The Last Tree |
| `PROVISIONAL_ACHIEVEMENT_DESTRUCTION_FOREST_MAX` (R-P9-4) | 0.1 | `achievements.ts` | §12 The Last Tree |
| `PROVISIONAL_ACHIEVEMENT_DESTRUCTION_DEGRADED_MIN` (R-P9-4) | 0.8 | `achievements.ts` | §12 The Last Tree |
| `PROVISIONAL_ACHIEVEMENT_BALANCE_FINANCIAL_SECURITY` (R-P9-4) | 0.8 | `achievements.ts` | §12 The Natural Balance |
| `PROVISIONAL_ACHIEVEMENT_EXTRACTION_SINKS_THRESHOLD` (R-P9-4 / R-P9-5) | `1_000_000n` | `achievements.ts` | §12 The Last Tree |

When a value is promoted from "provisional" to "decided" via playtesting,
move it to a sibling `decided.ts` and drop the `PROVISIONAL_` prefix
(matching the convention in `packages/shared/src/constants/`).

---

## 13. Test inventory (post-P9d)

131 progression tests across 5 files.

| File                                                            | Phase | Scope                                  |
|-----------------------------------------------------------------|-------|----------------------------------------|
| `packages/simulation/test/progression.test.ts`                  | P9b/P9c | 68 tests: research (`unlockResearchNode` — prerequisite gate, cost gate, debit + totalSpent, node flipped; `getUnlockedResearch` / `isResearchUnlocked`); achievements (`checkAchievements` — wealth / restoration / industrial / generational / milestone criteria evaluated; throttled by interval; emits `achievement-unlocked`; doesn't re-unlock); prestige (`computePrestigeEarned = (base + traits×mult) × multiplier`; `applyPrestigeReset` skeleton — increments generation, records history, adds earned to balance, preserves `originalLineageId`); the 5 action handlers (unlock-research success + fail; activate-trait available→active; deactivate-trait active→false; prestige-reset skeleton; record-historical-event idempotent); `originalLineageId` never modified by any action; determinism (same seed → same state, RNG zero root draws, full-advance RNG unchanged, BiologySystem/AutomationSystem sequences unaffected); purity (input not mutated). |
| `packages/simulation/test/progression-genetics.test.ts`         | P9c   | 19 tests: `mutateTraitMagnitude` — bounded [0,1], deterministic given (magnitude, rng), magnitude 0 only drifts up, magnitude 1 only drifts down; `inheritTraits` — active traits carry with generation=newGeneration, magnitude mutated but bounded, deactivated traits also carry (genetic material preserved), `originalLineageId` + `availableTraits` preserved; `getActiveTraitEffects` — returns map of traitId → {benefit, tradeOff, magnitude} for active traits, deactivated excluded, unknown ids skipped; purity. |
| `packages/simulation/test/progression-trait-effects.test.ts`    | P9c   | 16 tests: `defaultBiologyParameters` all 1.0; each of the 7 traits applies its benefit + trade-off to the correct multipliers at magnitude 1; magnitude scales the effect (0.5 → half); multiple active traits stack multiplicatively; deactivated traits NOT applied; unknown trait ids skipped; purity. |
| `packages/simulation/test/progression-prestige-reset.test.ts`   | P9c   | 18 tests: the FULL play-state reset — player.personalCash reset to starting + baseline reset; businesses / automation / inventory cleared; world.environment reset to baseline; economy re-seeded (markets at base price, accounts at starting cash, monetarySupply/totalIssued/totalSinks reset); originalTree replanted as a sapling (age 0, alive, id='original', isOriginal=true, biology reset to species.initial); `originalLineageId` preserved; `geneticLegacyPoints` credited; generationHistory entries correct (old finalized + new ongoing); research fraction preserved; activeTraits carried over (re-stamped to new generation, magnitude mutated but bounded); clock / metadata / rngState / rngStreams / scheduler preserved; unknown species throws; purity. |
| `packages/simulation/test/progression-research.test.ts`         | P9c   | 10 tests: `unlockResearchNode` auto-populates `genetics.availableTraits` from the node's `effects.unlocks` trait ids (research→trait wiring — resolves P9b deferred item #6); non-trait unlocks (equipment / ownership ids) NOT routed there (R-P9-3); `extractTraitUnlocks` filters `trait:` prefix; `mergeTraitUnlocks` idempotent + insertion-order-preserving. |

The determinism tests in `progression.test.ts` pin the R-P9-1 carry-forward:
the ProgressionSystem consumes zero root RNG draws (no fork), a full
`engine.advance` persists the same root RNG whether or not the
ProgressionSystem runs, and the BiologySystem / AutomationSystem RNG sequences
are unaffected. The prestige-reset tests pin the zero-root-draw contract for
the discrete-action path (`inheritTraits` uses seeded FNV-1a, not a root fork).

---

## 14. File map

```
packages/
├── shared/src/
│   ├── constants/
│   │   └── progression.ts             # NEW (P9a) — 7 PROVISIONAL_PRESTIGE_* / PROVISIONAL_RESEARCH_* /
│   │                                   #   PROVISIONAL_TRAIT_* / PROVISIONAL_ACHIEVEMENT_* constants
│   ├── schemas/
│   │   ├── progression.ts              # NEW (P9a) — ProgressionState, ResearchNodeState, GeneticTraitState,
│   │   │                              #   AchievementState, PrestigeState, GenerationHistoryEntry +
│   │   │                              #   ResearchNodeDefinition / GeneticTraitDefinition / AchievementDefinition
│   │   ├── actions-progression.ts     # NEW (P9a) — 5 progression action variants
│   │   └── events-progression.ts      # NEW (P9a) — 6 progression event variants
│   └── migrations/
│       └── defaults.ts                # MODIFIED (P9a) — v11→v12 (restructure progression stub → full ProgressionState)
└── simulation/src/
    ├── progression/                   # NEW (P9b/P9c) — pure progression helpers
    │   ├── errors.ts                  #   6 typed errors (UnknownResearchNodeError, ResearchPrerequisitesNotMetError,
    │   │                              #     InsufficientGeneticLegacyError, UnknownTraitError, TraitNotAcquiredError,
    │   │                              #     GenerationTooEarlyError)
    │   ├── research.ts                #   unlockResearchNode + tier-scaled cost + research→trait wiring (R-P9-3)
    │   ├── achievements.ts            #   checkAchievements + throttle + per-achievement progress (R-P9-4/R-P9-5/R-P9-6)
    │   ├── prestige.ts                #   computePrestigeEarned + full applyPrestigeReset + duration guard (R-P9-7)
    │   ├── genetics.ts                #   inheritTraits + mutateTraitMagnitude + getActiveTraitEffects (R-P9-1 seeded FNV-1a)
    │   ├── trait-effects.ts           #   applyTraitEffects + BiologyParameters multiplier set (R-P9-2 wiring deferred)
    │   ├── actions.ts                 #   5 action handlers
    │   └── index.ts                   #   public surface
    ├── systems/
    │   ├── progression.ts             # REPLACES STUB (P9b) — registry slot #11 (R-P9-1 RNG fork deferred)
    │   └── index.ts                   # MODIFIED — imports progressionSystem
    ├── actions/
    │   └── handlers.ts                # MODIFIED (P9b) — registers the 5 progression action handlers
    └── test/
        ├── progression.test.ts                  # NEW (P9b) — 68 tests
        ├── progression-genetics.test.ts         # NEW (P9c) — 19 tests
        ├── progression-trait-effects.test.ts    # NEW (P9c) — 16 tests
        ├── progression-prestige-reset.test.ts   # NEW (P9c) — 18 tests
        └── progression-research.test.ts         # NEW (P9c) — 10 tests
```

`docs/progression.md` (this file) is the human-readable model documentation;
the source-of-truth for invariants is the test suite. The paired carry-forward
records are the R-P9 items in §11 (flagged in source with `// R-P9-N:`
comments at the file:line references listed there).
