/**
 * White Oak (Quercus alba) — the first playable tree species.
 *
 * WHY OAK?
 *   - The GDD asks for "one initial deciduous temperate species (pick oak or
 *     maple)". Oak was chosen because:
 *       * Quercus alba is a long-lived (~300+ years), slow-maturing canopy
 *         species. That gives the maturity mechanic real weight — the player
 *         watches the tree grow over many simulated years.
 *       * High structural integrity and large reserve capacity make the
 *         "mature tree survives one near-total defoliation" scenario (TDD §21
 *         acceptance #6) biologically defensible — oaks in fact survive
 *         severe defoliation events (gypsy moth, etc.) and rebound from
 *         reserves.
 *       * Iconic, recognizable silhouette for the P4 renderer.
 *       * Acorns give us a future reproduction hook (TDD §7.3, GDD §11.2).
 *       * The P0 placeholder was already `species:proto-oak`, so this keeps
 *         continuity.
 *
 * Every constant here is `@provisional` per GDD §17 ("detailed photosynthesis
 * and energy allocation equations"). Tuning belongs in playtesting.
 */
import {
  PROVISIONAL_BIOLOGY_DEFAULT_LEAF_DENOMINATION_MINOR,
  PROVISIONAL_BIOLOGY_DEFAULT_MAX_HARVEST_FRACTION,
  type TreeSpecies,
} from '@capitalist-tree/shared';

export const WHITE_OAK: TreeSpecies = {
  id: 'species:white-oak',
  name: 'White Oak',
  scientificName: 'Quercus alba',
  deciduous: true,

  // Growth rate (dimensionless). Oak is slow-growing; this is a sapling-relative
  // baseline. PROVISIONAL: tune against maximumHeight/matureAgeDays.
  growthRate: 0.5,

  // 200 sim years to reach structural maturity (PROVISIONAL_DAYS_PER_YEAR = 120 days).
  matureAgeDays: 200 * 120, // 24000 days

  // Real-world white oaks reach 24-30m. 25m is well within range.
  maximumHeight: 25,
  maximumTrunkDiameter: 1.5,
  maximumBranchDevelopment: 100,

  // DR-4 (docs/reviews/DECISIONS.md): height + diameter grow INDEPENDENTLY
  // from separate energy buckets. heightDiameterSplit is the fraction of the
  // structural (trunkGrowth) bucket allocated to HEIGHT; the remainder goes to
  // trunk diameter. White oaks are girth-heavy — a mature oak adds
  // proportionally more trunk diameter than height — so height gets 40% + the
  // diameter gets 60%. Tunable per species (a tall/fast species would raise it).
  heightDiameterSplit: 0.4,

  // DR-4 allometric constraint: the max height/diameter (slenderness) ratio
  // the species can sustain. A tree cannot grow taller than
  // `trunkDiameter * maxSlendernessRatio` — height growth is clamped when the
  // ratio is exceeded, so a tree must add girth before it can add height
  // (biologically realistic: a spindly tree is structurally unstable). At
  // White Oak's maxima (25m / 1.5m) the ratio is ~16.7, well under 40, so the
  // clamp only bites for unrealistic sapling shapes (e.g. tall + very thin).
  maxSlendernessRatio: 40,

  // Root development rate. Low (0.02) so root development grows slowly —
  // root biomass contributes to maintenance, and a sapling whose roots maxed
  // in 2 days would face mature-tree maintenance before building reserves.
  // At 0.02, root reaches full development in ~50 days under good conditions.
  // PROVISIONAL: tuned against the maintenance/reserve balance.
  rootDevelopmentRate: 0.02,

  // Baseline reserve capacity (eu). Scaled by structural development at runtime
  // per PROVISIONAL_BIOLOGY_RESERVE_CAPACITY_DEVELOPMENT_GAIN.
  reserveCapacity: 1000,

  // Daily water demand at full foliage (L/day, scaled by active foliage).
  // Mature oaks transpire hundreds of litres per day in real life; we use a
  // playable scaled value.
  waterRequirement: 50,

  nutrientRequirement: {
    nitrogen: 5,
    phosphorus: 2,
    potassium: 4,
  },

  temperatureRange: {
    // Below 5°C photosynthesis essentially stops; below 0°C deciduous trees are
    // dormant. We use 5°C as the minimum for any photosynthesis.
    minimum: 5,
    optimum: 22,
    maximum: 38,
  },

  // PROVISIONAL: maximum photosynthesis per leaf area per day at optimum.
  // Scaled by PROVISIONAL_BIOLOGY_MAX_PHOTOSYNTHESIS_RATE at runtime.
  photosynthesisRate: 1.0,

  // Each leaf contributes ~0.005 m² of photosynthetic area. Real-world white
  // oak leaves are ~12-20 cm long; we use a representative scaled value.
  leafAreaPerLeaf: 0.005,

  // $1.00 per harvested leaf (PROVISIONAL: leaf denomination).
  leafDenominationMinor: PROVISIONAL_BIOLOGY_DEFAULT_LEAF_DENOMINATION_MINOR,

  // Energy cost to regrow one leaf (eu). PROVISIONAL.
  leafEnergyCost: 2,

  // Max 50% of foliage per harvest action (PROVISIONAL: harvesting rates).
  maximumHarvestFraction: PROVISIONAL_BIOLOGY_DEFAULT_MAX_HARVEST_FRACTION,

  initial: {
    // 50cm sapling from a nursery — large enough to have functional leaves but
    // small enough to be clearly a sapling.
    height: 0.5,
    trunkDiameter: 0.01, // 1 cm
    branchDevelopment: 0,
    // A young sapling's canopy: 200 leaves of room. The starter 50 leaves
    // give it a viable photosynthetic base from day 0 — enough to outpace
    // maintenance and build reserves through the first spring.
    leafCapacity: 200,
    // Functional roots — absorptionCapacity=0.3 means the root can absorb
    // 30% of the species' baseline waterRequirement per day (15 L/day for
    // White Oak). Sapling transpiration is far below that, so the root can
    // refill the water buffer.
    rootDevelopment: 0.15,
    absorptionCapacity: 0.3,
    // Reserve capacity (eu). Used as the floor by computeReserveCapacity
    // (see biology/reserves.ts). 120 eu lets the sapling bud several leaves
    // from reserves at leafEnergyCost=2 if photosynthesis fails (e.g. cloudy
    // day) and provides cushion against the night maintenance draw.
    reserveCapacity: 120,
    // 50 L internal water buffer — enough for several days at sapling
    // transpiration rate (~0.25 L/day) even without absorption.
    waterCapacity: 50,
    // Start fully hydrated so the sapling doesn't immediately desiccate.
    waterStored: 50,
    // Starter reserves: cushion for the first few days before photosynthesis
    // ramps up (cold spring, cloudy days, etc.).
    energyReserves: 120,
    nutrients: {
      nitrogen: 5,
      phosphorus: 2,
      potassium: 4,
    },
  },
};
