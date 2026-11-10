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
// specify one. $1.00 = 100 minor units. The White Oak species uses this.
export const PROVISIONAL_BIOLOGY_DEFAULT_LEAF_DENOMINATION_MINOR = '100';

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
export const PROVISIONAL_BIOLOGY_DEATH_DEFOLIATION_COUNT = 2;

// PROVISIONAL (GDD §5.6: tree death — repeated severe defoliation)
//
// Rolling window (sim days) used to count severe defoliations for the
// mortality check.
export const PROVISIONAL_BIOLOGY_DEATH_DEFOLIATION_WINDOW_DAYS = 60;

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
// branches over new leaves, leaves over reproduction. Reproduction is a stub
// (0.0) until P6+ (Genetic Legacy) — the slot exists so allocation math does
// not need to change when reproduction is added.
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
  reproduction: 0.0,
});
export type AllocationWeights = typeof PROVISIONAL_BIOLOGY_ALLOCATION_WEIGHTS;

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
