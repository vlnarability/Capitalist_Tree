/**
 * Biology provisional constants (P1).
 *
 * Every value here corresponds to (or stands in for) a biology-related
 * unresolved design decision in GDD §17. They live in a dedicated file so
 * biology tuning is localized to one place. The simulation engine imports
 * these via `@capitalist-tree/shared` — never use magic numbers inside
 * the BiologySystem.
 *
 * CONVENTION: `PROVISIONAL_BIOLOGY_*` prefix and a `// PROVISIONAL (GDD §17:
 * <item>)` comment pointing at the GDD entry the value resolves. When a
 * value is promoted from "provisional" to "decided" via playtesting, move
 * it to a sibling `decided.ts` and remove the prefix.
 */

// PROVISIONAL (GDD §17: detailed photosynthesis and energy allocation equations)
//
// Maximum photosynthetic production per unit of active leaf area per simulation
// day at optimum temperature, full light, no water/nutrient/CO2 stress.
// Tunable baseline; species' `photosynthesisRate` is multiplied by this to get
// the species-specific maximum.
export const PROVISIONAL_BIOLOGY_MAX_PHOTOSYNTHESIS_RATE = 1.0; // eu / leaf-area / day

// PROVISIONAL (GDD §17: detailed photosynthesis and energy allocation equations)
//
// CO2 concentration (ppm) at which the CO2 limiting factor saturates to 1.0.
// Real-world ambient is ~410 ppm; the model treats the species' optimum CO2 as
// the saturation point and clamps below.
export const PROVISIONAL_BIOLOGY_CO2_SATURATION_PPM = 400;

// PROVISIONAL (GDD §17: detailed photosynthesis and energy allocation equations)
//
// Fraction of normal photosynthesis retained during night (timeOfDay outside
// [DAY_START_FRACTION, DAY_END_FRACTION]). Real trees do have low-light
// photosynthesis at dawn/dusk; we use 0.25 so the sapling can survive the
// night without depleting reserves faster than daylight replenishes them.
// 0.0 (no night photosynthesis) caused saplings to die within ~45 days.
export const PROVISIONAL_BIOLOGY_NIGHT_PHOTOSYNTHESIS_FRACTION = 0.25;

// PROVISIONAL (GDD §17: detailed photosynthesis and energy allocation equations)
//
// Maintenance respiration cost, as a fraction of the tree's potential
// photosynthetic production (full-canopy, optimum conditions) per day. The
// tree also pays an additional premium for woody tissue, scaled by structural
// development. A healthy mature tree spends roughly this fraction of its
// daily potential production on staying alive.
export const PROVISIONAL_BIOLOGY_MAINTENANCE_FRACTION = 0.4;

// PROVISIONAL (GDD §17: detailed photosynthesis and energy allocation equations)
//
// Additional maintenance cost per unit of stress (multiplier on baseline
// maintenance). Stressed trees burn more energy.
export const PROVISIONAL_BIOLOGY_STRESS_MAINTENANCE_MULTIPLIER = 1.5;

// PROVISIONAL (GDD §17: detailed photosynthesis and energy allocation equations)
//
// Energy cost of recovering one unit of stress (eu per stress point). Trees
// in good conditions slowly spend energy to reduce accumulated stress.
export const PROVISIONAL_BIOLOGY_STRESS_RECOVERY_ENERGY_COST = 5.0;

// PROVISIONAL (GDD §17: detailed photosynthesis and energy allocation equations)
//
// Rate at which stress naturally decays when conditions are favourable and
// reserves are healthy, in stress points per day.
export const PROVISIONAL_BIOLOGY_STRESS_RECOVERY_RATE = 0.1;

// PROVISIONAL (GDD §17: detailed photosynthesis and energy allocation equations)
//
// Reserve capacity multiplier per unit of structural development. The actual
// reserve capacity is `species.reserveCapacity * (1 + structuralFactor)` where
// `structuralFactor` grows with trunk+root development.
export const PROVISIONAL_BIOLOGY_RESERVE_CAPACITY_DEVELOPMENT_GAIN = 1.0;

// PROVISIONAL (GDD §17: initial leaf denomination and production rules)
//
// Default leaf denomination (minor currency units) when a species doesn't
// specify one. $10.00 = 1000 minor units. The White Oak species uses this.
//
// P12-C follow-up #3 (economy tuning for the DR-1 financial-independence
// target ≤60d): raised 100 → 1000 (10×). At $1/leaf, a young tree (~30
// leaves) earned ~$30/month — far below the $240/month living-expense bill
// (PROVISIONAL_PERSONAL_EXPENSE_*_MINOR), so the player's cash always
// declined and the DR-1 "escape basic financial survival within a few weeks"
// target was unreachable (verified by the design-promise bot). Even a
// full-grown tree (200 leaves × $1 = $200) fell short of the $240 bill. At
// $10/leaf, a young cared-for tree (~30 leaves) earns ~$300/month > $240,
// so an engaged player's cash grows from the first harvest — the target is
// met. The 10× raise preserves the relative bill weights (housing still
// dominates) and the $500 starting-cash runway (now ~2 months at the bill,
// giving the player time to start harvesting).
export const PROVISIONAL_BIOLOGY_DEFAULT_LEAF_DENOMINATION_MINOR = '1000';

// PROVISIONAL (GDD §17: maximum harvesting rates)
//
// Maximum fraction of current foliage that can be removed in a single harvest
// action when the species doesn't specify one. Species can override.
export const PROVISIONAL_BIOLOGY_DEFAULT_MAX_HARVEST_FRACTION = 0.5;

// PROVISIONAL (GDD §5.4 / §17: maximum harvesting rates)
//
// Stress added per leaf harvested, as a fraction of remaining foliage. The
// absolute stress induced by a harvest of N leaves from a tree with F foliage
// is `min(1, (N / max(F, 1)) * STRESS_PER_LEAF_FRACTION)`. Harvesting more
// of the tree adds proportionally more stress.
export const PROVISIONAL_BIOLOGY_HARVEST_STRESS_PER_LEAF_FRACTION = 0.5;

// PROVISIONAL (GDD §5.6: tree death — repeated severe defoliation)
//
// Number of severe defoliations (>50% foliage removed) within
// `PROVISIONAL_BIOLOGY_DEATH_DEFOLIATION_WINDOW_DAYS` sim days that triggers
// a death check. A mature tree survives one but suffers on repeats.
//
// P12-C redesign follow-up #2: raised 2 → 4. At 2, the defoliation mortality
// fired far too early — because `PROVISIONAL_BIOLOGY_DEFAULT_MAX_HARVEST_FRACTION`
// (0.5) equals `SEVERE_DEFOLIATION_FRACTION` (0.5), every max harvest is a
// severe-defoliation, so 2 max harvests within 60 days killed the tree (even a
// mature one), defeating the DR-1 intent ("survives one, suffers on repeats" +
// "aggressive harvesting fatal within a growing season" — ~1yr, not ~1mo). At
// 4, a mature tree tolerates up to 3 max harvests within the window; the 4th
// triggers the mortality check (a probability ramp, not an instant kill).
export const PROVISIONAL_BIOLOGY_DEATH_DEFOLIATION_COUNT = 4;

// PROVISIONAL (GDD §5.6: tree death — repeated severe defoliation)
//
// Rolling window (sim days) used to count severe defoliations for the
// mortality check.
//
// P12-C redesign follow-up #2: widened 60 → 90. Paired with the COUNT raise
// (2→4) so the density of severe-defoliations that triggers death is roughly
// preserved (~1 per 22 days) but the absolute count is higher, giving the tree
// more recovery headroom between harvests.
export const PROVISIONAL_BIOLOGY_DEATH_DEFOLIATION_WINDOW_DAYS = 90;

// PROVISIONAL (GDD §5.6: tree death)
//
// Below this reserve fraction (reserves / capacity), the tree accumulates
// mortality stress each day.
export const PROVISIONAL_BIOLOGY_DEATH_RESERVE_CRITICAL_FRACTION = 0.1;

// PROVISIONAL (GDD §5.6: tree death)
//
// Stress level above which the tree starts risking death each day. Above this,
// a daily RNG draw determines whether the tree dies.
export const PROVISIONAL_BIOLOGY_DEATH_STRESS_CRITICAL = 0.9;

// PROVISIONAL (GDD §5.6: tree death)
//
// Base daily probability of death when stress is critical and reserves are
// exhausted. Multiplied by `(stress - critical) / (1 - critical)` so the
// probability rises with stress.
export const PROVISIONAL_BIOLOGY_DEATH_DAILY_PROBABILITY = 0.05;

// PROVISIONAL (GDD §4.4: seasons — deciduous foliage behavior)
//
// Foliage condition target by season for deciduous species (in [0, 1]).
//   spring: budding — partial
//   summer: full canopy
//   autumn: senescence begins, declining
//   winter: full dormancy — no foliage
export const PROVISIONAL_BIOLOGY_DECIDUOUS_SEASONAL_FOLIAGE: Readonly<Record<
  'spring' | 'summer' | 'autumn' | 'winter',
  number
>> = Object.freeze({
  spring: 0.6,
  summer: 1.0,
  autumn: 0.5,
  winter: 0.0,
});

// PROVISIONAL (GDD §4.4: seasons — deciduous foliage behavior)
//
// Rate at which `foliage.seasonalCondition` approaches the seasonal target,
// per day. A rate of 0.2 means ~5 days to fully transition.
export const PROVISIONAL_BIOLOGY_SEASONAL_TRANSITION_RATE = 0.2;

// PROVISIONAL (GDD §5.5: tree maturity — growth limit curve)
//
// Exponent controlling how sharply structural growth slows as the tree
// approaches its maximum height. Higher = sharper asymptote. 1.0 = linear
// decline; 2.0 = quadratic; etc.
export const PROVISIONAL_BIOLOGY_MATURITY_GROWTH_CURVE_EXPONENT = 2.0;

// PROVISIONAL (GDD §5.5: tree maturity)
//
// Fraction of normal structural growth retained once a tree is fully mature.
// Mature trees still grow slowly (radial trunk thickening) but stop height
// growth. 0.05 = 5% of sapling growth rate.
export const PROVISIONAL_BIOLOGY_MATURE_GROWTH_FRACTION = 0.05;

// PROVISIONAL (GDD §5.2: photosynthesis — leaf health contribution)
//
// Weight of `leafHealth` vs `seasonalCondition` in computing the effective
// active leaf area. The active leaf area used for photosynthesis is
// `currentLeaves * leafAreaPerLeaf * (leafHealth * W1 + seasonalCondition * W2)`
// where W1+W2 = 1.
export const PROVISIONAL_BIOLOGY_LEAF_HEALTH_WEIGHT = 0.7;
export const PROVISIONAL_BIOLOGY_SEASONAL_CONDITION_WEIGHT = 0.3;

// PROVISIONAL (GDD §5.3: energy reserves — winter dormancy consumption)
//
// Daily energy consumption during winter dormancy as a fraction of full
// maintenance. Deciduous trees still respire and lose energy through their
// bark/roots even with no foliage.
export const PROVISIONAL_BIOLOGY_DORMANCY_MAINTENANCE_FRACTION = 0.25;

// PROVISIONAL (GDD §5.5: tree maturity — growth conversion)
//
// Multiplier on the structural-conversion rate (eu -> metres / dimensionless
// growth). Set so a sapling at full energy allocation reaches maximumHeight in
// roughly `species.matureAgeDays / PROVISIONAL_BIOLOGY_GROWTH_CONVERSION_MULTIPLIER`
// simulated days under continuous favourable conditions. A sapling rarely
// experiences continuous optimum so effective growth is slower.
export const PROVISIONAL_BIOLOGY_GROWTH_CONVERSION_MULTIPLIER = 8.0;

// PROVISIONAL (GDD §17: detailed photosynthesis and energy allocation equations)
//
// Maintenance respiration is biomass-driven: a tree pays eu/day proportional to
// its living woody tissue (trunk + height + branches + roots), not to its
// potential photosynthesis. This prevents saplings from being charged
// full-canopy maintenance they cannot afford. The biomass score is a
// dimensionless sum of normalized development fractions in [0, 4]; multiplying
// by this rate yields eu per day at optimum temperature and zero stress.
//
// Tuned to 50 (was 100) so a sapling can bootstrap: at biomass=0.2 and 18°C,
// maintenance is ~3 eu/day, well below the ~20 eu/day a 50-leaf canopy produces.
// A mature tree (biomass=4) pays ~160 eu/day — substantial but affordable for
// a full-canopy oak producing thousands of eu/day.
export const PROVISIONAL_BIOLOGY_BIOMASS_MAINTENANCE_RATE = 50.0; // eu / biomass-unit / day

// PROVISIONAL (GDD §17: detailed photosynthesis and energy allocation equations)
//
// Minimum respiration factor when temperature is at or below the species'
// minimum. Real trees still respire (slowly) when cold; this floor prevents
// dormancy from making maintenance exactly zero (which would let winter be free).
export const PROVISIONAL_BIOLOGY_RESPIRATION_TEMP_FLOOR = 0.2;

// PROVISIONAL (GDD §5.2: photosynthesis — light availability)
//
// Light factor during daytime (when timeOfDay is in
// [DAY_START_FRACTION, DAY_END_FRACTION]). P2's WeatherSystem will modulate
// this by cloud cover; for P1 daylight = full light.
export const PROVISIONAL_BIOLOGY_DAY_LIGHT_FACTOR = 1.0;

// PROVISIONAL (GDD §5.5: tree maturity — leaf capacity growth)
//
// Each unit of branch development adds this many leaves to the tree's
// leafCapacity. A mature oak with branchDevelopment = 100 has
// `initial.leafCapacity + 100 * LEAF_CAPACITY_PER_BRANCH` = 50 + 10000 = 10050
// leaves of capacity at full structural development.
export const PROVISIONAL_BIOLOGY_LEAF_CAPACITY_PER_BRANCH = 100;

// PROVISIONAL (GDD §8.1 / §8.2: resource simulation — placeholder uptake)
//
// P2's ResourceSystem will own the water/nutrient uptake model. P1's
// BiologySystem performs a placeholder uptake from environment so the tree
// survives long enough for the headless script to grow it for several sim
// years. The placeholder caps uptake by the tree's root absorption capacity
// and by what the environment offers, but assumes the environment is
// well-supplied (the default starting environment has plenty).
export const PROVISIONAL_BIOLOGY_WATER_UPTAKE_RATE = 1.0; // L per unit absorption per day
export const PROVISIONAL_BIOLOGY_NUTRIENT_UPTAKE_RATE = 1.0; // units per unit absorption per day

// PROVISIONAL (GDD §17: detailed photosynthesis and energy allocation equations)
//
// Allocation weights for surplus energy (after maintenance is paid). Each is a
// fraction of the surplus; the remainder goes to reserve storage. Weights are
// survival-first: roots are prioritized over trunk, trunk over branches,
// branches over new leaves, leaves over reproduction. Reproduction is the
// smallest bucket (lowest priority) — a tree only directs surplus energy to
// reproduction once the higher-priority survival/growth buckets are satisfied
// (GAP-19 / GDD §5.2 "Reproductive development where applicable").
//
// The sum is intentionally < 1.0 so a substantial fraction of surplus goes to
// reserve storage. This is critical for sapling bootstrap: a sapling's small
// canopy produces barely enough to outpace maintenance, and the night-time
// maintenance draw would deplete reserves faster than daylight replenishes
// them if all surplus went to growth. Mature trees benefit too — reserves
// cushion defoliation events (GDD §5.3).
export const PROVISIONAL_BIOLOGY_ALLOCATION_WEIGHTS = Object.freeze({
  rootGrowth: 0.15,
  trunkGrowth: 0.10,
  branchGrowth: 0.10,
  leafGrowth: 0.15,
  reproduction: 0.05,
});
export type AllocationWeights = typeof PROVISIONAL_BIOLOGY_ALLOCATION_WEIGHTS;

// PROVISIONAL (GAP-19 / GDD §5.2, §11.2 — reproduction / seeding).
//
// The reproduction bucket (`alloc.reproduction`) fills a per-tree
// `seedGrowthProgress` accumulator in [0, 1]. Each tick:
//   seedGrowthProgress = min(1, current + alloc.reproduction / SEED_ENERGY_COST)
// When it reaches 1.0 AND the tree is past its fruiting age, the BiologySystem
// emits a `seed-dispersed` event, increments `tree.seeds` by SEED_YIELD, and
// resets the accumulator to 0. The fruiting gate is a fraction of the species'
// `matureAgeDays`. NOTE: `matureAgeDays = matureAgeYears × 120` (SIM days, not
// calendar), so White Oak's 24000 d = 200 sim-yr (the original "≈ 66 sim-yr"
// comment confused calendar + sim years). At 0.1× the gate was 2400 d = 20
// sim-yr — UNREACHABLE in any normal sim (the dr1-long-run is 5 sim-yr), so the
// seed production never fired + the plant-seed action had nothing to plant.
// Lowered to 0.01× → 240 d = 2 sim-yr for White Oak (date palm 60 d, saxaul 96 d
// — fast-maturing species fruit earlier), reachable in a typical long play
// session + the dr1-long-run. Still a late-game mechanic (GDD §11.2 Genetic
// Legacy: saplings have little surplus, so they barely invest until established).
// Tunable.
//
// Balance: a mature tree with ~50 eu/tick surplus × 0.05 weight = 2.5 eu/tick
// into reproduction → 500 / 2.5 = 200 ticks to a seed (≈200 d at 1-day steps,
// ~2-3 seeds/sim-year). Saplings produce almost no surplus so they barely
// invest — correct (reproduction is a late-game mechanic, GDD §11.2 Genetic
// Legacy).
/** Energy (eu) required to fill `seedGrowthProgress` from 0 to 1 (one seed).
 * @provisional. */
export const PROVISIONAL_BIOLOGY_REPRODUCTION_SEED_ENERGY_COST_EU = 500;
/** Fruiting age = species.matureAgeDays × this fraction. @provisional.
 *  0.01 → White Oak 240 d (2 sim-yr), reachable in normal play (was 0.1 → 20 sim-yr, unreachable). */
export const PROVISIONAL_BIOLOGY_REPRODUCTION_FRUITING_AGE_FRACTION = 0.01;
/** Seeds produced per dispersal event. @provisional. */
export const PROVISIONAL_BIOLOGY_REPRODUCTION_SEED_YIELD = 1;

// PROVISIONAL (GDD §5.6: tree death)
//
// Stress added per day when the tree is in a "critical" state (reserves below
// DEATH_RESERVE_CRITICAL_FRACTION or repeated severe defoliation).
export const PROVISIONAL_BIOLOGY_DEATH_CRITICAL_STRESS_PER_DAY = 0.05;

// PROVISIONAL (GDD §5.4: harvesting — sustainable estimate margin)
//
// The sustainable harvest estimate is the surplus production divided by the
// leaf energy cost, then scaled down by this safety factor so the player
// following the recommendation doesn't push the tree into reserve depletion.
export const PROVISIONAL_BIOLOGY_SUSTAINABLE_HARVEST_SAFETY_MARGIN = 0.8;

// ============================================================================
// P1 — Stress accumulation rates (GDD §5.1, §5.6, §17).
//
// Stress is a normalized [0, 1] indicator BiologySystem recomputes each tick
// from underlying adverse-condition drivers. The four rates below tune how
// quickly each driver pushes stress upward; the recovery rate + recovery
// energy cost (already centralized above) tune how quickly it relaxes when
// conditions improve. All values are @provisional per GDD §17 ("detailed
// photosynthesis and energy allocation equations" — stress is part of the
// same energy-balance model).
// ============================================================================

// PROVISIONAL (GDD §5.1 / §17: detailed photosynthesis and energy allocation equations)
//
// Stress added per day when water deficiency is severe (stored water below
// half the daily requirement). Scaled by `(0.5 - waterFactor) * 2` so the
// penalty grows linearly from 0 at waterFactor=0.5 to the full rate at
// waterFactor=0.
export const PROVISIONAL_BIOLOGY_STRESS_WATER_PER_DAY = 0.2;

// PROVISIONAL (GDD §5.1 / §17: detailed photosynthesis and energy allocation equations)
//
// Stress added per day when any nutrient is below half its requirement
// (Liebig-capped). Same scaling form as water.
export const PROVISIONAL_BIOLOGY_STRESS_NUTRIENT_PER_DAY = 0.15;

// PROVISIONAL (GDD §5.6 / §17: detailed photosynthesis and energy allocation equations)
//
// Stress added per day when reserves are critical (below
// PROVISIONAL_BIOLOGY_DEATH_RESERVE_CRITICAL_FRACTION). Scaled by the
// shortfall from the critical threshold.
export const PROVISIONAL_BIOLOGY_STRESS_RESERVE_PER_DAY = 0.1;

// PROVISIONAL (GDD §5.6 / §17: detailed photosynthesis and energy allocation equations)
//
// Stress added per active (non-weather) damage record per day. Damage records
// (severe defoliation, pest, disease) accumulate stress while they're on the
// tree; the BiologySystem prunes old records via the mortality window.
// (P12-C: `weather:*` records are excluded from this count — see
// biology/stress.ts. The weather damage's mechanical impact is defoliation,
// applied in the WeatherSystem.)
export const PROVISIONAL_BIOLOGY_STRESS_DAMAGE_PER_DAY = 0.05;

// PROVISIONAL (GDD §5.6 / P12-C redesign — chronic-neglect mortality).
//
// Cumulative "wear" — an accumulation of NON-WEATHER damage severity (pest,
// disease, severe-defoliation). Each damage event adds `severity ×
// WEAR_PER_DAMAGE` to tree.wear. Pre-W59, wear was strictly monotonic (never
// decayed, never pruned); W59 added a recovery path (see
// PROVISIONAL_BIOLOGY_WEAR_RECOVERY_RATE_PER_DAY below) so a cared-for tree
// can net out the ambient infestation wear. `tree.damage` (the active-damage
// list) is still prune-windowed to 60 days; wear is the chronic counter that
// survives the prune-window fluctuation + Poisson variance.
//
// Weather damage is EXCLUDED from the wear (it's ambient — happens regardless
// of player care; its mechanical impact is defoliation, applied in the
// WeatherSystem). The wear accumulates only from NEGLECT signals: infestations
// (pest/disease, which take hold when the player isn't doing pest control) +
// severe-defoliation (from over-pruning/over-harvesting).
//
// Calibration (idle sim, no pest control): infestation rate ~0.035/day × mean
// severity ~0.5 = ~0.0175 severity/day. WEAR_PER_DAMAGE=1 → wear ≈ cumulative
// severity. ONSET 3.0 ≈ 0.0175 × 171 days (~5.7mo); THRESHOLD 6.0 ≈ 0.0175 ×
// 343 days (~11.4mo). The mortality probability ramps linearly from 0 at ONSET
// to DEATH_DAILY_PROBABILITY at THRESHOLD, so the tree dies in the 6-12mo
// window (the DR-1 target). Tunable in future P12-C iterations.
export const PROVISIONAL_BIOLOGY_WEAR_PER_DAMAGE = 1.0;
export const PROVISIONAL_BIOLOGY_WEAR_MORTALITY_ONSET = 3.0;
export const PROVISIONAL_BIOLOGY_WEAR_DEATH_THRESHOLD = 6.0;

// PROVISIONAL (W59 / GDD §5.6 — wear recovery).
//
// Pre-W59, `tree.wear` was strictly monotonic — it NEVER decayed. Ambient
// pest/disease infestations added ~0.026 wear/day regardless of player care,
// so even a perfectly-cared-for tree crossed the mortality onset (3.0) at
// ~3-6mo + died. This made the "sustainable" playstyle impossible: the W58
// design-promise bot found the tree dies at day 85 under sustainable harvesting
// (30 leaves/28d + watering + compost). The care actions (water, fertilizer)
// only affect stress/reserves, NOT wear — so no amount of care could save the
// tree from the chronic wear timer.
//
// W59 adds a wear-recovery path (mirroring PROVISIONAL_BIOLOGY_STRESS_RECOVERY_*).
// When conditions are favourable (water/nutrient/reserves all OK) AND there's
// been no severe-defoliation in the last 7 days, wear decays at this rate. The
// rate (0.04/day) exceeds the ambient infestation rate (~0.026/day), so a
// cared-for tree nets out ~0.014/day wear recovery — it can sustain indefinite
// sustainable harvesting. A neglected tree (water/nutrient deficient) does NOT
// recover wear, so chronic neglect still kills the tree in the 6-12mo window
// (the DR-1 neglect-death target holds). Recovery costs energy (3 eu/unit),
// deducted from reserves alongside the stress-recovery cost.
export const PROVISIONAL_BIOLOGY_WEAR_RECOVERY_RATE_PER_DAY = 0.04;
export const PROVISIONAL_BIOLOGY_WEAR_RECOVERY_ENERGY_COST = 3;

// ---------------------------------------------------------------------------
// P12-B (GAP-18): pest + disease infestations.
//
// Biological threats that accumulate `pest` / `disease` damage records on the
// tree, driving the DR-1 6–12 month neglect-death target. The rates are
// per-day; the BiologySystem scales by stepDays. With the 60-day damage-prune
// window (PROVISIONAL_BIOLOGY_DEATH_DEFOLIATION_WINDOW_DAYS), the steady-state
// activeDamage ≈ rate × 60. The damage stress (PROVISIONAL_BIOLOGY_STRESS_
// DAMAGE_PER_DAY × activeDamage) must exceed the recovery rate
// (PROVISIONAL_BIOLOGY_STRESS_RECOVERY_RATE = 0.1/day) for stress to climb —
// i.e. activeDamage > 2, rate > 0.033/day. At the rates below (pest 0.02 +
// disease 0.015 = 0.035/day total), activeDamage ≈ 2.1, stressAdd ≈ 0.105/day
// just edges past recovery (0.1/day), so stress climbs to critical over ~9
// months, then the critical-stress mortality path fires. Tunable in P12-C.
// ---------------------------------------------------------------------------

// PROVISIONAL (GDD §5.6 "Pests" / §17: detailed biology model).
//
// Probability per day of a pest infestation taking hold (adds a `pest` damage
// record). Pests are the more frequent biological threat.
//
// P12-C redesign follow-up: raised from 0.02 to 0.03 (~1.5×). At 0.02, the
// combined infestation rate (pest 0.02 + disease 0.015 = 0.035/day growing
// season, disease-only in winter) accumulated wear at ~0.0113/day observed —
// too slow for the wear path's onset (3.0) to be reached within the DR-1
// 6-12mo target (onset at ~9mo, threshold at ~18mo). At 0.03 (combined 0.0525
// growing), the observed wear rate ~0.017/day → onset (3.0) at ~6mo, threshold
// (6.0) at ~12mo, so the wear-path neglect death fires in the 6-12mo window.
export const PROVISIONAL_BIOLOGY_PEST_INFESTATION_RATE_PER_DAY = 0.03;

// PROVISIONAL (GDD §5.6 "Disease" / §17: detailed biology model).
//
// Probability per day of a disease taking hold (adds a `disease` damage
// record). Rarer than pests. Raised 0.015 → 0.0225 (~1.5×) alongside the pest
// rate (P12-C redesign follow-up) for the same wear-accumulation reason.
export const PROVISIONAL_BIOLOGY_DISEASE_INFESTATION_RATE_PER_DAY = 0.0225;

// PROVISIONAL (GDD §5.6 / §17).
//
// Severity range for an infestation damage record (uniform in [min, max]).
// The severity is recorded for the defoliation/mortality checks + future
// condition-dependent scaling; the stress calculation uses the record COUNT,
// not the severity.
export const PROVISIONAL_BIOLOGY_INFESTATION_SEVERITY_MIN = 0.3;
export const PROVISIONAL_BIOLOGY_INFESTATION_SEVERITY_MAX = 0.7;
