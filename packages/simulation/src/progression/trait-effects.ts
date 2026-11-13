/**
 * Trait-effect application pure helpers (P9c — TDD §5.7 / §11, GDD §11.2
 * Genetic Legacy — genetic modifications have meaningful trade-offs).
 *
 * GDD §11.2: each of the seven genetic traits grants a benefit AND imposes a
 * trade-off. The trait's `magnitude` (0–1) scales both — a half-expressed
 * trait grants half the benefit AND half the trade-off. This module turns
 * the human-readable benefit/trade-off strings on the content definitions
 * into concrete numeric multipliers on a `BiologyParameters` object.
 *
 *   - `defaultBiologyParameters()` : the neutral parameter set (every
 *     multiplier 1.0 — no trait effects). The starting point for
 *     `applyTraitEffects`.
 *   - `applyTraitEffects(biologyState, activeTraits)` : fold each active
 *     (expressed) trait's benefit + trade-off into the parameter set,
 *     returning a new `BiologyParameters` with the multipliers applied.
 *
 * WIRING (R-P9-N — carry-forward): the BiologySystem (slot #3) is the
 * intended consumer of these multipliers — it would call
 * `applyTraitEffects(defaultBiologyParameters(), state.progression.genetics.
 * activeTraits)` each tick and apply the resulting multipliers to its
 * photosynthesis / growth / water-demand / reserve / stress computations.
 * P9c provides the pure helper but does NOT wire it into the BiologySystem
 * (stay in scope — the task contract forbids modifying the BiologySystem
 * logic unless wiring the call, and the BiologySystem's per-tick computation
 * would need restructuring to consume the multiplier set; that lands in a
 * future task). The helper is pure + fully tested here so the wiring is a
 * one-line call when it lands.
 *
 * STACKING (documented): multiple active traits stack MULTIPLICATIVELY for
 * multiplier fields (each trait's factor multiplies the cumulative product)
 * — e.g. rapid-growth (+20% growth at magnitude 1) + pest-resistance (-10%
 * growth at magnitude 1) → `growthRateMultiplier = 1.2 * 0.9 = 1.08`. This
 * keeps each trait's effect proportional to its magnitude and lets benefits
 * and trade-offs from different traits interact naturally. Fields that
 * represent a threshold or a capacity use the same multiplicative convention
 * (the BiologySystem interprets the multiplier when it wires the call).
 *
 * Pure: every helper returns a new value without mutating the input.
 * Deterministic given (biologyState, activeTraits).
 */
import type { GeneticTraitState } from '@capitalist-tree/shared';
import { getTraitById } from '@capitalist-tree/content';

// ---------------------------------------------------------------------------
// BiologyParameters — the multiplier set traits modify
// ---------------------------------------------------------------------------

/**
 * The set of biology multipliers a lineage's active traits modify. Every
 * field defaults to 1.0 (neutral — no effect); `applyTraitEffects` multiplies
 * the relevant fields by each active trait's factor.
 *
 * The BiologySystem (slot #3, in a future task R-P9-N) applies these
 * multipliers to its per-tick computation:
 *   - `growthRateMultiplier`        : scales height / trunk / branch growth.
 *   - `earlyGrowthMultiplier`       : scales early-development growth (the
 *     deep-roots trade-off — roots before canopy).
 *   - `structuralGrowthMultiplier`  : scales structural (trunk-density)
 *     growth (the thick-trunk trade-off).
 *   - `maxGrowthMultiplier`         : scales the growth ceiling (the
 *     efficient-photosynthesis trade-off caps peak growth).
 *   - `productionCapacityMultiplier`: scales leaf capacity / harvest yield.
 *   - `energyProductionMultiplier`  : scales energy production per leaf area.
 *   - `waterDemandMultiplier`       : scales the tree's water requirement.
 *   - `droughtResistanceMultiplier` : scales drought resistance (the
 *     deep-roots benefit — sustains photosynthesis through dry periods).
 *   - `reservesCapacityMultiplier`  : scales energy + water reserve capacity.
 *   - `pestVulnerabilityMultiplier` : scales pest-outbreak damage
 *     vulnerability (LOWER is better — pest-resistance reduces this).
 *   - `frostSurvivalMultiplier`     : scales frost survival probability.
 *   - `warmClimatePerformanceMultiplier`: scales warm-climate performance
 *     (the cold-resistance trade-off — cold-hardy chemistry underperforms
 *     in heat; LOWER is a penalty).
 *
 * All multipliers are non-negative numbers (a trait never inverts a field's
 * sign — it scales it toward 0 or away from 1).
 */
export interface BiologyParameters {
  readonly growthRateMultiplier: number;
  readonly earlyGrowthMultiplier: number;
  readonly structuralGrowthMultiplier: number;
  readonly maxGrowthMultiplier: number;
  readonly productionCapacityMultiplier: number;
  readonly energyProductionMultiplier: number;
  readonly waterDemandMultiplier: number;
  readonly droughtResistanceMultiplier: number;
  readonly reservesCapacityMultiplier: number;
  readonly pestVulnerabilityMultiplier: number;
  readonly frostSurvivalMultiplier: number;
  readonly warmClimatePerformanceMultiplier: number;
}

/**
 * The neutral biology parameter set — every multiplier 1.0 (no trait
 * effects). The starting point for `applyTraitEffects`. The BiologySystem
 * would call `applyTraitEffects(defaultBiologyParameters(), activeTraits)`
 * to fold in the lineage's expressed traits.
 *
 * Pure: returns a fresh object each call.
 */
export function defaultBiologyParameters(): BiologyParameters {
  return {
    growthRateMultiplier: 1,
    earlyGrowthMultiplier: 1,
    structuralGrowthMultiplier: 1,
    maxGrowthMultiplier: 1,
    productionCapacityMultiplier: 1,
    energyProductionMultiplier: 1,
    waterDemandMultiplier: 1,
    droughtResistanceMultiplier: 1,
    reservesCapacityMultiplier: 1,
    pestVulnerabilityMultiplier: 1,
    frostSurvivalMultiplier: 1,
    warmClimatePerformanceMultiplier: 1,
  };
}

// ---------------------------------------------------------------------------
// Local @provisional per-trait coefficients (GDD §11.2 table)
// ---------------------------------------------------------------------------
// The coefficients below translate the GDD §11.2 benefit/trade-off table into
// concrete per-magnitude multipliers. They are @provisional (GDD §17 — genetic
// modification balance); the content definitions describe them in
// human-readable form (`benefit` / `tradeOff` strings), and these constants
// are the engine-side interpretation. Tuned during playtesting. The trait's
// `magnitude` (0–1) scales the coefficient, so magnitude=0.5 yields half the
// full (magnitude=1) effect.

// PROVISIONAL (GDD §17: §11.2 Rapid Growth) — +20% growth, +30% water demand.
const PROVISIONAL_RAPID_GROWTH_GROWTH_GAIN = 0.2;
const PROVISIONAL_RAPID_GROWTH_WATER_GAIN = 0.3;
// PROVISIONAL (GDD §17: §11.2 Large Foliage) — +25% production, +30% water.
const PROVISIONAL_LARGE_FOLIAGE_PRODUCTION_GAIN = 0.25;
const PROVISIONAL_LARGE_FOLIAGE_WATER_GAIN = 0.3;
// PROVISIONAL (GDD §17: §11.2 Deep Roots) — +40% drought resist, -15% early.
const PROVISIONAL_DEEP_ROOTS_DROUGHT_GAIN = 0.4;
const PROVISIONAL_DEEP_ROOTS_EARLY_PENALTY = 0.15;
// PROVISIONAL (GDD §17: §11.2 Thick Trunk) — +30% reserves, -20% structural.
const PROVISIONAL_THICK_TRUNK_RESERVES_GAIN = 0.3;
const PROVISIONAL_THICK_TRUNK_STRUCTURAL_PENALTY = 0.2;
// PROVISIONAL (GDD §17: §11.2 Pest Resistance) — -50% pest vuln, -10% growth.
const PROVISIONAL_PEST_RESISTANCE_VULN_REDUCTION = 0.5;
const PROVISIONAL_PEST_RESISTANCE_GROWTH_PENALTY = 0.1;
// PROVISIONAL (GDD §17: §11.2 Cold Resistance) — +50% frost, -15% warm perf.
const PROVISIONAL_COLD_RESISTANCE_FROST_GAIN = 0.5;
const PROVISIONAL_COLD_RESISTANCE_WARM_PENALTY = 0.15;
// PROVISIONAL (GDD §17: §11.2 Efficient Photosynthesis) — +25% energy, -10% max.
const PROVISIONAL_EFFICIENT_PHOTOSYNTHESIS_ENERGY_GAIN = 0.25;
const PROVISIONAL_EFFICIENT_PHOTOSYNTHESIS_MAX_PENALTY = 0.1;

// ---------------------------------------------------------------------------
// applyTraitEffects
// ---------------------------------------------------------------------------

/**
 * Fold each active (expressed) trait's benefit + trade-off into the biology
 * parameter set (GDD §11.2 — genetic modifications have meaningful
 * trade-offs). Returns a new `BiologyParameters` with the multipliers
 * applied; the input is not mutated.
 *
 * Only traits with `active: true` are applied — a deactivated trait's
 * benefit AND trade-off are both dropped (the player toggled it off). Unknown
 * trait ids (defensive — content may add traits after a save was written) are
 * skipped: an unknown trait has no defined benefit/trade-off to apply.
 *
 * Per-trait effects (magnitude `m`, 0–1, scales the coefficient):
 *
 *   - rapid-growth          : growthRateMultiplier   × (1 + m × 0.20)
 *                             waterDemandMultiplier   × (1 + m × 0.30)
 *   - large-foliage         : productionCapacityMultiplier × (1 + m × 0.25)
 *                             waterDemandMultiplier   × (1 + m × 0.30)
 *   - deep-roots            : droughtResistanceMultiplier  × (1 + m × 0.40)
 *                             earlyGrowthMultiplier   × (1 - m × 0.15)
 *   - thick-trunk           : reservesCapacityMultiplier   × (1 + m × 0.30)
 *                             structuralGrowthMultiplier × (1 - m × 0.20)
 *   - pest-resistance       : pestVulnerabilityMultiplier  × (1 - m × 0.50)
 *                             growthRateMultiplier    × (1 - m × 0.10)
 *   - cold-resistance       : frostSurvivalMultiplier      × (1 + m × 0.50)
 *                             warmClimatePerformanceMultiplier × (1 - m × 0.15)
 *   - efficient-photosynthesis : energyProductionMultiplier × (1 + m × 0.25)
 *                                maxGrowthMultiplier      × (1 - m × 0.10)
 *
 * STACKING: multiple active traits stack MULTIPLICATIVELY — each trait's
 * factor multiplies the cumulative product for the fields it touches. A
 * trait that touches a field another trait already touched compounds
 * (e.g. rapid-growth + pest-resistance both touch `growthRateMultiplier`:
 * (1 + m₁ × 0.20) × (1 - m₂ × 0.10)).
 *
 * Pure: returns a new `BiologyParameters`. Deterministic given
 * (biologyState, activeTraits).
 */
export function applyTraitEffects(
  biologyState: BiologyParameters,
  activeTraits: readonly GeneticTraitState[],
): BiologyParameters {
  // Start from the input multipliers (so the caller can compose onto a
  // non-default base if needed — e.g. a future research-multiplier base).
  let {
    growthRateMultiplier,
    earlyGrowthMultiplier,
    structuralGrowthMultiplier,
    maxGrowthMultiplier,
    productionCapacityMultiplier,
    energyProductionMultiplier,
    waterDemandMultiplier,
    droughtResistanceMultiplier,
    reservesCapacityMultiplier,
    pestVulnerabilityMultiplier,
    frostSurvivalMultiplier,
    warmClimatePerformanceMultiplier,
  } = biologyState;

  for (const trait of activeTraits) {
    // Only expressed traits apply their benefit + trade-off (GDD §11.2 —
    // the player toggles which are expressed).
    if (!trait.active) continue;
    // Unknown trait id (defensive) — no defined effect to apply.
    const definition = getTraitById(trait.traitId);
    if (!definition) continue;
    const m = trait.magnitude;

    switch (trait.traitId) {
      case 'trait:rapid-growth':
        growthRateMultiplier *= 1 + m * PROVISIONAL_RAPID_GROWTH_GROWTH_GAIN;
        waterDemandMultiplier *= 1 + m * PROVISIONAL_RAPID_GROWTH_WATER_GAIN;
        break;
      case 'trait:large-foliage':
        productionCapacityMultiplier *=
          1 + m * PROVISIONAL_LARGE_FOLIAGE_PRODUCTION_GAIN;
        waterDemandMultiplier *= 1 + m * PROVISIONAL_LARGE_FOLIAGE_WATER_GAIN;
        break;
      case 'trait:deep-roots':
        droughtResistanceMultiplier *=
          1 + m * PROVISIONAL_DEEP_ROOTS_DROUGHT_GAIN;
        earlyGrowthMultiplier *= 1 - m * PROVISIONAL_DEEP_ROOTS_EARLY_PENALTY;
        break;
      case 'trait:thick-trunk':
        reservesCapacityMultiplier *=
          1 + m * PROVISIONAL_THICK_TRUNK_RESERVES_GAIN;
        structuralGrowthMultiplier *=
          1 - m * PROVISIONAL_THICK_TRUNK_STRUCTURAL_PENALTY;
        break;
      case 'trait:pest-resistance':
        pestVulnerabilityMultiplier *=
          1 - m * PROVISIONAL_PEST_RESISTANCE_VULN_REDUCTION;
        growthRateMultiplier *=
          1 - m * PROVISIONAL_PEST_RESISTANCE_GROWTH_PENALTY;
        break;
      case 'trait:cold-resistance':
        frostSurvivalMultiplier *=
          1 + m * PROVISIONAL_COLD_RESISTANCE_FROST_GAIN;
        warmClimatePerformanceMultiplier *=
          1 - m * PROVISIONAL_COLD_RESISTANCE_WARM_PENALTY;
        break;
      case 'trait:efficient-photosynthesis':
        energyProductionMultiplier *=
          1 + m * PROVISIONAL_EFFICIENT_PHOTOSYNTHESIS_ENERGY_GAIN;
        maxGrowthMultiplier *=
          1 - m * PROVISIONAL_EFFICIENT_PHOTOSYNTHESIS_MAX_PENALTY;
        break;
      default:
        // A known definition whose id has no case here (a future trait whose
        // effect is not yet interpreted) — skip. Documented as a future
        // wiring task when the trait is added.
        break;
    }
  }

  return {
    growthRateMultiplier,
    earlyGrowthMultiplier,
    structuralGrowthMultiplier,
    maxGrowthMultiplier,
    productionCapacityMultiplier,
    energyProductionMultiplier,
    waterDemandMultiplier,
    droughtResistanceMultiplier,
    reservesCapacityMultiplier,
    pestVulnerabilityMultiplier,
    frostSurvivalMultiplier,
    warmClimatePerformanceMultiplier,
  };
}
